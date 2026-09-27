#!/usr/bin/env python3
"""Export every run of a Nike+ SportWatch GPS dump: GPX, TCX and speed CSV.

Pairs each GPS track (decode_gps.py) with the telemetry session written
next to it in memory (decode_telemetry.py) -- the watch clock is not
reliable enough to pair them on time -- exactly like the web app
(docs/nike-decoder.js, decodeRuns). tests/ checks that both give the same
runs and the same files.

Usage:
    python export_runs.py <dump.packets|memory.bin> [out_dir]
Writes out_dir/nike_YYYY-MM-DD_HHhMM.{gpx,tcx,csv} (UTC start time).
"""

from __future__ import annotations

import math
import os
import sys
import time

from decode_gps import load_stream
from decode_telemetry import INVALID, NO_READING, UNKNOWN, fmt_pace
from extract_blocks import find_blocks

GPS_CLASS, TELEMETRY_CLASS = 4, 2
# A telemetry session more than 4 KB away from a track belongs to another recording.
PAIRING_MAX_GAP = 4096
MARKERS = {0: "start", 1: "pause", 2: "resume", 3: "end"}


def signed8(b: int) -> int:
    return b - 256 if b > 127 else b


def usable(v) -> bool:
    return v is not None and v not in (NO_READING, INVALID, UNKNOWN) and v > 0


def decode_track(blocks):
    """[{t, lat, lon, alt, offset}] -- as decode_gps.decode_track, plus the
    memory offset of each point (needed for pairing)."""
    pts, t, lat, lon, alt16 = [], None, 0, 0, 0
    for off, cls, p in blocks:
        if cls != GPS_CLASS:
            continue
        if len(p) == 22 and p[0] & 0x80:
            t = int.from_bytes(p[2:6], "big")
            lat = int.from_bytes(p[6:10], "big", signed=True)
            lon = int.from_bytes(p[10:14], "big", signed=True)
            alt16 = int.from_bytes(p[14:16], "big", signed=True) * 16
        elif len(p) == 10 and t is not None:
            t += 1
            lat += 16 * signed8(p[2])
            lon += 16 * signed8(p[3])
            alt16 += signed8(p[4])
        else:
            continue
        pts.append({"t": t, "lat": lat / 1e7, "lon": lon / 1e7, "alt": alt16 / 16, "offset": off})
    return pts


def split_tracks(points, max_gap=600):
    out, cur = [], []
    for p in points:
        if cur and not 0 < p["t"] - cur[-1]["t"] <= max_gap:
            out.append(cur)
            cur = []
        cur.append(p)
    if cur:
        out.append(cur)
    return out


def record_size(b0: int, b1: int) -> int:
    if b0 < 0x80 or b0 in (0x80, 0x82, 0x83) or (b0, b1) == (0xFF, 0xFF):
        return 2
    if (b0 in (0xA0, 0xA2, 0xA3, 0xA4) and b1 == 0) or b0 in (0xA1, 0xA5, 0xA6):
        return 4
    if b1 == 0x03 and b0 in (0xC0, 0xC1, 0xC3, 0xC5):
        return 8
    if (b0, b1) == (0xC2, 0x0D):
        return 28
    if (b0, b1) == (0xC4, 0x2C):
        return 90
    return 2


def parse_telemetry(blocks):
    """As decode_telemetry.parse_sessions, plus the memory offset of each session."""
    data, src = bytearray(), []
    for off, cls, p in blocks:
        if cls == TELEMETRY_CLASS:
            data += p
            src += [off] * len(p)
    sessions, cur, speed, i = [], None, None, 0
    while i + 1 < len(data):
        b0, b1 = data[i], data[i + 1]
        size = record_size(b0, b1)
        if i + size > len(data):
            break
        rec, at = data[i:i + size], src[i]
        i += size
        if (b0, b1) == (0xC0, 0x03):
            kind, t = rec[3], int.from_bytes(rec[4:8], "big")
            if kind == 0:
                cur = {"markers": [], "samples": [], "calories": None, "t": t, "offset": at}
                sessions.append(cur)
                speed = None
            if cur is not None:
                cur["markers"].append((MARKERS.get(kind, f"type {kind}"), t))
        elif cur is None:
            continue
        elif b0 == 0xA0 and b1 == 0:
            speed = rec[3]
            cur["samples"].append((cur["t"], speed))
            cur["t"] += 1
        elif b0 < 0x80:
            value = (b0 << 8) | b1
            for shift in (10, 5, 0):
                if speed is not None and speed not in (NO_READING, INVALID, UNKNOWN):
                    d = (value >> shift) & 31
                    speed += d - 32 if d > 15 else d
                cur["samples"].append((cur["t"], speed))
                cur["t"] += 1
        elif b0 == 0xA2 and b1 == 0:
            cur["calories"] = int.from_bytes(rec[2:4], "big")
    return sessions


