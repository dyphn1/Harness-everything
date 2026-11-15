'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { pathToFileURL } = require('node:url');
const observations = require('../hooks/scripts/lib/observations');
const exporter = require('../scripts/system-one-observations-export');

const ROOT = path.resolve(__dirname, '..');
const PLUGIN = path.join(ROOT, 'opencode-plugin', 'index.mjs');
const VALID_LABEL = '<!-- harness-label {"v":1,"validity":"actionable","contextDependent":false,"tier":"tier2","intents":["fix","test"],"workflow":"iterative-single","skills":["tdd"]} -->';

function fixture(observationMode = 'on') {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'opencode-observations-'));
  const workspace = path.join(dir, 'workspace');
  const store = path.join(dir, 'observations');
  fs.mkdirSync(workspace, { recursive: true });
  const gitInit = spawnSync('git', ['init', '-q', workspace], { encoding: 'utf8' });
  assert.equal(gitInit.status, 0, gitInit.stderr);
  const envBefore = Object.fromEntries(['HOME', 'USERPROFILE', 'HARNESS_STATE_HOME', 'HARNESS_OBSERVATIONS_DIR', 'HARNESS_OBSERVATIONS']
    .map(key => [key, process.env[key]]));
  process.env.HOME = dir;
  process.env.USERPROFILE = dir;
  process.env.HARNESS_STATE_HOME = path.join(dir, 'harness-state');
  process.env.HARNESS_OBSERVATIONS_DIR = store;
  process.env.HARNESS_OBSERVATIONS = observationMode;

  const sessionHooks = new Map();
  const toolHooks = new Map();
  const events = [];
  const waiters = [];
  let contextMessageID = 'user-message';
  let contextPrompt = 'fix the observed turn';
  let finalText = VALID_LABEL;
  const ctx = {
    location: { directory: workspace },
    session: {
      hook: async (name, callback) => {
        sessionHooks.set(name, event => {
          if (name === 'prompt') {
            contextMessageID = event.messageID || event.messageId || null;
            contextPrompt = event.prompt?.text || '';
          }
          return callback(event);
        });
        return { dispose: async () => {} };
      },
      prompt: async () => ({}),
      context: async () => [
        { info: { role: 'user', id: contextMessageID }, parts: [{ type: 'text', text: contextPrompt }] },
        { info: { role: 'assistant', id: 'assistant-message' }, parts: [{ type: 'text', text: finalText }] },
      ],
    },
    tool: {
      hook: async (name, callback) => { toolHooks.set(name, callback); return { dispose: async () => {} }; },
    },
    event: {
      subscribe: ({ signal }) => ({
        [Symbol.asyncIterator]: () => ({
          next: () => {
            if (events.length) return Promise.resolve({ value: events.shift(), done: false });
            if (signal.aborted) return Promise.resolve({ done: true });
            return new Promise(resolve => {
              waiters.push(resolve);
              signal.addEventListener('abort', () => resolve({ done: true }), { once: true });
            });
          },
        }),
      }),
    },
  };
  const push = event => {
    const waiter = waiters.shift();
    if (waiter) waiter({ value: event, done: false });
    else events.push(event);
  };

  return {
    dir, workspace, store, ctx, sessionHooks, toolHooks, push,
    setFinal(text) { finalText = text; },
    restore() {
      for (const [key, value] of Object.entries(envBefore)) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
      fs.rmSync(dir, { recursive: true, force: true });
    },
  };
}

async function install(f) {
  const mod = await import(pathToFileURL(PLUGIN).href);
  return mod.default.setup(f.ctx);
}

function recordList(store) {
  const file = path.join(store, 'observations-index.json');
  return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')).records : [];
}

async function waitFor(predicate) {
  const deadline = Date.now() + 3000;
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error('OpenCode observation was not written');
    await new Promise(resolve => setTimeout(resolve, 10));
  }
}

