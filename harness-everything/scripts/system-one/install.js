#!/usr/bin/env node
'use strict';
// Opt-in System One installer: a dedicated venv, pinned cua_s1 source, and a pinned CPU checkpoint.
// It is never run from hooks, and it never changes the router mode; it prints the environment to set.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { spawnSync } = require('node:child_process');
const { performance } = require('node:perf_hooks');
const { validateManifest, readManifest, provenance, score, PINNED_CUA_S1_REVISION } = require('./provider');
const resident = require('./resident');
const { createRequest, decide } = require('./contract');
const { TIER_OPTIONS } = require('./router');

const PINS = Object.freeze({
  cuaS1Revision: PINNED_CUA_S1_REVISION,
  cuaS1Spec: `cua-s1 @ git+https://github.com/trycua/cua@${PINNED_CUA_S1_REVISION}#subdirectory=libs/cua-s1/python`,
  torchSpec: 'torch>=2.2,<3',
  torchIndex: 'https://download.pytorch.org/whl/cpu',
  modelId: 'cua-ai/cua-s1-forms',
  modelRevision: 'f54adbf447f4ca6ec259f529ee3f2e3e09f8cc71',
  domain: 'forms-v1',
  // sha256/size from the Hugging Face tree API at modelRevision (LFS oid for weights; the JSON
  // sidecar's git blob id d8f8426a... was re-hashed to confirm these exact CRLF bytes).
  files: Object.freeze({
    weights: Object.freeze({ name: 'cua-s1-forms.safetensors', size: 2828784, sha256: '05954c1caf51c2fb6c13ea4acbfc88a2e7653dea192252bb51dc89e76a356ddc' }),
    config: Object.freeze({ name: 'cua-s1-forms.json', size: 1053, sha256: '62d31e2f9a001a8e9b6f8534c5194d07ebdd3f9d62ef1ac281906622992650ca' }),
  }),
});
const USAGE = 'Usage: install.js [--dir <absolute dir>] [--python <3.11-3.13 executable>] [--dry-run]';

const defaultDir = () => path.join(os.homedir(), '.agents', 'harness-everything', 'system-one');
const fileUrl = name => `https://huggingface.co/${PINS.modelId}/resolve/${PINS.modelRevision}/${name}`;
const checkpointDir = dir => path.join(dir, 'checkpoints', PINS.modelRevision);
const venvPython = (dir, platform = process.platform) => (platform === 'win32'
  ? path.join(dir, 'venv', 'Scripts', 'python.exe') : path.join(dir, 'venv', 'bin', 'python'));
