/*
 * Nike+ SportWatch GPS decoders, in the browser (and Node, for tests).
 * JavaScript port of decode_gps.py, decode_telemetry.py and extract_blocks.py:
 * see those files and README.md for the format and how it was validated.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.NikeDecoder = api;
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  // ── Packets and blocks ─────────────────────────────────────────────────────

  const HEADER = 7; // [01][len][txid][more][addr x3]

  /** Data carried by one 64-byte response: bytes 7 .. 2+len. */
  function packetPayload(p) {
    const len = p.length > 1 ? p[1] : 0;
    if (len >= HEADER - 2 && len <= p.length - 3) return p.subarray(HEADER, 2 + len);
    return p.subarray(HEADER, p.length - 1);
  }

  function payloadStream(packets) {
    const parts = packets.filter((p) => p.length > HEADER).map(packetPayload);
    const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
    let o = 0;
    for (const p of parts) { out.set(p, o); o += p.length; }
    return out;
  }

  /** .packets file (pull_raw_data_v2.py): uint16 LE length + bytes, repeated. */
  function parsePacketsFile(buf) {
    const b = new Uint8Array(buf);
    const packets = [];
    let pos = 0;
    while (pos + 2 <= b.length) {
      const len = b[pos] | (b[pos + 1] << 8);
      packets.push(b.subarray(pos + 2, pos + 2 + len));
      pos += 2 + len;
    }
    return packets;
  }

  function serializePackets(packets) {
    const out = new Uint8Array(packets.reduce((n, p) => n + 2 + p.length, 0));
    let o = 0;
    for (const p of packets) {
      out[o] = p.length & 0xff; out[o + 1] = p.length >> 8;
      out.set(p, o + 2); o += 2 + p.length;
    }
    return out;
  }

  const CRC_TABLE = (() => {
    const t = new Uint16Array(256);
    for (let i = 0; i < 256; i++) {
      let c = i << 8;
      for (let k = 0; k < 8; k++) c = c & 0x8000 ? ((c << 1) ^ 0x1021) & 0xffff : (c << 1) & 0xffff;
      t[i] = c;
    }
    return t;
  })();

  function crc16(data, start, end) {
    let c = 0xffff;
    for (let i = start; i < end; i++) c = ((c << 8) & 0xffff) ^ CRC_TABLE[(c >> 8) ^ data[i]];
    return c;
  }

  /**
   * [class:1][len/2:1][payload][crc16:2], valid when the CRC-16/CCITT-FALSE
   * over the whole block (CRC included) is zero. Non-overlapping, earliest first.
   */
  function findBlocks(data) {
    const blocks = [];
    let end = 0;
    for (let pos = 0; pos < data.length - 6; pos++) {
      if (pos < end) continue;
      const len = data[pos + 1] * 2;
      if (len === 0 || pos + len + 4 > data.length) continue;
      if (crc16(data, pos, pos + len + 4) === 0) {
        blocks.push({ offset: pos, cls: data[pos], payload: data.subarray(pos + 2, pos + 2 + len) });
        end = pos + len + 4;
      }
    }
    return blocks;
  }

  // ── GPS (class 4) ──────────────────────────────────────────────────────────

  const s8 = (b) => (b > 127 ? b - 256 : b);
  const u32 = (p, i) => ((p[i] << 24) >>> 0) + (p[i + 1] << 16) + (p[i + 2] << 8) + p[i + 3];
  const i32 = (p, i) => (p[i] << 24) | (p[i + 1] << 16) | (p[i + 2] << 8) | p[i + 3];
  const i16 = (p, i) => { const v = (p[i] << 8) | p[i + 1]; return v > 32767 ? v - 65536 : v; };

  /** [{t, lat, lon, alt, offset}], one point per second. */
  function decodeTrack(blocks) {
    const pts = [];
    let t = null, lat = 0, lon = 0, alt16 = 0;
    for (const b of blocks) {
      if (b.cls !== 4) continue;
      const p = b.payload;
      if (p.length === 22 && p[0] & 0x80) {
        t = u32(p, 2); lat = i32(p, 6); lon = i32(p, 10); alt16 = i16(p, 14) * 16;
      } else if (p.length === 10 && t !== null) {
        t += 1; lat += 16 * s8(p[2]); lon += 16 * s8(p[3]); alt16 += s8(p[4]);
      } else continue;
      pts.push({ t, lat: lat / 1e7, lon: lon / 1e7, alt: alt16 / 16, offset: b.offset });
    }
    return pts;
  }

  function splitTracks(points, maxGap = 600) {
    const out = [];
    let cur = [];
    for (const p of points) {
      if (cur.length) {
        const dt = p.t - cur[cur.length - 1].t;
        if (!(dt > 0 && dt <= maxGap)) { out.push(cur); cur = []; }
      }
      cur.push(p);
    }
    if (cur.length) out.push(cur);
    return out;
  }

  // ── Telemetry (class 2) ────────────────────────────────────────────────────

  const NO_READING = 0x00, INVALID = 0xfe, UNKNOWN = 0xff;
  const MARKERS = { 0: "start", 1: "pause", 2: "resume", 3: "end" };

  function recordSize(b0, b1) {
    if (b0 < 0x80 || b0 === 0x80 || b0 === 0x82 || b0 === 0x83 || (b0 === 0xff && b1 === 0xff)) return 2;
    if (([0xa0, 0xa2, 0xa3, 0xa4].includes(b0) && b1 === 0) || [0xa1, 0xa5, 0xa6].includes(b0)) return 4;
    if (b1 === 0x03 && [0xc0, 0xc1, 0xc3, 0xc5].includes(b0)) return 8;
    if (b0 === 0xc2 && b1 === 0x0d) return 28;
    if (b0 === 0xc4 && b1 === 0x2c) return 90;
    return 2;
  }

  /** Telemetry sessions: {markers:[{kind,t}], samples:[{t, speed}], calories, offset}. */
  function parseTelemetry(blocks) {
    const parts = blocks.filter((b) => b.cls === 2);
    const bytes = [], srcOffset = [];
    for (const b of parts) for (let i = 0; i < b.payload.length; i++) { bytes.push(b.payload[i]); srcOffset.push(b.offset); }
    const sessions = [];
    let cur = null, speed = null, i = 0;
    while (i + 1 < bytes.length) {
      const b0 = bytes[i], b1 = bytes[i + 1], size = recordSize(b0, b1);
      if (i + size > bytes.length) break;
      const rec = bytes.slice(i, i + size), at = srcOffset[i];
      i += size;
      if (b0 === 0xc0 && b1 === 0x03) {
        const kind = rec[3], t = u32(rec, 4);
        if (kind === 0) {
          cur = { markers: [], samples: [], calories: null, t, offset: at };
          sessions.push(cur);
          speed = null;
        }
        if (cur) cur.markers.push({ kind: MARKERS[kind] || "type " + kind, t });
      } else if (!cur) {
        continue;
      } else if (b0 === 0xa0 && b1 === 0) {
        speed = rec[3];
        cur.samples.push({ t: cur.t++, speed });
      } else if (b0 < 0x80) {
        const v = (b0 << 8) | b1;
        for (const shift of [10, 5, 0]) {
          if (speed !== null && speed !== NO_READING && speed !== INVALID && speed !== UNKNOWN) {
            const d = (v >> shift) & 31;
            speed += d > 15 ? d - 32 : d;
          }
          cur.samples.push({ t: cur.t++, speed });
        }
      } else if (b0 === 0xa2 && b1 === 0) {
        cur.calories = (rec[2] << 8) | rec[3];
      }
    }
    return sessions;
  }

  const usableSpeed = (v) => v !== null && v !== NO_READING && v !== INVALID && v !== UNKNOWN && v > 0;

  // ── Runs: telemetry + GPS track ────────────────────────────────────────────

  function haversine(a, b) {
    const R = 6371008.8, r = Math.PI / 180;
    const dLat = (b.lat - a.lat) * r, dLon = (b.lon - a.lon) * r;
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(dLon / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(h));
  }

  /**
   * One entry per recording. Each GPS track is paired with the telemetry
   * session written closest to it in memory (the watch writes both side by
   * side; its clock is not reliable enough to match on time). Tracks without
   * telemetry and sessions without GPS are kept too.
   */
  function decodeRuns(stream) {
    const blocks = findBlocks(stream);
    const tracks = splitTracks(decodeTrack(blocks));
    const runs = parseTelemetry(blocks).map((s) => ({ session: s, track: [] }));
    for (const tr of tracks) {
      let best = null;
      for (const r of runs) {
        if (!r.session || r.track.length) continue;
        const gap = Math.abs(r.session.offset - tr[0].offset);
        if (!best || gap < best.gap) best = { run: r, gap };
      }
      // A session more than 4 KB away belongs to another recording.
      if (best && best.gap < 4096) best.run.track = tr;
      else runs.push({ session: null, track: tr });
    }
    return runs.map(summarize).sort((a, b) => a.start - b.start);
  }

  function summarize({ session, track }) {
    let distance = 0;
    for (let i = 1; i < track.length; i++) distance += haversine(track[i - 1], track[i]);
    const speeds = session ? session.samples.filter((s) => usableSpeed(s.speed)).map((s) => s.speed / 10) : [];
    const meanSpeed = speeds.length ? speeds.reduce((a, b) => a + b, 0) / speeds.length : null;
    let duration = null;
    if (session) {
      const ends = session.markers.filter((m) => m.kind === "end");
      duration = ends.length ? ends[ends.length - 1].t - session.markers[0].t : session.samples.length;
    } else if (track.length) {
      duration = track[track.length - 1].t - track[0].t;
    }
    // GPS time is the trustworthy one; the watch clock can drift by hours.
    const start = track.length ? track[0].t : session.markers[0].t;
    return {
      start,
      startFromGps: track.length > 0,
      duration,
      distance: track.length ? distance : null,
      meanSpeed,
      calories: session ? session.calories : null,
      markers: session ? session.markers : [],
      samples: session ? session.samples : [],
      track,
      complete: session ? session.markers.some((m) => m.kind === "end") : null,
    };
  }

  // ── Exports ────────────────────────────────────────────────────────────────

  const iso = (t) => new Date(t * 1000).toISOString().replace(/\.\d{3}Z$/, "Z");

  function toGpx(run) {
    const name = "Nike+ SportWatch " + iso(run.start).slice(0, 16).replace("T", " ") + " UTC";
    const pts = run.track.map((p) =>
      `    <trkpt lat="${p.lat.toFixed(7)}" lon="${p.lon.toFixed(7)}"><ele>${p.alt.toFixed(1)}</ele><time>${iso(p.t)}</time></trkpt>`);
    return [
      '<?xml version="1.0" encoding="UTF-8"?>',
      '<gpx version="1.1" creator="nike-sportwatch-recovery" xmlns="http://www.topografix.com/GPX/1/1">',
      `  <trk><name>${name}</name><type>running</type><trkseg>`,
      ...pts,
      "  </trkseg></trk>",
      "</gpx>",
      "",
    ].join("\n");
  }

  function paceString(speed) {
    if (!speed || speed <= 0) return "";
    const s = 1000 / speed;
    return `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;
  }

  function toCsv(run) {
    const lines = ["time_utc,speed_m_s,pace_min_km"];
    for (const s of run.samples) {
      const ok = usableSpeed(s.speed);
      lines.push(`${iso(s.t)},${ok ? (s.speed / 10).toFixed(1) : ""},${ok ? paceString(s.speed / 10) : ""}`);
    }
    return lines.join("\n") + "\n";
  }

  function fileStem(run) {
    const d = new Date(run.start * 1000).toISOString();
    return `nike_${d.slice(0, 10)}_${d.slice(11, 13)}h${d.slice(14, 16)}`;
  }

  return {
    packetPayload, payloadStream, parsePacketsFile, serializePackets,
    crc16, findBlocks, decodeTrack, splitTracks, parseTelemetry, decodeRuns,
    toGpx, toCsv, fileStem, paceString, haversine,
  };
});
