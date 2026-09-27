#!/usr/bin/env python3
"""Erase the runs stored on a Nike+ SportWatch GPS -- after backing them up.

This is what Nike+ Connect did after every sync (command 0x11 "eeprom-erase",
"Erase all workout storage data"), without the software. It frees the
watch memory so it can record new runs once it is full.

Safety first, in this order:

  1. The memory is read twice ("stream" mode, as pull_raw_data_v2.py). If
     the two reads differ, nothing is erased.
  2. The backup is written to disk: the raw .packets file, plus a GPX and a
     speed CSV per run (decode_gps.py / decode_telemetry.py). The runs about
     to be erased are listed.
  3. You must type ERASE to confirm.
  4. The erase command is sent once. Its 16-bit "magic" guard value, EE 86,
     comes from the comsport/nikePlus-SportWatchGPS C++ code, whose author
     captured it from real Nike+ Connect traffic (it does not appear as a
     constant in the Nike binaries); confirmed on a real watch in September
     2026. That C++ code also sent a second, magic-less 0x11 packet whose
     purpose is unknown: it is not sent.
  5. The memory is read again: success is only reported if no run is left.

Usage:
    python erase_watch.py

Requires: pip install hidapi
"""

from __future__ import annotations

import os
import sys
import time

from decode_gps import decode_track, split_sessions, to_gpx
from decode_telemetry import fmt_pace, parse_sessions, usable, write_csv
from extract_blocks import find_blocks
from pull_raw_data_v2 import (
    OPCODE_VERSION,
    READ_LEN,
    command,
    drain,
    open_watch,
    payload_stream,
    read_stream_mode,
    request,
    save_packets,
)

OPCODE_EEPROM_ERASE = 0x11
ERASE_TXID = 0x45
ERASE_MAGIC = (0xEE, 0x86)
# Nike+ Connect allowed 20 s for the erase; it took ~12 s in the 2014 paper.
ERASE_TIMEOUT_MS = 20000
CONFIRM_WORD = "ERASE"


def erase_command() -> bytes:
    # [09][len=4: txid, opcode, 2 magic bytes][txid][0x11][magic hi][magic lo]
    packet = bytearray(command(OPCODE_EEPROM_ERASE, ERASE_TXID, byte1=0x04))
    packet[4], packet[5] = ERASE_MAGIC
    return bytes(packet)


def has_runs(stream: bytes) -> bool:
    """Workout data = telemetry (class 2) or GPS (class 4) blocks. An erased
    watch only returns a device-info block (class 1)."""
    return any(cls in (2, 4) for _, cls, _ in find_blocks(stream))


def read_twice(dev) -> list[bytes] | None:
    reads = []
    for n in (1, 2):
        print(f"  read {n}/2...")
        reads.append(read_stream_mode(dev))
        time.sleep(1)
    if reads[0] != reads[1]:
        return None
    return reads[0]


def backup(packets: list[bytes], stream: bytes, folder: str) -> list[str]:
    """Writes the raw packets, GPX and CSV files; returns a line per run."""
    os.makedirs(folder, exist_ok=True)
    save_packets(os.path.join(folder, "watch.packets"), packets)
    lines = []
    for pts in split_sessions(decode_track(stream)):
        start = time.strftime("%Y-%m-%d_%Hh%M", time.gmtime(pts[0][0]))
        with open(os.path.join(folder, f"nike_{start}.gpx"), "w", encoding="utf-8") as f:
            f.write(to_gpx([pts]))
        lines.append(f"GPS track {time.strftime('%Y-%m-%d %H:%M', time.gmtime(pts[0][0]))} UTC, "
                     f"{pts[-1][0] - pts[0][0]} s")
    for n, s in enumerate(parse_sessions(stream), start=1):
        speeds = [v / 10 for _, v in s["samples"] if usable(v)]
        mean = sum(speeds) / len(speeds) if speeds else 0
        write_csv(s, os.path.join(folder, f"telemetry_session{n}.csv"))
        lines.append(f"recording {time.strftime('%Y-%m-%d %H:%M', time.gmtime(s['markers'][0][1]))} "
                     f"(watch clock), {len(s['samples'])} s, pace {fmt_pace(mean) or '-'} /km, "
                     f"calories {s['calories'] if s['calories'] is not None else '-'}")
    return lines


def main() -> None:
    print("Connecting to the watch...")
    try:
        dev = open_watch()
    except OSError as e:
        print(f"Cannot open the watch: {e}")
        print("Check that it sits on its dock and that the dock is plugged in over USB.")
        sys.exit(1)

    try:
        request(dev, command(OPCODE_VERSION, 0x29))

        print("\nStep 1/4 - backup: reading the watch memory twice...")
        packets = read_twice(dev)
        if packets is None:
            print("The two reads differ: NOTHING WAS ERASED. Try again later.")
            sys.exit(1)
        stream = payload_stream(packets)
        if not has_runs(stream):
            print("The watch memory holds no run: nothing to erase.")
            return

        folder = time.strftime("backup_%Y-%m-%d_%H-%M-%S")
        lines = backup(packets, stream, folder)
        print(f"\nStep 2/4 - backup written to {os.path.abspath(folder)}/")
        for line in lines:
            print(f"  - {line}")
        print("  Check that the backup opens (e.g. a GPX in a map viewer) before going on.")

        print("\nStep 3/4 - confirmation")
        print("  This ERASES ALL RUNS stored on the watch. It cannot be undone.")
        answer = input(f"  Type {CONFIRM_WORD} to erase, anything else to cancel: ").strip()
        if answer != CONFIRM_WORD:
            print("Cancelled: nothing was erased.")
            return

        print("\nStep 4/4 - erasing (this can take up to 20 seconds)...")
        drain(dev)
        dev.write(erase_command())
        reply = dev.read(READ_LEN, timeout_ms=ERASE_TIMEOUT_MS)
        print(f"  watch reply: {bytes(reply).hex(' ') if reply else '(none)'}")
        time.sleep(2)

        print("  checking: reading the watch memory again...")
        after = payload_stream(read_stream_mode(dev))
        if has_runs(after):
            print("\nThe watch still holds runs: it did NOT erase its memory.")
            print("Your runs are intact, on the watch and in the backup.")
            print("Please open an issue on GitHub with the output above.")
            sys.exit(1)
        print("\nDone: the watch memory is empty. Your runs are in", os.path.abspath(folder))
    finally:
        dev.close()


if __name__ == "__main__":
    main()
