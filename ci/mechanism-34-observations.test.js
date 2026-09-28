#!/usr/bin/env node
'use strict';
// System One turn observations (docs/system-one-observations.md): label line,
// collector hook for Claude Code and Codex, local store, exporter, review page.

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync, execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const lib = require(path.join(ROOT, 'hooks/scripts/lib/observations.js'));
const HOOK = path.join(ROOT, 'hooks/scripts/observation-hook.js');
const EXPORTER = path.join(ROOT, 'scripts/system-one-observations-export.js');
const REVIEW = path.join(ROOT, 'scripts/system-one-observations-review.js');
let failures = 0;
function test(name, fn) {
  try { fn(); console.log(`  PASS ${name}`); } catch (error) { failures++; console.error(`  FAIL ${name}\n    ${error.stack.split('\n').slice(0, 3).join('\n    ')}`); }
}

const LABEL = '<!-- harness-label {"v":1,"validity":"actionable","contextDependent":false,"tier":"tier2","intents":["fix","test"],"workflow":"iterative-single","skills":["tdd"]} -->';

test('label line parses and validates', () => {
  const parsed = lib.parseLabelLine(`Done.\n\n${LABEL}\n`);
  assert.deepStrictEqual(parsed.label, { v: 1, validity: 'actionable', contextDependent: false, tier: 'tier2',
    intents: ['fix', 'test'], workflow: 'iterative-single', skills: ['tdd'] });
  assert.strictEqual(lib.parseLabelLine('no label here').label, null);
  assert.strictEqual(lib.parseLabelLine('no label here').reason, 'label-missing');
  assert.strictEqual(lib.parseLabelLine('<!-- harness-label {bad json} -->').reason, 'label-unparseable');
  const unknown = lib.parseLabelLine('<!-- harness-label {"v":1,"validity":"actionable","contextDependent":false,"tier":"tier9","intents":[],"workflow":null,"skills":[]} -->');
  assert.strictEqual(unknown.label, null);
  assert.strictEqual(unknown.reason, 'label-invalid');
  const tooMany = lib.parseLabelLine('<!-- harness-label {"v":1,"validity":"actionable","contextDependent":false,"tier":null,"intents":["fix","test","docs","plan"],"workflow":null,"skills":[]} -->');
  assert.strictEqual(tooMany.reason, 'label-invalid', 'at most three intents');
  const two = lib.parseLabelLine(`${LABEL.replace('tier2', 'tier1')}\nmore\n${LABEL}`);
  assert.strictEqual(two.label.tier, 'tier2', 'the last label line wins');
  const invalid = lib.parseLabelLine('<!-- harness-label {"v":1,"validity":"invalid","contextDependent":true,"tier":null,"intents":[],"workflow":null,"skills":[]} -->');
  assert.strictEqual(invalid.label.validity, 'invalid');
});

test('redaction removes email addresses and home paths', () => {
  const home = os.homedir();
  const out = lib.redact(`mail me at a.b@example.com, file ${home}/proj/x.js and C:\\Users\\someone\\x`);
  assert(!out.includes('a.b@example.com') && out.includes('<email>'));
  assert(!out.includes(home) && out.includes('<home>'));
  assert(!out.includes('C:\\Users\\someone') && out.includes('<home>'));
});

test('commands are classified without keeping their text', () => {
  assert.strictEqual(lib.classifyCommand('git status'), 'git');
  assert.strictEqual(lib.classifyCommand('gh pr view 12'), 'gh');
  assert.strictEqual(lib.classifyCommand('npm test'), 'test');
  assert.strictEqual(lib.classifyCommand('pytest -k slow'), 'test');
  assert.strictEqual(lib.classifyCommand('npm run build'), 'build');
  assert.strictEqual(lib.classifyCommand('pip install requests'), 'package');
  assert.strictEqual(lib.classifyCommand('ls -la'), 'shell');
  assert.strictEqual(lib.classifyCommand('cd x && git push'), 'git', 'the first recognizable segment decides');
});

test('tier comes from the self-report, owner review overrides, behavior only flags contradictions', () => {
  assert.strictEqual(typeof lib.breadthTier, 'undefined', 'no file-count tier rule');
  assert.deepStrictEqual(lib.labelTier({ tier: 'tier2' }, null), { tier: 'tier2', source: 'self-report' });
  assert.deepStrictEqual(lib.labelTier({ tier: 'tier2' }, { tier: 'tier3' }), { tier: 'tier3', source: 'owner' });
  assert.deepStrictEqual(lib.labelTier(null, null), { tier: null, source: null });
  assert.deepStrictEqual(lib.contradictions({ tier: 'tier1', validity: 'actionable' }, { filesWritten: 2 }), ['tier1-with-writes']);
  assert.deepStrictEqual(lib.contradictions({ tier: 'tier3', validity: 'actionable' }, { filesWritten: 0 }), [], 'a tier3 plan with no writes is not a contradiction');
});

