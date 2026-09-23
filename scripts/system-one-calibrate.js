#!/usr/bin/env node
'use strict';
// Chooses System One acceptance thresholds on validation scores (docs/system-one-training.md).
// The holdout is never used here.
const fs = require('node:fs');

const IDS = ['tier1', 'tier2', 'tier3', 'unclassified'];
// Same acceptance rule as contract.decide: top probability and top-minus-second margin, unclassified abstains.
function decideRow(probs, { minConfidence, minMargin }) {
  const order = probs.map((p, i) => [p, i]).sort((a, b) => b[0] - a[0] || a[1] - b[1]);
  const [top, second] = order;
  const margin = top[0] - second[0];
  if (margin === 0 || top[0] < minConfidence || margin < minMargin || IDS[top[1]] === 'unclassified') return null;
  return IDS[top[1]];
}
function calibrate(rows, { minPrecision = 0.98 } = {}) {
  let best = null;
  for (let c = 50; c <= 99; c++) {
    for (let m = 0; m <= 90; m += 5) {
      const t = { minConfidence: c / 100, minMargin: m / 100 };
      let accepted = 0; let correct = 0;
      for (const r of rows) { const d = decideRow(r.probs, t); if (d) { accepted++; if (d === (r.gold === null ? 'unclassified' : r.gold)) correct++; } }
      const precision = accepted ? correct / accepted : 0;
      if (!accepted || precision < minPrecision) continue;
      const coverage = accepted / rows.length;
      // Highest coverage wins; ties keep the first (lowest) thresholds scanned.
      if (!best || coverage > best.coverage) best = { ...t, coverage, precision, accepted };
    }
  }
  return best ? { feasible: true, rows: rows.length, minPrecision, ...best }
    : { feasible: false, rows: rows.length, minPrecision, minConfidence: null, minMargin: null, coverage: 0, precision: null, accepted: 0 };
}

if (require.main === module) {
  try {
    const [input, output, extra] = process.argv.slice(2);
    if (!input || !output || extra) throw new Error('usage: system-one-calibrate.js <val-scores.jsonl> <calibration.json>');
    const rows = fs.readFileSync(input, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l));
    const result = calibrate(rows);
    fs.writeFileSync(output, `${JSON.stringify(result, null, 2)}\n`);
    console.log(JSON.stringify(result));
  } catch (err) { console.error(`system-one-calibrate: ${err.message}`); process.exitCode = 1; }
}
module.exports = { decideRow, calibrate };
