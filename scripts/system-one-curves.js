#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const STAGES = new Set(['validity', 'intent', 'tier']);
const EPSILON = 1e-12;
const LOG_EPSILON = Number.EPSILON;
const fail = () => { throw new TypeError('invalid-system-one-curves-input'); };
const isObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const isText = value => typeof value === 'string' && value.trim().length > 0;
const isProbability = value => Number.isFinite(value) && value >= 0 && value <= 1;

function readJsonl(file) {
  let lines;
  try { lines = fs.readFileSync(file, 'utf8').split(/\r?\n/).filter(line => line.trim()); } catch (_) { fail(); }
  if (!lines.length) fail();
  try { return lines.map(line => JSON.parse(line)); } catch (_) { fail(); }
}

function readManifest(dir, version) {
  let manifest;
  try { manifest = JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8')); } catch (_) { fail(); }
  if (!isObject(manifest) || manifest.schemaVersion !== 1 || manifest.version !== version
    || !isText(manifest.createdAt) || !isObject(manifest.stages)
    || !(manifest.evaluation === null || isText(manifest.evaluation))) fail();
  for (const [stage, entry] of Object.entries(manifest.stages)) {
    if (!STAGES.has(stage) || !isObject(entry) || !isText(entry.weights) || path.basename(entry.weights) !== entry.weights
      || !isText(entry.config) || path.basename(entry.config) !== entry.config
      || !fs.existsSync(path.join(dir, entry.weights)) || !fs.existsSync(path.join(dir, entry.config))
      || !/^[a-f\d]{64}$/i.test(entry.sha256) || !Array.isArray(entry.options) || !entry.options.length
      || entry.options.some(option => !isText(option)) || new Set(entry.options).size !== entry.options.length
      || !isObject(entry.thresholds) || Object.entries(entry.thresholds).some(([id, value]) => !entry.options.includes(id) || !isProbability(value))) fail();
  }
  return manifest;
}

function positives(row, stage, options) {
  if (stage === 'validity') {
    if (!['invalid', 'actionable'].includes(row.gold) || options.length !== 1 || options[0] !== 'invalid') fail();
    return new Set(row.gold === 'invalid' ? ['invalid'] : []);
  }
  if (stage === 'tier') {
    if (!isText(row.gold) || !options.includes(row.gold)) fail();
    return new Set([row.gold]);
  }
  const gold = Array.isArray(row.gold) ? row.gold : [row.gold];
  if (gold.some(id => !isText(id) || !options.includes(id)) || new Set(gold).size !== gold.length) fail();
  return new Set(gold);
}

function readRows(file, stage, options) {
  const rows = readJsonl(file);
  const ids = new Set();
  return rows.map(row => {
    if (!isObject(row) || Object.keys(row).length !== 3 || !Object.hasOwn(row, 'id')
      || !Object.hasOwn(row, 'gold') || !Object.hasOwn(row, 'scores') || !isText(row.id) || ids.has(row.id)
      || !isObject(row.scores) || Object.keys(row.scores).length !== options.length
      || options.some(option => !Object.hasOwn(row.scores, option) || !isProbability(row.scores[option]))) fail();
    ids.add(row.id);
    return { id: row.id, positive: positives(row, stage, options), scores: row.scores };
  });
}

function quantile(values, probability) {
  const sorted = [...values].sort((a, b) => a - b);
  const position = (sorted.length - 1) * probability;
  const lower = Math.floor(position);
  const fraction = position - lower;
  return sorted[lower] + (sorted[Math.min(lower + 1, sorted.length - 1)] - sorted[lower]) * fraction;
}

function decision(row, stage, options) {
  if (stage === 'validity') {
    const probability = row.scores.invalid;
    const id = probability >= 0.5 ? 'invalid' : 'actionable';
    return { confidence: Math.max(probability, 1 - probability), correct: row.positive.has(id) };
  }
  let id = options[0];
  for (const option of options.slice(1)) if (row.scores[option] > row.scores[id]) id = option;
  return { confidence: row.scores[id], correct: row.positive.has(id) };
}

function coverageCurve(rows, stage, options) {
  const decisions = rows.map(row => decision(row, stage, options));
  return Array.from({ length: 101 }, (_, i) => {
    const confidence = i / 100;
    let count = 0; let correct = 0;
    for (const item of decisions) {
      if (item.confidence < confidence) continue;
      count++;
      if (item.correct) correct++;
    }
    return [confidence, count / rows.length, count ? correct / count : null];
  });
}

function coverageAccuracyAuc(curve) {
  const points = curve.filter(([, coverage, accuracy]) => coverage > 0 && Number.isFinite(accuracy));
  if (!points.length) return 0;
  let area = 0;
  for (let i = 1; i < points.length; i++) {
    const width = Math.abs(points[i - 1][1] - points[i][1]);
    area += width * (points[i - 1][2] + points[i][2]) / 2;
  }
  const last = points[points.length - 1];
  return area + last[1] * last[2];
}

function scoreRows(rows, stage, options) {
  const bins = Array.from({ length: 10 }, (_, i) => ({ low: i / 10, high: (i + 1) / 10, sum: 0, positive: 0, n: 0 }));
  const distributions = Object.fromEntries(options.map(option => [option, []]));
  let logLoss = 0; let brier = 0; let count = 0;
  for (const row of rows) {
    for (const option of options) {
      const probability = row.scores[option];
      const target = row.positive.has(option) ? 1 : 0;
      const clipped = Math.min(1 - LOG_EPSILON, Math.max(LOG_EPSILON, probability));
      logLoss -= target ? Math.log(clipped) : Math.log(1 - clipped);
      brier += (probability - target) ** 2;
      const bin = bins[Math.min(9, Math.floor(probability * 10))];
      bin.sum += probability; bin.positive += target; bin.n++;
      distributions[option].push(probability);
      count++;
    }
  }
  const reliability = bins.map(bin => [bin.low, bin.high, bin.n ? bin.sum / bin.n : null,
    bin.n ? bin.positive / bin.n : null, bin.n]);
  const ece = bins.reduce((sum, bin) => sum + (bin.n / count) * (bin.n ? Math.abs(bin.sum / bin.n - bin.positive / bin.n) : 0), 0);
  const curve = coverageCurve(rows, stage, options);
  return {
    logLoss: logLoss / count,
    brier: brier / count,
    ece,
    reliability,
    coverageCurve: curve,
    optionDistributions: Object.fromEntries(options.map(option => [option,
      [0.05, 0.25, 0.5, 0.75, 0.95].map(q => quantile(distributions[option], q))])),
  };
}

function comparisonMetrics(metrics) {
  return { auc: coverageAccuracyAuc(metrics.coverageCurve), logLoss: metrics.logLoss, ece: metrics.ece };
}

function metricDeltas(current, previous) {
  return { auc: current.auc - previous.auc, logLoss: current.logLoss - previous.logLoss, ece: current.ece - previous.ece };
}

function noWorse(deltas) {
  return deltas.auc >= -EPSILON && deltas.logLoss <= EPSILON && deltas.ece <= EPSILON;
}

function noBetter(deltas) {
  return deltas.auc <= EPSILON && deltas.logLoss >= -EPSILON && deltas.ece >= -EPSILON;
}

function strictlyWorse(deltas) {
  return deltas.auc < -EPSILON || deltas.logLoss > EPSILON || deltas.ece > EPSILON;
}

function fmt(value) {
  return `${value >= 0 ? '+' : ''}${value.toFixed(6)}`;
}

function assessFloor(holdout, history) {
  if (!holdout) return { oldHoldoutRegression: false, detail: { status: 'unknown', stages: {} } };
  const detail = { status: 'checked', stages: {}, baselineVersion: null };
  let oldHoldoutRegression = false;
  let baselineMissing = false;
  for (const [stage, metrics] of Object.entries(holdout)) {
    const current = comparisonMetrics(metrics);
    const previous = [...history].reverse().find(item => Number.isFinite(item.floor?.detail?.stages?.[stage]?.coverageAccuracyAuc));
    if (previous && !detail.baselineVersion) detail.baselineVersion = previous.version;
    const baseline = previous?.floor.detail.stages[stage];
    const prior = baseline && Number.isFinite(baseline.coverageAccuracyAuc)
      ? { auc: baseline.coverageAccuracyAuc, logLoss: baseline.logLoss, ece: baseline.ece } : null;
    if (!prior) {
      baselineMissing = true;
      detail.stages[stage] = { coverageAccuracyAuc: current.auc, logLoss: current.logLoss, ece: current.ece, baselineAvailable: false };
      continue;
    }
    const deltas = metricDeltas(current, prior);
    if (!noWorse(deltas)) oldHoldoutRegression = true;
    detail.stages[stage] = { coverageAccuracyAuc: current.auc, logLoss: current.logLoss, ece: current.ece, deltas, baselineAvailable: true };
  }
  if (oldHoldoutRegression) detail.status = 'regression';
  else if (baselineMissing || Object.keys(holdout).length === 0) detail.status = 'baseline-unavailable';
  return { oldHoldoutRegression, detail };
}

function readHistory(file) {
  if (!fs.existsSync(file)) return [];
  let lines;
  try { lines = fs.readFileSync(file, 'utf8').split(/\r?\n/).filter(line => line.trim()); } catch (_) { fail(); }
  try {
    const history = lines.map(line => JSON.parse(line));
    if (history.some(item => !isObject(item) || item.schemaVersion !== 1 || !isText(item.version) || !isObject(item.stages))) fail();
    return history;
  } catch (_) { fail(); }
}

function worseningCycles(history, stages) {
  if (history.length < 3) return null;
  // shortcut: history has no active-version field, so its latest three records stand in for the active trend; upgrade when the shared schema records active identity.
  const [older, previous, active] = history.slice(-3);
  for (const stage of Object.keys(stages)) {
    const a = older.stages?.[stage]; const b = previous.stages?.[stage]; const c = active.stages?.[stage];
    if (!a?.coverageCurve || !b?.coverageCurve || !c?.coverageCurve) continue;
    const first = metricDeltas(comparisonMetrics(b), comparisonMetrics(a));
    const second = metricDeltas(comparisonMetrics(c), comparisonMetrics(b));
    if (!noBetter(first) || !strictlyWorse(first) || !noBetter(second) || !strictlyWorse(second)) continue;
    return { stage, first, second, versions: [older.version, previous.version, active.version] };
  }
  return null;
}

function decideTrend(candidate, history, floor) {
  const reasons = [];
  const previous = history.at(-1);
  let candidateNoWorse = !!previous;
  if (!previous) {
    candidateNoWorse = false;
    reasons.push('no previous version is available for curve comparison');
  } else {
    for (const [stage, metrics] of Object.entries(candidate.stages)) {
      const priorMetrics = previous.stages?.[stage];
      if (!priorMetrics?.coverageCurve) {
        candidateNoWorse = false;
        reasons.push(`${stage} curves cannot be compared with ${previous.version}`);
        continue;
      }
      const deltas = metricDeltas(comparisonMetrics(metrics), comparisonMetrics(priorMetrics));
      for (const [name, value] of Object.entries(deltas)) reasons.push(`${stage} ${name === 'auc' ? 'coverage-accuracy AUC' : name === 'logLoss' ? 'log-loss' : 'ECE'} delta ${fmt(value)} vs ${previous.version}`);
      if (!noWorse(deltas)) candidateNoWorse = false;
    }
  }
  const floorAllowsPromotion = floor.detail.status === 'checked' && !floor.oldHoldoutRegression;
  for (const [stage, metrics] of Object.entries(floor.detail.stages)) {
    if (!metrics.deltas) continue;
    const detail = Object.entries(metrics.deltas).map(([name, value]) => `${name === 'auc' ? 'coverage-accuracy AUC' : name === 'logLoss' ? 'log-loss' : 'ECE'} delta ${fmt(value)}`).join(', ');
    reasons.push(`${stage} old-holdout ${noWorse(metrics.deltas) ? 'curve deltas' : 'regression'}: ${detail}`);
  }
  if (!floorAllowsPromotion && !floor.oldHoldoutRegression) reasons.push(`old-holdout floor ${floor.detail.status}; promotion requires a checked floor`);
  if (candidateNoWorse && floorAllowsPromotion) return { compared: [...history.slice(-3).map(item => item.version), candidate.version], verdict: 'promote', reasons };

  const worsening = worseningCycles(history, candidate.stages);
  if (worsening) {
    reasons.push(`${worsening.stage} active curve worsened across two consecutive cycles (${worsening.versions.join(' → ')}): `
      + `coverage-accuracy AUC ${fmt(worsening.first.auc)}, ${fmt(worsening.second.auc)}; `
      + `log-loss ${fmt(worsening.first.logLoss)}, ${fmt(worsening.second.logLoss)}; `
      + `ECE ${fmt(worsening.first.ece)}, ${fmt(worsening.second.ece)}`);
    return { compared: [...history.slice(-3).map(item => item.version), candidate.version], verdict: 'rollback', reasons };
  }
  return { compared: [...history.slice(-3).map(item => item.version), candidate.version], verdict: 'hold', reasons };
}

function stageFiles(args, option) {
  const result = {};
  for (const value of args[option]) {
    const split = value.indexOf('=');
    if (split < 1) fail();
    const stage = value.slice(0, split); const file = value.slice(split + 1);
    if (!STAGES.has(stage) || !isText(file) || Object.hasOwn(result, stage)) fail();
    result[stage] = file;
  }
  return result;
}

function parseArgs(argv) {
  const parsed = { val: [], holdout: [] };
  const names = { '--version': 'version', '--version-dir': 'versionDir', '--val-scores': 'val', '--holdout-scores': 'holdout', '--history': 'history', '--out': 'out' };
  for (let i = 0; i < argv.length; i++) {
    const key = names[argv[i]]; const value = argv[++i];
    if (!key || value === undefined) fail();
    if (key === 'val' || key === 'holdout') parsed[key].push(value);
    else if (Object.hasOwn(parsed, key)) fail();
    else parsed[key] = value;
  }
  if (!isText(parsed.version) || !isText(parsed.versionDir) || !parsed.val.length || !isText(parsed.history) || !isText(parsed.out)) fail();
  return parsed;
}

function run(argv) {
  const args = parseArgs(argv);
  const manifest = readManifest(args.versionDir, args.version);
  const valFiles = stageFiles(args, 'val');
  const holdoutFiles = stageFiles(args, 'holdout');
  if (Object.keys(holdoutFiles).some(stage => !Object.hasOwn(valFiles, stage))) fail();
  const stages = {}; const holdoutMetrics = {};
  for (const [stage, file] of Object.entries(valFiles)) {
    const entry = manifest.stages[stage];
    if (!entry) fail();
    const valRows = readRows(file, stage, entry.options);
    stages[stage] = scoreRows(valRows, stage, entry.options);
    if (holdoutFiles[stage]) {
      const holdoutRows = readRows(holdoutFiles[stage], stage, entry.options);
      const valIds = new Set(valRows.map(row => row.id));
      if (holdoutRows.some(row => valIds.has(row.id))) fail();
      holdoutMetrics[stage] = scoreRows(holdoutRows, stage, entry.options);
    }
  }
  if (Object.keys(holdoutFiles).length && Object.keys(holdoutFiles).length !== Object.keys(valFiles).length) fail();
  const history = readHistory(args.history);
  const floor = assessFloor(Object.keys(holdoutMetrics).length ? holdoutMetrics : null, history);
  const curves = { schemaVersion: 1, version: args.version, createdAt: new Date().toISOString(), stages, floor };
  const trend = decideTrend(curves, history, floor);
  fs.mkdirSync(args.out, { recursive: true });
  fs.mkdirSync(path.dirname(args.history), { recursive: true });
  fs.writeFileSync(path.join(args.out, 'curves.json'), `${JSON.stringify(curves, null, 2)}\n`);
  fs.writeFileSync(path.join(args.out, 'trend.json'), `${JSON.stringify(trend, null, 2)}\n`);
  const oldHistory = fs.existsSync(args.history) ? fs.readFileSync(args.history, 'utf8') : '';
  fs.appendFileSync(args.history, `${oldHistory && !oldHistory.endsWith('\n') ? '\n' : ''}${JSON.stringify(curves)}\n`);
  const summary = Object.fromEntries(Object.entries(stages).map(([stage, value]) => [stage, {
    rows: readJsonl(valFiles[stage]).length,
    logLoss: value.logLoss,
    brier: value.brier,
    ece: value.ece,
    coverageAccuracyAuc: coverageAccuracyAuc(value.coverageCurve),
  }]));
  console.log(JSON.stringify({ rows: Object.values(summary).reduce((sum, item) => sum + item.rows, 0), stages: summary }));
  return { curves, trend };
}

if (require.main === module) {
  try { run(process.argv.slice(2)); } catch (_) {
    console.error('system-one-curves: invalid arguments, manifest, history, or score input');
    process.exitCode = 1;
  }
}

module.exports = { coverageAccuracyAuc, run, scoreRows };
