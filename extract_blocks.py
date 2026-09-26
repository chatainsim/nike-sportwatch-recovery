#!/usr/bin/env python3
"""Split a raw dump into its CRC-validated blocks.

The raw workout blob is a container of blocks, each laid out as:

    [class:1][len/2:1][payload: len bytes][crc16:2]        (total len+4)

A block is valid when CRC-16/CCITT-FALSE (poly 0x1021, init 0xFFFF) over
the whole block *including its own CRC bytes* comes out to zero. That test
is what makes this reliable: it pins block boundaries exactly, with a
false-positive rate around 1/65536, where every heuristic we tried before
it drifted out of alignment.

Both the layout and the CRC check come from the official Nike+ Connect
code (SportWatchPlugin.dll, WorkoutParser.cc per its own log strings),
not from guesswork -- see README.md.

Classes, from the routing in that same code and the decoded data:
    1 = device info (firmware version)
    2 = workout telemetry  (speed, session markers, calories; see decode_telemetry.py)
    4 = GPS data           (see decode_gps.py)
    6 = accelerometer data
    7 = end-of-session block (not decoded)

Usage: python extract_blocks.py <dump.bin> [outdir]
"""

import sys
from collections import Counter


def crc16_ccitt_false(buf: bytes) -> int:
    crc = 0xFFFF
    for byte in buf:
        crc ^= byte << 8
        for _ in range(8):
            crc = ((crc << 1) ^ 0x1021) & 0xFFFF if crc & 0x8000 else (crc << 1) & 0xFFFF
    return crc


def find_blocks(data: bytes) -> list[tuple[int, int, bytes]]:
    """Returns non-overlapping (offset, class, payload), earliest first."""
    candidates = []
    for pos in range(len(data) - 6):
        length = data[pos + 1] * 2
        if length == 0 or pos + length + 4 > len(data):
            continue
        if crc16_ccitt_false(data[pos:pos + length + 4]) == 0:
            candidates.append((pos, data[pos], length))

    blocks = []
    end = 0
    for pos, cls, length in candidates:
        if pos >= end:
            blocks.append((pos, cls, data[pos + 2:pos + 2 + length]))
            end = pos + length + 4
    return blocks


def main() -> None:
    if not 2 <= len(sys.argv) <= 3:
        print(f"Usage: {sys.argv[0]} <dump.bin> [outdir]")
        sys.exit(1)

    data = open(sys.argv[1], "rb").read()
    blocks = find_blocks(data)

    covered = sum(len(p) + 4 for _, _, p in blocks)
    print(f"{len(data)} bytes read")
    print(f"{len(blocks)} valid blocks, {covered} bytes covered "
          f"({100 * covered / len(data):.1f}%)")
    print()
    names = {1: "device info", 2: "telemetry", 4: "GPS", 6: "accelerometer", 7: "end of session"}
    for cls, count in sorted(Counter(c for _, c, _ in blocks).items()):
        sizes = Counter(len(p) for _, c, p in blocks if c == cls)
        common = ", ".join(f"{s} bytes x{n}" for s, n in sizes.most_common(3))
        print(f"  class {cls} ({names.get(cls, '?')}): {count} blocks [{common}]")

    if len(sys.argv) == 3:
        import os
        outdir = sys.argv[2]
        os.makedirs(outdir, exist_ok=True)
        for cls in sorted({c for _, c, _ in blocks}):
            path = os.path.join(outdir, f"class_{cls}.bin")
            with open(path, "wb") as f:
                for _, c, payload in blocks:
                    if c == cls:
                        f.write(payload)
            print(f"  -> {path}")


if __name__ == "__main__":
    main()
