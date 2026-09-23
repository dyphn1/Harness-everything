#!/usr/bin/env node
'use strict';
// Resident System One client: one verified model stays loaded in a loopback server.
// A score never blocks on model loading; a cold start returns provider-starting (lexical route wins).
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { spawn } = require('node:child_process');
const { Worker } = require('node:worker_threads');
const { validateRequest } = require('./contract');

const ADAPTER = path.join(__dirname, 'cua_adapter.py');
const LOCK_TTL_MS = 60000;
const CALL_TIMEOUT_MS = 1000;
const MAX_REPLY_BYTES = 1024 * 1024;
const unavailable = reason => ({ status: 'unavailable', reason });
const sleep = ms => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
const exact = (value, keys) => value && typeof value === 'object' && !Array.isArray(value)
  && Object.keys(value).length === keys.length && keys.every(k => Object.hasOwn(value, k));
const defaultCommand = manifest => [manifest.python, [ADAPTER, '--serve']];

function stateFiles(manifest, manifestPath) {
  const digest = createHash('sha256').update(JSON.stringify(manifest)).digest('hex').slice(0, 16);
  const base = path.join(path.dirname(manifestPath), `system-one-resident-${digest}`);
  return { state: `${base}.json`, lock: `${base}.starting` };
}
function readState(file) {
  try {
    const s = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (exact(s, ['schemaVersion', 'pid', 'port', 'token', 'startedAt']) && s.schemaVersion === 1
      && Number.isInteger(s.pid) && s.pid > 0 && Number.isInteger(s.port) && s.port > 0 && s.port < 65536
      && typeof s.token === 'string' && /^[0-9a-f]{64}$/.test(s.token) && Number.isFinite(s.startedAt)) return s;
  } catch (_) { /* absent or unreadable state means no usable server */ }
  return null;
}
function lockInfo(file) {
  try {
    const ageMs = Date.now() - fs.statSync(file).mtimeMs;
    let failed = null;
    try { const body = JSON.parse(fs.readFileSync(file, 'utf8')); if (typeof body.failed === 'string') failed = body.failed; } catch (_) { /* partial write */ }
    return { ageMs, failed };
  } catch (_) { return null; }
}
function pidAlive(pid) {
  try { process.kill(pid, 0); return true; } catch (err) { return err.code === 'EPERM'; }
}
function removeIfSame(file, state) {
  const current = readState(file);
  if (current && current.pid === state.pid && current.token === state.token) { try { fs.unlinkSync(file); } catch (_) { /* raced */ } }
}

// One socket round trip on a worker thread; the caller blocks with Atomics.wait (router API is synchronous).
const WORKER = `
const net = require('node:net');
const { workerData } = require('node:worker_threads');
const { port, payload, signal, out } = workerData;
const view = new Uint8Array(out); const chunks = []; let size = 0; let done = false;
const finish = (code, buf) => {
  if (done) return; done = true;
  if (buf) { view.set(buf); Atomics.store(signal, 1, buf.length); }
  Atomics.store(signal, 0, code); Atomics.notify(signal, 0);
};
const socket = net.connect({ port, host: '127.0.0.1' }, () => socket.end(payload));
socket.on('data', c => { size += c.length; if (size > view.length) { finish(4); socket.destroy(); } else chunks.push(c); });
socket.on('end', () => finish(1, Buffer.concat(chunks)));
socket.on('error', e => finish(e.code === 'ECONNREFUSED' ? 2 : 3));
`;
function callSync(port, message, timeoutMs = CALL_TIMEOUT_MS) {
  const signal = new Int32Array(new SharedArrayBuffer(8));
  const out = new SharedArrayBuffer(MAX_REPLY_BYTES);
  let worker;
  try {
    worker = new Worker(WORKER, { eval: true, workerData: { port, payload: `${JSON.stringify(message)}\n`, signal, out } });
    worker.unref();
  } catch (_) { return { error: 'io' }; }
  Atomics.wait(signal, 0, 0, timeoutMs);
  const code = Atomics.load(signal, 0);
  worker.terminate();
  if (code === 0) return { error: 'timeout' };
  if (code !== 1) return { error: code === 2 ? 'refused' : code === 4 ? 'limit' : 'io' };
  try { return { reply: JSON.parse(Buffer.from(out, 0, Atomics.load(signal, 1)).toString('utf8')) }; }
  catch (_) { return { error: 'json' }; }
}

