'use strict';
const { createHash } = require('node:crypto');
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const exact = (value, keys) => value && typeof value === 'object' && !Array.isArray(value)
  && Object.keys(value).length === keys.length && keys.every(k => Object.hasOwn(value, k));
const text = (value, max = 4096) => typeof value === 'string' && value.trim().length > 0 && Buffer.byteLength(value, 'utf8') <= max;
const id = value => typeof value === 'string' && /^[a-z0-9._-]{1,80}$/.test(value);
const probability = value => typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1;
function fail(code) { throw Object.assign(new TypeError(code), { code }); }
function createRequest(task, context, options) {
  if (!id(task) || !text(context, 65536) || !Array.isArray(options) || options.length < 2 || options.length > 256
    || options.some(o => !exact(o, ['id', 'text']) || !id(o.id) || !text(o.text))
    || new Set(options.map(o => o.id)).size !== options.length) fail('invalid-request');
  const copy = options.map(o => ({ id: o.id, text: o.text }));
  const catalogHash = hash({ task, options: copy });
  return { schemaVersion: 1, task, context, options: copy, catalogHash, requestHash: hash({ catalogHash, context }) };
}
function validateRequest(req) {
  if (!exact(req, ['schemaVersion', 'task', 'context', 'options', 'catalogHash', 'requestHash']) || req.schemaVersion !== 1) fail('invalid-request');
  const rebuilt = createRequest(req.task, req.context, req.options);
  if (req.catalogHash !== rebuilt.catalogHash || req.requestHash !== rebuilt.requestHash) fail('invalid-request');
  return true;
}
function decide(req, res, policy = {}) {
  validateRequest(req);
  if (!policy || typeof policy !== 'object' || Array.isArray(policy)
    || Object.keys(policy).some(k => !['domain', 'minConfidence', 'minMargin'].includes(k))) fail('invalid-policy');
  const { domain = 'harness-routing-v1', minConfidence = 0.9, minMargin = 0.2 } = policy;
  if (!text(domain) || !probability(minConfidence) || !probability(minMargin)) fail('invalid-policy');
  const empty = { status: 'invalid-output', reason: 'invalid-response', selectedId: null, confidence: null, margin: null, model: null };
  if (!exact(res, ['schemaVersion', 'requestHash', 'catalogHash', 'model', 'scores'])
    || res.schemaVersion !== 1 || res.requestHash !== req.requestHash || res.catalogHash !== req.catalogHash
    || !exact(res.model, ['id', 'revision', 'domain']) || !Object.values(res.model).every(v => text(v))
    || !Array.isArray(res.scores) || res.scores.length !== req.options.length
    || res.scores.some((s, i) => !exact(s, ['id', 'probability']) || s.id !== req.options[i].id || !probability(s.probability))
    || Math.abs(res.scores.reduce((s, o) => s + o.probability, 0) - 1) > 1e-6) return empty;
  const ranked = [...res.scores].sort((a, b) => b.probability - a.probability);
  const confidence = ranked[0].probability;
  const margin = confidence - ranked[1].probability;
  const reason = res.model.domain !== domain ? 'domain-mismatch' : margin === 0 ? 'tie'
    : confidence < minConfidence ? 'low-confidence' : margin < minMargin ? 'low-margin' : 'scored';
  return { status: reason === 'scored' ? 'accepted' : 'abstain', reason,
    selectedId: reason === 'scored' ? ranked[0].id : null, confidence, margin, model: { ...res.model } };
}
// Relevance-native decisions (#233): every option except unclassified is an
// independent Bernoulli against its own threshold. No simplex rule applies:
// the raw probabilities must each stand in 0..1 but need not sum to one.
function validThresholds(req, thresholds) {
  const ids = req.options.map(o => o.id).filter(id => id !== 'unclassified');
  if (!thresholds || typeof thresholds !== 'object' || Array.isArray(thresholds)) return false;
  const keys = Object.keys(thresholds);
  return keys.length === ids.length && ids.every(id => probability(thresholds[id]))
    && keys.every(k => ids.includes(k));
}
function decideIntents(req, res, policy = {}) {
  validateRequest(req);
  if (!policy || typeof policy !== 'object' || Array.isArray(policy)
    || Object.keys(policy).some(k => !['domain', 'thresholds'].includes(k))
    || !validThresholds(req, policy.thresholds)) fail('invalid-policy');
  const { domain = 'harness-routing-v1', thresholds } = policy;
  if (!text(domain)) fail('invalid-policy');
  const empty = { status: 'invalid-output', reason: 'invalid-response', selectedId: null,
    confidence: null, margin: null, model: null, intents: null };
  if (!exact(res, ['schemaVersion', 'requestHash', 'catalogHash', 'model', 'scores'])
    || res.schemaVersion !== 1 || res.requestHash !== req.requestHash || res.catalogHash !== req.catalogHash
    || !exact(res.model, ['id', 'revision', 'domain']) || !Object.values(res.model).every(v => text(v))
    || !Array.isArray(res.scores) || res.scores.length !== req.options.length
    || res.scores.some((s, i) => !exact(s, ['id', 'probability']) || s.id !== req.options[i].id || !probability(s.probability))) return empty;
  const model = { ...res.model };
  if (model.domain !== domain) {
    return { status: 'abstain', reason: 'domain-mismatch', selectedId: null,
      confidence: null, margin: null, model, intents: null };
  }
  const intents = {};
  for (const s of res.scores) {
    if (s.id === 'unclassified') continue;
    intents[s.id] = { probability: s.probability, fired: s.probability >= thresholds[s.id] };
  }
  const fired = Object.entries(intents).filter(([, v]) => v.fired).sort((a, b) => b[1].probability - a[1].probability);
  if (!fired.length) {
    return { status: 'abstain', reason: 'no-intent-fired', selectedId: null,
      confidence: null, margin: null, model, intents };
  }
  const rest = Object.values(intents).filter(v => v !== fired[0][1]).map(v => v.probability);
  const confidence = fired[0][1].probability;
  return { status: 'accepted', reason: 'scored', selectedId: fired[0][0], confidence,
    margin: confidence - Math.max(...rest, 0), model, intents };
}
module.exports = { createRequest, validateRequest, decide, decideIntents };
