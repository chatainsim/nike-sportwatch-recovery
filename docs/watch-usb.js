/*
 * Talking to the Nike+ SportWatch GPS from the browser, with WebHID
 * (Chrome, Edge, and other Chromium browsers on desktop).
 *
 * One read-workouts request, then everything the watch streams is filed by
 * memory address until the memory is complete (see readMemory). Read-only:
 * the read-workouts command (0x10) is the only one ever sent.
 */
(function (root) {
  "use strict";

  const VENDOR_ID = 0x11ac;
  const PRODUCT_ID = 0x5455;
  const REPORT_SIZE = 64;
  const OUT_REPORT_ID = 0x09;
  const OPCODE_READ_WORKOUTS = 0x10;
  const REPLY_TIMEOUT_MS = 3000;
  const DATA_BYTES = 56; // per full packet: addresses are 56 apart
  const MAX_READ_REQUESTS = 4;
  const STREAM_IDLE_MS = 2500;
  const MAX_PACKETS = 40000; // ~2.2 MB, far above what the watch holds

  const READ_TXID = 0x96;
  const hex = (b, n = 16) => Array.from(b.subarray(0, n), (x) => x.toString(16).padStart(2, "0")).join(" ");
  let log = () => {};
  /** Optional logger: fn(message). */
  function setLogger(fn) { log = typeof fn === "function" ? fn : () => {}; }

  function command(opcode, txid, byte1 = 0x02) {
    const p = new Uint8Array(REPORT_SIZE);
    p[0] = OUT_REPORT_ID; p[1] = byte1; p[2] = txid; p[3] = opcode;
    return p;
  }

  class Watch {
    constructor(device) {
      this.device = device;
      this.queue = [];
      this.waiter = null;
      this.received = 0;
      this.verbose = true;
      this.onReport = (e) => {
        const data = new Uint8Array(e.data.buffer, e.data.byteOffset, e.data.byteLength);
        // Keep the same layout as the .packets files: report ID first.
        const packet = new Uint8Array(data.length + (e.reportId ? 1 : 0));
        if (e.reportId) { packet[0] = e.reportId; packet.set(data, 1); } else packet.set(data);
        this.received += 1;
        if (this.verbose || this.received <= 5) {
          log(`<- report ${e.reportId} (${data.length} B) len=${packet[1]} txid=${hex(packet.subarray(2, 3), 1)} more=${packet[3]} addr=${hex(packet.subarray(4, 7), 3)} | ${hex(packet, 16)} … ${hex(packet.subarray(packet.length - 2), 2)}`);
        }
        if (this.waiter) { const w = this.waiter; this.waiter = null; w(packet); }
        else this.queue.push(packet);
      };
      device.addEventListener("inputreport", this.onReport);
      this.out = this.outputReport();
      log(`device: "${device.productName}" vendor=0x${device.vendorId.toString(16)} product=0x${device.productId.toString(16)}`);
      for (const c of device.collections || []) {
        const ids = (list) => (list || []).map((r) => `${r.reportId}:${(r.items || []).reduce((n, it) => n + it.reportSize * it.reportCount, 0) / 8}B`).join(",") || "-";
        log(`collection usagePage=0x${(c.usagePage || 0).toString(16)} usage=0x${(c.usage || 0).toString(16)} in=[${ids(c.inputReports)}] out=[${ids(c.outputReports)}] feature=[${ids(c.featureReports)}]`);
      }
      log(`output report used: id=${this.out.id}, ${this.out.length} bytes`);
    }

    /** Output report ID and payload length, as declared by the device. */
    outputReport() {
      for (const c of this.device.collections || []) {
        for (const r of c.outputReports || []) {
          const bits = (r.items || []).reduce((n, it) => n + it.reportSize * it.reportCount, 0);
          if (r.reportId === OUT_REPORT_ID || r.reportId === 0) {
            return { id: r.reportId, length: bits ? bits / 8 : REPORT_SIZE - (r.reportId ? 1 : 0) };
          }
        }
      }
      return { id: OUT_REPORT_ID, length: REPORT_SIZE - 1 };
    }

    async send(packet) {
      const { id, length } = this.out;
      const body = new Uint8Array(length);
      // With a report ID, byte 0 of the packet *is* the ID and is not sent twice.
      body.set(id ? packet.subarray(1, 1 + length) : packet.subarray(0, length));
      log(`-> report ${id} (${body.length} B) | ${hex(body, 8)}`);
      await this.device.sendReport(id, body);
    }

    next(timeoutMs) {
      if (this.queue.length) return Promise.resolve(this.queue.shift());
      return new Promise((resolve) => {
        const timer = setTimeout(() => { this.waiter = null; resolve(null); }, timeoutMs);
        this.waiter = (p) => { clearTimeout(timer); resolve(p); };
      });
    }

    drain() {
      const n = this.queue.length;
      if (n) log(`drained ${n} pending packet(s): ${this.queue.map((p) => "txid=" + hex(p.subarray(2, 3), 1) + " more=" + p[3]).join(", ")}`);
      this.queue = [];
      return n;
    }

    async request(packet) {
      this.drain();
      await this.send(packet);
      const reply = await this.next(REPLY_TIMEOUT_MS);
      if (!reply) { log("no reply within " + REPLY_TIMEOUT_MS + " ms"); throw new WatchError("timeout"); }
      return reply;
    }

    /**
     * The whole workout memory, as packets ordered by address.
     *
     * Every data packet carries its memory address (bytes 4-6, big-endian,
     * 56 bytes apart). The watch may already be streaming when the page
     * connects (a read left over from before), and it answers commands one
     * after the other, so the packets that arrive are not necessarily the
     * start of our read. They are therefore filed by address, whatever
     * stream they come from, until the memory is complete: every address
     * from 0 to the packet flagged "last". Missing pieces trigger a new
     * read request.
     */
    async readMemory(onProgress) {
      const started = Date.now();
      const byAddr = new Map();
      let lastAddr = null, ignored = 0, duplicates = 0, requests = 0;
      const needed = () => (lastAddr === null ? null : lastAddr / DATA_BYTES + 1);
      const complete = () => {
        if (lastAddr === null) return false;
        for (let a = 0; a <= lastAddr; a += DATA_BYTES) if (!byAddr.has(a)) return false;
        return true;
      };
      this.verbose = false;
      this.received = 0;
      const pending = this.queue.length;
      if (pending) log(`${pending} packet(s) already waiting before the read: kept and filed by address`);
      while (!complete() && requests < MAX_READ_REQUESTS) {
        requests += 1;
        await this.send(command(OPCODE_READ_WORKOUTS, READ_TXID, 0x05));
        log(`read request ${requests} sent (have ${byAddr.size} packets${lastAddr !== null ? ", need " + needed() : ""})`);
        while (!complete()) {
          const p = await this.next(byAddr.size ? STREAM_IDLE_MS : REPLY_TIMEOUT_MS);
          if (!p) { log(`no packet for ${byAddr.size ? STREAM_IDLE_MS : REPLY_TIMEOUT_MS} ms`); break; }
          if (p[2] !== READ_TXID || p.length < 8) {
            ignored += 1;
            log(`ignored packet not answering a read: txid=${hex(p.subarray(2, 3), 1)} | ${hex(p, 16)}`);
            continue;
          }
          const addr = (p[4] << 16) | (p[5] << 8) | p[6];
          if (byAddr.has(addr)) duplicates += 1; else byAddr.set(addr, p);
          if (p[3] === 0) {
            if (lastAddr !== null && addr !== lastAddr) log(`WARNING: two different "last" packets: ${lastAddr} and ${addr}`);
            lastAddr = Math.max(lastAddr ?? 0, addr);
          }
          if (onProgress) onProgress(byAddr.size, needed());
        }
      }
      const missing = [];
      if (lastAddr !== null) for (let a = 0; a <= lastAddr; a += DATA_BYTES) if (!byAddr.has(a)) missing.push(a);
      log(`read done: ${byAddr.size} distinct packets, ${duplicates} duplicates, ${ignored} ignored, ${requests} request(s), ` +
          `last packet at ${lastAddr === null ? "not seen" : "0x" + lastAddr.toString(16)}, ${missing.length} missing, ${Date.now() - started} ms`);
      this.verbose = true;
      if (!complete()) {
        if (missing.length) log(`missing addresses: ${missing.slice(0, 20).map((a) => "0x" + a.toString(16)).join(", ")}${missing.length > 20 ? " …" : ""}`);
        throw new WatchError(byAddr.size ? "incomplete" : "timeout");
      }
      const packets = [];
      for (let a = 0; a <= lastAddr; a += DATA_BYTES) packets.push(byAddr.get(a));
      return packets;
    }

    async close() {
      this.device.removeEventListener("inputreport", this.onReport);
      try { await this.device.close(); } catch (_) { /* already closed */ }
    }
  }

  class WatchError extends Error {
    constructor(code, cause) { super(code); this.code = code; this.cause = cause; }
  }

  function supported() { return typeof navigator !== "undefined" && "hid" in navigator; }

  /** Asks the user to pick the watch (or reuses an already-authorised one). */
  async function connect({ ask = true } = {}) {
    if (!supported()) { log("navigator.hid is not available in this browser"); throw new WatchError("unsupported"); }
    let device = null;
    const known = await navigator.hid.getDevices();
    log(`already authorised devices: ${known.length}`);
    device = known.find((d) => d.vendorId === VENDOR_ID && d.productId === PRODUCT_ID) || null;
    if (!device && ask) {
      const picked = await navigator.hid.requestDevice({ filters: [{ vendorId: VENDOR_ID, productId: PRODUCT_ID }] });
      device = picked[0] || null;
    }
    if (!device) { log("no device selected"); throw new WatchError("cancelled"); }
    try {
      if (!device.opened) await device.open();
      log("device opened");
    } catch (e) {
      log(`open failed: ${e && e.name}: ${e && e.message}`);
      throw new WatchError("open", e);
    }
    return new Watch(device);
  }

  /** Two identical reads = a reliable dump (same check as pull_raw_data_v2.py). */
  function samePackets(a, b) {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) {
      if (a[i].length !== b[i].length) return false;
      for (let k = 0; k < a[i].length; k++) if (a[i][k] !== b[i][k]) return false;
    }
    return true;
  }

  root.NikeWatch = { connect, supported, samePackets, setLogger, WatchError, VENDOR_ID, PRODUCT_ID };
})(typeof self !== "undefined" ? self : this);