function start(manifest, files, deps) {
  const lock = lockInfo(files.lock);
  if (lock && lock.ageMs < LOCK_TTL_MS) return unavailable(lock.failed ? 'provider-unavailable' : 'provider-starting');
  if (lock) { try { fs.unlinkSync(files.lock); } catch (_) { /* another caller replaced it */ } }
  try { fs.writeFileSync(files.lock, JSON.stringify({ createdAt: Date.now() }), { flag: 'wx', mode: 0o600 }); }
  catch (_) { return unavailable('provider-starting'); }
  try {
    const [exe, prefix] = (deps.command || defaultCommand)(manifest);
    const child = spawn(exe, [...prefix, JSON.stringify(manifest), files.state, files.lock],
      { detached: true, stdio: 'ignore', windowsHide: true, shell: false });
    child.on('error', () => { /* surfaces as a lock that never becomes ready */ });
    child.unref();
  } catch (_) {
    try { fs.unlinkSync(files.lock); } catch (__) { /* already gone */ }
    return unavailable('provider-unavailable');
  }
  return unavailable('provider-starting');
}
// Returns a live server state, or null after removing state that provably belongs to a dead server.
function liveState(files) {
  const state = readState(files.state);
  if (state && !pidAlive(state.pid)) { removeIfSame(files.state, state); return null; }
  return state;
}
function score(request, manifest, manifestPath, deps = {}) {
  validateRequest(request);
  const files = stateFiles(manifest, manifestPath);
  const state = liveState(files);
  if (!state) return start(manifest, files, deps);
  const result = callSync(state.port, { token: state.token, op: 'score', request });
  if (result.reply) {
    if (result.reply.ok === true && Object.hasOwn(result.reply, 'response')) return { status: 'scored', response: result.reply.response };
    if (result.reply.ok === false) return unavailable(result.reply.reason === 'unauthorized' ? 'provider-unavailable' : 'provider-exit');
    return unavailable('provider-json');
  }
  if (result.error === 'refused') { removeIfSame(files.state, state); return start(manifest, files, deps); }
  return unavailable({ timeout: 'provider-timeout', limit: 'provider-output-limit', json: 'provider-json' }[result.error] || 'provider-unavailable');
}
function ping(state) {
  const result = callSync(state.port, { token: state.token, op: 'ping' });
  return result.reply && result.reply.ok === true ? result.reply : null;
}
function ensureReady(manifest, manifestPath, waitMs, deps = {}) {
  const files = stateFiles(manifest, manifestPath);
  const deadline = Date.now() + waitMs;
  while (Date.now() < deadline) {
    const state = liveState(files);
    if (state && ping(state)) return true;
    if (!state) {
      const lock = lockInfo(files.lock);
      if (lock && lock.failed && lock.ageMs < LOCK_TTL_MS) return false;
      if (!lock || lock.ageMs >= LOCK_TTL_MS) start(manifest, files, deps);
    }
    sleep(100);
  }
  return false;
}
function status(manifest, manifestPath) {
  const state = liveState(stateFiles(manifest, manifestPath));
  const reply = state && ping(state);
  return reply ? { running: true, pid: state.pid, port: state.port, startedAt: state.startedAt, model: reply.model } : { running: false };
}
function stop(manifest, manifestPath) {
  const files = stateFiles(manifest, manifestPath);
  const state = liveState(files);
  if (!state) return false;
  const result = callSync(state.port, { token: state.token, op: 'shutdown' });
  if (!(result.reply && result.reply.ok === true)) {
    try { process.kill(state.pid); } catch (_) { /* already exited */ }
    removeIfSame(files.state, state);
  }
  return true;
}

if (require.main === module) {
  const [op, manifestPath, extra] = process.argv.slice(2);
  let manifest = null;
  try {
    if (!['start', 'status', 'stop'].includes(op) || extra) throw new Error('usage');
    manifest = require('./provider').readManifest(manifestPath);
  } catch (_) {
    console.error('Usage: resident.js start|status|stop <absolute manifest path>');
    process.exit(2);
  }
  if (op === 'start') process.exitCode = ensureReady(manifest, manifestPath, 60000) ? 0 : 1;
  if (op === 'stop') stop(manifest, manifestPath);
  process.stdout.write(`${JSON.stringify(status(manifest, manifestPath))}\n`);
}
module.exports = { stateFiles, readState, callSync, score, ensureReady, status, stop, LOCK_TTL_MS, CALL_TIMEOUT_MS };