function sandbox() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'obs-'));
  const store = path.join(dir, 'store');
  const repo = path.join(dir, 'repo');
  fs.mkdirSync(repo);
  execFileSync('git', ['init', '-q', repo]);
  const env = { ...process.env, HARNESS_OBSERVATIONS_DIR: store, HARNESS_STATE_ROOT: path.join(dir, 'state') };
  delete env.HARNESS_OBSERVATIONS;
  // Fixtures choose their own host; never inherit the invoking agent's.
  for (const key of ['CLAUDE_PLUGIN_ROOT', 'CLAUDECODE', 'CLAUDE_CODE_ENTRYPOINT', 'CLAUDE', 'CODEX_HOME', 'CODEX_THREAD_ID']) delete env[key];
  return { dir, store, repo, env };
}

function hook(env, payload) {
  const r = spawnSync('node', [HOOK], { input: typeof payload === 'string' ? payload : JSON.stringify(payload), env, encoding: 'utf8', timeout: 5000 });
  assert.strictEqual(r.status, 0, `hook exit ${r.status}: ${r.stderr}`);
  assert.strictEqual(r.stdout, '', 'the hook never writes to stdout (it would enter the model context)');
  return r;
}

function records(store) {
  const file = path.join(store, 'observations-index.json');
  if (!fs.existsSync(file)) return [];
  const index = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.strictEqual(index.schemaVersion, 1);
  return index.records;
}

test('Claude Code turn: prompt, behavior and label are recorded', () => {
  const s = sandbox();
  const base = { session_id: 'sess-a', cwd: s.repo };
  s.env.CLAUDE_PLUGIN_ROOT = ROOT;
  hook(s.env, { ...base, hook_event_name: 'UserPromptSubmit', prompt: `fix the parser, contact x@y.io at ${os.homedir()}/p` });
  hook(s.env, { ...base, hook_event_name: 'PostToolUse', tool_name: 'Edit', tool_input: { file_path: path.join(s.repo, 'a.js') } });
  hook(s.env, { ...base, hook_event_name: 'PostToolUse', tool_name: 'Write', tool_input: { file_path: path.join(s.repo, 'b.js') }, tool_response: { type: 'create' } });
  hook(s.env, { ...base, hook_event_name: 'PostToolUse', tool_name: 'Bash', tool_input: { command: 'npm test' } });
  hook(s.env, { ...base, hook_event_name: 'PostToolUse', tool_name: 'Skill', tool_input: { skill: 'harness-everything:tdd' } });
  hook(s.env, { ...base, hook_event_name: 'Stop', last_assistant_message: `Fixed.\n${LABEL}` });
  const recs = records(s.store);
  assert.strictEqual(recs.length, 1);
  const r = recs[0];
  assert.strictEqual(r.source, 'observation');
  assert.strictEqual(r.status, 'active');
  assert.strictEqual(r.host, 'claude');
  assert.strictEqual(r.writer.sessionId, 'sess-a');
  assert(Date.parse(r.validUntil) - Date.parse(r.observedAt) >= 179 * 86400000);
  assert.deepStrictEqual(
    { w: r.behavior.filesWritten, repos: r.behavior.reposWritten, created: r.behavior.filesCreated, test: r.behavior.commands.test },
    { w: 2, repos: 1, created: 1, test: 1 });
  assert.deepStrictEqual(r.behavior.skills, ['tdd']);
  assert.strictEqual(r.selfReport.tier, 'tier2');
  assert(!JSON.stringify(r).includes('fix the parser'), 'the index holds no prompt text');
  const text = JSON.parse(fs.readFileSync(path.join(s.store, 'text', `${r.contentSha256}.json`), 'utf8'));
  assert(text.prompt.startsWith('fix the parser') && text.prompt.includes('<email>') && text.prompt.includes('<home>'));
  assert(Array.isArray(r.scope.taskTerms) && r.scope.taskTerms.includes('parser'));
});

test('second turn keeps the previous final message; missing label is recorded, not fatal', () => {
  const s = sandbox();
  const base = { session_id: 'sess-b', cwd: s.repo };
  hook(s.env, { ...base, hook_event_name: 'UserPromptSubmit', prompt: 'run the tests' });
  hook(s.env, { ...base, hook_event_name: 'Stop', last_assistant_message: 'All 12 tests pass. Want me to commit?' });
  hook(s.env, { ...base, hook_event_name: 'UserPromptSubmit', prompt: 'yes' });
  hook(s.env, { ...base, hook_event_name: 'Stop', last_assistant_message: `Committed.\n${LABEL.replace('"actionable","contextDependent":false', '"invalid","contextDependent":true')}` });
  const recs = records(s.store);
  assert.strictEqual(recs.length, 2);
  assert.strictEqual(recs[0].selfReport, null);
  assert.strictEqual(recs[0].selfReportReason, 'label-missing');
  const text = JSON.parse(fs.readFileSync(path.join(s.store, 'text', `${recs[1].contentSha256}.json`), 'utf8'));
  assert.strictEqual(text.prompt, 'yes');
  assert(text.previous.includes('Want me to commit?'));
  assert.strictEqual(recs[1].selfReport.contextDependent, true);
});

