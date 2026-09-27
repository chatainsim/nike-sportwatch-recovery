#!/usr/bin/env python3
"""Battery level and clock of a Nike+ SportWatch GPS, and setting the clock.

    python watch_tools.py              # battery + clock (read-only)
    python watch_tools.py --set-time   # set the clock to this computer's time

Formats, from the official parsers in SportWatchPlugin.dll (completeBattery,
completeTime); "payload" = the reply bytes after the txid echo:

    battery (0x13)  payload [level][ 'Y' charging | 'N' not charging ]
    time    (0x21)  payload [Unix time UTC u32 BE][GMT offset s, i32 BE][DST min, u8]

Sent without arguments, "time" only reads the clock; with the 9 bytes above
it sets it. The clock is read back afterwards to check. The watch may still
be busy (e.g. streaming its memory to an earlier request): replies are
matched on their txid and other packets are skipped.

Requires: pip install hidapi
"""

from __future__ import annotations

import struct
import sys
import time

from pull_raw_data_v2 import READ_LEN, command, drain, open_watch

OPCODE_BATTERY = 0x13
OPCODE_TIME = 0x21
BATTERY_TXID, TIME_GET_TXID, TIME_SET_TXID = 0x31, 0x32, 0x33
TIMEOUT_S = 15


def ask(dev, packet: bytes) -> bytes:
    """Sends a command, returns the payload of the reply echoing its txid."""
    txid = packet[2]
    drain(dev)
    dev.write(packet)
    deadline = time.time() + TIMEOUT_S
    while time.time() < deadline:
        reply = dev.read(READ_LEN, timeout_ms=int(max(1, deadline - time.time()) * 1000))
        if reply and reply[2] == txid:
            reply = bytes(reply)
            return reply[3:min(len(reply) - 1, 2 + reply[1])]
    raise RuntimeError("No answer from the watch. Unplug the dock, plug it back in and try again.")


def battery(dev) -> tuple[int | None, bool]:
    p = ask(dev, command(OPCODE_BATTERY, BATTERY_TXID))
    flag = chr(p[1]).upper() if len(p) > 1 else ""
    if flag not in ("Y", "N"):
        return None, False
    return p[0], flag == "Y"


def get_time(dev) -> tuple[int, int, int]:
    p = ask(dev, command(OPCODE_TIME, TIME_GET_TXID))
    if len(p) < 9:
        raise RuntimeError(f"Unexpected clock reply: {p.hex(' ')}")
    return struct.unpack(">IiB", p[:9])


def set_time(dev, unix_time: int, gmt_offset: int, dst_minutes: int) -> None:
    packet = bytearray(command(OPCODE_TIME, TIME_SET_TXID, byte1=0x0B))  # txid + opcode + 9 bytes
    packet[4:13] = struct.pack(">IiB", unix_time, gmt_offset, dst_minutes)
    ask(dev, bytes(packet))


def local_settings() -> tuple[int, int, int]:
    """This computer's clock in the watch's terms: UTC time, standard GMT
    offset (s), daylight-saving offset (min)."""
    now = time.time()
    standard = -time.timezone
    dst = (-time.altzone - standard) // 60 if time.localtime(now).tm_isdst > 0 else 0
    return int(now), standard, dst


def local_seconds(t: int, gmt: int, dst: int) -> int:
    return t + gmt + dst * 60


def describe(dev) -> int:
    level, charging = battery(dev)
    t, gmt, dst = get_time(dev)
    mine = local_settings()
    drift = local_seconds(t, gmt, dst) - local_seconds(*mine)
    fmt = lambda s: time.strftime("%Y-%m-%d %H:%M:%S", time.gmtime(s))
    print(f"Battery:        {'%d %%' % level if level is not None else 'no valid reading'}"
          f"{' (charging)' if charging else ''}")
    print(f"Watch clock:    {fmt(local_seconds(t, gmt, dst))}  (UTC {fmt(t)}, GMT offset {gmt} s, DST {dst} min)")
    print(f"This computer:  {fmt(local_seconds(*mine))}")
    if abs(drift) > 60:
        print(f"The watch clock is off by {abs(drift) // 3600} h {abs(drift) % 3600 // 60:02d} min: "
              f"run 'python watch_tools.py --set-time' to fix it.")
    else:
        print("The watch clock is right (within a minute).")
    return drift


def main() -> None:
    set_it = "--set-time" in sys.argv[1:]
    print("Connecting to the watch...")
    try:
        dev = open_watch()
    except OSError as e:
        print(f"Cannot open the watch: {e}")
        sys.exit(1)
    try:
        drift = describe(dev)
        if set_it:
            print("\nSetting the clock to this computer's time...")
            set_time(dev, *local_settings())
            time.sleep(1)
            drift = describe(dev)
            if abs(drift) > 60:
                print("The watch did not take the new time. Nothing else was changed.")
                sys.exit(1)
            print("Clock set.")
    finally:
        dev.close()


if __name__ == "__main__":
    main()
