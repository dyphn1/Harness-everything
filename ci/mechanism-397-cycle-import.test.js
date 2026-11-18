'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { test } = require('node:test');
const { collect } = require('../scripts/system-one-cycle/collect');
const { importStore } = require('../scripts/system-one-observations-import-store');
const observations = require('../hooks/scripts/lib/observations');

const ROOT = path.resolve(__dirname, '..');
const PLUGIN = path.join(ROOT, 'opencode-plugin', 'index.mjs');
function isOutside(root, dir, pathApi = path) {
  const relative = pathApi.relative(root, dir);
  return relative === '..' || relative.startsWith(`..${pathApi.sep}`) || pathApi.isAbsolute(relative);
}

const win32Root = 'D:\\a\\Harness-everything\\Harness-everything';
test('test-root containment handles Windows path boundaries', () => {
  const win32Parent = path.win32.dirname(win32Root);
  const win32Child = path.win32.join(win32Root, 'ci');
  const win32DotChild = path.win32.join(win32Root, '..cache');
  const win32Sibling = path.win32.join(win32Parent, `${path.win32.basename(win32Root)}-other`);
  const win32CrossDrive = 'C:\\Users\\runner\\AppData\\Local\\Temp\\fixture';
  const crossDriveRelative = path.win32.relative(win32Root, win32CrossDrive);

  assert.equal(isOutside(win32Root, win32Child, path.win32), false, 'a root child is inside');
  assert.equal(isOutside(win32Root, win32DotChild, path.win32), false, 'a child whose name starts with two dots is still inside');
  assert.equal(win32Sibling.startsWith(win32Root), true, 'the sibling shares the root string prefix');
  assert.equal(isOutside(win32Root, win32Sibling, path.win32), true, 'a similar-prefix sibling is outside');
  assert.equal(isOutside(win32Root, win32Parent, path.win32), true, 'the parent escape is outside');
  assert.equal(path.win32.isAbsolute(crossDriveRelative), true, 'cross-drive relative result is absolute');
  assert.equal(crossDriveRelative.startsWith('..'), false, 'the old prefix-only check misses a cross-drive path');
  assert.equal(isOutside(win32Root, win32CrossDrive, path.win32), true, 'a cross-drive temp path is outside');
});

const LABELS = [
  '<!-- harness-label {"v":1,"validity":"actionable","tier":"tier2","intents":["fix"],"workflow":"iterative-single","skills":[]} -->',
  '<!-- harness-label {"v":1,"validity":"actionable","tier":"tier2","intents":["edit"],"workflow":"iterative-single","skills":[]} -->',
];

function recordList(store) {
  const file = path.join(store, 'observations-index.json');
  return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')).records : [];
}

function fixture() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mechanism-397-cycle-import-'));
  assert.ok(isOutside(ROOT, dir), 'fixture data must stay outside the repository');
  const workspace = path.join(dir, 'workspace');
  const store = path.join(dir, 'live-observations');
  const sessions = path.join(dir, 'codex-sessions');
  const cycle = path.join(dir, 'cycle');
  fs.mkdirSync(workspace, { recursive: true });
  fs.mkdirSync(sessions, { recursive: true });

  const envKeys = ['HOME', 'USERPROFILE', 'CODEX_HOME', 'HARNESS_STATE_HOME', 'HARNESS_OBSERVATIONS_DIR', 'HARNESS_OBSERVATIONS', 'HARNESS_DOC_RECONCILIATION_PILOT'];
  const oldEnv = Object.fromEntries(envKeys.map(key => [key, process.env[key]]));
  process.env.HOME = dir;
  process.env.USERPROFILE = dir;
  process.env.CODEX_HOME = path.join(dir, 'codex-home');
  process.env.HARNESS_STATE_HOME = path.join(dir, 'harness-state');
  process.env.HARNESS_OBSERVATIONS_DIR = store;
  process.env.HARNESS_OBSERVATIONS = 'on';
  process.env.HARNESS_DOC_RECONCILIATION_PILOT = '0';

  const sessionHooks = new Map();
  const toolHooks = new Map();
  const events = [];
  const waiters = [];
  let currentTurn = { messageID: null, prompt: '', final: '' };
  const ctx = {
    location: { directory: workspace },
    session: {
      hook: async (name, callback) => {
        sessionHooks.set(name, callback);
        return { dispose: async () => {} };
      },
      prompt: async () => ({}),
      get: async ({ sessionID }) => ({ id: sessionID, location: { directory: workspace } }),
      context: async () => [
        { info: { role: 'user', id: currentTurn.messageID }, parts: [{ type: 'text', text: currentTurn.prompt }] },
        { info: { role: 'assistant', id: `assistant-${currentTurn.messageID}` }, parts: [{ type: 'text', text: currentTurn.final }] },
      ],
    },
    tool: { hook: async (name, callback) => { toolHooks.set(name, callback); return { dispose: async () => {} }; } },
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
    dir, workspace, store, sessions, cycle, ctx, sessionHooks, toolHooks, push,
    setTurn(messageID, prompt, final) { currentTurn = { messageID, prompt, final }; },
    restore() {
      for (const [key, value] of Object.entries(oldEnv)) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
      fs.rmSync(dir, { recursive: true, force: true });
    },
  };
}

