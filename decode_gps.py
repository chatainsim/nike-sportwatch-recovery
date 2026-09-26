#!/usr/bin/env python3
"""Decode the GPS track of a Nike+ SportWatch GPS dump into a GPX file.

Format, solved on 2026-09-26 with a clean pull_raw_data_v2.py read of a
13-minute trip recorded alongside an Amazfit (see README.md). GPS data lives
in class-4 CRC blocks (see extract_blocks.py), one record per second:

  22-byte payload, flags 82 04 -- absolute fix
      [82 04][time u32][lat i32][lon i32][alt i16][? u16][b18][b19][b20][b21]
      time: Unix seconds; lat/lon: degrees x 1e7; alt: metres. Big-endian.
  10-byte payload, flags 02 04 / 00 04 -- one-second step from the previous record
      [flags 2][dlat i8][dlon i8][dalt i8][b5][b6][b7][b8][b9]
      dlat/dlon in units of 16e-7 degree, dalt in 1/16 m.

The watch writes an absolute fix whenever a step no longer fits in a signed
byte (fast movement: 127 x 16e-7 deg is ~22 m/s northward), plus periodically.
Checked against the next fix: integrating the steps (one step more than the
number of 10-byte records, the last step repeating into the fix's second)
lands within 0-3 m of it, even after 240 s of steps.

Bytes b18-b21 / b5-b9 (speed? satellite quality?) are not decoded yet and
are not needed for the track.

Usage:
    python decode_gps.py nike_v2_stream_1_<ts>.packets [out.gpx | out_dir/]
With a directory (trailing slash), writes one GPX per session, named by its
start date: out_dir/nike_YYYY-MM-DD_HHhMM.gpx (UTC).
"""

import os
import struct
import sys
from datetime import datetime, timezone

from extract_blocks import find_blocks

GPS_CLASS = 4
FIX_LEN = 22
STEP_LEN = 10
STEP_SCALE = 16          # 10-byte step unit, in 1e-7 degree
ALT_STEP_SCALE = 16      # 10-byte altitude step unit, in 1/x metre


def signed8(b: int) -> int:
    return b - 256 if b > 127 else b


def load_stream(path: str) -> bytes:
    """Data stream of a .packets file (v2) or a raw .bin dump."""
    if path.endswith(".packets"):
        from pull_raw_data_v2 import load_packets, payload_stream

        return payload_stream(load_packets(path))
    return open(path, "rb").read()


def decode_track(stream: bytes) -> list[tuple[int, float, float, float]]:
    """Returns [(unix_time, lat, lon, alt_m), ...], one point per second.

    Steps before the first absolute fix have no anchor and are skipped.
    """
    points = []
    t = lat = lon = None
    alt16 = 0
    for _, cls, payload in find_blocks(stream):
        if cls != GPS_CLASS:
            continue
        if len(payload) == FIX_LEN and payload[0] & 0x80:
            t, lat, lon, alt = struct.unpack_from(">Iiih", payload, 2)
            alt16 = alt * ALT_STEP_SCALE
        elif len(payload) == STEP_LEN and t is not None:
            t += 1
            lat += STEP_SCALE * signed8(payload[2])
            lon += STEP_SCALE * signed8(payload[3])
            alt16 += signed8(payload[4])
        else:
            continue
        points.append((t, lat / 1e7, lon / 1e7, alt16 / ALT_STEP_SCALE))
    return points


def split_sessions(points, max_gap_s: int = 600):
    """Splits the track where the clock jumps (separate recordings)."""
    sessions, current = [], []
    for p in points:
        if current and not 0 < p[0] - current[-1][0] <= max_gap_s:
            sessions.append(current)
            current = []
        current.append(p)
    if current:
        sessions.append(current)
    return sessions


def to_gpx(sessions) -> str:
    out = [
        '<?xml version="1.0" encoding="UTF-8"?>',
        '<gpx version="1.1" creator="nike-sportwatch-recovery decode_gps.py" '
        'xmlns="http://www.topografix.com/GPX/1/1">',
    ]
    for i, pts in enumerate(sessions, start=1):
        start = datetime.fromtimestamp(pts[0][0], timezone.utc)
        out.append(f"  <trk><name>Nike+ SportWatch {start:%Y-%m-%d %H:%M} UTC (#{i})</name><trkseg>")
        for t, lat, lon, alt in pts:
            ts = datetime.fromtimestamp(t, timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
            out.append(f'    <trkpt lat="{lat:.7f}" lon="{lon:.7f}"><ele>{alt:.1f}</ele><time>{ts}</time></trkpt>')
        out.append("  </trkseg></trk>")
    out.append("</gpx>")
    return "\n".join(out) + "\n"


def main() -> None:
    if not 2 <= len(sys.argv) <= 3:
        print(f"Usage: {sys.argv[0]} <dump.packets|dump.bin> [out.gpx | out_dir/]")
        sys.exit(1)
    points = decode_track(load_stream(sys.argv[1]))
    if not points:
        print("No GPS point decoded.")
        sys.exit(1)
    sessions = split_sessions(points)
    out = sys.argv[2] if len(sys.argv) == 3 else sys.argv[1].rsplit(".", 1)[0] + ".gpx"
    if out.endswith(("/", os.sep)) or os.path.isdir(out):
        os.makedirs(out, exist_ok=True)
        targets = []
        for pts in sessions:
            start = datetime.fromtimestamp(pts[0][0], timezone.utc)
            targets.append((os.path.join(out, f"nike_{start:%Y-%m-%d_%Hh%M}.gpx"), [pts]))
    else:
        targets = [(out, sessions)]
    for path, group in targets:
        with open(path, "w", encoding="utf-8") as f:
            f.write(to_gpx(group))
    for i, pts in enumerate(sessions, start=1):
        start = datetime.fromtimestamp(pts[0][0], timezone.utc)
        print(f"Recording {i}: {start:%Y-%m-%d %H:%M:%S} UTC, {len(pts)} points, "
              f"{pts[-1][0] - pts[0][0]} s")
    for path, _ in targets:
        print(f"GPX written: {path}")


if __name__ == "__main__":
    main()