test('inject: the documented OpenCode hooks deliver the kernel router output and exact label line', { concurrency: false }, async () => {
  const f = fixture();
  let dispose;
  try {
    dispose = await install(f);
    assert.ok(f.sessionHooks.has('prompt'), 'setup registers prompt admission');
    assert.ok(f.sessionHooks.has('context'), 'setup registers the system context transform');
    const prompt = { sessionID: 'inject-session', messageID: 'inject-turn', prompt: { text: 'add a small behavior change' } };
    await f.sessionHooks.get('prompt')(prompt);
    const context = { sessionID: 'inject-session', kind: 'primary', system: [], messages: [] };
    await f.sessionHooks.get('context')(context);
    assert.equal(prompt.prompt.text, 'add a small behavior change', 'injection leaves the persisted user prompt unchanged');
    const injected = context.system.map(part => part.text || '').join('\n');
    assert.match(injected, /=> ROUTER WORKFLOW PLAN/);

    const expectedRun = spawnSync(process.execPath, [path.join(ROOT, 'harness-everything/scripts/kernel-router.js')], {
      cwd: f.workspace,
      env: { ...process.env, HARNESS_STATE_HOME: path.join(f.dir, 'expected-state') },
      input: JSON.stringify({ host: 'opencode', session_id: 'expected-session', cwd: f.workspace, prompt: prompt.prompt.text }),
      encoding: 'utf8', timeout: 5000,
    });
    assert.equal(expectedRun.status, 0, expectedRun.stderr);
    const exactLabelLine = expectedRun.stdout.split(/\r?\n/).find(line => line.includes('<!-- harness-label '))?.trim();
    assert.ok(exactLabelLine, 'the canonical kernel router prints its label contract');
    assert.ok(injected.includes(exactLabelLine), 'the model receives the exact kernel-router label template');
  } finally {
    if (dispose) await dispose();
    f.restore();
  }
});

test('runtime: a non-Node host binary still runs the router on Node and injects its output', { concurrency: false }, async () => {
  const f = fixture();
  let dispose;
  const originalExecPath = process.execPath;
  const hadBun = Object.hasOwn(process.versions, 'bun');
  const originalBun = process.versions.bun;
  try {
    // Reproduce the live witness: OpenCode is a compiled Bun binary, so the
    // plugin's process.execPath is the opencode executable - not node - and the
    // Bun runtime shows up as process.versions.bun. The stub below is a real,
    // executable, non-node program that exits non-zero, so the current code's
    // spawn(process.execPath, ['.js']) cannot produce router output.
    const stubRuntime = path.join(f.dir, process.platform === 'win32' ? 'stub-runtime.cmd' : 'stub-runtime');
    fs.writeFileSync(stubRuntime, process.platform === 'win32' ? '@exit /b 1\r\n' : '#!/bin/sh\nexit 1\n', { mode: 0o755 });
    Object.defineProperty(process, 'execPath', { value: stubRuntime, configurable: true, writable: true });
    Object.defineProperty(process.versions, 'bun', { value: '1.2.0', configurable: true });

    dispose = await install(f);
    const prompt = { sessionID: 'runtime-session', messageID: 'runtime-turn', prompt: { text: 'add a small behavior change' } };
    await f.sessionHooks.get('prompt')(prompt);
    const context = { sessionID: 'runtime-session', kind: 'primary', system: [], messages: [] };
    await f.sessionHooks.get('context')(context);
    const injected = context.system.map(part => part.text || '').join('\n');
    assert.match(injected, /=> ROUTER WORKFLOW PLAN/, 'the router ran on Node despite a non-Node host binary');
  } finally {
    if (dispose) await dispose();
    Object.defineProperty(process, 'execPath', { value: originalExecPath, configurable: true, writable: true });
    if (hadBun) Object.defineProperty(process.versions, 'bun', { value: originalBun, configurable: true });
    else delete process.versions.bun;
    f.restore();
  }
});

