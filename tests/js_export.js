#!/usr/bin/env node
/*
 * Exports runs with the web app's decoder (docs/nike-decoder.js), the same
 * way export_runs.py does, so the tests can compare both byte for byte.
 *   node tests/js_export.js <dump.packets|memory.bin> <out_dir>
 */
"use strict";
const fs = require("fs");
const path = require("path");
const D = require(path.join(__dirname, "..", "docs", "nike-decoder.js"));

const [input, out] = process.argv.slice(2);
const buf = new Uint8Array(fs.readFileSync(input));
const stream = input.endsWith(".packets") ? D.payloadStream(D.parsePacketsFile(buf)) : buf;
fs.mkdirSync(out, { recursive: true });
const summary = [];
for (const r of D.decodeRuns(stream)) {
  const stem = path.join(out, D.fileStem(r));
  if (r.track.length) fs.writeFileSync(stem + ".gpx", D.toGpx(r));
  if (r.track.length || r.samples.length) fs.writeFileSync(stem + ".tcx", D.toTcx(r));
  if (r.samples.length) fs.writeFileSync(stem + ".csv", D.toCsv(r));
  summary.push({ start: r.start, duration: r.duration, calories: r.calories, points: r.track.length,
                 samples: r.samples.length, complete: r.complete, distance: r.distance === null ? null : Math.round(r.distance * 1000) / 1000 });
}
fs.writeFileSync(path.join(out, "summary.json"), JSON.stringify(summary, null, 1));
