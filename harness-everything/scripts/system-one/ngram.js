'use strict';
// In-process System One scorer: hashed character n-grams + a linear layer (docs/system-one-routing.md, "N-gram provider").
// Featurization must match scripts/system-one-train-ngram.py exactly; ci/mechanism-system-one-ngram.test.js proves it.
const fs = require('node:fs');
const { createHash } = require('node:crypto');

const SIDE_KEYS = ['format', 'formatVersion', 'dim', 'nmax', 'hash', 'catalog', 'bias', 'metadata'];
const cache = new Map();
const configError = () => Object.assign(new Error('provider-config'), { code: 'provider-config' });
const sha = buf => createHash('sha256').update(buf).digest('hex');

function fnv1a32(text) {
  let h = 0x811c9dc5;
  for (const byte of Buffer.from(text, 'utf8')) { h ^= byte; h = Math.imul(h, 0x01000193) >>> 0; }
  return h >>> 0;
}
// Map of bucket -> weight: log(1 + count) per code-point n-gram, one length bucket, L2-normalized.
function featurize(text, nmax, dim) {
  const t = text.toLowerCase().split(/\s+/).filter(Boolean).join(' ');
  const cps = Array.from(t);
  const counts = new Map();
  for (let n = 1; n <= nmax; n++) {
    for (let i = 0; i + n <= cps.length; i++) {
      const gram = cps.slice(i, i + n).join('');
      if (!gram.trim()) continue;
      const b = fnv1a32(`${n}:${gram}`) % dim;
      counts.set(b, (counts.get(b) || 0) + 1);
    }
  }
  const k = Math.min(8, Math.floor(Math.log2(Buffer.byteLength(t, 'utf8') + 1)));
  counts.set(fnv1a32(`len:${k}`) % dim, 1);
  const feats = new Map();
  let norm = 0;
  for (const [b, c] of counts) { const v = Math.log1p(c); feats.set(b, v); norm += v * v; }
  norm = Math.sqrt(norm);
  for (const [b, v] of feats) feats.set(b, v / norm);
  return feats;
}
function validSidecar(s) {
  const isPow2 = n => Number.isInteger(n) && n >= 1024 && n <= 1 << 20 && (n & (n - 1)) === 0;
  return s && typeof s === 'object' && !Array.isArray(s) && Object.keys(s).length === SIDE_KEYS.length && SIDE_KEYS.every(k => Object.hasOwn(s, k))
    && s.format === 'harness-ngram' && s.formatVersion === 1 && isPow2(s.dim) && Number.isInteger(s.nmax) && s.nmax >= 1 && s.nmax <= 4
    && s.hash === 'fnv1a32' && Array.isArray(s.catalog) && s.catalog.length >= 2 && new Set(s.catalog).size === s.catalog.length
    && s.catalog.every(id => typeof id === 'string' && /^[a-z0-9._-]{1,80}$/.test(id))
    && Array.isArray(s.bias) && s.bias.length === s.catalog.length && s.bias.every(Number.isFinite)
    && s.metadata && typeof s.metadata === 'object' && !Array.isArray(s.metadata);
}
// Loads and verifies the artifact once per process; any mismatch throws provider-config.
function loadModel(manifest) {
  const key = `${manifest.checkpoint}|${manifest.weightsSha256}|${manifest.configSha256}`;
  if (cache.has(key)) return cache.get(key);
  const sidecarPath = manifest.checkpoint.replace(/\.bin$/, '.json');
  let side; let bin;
  try {
    const raw = fs.readFileSync(sidecarPath);
    if (raw.length > 65536 || sha(raw) !== manifest.configSha256) throw configError();
    side = JSON.parse(raw.toString('utf8'));
    bin = fs.readFileSync(manifest.checkpoint);
  } catch (_) { throw configError(); }
  if (sha(bin) !== manifest.weightsSha256 || !validSidecar(side) || bin.length !== side.dim * side.catalog.length * 4) throw configError();
  const W = new Float32Array(side.dim * side.catalog.length);
  for (let i = 0; i < W.length; i++) W[i] = bin.readFloatLE(i * 4);
  const model = { dim: side.dim, nmax: side.nmax, catalog: side.catalog, bias: side.bias, W };
  cache.set(key, model);
  return model;
}
function score(request, manifest) {
  const model = loadModel(manifest);
  const C = model.catalog.length;
  if (request.options.length !== C || request.options.some((o, i) => o.id !== model.catalog[i])) throw configError();
  const logits = model.bias.slice();
  for (const [b, v] of featurize(request.context, model.nmax, model.dim)) {
    for (let c = 0; c < C; c++) logits[c] += v * model.W[b * C + c];
  }
  const max = Math.max(...logits);
  const exps = logits.map(z => Math.exp(z - max));
  const sum = exps.reduce((s, x) => s + x, 0);
  return {
    schemaVersion: 1, requestHash: request.requestHash, catalogHash: request.catalogHash,
    model: { id: manifest.modelId, revision: manifest.revision, domain: manifest.domain },
    scores: request.options.map((o, i) => ({ id: o.id, probability: exps[i] / sum })),
  };
}
module.exports = { fnv1a32, featurize, loadModel, score };
