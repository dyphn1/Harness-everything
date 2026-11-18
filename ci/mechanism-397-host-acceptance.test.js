'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');
const observations = require('../hooks/scripts/lib/observations');
const { collect } = require('../scripts/system-one-cycle/collect');

const ROOT = path.resolve(__dirname, '..');
const VALID = '<!-- harness-label {"v":1,"validity":"actionable","tier":"tier2","intents":["fix"],"workflow":"iterative-single","skills":[]} -->';
const VALID_INVALID = '<!-- harness-label {"v":1,"validity":"invalid","tier":null,"intents":[],"workflow":null,"skills":[]} -->';
const MALFORMED = '<!-- harness-label {"v":1,"validity":"unknown","tier":"tier2","intents":[],"workflow":null,"skills":[]} -->';

function capture(store, host, session, prompt, final, turnId = `${session}-turn`) {
  const env = {
    HARNESS_OBSERVATIONS: 'on',
    HARNESS_OBSERVATIONS_DIR: store,
  };
  const base = { host, session_id: session, turn_id: turnId, cwd: store };
  observations.handle({ ...base, hook_event_name: 'UserPromptSubmit', prompt }, env);
  observations.handle({ ...base, hook_event_name: 'Stop', last_assistant_message: final }, env);
}

function atTime(timestamp, callback) {
  const NativeDate = global.Date;
  global.Date = class extends NativeDate {
    constructor(...args) { super(...(args.length ? args : [timestamp])); }
    static now() { return timestamp; }
  };
  try { callback(); } finally { global.Date = NativeDate; }
}

function jsonl(file) {
  return fs.readFileSync(file, 'utf8').split(/\r?\n/).filter(Boolean).map(JSON.parse);
}

test('collect retains unique, date-scoped per-host label acceptance before training filters', { concurrency: false }, () => {
  const dir = fs.mkdtempSync(path.join(process.env.TMPDIR || os.tmpdir(), 'system-one-host-acceptance-'));
  const relative = path.relative(fs.realpathSync.native(ROOT), fs.realpathSync.native(dir));
  assert.ok(relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative), 'fixtures stay outside the checkout');
  const dataDir = path.join(dir, 'cycle');
  const training = path.join(dataDir, 'training');
  const store = path.join(training, 'observation-store');
  const sessions = path.join(dir, 'empty-codex-sessions');
  const tmp = path.join(dir, 'tmp');
  fs.mkdirSync(sessions, { recursive: true });
  fs.mkdirSync(tmp);

  const envKeys = ['HOME', 'USERPROFILE', 'CODEX_HOME', 'HARNESS_STATE_HOME', 'HARNESS_OBSERVATIONS_DIR', 'HARNESS_OBSERVATIONS', 'TMPDIR', 'TEMP', 'TMP'];
  const previousEnv = Object.fromEntries(envKeys.map(key => [key, process.env[key]]));
  const home = path.join(dir, 'home');
  fs.mkdirSync(home);
  Object.assign(process.env, {
    HOME: home,
    USERPROFILE: home,
    CODEX_HOME: path.join(home, '.codex'),
    HARNESS_STATE_HOME: path.join(home, '.harness-state'),
    HARNESS_OBSERVATIONS_DIR: store,
    HARNESS_OBSERVATIONS: 'on',
    TMPDIR: tmp,
    TEMP: tmp,
    TMP: tmp,
  });

  try {
    const since = new Date().toISOString().slice(0, 10);
    const cutoff = Date.parse(`${since}T00:00:00.000Z`);
    atTime(cutoff - 1000, () => capture(store, 'codex', 'before-cutoff', 'PRE_CUTOFF_PROMPT_397', VALID));

    capture(store, 'opencode', 'valid-one', 'PROMPT_SENTINEL_397', `FINAL_MESSAGE_SENTINEL_397 SECRET_SENTINEL_397\n${VALID}`, 'valid-one-turn');
    capture(store, 'opencode', 'valid-two', 'accepted-invalid-validity', VALID_INVALID);
    capture(store, 'opencode', 'malformed', 'malformed-label-prompt', MALFORMED);
    capture(store, 'opencode', 'missing', 'missing-label-prompt', 'FINAL_MESSAGE_SENTINEL_397 without a label');
    capture(store, 'opencode', 'valid-one', 'PROMPT_SENTINEL_397 replay', `FINAL_MESSAGE_SENTINEL_397 SECRET_SENTINEL_397\n${VALID}`, 'valid-one-turn');
    capture(store, 'claude', 'claude-missing-one', 'claude-missing-one-prompt', 'No label');
    capture(store, 'claude', 'claude-missing-two', 'claude-missing-two-prompt', 'No label');

    const index = JSON.parse(fs.readFileSync(path.join(store, 'observations-index.json'), 'utf8'));
    assert.equal(index.records.length, 7, 'replaying a turn does not create a second stored row');

    const sinceNextDay = new Date(cutoff + 86_400_000).toISOString().slice(0, 10);
    const result = collect({ dataDir, since, sessionsDir: sessions });
    const observed = path.join(training, 'observed');
    const reportBytes = fs.readFileSync(path.join(observed, 'export-report.json'), 'utf8');
    const report = JSON.parse(reportBytes);
    const expected = {
      opencode: { eligible: 4, valid: 2, invalid: 1, missing: 1, acceptanceRate: 0.5 },
      claude: { eligible: 2, valid: 0, invalid: 0, missing: 2, acceptanceRate: 0 },
      codex: { eligible: 0, valid: 0, invalid: 0, missing: 0, acceptanceRate: null },
    };

    assert.deepEqual(report.hostAcceptance, { population: 'stored-observations', byHost: expected });
    assert.equal(result.prompts, 2, 'only the two labeled, text-available OpenCode rows enter training');
    assert.equal(jsonl(path.join(observed, 'prompts-observed.jsonl')).length, 2);
    assert.doesNotMatch(reportBytes, /PROMPT_SENTINEL_397|PRE_CUTOFF_PROMPT_397|FINAL_MESSAGE_SENTINEL_397|SECRET_SENTINEL_397/);

    const validRecord = index.records.find(record => record.writer.sessionId === 'valid-one');
    fs.unlinkSync(path.join(store, 'text', `${validRecord.contentSha256}.json`));
    const afterTextRemoval = collect({ dataDir, since, sessionsDir: sessions });
    const retained = JSON.parse(fs.readFileSync(path.join(observed, 'export-report.json'), 'utf8'));
    assert.deepEqual(retained.hostAcceptance, report.hostAcceptance, 'coverage remains independent of text availability');
    assert.equal(afterTextRemoval.prompts, 1, 'training rows fall when one prompt text is unavailable');
    assert.equal(retained.exported, 1);

    const emptySince = collect({ dataDir, since: sinceNextDay, sessionsDir: sessions });
    assert.equal(emptySince.prompts, 0);
    const emptyReport = JSON.parse(fs.readFileSync(path.join(observed, 'export-report.json'), 'utf8'));
    assert.deepEqual(emptyReport.hostAcceptance.byHost.opencode,
      { eligible: 0, valid: 0, invalid: 0, missing: 0, acceptanceRate: null }, 'zero eligible rows produce a null acceptance rate');
  } finally {
    for (const [key, value] of Object.entries(previousEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