test('record: OpenCode prompt, tool and idle events append one host-tagged record to the shared store', { concurrency: false }, async () => {
  const f = fixture();
  let dispose;
  try {
    dispose = await install(f);
    assert.ok(f.sessionHooks.has('prompt'));
    await f.sessionHooks.get('prompt')({ sessionID: 'record-session', messageID: 'record-turn', prompt: { text: 'fix the observed turn' } });
    await f.sessionHooks.get('prompt')({ sessionID: 'record-session', messageID: 'record-turn', prompt: { text: 'fix the observed turn' } });
    await f.toolHooks.get('execute.after')({
      status: 'completed', tool: 'edit', sessionID: 'record-session', id: 'call-1', input: { filePath: 'changed.js' }, result: {},
    });
    f.push({ type: 'session.idle', sessionID: 'record-session' });
    await waitFor(() => recordList(f.store).length === 1);
    const [record] = recordList(f.store);
    assert.equal(record.host, 'opencode');
    assert.equal(record.writer.sessionId, 'record-session');
    assert.equal(record.writer.turnId, 'record-turn');
    assert.equal(record.turn, 1, 'a repeated admission with the same message id does not start a second turn');
    assert.equal(record.selfReport.tier, 'tier2');
    assert.equal(record.behavior.filesWritten, 1);
    const text = JSON.parse(fs.readFileSync(path.join(f.store, 'text', `${record.contentSha256}.json`), 'utf8'));
    assert.equal(text.prompt, 'fix the observed turn');
  } finally {
    if (dispose) await dispose();
    f.restore();
  }
});

test('malformed: invalid labels remain null with a reason and export counts are grouped by host', { concurrency: false }, async () => {
  const f = fixture();
  let dispose;
  try {
    dispose = await install(f);
    f.setFinal('Done.\n<!-- harness-label {"validity":"valid","tier":3,"skills_used":[]} -->');
    await f.sessionHooks.get('prompt')({ sessionID: 'malformed-opencode', messageID: 'bad-opencode', prompt: { text: 'record an invalid label' } });
    f.push({ type: 'session.idle', sessionID: 'malformed-opencode' });
    await waitFor(() => recordList(f.store).length === 1);
    assert.equal(recordList(f.store)[0].selfReport, null);
    assert.equal(recordList(f.store)[0].selfReportReason, 'label-invalid');

    observations.handle({ host: 'claude', session_id: 'malformed-claude', cwd: f.workspace,
      hook_event_name: 'UserPromptSubmit', turn_id: 'bad-claude', prompt: 'another malformed label' }, process.env);
    observations.handle({ host: 'claude', session_id: 'malformed-claude', cwd: f.workspace,
      hook_event_name: 'Stop', turn_id: 'bad-claude', last_assistant_message: '<!-- harness-label {bad json} -->' }, process.env);
    observations.handle({ host: 'claude', session_id: 'missing-label', cwd: f.workspace,
      hook_event_name: 'UserPromptSubmit', turn_id: 'missing', prompt: 'label omitted' }, process.env);
    observations.handle({ host: 'claude', session_id: 'missing-label', cwd: f.workspace,
      hook_event_name: 'Stop', turn_id: 'missing', last_assistant_message: 'No label' }, process.env);

    const output = path.join(f.dir, 'export');
    const report = exporter.run(['--store', f.store, '--out', output]);
    assert.deepEqual(report.malformedLabelsByHost, { opencode: 1, claude: 1 });
    assert.equal(report.selfReportReasons['label-missing'], 1, 'a missing label is kept separate from malformed labels');
    const selfOnly = exporter.run(['--store', f.store, '--out', path.join(f.dir, 'self-only'), '--self-report-only']);
    assert.deepEqual(selfOnly.malformedLabelsByHost, { opencode: 1, claude: 1 }, 'self-report filtering does not hide malformed-label counts');
  } finally {
    if (dispose) await dispose();
    f.restore();
  }
});

test('opt-out: HARNESS_OBSERVATIONS=off disables capture while prompt routing stays active', { concurrency: false }, async () => {
  const f = fixture('off');
  let dispose;
  try {
    dispose = await install(f);
    assert.ok(f.sessionHooks.has('prompt'));
    await f.sessionHooks.get('prompt')({ sessionID: 'optout-session', messageID: 'optout-turn', prompt: { text: 'routing still applies' } });
    const context = { sessionID: 'optout-session', kind: 'primary', system: [], messages: [] };
    await f.sessionHooks.get('context')(context);
    assert.match(context.system.map(part => part.text || '').join('\n'), /=> ROUTER WORKFLOW PLAN/);
    f.push({ type: 'session.idle', sessionID: 'optout-session' });
    await new Promise(resolve => setTimeout(resolve, 50));
    assert.deepEqual(recordList(f.store), []);
  } finally {
    if (dispose) await dispose();
    f.restore();
  }
});
