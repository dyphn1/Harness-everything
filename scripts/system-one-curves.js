#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { isDeepStrictEqual } = require('node:util');
const { STAGES, validateVersionManifest } = require('../harness-everything/scripts/system-one/manifest');
const { assertPrivateHistoryFile, appendPrivateHistory } = require('./system-one-cycle/common');

const STAGE_SET = new Set(STAGES);
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
  try { validateVersionManifest(manifest, version); } catch (_) { fail(); }
  for (const entry of Object.values(manifest.stages)) {
    if (!fs.existsSync(path.join(dir, entry.weights)) || !fs.existsSync(path.join(dir, entry.config))) fail();
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

function decision(row, stage, options, referenceOnly) {
  if (stage === 'validity') {
    const probability = row.scores.invalid;
    if (referenceOnly.includes('invalid')) return { confidence: 1 - probability, correct: !row.positive.has('invalid') };
    const id = probability >= 0.5 ? 'invalid' : 'actionable';
    // gold actionable has positive = Set([]), so compare predicted-vs-gold validity equivalence.
    return { confidence: Math.max(probability, 1 - probability), correct: (id === 'invalid') === row.positive.has('invalid') };
  }
  const selectable = options.filter(option => !referenceOnly.includes(option) && !(stage === 'intent' && option === 'unclassified'));
  if (!selectable.length) return { confidence: null, correct: false };
  let id = selectable[0];
  for (const option of selectable.slice(1)) if (row.scores[option] > row.scores[id]) id = option;
  return { confidence: row.scores[id], correct: row.positive.has(id) };
}

function coverageCurve(rows, stage, options, referenceOnly) {
  const decisions = rows.map(row => decision(row, stage, options, referenceOnly));
  return Array.from({ length: 101 }, (_, i) => {
    const confidence = i / 100;
    let count = 0; let correct = 0;
    for (const item of decisions) {
      if (item.confidence === null || item.confidence < confidence) continue;
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

function scoreRows(rows, stage, options, referenceOnly = []) {
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
  const curve = coverageCurve(rows, stage, options, referenceOnly);
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
    const baseline = baselineForStage(history, stage);
    const prior = baseline?.metrics ? {
      auc: baseline.metrics.coverageAccuracyAuc,
      logLoss: baseline.metrics.logLoss,
      ece: baseline.metrics.ece,
    } : null;
    if (!prior) {
      baselineMissing = true;
      detail.stages[stage] = { coverageAccuracyAuc: current.auc, logLoss: current.logLoss, ece: current.ece,
        baselineAvailable: false, ...(baseline?.version ? { baselineVersion: baseline.version } : {}) };
      continue;
    }
    detail.stages[stage] = { coverageAccuracyAuc: current.auc, logLoss: current.logLoss, ece: current.ece,
      baselineAvailable: true, baselineVersion: baseline.version };
    const deltas = metricDeltas(current, prior);
    if (!noWorse(deltas)) oldHoldoutRegression = true;
    detail.stages[stage].deltas = deltas;
  }
  const baselineVersions = Object.values(detail.stages).map(stage => stage.baselineVersion);
  if (baselineVersions.length && baselineVersions.every(isText) && new Set(baselineVersions).size === 1) {
    detail.baselineVersion = baselineVersions[0];
  }
  if (oldHoldoutRegression) detail.status = 'regression';
  else if (baselineMissing || Object.keys(holdout).length === 0) detail.status = 'baseline-unavailable';
  return { oldHoldoutRegression, detail };
}

function floorMetrics(item, stage) {
  const metrics = item?.floor?.detail?.stages?.[stage];
  return metrics && [metrics.coverageAccuracyAuc, metrics.logLoss, metrics.ece].every(Number.isFinite) ? metrics : null;
}

function baselineForStage(history, stage) {
  let version;
  for (const item of history) {
    const stageVersion = item.floor?.detail?.stages?.[stage]?.baselineVersion;
    const legacyVersion = item.floor?.detail?.baselineVersion;
    if (isText(stageVersion) || isText(legacyVersion)) {
      version = isText(stageVersion) ? stageVersion : legacyVersion;
      break;
    }
  }
  if (version) {
    const item = history.find(row => row.version === version);
    return { version, metrics: floorMetrics(item, stage) };
  }
  const item = history.find(row => floorMetrics(row, stage));
  return item ? { version: item.version, metrics: floorMetrics(item, stage) } : null;
}

function readHistory(file) {
  if (!fs.existsSync(file)) return [];
  let lines;
  try { lines = fs.readFileSync(file, 'utf8').split(/\r?\n/).filter(line => line.trim()); } catch (_) { fail(); }
  try {
    const history = lines.map(line => JSON.parse(line));
    const versions = new Set();
    for (const item of history) {
      validateCurveRecord(item);
      if (versions.has(item.version)) fail();
      versions.add(item.version);
    }
    return history;
  } catch (_) { fail(); }
}

function validateCurveRecord(curves) {
  if (!isObject(curves) || curves.schemaVersion !== 1 || !isText(curves.version) || !isText(curves.createdAt)
    || !isObject(curves.stages) || !Object.keys(curves.stages).length
    || !isObject(curves.floor) || typeof curves.floor.oldHoldoutRegression !== 'boolean'
    || !isObject(curves.floor.detail) || !isObject(curves.floor.detail.stages)
    || !['unknown', 'checked', 'regression', 'baseline-unavailable'].includes(curves.floor.detail.status)
    || (curves.floor.detail.baselineVersion !== null && curves.floor.detail.baselineVersion !== undefined
      && !isText(curves.floor.detail.baselineVersion))) fail();
  for (const [stage, metrics] of Object.entries(curves.stages)) {
    if (!STAGE_SET.has(stage) || !isObject(metrics) || ![metrics.logLoss, metrics.brier, metrics.ece].every(Number.isFinite)
      || !Array.isArray(metrics.coverageCurve) || metrics.coverageCurve.length !== 101
      || metrics.coverageCurve.some(point => !Array.isArray(point) || point.length !== 3
        || !Number.isFinite(point[0]) || point[0] < 0 || point[0] > 1
        || !Number.isFinite(point[1]) || point[1] < 0 || point[1] > 1
        || (point[2] !== null && (!Number.isFinite(point[2]) || point[2] < 0 || point[2] > 1)))) fail();
  }
  for (const [stage, metrics] of Object.entries(curves.floor.detail.stages)) {
    if (!Object.hasOwn(curves.stages, stage) || !isObject(metrics)
      || ![metrics.coverageAccuracyAuc, metrics.logLoss, metrics.ece].every(Number.isFinite)
      || typeof metrics.baselineAvailable !== 'boolean'
      || (metrics.baselineVersion !== undefined && !isText(metrics.baselineVersion))) fail();
    if (metrics.baselineAvailable && (!isObject(metrics.deltas)
      || !['auc', 'logLoss', 'ece'].every(key => Number.isFinite(metrics.deltas[key]))
      || (!isText(metrics.baselineVersion) && !isText(curves.floor.detail.baselineVersion)))) fail();
  }
}

function withoutCreatedAt(curves) {
  const immutable = JSON.parse(JSON.stringify(curves));
  delete immutable.createdAt;
  for (const stage of Object.values(immutable.floor?.detail?.stages || {})) {
    if (!isText(stage.baselineVersion) && isText(immutable.floor.detail.baselineVersion)) {
      stage.baselineVersion = immutable.floor.detail.baselineVersion;
    }
  }
  return immutable;
}

function assertVersionReusable(history, curves) {
  const existing = history.find(item => item.version === curves.version);
  if (existing && !isDeepStrictEqual(withoutCreatedAt(existing), withoutCreatedAt(curves))) fail();
  return existing;
}

function validateSavedCurves(curves, version, manifest) {
  validateCurveRecord(curves);
  if (curves.version !== version || Object.keys(curves.stages).length !== Object.keys(manifest.stages).length
    || Object.keys(curves.stages).some(stage => !Object.hasOwn(manifest.stages, stage))) fail();
}

function validateSavedTrend(trend, version) {
  if (!isObject(trend) || !['promote', 'hold', 'rollback'].includes(trend.verdict)
    || !Array.isArray(trend.compared) || trend.compared.some(version => !isText(version))
    || !trend.compared.includes(version)
    || !Array.isArray(trend.reasons) || trend.reasons.some(reason => !isText(reason))) fail();
}

function validateBaselineReferences(curves, history) {
  for (const [stage, baseline] of Object.entries(curves.floor.detail.stages)) {
    if (baseline.baselineAvailable !== true) continue;
    const baselineVersion = isText(baseline.baselineVersion) ? baseline.baselineVersion : curves.floor.detail.baselineVersion;
    if (!isText(baselineVersion) || !floorMetrics(history.find(row => row.version === baselineVersion), stage)) fail();
  }
}

function appendHistoryRow(file, history, curves) {
  if (assertVersionReusable(history, curves)) return;
  appendPrivateHistory(file, `${JSON.stringify(curves)}\n`);
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
    if (!STAGE_SET.has(stage) || !isText(file) || Object.hasOwn(result, stage)) fail();
    result[stage] = file;
  }
  return result;
}

function parseArgs(argv) {
  const parsed = { val: [], holdout: [] };
  const names = { '--version': 'version', '--version-dir': 'versionDir', '--val-scores': 'val', '--holdout-scores': 'holdout',
    '--history': 'history', '--out': 'out', '--resume-curves': 'resumeCurves' };
  for (let i = 0; i < argv.length; i++) {
    const key = names[argv[i]]; const value = argv[++i];
    if (!key || value === undefined) fail();
    if (key === 'val' || key === 'holdout') parsed[key].push(value);
    else if (Object.hasOwn(parsed, key)) fail();
    else parsed[key] = value;
  }
  if (!isText(parsed.version) || !isText(parsed.versionDir) || !isText(parsed.history) || !isText(parsed.out)) fail();
  if (parsed.resumeCurves) {
    if (!isText(parsed.resumeCurves) || parsed.val.length || parsed.holdout.length) fail();
  } else if (!parsed.val.length) fail();
  return parsed;
}

function run(argv) {
  const args = parseArgs(argv);
  args.history = assertPrivateHistoryFile(args.history);
  const manifest = readManifest(args.versionDir, args.version);
  if (args.resumeCurves) {
    let curves; let trend;
    try {
      curves = JSON.parse(fs.readFileSync(args.resumeCurves, 'utf8'));
      trend = JSON.parse(fs.readFileSync(path.join(args.out, 'trend.json'), 'utf8'));
    } catch (_) { fail(); }
    validateSavedCurves(curves, args.version, manifest);
    validateSavedTrend(trend, args.version);
    const history = readHistory(args.history);
    validateBaselineReferences(curves, history);
    appendHistoryRow(args.history, history, curves);
    console.log(JSON.stringify({ resumed: true, version: args.version }));
    return { curves, trend };
  }
  const valFiles = stageFiles(args, 'val');
  const holdoutFiles = stageFiles(args, 'holdout');
  if (Object.keys(holdoutFiles).some(stage => !Object.hasOwn(valFiles, stage))) fail();
  const stages = {}; const holdoutMetrics = {};
  for (const [stage, file] of Object.entries(valFiles)) {
    const entry = manifest.stages[stage];
    if (!entry) fail();
    const valRows = readRows(file, stage, entry.options);
    const referenceOnly = entry.referenceOnly ?? [];
    stages[stage] = scoreRows(valRows, stage, entry.options, referenceOnly);
    if (holdoutFiles[stage]) {
      const holdoutRows = readRows(holdoutFiles[stage], stage, entry.options);
      const valIds = new Set(valRows.map(row => row.id));
      if (holdoutRows.some(row => valIds.has(row.id))) fail();
      holdoutMetrics[stage] = scoreRows(holdoutRows, stage, entry.options, referenceOnly);
    }
  }
  if (Object.keys(holdoutFiles).length && Object.keys(holdoutFiles).length !== Object.keys(valFiles).length) fail();
  const history = readHistory(args.history);
  const floor = assessFloor(Object.keys(holdoutMetrics).length ? holdoutMetrics : null, history);
  const curves = { schemaVersion: 1, version: args.version, createdAt: new Date().toISOString(), stages, floor };
  const existing = assertVersionReusable(history, curves);
  validateBaselineReferences(curves, history);
  const trend = decideTrend(curves, history, floor);
  fs.mkdirSync(args.out, { recursive: true });
  fs.writeFileSync(path.join(args.out, 'curves.json'), `${JSON.stringify(curves, null, 2)}\n`);
  fs.writeFileSync(path.join(args.out, 'trend.json'), `${JSON.stringify(trend, null, 2)}\n`);
  if (!existing) appendHistoryRow(args.history, history, curves);
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
