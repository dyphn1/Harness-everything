#!/usr/bin/env node
'use strict';
// Research evaluation driver for the fine-tuned Laya bridge (#255 Phase 3).
// It does NOT touch provider.js/resident.js (still cua-only): it starts the
// laya resident server itself, scores cases through it, and feeds the
// production decide()/evaluate() machinery. Usage:
//   score  <cases.json> <manifest.json> <records.json> [workdir]
//   report <corpus.json> <records.json> <report.json> [--secondary-threshold T]
// cases.json: { cases: [{ id, baseline, request }] } (request = holdout-style,
// context + 13 catalog options). records.json matches evaluate() input.
const fs = require('node:fs');
const path = require('node:path');
const net = require('node:net');
const { spawn } = require('node:child_process');
const { performance } = require('node:perf_hooks');
const { evaluate } = require('../harness-everything/scripts/system-one/evaluate');
const { decide } = require('../harness-everything/scripts/system-one/contract');
const { decisionPolicy } = require('../harness-everything/scripts/system-one/provider');

const ADAPTER = path.join(__dirname, '..', 'harness-everything', 'scripts', 'system-one', 'laya_adapter.py');
const CALL_TIMEOUT_MS = 30000;

function send(port, token, message) {
  return new Promise(resolve => {
    const socket = net.connect({ port, host: '127.0.0.1' });
    const chunks = [];
    const done = value => { socket.destroy(); resolve(value); };
    const timer = setTimeout(() => done({ ok: false, reason: 'timeout' }), CALL_TIMEOUT_MS);
    socket.on('connect', () => socket.end(`${JSON.stringify({ token, ...message })}\n`));
    socket.on('data', c => chunks.push(c));
    socket.on('end', () => { clearTimeout(timer);
      try { done(JSON.parse(Buffer.concat(chunks).toString('utf8'))); }
      catch (_) { done({ ok: false, reason: 'bad-reply' }); } });
    socket.on('error', () => { clearTimeout(timer); done({ ok: false, reason: 'io' }); });
  });
}

async function withServer(python, manifest, workdir, fn) {
  const manifestJson = JSON.stringify(manifest);
  const state = path.join(workdir, 'laya-research-state.json');
  const lock = path.join(workdir, 'laya-research-state.starting');
  for (const f of [state, lock]) try { fs.unlinkSync(f); } catch (_) { /* fresh */ }
  const child = spawn(python, [ADAPTER, '--serve', manifestJson, state, lock], { stdio: 'ignore' });
  const deadline = Date.now() + 120000;
  let info = null;
  while (Date.now() < deadline) {
    try { info = JSON.parse(fs.readFileSync(state, 'utf8')); if (info.port && info.token) break; } catch (_) { /* starting */ }
    if (child.exitCode !== null) throw new Error(`server exited during startup (code ${child.exitCode})`);
    await new Promise(r => setTimeout(r, 200));
    info = null;
  }
  if (!info) { child.kill('SIGKILL'); throw new Error('server did not become ready'); }
  try {
    return await fn(info);
  } finally {
    try { await send(info.port, info.token, { op: 'shutdown' }); } catch (_) { /* exiting */ }
    child.kill('SIGKILL');
  }
}

async function score(casesPath, manifestPath, recordsPath, workdir) {
  const { cases } = JSON.parse(fs.readFileSync(casesPath, 'utf8'));
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  const policy = decisionPolicy(manifest.acceptance);
  const records = await withServer(manifest.python, manifest, workdir, async info => {
    const out = [];
    for (const c of cases) {
      const runs = [];
      for (let i = 0; i < 2; i++) {
        const start = performance.now();
        const reply = await send(info.port, info.token, { op: 'score', request: c.request });
        const latencyMs = performance.now() - start;
        let decision;
        let scores = null;
        if (reply.ok) {
          decision = decide(c.request, reply.response, policy);
          if (decision.selectedId === 'unclassified') {
            decision = { ...decision, status: 'abstain', reason: 'unclassified', selectedId: null };
          }
          if (['accepted', 'abstain'].includes(decision.status)) scores = reply.response.scores.map(s => s.probability);
        } else {
          decision = { status: 'unavailable', reason: reply.reason };
        }
        runs.push({ decision, scores, latencyMs, coldStart: false });
      }
      out.push({ id: c.id, baseline: c.baseline, runs });
    }
    return out;
  });
  fs.writeFileSync(recordsPath, `${JSON.stringify(records)}\n`);
  console.log(JSON.stringify({ cases: records.length }));
}

function report(corpusPath, recordsPath, reportPath, secondaryThreshold) {
  const corpus = JSON.parse(fs.readFileSync(corpusPath, 'utf8'));
  const records = JSON.parse(fs.readFileSync(recordsPath, 'utf8'));
  const result = evaluate(corpus, records, null, { secondaryThreshold });
  fs.writeFileSync(reportPath, `${JSON.stringify(result, null, 2)}\n`);
  console.log(JSON.stringify({ cases: result.cases, coverage: result.model.coverage,
    acceptedPrecision: result.model.acceptedPrecision, rolloutReady: result.rolloutReady }));
}

async function main() {
  const [mode, a, b, c, d] = process.argv.slice(2);
  if (mode === 'score' && a && b && c) return score(a, b, c, d || fs.mkdtempSync('/tmp/laya-eval-'));
  if (mode === 'report' && a && b && c) {
    const t = d === undefined ? undefined : Number((d.match(/^--secondary-threshold=(.+)$/) || [])[1]);
    return report(a, b, c, t);
  }
  throw new Error('usage: system-one-eval-laya.js (score <cases> <manifest> <records> [workdir] | report <corpus> <records> <report> [--secondary-threshold=T])');
}
main().catch(err => { console.error(`laya research eval failed: ${err.message}`); process.exitCode = 1; });
