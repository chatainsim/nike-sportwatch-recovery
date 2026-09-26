# Validating the decoders on your watch

*[Version française : REFERENCE_RUN.fr.md](REFERENCE_RUN.fr.md)*

The formats were solved and validated on a single watch. If your watch or
firmware behaves differently (odd tracks, `decode_gps.py` finds nothing,
reads are not identical), a reference recording is the fastest way to find
out why: one short recording on the Nike watch, with a second GPS device
(phone, smartwatch) recording at the same time.

## Before leaving

1. Read the watch once with `python pull_raw_data_v2.py` and keep the
   files: the tools are read-only, so this changes nothing on the watch, but
   it gives you a safe copy of what is already there.
2. Wait until the watch has a GPS fix before starting the recording.
3. Write down the start time, and the time shown by the watch at the same
   moment (its clock may be wrong).
4. Start the second device at the same time as the Nike watch.

## The route

The stops matter most: they show whether the one-second GPS steps drop to
zero when you do not move.

| Step | Duration | What |
|---|---|---|
| 1 | **2 min** | **Stand still** |
| 2 | ~3 min | Straight line, steady pace |
| 3 | **1 min** | **Stand still** |
| 4 | ~3 min | Sharp 90° turn, then a new straight line |
| 5 | ~5 min | Small loop back to the point of step 4 |
| 6 | **1 min** | **Stand still** |

Avoid an out-and-back on the same path: a symmetric shape is ambiguous to
align. A drive works too (the original validation was a 13-minute car trip),
but at high speed the second device may record fewer points.

## Back home

Do not connect the watch to Nike+ Connect (it would erase it). Then:

    python pull_raw_data_v2.py
    python decode_gps.py nike_v2_stream_1_<timestamp>.packets gpx/
    python decode_telemetry.py nike_v2_stream_1_<timestamp>.packets sessions/ref

Compare the Nike GPX with the other device's track in any GPX viewer. If they
do not match, open an issue with the `--analyze` output and what you
observed. Share the `.packets` and GPX files only privately: they contain
your exact locations.
