'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createRequest, validateRequest, decide } = require('../harness-everything/scripts/system-one/contract');
const options = [{ id: 'tier1', text: 'Bounded edit' }, { id: 'tier3', text: 'Architecture' }];
const request = () => createRequest('tier', '修正 typo', options);
function response(req, p = [0.95, 0.05]) {
  return { schemaVersion: 1, requestHash: req.requestHash, catalogHash: req.catalogHash,
    model: { id: 'test', revision: 'test-v1', domain: 'harness-routing-v1' },
    scores: req.options.map((o, i) => ({ id: o.id, probability: p[i] })) };
}
test('S1-C01 complete response, no mutation and repeatability', () => {
  const req = request(); const res = response(req); const before = JSON.stringify({ req, res });
  assert.deepEqual(decide(req, res), { status: 'accepted', reason: 'scored', selectedId: 'tier1', confidence: 0.95, margin: 0.8999999999999999, model: res.model });
  assert.deepEqual(decide(req, res), decide(req, res));
  assert.equal(JSON.stringify({ req, res }), before);
  assert.deepEqual(req, request());
  assert.equal(validateRequest(req), true);
  assert.notEqual(req.requestHash, createRequest('tier', 'other', options).requestHash);
  assert.notEqual(req.catalogHash, createRequest('tier', 'other', [...options].reverse()).catalogHash);
});
test('S1-C02 rejected input partitions and byte boundaries', () => {
  for (const context of ['', ' ', null, 1, {}, 'x'.repeat(65537)]) assert.throws(() => createRequest('tier', context, options), { code: 'invalid-request' });
  for (const task of ['', null, 'A', 'a'.repeat(81)]) assert.throws(() => createRequest(task, 'x', options));
  for (const opts of [null, [], [options[0]], [options[0], options[0]], [{ id: 'x', text: '' }, options[1]], [{ ...options[0], extra: true }, options[1]], [{ id: 1, text: 'x' }, options[1]], [{ id: 'x', text: '中'.repeat(1366) }, options[1]], Array.from({ length: 257 }, (_, i) => ({ id: 'a' + i, text: 'x' }))]) assert.throws(() => createRequest('tier', 'x', opts));
  const max = createRequest('a'.repeat(80), 'x'.repeat(65536), Array.from({ length: 256 }, (_, i) => ({ id: 'a' + i, text: 'x'.repeat(4096) })));
  assert.equal(validateRequest(max), true);
  for (const mutate of [r => { r.extra = 1; }, r => { delete r.context; }, r => { r.schemaVersion = 2; }, r => { r.options.reverse(); }, r => { r.context = 'replay'; }]) {
    const r = request(); mutate(r); assert.throws(() => validateRequest(r));
  }
});
test('S1-C03 complete output validation and no raw-data leakage', () => {
  const req = request();
  for (const mutate of [r => { r.schemaVersion = 2; }, r => { r.requestHash = 'stale'; }, r => { r.catalogHash = 'stale'; }, r => { r.scores.pop(); }, r => { r.scores.push(r.scores[0]); }, r => { r.scores.reverse(); }, r => { r.scores[1].id = r.scores[0].id; }, r => { r.scores[0].probability = NaN; }, r => { r.scores[0].probability = Infinity; }, r => { r.scores[0].probability = -1; }, r => { r.scores[0].probability = 1.1; }, r => { r.scores[0].probability = '0.95'; }, r => { r.scores[0].probability = 0.8; }, r => { r.scores[0].extra = 'secret'; }, r => { r.model.extra = 'secret'; }, r => { r.model.revision = ''; }, r => { delete r.model; }, r => { r.extra = 'secret'; }]) {
    const res = response(req); mutate(res);
    assert.deepEqual(decide(req, res), { status: 'invalid-output', reason: 'invalid-response', selectedId: null, confidence: null, margin: null, model: null });
  }
  for (const value of [null, [], 'invalid']) assert.equal(decide(req, value).status, 'invalid-output');
});
test('S1-C04 abstention and policy boundaries', () => {
  const req = request(); const res = response(req);
  res.model.domain = 'forms-v1'; assert.equal(decide(req, res).reason, 'domain-mismatch');
  assert.equal(decide(req, response(req, [0.5, 0.5]), { minConfidence: 0, minMargin: 0 }).reason, 'tie');
  assert.equal(decide(req, response(req, [0.8, 0.2])).reason, 'low-confidence');
  assert.equal(decide(req, response(req, [0.6, 0.4]), { minConfidence: 0.5, minMargin: 0.3 }).reason, 'low-margin');
  assert.equal(decide(req, response(req, [1, 0]), { minConfidence: 1, minMargin: 1 }).status, 'accepted');
  for (const policy of [null, { minConfidence: NaN }, { minMargin: -1 }, { minConfidence: 2 }, { extra: 1 }, { domain: '' }]) assert.throws(() => decide(req, response(req), policy), { code: 'invalid-policy' });
});
