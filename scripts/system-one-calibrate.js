#!/usr/bin/env node
'use strict';
// Fits independent option thresholds from the trainer's validation-score artifact.
const fs = require('node:fs');
const { CATALOGS } = require('../harness-everything/scripts/system-one/catalogs');
const { gradedAgreement } = require('../harness-everything/scripts/system-one/intent');

const TIER_IDS = ['tier1', 'tier2', 'tier3'];
const LEGACY_TIER_IDS = [...TIER_IDS, 'unclassified'];

function scoreIds(task) {
  if (task === 'validity') return ['invalid'];
  if (task === 'tier') return TIER_IDS;
  if (task === 'intent') return CATALOGS.intent.map(option => option.id);
  throw new TypeError('unknown-task');
}

function normalizeRow(row, task, ids) {
  if (!row || typeof row !== 'object' || Array.isArray(row)) throw new TypeError('invalid-row');
  if (row.split !== undefined && row.split !== 'validation') throw new TypeError('non-validation-row');
  const legacyIds = task === 'tier' ? LEGACY_TIER_IDS : ids;
  let scores;
  if (Object.hasOwn(row, 'scores')) {
    scores = row.scores;
    if (!scores || typeof scores !== 'object' || Array.isArray(scores)
      || Object.keys(scores).length !== ids.length || ids.some(id => !Object.hasOwn(scores, id))) throw new TypeError('invalid-scores');
  } else if (Array.isArray(row.probs) && row.probs.length === legacyIds.length) {
    scores = Object.fromEntries(legacyIds.map((id, i) => [id, row.probs[i]]));
  } else throw new TypeError('invalid-scores');
  if (Object.values(scores).some(value => !Number.isFinite(value) || value < 0 || value > 1)) throw new TypeError('invalid-scores');

  const goldIds = task === 'validity' ? ['invalid', 'actionable']
    : task === 'tier' ? [...LEGACY_TIER_IDS, null] : [...ids, null];
  if (!goldIds.includes(row.gold) || (row.secondary !== undefined && !Array.isArray(row.secondary))) throw new TypeError('invalid-gold');
  const positive = new Set([row.gold, ...(row.secondary || [])].filter(id => ids.includes(id) && id !== 'unclassified'));
  return { scores, positive };
}

function fitOption(rows, id, minPrecision) {
  let best = null;
  const candidates = [...new Set(rows.map(row => row.scores[id]))].sort((a, b) => a - b);
  for (const threshold of candidates) {
    let accepted = 0; let correct = 0;
    for (const row of rows) {
      if (row.scores[id] < threshold) continue;
      accepted++;
      if (row.positive.has(id)) correct++;
    }
    const precision = correct / accepted;
    if (precision < minPrecision) continue;
    const result = { feasible: true, threshold, accepted, coverage: accepted / rows.length, precision };
    if (!best || result.coverage > best.coverage || (result.coverage === best.coverage && threshold < best.threshold)) best = result;
  }
  return best || { feasible: false, threshold: null, accepted: 0, coverage: 0, precision: null };
}

