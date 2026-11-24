'use strict';

// #453 P2: the OpenCode plugin accepts only V2 event shapes at the
// ctx.event.subscribe() boundary. Every negative row shares a fixture with a
// positive control (row A / row F) so "no effect" is not a timing artefact.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { pathToFileURL } = require('node:url');
const workspaceState = require('../scripts/lib/workspace');
const harnessState = require('../hooks/scripts/lib/harness-state');

const ROOT = path.resolve(__dirname, '..');
const PLUGIN = process.env.P453_PLUGIN || path.join(ROOT, 'opencode-plugin', 'index.mjs');
const DEADLINE_MS = 8000;
const QUIET_MS = 400;

async function waitUntil(predicate, timeoutMs = DEADLINE_MS) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (predicate()) return true;
    if (Date.now() >= deadline) return false;
    await new Promise(resolve => setTimeout(resolve, 20));
  }
}

const quiet = ms => new Promise(resolve => setTimeout(resolve, ms));

function v2Event(type, sessionID) {
  return { id: `evt-${type}-${sessionID}`, created: Date.now(), type, durable: true, data: { sessionID } };
}

function fixture() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'opencode-453-'));
  const workspace = path.join(dir, 'workspace');
  fs.mkdirSync(workspace, { recursive: true });
  const gitInit = spawnSync('git', ['init', '-q', workspace], { encoding: 'utf8' });
  assert.equal(gitInit.status, 0, gitInit.stderr);
  fs.writeFileSync(path.join(workspace, 'package.json'), JSON.stringify({
    name: 'opencode-453-fixture', version: '1.0.0', scripts: { test: 'node verify.js' },
  }));
  fs.writeFileSync(path.join(workspace, 'verify.js'), 'process.exit(1)\n');
  const envBefore = Object.fromEntries(['HOME', 'USERPROFILE', 'HARNESS_STATE_HOME', 'HARNESS_OBSERVATIONS']
    .map(key => [key, process.env[key]]));
  process.env.HOME = dir;
  process.env.USERPROFILE = dir;
  process.env.HARNESS_STATE_HOME = path.join(dir, 'harness-state');
  process.env.HARNESS_OBSERVATIONS = 'off';

  const toolHooks = new Map();
  const prompts = [];
  const queue = [];
  let wake = null;
  const ctx = {
    location: { directory: workspace },
    session: {
      get: async ({ sessionID }) => ({ id: sessionID, location: { directory: workspace } }),
      hook: async () => ({ dispose: async () => {} }),
      prompt: async input => { prompts.push(input); return {}; },
      context: async () => [],
    },
    tool: { hook: async (name, callback) => { toolHooks.set(name, callback); return { dispose: async () => {} }; } },
    event: {
      subscribe: ({ signal }) => ({
        [Symbol.asyncIterator]: () => ({
          next: () => {
            if (queue.length) return Promise.resolve({ value: queue.shift(), done: false });
            if (signal.aborted) return Promise.resolve({ done: true });
            return new Promise(resolve => {
              const onAbort = () => { wake = null; resolve({ done: true }); };
              signal.addEventListener('abort', onAbort, { once: true });
              wake = event => { signal.removeEventListener('abort', onAbort); wake = null; resolve({ value: event, done: false }); };
            });
          },
          return: async () => ({ done: true }),
        }),
      }),
    },
  };
  return {
    dir, workspace, ctx, toolHooks, prompts,
    emit(event) { if (wake) wake(event); else queue.push(event); },
    restore() {
      for (const [key, value] of Object.entries(envBefore)) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
      fs.rmSync(dir, { recursive: true, force: true });
    },
  };
}

function editStateFile(f, sessionID) {
  return path.join(workspaceState.getWorkspaceStateDir(f.workspace), 'state', 'sessions',
    harnessState.sessionDirectoryName(sessionID), 'edit-state.json');
}

function readEditState(f, sessionID) {
  const file = editStateFile(f, sessionID);
  return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : null;
}

async function sendEdit(f, sessionID) {
  const event = { tool: 'edit', sessionID, id: `edit-${sessionID}`, messageID: `assistant-${sessionID}`, input: { filePath: 'changed.js' } };
  await f.toolHooks.get('execute.before')(event);
  await f.toolHooks.get('execute.after')({ ...event, status: 'completed', result: {} });
}

async function withPlugin(sessionID, body) {
  const f = fixture();
  let dispose;
  try {
    const mod = await import(pathToFileURL(PLUGIN).href);
    dispose = await mod.default.setup(f.ctx);
    await sendEdit(f, sessionID);
    assert.equal(readEditState(f, sessionID)?.verificationPending, true, 'the V2 edit created pending state');
    await body(f);
  } finally {
    if (dispose) await dispose();
    f.restore();
  }
}

const turnCases = [
  ['B', 'external session.idle with a valid V2 id', sid => ({ type: 'session.idle', data: { sessionID: sid } })],
  ['C', 'execution.succeeded with only a top-level sessionID', sid => ({ type: 'session.execution.succeeded', sessionID: sid })],
  ['D', 'execution.succeeded with only properties.sessionID', sid => ({ type: 'session.execution.succeeded', properties: { sessionID: sid } })],
];

for (const [row, label, make] of turnCases) {
  test(`row ${row}: ${label} produces no verification prompt, while row A's supported event does`, { concurrency: false }, async () => {
    await withPlugin(`s453-${row}`, async f => {
      const sid = `s453-${row}`;
      f.emit(make(sid));
      // Positive control on the same fixture: the supported event must prompt,
      // and the earlier unsupported event must not have prompted first.
      await quiet(QUIET_MS);
      assert.equal(f.prompts.length, 0, `row ${row}: unsupported shape must not prompt`);
      f.emit(v2Event('session.execution.succeeded', sid));
      assert.equal(await waitUntil(() => f.prompts.length > 0), true, 'row A positive control: V2 completion sends the reminder prompt');
      assert.equal(f.prompts.length, 1, 'exactly one prompt, from the supported event only');
      assert.equal(f.prompts[0].sessionID, sid);
    });
  });
}

test('row A: session.execution.succeeded with data.sessionID sends the verification reminder prompt', { concurrency: false }, async () => {
  await withPlugin('s453-A', async f => {
    f.emit(v2Event('session.execution.succeeded', 's453-A'));
    assert.equal(await waitUntil(() => f.prompts.length > 0), true, 'the reminder prompt is sent');
    assert.equal(f.prompts[0].sessionID, 's453-A');
    assert.match(String(f.prompts[0].text), /\S/, 'the prompt carries reminder text');
  });
});

test('row E vs F: session.created resets state only with data.sessionID, not properties.info.id', { concurrency: false }, async () => {
  await withPlugin('s453-EF', async f => {
    const sid = 's453-EF';
    f.emit({ type: 'session.created', properties: { info: { id: sid } } });
    await quiet(QUIET_MS);
    assert.equal(readEditState(f, sid)?.verificationPending, true, 'row E: legacy-shaped created event does not reset');
    f.emit({ type: 'session.created', data: { sessionID: sid } });
    const reset = await waitUntil(() => readEditState(f, sid)?.verificationPending !== true);
    assert.equal(reset, true, 'row F positive control: V2 created event resets session state');
  });
});
