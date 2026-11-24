'use strict';

// #453 P2: the OpenCode plugin accepts only V2 event shapes at the
// ctx.event.subscribe() boundary. Negative rows B-E start with a fresh,
// unbound session and assert zero ctx.session.get lookups at the pulled-next
// checkpoint before sending the matching V2 positive control for the same ID.

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

async function waitUntil(predicate, timeoutMs = DEADLINE_MS) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (predicate()) return true;
    if (Date.now() >= deadline) return false;
    await new Promise(resolve => setTimeout(resolve, 20));
  }
}

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
  const sessionLookups = [];
  const queue = [];
  let wake = null;
  let afterYieldWaiter = null;

  const failAfterYieldWaiter = reason => {
    if (!afterYieldWaiter) return;
    const waiter = afterYieldWaiter;
    afterYieldWaiter = null;
    waiter.reject(reason);
  };

  const ctx = {
    location: { directory: workspace },
    session: {
      get: async ({ sessionID }) => {
        sessionLookups.push(sessionID);
        return { id: sessionID, location: { directory: workspace } };
      },
      hook: async () => ({ dispose: async () => {} }),
      prompt: async input => { prompts.push(input); return {}; },
      context: async () => [],
    },
    tool: { hook: async (name, callback) => { toolHooks.set(name, callback); return { dispose: async () => {} }; } },
    event: {
      subscribe: ({ signal }) => ({
        [Symbol.asyncIterator]: () => ({
          next: () => {
            if (afterYieldWaiter) {
              const waiter = afterYieldWaiter;
              afterYieldWaiter = null;
              waiter.resolve();
            }
            if (queue.length) {
              const item = queue.shift();
              if (item.waiter) afterYieldWaiter = item.waiter;
              return Promise.resolve({ value: item.event, done: false });
            }
            if (signal.aborted) return Promise.resolve({ done: true });
            return new Promise(resolve => {
              const onAbort = () => {
                wake = null;
                failAfterYieldWaiter(new Error('Subscriber aborted before pulling next event'));
                resolve({ done: true });
              };
              signal.addEventListener('abort', onAbort, { once: true });
              wake = item => {
                signal.removeEventListener('abort', onAbort);
                wake = null;
                if (item.waiter) afterYieldWaiter = item.waiter;
                resolve({ value: item.event, done: false });
              };
            });
          },
          return: async () => {
            failAfterYieldWaiter(new Error('Subscriber exited loop before pulling next event'));
            return { done: true };
          },
        }),
      }),
    },
  };
  return {
    dir, workspace, ctx, toolHooks, prompts,
    lookupsFor: sessionID => sessionLookups.filter(id => id === sessionID),
    emit(event) {
      const item = { event, waiter: null };
      if (wake) wake(item);
      else queue.push(item);
    },
    emitAndAwaitNext(event, timeoutMs = DEADLINE_MS) {
      assert.equal(afterYieldWaiter, null, 'previous event checkpoint must settle before emitting another');
      return new Promise((resolve, reject) => {
        let settled = false;
        let waiter;
        const finish = fn => value => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          if (afterYieldWaiter === waiter) afterYieldWaiter = null;
          fn(value);
        };
        const timer = setTimeout(() => {
          finish(reject)(new Error(`Subscriber did not pull next event within ${timeoutMs}ms`));
        }, timeoutMs);
        waiter = {
          resolve: finish(resolve),
          reject: finish(reject),
        };
        const item = { event, waiter };
        if (wake) wake(item);
        else queue.push(item);
      });
    },
    restore() {
      failAfterYieldWaiter(new Error('Fixture restored before subscriber pulled next event'));
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

async function withPlugin(body) {
  const f = fixture();
  let dispose;
  try {
    const mod = await import(pathToFileURL(PLUGIN).href);
    dispose = await mod.default.setup(f.ctx);
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
  test(`row ${row}: ${label} performs no session lookup at pulled-next checkpoint, while V2 completion for the same unbound ID does`, { concurrency: false }, async () => {
    await withPlugin(async f => {
      const sid = `s453-${row}`;
      await f.emitAndAwaitNext(make(sid));
      assert.equal(f.lookupsFor(sid).length, 0, `row ${row}: unsupported shape must not look up session`);
      assert.equal(f.prompts.length, 0, `row ${row}: unsupported shape must not prompt`);

      await f.emitAndAwaitNext(v2Event('session.execution.succeeded', sid));
      assert.equal(f.lookupsFor(sid).length, 1, `row ${row} positive control: V2 completion looks up unbound session`);
    });
  });
}

test('row A: session.execution.succeeded with data.sessionID sends the verification reminder prompt', { concurrency: false }, async () => {
  await withPlugin(async f => {
    const sid = 's453-A';
    await sendEdit(f, sid);
    assert.equal(readEditState(f, sid)?.verificationPending, true, 'the V2 edit created pending state');
    await f.emitAndAwaitNext(v2Event('session.execution.succeeded', sid));
    assert.equal(await waitUntil(() => f.prompts.length > 0), true, 'the reminder prompt is sent');
    assert.equal(f.prompts.length, 1, 'exactly one prompt is sent');
    assert.equal(f.prompts[0].sessionID, sid);
    assert.match(String(f.prompts[0].text), /\S/, 'the prompt carries reminder text');
  });
});

test('row E: session.created with properties.info.id performs no session lookup at pulled-next checkpoint, while V2 created for the same unbound ID does', { concurrency: false }, async () => {
  await withPlugin(async f => {
    const sid = 's453-E';
    await f.emitAndAwaitNext({ type: 'session.created', properties: { info: { id: sid } } });
    assert.equal(f.lookupsFor(sid).length, 0, 'row E: legacy-shaped created event must not look up session');

    await f.emitAndAwaitNext({ type: 'session.created', data: { sessionID: sid } });
    assert.equal(f.lookupsFor(sid).length, 1, 'row E positive control: V2 created event looks up unbound session');
  });
});

test('row F: session.created with data.sessionID resets session state', { concurrency: false }, async () => {
  await withPlugin(async f => {
    const sid = 's453-F';
    await sendEdit(f, sid);
    assert.equal(readEditState(f, sid)?.verificationPending, true, 'the V2 edit created pending state');
    await f.emitAndAwaitNext({ type: 'session.created', data: { sessionID: sid } });
    const reset = await waitUntil(() => readEditState(f, sid)?.verificationPending !== true);
    assert.equal(reset, true, 'row F positive control: V2 created event resets session state');
  });
});