async function waitFor(predicate) {
  const deadline = Date.now() + 5000;
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error('OpenCode observations were not captured');
    await new Promise(resolve => setTimeout(resolve, 10));
  }
}

function writeCodexSession(sessions, sessionID = 'codex-backfill-session', turnId = 'codex-backfill-turn') {
  const startedAt = new Date().toISOString();
  const completedAt = new Date(Date.now() + 1).toISOString();
  const rows = [
    { type: 'session_meta', payload: { session_id: sessionID } },
    { type: 'event_msg', timestamp: startedAt, payload: { type: 'task_started', turn_id: turnId, started_at: startedAt } },
    { type: 'response_item', payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'Codex positive control' }] } },
    { type: 'event_msg', timestamp: completedAt, payload: { type: 'task_complete', turn_id: turnId, last_agent_message: LABELS[0] } },
  ];
  fs.writeFileSync(path.join(sessions, `${sessionID}.jsonl`), rows.map(row => JSON.stringify(row)).join('\n') + '\n');
}

function captureTurn(store, { host = 'opencode', sessionID, turnId, prompt, final }) {
  const env = { HARNESS_OBSERVATIONS: 'on', HARNESS_OBSERVATIONS_DIR: store };
  observations.handle({ hook_event_name: 'UserPromptSubmit', host, session_id: sessionID, turn_id: turnId, prompt }, env);
  observations.handle({ hook_event_name: 'Stop', host, session_id: sessionID, turn_id: turnId, last_assistant_message: final }, env);
}

function jsonl(file) {
  return fs.readFileSync(file, 'utf8').split(/\r?\n/).filter(Boolean).map(JSON.parse);
}

function json(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function collectReport(dataDir) {
  return json(path.join(dataDir, 'training/observed/import-report.json'));
}

function snapshotCycle(dataDir) {
  const training = path.join(dataDir, 'training');
  const files = {};
  function walk(directory) {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const file = path.join(directory, entry.name);
      if (entry.isDirectory()) walk(file);
      else {
        const relative = path.relative(training, file).split(path.sep).join('/');
        let content = fs.readFileSync(file, 'utf8');
        if (relative === 'observed/import-report.json') {
          const report = JSON.parse(content);
          report.run.startedAt = '<run-time>';
          content = JSON.stringify(report, null, 2) + '\n';
        } else if (relative === 'observed/export-report.json') {
          const report = JSON.parse(content);
          report.exportedAt = '<run-time>';
          content = JSON.stringify(report, null, 2) + '\n';
        }
        files[relative] = content;
      }
    }
  }
  walk(training);
  return files;
}