function supportedPython(version) {
  const match = typeof version === 'string' && /^3\.(\d+)\.\d+$/.exec(version);
  return Boolean(match) && Number(match[1]) >= 11 && Number(match[1]) <= 13;
}
function pythonCandidates(platform = process.platform) {
  return platform === 'win32'
    ? [['py', '-3.13'], ['py', '-3.12'], ['py', '-3.11'], ['python'], ['python3']]
    : [['python3.13'], ['python3.12'], ['python3.11'], ['python3'], ['python']];
}
function parseArgs(argv) {
  const opts = { dir: defaultDir(), python: null, dryRun: false };
  const seen = new Set();
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    if (seen.has(flag)) throw new Error('usage');
    seen.add(flag);
    if (flag === '--dry-run') opts.dryRun = true;
    else if (flag === '--dir' || flag === '--python') {
      const value = argv[++i];
      if (!value || value.startsWith('--')) throw new Error('usage');
      if (flag === '--dir' && !path.isAbsolute(value)) throw new Error('usage');
      opts[flag.slice(2)] = flag === '--dir' ? path.resolve(value) : value;
    } else throw new Error('usage');
  }
  return opts;
}
function buildManifest(dir, python) {
  const manifest = { schemaVersion: 1, python, checkpoint: path.join(checkpointDir(dir), PINS.files.weights.name),
    weightsSha256: PINS.files.weights.sha256, configSha256: PINS.files.config.sha256,
    modelId: PINS.modelId, revision: PINS.modelRevision, domain: PINS.domain,
    // One-shot fallback budget (fresh Python + torch import per call); resident keeps the model loaded.
    timeoutMs: 10000, transport: 'resident', idleTimeoutMs: 1800000 };
  validateManifest(manifest);
  return manifest;
}
const matches = (buf, spec) => buf.length === spec.size && createHash('sha256').update(buf).digest('hex') === spec.sha256;
async function httpFetch(url) {
  const res = await fetch(url, { redirect: 'follow' });
  if (!res.ok) throw new Error(`download-failed:${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}
async function ensureFile(url, dest, spec, fetcher = httpFetch) {
  if (fs.existsSync(dest) && matches(fs.readFileSync(dest), spec)) return 'verified-existing';
  const bytes = await fetcher(url);
  if (!Buffer.isBuffer(bytes) || !matches(bytes, spec)) throw new Error(`download-verification:${spec.name}`);
  const tmp = `${dest}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, bytes);
  fs.renameSync(tmp, dest);
  return 'downloaded';
}
function exec(cmd, args, capture = false) {
  // Child progress goes to stderr (fd 2): stdout carries only the final JSON report.
  const result = spawnSync(cmd, args, { shell: false, windowsHide: true, encoding: 'utf8', stdio: capture ? 'pipe' : ['ignore', 2, 2] });
  if (result.error || result.status !== 0) throw new Error(`command-failed: ${[cmd, ...args].join(' ')}`);
  return capture ? result.stdout.trim() : '';
}
const VERSION_PROBE = ['-c', 'import sys; print("%d.%d.%d" % sys.version_info[:3])'];
function findPython(explicit) {
  for (const [cmd, ...pre] of explicit ? [[explicit]] : pythonCandidates()) {
    const result = spawnSync(cmd, [...pre, ...VERSION_PROBE], { shell: false, windowsHide: true, encoding: 'utf8' });
    const version = result.status === 0 ? result.stdout.trim() : null;
    if (supportedPython(version)) return { cmd, pre, version };
  }
  throw new Error(explicit ? 'python-unsupported: need Python 3.11-3.13' : 'python-not-found: install Python 3.11-3.13 or pass --python');
}
function plan(opts) {
  const venvPy = venvPython(opts.dir);
  const manifestPath = path.join(opts.dir, 'manifest.json');
  return { dir: opts.dir, manifest: manifestPath,
    steps: [
      `create venv ${path.join(opts.dir, 'venv')} with ${opts.python || 'first Python 3.11-3.13 found'}`,
      `${venvPy} -m pip install --index-url ${PINS.torchIndex} "${PINS.torchSpec}"`,
      `${venvPy} -m pip install "${PINS.cuaS1Spec}"`,
      ...Object.values(PINS.files).map(f => `download ${fileUrl(f.name)} (sha256 ${f.sha256})`),
      `write ${manifestPath}`,
      'verify provenance (pinned revision), start the resident server, one warm CPU inference, stop it',
    ],
    env: { HARNESS_SYSTEM_ONE_MODE: 'shadow', HARNESS_SYSTEM_ONE_CONFIG: manifestPath } };
}
// Starts the resident server (if needed), scores once warm, then stops a server it started.
function verify(manifestPath) {
  const source = provenance(manifestPath);
  const manifest = readManifest(manifestPath);
  const wasRunning = resident.status(manifest, manifestPath).running;
  const startMs = performance.now();
  const ready = resident.ensureReady(manifest, manifestPath, 60000);
  const readyMs = Math.round(performance.now() - startMs);
  const request = createRequest('tier', 'fix a typo in README', TIER_OPTIONS);
  const start = performance.now();
  const result = score(request, manifestPath);
  const latencyMs = Math.round(performance.now() - start);
  if (!wasRunning) resident.stop(manifest, manifestPath);
  const decision = result.status === 'scored' ? decide(request, result.response) : result;
  const scores = result.status === 'scored' && decision.status !== 'invalid-output' ? result.response.scores : null;
  const ok = ready && source.status === 'recorded' && source.provenance.cuaS1.sourceRevisionStatus === 'pinned' && scores !== null;
  return { ok, source, residentReady: ready, readyMs, decision, scores, latencyMs };
}
async function main(argv) {
  const opts = parseArgs(argv);
  const p = plan(opts);
  if (opts.dryRun) { process.stdout.write(`${JSON.stringify({ dryRun: true, ...p }, null, 2)}\n`); return 0; }
  const base = findPython(opts.python);
  const venvPy = venvPython(opts.dir);
  fs.mkdirSync(checkpointDir(opts.dir), { recursive: true });
  if (!fs.existsSync(venvPy)) exec(base.cmd, [...base.pre, '-m', 'venv', path.join(opts.dir, 'venv')]);
  const venvVersion = exec(venvPy, VERSION_PROBE, true);
  if (!supportedPython(venvVersion)) throw new Error(`python-unsupported: existing venv uses ${venvVersion}`);
  exec(venvPy, ['-m', 'pip', 'install', '--disable-pip-version-check', '--index-url', PINS.torchIndex, PINS.torchSpec]);
  exec(venvPy, ['-m', 'pip', 'install', '--disable-pip-version-check', PINS.cuaS1Spec]);
  for (const spec of Object.values(PINS.files)) {
    console.error(`${spec.name}: ${await ensureFile(fileUrl(spec.name), path.join(checkpointDir(opts.dir), spec.name), spec)}`);
  }
  fs.writeFileSync(p.manifest, `${JSON.stringify(buildManifest(opts.dir, venvPy), null, 2)}\n`);
  const check = verify(p.manifest);
  process.stdout.write(`${JSON.stringify({ dryRun: false, ...p, verification: check }, null, 2)}\n`);
  return check.ok ? 0 : 1;
}
if (require.main === module) {
  main(process.argv.slice(2)).then(code => { process.exitCode = code; }, err => {
    if (err.message === 'usage') { console.error(USAGE); process.exitCode = 2; return; }
    console.error(`System One install failed: ${err.message}`); process.exitCode = 1;
  });
}
module.exports = { PINS, fileUrl, venvPython, supportedPython, pythonCandidates, parseArgs, buildManifest, ensureFile, exec, plan, verify };
