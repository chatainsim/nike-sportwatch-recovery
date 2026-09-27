"""Synthetic watch memory, for the tests: the decoders run backwards.

Builds the memory a Nike+ SportWatch GPS would hold for made-up runs (around
the Champ-de-Mars in Paris, a public place -- never real user data), with
the formats documented in README.md, and the 64-byte USB packets it would
send. Each run keeps its ground truth (positions, speeds, markers,
calories) so the tests can check that decoding gives it back exactly.
"""

from __future__ import annotations

import math
import random
import struct

DATA_BYTES = 56
READ_TXID = 0x96


def crc16(data: bytes) -> int:
    crc = 0xFFFF
    for b in data:
        crc ^= b << 8
        for _ in range(8):
            crc = ((crc << 1) ^ 0x1021) & 0xFFFF if crc & 0x8000 else (crc << 1) & 0xFFFF
    return crc


def block(cls: int, payload: bytes) -> bytes:
    """[class][len/2][payload][crc16 BE]: the CRC over the whole block is then 0."""
    assert len(payload) % 2 == 0 and len(payload) <= 510
    head = bytes([cls, len(payload) // 2]) + payload
    return head + struct.pack(">H", crc16(head))


def gps_fix(t: int, lat7: int, lon7: int, alt_m: int) -> bytes:
    return block(4, bytes([0x82, 0x04]) + struct.pack(">Iiih", t, lat7, lon7, alt_m) + bytes(6))


def gps_step(dlat: int, dlon: int, dalt16: int) -> bytes:
    return block(4, bytes([0x02, 0x04]) + struct.pack(">bbb", dlat, dlon, dalt16) + bytes(5))


class Run:
    """A made-up run: one GPS point and one speed sample per second."""

    def __init__(self, start: int, seconds: int, seed: int, pause_at: int | None = None, calories: int = 250):
        rng = random.Random(seed)
        self.start, self.calories = start, calories
        self.times = [start + i for i in range(seconds)]
        # Path on the watch's 16e-7 degree grid; a few sprints overflow a signed byte.
        self.lat7, self.lon7, heading = [488583700], [22944800], rng.uniform(0, 2 * math.pi)
        for s in range(1, seconds):
            heading += rng.uniform(-0.25, 0.25)
            fast = 6.0 if s % 97 < 2 else 1.0
            self.lat7.append(self.lat7[-1] + 16 * round(math.cos(heading) * rng.uniform(10, 30) * fast))
            self.lon7.append(self.lon7[-1] + 16 * round(math.sin(heading) * rng.uniform(10, 30) * fast))
        # Seconds written as absolute fixes: the first, every 60 s, and whenever a step overflows.
        self.fix = [i == 0 or i % 60 == 0 or
                    not all(-128 <= (a[i] - a[i - 1]) // 16 <= 127 for a in (self.lat7, self.lon7))
                    for i in range(seconds)]
        # Altitude in 1/16 m; a fix carries whole metres.
        self.alt16, alt = [], 35 * 16
        for i in range(seconds):
            alt += rng.randint(-8, 8) if i else 0
            if self.fix[i]:
                alt -= alt % 16
            self.alt16.append(alt)
        # Speed in 0.1 m/s, drifting slowly (most seconds fit a 5-bit delta), stopped during a pause.
        self.speeds, v = [], 25
        for s in range(seconds):
            v = max(1, min(60, v + rng.randint(-3, 3)))
            self.speeds.append(0 if pause_at and pause_at <= s < pause_at + 20 else v)
        self.markers = [("start", start)]
        if pause_at:
            self.markers += [("pause", start + pause_at), ("resume", start + pause_at + 20)]
        self.markers.append(("end", start + seconds))

    def points(self):
        """Ground truth, as decode_track reports it: (t, lat, lon, alt)."""
        return [(t, la / 1e7, lo / 1e7, a / 16) for t, la, lo, a in zip(self.times, self.lat7, self.lon7, self.alt16)]

    def gps_blocks(self) -> list[bytes]:
        # A session-start GPS record seen on real watches (8-byte payload), then the points.
        out = [block(4, bytes([0x40, 0x05, 0x02]) + struct.pack(">I", self.start - 11) + b"\xff")]
        for i, t in enumerate(self.times):
            if self.fix[i]:
                out.append(gps_fix(t, self.lat7[i], self.lon7[i], self.alt16[i] // 16))
            else:
                out.append(gps_step((self.lat7[i] - self.lat7[i - 1]) // 16, (self.lon7[i] - self.lon7[i - 1]) // 16,
                                    self.alt16[i] - self.alt16[i - 1]))
        return out

    def telemetry(self) -> bytes:
        rec = bytearray()
        rec += bytes([0xC0, 0x03, 0x00, 0x00]) + struct.pack(">I", self.start)
        i, v = 0, None
        while i < len(self.speeds):
            s = self.speeds[i]
            chunk = self.speeds[i:i + 3]
            deltas = [chunk[k] - (v if k == 0 else chunk[k - 1]) for k in range(len(chunk))] if v else []
            if v and v > 0 and len(chunk) == 3 and all(c > 0 for c in chunk) and all(-16 <= d <= 15 for d in deltas):
                value = 0
                for d in deltas:
                    value = (value << 5) | (d & 31)
                rec += struct.pack(">H", value)
                v = chunk[-1]
                i += 3
            else:
                rec += bytes([0xA0, 0x00, 0xC0, s])
                v = s
                i += 1
        for kind, t in self.markers[1:]:
            code = {"pause": 1, "resume": 2, "end": 3}[kind]
            if kind == "end":
                rec += bytes([0xA2, 0x00]) + struct.pack(">H", self.calories)
            rec += bytes([0xC0, 0x03, 0x00, code]) + struct.pack(">I", t)
        return bytes(rec)

    def telemetry_blocks(self) -> bytes:
        tel, out = self.telemetry(), bytearray()
        for k in range(0, len(tel), 126):
            out += block(2, tel[k:k + 126])
        return bytes(out)


def memory(runs: list[Run]) -> bytes:
    """Device-info block, then for each run: GPS, accelerometer and telemetry blocks."""
    out = bytearray(block(1, bytes([0x7E, 0xFC, 0x17, 0x02]) + b"2.2.0" + bytes(7)))
    for r in runs:
        # Interleaved like on a real watch: GPS, accelerometer, telemetry, more GPS.
        gps = r.gps_blocks()
        out += b"".join(gps[:20])
        out += block(6, bytes([0x94, 0x10, 0xFF, 0x00]))
        out += r.telemetry_blocks()
        out += b"".join(gps[20:])
    return bytes(out)


def packets(mem: bytes) -> list[bytes]:
    """The 64-byte USB replies of a stream read: [01][len][txid][more][addr BE x3][56 data][txid]."""
    out = []
    for addr in range(0, len(mem), DATA_BYTES):
        data = mem[addr:addr + DATA_BYTES]
        more = 1 if addr + DATA_BYTES < len(mem) else 0
        p = bytes([0x01, 5 + len(data), READ_TXID, more]) + addr.to_bytes(3, "big") + data
        out.append(p + bytes(63 - len(p)) + bytes([READ_TXID]))
    return out


def packets_file(pkts: list[bytes]) -> bytes:
    return b"".join(struct.pack("<H", len(p)) + p for p in pkts)
