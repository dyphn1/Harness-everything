'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { validateRequest } = require('./contract');
const unavailable = reason => ({ status: 'unavailable', reason });
function validateManifest(m) {
  const required = ['schemaVersion', 'python', 'checkpoint', 'weightsSha256', 'configSha256', 'modelId', 'revision', 'domain'];
  if (!m || typeof m !== 'object' || Array.isArray(m) || required.some(k => !Object.hasOwn(m, k))
    || Object.keys(m).some(k => ![...required, 'timeoutMs'].includes(k)) || m.schemaVersion !== 1
    || ['python', 'modelId', 'revision', 'domain'].some(k => typeof m[k] !== 'string' || !m[k].trim() || m[k].length > 4096 || m[k].includes('\0'))
    || typeof m.checkpoint !== 'string' || !path.isAbsolute(m.checkpoint) || path.extname(m.checkpoint) !== '.safetensors'
    || ['weightsSha256', 'configSha256'].some(k => typeof m[k] !== 'string' || !/^[a-f0-9]{64}$/.test(m[k]))
    || (m.timeoutMs !== undefined && (!Number.isInteger(m.timeoutMs) || m.timeoutMs < 1 || m.timeoutMs > 10000))
    || (m.modelId === 'cua-ai/cua-s1-forms' && m.domain !== 'forms-v1')) throw new TypeError('invalid-manifest');
  return true;
}
function runProvider(request, executable, args, timeoutMs = 2000) {
  validateRequest(request);
  let result;
  try {
    result = spawnSync(executable, args, { input: JSON.stringify(request), encoding: 'utf8', shell: false,
      timeout: timeoutMs, killSignal: 'SIGKILL', maxBuffer: 1024 * 1024, windowsHide: true });
  } catch (_) { return unavailable('provider-unavailable'); }
  if (result.error) return unavailable(result.error.code === 'ETIMEDOUT' ? 'provider-timeout'
    : result.error.code === 'ENOBUFS' ? 'provider-output-limit' : 'provider-unavailable');
  if (result.status !== 0) return unavailable('provider-exit');
  try { return { status: 'scored', response: JSON.parse(result.stdout) }; }
  catch (_) { return unavailable('provider-json'); }
}
function score(request, manifestPath) {
  validateRequest(request);
  let manifest;
  try {
    if (typeof manifestPath !== 'string' || !path.isAbsolute(manifestPath) || fs.statSync(manifestPath).size > 65536) throw new Error();
    manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    validateManifest(manifest);
  } catch (_) { return unavailable('provider-config'); }
  // Send the exact validated manifest to the child on stdin: no config reread race.
  return runProvider({ ...request }, manifest.python,
    [path.join(__dirname, 'cua_adapter.py'), JSON.stringify(manifest)], manifest.timeoutMs || 2000);
}
module.exports = { score, runProvider, validateManifest };