test('cycle collect imports production OpenCode captures into private prompt/label pairs', { concurrency: false }, async () => {
  const f = fixture();
  let dispose;
  try {
    const plugin = await import(pathToFileURL(PLUGIN).href);
    dispose = await plugin.default.setup(f.ctx);
    assert.ok(f.sessionHooks.has('prompt'), 'the production OpenCode plugin registered prompt capture');

    const turns = [
      { sessionID: 'opencode-cycle-session-a', prompt: 'Fix parser. Contact synthetic.user@example.test at /Users/synthetic-owner/private-alpha.txt' },
      { sessionID: 'opencode-cycle-session-b', prompt: 'Edit response. Contact second.user@example.test at /Users/synthetic-owner/private-beta.txt' },
    ];
    for (const [index, turn] of turns.entries()) {
      const messageID = 'shared-turn';
      f.setTurn(messageID, turn.prompt, LABELS[index]);
      await f.sessionHooks.get('prompt')({ sessionID: turn.sessionID, messageID, prompt: { text: turn.prompt } });
      f.push({ type: 'session.execution.succeeded', data: { sessionID: turn.sessionID } });
      await waitFor(() => recordList(f.store).length === index + 1);
    }

    const openCodeRecords = recordList(f.store).filter(record => record.host === 'opencode');
    assert.equal(openCodeRecords.length, 2, 'both valid OpenCode turns were captured in the isolated live store');
    captureTurn(f.store, { host: 'codex', sessionID: turns[0].sessionID, turnId: 'shared-turn', prompt: 'Codex live overlap', final: LABELS[0] });
    writeCodexSession(f.sessions, turns[0].sessionID, 'shared-turn');
    const result = collect({ dataDir: f.cycle, since: '2026-01-01', sessionsDir: f.sessions });
    assert.equal(result.prompts, 3, 'two OpenCode turns and the production Codex backfill are collected');
    const equivalentCycle = path.join(f.dir, 'equivalent-cycle');
    const equivalentResult = collect({ dataDir: equivalentCycle, since: '2026-01-01', sessionsDir: f.sessions });
    assert.deepEqual(equivalentResult, result);
    assert.deepEqual(snapshotCycle(equivalentCycle), snapshotCycle(f.cycle),
      'clean equivalent collects produce the same files and persistent state apart from per-run timestamps');

    const prompts = jsonl(path.join(f.cycle, 'training/observed/prompts-observed.jsonl'));
    const labels = jsonl(path.join(f.cycle, 'training/observed/labels-observed.jsonl'));
    for (const record of openCodeRecords) {
      const prompt = prompts.find(row => row.id === record.id);
      const label = labels.find(row => row.id === record.id);
      assert.ok(prompt, 'OpenCode rows are absent because collect never imports the live observations store');
      assert.ok(label, 'every imported OpenCode prompt has its matching label');
      assert.equal(label.host, 'opencode', 'the final label projection preserves the capture host');
      assert.equal(label.tier, record.selfReport.tier);
      assert.deepEqual(label.intents, record.selfReport.intents);
      assert.match(prompt.text, /<email>/);
      assert.match(prompt.text, /<home>/);
      assert.ok(!prompt.text.includes('synthetic.user@example.test') && !prompt.text.includes('second.user@example.test'));
      assert.ok(!prompt.text.includes('/Users/synthetic-owner'));
    }

    const destinationRecords = recordList(path.join(f.cycle, 'training/observation-store'));
    const sharedTurn = destinationRecords.filter(record => record.writer.turnId === 'shared-turn');
    assert.equal(sharedTurn.length, 3, 'the shared turn id remains distinct across two sessions and two hosts');
    assert.equal(new Set(sharedTurn.map(record => record.id)).size, 3);
    assert.deepEqual(sharedTurn.map(record => record.host).sort(), ['codex', 'opencode', 'opencode']);
    const codexRecord = destinationRecords.find(record => record.host === 'codex');
    assert.equal(codexRecord.captureMethod, 'session-backfill', 'Codex backfill remains the positive control and wins this arrival order');
    assert.equal(labels.find(row => row.id === codexRecord.id).host, 'codex');
    const firstReport = collectReport(f.cycle);
    assert.equal(firstReport.schemaVersion, 1);
    assert.deepEqual(Object.keys(firstReport).sort(), ['byHost', 'run', 'schemaVersion', 'sources']);
    assert.deepEqual(Object.keys(firstReport.sources).sort(), ['codex', 'live']);
    assert.deepEqual(Object.keys(firstReport.sources.live).sort(), ['root', 'status']);
    assert.deepEqual(Object.keys(firstReport.sources.codex).sort(), ['status']);
    assert.ok(Number.isFinite(Date.parse(firstReport.run.startedAt)));
    assert.equal(firstReport.sources.live.root, 'configured-private-store');
    const reportJson = JSON.stringify(firstReport);
    assert.ok(!reportJson.includes(f.dir));
    assert.ok(!reportJson.includes('synthetic.user@example.test') && !reportJson.includes('private-alpha.txt'));
    if (process.platform !== 'win32') {
      assert.equal(fs.statSync(path.join(f.cycle, 'training/observed/import-report.json')).mode & 0o777, 0o600);
      assert.equal(fs.statSync(f.cycle).mode & 0o777, 0o700);
    }
    assert.equal(firstReport.sources.live.status, 'ok');
    assert.equal(firstReport.sources.codex.status, 'ok');
    assert.deepEqual(firstReport.byHost.opencode, { persisted: 2, duplicate: 0, ambiguous: 0, importFailure: 0 });
    assert.deepEqual(firstReport.byHost.codex, { persisted: 0, duplicate: 1, ambiguous: 0, importFailure: 0 });

    collect({ dataDir: f.cycle, since: '2026-01-01', sessionsDir: f.sessions });
    const repeatReport = collectReport(f.cycle);
    assert.deepEqual(repeatReport.byHost.opencode, { persisted: 0, duplicate: 2, ambiguous: 0, importFailure: 0 });
    assert.deepEqual(repeatReport.byHost.codex, { persisted: 0, duplicate: 1, ambiguous: 0, importFailure: 0 });
    assert.equal(recordList(path.join(f.cycle, 'training/observation-store')).length, 3, 'repeat collect adds no observation rows');

    const liveFirstCycle = path.join(f.dir, 'live-first-cycle');
    const liveFirstStore = path.join(liveFirstCycle, 'training/observation-store');
    const liveFirst = importStore({ sourceRoot: f.store, store: liveFirstStore, since: '2026-01-01' });
    assert.equal(liveFirst.byHost.opencode.persisted, 2);
    assert.equal(liveFirst.byHost.codex.persisted, 1);
    collect({ dataDir: liveFirstCycle, since: '2026-01-01', sessionsDir: f.sessions });
    const reverseOrderReport = collectReport(liveFirstCycle);
    assert.equal(reverseOrderReport.byHost.opencode.duplicate, 2);
    assert.equal(reverseOrderReport.byHost.codex.duplicate, 1);
    assert.equal(recordList(liveFirstStore).find(record => record.host === 'codex').captureMethod, undefined,
      'live capture wins when it arrives before the Codex backfill');
  } finally {
    if (dispose) await dispose();
    f.restore();
  }
});

