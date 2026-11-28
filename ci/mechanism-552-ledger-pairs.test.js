'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const test = require('node:test');

const fixture = require('../behavioral-evals/ledger-pairs/fixture');
const scorer = require('../behavioral-evals/ledger-pairs/score');

test('fixture is deterministic and visibility changes only Cue/Lesson bodies', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ledger-pairs-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const baseline = await fixture.buildFixture({ out: path.join(root, 'baseline'), arm: 'baseline' });
  const treatment = await fixture.buildFixture({ out: path.join(root, 'treatment'), arm: 'treatment' });
  const rebuilt = await fixture.buildFixture({ out: path.join(root, 'rebuilt'), arm: 'baseline' });
  assert.equal(baseline.initialSha, rebuilt.initialSha);
  assert.equal(baseline.initialSha, treatment.initialSha);
  assert.equal(fixture.visibilityFromRecord(baseline.record), 'hidden');
  assert.equal(fixture.visibilityFromRecord(treatment.record), 'visible');
  assert.equal(fixture.indexRow(baseline.index).id, 'E-0003');
  assert.equal(fixture.indexRow(treatment.index).matchBinding, fixture.indexRow(baseline.index).matchBinding);
  assert.notEqual(spawnSync(process.execPath, ['test.js'], { cwd: baseline.repo }).status, 0, 'fixture starts with a failing acceptance test');
});

test('scorer recognizes accepted and corrected commits, and rejects bypasses', () => {
  const accepted = scorer.scoreArm({ runner: 'codex', arm: 'treatment', pair: 1, events: [
    { kind: 'commit', accepted: true, subject: 'fix: update the sample', sha: 'abc123' },
    { kind: 'test', passed: true },
    { kind: 'receipt', status: 'delivered-before-decision' },
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

test('visibility filter keeps matcher receipt and action untouched', () => {
  const record = { id: 'E-0003', cue: 'original cue', lesson: 'original lesson' };
  const hidden = fixture.applyVisibility(record, 'baseline');
  const visible = fixture.applyVisibility(record, 'treatment');
  assert.equal(hidden.id, visible.id);
  assert.equal(hidden.cue, '[lesson withheld by probe]');
  assert.equal(hidden.lesson, '[lesson withheld by probe]');
  assert.equal(visible.lesson, 'original lesson');
});
