#!/usr/bin/env python3
"""Read the workout memory of a Nike+ SportWatch GPS over USB, read-only.

Saves every USB response packet exactly as received in a .packets file, to
be decoded afterwards with decode_gps.py and decode_telemetry.py.

Protocol (USB HID, vendor 0x11ac, product 0x5455). Each response is:

    [01][length][txid][more][address: 3 bytes big-endian][56 data bytes][txid echo]

`length` counts from byte 2; `txid` echoes byte 2 of the request; `more` is
1 while more data follows. Reading method ("stream" mode, the default): one
read-workouts request, then keep reading whatever the watch sends until it
goes quiet -- the method of the 2014 SNE paper, which gives bit-identical
double reads. The memory is read twice and both copies are compared.

The "offset" mode (one request per packet) is kept for diagnosis only: the
watch expects the address big-endian in bytes 4-6, and it answers each
request with more than one packet, which is why an earlier reader using this
method produced corrupted dumps (see reconstruct_v1_dump.py and README.md).

Stale input reports are drained before every request, and packets are read
with room for one extra byte in case Windows prepends a report ID.

Read-only: the only opcodes sent are version (0x08), eeprom-query (0x12)
and read-workouts (0x10). Nothing on the watch is erased or modified.

Usage:
    python pull_raw_data_v2.py              # stream mode, 2 reads (recommended)
    python pull_raw_data_v2.py offset       # diagnostic mode
    python pull_raw_data_v2.py --analyze "nike_v2_*.packets"   # offline check

Requires: pip install hidapi
"""

from __future__ import annotations

import glob
import struct
import sys
import time
from collections import Counter

REPORT_SIZE = 64
# Room for a report ID byte that Windows' hidapi prepends on numbered
# reports: reading only 64 would silently cut the device's last byte off.
READ_LEN = REPORT_SIZE + 1
READ_TIMEOUT_MS = 3000
# Stream mode stops after this long without a packet.
STREAM_IDLE_MS = 2500

NIKE_VENDOR_ID = 0x11AC
NIKE_PRODUCT_ID = 0x5455
OPCODE_VERSION = 0x08
OPCODE_EEPROM_QUERY = 0x12
OPCODE_READ_WORKOUTS = 0x10

# The storage is ~129 KB (2304 packets of 56 bytes). Read a bit more than
# two full passes so each read also shows where the stream wraps.
MAX_PACKETS = 5000

V1_HEADER = 7


def packet_payload(packet: bytes) -> bytes:
    """Data carried by one response.

    Response layout, established on the empty watch (2026-09-25):
        [0x01][len][txid][more?][? ? ?][data ...][padding][txid]
    `len` counts from the txid byte (offset 2) onward, and the last byte
    echoes the request's txid (the 0x96 that v1 mistook for data). A full
    packet is therefore expected to carry 56 bytes, not the 57 v1 assumed.
    """
    length = packet[1] if len(packet) > 1 else 0
    if V1_HEADER - 2 <= length <= len(packet) - 3:
        return packet[V1_HEADER:2 + length]
    return packet[V1_HEADER:-1]


# ── Device side ──────────────────────────────────────────────────────────────

def open_watch():
    import hid  # imported here so --analyze works without hidapi installed

    dev = hid.device()
    dev.open(NIKE_VENDOR_ID, NIKE_PRODUCT_ID)
    return dev


def drain(dev) -> int:
    """Discards input reports already queued; returns how many there were."""
    dev.set_nonblocking(True)
    count = 0
    try:
        while dev.read(READ_LEN):
            count += 1
            if count > 10000:
                break
    finally:
        dev.set_nonblocking(False)
    return count


def command(opcode: int, byte2: int, byte1: int = 0x02, offset: int = 0) -> bytes:
    packet = bytearray(REPORT_SIZE)
    packet[0] = 0x09
    packet[1] = byte1
    packet[2] = byte2
    packet[3] = opcode
    packet[5] = offset & 0xFF
    packet[6] = (offset >> 8) & 0xFF
    return bytes(packet)