test('Codex turn: final message from the rollout transcript, apply_patch counted', () => {
  const s = sandbox();
  const rollout = path.join(s.dir, 'rollout.jsonl');
  fs.writeFileSync(rollout, [
    { type: 'response_item', payload: { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'earlier' }] } },
    { type: 'event_msg', payload: { type: 'task_complete', turn_id: 't1', last_agent_message: `Added the flag.\n${LABEL.replace('"tier2"', '"tier3"')}` } },
  ].map(x => JSON.stringify(x)).join('\n') + '\n');
  const base = { session_id: 'sess-c', cwd: s.repo, transcript_path: rollout };
  hook(s.env, { ...base, hook_event_name: 'UserPromptSubmit', prompt: 'add a --json flag' });
  hook(s.env, { ...base, hook_event_name: 'PostToolUse', tool_name: 'apply_patch', tool_input: { command: `*** Begin Patch\n*** Add File: ${s.repo}/flag.js\n+x\n*** Update File: ${s.repo}/cli.js\n@@\n-a\n+b\n*** End Patch` } });
  hook(s.env, { ...base, hook_event_name: 'Stop' });
  const [r] = records(s.store);
  assert.strictEqual(r.host, 'codex');
  assert.strictEqual(r.behavior.filesWritten, 2);
  assert.strictEqual(r.behavior.filesCreated, 1);
  assert.strictEqual(r.selfReport.tier, 'tier3');
});

test('Claude transcript fallback when the Stop payload has no message', () => {
  const s = sandbox();
  const transcript = path.join(s.dir, 'claude.jsonl');
  fs.writeFileSync(transcript, [
    { type: 'user', message: { role: 'user', content: 'x' } },
    { type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: `ok\n${LABEL}` }] } },
  ].map(x => JSON.stringify(x)).join('\n') + '\n');
  const base = { session_id: 'sess-d', cwd: s.repo, transcript_path: transcript };
  hook(s.env, { ...base, hook_event_name: 'UserPromptSubmit', prompt: 'x' });
  hook(s.env, { ...base, hook_event_name: 'Stop' });
  assert.strictEqual(records(s.store)[0].selfReport.tier, 'tier2');
});

test('opt-out writes nothing; malformed input fails open', () => {
  const s = sandbox();
  const off = { ...s.env, HARNESS_OBSERVATIONS: 'off' };
  hook(off, { session_id: 'z', cwd: s.repo, hook_event_name: 'UserPromptSubmit', prompt: 'hello' });
  hook(off, { session_id: 'z', cwd: s.repo, hook_event_name: 'Stop', last_assistant_message: LABEL });
  assert(!fs.existsSync(s.store) || records(s.store).length === 0);
  hook(s.env, '{not json');
  hook(s.env, '');
});

function writeFixtureStore(s) {
  const base = { cwd: s.repo };
  const turns = [
    { sid: 'e1', prompt: 'git status', label: LABEL.replace('"tier2"', '"tier1"'), tools: [] },
    { sid: 'e2', prompt: 'fix the flaky parser test', label: LABEL, tools: [['Edit', 'a.js'], ['Edit', 'b.js']] },
    { sid: 'e3', prompt: 'add a csv export command', label: LABEL.replace('"tier2"', '"tier3"').replace('["fix","test"]', '["feature"]'), tools: [['Edit', 'c.js']] },
    { sid: 'e4', prompt: 'go', label: LABEL.replace('"actionable","contextDependent":false', '"invalid","contextDependent":true'), tools: [] },
  ];
  for (const t of turns) {
    hook(s.env, { ...base, session_id: t.sid, hook_event_name: 'UserPromptSubmit', prompt: t.prompt });
    for (const [tool, file] of t.tools) hook(s.env, { ...base, session_id: t.sid, hook_event_name: 'PostToolUse', tool_name: tool, tool_input: { file_path: path.join(s.repo, file) } });
    hook(s.env, { ...base, session_id: t.sid, hook_event_name: 'Stop', last_assistant_message: `done\n${t.label}` });
  }
}

test('exporter derives labels, splits by time and reports agreement', () => {
  const s = sandbox();
  writeFixtureStore(s);
  const out = path.join(s.dir, 'export');
  const r = spawnSync('node', [EXPORTER, '--store', s.store, '--out', out], { encoding: 'utf8', env: s.env });
  assert.strictEqual(r.status, 0, r.stderr);
  const prompts = fs.readFileSync(path.join(out, 'prompts-observed.jsonl'), 'utf8').trim().split('\n').map(JSON.parse);
  const labels = fs.readFileSync(path.join(out, 'labels-observed.jsonl'), 'utf8').trim().split('\n').map(JSON.parse);
  assert.strictEqual(prompts.length, 4);
  assert(prompts.every(p => p.source === 'observation' && ['train', 'validation'].includes(p.split) && p.family));
  const byText = Object.fromEntries(prompts.map(p => [p.text, labels.find(l => l.id === p.id)]));
  assert.strictEqual(byText['git status'].tier, 'tier1');
  assert.strictEqual(byText['fix the flaky parser test'].tier, 'tier2');
  assert.strictEqual(byText['add a csv export command'].tier, 'tier3');
  assert.strictEqual(byText['add a csv export command'].tierSource, 'self-report');
  assert.strictEqual(byText['go'].validity, 'invalid');
  assert.strictEqual(prompts.filter(p => p.split === 'validation').length, 1, 'newest 15%, at least one row');
  const report = JSON.parse(fs.readFileSync(path.join(out, 'export-report.json'), 'utf8'));
  assert.strictEqual(report.records, 4);
  assert.strictEqual(report.contradictions['tier1-with-writes'] || 0, 0);
  assert('routerVsSelfTier' in report.agreement && !('selfVsBehaviorTier' in report.agreement));
  assert(labels.every(l => !('breadthTier' in l)), 'labels carry no file-count tier');
  assert(!fs.readFileSync(path.join(out, 'export-report.json'), 'utf8').includes('parser'), 'the report holds no text');
});

