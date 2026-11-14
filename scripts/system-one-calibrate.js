#!/usr/bin/env node
'use strict';
// Fits independent option thresholds from the trainer's validation-score artifact.
const fs = require('node:fs');
const { CATALOGS } = require('../harness-everything/scripts/system-one/catalogs');

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

function calibrate(rows, { minPrecision = 0.85, task = 'tier' } = {}) {
  if (!Array.isArray(rows) || !Number.isFinite(minPrecision) || minPrecision < 0 || minPrecision > 1) throw new TypeError('invalid-calibration-input');
  const allIds = scoreIds(task);
  const ids = allIds.filter(id => id !== 'unclassified');
  const normalized = rows.map(row => normalizeRow(row, task, allIds));
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