def request(dev, packet: bytes, stale_counter: list | None = None) -> bytes:
    stale = drain(dev)
    if stale_counter is not None:
        stale_counter[0] += stale
    elif stale:
        print(f"    ({stale} stale packet(s) discarded before the request)")
    dev.write(packet)
    data = dev.read(READ_LEN, timeout_ms=READ_TIMEOUT_MS)
    if not data:
        raise RuntimeError("No answer from the watch (timeout). Unplug it, plug it back in and try again.")
    return bytes(data)


def read_offset_mode(dev) -> list[bytes]:
    """v1's method (one request per packet, 16-bit offset), with the stale
    reports drained each time and every response kept whole."""
    packets = []
    offset = 0
    stale = [0]
    echoes = Counter()
    while len(packets) < MAX_PACKETS:
        data = request(dev, command(OPCODE_READ_WORKOUTS, 0x96, byte1=0x05, offset=offset), stale)
        packets.append(data)
        # Does the response header echo the requested offset (bytes 4-6)?
        echoes["5-6 = offset" if data[5] | (data[6] << 8) == offset & 0xFFFF else "5-6 != offset"] += 1
        payload = packet_payload(data)
        if not payload:
            break
        offset += len(payload)
        if len(packets) % 250 == 0:
            print(f"    {len(packets)} packets")
        if data[3] != 1:
            break
    # Stale reports are what v1 would have mistaken for the next packet.
    print(f"    extra packets received and discarded: {stale[0]}")
    print(f"    offset echoed in the response: {dict(echoes)}")
    return packets


def read_stream_mode(dev) -> list[bytes]:
    """The 2014 paper's method: a single request, then read until the watch
    goes quiet."""
    drain(dev)
    dev.write(command(OPCODE_READ_WORKOUTS, 0x96, byte1=0x05))
    packets = []
    while len(packets) < MAX_PACKETS:
        data = dev.read(READ_LEN, timeout_ms=STREAM_IDLE_MS)
        if not data:
            break
        packets.append(bytes(data))
        if len(packets) % 250 == 0:
            print(f"    {len(packets)} packets")
    return packets


def save_packets(path: str, packets: list[bytes]) -> None:
    """Container: for each packet, uint16 little-endian length then bytes."""
    with open(path, "wb") as f:
        for p in packets:
            f.write(struct.pack("<H", len(p)))
            f.write(p)


def load_packets(path: str) -> list[bytes]:
    raw = open(path, "rb").read()
    packets, pos = [], 0
    while pos + 2 <= len(raw):
        (length,) = struct.unpack_from("<H", raw, pos)
        packets.append(raw[pos + 2:pos + 2 + length])
        pos += 2 + length
    return packets


# ── Analysis (also usable offline) ───────────────────────────────────────────

def payload_stream(packets: list[bytes]) -> bytes:
    """Data stream: each packet's payload, delimited by its length byte."""
    return b"".join(packet_payload(p) for p in packets if len(p) > V1_HEADER)


def describe(packets: list[bytes], label: str) -> None:
    print(f"\n  [{label}] {len(packets)} packets")
    if not packets:
        return
    print(f"    sizes: {dict(Counter(len(p) for p in packets).most_common(5))}")
    print(f"    length byte: {dict(Counter(p[1] for p in packets).most_common(5))}")
    width = max(len(p) for p in packets)
    for pos in list(range(8)) + list(range(width - 3, width)):
        values = Counter(p[pos] for p in packets if len(p) > pos)
        top = ", ".join(f"{v:02x}×{n}" for v, n in values.most_common(4))
        print(f"    byte {pos:2d}: {len(values):3d} distinct values ({top})")
    print("    first packets (first 8 bytes … last 4):")
    for p in packets[:6]:
        print(f"      {p[:8].hex(' ')} … {p[-4:].hex(' ')}")

    stream = payload_stream(packets)
    try:
        from extract_blocks import find_blocks

        head = stream[:131072]
        blocks = find_blocks(head)
        covered = sum(len(pl) + 4 for _, _, pl in blocks)
        print(f"    valid CRC blocks in the first 128 KB: {len(blocks)}, "
              f"coverage {100 * covered / max(len(head), 1):.1f}%")
    except ImportError:
        pass