test('review page lists disagreements blind and owner decisions override', () => {
  const s = sandbox();
  writeFixtureStore(s);
  const html = path.join(s.dir, 'review.html');
  const r = spawnSync('node', [REVIEW, '--store', s.store, '--out', html, '--all'], { encoding: 'utf8', env: s.env });
  assert.strictEqual(r.status, 0, r.stderr);
  const page = fs.readFileSync(html, 'utf8');
  assert(page.includes('add a csv export command') && page.includes('harness-observation-review'));
  assert(!/tier3|self-report/.test(page.replace(/<script[\s\S]*?<\/script>/g, '').replace(/<option[\s\S]*?<\/option>/g, '')), 'blind: no labels shown outside the controls');
  const review = path.join(s.dir, 'decisions.json');
  const id = records(s.store).find(x => x.selfReport && x.selfReport.tier === 'tier3').id;
  fs.writeFileSync(review, JSON.stringify({ schemaVersion: 1, review: 'harness-observation-review', decisions: [{ id, tier: 'tier2', validity: 'actionable' }] }));
  const out = path.join(s.dir, 'export2');
  const e = spawnSync('node', [EXPORTER, '--store', s.store, '--out', out, '--owner-review', review], { encoding: 'utf8', env: s.env });
  assert.strictEqual(e.status, 0, e.stderr);
  const labels = fs.readFileSync(path.join(out, 'labels-observed.jsonl'), 'utf8').trim().split('\n').map(JSON.parse);
  const l = labels.find(x => x.id === id);
  assert.strictEqual(l.tier, 'tier2');
  assert.strictEqual(l.tierSource, 'owner');
});

function rollout(s, name, rows) {
  const file = path.join(s.dir, name);
  fs.writeFileSync(file, rows.map(x => JSON.stringify(x)).join('\n') + '\n');
  return file;
}

test('transcript fallback reads only the current turn', () => {
  const s = sandbox();
  const tier1 = `Status.\n${LABEL.replace('"tier2"', '"tier1"')}`;
  const tier3 = `Built it.\n${LABEL.replace('"tier2"', '"tier3"')}`;
  const previous = [
    { type: 'event_msg', payload: { type: 'task_started', turn_id: 't1' } },
    { type: 'response_item', payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'status?' }] } },
    { type: 'event_msg', payload: { type: 'task_complete', turn_id: 't1', last_agent_message: tier1 } },
    { type: 'event_msg', payload: { type: 'task_started', turn_id: 't2' } },
    { type: 'response_item', payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'build it' }] } },
  ];
  const cases = [
    ['current final answer, no task_complete yet', [...previous,
      { type: 'response_item', payload: { type: 'message', role: 'assistant', phase: 'commentary', content: [{ type: 'output_text', text: `working\n${LABEL.replace('"tier2"', '"tier1"')}` }] } },
      { type: 'response_item', payload: { type: 'message', role: 'assistant', phase: 'final_answer', content: [{ type: 'output_text', text: tier3 }] } }], 'tier3'],
    ['no current final response', [...previous,
      { type: 'response_item', payload: { type: 'message', role: 'assistant', phase: 'commentary', content: [{ type: 'output_text', text: 'working' }] } }], null],
    ['previous task_complete without a current task_started in view', [
      { type: 'event_msg', payload: { type: 'task_complete', turn_id: 't1', last_agent_message: tier1 } }], null],
  ];
  cases.forEach(([name, rows, tier], k) => {
    const file = rollout(s, `r${k}.jsonl`, rows);
    const base = { session_id: `turn-${k}`, cwd: s.repo, transcript_path: file, turn_id: 't2' };
    hook(s.env, { ...base, hook_event_name: 'UserPromptSubmit', prompt: 'build it' });
    hook(s.env, { ...base, hook_event_name: 'Stop' });
    const r = records(s.store).find(x => x.writer.sessionId === `turn-${k}`);
    assert.strictEqual(r.selfReport ? r.selfReport.tier : null, tier, name);
    if (tier === null) assert.strictEqual(r.selfReportReason, 'final-message-unavailable', name);
  });
  const claude = rollout(s, 'claude-multi.jsonl', [
    { type: 'user', message: { role: 'user', content: 'status?' } },
    { type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: tier1 }] } },
    { type: 'user', message: { role: 'user', content: [{ type: 'text', text: 'build it' }] } },
    { type: 'assistant', message: { role: 'assistant', content: [{ type: 'tool_use', id: 'x', name: 'Edit', input: {} }] } },
    { type: 'user', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'x', content: 'ok' }] } },
  ]);
  const base = { session_id: 'claude-multi', cwd: s.repo, transcript_path: claude };
  hook(s.env, { ...base, hook_event_name: 'UserPromptSubmit', prompt: 'build it' });
  hook(s.env, { ...base, hook_event_name: 'Stop' });
  assert.strictEqual(records(s.store).find(x => x.writer.sessionId === 'claude-multi').selfReport, null, 'Claude: no reuse of the previous label');
});