test('live-store merge retains unlabeled metadata without reviving unavailable text', () => {
  const f = fixture();
  try {
    captureTurn(f.store, { sessionID: 'unlabeled-session', turnId: 'unlabeled-turn', prompt: 'Unlabeled observation', final: 'No label was emitted.' });
    captureTurn(f.store, { sessionID: 'malformed-session', turnId: 'malformed-turn', prompt: 'Malformed observation', final: '<!-- harness-label {bad json} -->' });
    captureTurn(f.store, { sessionID: 'missing-text-session', turnId: 'missing-text-turn', prompt: 'Missing text observation', final: LABELS[0] });
    captureTurn(f.store, { sessionID: 'expired-text-session', turnId: 'expired-text-turn', prompt: 'Expired text observation', final: LABELS[1] });
    captureTurn(f.store, { sessionID: 'before-cutoff-session', turnId: 'before-cutoff-turn', prompt: 'Before cutoff', final: LABELS[0] });

    const sourceIndexFile = path.join(f.store, 'observations-index.json');
    const sourceIndex = json(sourceIndexFile);
    const missing = sourceIndex.records.find(record => record.writer.turnId === 'missing-text-turn');
    const expired = sourceIndex.records.find(record => record.writer.turnId === 'expired-text-turn');
    sourceIndex.records.find(record => record.writer.turnId === 'before-cutoff-turn').observedAt = '2025-12-31T23:59:59.000Z';
    const expiredUntil = new Date(Date.now() - 1000).toISOString();
    expired.validUntil = expiredUntil;
    expired.status = 'active';
    fs.writeFileSync(sourceIndexFile, JSON.stringify(sourceIndex));
    fs.unlinkSync(path.join(f.store, 'text', `${missing.contentSha256}.json`));

    const result = collect({ dataDir: f.cycle, since: '2026-01-01', sessionsDir: f.sessions });
    assert.equal(result.prompts, 0);
    const output = path.join(f.cycle, 'training/observed');
    assert.deepEqual(jsonl(path.join(output, 'prompts-observed.jsonl')), []);
    assert.deepEqual(jsonl(path.join(output, 'labels-observed.jsonl')), []);

    const destinationStore = path.join(f.cycle, 'training/observation-store');
    const records = recordList(destinationStore);
    assert.equal(records.length, 4, 'unlabeled, malformed, missing-text and expired-text metadata all survive import');
    assert.equal(records.find(record => record.writer.turnId === 'unlabeled-turn').selfReportReason, 'label-missing');
    assert.equal(records.find(record => record.writer.turnId === 'malformed-turn').selfReportReason, 'label-unparseable');
    const storedMissing = records.find(record => record.writer.turnId === 'missing-text-turn');
    const storedExpired = records.find(record => record.writer.turnId === 'expired-text-turn');
    assert.equal(fs.existsSync(path.join(destinationStore, 'text', `${storedMissing.contentSha256}.json`)), false);
    assert.equal(storedExpired.validUntil, expiredUntil, 'import keeps the original expiry deadline');
    assert.equal(storedExpired.status, 'expired');
    assert.equal(storedExpired.textDeleted, true);
    assert.equal(fs.existsSync(path.join(destinationStore, 'text', `${storedExpired.contentSha256}.json`)), false);
    assert.deepEqual(collectReport(f.cycle).byHost.opencode,
      { persisted: 4, duplicate: 0, ambiguous: 0, importFailure: 0 });
    const exportReport = json(path.join(output, 'export-report.json'));
    assert.equal(exportReport.skippedUnlabeled, 2);
    assert.equal(exportReport.skippedNoText, 2);
    const reportText = fs.readFileSync(path.join(output, 'import-report.json'), 'utf8');
    assert.ok(!reportText.includes(f.dir) && !reportText.includes('Unlabeled observation'));
  } finally {
    f.restore();
  }
});