function calibrateLegacy(rows, task, ids, minPrecision) {
  const multi = task === 'intent';
  const secondaryThreshold = multi ? (() => {
    let best = null;
    for (let s = 5; s <= 50; s += 5) {
      let tp = 0; let fp = 0; let fn = 0;
      for (const row of rows) {
        const primary = ids[row.probs.indexOf(Math.max(...row.probs))];
        const predicted = new Set(ids.filter((id, i) => id !== primary && id !== 'unclassified' && row.probs[i] >= s / 100));
        const gold = new Set(row.secondary || []);
        for (const id of predicted) (gold.has(id) ? tp++ : fp++);
        for (const id of gold) if (!predicted.has(id)) fn++;
      }
      const f1 = 2 * tp + fp + fn ? 2 * tp / (2 * tp + fp + fn) : 0;
      if (!best || f1 > best.f1) best = { threshold: s / 100, f1 };
    }
    return best.threshold;
  })() : undefined;
  const decide = (probs, minConfidence, minMargin) => {
    const ranked = probs.map((probability, index) => [probability, index]).sort((a, b) => b[0] - a[0] || a[1] - b[1]);
    const [top, second] = ranked;
    const margin = top[0] - second[0];
    return margin === 0 || top[0] < minConfidence || margin < minMargin || ids[top[1]] === 'unclassified' ? null : ids[top[1]];
  };
  const secondaryOf = (probs, primary) => ids.filter((id, i) => id !== primary && id !== 'unclassified' && probs[i] >= secondaryThreshold);
  let best = null;
  for (let c = 50; c <= 99; c++) {
    for (let m = 0; m <= 90; m += 5) {
      const minConfidence = c / 100; const minMargin = m / 100;
      let accepted = 0; let points = 0; let exact = 0;
      for (const row of rows) {
        const prediction = decide(row.probs, minConfidence, minMargin);
        if (prediction === null) continue;
        accepted++;
        points += multi ? gradedAgreement({ gold: row.gold, secondary: row.secondary || [] },
          { gold: prediction, secondary: secondaryOf(row.probs, prediction) })
          : Number(prediction === (row.gold === null ? 'unclassified' : row.gold));
        if (prediction === row.gold) exact++;
      }
      const precision = accepted ? points / accepted : 0;
      if (!accepted || precision < minPrecision) continue;
      const coverage = accepted / rows.length;
      if (!best || coverage > best.coverage) best = { minConfidence, minMargin, coverage, precision, accepted,
        ...(multi ? { exactPrecision: exact / accepted } : {}) };
    }
  }
  const extra = multi ? { task, secondaryThreshold } : {};
  return best ? { feasible: true, rows: rows.length, minPrecision, ...extra, ...best }
    : { feasible: false, rows: rows.length, minPrecision, ...extra, minConfidence: null, minMargin: null, coverage: 0, precision: null, accepted: 0 };
}

function calibrate(rows, { minPrecision = 0.85, task = 'tier' } = {}) {
  if (!Array.isArray(rows) || !Number.isFinite(minPrecision) || minPrecision < 0 || minPrecision > 1) throw new TypeError('invalid-calibration-input');
  const allIds = scoreIds(task);
  const ids = allIds.filter(id => id !== 'unclassified');
  const normalized = rows.map(row => normalizeRow(row, task, allIds));
  // Legacy simplex artifacts keep single-winner calibration; keyed scores are sigmoid targets.
  if (task !== 'validity' && rows.length && rows.every(row => !Object.hasOwn(row, 'scores') && Array.isArray(row.probs)
    && Math.abs(row.probs.reduce((sum, probability) => sum + probability, 0) - 1) <= 1e-6)) {
    return calibrateLegacy(rows, task, allIds, minPrecision);
  }
  const options = Object.fromEntries(ids.map(id => [id, fitOption(normalized, id, minPrecision)]));
  return { feasible: ids.every(id => options[id].feasible), task, rows: normalized.length, minPrecision,
    thresholds: Object.fromEntries(ids.map(id => [id, options[id].threshold])), options };
}

if (require.main === module) {
  try {
    const args = process.argv.slice(2);
    const ti = args.indexOf('--task'); const task = ti >= 0 ? args.splice(ti, 2)[1] : 'tier';
    const [input, output, extra] = args;
    if (!input || !output || extra) throw new Error('usage: system-one-calibrate.js <val-scores.jsonl> <calibration.json> [--task validity|intent|tier]');
    const rows = fs.readFileSync(input, 'utf8').split('\n').filter(Boolean).map(line => JSON.parse(line));
    fs.writeFileSync(output, JSON.stringify(calibrate(rows, { task }), null, 2) + '\n');
    console.log(JSON.stringify({ task, rows: rows.length }));
  } catch (err) { console.error(`system-one-calibrate: ${err.message}`); process.exitCode = 1; }
}
module.exports = { calibrate };
