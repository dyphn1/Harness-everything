'use strict';
const { validateRequest } = require('./contract');
const { CATALOGS, MULTI, goldLabels, validSecondary } = require('./catalogs');
const exact = (obj, keys) => obj && typeof obj === 'object' && !Array.isArray(obj) && Object.keys(obj).length === keys.length && keys.every(k => Object.hasOwn(obj, k));
const nonempty = v => typeof v === 'string' && v.trim().length > 0;
const finite = v => typeof v === 'number' && Number.isFinite(v);
const fail = () => { throw new TypeError('invalid-evaluation-input'); };
// A corpus holds one stage: every request uses that stage's fixed catalog. Returns the stage's gold labels.
function corpusLabels(corpus) {
  if (!exact(corpus, ['schemaVersion', 'cases']) || corpus.schemaVersion !== 1 || !Array.isArray(corpus.cases) || !corpus.cases.length) fail();
  const task = corpus.cases[0]?.request?.task;
  if (!Object.hasOwn(CATALOGS, task)) fail();
  const labels = goldLabels(task); const catalog = JSON.stringify(CATALOGS[task]);
  const ids = new Set(); const hashes = new Set(); const families = new Map();
  for (const c of corpus.cases) {
    if (!exact(c, ['id', 'family', 'split', 'language', 'source', 'reviewed', 'request', 'gold', ...(MULTI.includes(task) ? ['secondary'] : [])])
      || ![c.id, c.family, c.source].every(nonempty) || !['train', 'validation', 'holdout'].includes(c.split)
      || !['en', 'zh-TW'].includes(c.language) || typeof c.reviewed !== 'boolean' || !labels.includes(c.gold)
      || !validSecondary(task, c.gold, c.secondary)) fail();
    validateRequest(c.request);
    if (c.request.task !== task || JSON.stringify(c.request.options) !== catalog
      || ids.has(c.id) || hashes.has(c.request.requestHash) || (families.has(c.family) && families.get(c.family) !== c.split)) fail();
    ids.add(c.id); hashes.add(c.request.requestHash); families.set(c.family, c.split);
  }
  return labels;
}
function validateCorpus(corpus) { corpusLabels(corpus); return true; }
function prediction(decision, labels) {
  if (exact(decision, ['status', 'reason']) && decision.status === 'unavailable' && nonempty(decision.reason)) return null;
  if (!exact(decision, ['status', 'reason', 'selectedId', 'confidence', 'margin', 'model'])
    || !['accepted', 'abstain', 'invalid-output'].includes(decision.status) || !nonempty(decision.reason)
    || !labels.includes(decision.selectedId) || (decision.status === 'accepted') !== (decision.selectedId !== null)) fail();
  for (const key of ['confidence', 'margin']) if (decision[key] !== null && (!finite(decision[key]) || decision[key] < 0 || decision[key] > 1)) fail();
  if (decision.model !== null && (!exact(decision.model, ['id', 'revision', 'domain']) || !Object.values(decision.model).every(nonempty))) fail();
  if (decision.status === 'accepted' && (decision.confidence === null || decision.margin === null || decision.model?.domain !== 'harness-routing-v1')) fail();
  return decision.selectedId;
}
// Scored decisions carry the full catalog-order probability vector; unavailable/invalid outputs carry null.
function checkScores(decision, scores, labels) {
  const scored = ['accepted', 'abstain'].includes(decision.status);
  if (!scored) { if (scores !== null) fail(); return; }
  if (!Array.isArray(scores) || scores.length !== labels.length
    || scores.some(p => !finite(p) || p < 0 || p > 1) || Math.abs(scores.reduce((s, p) => s + p, 0) - 1) > 1e-6) fail();
  const ranked = [...scores].sort((a, b) => b - a);
  if (decision.confidence !== ranked[0] || decision.margin !== ranked[0] - ranked[1]) fail();
}
function metrics(gold, predicted, labels) {
  const count = gold.length;
  const accepted = predicted.filter(x => x !== null).length;
  const correct = predicted.filter((x, i) => x === gold[i]).length;
  const acceptedCorrect = predicted.filter((x, i) => x !== null && x === gold[i]).length;
  const macroF1 = labels.reduce((sum, label) => {
    const tp = gold.filter((g, i) => g === label && predicted[i] === label).length;
    const fp = gold.filter((g, i) => g !== label && predicted[i] === label).length;
    const fn = gold.filter((g, i) => g === label && predicted[i] !== label).length;
    return sum + (2 * tp + fp + fn ? 2 * tp / (2 * tp + fp + fn) : 0);
  }, 0) / labels.length;
  return { accuracy: correct / count, macroF1, coverage: accepted / count, abstentionRate: 1 - accepted / count,
    acceptedPrecision: accepted ? acceptedCorrect / accepted : null,
    acceptedErrorRate: accepted ? (accepted - acceptedCorrect) / accepted : null };
}
function p95(values) { return values.length ? [...values].sort((a, b) => a - b)[Math.ceil(values.length * 0.95) - 1] : null; }
// sourceEvidence is the provider provenance result; only the pinned cua_s1 revision satisfies the gate.
function evaluate(corpus, records, sourceEvidence = null) {
  const labels = corpusLabels(corpus);
  const cases = corpus.cases.filter(c => c.split === 'holdout');
  if (!cases.length || !Array.isArray(records) || records.length !== cases.length) fail();
  const byId = new Map(); const models = new Set(); const cold = []; const warm = [];
  for (const record of records) {
    if (!exact(record, ['id', 'baseline', 'runs']) || byId.has(record.id) || !cases.some(c => c.id === record.id)
      || !labels.includes(record.baseline) || !Array.isArray(record.runs) || record.runs.length !== 2) fail();
    for (const run of record.runs) {
      if (!exact(run, ['decision', 'scores', 'latencyMs', 'coldStart']) || !finite(run.latencyMs) || run.latencyMs < 0 || typeof run.coldStart !== 'boolean') fail();
      prediction(run.decision, labels);
      checkScores(run.decision, run.scores, labels);
      if (run.decision.model) models.add(JSON.stringify([run.decision.model.id, run.decision.model.revision, run.decision.model.domain]));
      (run.coldStart ? cold : warm).push(run.latencyMs);
    }
    byId.set(record.id, record);
  }
  if (models.size > 1) fail();
  const gold = cases.map(c => c.gold);
  const baseline = metrics(gold, cases.map(c => byId.get(c.id).baseline), labels);
  const model = metrics(gold, cases.map(c => prediction(byId.get(c.id).runs[0].decision, labels)), labels);
  const canonicalRun = ({ decision: d, scores }) => JSON.stringify([d.status, d.reason, d.selectedId ?? null, d.confidence ?? null, d.margin ?? null,
    d.model ? [d.model.id, d.model.revision, d.model.domain] : null, scores]);
  const agreement = records.filter(r => canonicalRun(r.runs[0]) === canonicalRun(r.runs[1])).length / cases.length;
  const latency = { coldP95Ms: p95(cold), warmP95Ms: p95(warm), coldSamples: cold.length, warmSamples: warm.length };
  const gates = {
    reviewedHoldout: cases.length >= 200 && cases.every(c => c.reviewed)
      && ['en', 'zh-TW'].every(lang => cases.filter(c => c.language === lang).length >= 50),
    acceptedPrecision: model.acceptedPrecision !== null && model.acceptedPrecision >= 0.85,
    coverage: model.coverage >= 0.8,
    macroF1: model.macroF1 >= baseline.macroF1,
    repeatability: agreement === 1,
    warmLatency: warm.length >= cases.length && latency.warmP95Ms <= 100,
    sourceProvenance: sourceEvidence?.status === 'recorded' && (sourceEvidence.provenance?.cuaS1?.sourceRevisionStatus === 'pinned'
      || (sourceEvidence.transport === 'ngram' && sourceEvidence.artifactVerified === true)),
    policyEvidence: false,
    liveHostEvidence: false,
  };
  return { schemaVersion: 1, cases: cases.length, baseline, model, agreement, latency, gates, rolloutReady: Object.values(gates).every(Boolean) };
}
module.exports = { validateCorpus, evaluate };
