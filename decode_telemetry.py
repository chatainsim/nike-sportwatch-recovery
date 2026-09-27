#!/usr/bin/env python3
"""Decode the workout telemetry of a Nike+ SportWatch GPS dump.

Telemetry lives in class-2 CRC blocks (see extract_blocks.py): concatenated,
their payloads form a stream of records whose sizes come from the official
opcode table (extracted from SportWatchPlugin.dll of Nike+ Connect):

  a0 00 c0 vv   speed sample, absolute: vv in 0.1 m/s (0 = no reading,
                0xfe = invalid/saturated, 0xff = unknown)
  0x00-0x7f     2 bytes, three speed deltas of 5 bits each (signed, in
                reading order), one per second -- "PaceRelative3"
  c0 03 00 tt   workout marker + Unix time (u32 BE): tt = 0 start, 1 pause,
                2 resume, 3 end -- watch clock, can be wrong
  a2 00 kk kk   calories (u16 BE, kcal), written at the end
  c5/c4/a3/a5/83/80...  session info, GPS status, id, firmware, rare
                distance catch-ups -- skipped

One speed sample per second: on a 791 s reference recording, 527 absolute
samples + 3 x 88 relative records = 791 samples, and the values follow the
GPS speed (e.g. deltas +3 +2 +2 from 114 give 117 119 121 against 113 117
121 from the GPS). Heart-rate and foot-pod records exist in the opcode table
but were not present in the recordings used here, so they are not decoded.

Usage:
    python decode_telemetry.py <dump.packets|memory.bin> [out_prefix]
Writes <out_prefix>_session<N>.csv (time, speed, pace) and prints a summary.
"""

import csv
import struct
import sys
from datetime import datetime, timezone

from decode_gps import load_stream
from extract_blocks import find_blocks

TELEMETRY_CLASS = 2
NO_READING, INVALID, UNKNOWN = 0x00, 0xFE, 0xFF
MARKERS = {0: "start", 1: "pause", 2: "resume", 3: "end"}


def record_size(b0: int, b1: int) -> int:
    """Record length from its first two bytes (official opcode table)."""
    if b0 < 0x80 or b0 in (0x80, 0x82, 0x83) or (b0, b1) == (0xFF, 0xFF):
        return 2
    if b0 in (0xA0, 0xA2, 0xA3, 0xA4) and b1 == 0x00 or b0 in (0xA1, 0xA5, 0xA6):
        return 4
    if (b0, b1) in ((0xC0, 0x03), (0xC1, 0x03), (0xC3, 0x03), (0xC5, 0x03)):
        return 8
    if (b0, b1) == (0xC2, 0x0D):
        return 28
    if (b0, b1) == (0xC4, 0x2C):
        return 90
    return 2  # unknown: skip conservatively


def signed5(x: int) -> int:
    return x - 32 if x > 15 else x


def parse_sessions(stream: bytes) -> list[dict]:
    telemetry = b"".join(p for _, cls, p in find_blocks(stream) if cls == TELEMETRY_CLASS)
    sessions, cur = [], None
    speed = None
    i = 0
    while i + 1 < len(telemetry):
        b0, b1 = telemetry[i], telemetry[i + 1]
        size = record_size(b0, b1)
        rec = telemetry[i:i + size]
        i += size
        if len(rec) < size:
            break
        if (b0, b1) == (0xC0, 0x03):
            kind, t = rec[3], struct.unpack(">I", rec[4:8])[0]
            if kind == 0:
                cur = {"markers": [], "samples": [], "calories": None, "t": t}
                sessions.append(cur)
                speed = None
            if cur is not None:
                cur["markers"].append((MARKERS.get(kind, f"type {kind}"), t))
        elif cur is None:
            continue
        elif b0 == 0xA0 and b1 == 0x00:
            speed = rec[3]
            cur["samples"].append((cur["t"], speed))
            cur["t"] += 1
        elif b0 < 0x80:
            value = (b0 << 8) | b1
            for shift in (10, 5, 0):
                if speed is not None and speed not in (NO_READING, INVALID, UNKNOWN):
                    speed += signed5((value >> shift) & 31)
                cur["samples"].append((cur["t"], speed))
                cur["t"] += 1
        elif b0 == 0xA2 and b1 == 0x00:
            cur["calories"] = struct.unpack(">H", rec[2:4])[0]
    return sessions


def usable(v) -> bool:
    return v is not None and v not in (NO_READING, INVALID, UNKNOWN) and v > 0


def fmt_pace(speed_ms: float) -> str:
    if speed_ms <= 0:
        return ""
    s = 1000 / speed_ms
    return f"{int(s // 60)}:{int(s % 60):02d}"


def write_csv(session: dict, path: str) -> None:
    """Per-second speed and pace of one recording."""
    with open(path, "w", newline="", encoding="utf-8") as f:
        w = csv.writer(f)
        w.writerow(["time_utc", "speed_m_s", "pace_min_km"])
        for t, v in session["samples"]:
            ok = usable(v)
            w.writerow([datetime.fromtimestamp(t, timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
                        f"{v / 10:.1f}" if ok else "", fmt_pace(v / 10) if ok else ""])


def main() -> None:
    if not 2 <= len(sys.argv) <= 3:
        print(f"Usage: {sys.argv[0]} <dump.packets|memory.bin> [out_prefix]")
        sys.exit(1)
    sessions = parse_sessions(load_stream(sys.argv[1]))
    prefix = sys.argv[2] if len(sys.argv) == 3 else sys.argv[1].rsplit(".", 1)[0]
    if not sessions:
        print("No recording found.")
        return
    for n, s in enumerate(sessions, start=1):
        start = datetime.fromtimestamp(s["markers"][0][1], timezone.utc)
        ends = [t for kind, t in s["markers"] if kind == "end"]
        duration = (ends[-1] - s["markers"][0][1]) if ends else len(s["samples"])
        speeds = [v / 10 for _, v in s["samples"] if usable(v)]
        mean = sum(speeds) / len(speeds) if speeds else 0
        print(f"Recording {n}: {start:%Y-%m-%d %H:%M:%S} UTC (watch clock)")
        print(f"  duration {duration // 60} min {duration % 60:02d} s, "
              f"{len(s['samples'])} speed samples, "
              f"calories: {s['calories'] if s['calories'] is not None else 'not recorded'}")
        print(f"  average speed {mean:.2f} m/s (pace {fmt_pace(mean)} /km)" if speeds else "  no speed data")
        print("  markers: " + ", ".join(
            f"{kind} {datetime.fromtimestamp(t, timezone.utc):%H:%M:%S}" for kind, t in s["markers"]))
        path = f"{prefix}_session{n}.csv"
        write_csv(s, path)
        print(f"  -> {path}")


if __name__ == "__main__":
    main()
