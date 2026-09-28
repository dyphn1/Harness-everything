#!/usr/bin/env node
'use strict';
// Chooses System One acceptance thresholds on validation scores (docs/system-one-training.md).
// The holdout is never used here.
const fs = require('node:fs');
const { CATALOGS } = require('../harness-everything/scripts/system-one/catalogs');
const { gradedAgreement } = require('../harness-everything/scripts/system-one/intent');

const IDS = ['tier1', 'tier2', 'tier3', 'unclassified'];
// Same acceptance rule as contract.decide: top probability and top-minus-second margin, unclassified abstains.
function decideRow(probs, { minConfidence, minMargin }, ids = IDS) {
  const order = probs.map((p, i) => [p, i]).sort((a, b) => b[0] - a[0] || a[1] - b[1]);
  const [top, second] = order;
  const margin = top[0] - second[0];
  if (margin === 0 || top[0] < minConfidence || margin < minMargin || ids[top[1]] === 'unclassified') return null;
  return ids[top[1]];
}
// Predicted secondary intents: every other catalog intent at or above the threshold.
const secondaryOf = (probs, primary, threshold, ids) => ids.filter((id, i) => id !== primary && id !== 'unclassified' && probs[i] >= threshold);
// Threshold with the best secondary micro-F1 on validation; ties keep the lowest.
function secondaryThreshold(rows, ids) {
  let best = null;
  for (let s = 5; s <= 50; s += 5) {
    let tp = 0; let fp = 0; let fn = 0;
    for (const r of rows) {
      const primary = ids[r.probs.indexOf(Math.max(...r.probs))];
      const predicted = new Set(secondaryOf(r.probs, primary, s / 100, ids)); const gold = new Set(r.secondary || []);
      for (const x of predicted) (gold.has(x) ? tp++ : fp++);
      for (const x of gold) if (!predicted.has(x)) fn++;
    }
    const f1 = 2 * tp + fp + fn ? 2 * tp / (2 * tp + fp + fn) : 0;
    if (!best || f1 > best.f1) best = { threshold: s / 100, f1 };
  }
  return best.threshold;
}
function calibrate(rows, { minPrecision = 0.85, task = 'tier' } = {}) {
  const ids = CATALOGS[task].map(o => o.id);
  const multi = task === 'intent';
  const sThreshold = multi ? secondaryThreshold(rows, ids) : undefined;
  // Intent rows score by graded agreement against { gold, secondary }; tier rows by exact match.
  const score = (r, d) => (multi ? gradedAgreement({ gold: r.gold, secondary: r.secondary || [] }, { gold: d, secondary: secondaryOf(r.probs, d, sThreshold, ids) })
    : Number(d === (r.gold === null ? 'unclassified' : r.gold)));
  let best = null;
  for (let c = 50; c <= 99; c++) {
    for (let m = 0; m <= 90; m += 5) {
      const t = { minConfidence: c / 100, minMargin: m / 100 };
      let accepted = 0; let points = 0; let exact = 0;
      for (const r of rows) { const d = decideRow(r.probs, t, ids); if (d) { accepted++; points += score(r, d); if (d === r.gold) exact++; } }
      const precision = accepted ? points / accepted : 0;
      if (!accepted || precision < minPrecision) continue;
      const coverage = accepted / rows.length;
      // Highest coverage wins; ties keep the first (lowest) thresholds scanned.
      if (!best || coverage > best.coverage) best = { ...t, coverage, precision, accepted, ...(multi ? { exactPrecision: exact / accepted } : {}) };
    }
  }
  const extra = multi ? { task, secondaryThreshold: sThreshold } : {};
  return best ? { feasible: true, rows: rows.length, minPrecision, ...extra, ...best }
    : { feasible: false, rows: rows.length, minPrecision, ...extra, minConfidence: null, minMargin: null, coverage: 0, precision: null, accepted: 0 };
}

if (require.main === module) {
  try {
    const args = process.argv.slice(2);
    const ti = args.indexOf('--task'); const task = ti >= 0 ? args.splice(ti, 2)[1] : 'tier';
    const [input, output, extra] = args;
    if (!input || !output || extra || !Object.hasOwn(CATALOGS, task)) throw new Error('usage: system-one-calibrate.js <val-scores.jsonl> <calibration.json> [--task tier|intent]');
    const rows = fs.readFileSync(input, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l));
    const result = calibrate(rows, { task });
    fs.writeFileSync(output, `${JSON.stringify(result, null, 2)}\n`);
    console.log(JSON.stringify(result));
  } catch (err) { console.error(`system-one-calibrate: ${err.message}`); process.exitCode = 1; }
}
module.exports = { decideRow, calibrate };
