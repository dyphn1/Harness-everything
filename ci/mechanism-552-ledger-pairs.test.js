'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { spawnSync } = require('node:child_process');
const test = require('node:test');

const fixture = require('../behavioral-evals/ledger-pairs/fixture');
const scorer = require('../behavioral-evals/ledger-pairs/score');

test('fixture is deterministic and both arms have identical visible records', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ledger-pairs-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const baseline = await fixture.buildFixture({ out: path.join(root, 'baseline'), arm: 'baseline' });
  const treatment = await fixture.buildFixture({ out: path.join(root, 'treatment'), arm: 'treatment' });
  const rebuilt = await fixture.buildFixture({ out: path.join(root, 'rebuilt'), arm: 'baseline' });
  assert.equal(baseline.initialSha, rebuilt.initialSha);
  assert.equal(baseline.initialSha, treatment.initialSha);
  assert.equal(fixture.visibilityFromRecord(baseline.record), 'visible');
  assert.equal(fixture.visibilityFromRecord(treatment.record), 'visible');
  assert.equal(fixture.indexRow(baseline.index).id, 'E-0003');
  assert.equal(fixture.indexRow(treatment.index).matchBinding, fixture.indexRow(baseline.index).matchBinding);
  assert.notEqual(spawnSync(process.execPath, ['test.js'], { cwd: baseline.repo }).status, 0, 'fixture starts with a failing acceptance test');
});

test('scorer recognizes accepted and corrected commits, and rejects bypasses', () => {
  const accepted = scorer.scoreArm({ runner: 'codex', arm: 'treatment', pair: 1, events: [
    { kind: 'commit', accepted: true, subject: 'fix: update the sample', sha: 'abc123' },
    { kind: 'test', passed: true },
    { kind: 'receipt', status: 'delivered-before-decision', correlated: true, requestId: 'decision-1' },
    { kind: 'decision', requestId: 'decision-1' },
  ], initialFiles: { 'src/sample.js': 'old' }, finalFiles: { 'src/sample.js': 'new' } });
  assert.equal(accepted.firstCommitAccepted, true);
  assert.equal(accepted.correctDiffAndTest, true);
  assert.equal(accepted.receiptStatus, 'delivered-before-decision');

  const corrected = scorer.scoreArm({ runner: 'codex', arm: 'baseline', pair: 1, events: [
    { kind: 'commit', accepted: false, diagnostics: ['subject-case'] },
    { kind: 'commit', accepted: true, subject: 'fix: update the sample', sha: 'def456' },
    { kind: 'test', passed: true },
  ], initialFiles: { 'src/sample.js': 'old' }, finalFiles: { 'src/sample.js': 'new' } });
  assert.equal(corrected.sameClassRejections['subject-case'], 1);
  assert.equal(corrected.retries, 1);

  const bypass = scorer.scoreArm({ runner: 'agy', arm: 'treatment', pair: 1, events: [
    { kind: 'commit', accepted: true, bypass: '--no-verify', sha: 'fff999' },
    { kind: 'test', passed: true },
  ], initialFiles: { 'src/sample.js': 'old' }, finalFiles: { 'src/sample.js': 'new' } });
  assert.equal(bypass.hookBypass, true);
  assert.equal(bypass.qualityPass, false);
});

test('both arms retain byte-identical ledger records', () => {
  const record = { id: 'E-0003', cue: 'original cue', lesson: 'original lesson' };
  const hidden = fixture.applyVisibility(record, 'baseline');
  const visible = fixture.applyVisibility(record, 'treatment');
  assert.deepEqual(hidden, visible);
});

test('unknown or uncorrelated receipts never become timely delivery', () => {
  assert.equal(scorer.receiptStatus([{ kind: 'receipt', status: 'unknown' }, { kind: 'commit' }]), 'unknown');
  assert.equal(scorer.receiptStatus([{ kind: 'receipt', status: 'delivered-before-decision' }, { kind: 'commit' }]), 'unknown');
  assert.equal(scorer.receiptStatus([{ kind: 'receipt', status: 'delivered-before-decision', correlated: true, requestId: 'r1' }, { kind: 'decision', requestId: 'r1' }]), 'delivered-before-decision');
});

test('carrier filter removes only the exact E-0003 fragment', () => {
  const { filterCarrierContext } = require('../behavioral-evals/ledger-pairs/arm');
  const fragment = 'Cue: E-0003\nLesson: choose a lowercase subject';
  const context = `unrelated context\n${fragment}\nmore unrelated context`;
  const baseline = filterCarrierContext(context, fragment, true);
  const treatment = filterCarrierContext(context, fragment, false);
  assert.deepEqual(baseline, { matched: true, stripped: true, text: 'unrelated context\n\nmore unrelated context' });
  assert.deepEqual(treatment, { matched: true, stripped: false, text: context });
});

