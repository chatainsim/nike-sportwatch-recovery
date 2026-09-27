"""Decoder tests on synthetic watch data (tests/synthetic.py, no real user data).

    python -m unittest discover -s tests -v

Checks that decoding gives back the made-up runs exactly, that the reader
copes with out-of-order and duplicated packets, that an old per-packet dump
can be rebuilt, and that the Python tools and the web app's JavaScript
decoder produce byte-identical GPX, TCX and CSV files (needs Node.js).
Set TCX_XSD to Garmin's TrainingCenterDatabasev2.xsd to validate TCX files
(needs lxml).
"""

import json
import os
import random
import shutil
import struct
import subprocess
import sys
import tempfile
import unittest
import xml.etree.ElementTree as ET

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
sys.path[:0] = [HERE, ROOT]

import synthetic as S  # noqa: E402
import decode_gps  # noqa: E402
import decode_telemetry  # noqa: E402
import export_runs  # noqa: E402
import reconstruct_v1_dump  # noqa: E402
import watch_tools  # noqa: E402
from extract_blocks import find_blocks  # noqa: E402
from pull_raw_data_v2 import load_packets, payload_stream  # noqa: E402

RUNS = [S.Run(1700000000, 600, seed=1, pause_at=200, calories=310), S.Run(1700100000, 300, seed=2)]
MEMORY = S.memory(RUNS)


class Blocks(unittest.TestCase):
    def test_every_byte_is_in_a_valid_block(self):
        blocks = find_blocks(MEMORY)
        self.assertEqual(sum(len(p) + 4 for _, _, p in blocks), len(MEMORY))

    def test_corrupted_block_is_rejected(self):
        bad = bytearray(MEMORY)
        bad[40] ^= 0xFF
        self.assertLess(len(find_blocks(bytes(bad))), len(find_blocks(MEMORY)))