def haversine(a, b) -> float:
    r = math.pi / 180
    dlat, dlon = (b["lat"] - a["lat"]) * r, (b["lon"] - a["lon"]) * r
    h = math.sin(dlat / 2) ** 2 + math.cos(a["lat"] * r) * math.cos(b["lat"] * r) * math.sin(dlon / 2) ** 2
    return 2 * 6371008.8 * math.asin(math.sqrt(h))


def summarize(session, track):
    distance = sum(haversine(track[i - 1], track[i]) for i in range(1, len(track)))
    speeds = [v / 10 for _, v in session["samples"] if usable(v)] if session else []
    duration = None
    if session:
        ends = [t for kind, t in session["markers"] if kind == "end"]
        duration = ends[-1] - session["markers"][0][1] if ends else len(session["samples"])
    elif track:
        duration = track[-1]["t"] - track[0]["t"]
    return {
        "start": track[0]["t"] if track else session["markers"][0][1],
        "start_from_gps": bool(track),
        "duration": duration,
        "distance": distance if track else None,
        "mean_speed": sum(speeds) / len(speeds) if speeds else None,
        "calories": session["calories"] if session else None,
        "markers": session["markers"] if session else [],
        "samples": session["samples"] if session else [],
        "track": track,
        "complete": any(k == "end" for k, _ in session["markers"]) if session else None,
    }


def decode_runs(stream: bytes):
    blocks = find_blocks(stream)
    tracks = split_tracks(decode_track(blocks))
    runs = [{"session": s, "track": []} for s in parse_telemetry(blocks)]
    for tr in tracks:
        best = None
        for r in runs:
            if not r["session"] or r["track"]:
                continue
            gap = abs(r["session"]["offset"] - tr[0]["offset"])
            if best is None or gap < best[1]:
                best = (r, gap)
        if best and best[1] < PAIRING_MAX_GAP:
            best[0]["track"] = tr
        else:
            runs.append({"session": None, "track": tr})
    return sorted((summarize(r["session"], r["track"]) for r in runs), key=lambda r: r["start"])


# ── Files ─────────────────────────────────────────────────────────────────────

def fmt1(v: float) -> str:
    """One decimal, halves rounded up -- same as the JS decoder (fmt1), so
    both give identical files (altitudes are in 1/16 m: x.25 happens)."""
    return f"{math.floor(v * 10 + 0.5) / 10:.1f}"


def iso(t: int) -> str:
    return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(t))


def file_stem(run) -> str:
    return time.strftime("nike_%Y-%m-%d_%Hh%M", time.gmtime(run["start"]))


def to_gpx(run) -> str:
    name = "Nike+ SportWatch " + iso(run["start"])[:16].replace("T", " ") + " UTC"
    lines = [
        '<?xml version="1.0" encoding="UTF-8"?>',
        '<gpx version="1.1" creator="nike-sportwatch-recovery" xmlns="http://www.topografix.com/GPX/1/1">',
        f"  <trk><name>{name}</name><type>running</type><trkseg>",
    ]
    for p in run["track"]:
        lines.append(f'    <trkpt lat="{p["lat"]:.7f}" lon="{p["lon"]:.7f}"><ele>{fmt1(p["alt"])}</ele>'
                     f'<time>{iso(p["t"])}</time></trkpt>')
    lines += ["  </trkseg></trk>", "</gpx>", ""]
    return "\n".join(lines)


