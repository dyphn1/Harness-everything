'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { validateRequest } = require('./contract');
// Upstream cua_s1 source revision documented in docs/system-one-routing.md.
const PINNED_CUA_S1_REVISION = 'b7f7e2d8714609853a29c7d049140bc46aec0954';
const ADAPTER = path.join(__dirname, 'cua_adapter.py');
const unavailable = reason => ({ status: 'unavailable', reason });
const exact = (value, keys) => value && typeof value === 'object' && !Array.isArray(value)
  && Object.keys(value).length === keys.length && keys.every(k => Object.hasOwn(value, k));
const label = value => typeof value === 'string' && value.length > 0 && value.length <= 128 && !/[\u0000-\u001f]/.test(value);
// Resident adapter selection: a basename inside the system-one scripts dir, never a path.
const adapterName = value => typeof value === 'string' && /^[a-z][a-z0-9_-]{0,63}\.py$/.test(value);
// Thresholds calibrated on validation for this checkpoint (docs/system-one-training.md).
const inRange = (v, lo, hi) => typeof v === 'number' && Number.isFinite(v) && v >= lo && v <= hi;
// secondaryThreshold is optional and belongs to intent checkpoints (docs/system-one-intent.md#scoring).
const validAcceptance = a => (exact(a, ['minConfidence', 'minMargin']) || (exact(a, ['minConfidence', 'minMargin', 'secondaryThreshold']) && inRange(a.secondaryThreshold, 0.05, 0.5)))
  && inRange(a.minConfidence, 0.5, 0.99) && inRange(a.minMargin, 0, 0.9);
// The part of the acceptance thresholds that contract.decide takes.
const decisionPolicy = acceptance => (acceptance ? { minConfidence: acceptance.minConfidence, minMargin: acceptance.minMargin } : {});
// A scored result carries the manifest's thresholds so every caller decides with them.
const withAcceptance = (result, manifest) => (result && result.status === 'scored' && manifest.acceptance
  ? { ...result, acceptance: { ...manifest.acceptance } } : result);