test('concurrent tool hooks keep every event', () => {
  const s = sandbox();
  const base = { session_id: 'sess-par', cwd: s.repo };
  hook(s.env, { ...base, hook_event_name: 'UserPromptSubmit', prompt: 'edit many files' });
  const payloads = Array.from({ length: 40 }, (_, k) => ({ ...base, hook_event_name: 'PostToolUse', tool_name: 'Edit', tool_input: { file_path: path.join(s.repo, `f${k}.js`) } }));
  const script = `const { spawn } = require('child_process');
const payloads = ${JSON.stringify(payloads)};
let left = payloads.length, bad = 0;
for (const p of payloads) {
  const c = spawn(process.execPath, [${JSON.stringify(HOOK)}], { stdio: ['pipe', 'ignore', 'ignore'] });
  c.on('exit', code => { if (code !== 0) bad++; if (--left === 0) process.exit(bad ? 1 : 0); });
  c.stdin.end(JSON.stringify(p));
}`;
  const r = spawnSync(process.execPath, ['-e', script], { env: s.env, encoding: 'utf8', timeout: 60000 });
  assert.strictEqual(r.status, 0, r.stderr);
  hook(s.env, { ...base, hook_event_name: 'Stop', last_assistant_message: `done\n${LABEL}` });
  const [rec] = records(s.store);
  assert.deepStrictEqual({ calls: rec.behavior.toolCalls, files: rec.behavior.filesWritten }, { calls: 40, files: 40 });
});

function setIndex(store, fn) {
  const file = path.join(store, 'observations-index.json');
  const index = JSON.parse(fs.readFileSync(file, 'utf8'));
  fn(index.records);
  fs.writeFileSync(file, JSON.stringify(index));
}

test('expired text is neither exported nor reviewed, and old session text is dropped', () => {
  const s = sandbox();
  const base = { session_id: 'sess-exp', cwd: s.repo };
  hook(s.env, { ...base, hook_event_name: 'UserPromptSubmit', prompt: 'secret old prompt' });
  hook(s.env, { ...base, hook_event_name: 'Stop', last_assistant_message: `old final answer\n${LABEL}` });
  setIndex(s.store, recs => { recs[0].validUntil = new Date(Date.now() - 1000).toISOString(); });
  const out = path.join(s.dir, 'export');
  const e = spawnSync('node', [EXPORTER, '--store', s.store, '--out', out], { encoding: 'utf8', env: s.env });
  assert.strictEqual(e.status, 0, e.stderr);
  assert.strictEqual(JSON.parse(fs.readFileSync(path.join(out, 'export-report.json'), 'utf8')).exported, 0);
  const html = path.join(s.dir, 'review.html');
  const v = spawnSync('node', [REVIEW, '--store', s.store, '--out', html, '--all'], { encoding: 'utf8', env: s.env });
  assert.strictEqual(v.status, 0, v.stderr);
  assert.strictEqual(JSON.parse(v.stdout).items, 0);
  assert(!fs.readFileSync(html, 'utf8').includes('secret old prompt'));
  const [rec] = records(s.store);
  assert.strictEqual(rec.selfReport.tier, 'tier2', 'labels and counts survive expiry');
  // Session state older than the retention window loses its text.
  const sessions = path.join(s.store, 'sessions');
  const old = (Date.now() - 181 * 86400000) / 1000;
  for (const f of fs.readdirSync(sessions)) {
    const file = path.join(sessions, f);
    if (f.endsWith('.json')) {
      const state = JSON.parse(fs.readFileSync(file, 'utf8'));
      state.lastFinalAt = new Date(old * 1000).toISOString();
      fs.writeFileSync(file, JSON.stringify(state));
    }
    fs.utimesSync(file, old, old);
  }
  hook(s.env, { session_id: 'other', cwd: s.repo, hook_event_name: 'UserPromptSubmit', prompt: 'x' });
  hook(s.env, { session_id: 'other', cwd: s.repo, hook_event_name: 'Stop', last_assistant_message: 'y' });
  const left = fs.readdirSync(sessions).map(f => fs.readFileSync(path.join(sessions, f), 'utf8')).join('\n');
  assert(!left.includes('old final answer'), 'expired session text is deleted');
});

test('expiring a record keeps a shared text blob that an active record still uses', () => {
  const s = sandbox();
  for (const sid of ['blob-1', 'blob-2']) {
    if (sid === 'blob-2') setIndex(s.store, recs => { recs[0].validUntil = new Date(Date.now() - 1000).toISOString(); });
    hook(s.env, { session_id: sid, cwd: s.repo, hook_event_name: 'UserPromptSubmit', prompt: 'same first prompt' });
    hook(s.env, { session_id: sid, cwd: s.repo, hook_event_name: 'Stop', last_assistant_message: `ok\n${LABEL}` });
  }
  const recs = records(s.store);
  assert.strictEqual(recs.length, 2);
  assert.strictEqual(recs[0].contentSha256, recs[1].contentSha256);
  assert(fs.existsSync(path.join(s.store, 'text', `${recs[1].contentSha256}.json`)), 'the active record keeps its text');
});