class Gps(unittest.TestCase):
    def test_tracks_are_decoded_exactly(self):
        tracks = decode_gps.split_sessions(decode_gps.decode_track(MEMORY))
        self.assertEqual(len(tracks), 2)
        for track, run in zip(tracks, RUNS):
            self.assertEqual(track, run.points())

    def test_fast_sections_use_absolute_fixes(self):
        self.assertGreater(sum(RUNS[0].fix), 600 // 60 + 1)  # overflowing steps forced extra fixes


class Telemetry(unittest.TestCase):
    def test_speeds_markers_and_calories(self):
        sessions = decode_telemetry.parse_sessions(MEMORY)
        self.assertEqual(len(sessions), 2)
        for s, run in zip(sessions, RUNS):
            self.assertEqual([v for _, v in s["samples"]], run.speeds)
            self.assertEqual(s["markers"], run.markers)
            self.assertEqual(s["calories"], run.calories)


class Runs(unittest.TestCase):
    def test_tracks_are_paired_with_their_session(self):
        runs = export_runs.decode_runs(MEMORY)
        self.assertEqual([r["start"] for r in runs], [r.start for r in RUNS])
        for r, truth in zip(runs, RUNS):
            self.assertEqual(len(r["track"]), len(truth.times))
            self.assertEqual(r["calories"], truth.calories)
            self.assertTrue(r["complete"])
            self.assertEqual(r["duration"], len(truth.times))

    def test_tcx_is_well_formed(self):
        ns = {"t": "http://www.garmin.com/xmlschemas/TrainingCenterDatabase/v2"}
        for r in export_runs.decode_runs(MEMORY):
            doc = ET.fromstring(export_runs.to_tcx(r).encode())
            self.assertEqual(len(doc.findall(".//t:Trackpoint", ns)), len(r["track"]))
            self.assertEqual(doc.find(".//t:Calories", ns).text, str(r["calories"]))

    @unittest.skipUnless(os.environ.get("TCX_XSD"), "set TCX_XSD to validate against Garmin's schema")
    def test_tcx_matches_garmin_schema(self):
        from lxml import etree
        schema = etree.XMLSchema(etree.parse(os.environ["TCX_XSD"]))
        for r in export_runs.decode_runs(MEMORY):
            self.assertTrue(schema.validate(etree.fromstring(export_runs.to_tcx(r).encode())), schema.error_log)


class Reading(unittest.TestCase):
    def test_out_of_order_and_duplicated_packets(self):
        """A read may catch the tail of an earlier stream, then a full one."""
        pkts = S.packets(MEMORY)
        other = bytes([1, 4, 0x29, 0x43, 0, 5]) + bytes(57) + b"\x29"  # a late reply to another command
        messy = pkts[len(pkts) // 2:] + [other] + pkts
        random.Random(3).shuffle(messy)
        self.assertEqual(payload_stream(messy), MEMORY)

    def test_packets_file_round_trip(self):
        with tempfile.NamedTemporaryFile(suffix=".packets", delete=False) as f:
            f.write(S.packets_file(S.packets(MEMORY)))
        try:
            self.assertEqual(payload_stream(load_packets(f.name)), MEMORY)
        finally:
            os.unlink(f.name)

    def test_old_per_packet_dump_is_rebuilt(self):
        """The first reader asked for 57 bytes at little-endian offsets: request j
        read 56 bytes at byteswap16(57*j), plus a 0x96 echo byte."""
        ring = MEMORY + b"\xff" * (65536 - len(MEMORY))
        dump = bytearray()
        for j in range(65536):
            addr = reconstruct_v1_dump.byteswap16((57 * j) & 0xFFFF)
            chunk = (ring + ring[:56])[addr:addr + 56]
            dump += chunk + b"\x96"
        rebuilt = reconstruct_v1_dump.oldest_first(reconstruct_v1_dump.rebuild(bytes(dump)))
        self.assertEqual(
            [(r["start"], len(r["track"]), r["calories"]) for r in export_runs.decode_runs(rebuilt)],
            [(r["start"], len(r["track"]), r["calories"]) for r in export_runs.decode_runs(MEMORY)])


class WatchCommands(unittest.TestCase):
    def test_set_time_packet(self):
        sent = []

        class Dev:
            def write(self, p):
                sent.append(bytes(p))

            def read(self, n, timeout_ms=0):
                return list(bytes([1, 1, 0x33]) + bytes(60) + b"\x33") if sent else []

            def set_nonblocking(self, x):
                pass

        watch_tools.set_time(Dev(), 1790000000, 3600, 60)
        p = sent[0]
        self.assertEqual(p[:4], bytes([0x09, 0x0B, 0x33, 0x21]))
        self.assertEqual(struct.unpack(">IiB", p[4:13]), (1790000000, 3600, 60))


@unittest.skipUnless(shutil.which("node"), "Node.js not installed")
class PythonAndWebAppAgree(unittest.TestCase):
    """The web app (docs/nike-decoder.js) and export_runs.py must give the same files."""

    def test_identical_exports(self):
        with tempfile.TemporaryDirectory() as tmp:
            src = os.path.join(tmp, "watch.packets")
            with open(src, "wb") as f:
                f.write(S.packets_file(S.packets(MEMORY)))
            py_out, js_out = os.path.join(tmp, "py"), os.path.join(tmp, "js")
            subprocess.run([sys.executable, os.path.join(ROOT, "export_runs.py"), src, py_out],
                           check=True, capture_output=True)
            subprocess.run(["node", os.path.join(HERE, "js_export.js"), src, js_out], check=True)
            py_files = sorted(f for f in os.listdir(py_out))
            js_files = sorted(f for f in os.listdir(js_out) if f != "summary.json")
            self.assertEqual(py_files, js_files)
            self.assertEqual(len(py_files), 6)  # 2 runs x gpx, tcx, csv
            for name in py_files:
                with open(os.path.join(py_out, name), "rb") as a, open(os.path.join(js_out, name), "rb") as b:
                    self.assertEqual(a.read(), b.read(), name)
            with open(os.path.join(js_out, "summary.json")) as f:
                summary = json.load(f)
            self.assertEqual([s["calories"] for s in summary], [r.calories for r in RUNS])


if __name__ == "__main__":
    unittest.main()