function validateManifest(m) {
  // The in-process ngram transport needs no Python and loads a .bin; the others run the CUA-S1 adapter.
  const ngram = !!m && m.transport === 'ngram';
  const required = ['schemaVersion', ...(ngram ? [] : ['python']), 'checkpoint', 'weightsSha256', 'configSha256', 'modelId', 'revision', 'domain'];
  const strings = ['modelId', 'revision', 'domain', ...(ngram && !Object.hasOwn(m, 'python') ? [] : ['python'])];
  if (!m || typeof m !== 'object' || Array.isArray(m) || required.some(k => !Object.hasOwn(m, k))
    || Object.keys(m).some(k => ![...required, 'python', 'timeoutMs', 'transport', 'idleTimeoutMs', 'acceptance', 'adapter'].includes(k)) || m.schemaVersion !== 1
    || (m.acceptance !== undefined && !validAcceptance(m.acceptance))
    || (m.adapter !== undefined && !adapterName(m.adapter))
    || strings.some(k => typeof m[k] !== 'string' || !m[k].trim() || m[k].length > 4096 || m[k].includes('\0'))
    || typeof m.checkpoint !== 'string' || !path.isAbsolute(m.checkpoint) || path.extname(m.checkpoint) !== (ngram ? '.bin' : '.safetensors')
    || ['weightsSha256', 'configSha256'].some(k => typeof m[k] !== 'string' || !/^[a-f0-9]{64}$/.test(m[k]))
    || (m.timeoutMs !== undefined && (!Number.isInteger(m.timeoutMs) || m.timeoutMs < 1 || m.timeoutMs > 10000))
    || (m.transport !== undefined && !['oneshot', 'resident', 'ngram'].includes(m.transport))
    || (m.idleTimeoutMs !== undefined && (!Number.isInteger(m.idleTimeoutMs) || m.idleTimeoutMs < 60000 || m.idleTimeoutMs > 14400000))
    || (m.modelId === 'cua-ai/cua-s1-forms' && m.domain !== 'forms-v1')) throw new TypeError('invalid-manifest');
  return true;
}
function readManifest(manifestPath) {
  if (typeof manifestPath !== 'string' || !path.isAbsolute(manifestPath) || fs.statSync(manifestPath).size > 65536) throw new Error();
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  validateManifest(manifest);
  return manifest;
}
function spawnJson(executable, args, input, timeoutMs) {
  let result;
  try {
    result = spawnSync(executable, args, { input, encoding: 'utf8', shell: false,
      timeout: timeoutMs, killSignal: 'SIGKILL', maxBuffer: 1024 * 1024, windowsHide: true });
  } catch (_) { return unavailable('provider-unavailable'); }
  if (result.error) return unavailable(result.error.code === 'ETIMEDOUT' ? 'provider-timeout'
    : result.error.code === 'ENOBUFS' ? 'provider-output-limit' : 'provider-unavailable');
  if (result.status !== 0) return unavailable('provider-exit');
  try { return { status: 'ok', value: JSON.parse(result.stdout) }; }
  catch (_) { return unavailable('provider-json'); }
}
function runProvider(request, executable, args, timeoutMs = 2000) {
  validateRequest(request);
  const result = spawnJson(executable, args, JSON.stringify(request), timeoutMs);
  return result.status === 'ok' ? { status: 'scored', response: result.value } : result;
}
function score(request, manifestPath) {
  validateRequest(request);
  let manifest;
  try { manifest = readManifest(manifestPath); } catch (_) { return unavailable('provider-config'); }
  if (manifest.transport === 'ngram') return withAcceptance(inProcess(request, manifest), manifest);
  if (manifest.transport === 'resident') return withAcceptance(require('./resident').score({ ...request }, manifest, manifestPath), manifest);
  return withAcceptance(oneShot(request, manifest), manifest);
}
// The ngram transport scores in this process; an artifact mismatch is a configuration error, never a score.
function inProcess(request, manifest) {
  try { return { status: 'scored', response: require('./ngram').score({ ...request }, manifest) }; }
  catch (_) { return unavailable('provider-config'); }
}
// Async callers (the hook entry) reach a resident server without the sync worker bridge.
// One-shot has no server to overlap with, so it runs the same child synchronously.
async function scoreAsync(request, manifestPath) {
  validateRequest(request);
  let manifest;
  try { manifest = readManifest(manifestPath); } catch (_) { return unavailable('provider-config'); }
  if (manifest.transport === 'ngram') return withAcceptance(inProcess(request, manifest), manifest);
  if (manifest.transport === 'resident') return withAcceptance(await require('./resident').scoreAsync({ ...request }, manifest, manifestPath), manifest);
  return withAcceptance(oneShot(request, manifest), manifest);
}
// Send the exact validated manifest to the child on stdin: no config reread race.
function oneShot(request, manifest) {
  return runProvider({ ...request }, manifest.python, [ADAPTER, JSON.stringify(manifest)], manifest.timeoutMs || 2000);
}
// The probe reports what is installed; only a PEP 610 VCS commit counts as a source revision.
function validateProvenance(p) {
  if (!exact(p, ['schemaVersion', 'python', 'cuaS1', 'torch']) || p.schemaVersion !== 1
    || !exact(p.python, ['implementation', 'version']) || !label(p.python.implementation) || !label(p.python.version)
    || !exact(p.cuaS1, ['distribution', 'version', 'sourceRevision'])
    || ![p.cuaS1.distribution, p.cuaS1.version, p.torch].every(v => v === null || label(v))
    || (p.cuaS1.sourceRevision !== null && !(typeof p.cuaS1.sourceRevision === 'string' && /^[0-9a-f]{40}$/.test(p.cuaS1.sourceRevision)))) {
    throw new TypeError('invalid-provenance');
  }
  const revision = p.cuaS1.sourceRevision;
  return { python: { ...p.python }, torch: p.torch, cuaS1: { ...p.cuaS1, pinnedRevision: PINNED_CUA_S1_REVISION,
    sourceRevisionStatus: revision === null ? 'unavailable' : revision === PINNED_CUA_S1_REVISION ? 'pinned' : 'mismatch' } };
}
function provenance(manifestPath) {
  let manifest;
  try { manifest = readManifest(manifestPath); } catch (_) { return unavailable('provider-config'); }
  // Metadata scans can exceed the per-score budget; use the manifest cap. No model is loaded.
  const result = spawnJson(manifest.python, [ADAPTER, '--provenance'], '', 10000);
  if (result.status !== 'ok') return result;
  try { return { status: 'recorded', provenance: validateProvenance(result.value) }; }
  catch (_) { return unavailable('provider-json'); }
}
module.exports = { score, scoreAsync, runProvider, validateManifest, readManifest, provenance, validateProvenance, decisionPolicy, PINNED_CUA_S1_REVISION };
