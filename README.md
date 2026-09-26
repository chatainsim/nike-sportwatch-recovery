# Nike+ SportWatch GPS — get your runs back

*[Version française : README.fr.md](README.fr.md)*

Nike shut down the servers behind the **Nike+ SportWatch GPS** (made by
TomTom), and with them the only way to get runs off the watch: the Nike+
Connect software just uploaded raw data, and all decoding happened on Nike's
side. The watch itself still works and keeps its runs in memory.

These tools read that memory over USB and turn it into:

- **GPX tracks**: one point per second, with elevation and time, ready to
  import into Strava, Garmin Connect, or any mapping app;
- **telemetry**: per-second speed and pace, start/pause/resume/end markers,
  and calories, as a summary and a CSV file per run.

The GPS and telemetry formats were reverse-engineered and validated against
a phone/smartwatch GPS track recorded at the same time (see
[How it was validated](#how-it-was-validated)).

> Not affiliated with, endorsed by, or supported by Nike or TomTom.
> Tested on a single watch, on Windows: reports from other watches,
> firmwares, and operating systems are welcome.

## 🌐 Easiest way: the web app (experimental)

> ⚠️ **Experimental, being tested.** The web app has so far only been
> tested against a simulated watch replaying real data, not yet with a real
> watch plugged in. If it does not work for you, use the
> [Python tools](#python-tools), which are tested on real hardware, and
> please open an issue.

Open **https://chatainsim.github.io/nike-sportwatch-recovery/** in **Chrome or Edge** on a computer, put the watch on its
dock, click **Connect the watch**, and download your runs. Nothing to
install, and nothing is uploaded: the watch is read and decoded inside your
browser tab (only map backgrounds come from OpenStreetMap). The page lists
each run with its map, distance, duration, pace, calories and speed chart,
and exports GPX files and speed CSVs, one by one or all at once.

It uses WebHID, which Firefox and Safari do not support. The page can also
open a `.packets` file saved by `pull_raw_data_v2.py`.

The app lives in `docs/` (plain HTML/JavaScript, no build step);
`docs/nike-decoder.js` is a JavaScript port of the Python decoders and
gives identical results on the same data.

## ⚠️ Before you start

- **Do not connect the watch to Nike+ Connect.** That software erases the
  watch memory once it has "uploaded" it, and the servers it uploads to are
  gone.
- These tools are **read-only**: they only send the version, eeprom-query and
  read-workouts commands. Nothing on the watch is erased or modified, and you
  can run them as often as you like.
- The files they produce contain **the exact GPS locations of your runs**
  (often starting from home). Think twice before sharing them publicly.

## Python tools

Requirements: Python 3.9 or later, and the watch with its USB dock.

    pip install hidapi
    python pull_raw_data_v2.py
    python decode_gps.py nike_v2_stream_1_<timestamp>.packets gpx/
    python decode_telemetry.py nike_v2_stream_1_<timestamp>.packets sessions/run

1. `pull_raw_data_v2.py` reads the watch twice and checks that both reads are
   identical ("IDENTICAL: this read method is reliable."). It writes
   `nike_v2_stream_1_<timestamp>.packets` and `nike_v2_stream_2_...`.
2. `decode_gps.py` writes one GPX file per run into `gpx/`, named after its
   start time in UTC: `gpx/nike_YYYY-MM-DD_HHhMM.gpx`.
3. `decode_telemetry.py` prints a summary per run and writes
   `sessions/run_session<N>.csv` (time, speed in m/s, pace in min/km).

**Linux / macOS**: not tested. `hidapi` needs access to the USB device; on
Linux this usually means running as root or adding a udev rule for vendor
`11ac`, product `5455`. The mass-storage drive the watch exposes is a decoy
(it only contains a shortcut to Nike's website): ignore it.

**If reading fails**, `python pull_raw_data_v2.py --analyze "nike_v2_*.packets"`
summarises what was received. Please open an issue with that output — but do
not attach the `.packets` files publicly, since they contain your locations.

## What gets recovered

| Data | Status |
|---|---|
| GPS track (position, elevation, time, 1 point per second) | ✅ decoded and validated |
| Speed / pace, 1 value per second | ✅ decoded and validated |
| Start / pause / resume / end markers | ✅ decoded |
| Calories | ✅ decoded |
| Heart rate, foot pod (steps) | ❌ not decoded: the records exist, but no strap or foot pod was paired on the watch used here. Help welcome. |
| A few bytes in each GPS record (probably speed/heading or signal quality) | ❌ not decoded, not needed for the track |

The watch clock can drift or be wrong: for the date and time of a run, trust
the GPS timestamps (used in the GPX) over the watch-clock times printed by
`decode_telemetry.py`.

## How it works

### USB protocol

The watch is a USB HID device, vendor `0x11ac`, product `0x5455`. Each
response packet is 64 bytes:

    [01][length][txid][more][address: 3 bytes big-endian][56 data bytes][txid echo]

- `length` counts from byte 2 onward; a full packet carries 56 data bytes;
- `txid` echoes byte 2 of the request (e.g. `0x96` for a workout read), and
  is repeated as the last byte;
- `more` is 1 while more data follows, 0 on the last packet.

| Opcode | Name | Purpose |
|---|---|---|
| `0x08` | `version` | firmware version (checks the connection) |
| `0x12` | `eeprom-query` | is there stored data? |
| `0x10` | `readWorkouts` | reads the workout memory |

`pull_raw_data_v2.py` sends a single `readWorkouts` request and keeps reading
whatever the watch streams until it goes quiet ("stream" mode, the method of
the 2014 research paper credited below). Requesting one packet at a time
with an offset is unreliable: the watch expects the address big-endian in
bytes 4-6, and answers each request with more than one packet.

### Data blocks

The memory is a sequence of blocks:

    [class:1][payload length/2:1][payload][crc16:2]

A block is valid when CRC-16/CCITT-FALSE (poly `0x1021`, init `0xFFFF`) over
the whole block, CRC included, is zero. Classes: 1 = device info, 2 =
telemetry, 4 = GPS, 6 = accelerometer, 7 = end-of-session block (not
decoded).

### GPS records (class 4, one per second)

| Size | Flags | Content (big-endian) |
|---|---|---|
| 22 bytes | `82 04` | **absolute fix**: Unix time (u32, bytes 2-5), latitude and longitude (i32 × 10⁻⁷°, bytes 6-9 and 10-13), altitude in metres (i16, bytes 14-15), then 6 undecoded bytes |
| 10 bytes | `02 04` / `00 04` | **one-second step**: Δlat, Δlon (i8, unit 16 × 10⁻⁷°), Δalt (i8, 1/16 m), then 5 undecoded bytes |

The watch writes an absolute fix whenever a step no longer fits in a signed
byte (above ~22 m/s northward), and periodically otherwise. When a fix
follows a series of steps, the last step also covers the fix's own second.

### Telemetry records (class 2)

The class-2 payloads, concatenated, form a stream of records whose sizes
come from the opcode table of the Nike+ Connect software:

| Record | Content |
|---|---|
| `a0 00 c0 vv` | absolute speed in 0.1 m/s (0 = no reading, `fe` = invalid/saturated, `ff` = unknown) |
| 2 bytes `00`-`7f` | three 5-bit signed speed deltas, one per second, in reading order ("PaceRelative3") |
| `c0 03 00 tt` + u32 | session marker + Unix time (watch clock): 0 start, 1 pause, 2 resume, 3 end |
| `a2 00` + u16 | calories (kcal), written at the end of the run |

### How it was validated

A 13-minute reference recording was made with the Nike watch and another
GPS device (an Amazfit watch) started together, including 2 minutes
standing still.

- Integrating the one-second steps lands on the next absolute fix within
  0-3 m, even after 240 consecutive steps.
- The decoded track lies at a median of 2.1 m from the reference track.
- While standing still, the steps are zero: they are displacements, not raw
  satellite measurements.
- Telemetry: 527 absolute speed values + 3 × 88 relative records = 791
  samples for 791 seconds, and the values follow the GPS speed (e.g. deltas
  +3 +2 +2 from 114 give 117, 119, 121 against 113, 117, 121 from the GPS).

The same decoders also recovered two runs from 2017, from a dump made
before the protocol was fully understood (see below).

## Recovering a dump made with an older tool

`reconstruct_v1_dump.py` exists for dumps made by reading one packet at a
time with a little-endian offset, which is what this project's first,
unpublished reader did. Such a dump is scrambled: request *j* actually read
56 bytes at address `byteswap16(57 × j)`, plus a trailing echo byte. The
script puts every packet back at its real address and takes a per-byte
majority vote (each byte is typically read many times), then rotates the
64 KB memory ring so the oldest recording comes first.

    python reconstruct_v1_dump.py old_dump.bin memory.bin
    python decode_gps.py memory.bin gpx/
    python decode_telemetry.py memory.bin sessions/old

Only the first 64 KB can be reached that way. If you still have the watch,
read it again with `pull_raw_data_v2.py` instead.

## Files

| File | Role |
|---|---|
| `docs/` | the web app (index.html, app.js, watch-usb.js, nike-decoder.js) |
| `pull_raw_data_v2.py` | reads the watch over USB, saves raw packets |
| `decode_gps.py` | GPS blocks → GPX, one file per run |
| `decode_telemetry.py` | telemetry → summary + per-second speed/pace CSV |
| `extract_blocks.py` | splits a data stream into CRC-validated blocks (also a debugging tool) |
| `reconstruct_v1_dump.py` | rebuilds memory from an old per-packet dump |
| `REFERENCE_RUN.md` | how to validate the decoders on another watch or firmware |

## Credits

- **Leendert van Duijn & Hristo Dimitrov**, *Information retrieval from a
  TomTom Nike+ smart watch*, student project of the Security and Network
  Engineering master (OS3), University of Amsterdam, June 2014: USB and
  network captures, decompilation of Nike+ Connect, command opcodes, and the
  stream reading method.
  Paper: https://www.os3.nl/_media/2013-2014/courses/ccf/smartwatches-hristo-leendert.pdf (the OS3 site currently answers "403 Forbidden";
  [archived copy](https://web.archive.org/web/20170113075239/https://www.os3.nl/_media/2013-2014/courses/ccf/smartwatches-hristo-leendert.pdf)).
- **Jurph/sportwatch**, a follow-up project reproducing that paper's results
  on another watch — https://github.com/Jurph/sportwatch
- **comsport / nikePlus-SportWatchGPS**, C++ implementation of the USB
  protocol — https://github.com/neklaf/nikePlus-SportWatchGPS
- The block container, CRC and opcode table were confirmed by analysing
  Nike+ Connect's `SportWatchPlugin.dll`. The software itself is not
  distributed here.

## How this was made

This whole project was built with [Claude Code](https://claude.com/claude-code),
Anthropic's AI coding assistant: the reverse engineering of the USB protocol
and of the GPS and telemetry formats, the tools, and this documentation. The
watch owner handled everything that needed the hardware: running the reader
on the watch, and recording the reference run alongside a second GPS device.

## License

MIT — see [LICENSE](LICENSE).
