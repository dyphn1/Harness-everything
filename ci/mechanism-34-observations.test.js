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

test('breadth tier and derived tier follow the spec', () => {
  assert.strictEqual(lib.breadthTier({ filesWritten: 0, reposWritten: 0 }), 'tier1');
  assert.strictEqual(lib.breadthTier({ filesWritten: 3, reposWritten: 1 }), 'tier2');
  assert.strictEqual(lib.breadthTier({ filesWritten: 6, reposWritten: 1 }), 'tier3');
  assert.strictEqual(lib.breadthTier({ filesWritten: 2, reposWritten: 2 }), 'tier3');
  assert.deepStrictEqual(lib.deriveTier('tier2', 'tier3'), { tier: 'tier3', source: 'self-report' });
  assert.deepStrictEqual(lib.deriveTier('tier2', 'tier1'), { tier: 'tier2', source: 'behavior' });
  assert.deepStrictEqual(lib.deriveTier('tier1', null), { tier: 'tier1', source: 'behavior' });
});

function sandbox() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'obs-'));
  const store = path.join(dir, 'store');
  const repo = path.join(dir, 'repo');
  fs.mkdirSync(repo);
  execFileSync('git', ['init', '-q', repo]);
  const env = { ...process.env, HARNESS_OBSERVATIONS_DIR: store, HARNESS_STATE_ROOT: path.join(dir, 'state') };
  delete env.HARNESS_OBSERVATIONS;
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
  assert(typeof report.agreement.selfVsBehaviorTier === 'number');
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