test('missing live source is explicit and failed live imports never report persistence', () => {
  const f = fixture();
  try {
    const emptyLiveStore = path.join(f.dir, 'empty-live-store');
    fs.mkdirSync(emptyLiveStore);
    process.env.HARNESS_OBSERVATIONS_DIR = emptyLiveStore;
    const omittedSource = importStore({ store: path.join(f.dir, 'omitted-source-cycle'), since: '2026-01-01' });
    assert.equal(omittedSource.source.status, 'absent', 'omitting sourceRoot uses the configured observation store');
    const invalidSince = importStore({ sourceRoot: emptyLiveStore, store: path.join(f.dir, 'invalid-since-cycle'), since: 'not-a-date' });
    assert.equal(invalidSince.source.error, 'invalid-since');
    assert.equal(invalidSince.byHost.unknown.persisted, 0);
    const missingStore = importStore({ sourceRoot: emptyLiveStore, since: '2026-01-01' });
    assert.equal(missingStore.source.error, 'invalid-destination');
    assert.equal(missingStore.byHost.unknown.persisted, 0);
    const wrongTypeStore = importStore({ sourceRoot: emptyLiveStore, store: { path: 'unsafe' }, since: '2026-01-01' });
    assert.equal(wrongTypeStore.source.error, 'invalid-destination');
    const empty = collect({ dataDir: f.cycle, since: '2026-01-01', sessionsDir: f.sessions });
    assert.equal(empty.prompts, 0);
    const absentReport = collectReport(f.cycle);
    assert.equal(absentReport.sources.live.status, 'absent');
    assert.equal(absentReport.sources.codex.status, 'ok');
    assert.deepEqual(absentReport.byHost, {});

    const brokenCycle = path.join(f.dir, 'broken-cycle');
    process.env.HARNESS_OBSERVATIONS_DIR = f.store;
    fs.mkdirSync(f.store, { recursive: true });
    fs.writeFileSync(path.join(f.store, 'observations-index.json'), '{broken index');
    assert.throws(() => collect({ dataDir: brokenCycle, since: '2026-01-01', sessionsDir: f.sessions }), /observation import incomplete/);
    const failedReport = collectReport(brokenCycle);
    assert.equal(failedReport.sources.live.status, 'error');
    assert.equal(failedReport.sources.live.error, 'source-index-invalid');
    assert.deepEqual(failedReport.byHost.unknown, { persisted: 0, duplicate: 0, ambiguous: 0, importFailure: 1 });
    assert.equal(recordList(path.join(brokenCycle, 'training/observation-store')).length, 0);
    assert.equal(fs.existsSync(path.join(brokenCycle, 'training/observed/prompts-observed.jsonl')), false,
      'failed imports do not proceed to export');

    const ambiguousStore = path.join(f.dir, 'ambiguous-live-store');
    captureTurn(ambiguousStore, { sessionID: 'ambiguous-session', turnId: 'ambiguous-turn', prompt: 'Ambiguous identity', final: LABELS[0] });
    const ambiguousIndex = json(path.join(ambiguousStore, 'observations-index.json'));
    delete ambiguousIndex.records[0].writer.sessionId;
    fs.writeFileSync(path.join(ambiguousStore, 'observations-index.json'), JSON.stringify(ambiguousIndex));
    const ambiguousCycle = path.join(f.dir, 'ambiguous-cycle');
    process.env.HARNESS_OBSERVATIONS_DIR = ambiguousStore;
    assert.throws(() => collect({ dataDir: ambiguousCycle, since: '2026-01-01', sessionsDir: f.sessions }), /observation import incomplete/);
    const ambiguousReport = collectReport(ambiguousCycle);
    assert.equal(ambiguousReport.sources.live.error, 'ambiguous-records');
    assert.deepEqual(ambiguousReport.byHost.opencode, { persisted: 0, duplicate: 0, ambiguous: 1, importFailure: 0 });
    assert.equal(recordList(path.join(ambiguousCycle, 'training/observation-store')).length, 0);

    const unsafeHashStore = path.join(f.dir, 'unsafe-hash-live-store');
    captureTurn(unsafeHashStore, { sessionID: 'unsafe-hash-session', turnId: 'unsafe-hash-turn', prompt: 'Unsafe hash', final: LABELS[0] });
    const unsafeIndex = json(path.join(unsafeHashStore, 'observations-index.json'));
    unsafeIndex.records[0].contentSha256 = '../../outside-private-root';
    fs.writeFileSync(path.join(unsafeHashStore, 'observations-index.json'), JSON.stringify(unsafeIndex));
    const unsafeCycle = path.join(f.dir, 'unsafe-hash-cycle');
    process.env.HARNESS_OBSERVATIONS_DIR = unsafeHashStore;
    assert.throws(() => collect({ dataDir: unsafeCycle, since: '2026-01-01', sessionsDir: f.sessions }), /observation import incomplete/);
    const unsafeReport = collectReport(unsafeCycle);
    assert.equal(unsafeReport.sources.live.error, 'source-record-invalid');
    assert.deepEqual(unsafeReport.byHost.opencode, { persisted: 0, duplicate: 0, ambiguous: 0, importFailure: 1 });
    assert.equal(recordList(path.join(unsafeCycle, 'training/observation-store')).length, 0);

    const lockedStore = path.join(f.dir, 'locked-live-store');
    captureTurn(lockedStore, { sessionID: 'locked-session', turnId: 'locked-turn', prompt: 'Lock failure', final: LABELS[0] });
    const lockedDestination = path.join(f.dir, 'locked-destination');
    fs.mkdirSync(lockedDestination, { recursive: true });
    fs.writeFileSync(path.join(lockedDestination, 'observations-index.json'), JSON.stringify({ schemaVersion: 1, kind: 'system-one-observations', records: [] }));
    fs.writeFileSync(path.join(lockedDestination, '.index.lock'), 'fixture lock');
    const lockFailure = importStore({ sourceRoot: lockedStore, store: lockedDestination, since: '2026-01-01', lockTimeoutMs: 1 });
    assert.equal(lockFailure.source.status, 'error');
    assert.equal(lockFailure.source.error, 'append-failed');
    assert.deepEqual(lockFailure.byHost.opencode, { persisted: 0, duplicate: 0, ambiguous: 0, importFailure: 1 });
    assert.equal(recordList(lockedDestination).length, 0);
  } finally {
    f.restore();
  }
});

