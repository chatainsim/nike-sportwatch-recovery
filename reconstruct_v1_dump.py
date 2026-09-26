#!/usr/bin/env python3
"""Rebuild the watch memory from a dump made by a per-packet "offset" reader.

This project's first reader (pull_raw_data.py, v1, not published) asked the
watch for 57 bytes at a time with a little-endian offset (its paging loop
was adapted from the C++ comsport/nikePlus-SportWatchGPS code). Such dumps
are scrambled; this script unscrambles them. It is only useful if you have a
dump made that way -- to read a watch, use pull_raw_data_v2.py.

What v1 got wrong, established on 2026-09-26 from clean v2 reads (see
README.md):
  - each response is [01][len][txid][more][addr: 3 bytes big-endian][56 data
    bytes][txid echo]; v1 kept the echo byte (0x96) as a 57th data byte;
  - the watch reads the requested address from bytes 4-6, big-endian, but v1
    wrote its offset little-endian into bytes 5-6: request j (offset 57*j)
    actually read 56 bytes at address byteswap16(57*j mod 65536).

So v1 packet j is memory[byteswap16(57*j) : +56]. With ~172k packets over a
64 KB address space each byte is read ~150 times: a per-byte majority vote
rebuilds the memory (median agreement 88%, 99.9% of it then forms valid CRC
blocks). Only the first 64 KB are reachable with a 16-bit address, and the
memory turned out to be a 64 KB ring: the oldest session runs past the end
and wraps to the start, with a block straddling the 64 KB boundary.

Usage:
    python reconstruct_v1_dump.py old_dump.bin [out.bin]
Then:
    python decode_gps.py <out.bin> out.gpx
"""

import struct
import sys
from collections import Counter

from extract_blocks import find_blocks

V1_CHUNK = 57          # 56 data bytes + the 0x96 echo byte kept by v1
DATA_BYTES = 56
RING_SIZE = 1 << 16


def byteswap16(value: int) -> int:
    return ((value & 0xFF) << 8) | ((value >> 8) & 0xFF)


def rebuild(dump: bytes) -> bytes:
    votes = [Counter() for _ in range(RING_SIZE)]
    for j in range(len(dump) // V1_CHUNK):
        address = byteswap16((V1_CHUNK * j) & 0xFFFF)
        chunk = dump[j * V1_CHUNK:j * V1_CHUNK + DATA_BYTES]
        for k, byte in enumerate(chunk):
            votes[(address + k) % RING_SIZE][byte] += 1
    return bytes(c.most_common(1)[0][0] if c else 0xFF for c in votes)


def oldest_first(memory: bytes) -> bytes:
    """Rotates the ring so the oldest GPS fix comes first.

    A recording starts with an absolute fix (class-4 block, 22 bytes, Unix
    time at bytes 2-5), so the fix with the earliest time marks where the
    oldest data begins.
    """
    oldest = None
    for offset, cls, payload in find_blocks(memory):
        if cls == 4 and len(payload) == 22 and payload[0] & 0x80:
            t = struct.unpack_from(">I", payload, 2)[0]
            if oldest is None or t < oldest[0]:
                oldest = (t, offset)
    if oldest is None:
        return memory
    return memory[oldest[1]:] + memory[:oldest[1]]


def main() -> None:
    if not 2 <= len(sys.argv) <= 3:
        print(f"Usage: {sys.argv[0]} <nike_raw_dump.bin> [out.bin]")
        sys.exit(1)
    dump = open(sys.argv[1], "rb").read()
    memory = oldest_first(rebuild(dump))
    blocks = find_blocks(memory)
    covered = sum(len(p) + 4 for _, _, p in blocks)
    out = sys.argv[2] if len(sys.argv) == 3 else "memory.bin"
    with open(out, "wb") as f:
        f.write(memory)
    print(f"{len(memory)} bytes rebuilt, {len(blocks)} valid CRC blocks "
          f"({100 * covered / len(memory):.1f}% covered) -> {out}")


if __name__ == "__main__":
    main()