test('failed tool attempts are not counted as writes or loads', () => {
  const s = sandbox();
  const base = { session_id: 'sess-fail', cwd: s.repo };
  hook(s.env, { ...base, hook_event_name: 'UserPromptSubmit', prompt: 'what does this do?' });
  hook(s.env, { ...base, hook_event_name: 'PostToolUseFailure', tool_name: 'Edit', tool_input: { file_path: path.join(s.repo, 'a.js') }, error: 'old_string not found' });
  hook(s.env, { ...base, hook_event_name: 'PostToolUseFailure', tool_name: 'Skill', tool_input: { skill: 'tdd' }, error: 'unknown skill' });
  hook(s.env, { ...base, hook_event_name: 'PostToolUse', tool_name: 'apply_patch', tool_input: { command: `*** Begin Patch\n*** Update File: ${s.repo}/b.js\n@@\n-a\n+b\n*** End Patch` }, tool_response: { exit_code: 1, stderr: 'verification failed' } });
  hook(s.env, { ...base, hook_event_name: 'PostToolUse', tool_name: 'Write', tool_input: { file_path: path.join(s.repo, 'c.js') }, tool_response: { success: false } });
  hook(s.env, { ...base, hook_event_name: 'Stop', last_assistant_message: `It parses.\n${LABEL.replace('"tier2"', '"tier1"')}` });
  const [r] = records(s.store);
  assert.deepStrictEqual({ w: r.behavior.filesWritten, c: r.behavior.filesCreated, skills: r.behavior.skills },
    { w: 0, c: 0, skills: [] });
  assert.deepStrictEqual({ f: r.behavior.toolFailures, fw: r.behavior.failedWrites, fs: r.behavior.failedSkillLoads }, { f: 4, fw: 3, fs: 1 });
  assert.deepStrictEqual(lib.contradictions(r.selfReport, r.behavior), []);
});

test('owner review overrides context dependence, explicit false included', () => {
  const s = sandbox();
  const base = { cwd: s.repo };
  hook(s.env, { ...base, session_id: 'cd-1', hook_event_name: 'UserPromptSubmit', prompt: 'continue' });
  hook(s.env, { ...base, session_id: 'cd-1', hook_event_name: 'Stop', last_assistant_message: `ok\n${LABEL.replace('"contextDependent":false', '"contextDependent":true')}` });
  hook(s.env, { ...base, session_id: 'cd-2', hook_event_name: 'UserPromptSubmit', prompt: 'rename foo to bar in util.js' });
  hook(s.env, { ...base, session_id: 'cd-2', hook_event_name: 'Stop', last_assistant_message: 'no label' });
  const [a, b] = records(s.store);
  const review = path.join(s.dir, 'decisions.json');
  fs.writeFileSync(review, JSON.stringify({ schemaVersion: 1, review: 'harness-observation-review', decisions: [
    { id: a.id, contextDependent: false }, { id: b.id, validity: 'actionable', contextDependent: false, tier: 'tier2' }] }));
  const out = path.join(s.dir, 'export');
  const e = spawnSync('node', [EXPORTER, '--store', s.store, '--out', out, '--owner-review', review], { encoding: 'utf8', env: s.env });
  assert.strictEqual(e.status, 0, e.stderr);
  const labels = fs.readFileSync(path.join(out, 'labels-observed.jsonl'), 'utf8').trim().split('\n').map(JSON.parse);
  assert.strictEqual(labels.find(l => l.id === a.id).contextDependent, false);
  assert.deepStrictEqual((({ validity, contextDependent, tier }) => ({ validity, contextDependent, tier }))(labels.find(l => l.id === b.id)),
    { validity: 'actionable', contextDependent: false, tier: 'tier2' });
  fs.writeFileSync(review, JSON.stringify({ schemaVersion: 1, review: 'harness-observation-review', decisions: [{ id: a.id, contextDependent: 'no' }] }));
  const bad = spawnSync('node', [EXPORTER, '--store', s.store, '--out', out, '--owner-review', review], { encoding: 'utf8', env: s.env });
  assert.notStrictEqual(bad.status, 0, 'invalid owner decisions are rejected');
  const html = path.join(s.dir, 'review.html');
  assert.strictEqual(spawnSync('node', [REVIEW, '--store', s.store, '--out', html], { encoding: 'utf8', env: s.env }).status, 0);
  assert(fs.readFileSync(html, 'utf8').includes('contextDependent'), 'the review page records context dependence');
});

function agePending(store, sessionId, days) {
  const file = path.join(store, 'sessions', `${require('crypto').createHash('sha256').update(sessionId).digest('hex').slice(0, 32)}.json`);
  const state = JSON.parse(fs.readFileSync(file, 'utf8'));
  const then = new Date(Date.now() - days * 86400000).toISOString();
  state.pending.startedAt = then;
  state.pending.previousAt = then;
  state.lastFinalAt = then;
  fs.writeFileSync(file, JSON.stringify(state)); // mtime stays fresh: the capture time must decide
}

