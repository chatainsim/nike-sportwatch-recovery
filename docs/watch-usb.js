/*
 * Talking to the Nike+ SportWatch GPS from the browser, with WebHID
 * (Chrome, Edge, and other Chromium browsers on desktop).
 *
 * Same method as pull_raw_data_v2.py, validated on real hardware: drain
 * pending reports, send ONE read-workouts request, then collect everything
 * the watch streams until it signals the last packet or goes quiet.
 * Read-only: only the version (0x08) and read-workouts (0x10) commands are
 * ever sent.
 */
(function (root) {
  "use strict";

  const VENDOR_ID = 0x11ac;
  const PRODUCT_ID = 0x5455;
  const REPORT_SIZE = 64;
  const OUT_REPORT_ID = 0x09;
  const OPCODE_VERSION = 0x08;
  const OPCODE_READ_WORKOUTS = 0x10;
  const REPLY_TIMEOUT_MS = 3000;
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

    async version() {
      const r = await this.request(command(OPCODE_VERSION, 0x29));
      return String.fromCharCode(r[3]) + (r[4] | (r[5] << 8));
    }

    /** All workout packets, streamed after a single request. */
    async readWorkouts(onProgress) {
      // Late replies to an earlier command can still arrive: let them come in
      // and drop them, and below only keep packets answering this request.
      await new Promise((r) => setTimeout(r, 500));
      this.drain();
      const started = Date.now();
      this.verbose = false;
      this.received = 0;
      await this.send(command(OPCODE_READ_WORKOUTS, READ_TXID, 0x05));
      const packets = [];
      let ignored = 0, stop = "idle";
      while (packets.length < MAX_PACKETS) {
        const p = await this.next(packets.length ? STREAM_IDLE_MS : REPLY_TIMEOUT_MS);
        if (!p) break;
        if (p[2] !== READ_TXID) {
          ignored += 1;
          log(`ignored packet not answering the read: txid=${hex(p.subarray(2, 3), 1)} more=${p[3]} | ${hex(p, 16)}`);
          continue;
        }
        packets.push(p);
        if (onProgress) onProgress(packets.length);
        if (p[3] === 0) { stop = "last-packet flag"; break; }
      }
      const bytes = packets.reduce((n, p) => n + Math.max(0, (p[1] || 0) - 5), 0);
      const last = packets[packets.length - 1];
      log(`read done: ${packets.length} packets (~${bytes} data bytes), ${ignored} ignored, stopped on ${packets.length >= MAX_PACKETS ? "size cap" : stop}, ${Date.now() - started} ms` +
          (last ? `, last addr=${hex(last.subarray(4, 7), 3)}` : ""));
      this.verbose = true;
      if (!packets.length) throw new WatchError("timeout");
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
