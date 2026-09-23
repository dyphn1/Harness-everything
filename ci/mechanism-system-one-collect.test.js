'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const collect = require('../scripts/system-one-collect');
const root = path.resolve(__dirname, '..');
const jsonl = rows => rows.map(r => JSON.stringify(r)).join('\n');

// A fake home with one history file per source; each holds user text plus records that must be ignored.
function fakeHome() {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-s1-collect-'));
  const appdata = path.join(home, 'AppData', 'Roaming');
  const write = (rel, body) => { const p = path.join(home, rel); fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, body); };
  write('.claude/projects/p1/s-claude.jsonl', jsonl([
    { type: 'user', message: { content: 'fix the typo in README' } },
    { type: 'user', message: { content: [{ type: 'text', text: 'commit all changes' }] } },
    { type: 'user', isMeta: true, message: { content: 'meta text must be skipped' } },
    { type: 'user', isSidechain: true, message: { content: 'sidechain text must be skipped' } },
    { type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 'x', content: 'tool output must be skipped' }] } },
    { type: 'user', message: { content: '<system-reminder>injected</system-reminder>' } },
    { type: 'user', message: { content: '<command-name>/compact</command-name>' } },
    { type: 'assistant', message: { content: 'assistant text must be skipped' } },
  ]));
  write('.codex/sessions/2026/09/01/rollout-a.jsonl', jsonl([
    { type: 'response_item', payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: '<environment_context>cwd</environment_context>' }] } },
    { type: 'response_item', payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'duplicate of the event message' }] } },
    { type: 'event_msg', payload: { type: 'user_message', message: 'add a --verbose flag with tests' } },
  ]));
  write('.codex/sessions/2026/09/02/rollout-b.jsonl', jsonl([
    { type: 'response_item', payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: '<user_instructions>agents</user_instructions>' }] } },
    { type: 'response_item', payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'older session without event messages' }] } },
  ]));
  write('.copilot/session-state/c1/events.jsonl', jsonl([
    { type: 'system.message', data: { content: 'system prompt must be skipped' } },
    { type: 'user.message', data: { content: 'run npm test and report failures' } },
  ]));
  write('AppData/Roaming/Code/User/workspaceStorage/w1/chatSessions/old.json', JSON.stringify({
    requests: [{ message: { text: '把 parseCfg 改名成 parseConfig' } }, { message: { text: '' } }] }));
  write('AppData/Roaming/Code/User/workspaceStorage/w1/chatSessions/new.jsonl', jsonl([
    { kind: 0, v: { sessionId: 's', requests: [{ message: { text: '整個 repo 遷移到 ESM' } }] } },
    { kind: 2, k: ['requests'], v: [{ message: { text: '繼續' } }] },
    { kind: 2, k: ['requests', 0, 'response'], v: [{ value: 'response text must be skipped' }] },
    { kind: 1, k: ['requests', 0, 'result'], v: { metadata: { renderedUserMessage: 'rendered prompt must be skipped' } } },
  ]));
  write('AppData/Roaming/Code/User/globalStorage/emptyWindowChatSessions/e.jsonl', jsonl([
    { kind: 0, v: { requests: [{ message: { text: 'explain the backoff in retry.go' } }] } },
  ]));
  return { home, appdata };
}
const texts = rows => rows.map(r => r.text).sort();

test('S1-C101 each source yields only owner-typed text', () => {
  const { home, appdata } = fakeHome();
  try {
    const rows = collect.readSources({ home, appdata });
    assert.deepEqual(texts(rows), texts([
      { text: 'fix the typo in README' }, { text: 'commit all changes' }, { text: 'add a --verbose flag with tests' },
      { text: 'older session without event messages' }, { text: 'run npm test and report failures' },
      { text: '把 parseCfg 改名成 parseConfig' }, { text: '整個 repo 遷移到 ESM' }, { text: '繼續' }, { text: 'explain the backoff in retry.go' },
    ]));
    const bySource = Object.fromEntries(['claude', 'codex', 'copilot-cli', 'vscode'].map(s => [s, rows.filter(r => r.source === s).length]));
    assert.deepEqual(bySource, { claude: 2, codex: 2, 'copilot-cli': 1, vscode: 4 });
    assert.ok(rows.every(r => typeof r.family === 'string' && r.family.length > 0));
    const claude = rows.filter(r => r.source === 'claude');
    assert.equal(new Set(claude.map(r => r.family)).size, 1, 'one session file is one family');
  } finally { fs.rmSync(home, { recursive: true, force: true }); }
});