test('resuming an expired unfinished turn does not renew its text', () => {
  for (const resume of ['UserPromptSubmit', 'Stop']) {
    const s = sandbox();
    const sid = `resume-${resume}`;
    const base = { session_id: sid, cwd: s.repo };
    hook(s.env, { ...base, hook_event_name: 'UserPromptSubmit', prompt: 'first MARKER-PREV-TURN' });
    hook(s.env, { ...base, hook_event_name: 'Stop', last_assistant_message: 'answer MARKER-PREVIOUS' });
    hook(s.env, { ...base, hook_event_name: 'UserPromptSubmit', prompt: 'unfinished MARKER-PENDING' });
    agePending(s.store, sid, 181);
    if (resume === 'Stop') hook(s.env, { ...base, hook_event_name: 'Stop', last_assistant_message: `late\n${LABEL}` });
    else hook(s.env, { ...base, hook_event_name: 'UserPromptSubmit', prompt: 'new prompt' });
    const rec = records(s.store)[1];
    assert.strictEqual(rec.status, 'expired', resume);
    assert(Date.parse(rec.validUntil) <= Date.now(), `${resume}: the deadline is not renewed`);
    assert(!fs.existsSync(path.join(s.store, 'text', `${rec.contentSha256}.json`)), `${resume}: no fresh blob for expired text`);
    const out = path.join(s.dir, 'export');
    assert.strictEqual(spawnSync('node', [EXPORTER, '--store', s.store, '--out', out], { encoding: 'utf8', env: s.env }).status, 0);
    const exported = fs.readFileSync(path.join(out, 'prompts-observed.jsonl'), 'utf8');
    assert(!/MARKER-PENDING|MARKER-PREVIOUS/.test(exported), `${resume}: expired text is not exported`);
    const html = path.join(s.dir, 'review.html');
    spawnSync('node', [REVIEW, '--store', s.store, '--out', html, '--all'], { encoding: 'utf8', env: s.env });
    assert(!/MARKER-PENDING|MARKER-PREVIOUS/.test(fs.readFileSync(html, 'utf8')), `${resume}: expired text is not reviewed`);
    const sessions = fs.readdirSync(path.join(s.store, 'sessions')).map(f => { try { return fs.readFileSync(path.join(s.store, 'sessions', f), 'utf8'); } catch (_) { return ''; } }).join('');
    assert(!/MARKER-PENDING|MARKER-PREVIOUS/.test(sessions), `${resume}: session state drops expired text`);
  }
});

test('resuming an unfinished turn inside the window keeps its text and original deadline', () => {
  const s = sandbox();
  const base = { session_id: 'resume-fresh', cwd: s.repo };
  hook(s.env, { ...base, hook_event_name: 'UserPromptSubmit', prompt: 'unfinished MARKER-KEEP' });
  agePending(s.store, 'resume-fresh', 10);
  hook(s.env, { ...base, hook_event_name: 'UserPromptSubmit', prompt: 'next' });
  const [rec] = records(s.store);
  assert.strictEqual(rec.status, 'active');
  const deadline = Date.parse(rec.validUntil) - Date.now();
  assert(deadline > 169 * 86400000 && deadline < 171 * 86400000, 'validUntil counts from capture, not from recovery');
  const text = JSON.parse(fs.readFileSync(path.join(s.store, 'text', `${rec.contentSha256}.json`), 'utf8'));
  assert(text.prompt.includes('MARKER-KEEP'));
});

test('module and runner prefixes are classified by what they run', () => {
  assert.strictEqual(lib.classifyCommand('python3 -m pytest test_calc.py -v'), 'test');
  assert.strictEqual(lib.classifyCommand('python -m pip install requests'), 'package');
  assert.strictEqual(lib.classifyCommand('npx jest --watch=false'), 'test');
  assert.strictEqual(lib.classifyCommand('uv run pytest'), 'test');
  assert.strictEqual(lib.classifyCommand('poetry run pytest -q'), 'test');
  assert.strictEqual(lib.classifyCommand('pnpm exec vitest run'), 'test');
  assert.strictEqual(lib.classifyCommand('python3 script.py'), 'shell');
});

test('the label contract is the router output\'s last section and covers every turn', () => {
  const out = spawnSync('node', [path.join(ROOT, 'harness-everything/scripts/kernel-router.js'), 'What does README.md contain?'], { encoding: 'utf8' }).stdout;
  const sections = out.split(/\n(?==> )/);
  const last = sections[sections.length - 1];
  assert(/^=> TURN LABEL LINE/.test(last) && last.includes('harness-label'), 'the label contract is printed last');
  assert(/EVERY TURN/.test(last) && /null only when validity is invalid/.test(last));
  const status = sections.find(x => x.startsWith('=> USER-VISIBLE HARNESS STATUS CONTRACT'));
  assert(status && !status.includes('harness-label'), 'not scoped under the non-trivial Harness Status contract');
  assert(/^14\. \*\*The turn label line is mandatory on every turn/m.test(fs.readFileSync(path.join(ROOT, 'AGENTS.md'), 'utf8')));
});