test('OpenCode context probe strips baseline fragment and passes treatment fragment', async t => {
  const { installOpenCodeCarrierProbe } = require('../behavioral-evals/ledger-pairs/arm');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ledger-opencode-probe-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const records = [];
  for (const arm of ['baseline', 'treatment']) {
    const setup = await fixture.buildFixture({ out: path.join(root, arm), arm });
    const out = path.join(root, `${arm}-out`);
    fs.mkdirSync(out);
    installOpenCodeCarrierProbe(setup, out, arm);
    const pluginPath = path.join(setup.repo, '.opencode/plugins/zz-ledger-probe.js');
    const { default: plugin } = await import(`${pathToFileURL(pluginPath).href}?arm=${arm}`);
    let contextHook;
    let toolHook;
    let toolAfterHook;
    await plugin.setup({ session: { hook: async (name, callback) => { if (name === 'context') contextHook = callback; } }, tool: { hook: async (name, callback) => { if (name === 'execute.before') toolHook = callback; else if (name === 'execute.after') toolAfterHook = callback; } } });
    const record = setup.record;
    const section = name => record.match(new RegExp(`^## ${name}\\s*\\n([\\s\\S]*?)(?=^## |$)`, 'm'))[1].trim();
    const fragment = `Cue:\n${section('Cue')}\nLesson:\n${section('Lesson')}`;
    const system = [{ type: 'text', text: `prefix ${fragment} suffix` }, { type: 'text', text: 'unrelated' }];
    await contextHook({ system, sessionID: 'probe-session', messageID: 'message-1', kind: 'primary' });
    await toolHook({ messageID: 'message-1', input: { command: 'git commit -m "fix: safe subject"' } });
    await toolAfterHook({ messageID: 'message-1', input: { command: 'git commit -m "fix: safe subject"' } });
    const receipt = fs.readFileSync(path.join(out, 'receipt.jsonl'), 'utf8').trim().split(/\r?\n/).map(JSON.parse);
    records.push({ arm, system: system.map(part => part.text), receipt });
  }
  assert.equal(records[0].system[0], 'prefix  suffix');
  assert.equal(records[1].system[0].includes('Cue:'), true);
  assert.equal(records[0].receipt[0].stripped, true);
  assert.equal(records[0].receipt[1].containsGitCommit, true);
  assert.deepEqual(Object.keys(records[0].receipt[1]).sort(), ['containsGitCommit', 'kind', 'phase', 'requestId']);
  assert.equal(records[0].receipt[2].phase, 'tool.execute.after');
});

test('Codex carrier wrapper installs around the real compat hook and remains executable', () => {
  const { installCodexCarrierProbe } = require('../behavioral-evals/ledger-pairs/arm');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ledger-codex-probe-'));
  try {
    const home = path.join(root, 'codex-home');
    fs.mkdirSync(home);
    fs.writeFileSync(path.join(home, 'hooks.json'), JSON.stringify({ hooks: { PreToolUse: [{ command: `node ${path.join(process.cwd(), 'hooks/scripts/codex-ledger-lesson.js')}` }] } }));
    installCodexCarrierProbe({ CODEX_HOME: home }, root, 'baseline');
    const installed = JSON.parse(fs.readFileSync(path.join(home, 'hooks.json'), 'utf8'));
    assert.match(installed.hooks.PreToolUse[0].command, /ledger-probe\.js/);
    assert.doesNotMatch(installed.hooks.PreToolUse[0].command, /codex-ledger-lesson\.js/);
    assert.equal(spawnSync(process.execPath, ['--check', path.join(home, 'ledger-probe.js')]).status, 0);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('over-cap arms remain scored in the denominator and are invalid', () => {
  const score = scorer.scoreArm({ runner: 'codex', arm: 'baseline', pair: 1, usage: { totalTokens: 200001 } });
  assert.equal(score.overCap, true);
  assert.equal(score.valid, false);
  assert.equal(scorer.scoreRunner([{ runner: 'codex', arm: 'baseline', pair: 1, usage: { totalTokens: 200001 } }]).armCount, 1);
});

test('prepared-commit plan uses Luna task and external commit driver', () => {
  const { commandPlan } = require('../behavioral-evals/ledger-pairs/arm');
  const plan = commandPlan({ runner: 'codex', arm: 'baseline' }, { repo: '/fixture' }, {});
  assert.match(plan.args.at(-1), /\.commit-msg\.txt/);
  assert.doesNotMatch(plan.args.at(-1), /then commit the change/i);
  assert.equal(plan.action, 'prepared-commit');
});

test('prepared-commit driver accepts and rejects through the fixture hook', async t => {
  const { FIXED_ENV, buildFixture } = fixture;
  const { runPreparedCommit } = require('../behavioral-evals/ledger-pairs/arm');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ledger-prepared-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  for (const [name, message, accepted] of [['accept', 'fix: say hello', true], ['reject', 'fix: Uppercase', false]]) {
    const setup = await buildFixture({ out: path.join(root, name), arm: 'treatment' });
    fs.writeFileSync(path.join(setup.repo, 'src/sample.js'), "'use strict';\n\nmodule.exports = () => 'hello';\n");
    fs.writeFileSync(path.join(setup.repo, '.commit-msg.txt'), `${message}\n`);
    const result = runPreparedCommit(setup.repo, { ...process.env, ...FIXED_ENV });
    assert.equal(result.accepted, accepted);
    assert.deepEqual(result.stagedFiles, ['src/sample.js']);
  }
});