test('S1-C102 filters, redaction and deduplication', () => {
  assert.equal(collect.keep('go'), true);
  assert.equal(collect.keep('x'.repeat(1024)), true);
  assert.equal(collect.keep('x'.repeat(1025)), false);
  assert.equal(collect.keep('中'.repeat(342)), false, '1026 UTF-8 bytes');
  assert.equal(collect.keep('/compact'), false);
  assert.equal(collect.keep('This session is being continued from a previous conversation that ran out of context.'), false);
  assert.equal(collect.keep('   '), false);
  assert.equal(collect.redact('mail dev.lead@example.com now'), 'mail <email> now');
  assert.equal(collect.redact('open C:\\Users\\alice\\repo\\a.md'), 'open <home>\\repo\\a.md');
  assert.equal(collect.redact('read /home/alice/p and /Users/bob/q'), 'read <home>/p and <home>/q');
  const rows = collect.dedupe([{ text: 'fix  it', family: 'a' }, { text: 'fix it', family: 'b' }, { text: 'other', family: 'c' }]);
  assert.deepEqual(rows.map(r => r.family), ['a', 'c']);
});

test('S1-C103 prompts that near-duplicate a holdout prompt are dropped', () => {
  const holdout = ['把 parseCfg 改名成 parseConfig, 只有這個檔案有用到', 'Rebase this branch onto the latest main.'];
  const guard = collect.leakGuard(holdout);
  assert.equal(guard('把 parseCfg 改名成 parseConfig'), true, 'contained, longer than 12 chars');
  assert.equal(guard('rebase this branch onto the latest main'), true, 'normalized near-duplicate');
  assert.equal(guard('add pagination to the users endpoint'), false);
  assert.equal(guard('main'), false, 'short containment does not count');
  assert.ok(collect.jaccard('abcdef', 'abcdef') === 1 && collect.jaccard('abc', 'xyz') === 0);
});

test('S1-C104 splits are stable per family and near 15% validation', () => {
  assert.equal(collect.splitFor('family-a'), collect.splitFor('family-a'));
  const families = Array.from({ length: 2000 }, (_, i) => `session-${i}`);
  const share = families.filter(f => collect.splitFor(f) === 'validation').length / families.length;
  assert.ok(share > 0.12 && share < 0.18, String(share));
  assert.ok(families.every(f => ['train', 'validation'].includes(collect.splitFor(f))));
});

test('S1-C105 CLI writes a deterministic local dataset outside the repository', () => {
  const { home, appdata } = fakeHome();
  const out = path.join(home, 'out');
  try {
    const run = () => spawnSync(process.execPath, [path.join(root, 'scripts/system-one-collect.js'), '--home', home, '--appdata', appdata, '--out', out],
      { encoding: 'utf8', cwd: root });
    const one = run();
    assert.equal(one.status, 0, one.stderr);
    const first = fs.readFileSync(path.join(out, 'prompts.jsonl'), 'utf8');
    const stats = JSON.parse(one.stdout);
    assert.equal(stats.kept, 9);
    assert.deepEqual(Object.keys(stats.bySource).sort(), ['claude', 'codex', 'copilot-cli', 'vscode']);
    assert.match(stats.sha256, /^[0-9a-f]{64}$/);
    const rows = first.trim().split('\n').map(l => JSON.parse(l));
    assert.ok(rows.every(r => Object.keys(r).sort().join() === 'family,id,source,split,text' && /^[0-9a-f]{16}$/.test(r.id)));
    assert.equal(run().status, 0);
    assert.equal(fs.readFileSync(path.join(out, 'prompts.jsonl'), 'utf8'), first, 'deterministic');
    const inRepo = spawnSync(process.execPath, [path.join(root, 'scripts/system-one-collect.js'), '--home', home, '--appdata', appdata, '--out', path.join(root, 'tmp-dataset')], { encoding: 'utf8', cwd: root });
    assert.equal(inRepo.status, 1, 'refuses to write the dataset inside the repository');
    assert.equal(fs.existsSync(path.join(root, 'tmp-dataset')), false);
  } finally { fs.rmSync(home, { recursive: true, force: true }); }
});