def compare(a: list[bytes], b: list[bytes], label: str) -> None:
    sa, sb = payload_stream(a), payload_stream(b)
    n = min(len(sa), len(sb))
    if not n:
        print(f"\n  [{label}] nothing to compare")
        return
    same = sum(1 for x, y in zip(sa[:n], sb[:n]) if x == y)
    first_diff = next((i for i in range(n) if sa[i] != sb[i]), None)
    print(f"\n  [{label}] read 1 vs read 2: {100 * same / n:.2f}% identical bytes "
          f"over {n} bytes" + ("" if first_diff is None else f", first difference at byte {first_diff}"))
    if same == n and len(sa) == len(sb):
        print("    -> IDENTICAL: this read method is reliable.")


# ── Entry points ─────────────────────────────────────────────────────────────

def analyze(paths: list[str]) -> None:
    loaded = {p: load_packets(p) for p in sorted(paths)}
    for path, packets in loaded.items():
        describe(packets, path)
    by_mode = {}
    for path, packets in loaded.items():
        mode = "stream" if "_stream_" in path else "offset"
        by_mode.setdefault(mode, []).append(packets)
    for mode, reads in by_mode.items():
        if len(reads) >= 2:
            compare(reads[0], reads[1], mode)


def main() -> None:
    args = sys.argv[1:]
    if args and args[0] == "--analyze":
        paths = [p for pattern in args[1:] for p in glob.glob(pattern)]
        if not paths:
            print("No .packets file found.")
            sys.exit(1)
        analyze(paths)
        return

    # "stream" is the reliable method (2026-09-26: identical double reads,
    # 100% CRC coverage). "offset" stays available for diagnosis only: the
    # watch expects the address big-endian in bytes 4-6.
    modes = args or ["stream"]
    unknown = [m for m in modes if m not in ("stream", "offset")]
    if unknown:
        print(f"Unknown mode: {unknown[0]} (expected: stream, offset or --analyze)")
        sys.exit(1)

    print("Connecting to the watch...")
    try:
        dev = open_watch()
    except OSError as e:
        print(f"Cannot open the watch: {e}")
        print("Check that it sits on its dock and that the dock is plugged in over USB.")
        sys.exit(1)

    try:
        version = request(dev, command(OPCODE_VERSION, 0x29))
        print(f"  Version response (raw): {version.hex(' ')}")
        query = request(dev, command(OPCODE_EEPROM_QUERY, 0xBB))
        print(f"  eeprom-query response (raw): {query.hex(' ')}")
    except Exception as e:
        print(f"  Failed (not blocking, continuing): {e}")

    stamp = int(time.time())
    written = []
    for mode in modes:
        reads = []
        for run in (1, 2):
            print(f"\n{mode} mode, read {run}/2 (may take a few minutes)...")
            try:
                packets = read_stream_mode(dev) if mode == "stream" else read_offset_mode(dev)
            except Exception as e:
                print(f"  Failed: {e}")
                break
            path = f"nike_v2_{mode}_{run}_{stamp}.packets"
            save_packets(path, packets)
            written.append(path)
            reads.append(packets)
            print(f"  {len(packets)} packets written to {path}")
            time.sleep(1)
        for i, packets in enumerate(reads, start=1):
            describe(packets, f"{mode} {i}")
        if len(reads) == 2:
            compare(reads[0], reads[1], mode)

    dev.close()
    print("\nDone. Files written:")
    for path in written:
        print(f"  {path}")
    print("Next: python decode_gps.py <file>.packets gpx/")


if __name__ == "__main__":
    main()
