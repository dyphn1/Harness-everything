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
function validateManifest(m) {
  const required = ['schemaVersion', 'python', 'checkpoint', 'weightsSha256', 'configSha256', 'modelId', 'revision', 'domain'];
  if (!m || typeof m !== 'object' || Array.isArray(m) || required.some(k => !Object.hasOwn(m, k))
    || Object.keys(m).some(k => ![...required, 'timeoutMs', 'transport', 'idleTimeoutMs'].includes(k)) || m.schemaVersion !== 1
    || ['python', 'modelId', 'revision', 'domain'].some(k => typeof m[k] !== 'string' || !m[k].trim() || m[k].length > 4096 || m[k].includes('\0'))
    || typeof m.checkpoint !== 'string' || !path.isAbsolute(m.checkpoint) || path.extname(m.checkpoint) !== '.safetensors'
    || ['weightsSha256', 'configSha256'].some(k => typeof m[k] !== 'string' || !/^[a-f0-9]{64}$/.test(m[k]))
    || (m.timeoutMs !== undefined && (!Number.isInteger(m.timeoutMs) || m.timeoutMs < 1 || m.timeoutMs > 10000))
    || (m.transport !== undefined && !['oneshot', 'resident'].includes(m.transport))
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
  if (manifest.transport === 'resident') return require('./resident').score({ ...request }, manifest, manifestPath);
  // Send the exact validated manifest to the child on stdin: no config reread race.
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
module.exports = { score, runProvider, validateManifest, readManifest, provenance, validateProvenance, PINNED_CUA_S1_REVISION };