test('router/self agreement counts only turns where the router chose a tier', () => {
  const s = sandbox();
  fs.mkdirSync(path.join(s.store, 'text'), { recursive: true });
  const now = Date.now();
  const recs = [['unclassified', 'tier1'], ['tier2', 'tier2'], ['tier3', 'tier2']].map(([router, self], k) => {
    const sha = `${k}`.repeat(64);
    fs.writeFileSync(path.join(s.store, 'text', `${sha}.json`), JSON.stringify({ prompt: `p${k}`, previous: '' }));
    return { id: `r${k}`, source: 'observation', status: 'active', observedAt: new Date(now - (3 - k) * 1000).toISOString(),
      validUntil: new Date(now + 86400000).toISOString(), contentSha256: sha, host: 'claude', turn: 1, writer: { sessionId: `s${k}` },
      router: { tier: router }, behavior: lib.emptyBehavior(),
      selfReport: { v: 1, validity: 'actionable', contextDependent: false, tier: self, intents: [], workflow: null, skills: [] } };
  });
  fs.writeFileSync(path.join(s.store, 'observations-index.json'), JSON.stringify({ schemaVersion: 1, records: recs }));
  const out = path.join(s.dir, 'export');
  const e = spawnSync('node', [EXPORTER, '--store', s.store, '--out', out], { encoding: 'utf8', env: s.env });
  assert.strictEqual(e.status, 0, e.stderr);
  const report = JSON.parse(fs.readFileSync(path.join(out, 'export-report.json'), 'utf8'));
  assert.deepStrictEqual(report.agreement, { routerVsSelfTier: 0.5, routerVsSelfPairs: 2 });
});

test('label slips seen live: unknown intents dropped, unterminated final line accepted', () => {
  const unknown = lib.parseLabelLine('ok\n<!-- harness-label {"v":1,"validity":"actionable","contextDependent":false,"tier":"tier1","intents":["lookup","git"],"workflow":null,"skills":[]} -->');
  assert.strictEqual(unknown.reason, null);
  assert.deepStrictEqual(unknown.label.intents, ['git']);
  assert.deepStrictEqual(unknown.label.unknownIntents, ['lookup']);
  const open = lib.parseLabelLine('M README.md\n\n<!-- harness-label {"v":1,"validity":"actionable","contextDependent":false,"tier":"tier1","intents":["git"],"workflow":null,"skills":[]}');
  assert.strictEqual(open.reason, null, 'a final label line missing its closing --> is accepted');
  assert.strictEqual(open.label.tier, 'tier1');
  const middle = lib.parseLabelLine('<!-- harness-label {"v":1,"validity":"actionable","contextDependent":false,"tier":"tier1","intents":[],"workflow":null,"skills":[]}\nmore text');
  assert.strictEqual(middle.label, null, 'an unterminated line is accepted only at the end');
  assert.strictEqual(lib.parseLabelLine('<!-- harness-label {"v":1,"validity":"actionable","contextDependent":false,"tier":"tier9","intents":[],"workflow":null,"skills":[]} -->').reason, 'label-invalid');
});

test('Codex router hook returns its contract as JSON additionalContext', () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'plugins/harness-everything/hooks/hooks.json'), 'utf8')).hooks;
  const commands = manifest.UserPromptSubmit.flatMap(g => g.hooks.map(h => h.command));
  assert(commands.some(c => c.includes('codex-user-prompt.js')), 'the Codex manifest wraps the router');
  assert(!commands.some(c => c.includes('kernel-router.js')), 'plain router stdout never reaches a Codex model');
  for (const script of ['hooks/scripts/codex-user-prompt.js', 'plugins/harness-everything/hooks/scripts/codex-user-prompt.js']) {
    const s = sandbox();
    const r = spawnSync('node', [path.join(ROOT, script)], { input: JSON.stringify({ session_id: 'cx', turn_id: 't1', hook_event_name: 'UserPromptSubmit', prompt: 'git status', cwd: s.repo }), env: s.env, encoding: 'utf8', timeout: 10000 });
    assert.strictEqual(r.status, 0, `${script}: ${r.stderr}`);
    const out = JSON.parse(r.stdout);
    assert.strictEqual(out.hookSpecificOutput.hookEventName, 'UserPromptSubmit', script);
    assert(out.hookSpecificOutput.additionalContext.includes('TURN LABEL LINE'), script);
  }
});

test('hooks are registered for both hosts and the contract asks for the label line', () => {
  // Claude Code (canonical) has PostToolUseFailure; the Codex plugin manifest has no such event.
  for (const [file, events] of [['hooks/hooks.json', ['UserPromptSubmit', 'PostToolUse', 'PostToolUseFailure', 'Stop']],
    ['plugins/harness-everything/hooks/hooks.json', ['UserPromptSubmit', 'PostToolUse', 'Stop']]]) {
    const hooks = JSON.parse(fs.readFileSync(path.join(ROOT, file), 'utf8')).hooks;
    for (const event of events) {
      const commands = (hooks[event] || []).flatMap(entry => entry.hooks.map(h => h.command));
      assert(commands.some(c => c.includes('observation-hook.js')), `${file} ${event}`);
    }
  }
  const router = spawnSync('node', [path.join(ROOT, 'harness-everything/scripts/kernel-router.js'), 'refactor the logger module across the repo'], { encoding: 'utf8' });
  assert(router.stdout.includes('harness-label'), 'the router contract asks for the label line');
  assert(fs.readFileSync(path.join(ROOT, 'AGENTS.md'), 'utf8').includes('harness-label'));
  assert(fs.readFileSync(path.join(ROOT, 'PRIVACY.md'), 'utf8').includes('HARNESS_OBSERVATIONS=off'));
  const telemetry = fs.readFileSync(path.join(ROOT, 'hooks/scripts/lib/telemetry.js'), 'utf8');
  assert(/'prompt'/.test(telemetry) && /'transcript'/.test(telemetry), 'telemetry stays content-free');
});

if (failures) { console.error(`${failures} observation test(s) failed`); process.exit(1); }
console.log('system-one observation tests passed');