def to_tcx(run) -> str:
    """Garmin TCX: total distance, duration, calories and per-second speed."""
    by_second = {t: v / 10 for t, v in run["samples"] if usable(v)}
    points = []
    track = run["track"]
    if track:
        dist = 0.0
        for i, p in enumerate(track):
            if i:
                dist += haversine(track[i - 1], p)
            points.append({"t": p["t"], "lat": p["lat"], "lon": p["lon"], "alt": p["alt"], "dist": dist, "speed": None})
        offset = run["samples"][0][0] - track[0]["t"] if run["samples"] else None
        if offset is not None and abs(offset) <= 5:
            for p in points:
                p["speed"] = by_second.get(p["t"] + offset)
    else:
        dist = 0.0
        for t, v in run["samples"]:
            speed = v / 10 if usable(v) else None
            if speed:
                dist += speed
            points.append({"t": t, "lat": None, "lon": None, "alt": None, "dist": dist, "speed": speed})
    total = run["distance"] if run["distance"] is not None else (points[-1]["dist"] if points else 0.0)
    tp = []
    for p in points:
        rows = ["          <Trackpoint>", f"            <Time>{iso(p['t'])}</Time>"]
        if p["lat"] is not None:
            rows.append(f"            <Position><LatitudeDegrees>{p['lat']:.7f}</LatitudeDegrees>"
                        f"<LongitudeDegrees>{p['lon']:.7f}</LongitudeDegrees></Position>")
        if p["alt"] is not None:
            rows.append(f"            <AltitudeMeters>{fmt1(p['alt'])}</AltitudeMeters>")
        rows.append(f"            <DistanceMeters>{fmt1(p['dist'])}</DistanceMeters>")
        if p["speed"] is not None:
            rows.append('            <Extensions><TPX xmlns="http://www.garmin.com/xmlschemas/ActivityExtension/v2">'
                        f"<Speed>{fmt1(p['speed'])}</Speed></TPX></Extensions>")
        rows.append("          </Trackpoint>")
        tp.append("\n".join(rows))
    return "\n".join([
        '<?xml version="1.0" encoding="UTF-8"?>',
        '<TrainingCenterDatabase xmlns="http://www.garmin.com/xmlschemas/TrainingCenterDatabase/v2" '
        'xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" '
        'xsi:schemaLocation="http://www.garmin.com/xmlschemas/TrainingCenterDatabase/v2 '
        'http://www.garmin.com/xmlschemas/TrainingCenterDatabasev2.xsd">',
        "  <Activities>",
        '    <Activity Sport="Running">',
        f"      <Id>{iso(run['start'])}</Id>",
        f'      <Lap StartTime="{iso(run["start"])}">',
        f"        <TotalTimeSeconds>{fmt1(run['duration'] or 0)}</TotalTimeSeconds>",
        f"        <DistanceMeters>{fmt1(total)}</DistanceMeters>",
        f"        <Calories>{run['calories'] if run['calories'] is not None else 0}</Calories>",
        "        <Intensity>Active</Intensity>",
        "        <TriggerMethod>Manual</TriggerMethod>",
        "        <Track>",
        *tp,
        "        </Track>",
        "      </Lap>",
        "      <Notes>Recovered from a Nike+ SportWatch GPS</Notes>",
        "    </Activity>",
        "  </Activities>",
        "</TrainingCenterDatabase>",
        "",
    ])


def to_csv(run) -> str:
    lines = ["time_utc,speed_m_s,pace_min_km"]
    for t, v in run["samples"]:
        ok = usable(v)
        lines.append(f"{iso(t)},{fmt1(v / 10) if ok else ''},{fmt_pace(v / 10) if ok else ''}")
    return "\n".join(lines) + "\n"


def main() -> None:
    if not 2 <= len(sys.argv) <= 3:
        print(f"Usage: {sys.argv[0]} <dump.packets|memory.bin> [out_dir]")
        sys.exit(1)
    out = sys.argv[2] if len(sys.argv) == 3 else "runs"
    runs = decode_runs(load_stream(sys.argv[1]))
    if not runs:
        print("No run found.")
        return
    os.makedirs(out, exist_ok=True)
    for r in runs:
        stem = os.path.join(out, file_stem(r))
        written = []
        if r["track"]:
            open(stem + ".gpx", "w", encoding="utf-8").write(to_gpx(r))
            written.append("gpx")
        if r["track"] or r["samples"]:
            open(stem + ".tcx", "w", encoding="utf-8").write(to_tcx(r))
            written.append("tcx")
        if r["samples"]:
            open(stem + ".csv", "w", encoding="utf-8").write(to_csv(r))
            written.append("csv")
        dist = f"{r['distance'] / 1000:.2f} km" if r["distance"] is not None else "no GPS"
        dur = f"{r['duration'] // 60} min" if r["duration"] is not None else "?"
        print(f"{iso(r['start'])}  {dur:>7}  {dist:>9}  calories {r['calories'] if r['calories'] is not None else '-'}"
              f"  -> {stem}.{{{','.join(written)}}}")


if __name__ == "__main__":
    main()
