'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { test } = require('node:test');
const { buildDataset } = require('../scripts/system-one-cycle/build');
const { collect } = require('../scripts/system-one-cycle/collect');
const { judgeRows } = require('../scripts/system-one-cycle/judge');
const { runGuarded, processTreeRssMb } = require('../scripts/system-one-cycle/train');
const { buildVersion, trainerCatalogs } = require('../scripts/system-one-cycle/package');
const install = require('../harness-everything/scripts/system-one/install');
const provider = require('../harness-everything/scripts/system-one/provider');
const router = require('../harness-everything/scripts/system-one/router');
const { CATALOGS } = require('../harness-everything/scripts/system-one/catalogs');

const root = fs.realpathSync.native(path.resolve(__dirname, '..'));

function writeJsonl(file, rows) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, rows.map(row => JSON.stringify(row)).join('\n') + (rows.length ? '\n' : ''));
}

function syntheticCycle(dir) {
  const training = path.join(dir, 'training');
  const prompts = [
    { id: 'agent-dispatch', family: 'family-agent', source: 'agent-dispatch', split: 'train', text: 'synthetic-agent-dispatch-case', previous: 'synthetic-previous-field' },
    { id: 'agrees', family: 'family-agrees', source: 'observation', split: 'train', text: 'synthetic-agreement-case', previous: 'synthetic-previous-field' },
    { id: 'legacy-intent-shape', family: 'family-legacy-intent', source: 'observation', split: 'train', text: 'synthetic-legacy-intent-case' },
    { id: 'intent-majority', family: 'family-intent-majority', source: 'observation', split: 'train', text: 'synthetic-intent-majority-case' },
    { id: 'intent-no-majority', family: 'family-intent-no-majority', source: 'observation', split: 'train', text: 'synthetic-intent-no-majority-case' },
    { id: 'tier-only', family: 'family-tier-only', source: 'observation', split: 'train', text: 'synthetic-tier-only-case' },
    { id: 'writes', family: 'family-writes', source: 'observation', split: 'train', text: 'synthetic-write-evidence-case' },
    { id: 'vote', family: 'family-vote', source: 'observation', split: 'train', text: 'synthetic-majority-vote-case' },
    { id: 'null-vote', family: 'family-null-vote', source: 'observation', split: 'train', text: 'synthetic-null-consensus-case' },
    { id: 'validity-conflict', family: 'family-validity-conflict', source: 'observation', split: 'train', text: 'synthetic-validity-conflict-case' },
    { id: 'split-train', family: 'family-split-train', source: 'observation', split: 'train', text: 'same normalized synthetic phrase' },
    { id: 'split-validation', family: 'family-split-validation', source: 'observation', split: 'validation', text: 'Same, normalized synthetic phrase!' },
    { id: 'no-majority', family: 'family-no-majority', source: 'observation', split: 'train', text: 'synthetic-no-majority-case' },
    { id: 'no-vote', family: 'family-no-vote', source: 'observation', split: 'train', text: 'synthetic-missing-vote-case' },
    { id: 'holdout-copy', family: 'family-holdout', source: 'observation', split: 'train', text: 'holdout only synthetic sentinel' },
    { id: 'invalid', family: 'family-invalid', source: 'observation', split: 'train', text: 'synthetic-context-dependent-case' },
  ];
  writeJsonl(path.join(training, 'observed/prompts-observed.jsonl'), prompts);
  writeJsonl(path.join(training, 'observed/labels-observed.jsonl'), [
    { id: 'agrees', tier: 'tier2', intents: ['feature'], contextDependent: true, contradictions: [], behaviorEvidence: 'unobserved' },
    { id: 'legacy-intent-shape', tier: 'tier2', contradictions: [], behaviorEvidence: 'unobserved' },
    { id: 'intent-majority', tier: 'tier2', intents: ['fix'], contradictions: [], behaviorEvidence: 'unobserved' },
    { id: 'intent-no-majority', tier: 'tier2', intents: ['edit'], contradictions: [], behaviorEvidence: 'unobserved' },
    { id: 'tier-only', tier: 'tier1', intents: ['review'], contradictions: [], behaviorEvidence: 'unobserved' },
    { id: 'writes', tier: 'tier1', intents: ['feature'], contextDependent: true, contradictions: ['tier1-with-writes'], behaviorEvidence: 'observed' },
    { id: 'vote', tier: 'tier1', intents: ['feature'], contextDependent: true, contradictions: [], behaviorEvidence: 'unobserved' },
    { id: 'null-vote', tier: 'tier2', intents: ['feature'], contextDependent: false, contradictions: [], behaviorEvidence: 'unobserved' },
    { id: 'validity-conflict', tier: 'tier2', intents: [], contextDependent: true, contradictions: [], behaviorEvidence: 'unobserved' },
    { id: 'split-train', tier: 'tier2', intents: ['feature'], contextDependent: false, contradictions: [], behaviorEvidence: 'observed' },
    { id: 'split-validation', tier: 'tier2', intents: ['feature'], contextDependent: false, contradictions: [], behaviorEvidence: 'observed' },
    { id: 'no-majority', tier: 'tier1', intents: ['feature'], contextDependent: false, contradictions: [], behaviorEvidence: 'observed' },
    { id: 'no-vote', tier: 'tier1', intents: ['feature'], contextDependent: false, contradictions: [], behaviorEvidence: 'observed' },
    { id: 'invalid', tier: null, intents: [], contextDependent: true, contradictions: [], behaviorEvidence: 'unobserved' },
  ]);
  writeJsonl(path.join(training, 'relabel-luna/labels.jsonl'), [
    ...['agent-dispatch', 'agrees', 'legacy-intent-shape', 'intent-majority', 'intent-no-majority', 'writes', 'split-train', 'split-validation'].map(id => ({ id, gold: id === 'writes' ? 'tier1' : id === 'agrees' || id === 'legacy-intent-shape' || id.startsWith('intent-') || id.startsWith('split') ? 'tier2' : 'tier3' })),
    { id: 'tier-only', gold: 'tier2' },
    { id: 'vote', gold: 'tier2' }, { id: 'null-vote', gold: 'tier1' }, { id: 'validity-conflict', gold: null },
    { id: 'no-majority', gold: 'tier2' }, { id: 'no-vote', gold: 'tier2' },
    { id: 'holdout-copy', gold: 'tier2' }, { id: 'invalid', gold: null },
  ]);
  writeJsonl(path.join(training, 'relabel-luna/labels-intent.jsonl'), prompts.map(row => ({
    id: row.id,
    gold: row.id === 'invalid' || row.id === 'holdout-copy' || row.id === 'validity-conflict' ? null
      : row.id === 'intent-no-majority' ? 'explain' : row.id === 'tier-only' ? 'review'
        : row.id === 'legacy-intent-shape' ? 'explain' : 'feature',
    secondary: [],
  })));
  writeJsonl(path.join(training, 'adjudication/consensus.jsonl'), [
    { id: 'vote', status: 'majority', consensus: 'tier3', votes: [{ judge: 'luna', tier: 'tier3' }, { judge: 'opencode', tier: 'tier3' }] },
    { id: 'intent-majority', status: 'majority', consensus: 'tier2', intentStatus: 'majority', intentConsensus: 'fix',
      votes: [{ judge: 'luna', tier: 'tier2', intent: 'fix' }, { judge: 'opencode', tier: 'tier2', intent: 'fix' }] },
    { id: 'intent-no-majority', status: 'majority', consensus: 'tier2', intentStatus: 'no-majority', intentConsensus: null,
      votes: [{ judge: 'luna', tier: 'tier2', intent: 'edit' }, { judge: 'opencode', tier: 'tier2', intent: 'feature' }] },
    { id: 'tier-only', status: 'majority', consensus: 'tier3',
      votes: [{ judge: 'luna', tier: 'tier3' }, { judge: 'opencode', tier: 'tier3' }] },
    { id: 'null-vote', status: 'unanimous', consensus: null, votes: [{ judge: 'luna', tier: null }, { judge: 'opencode', tier: null }] },
    { id: 'validity-conflict', status: 'majority', consensus: 'tier2', votes: [{ judge: 'luna', tier: 'tier2' }, { judge: 'opencode', tier: 'tier2' }] },
    { id: 'no-majority', status: 'no-majority', consensus: null, votes: [{ judge: 'luna', tier: 'tier2' }, { judge: 'opencode', tier: 'tier3' }] },
  ]);
  const holdout = path.join(dir, 'holdout.json');
  fs.writeFileSync(holdout, JSON.stringify({ schemaVersion: 1, cases: [{ request: { context: 'holdout-only synthetic sentinel' } }] }));
  return { training, holdout };
}

function assertNoDatasetOutputs(...dirs) {
  for (const dir of dirs) {
    for (const file of ['prompts.jsonl', 'labels.jsonl', 'labels-intent.jsonl', 'report.json']) {
      assert.equal(fs.existsSync(path.join(dir, file)), false, `unexpected dataset output ${file}`);
    }
  }
}

test('cycle dataset uses text-only labels, consensus, behavior evidence, holdout fields, and private prompt elision', t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'system-one-cycle-build-'));
  try {
    const fixture = syntheticCycle(dir);
    const report = buildDataset({ dataDir: dir, holdoutFiles: [fixture.holdout] });
    const output = path.join(fixture.training, 'v1');
    const prompts = fs.readFileSync(path.join(output, 'prompts.jsonl'), 'utf8').trim().split('\n').map(JSON.parse);
    const labels = new Map(fs.readFileSync(path.join(output, 'labels.jsonl'), 'utf8').trim().split('\n').map(JSON.parse).map(row => [row.id, row.gold]));
    const validityLabels = new Map(fs.readFileSync(path.join(fixture.training, 'v1-validity/labels.jsonl'), 'utf8').trim().split('\n').map(JSON.parse).map(row => [row.id, row.gold]));
    const intents = new Map(fs.readFileSync(path.join(output, 'labels-intent.jsonl'), 'utf8').trim().split('\n').map(JSON.parse).map(row => [row.id, row]));
    const ids = new Set(prompts.map(row => row.id));

    assert.equal(ids.has('agent-dispatch'), true);
    assert.equal(labels.get('agrees'), 'tier2');
    assert.equal(intents.get('agrees').gold, 'feature');
    assert.equal(intents.get('legacy-intent-shape').gold, 'explain');
    assert.equal(labels.get('vote'), 'tier3');
    assert.equal(labels.get('null-vote'), null);
    assert.equal(labels.get('validity-conflict'), 'tier2');
    assert.equal(validityLabels.get('validity-conflict'), null);
    assert.equal(labels.has('intent-no-majority'), true);
    assert.equal(validityLabels.get('intent-no-majority'), 'tier2');
    assert.equal(labels.get('tier-only'), 'tier3');
    assert.equal(labels.get('writes'), 'tier2');
    assert.equal(labels.has('no-majority'), false);
    assert.equal(labels.has('no-vote'), false);
    assert.equal(labels.has('holdout-copy'), false);
    assert.equal(labels.has('split-train'), false);
    assert.equal(labels.has('split-validation'), true);
    assert.equal(labels.get('invalid'), null);
    assert.deepEqual(intents.get('invalid'), { id: 'invalid', gold: null, secondary: [] });
    assert.equal(intents.get('intent-majority').gold, 'fix');
    assert.equal(intents.has('intent-no-majority'), false);
    assert.equal(intents.get('tier-only').gold, 'review');
    assert.ok(prompts.every(row => Object.keys(row).sort().join(',') === 'family,id,source,split,text'));
    assert.equal(fs.readFileSync(path.join(output, 'report.json'), 'utf8').includes('synthetic-'), false);
    assert.equal(report.droppedByReason['no-majority'], 1);
    assert.equal(report.droppedByReason['intent-no-majority'], 1);
    assert.equal(report.droppedByReason['no-vote'], 1);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('collect preserves self-reported intents from the actual session export shape', t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'system-one-cycle-collect-'));
  const sessions = path.join(dir, 'sessions');
  const home = path.join(dir, 'home');
  const liveStore = path.join(dir, 'live-observations');
  const envKeys = ['HOME', 'USERPROFILE', 'HARNESS_OBSERVATIONS_DIR'];
  const previousEnv = Object.fromEntries(envKeys.map(key => [key, process.env[key]]));
  fs.mkdirSync(home);
  fs.mkdirSync(liveStore);
  Object.assign(process.env, { HOME: home, USERPROFILE: home, HARNESS_OBSERVATIONS_DIR: liveStore });
  try {
    fs.mkdirSync(sessions, { recursive: true });
    const startedAt = new Date(Date.now() - 60_000).toISOString();
    const completedAt = new Date(Date.now() - 30_000).toISOString();
    const label = { v: 1, validity: 'actionable', tier: 'tier2', intents: ['fix', 'explain'], workflow: null, skills: [] };
    const session = [
      { type: 'session_meta', payload: { session_id: 'synthetic-collect-session' } },
      { type: 'event_msg', timestamp: startedAt, payload: { type: 'task_started', turn_id: 'synthetic-turn', started_at: startedAt } },
      { type: 'response_item', timestamp: startedAt, payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'synthetic collect intent case' }] } },
      { type: 'event_msg', timestamp: completedAt, payload: { type: 'task_complete', turn_id: 'synthetic-turn', completed_at: completedAt,
        last_agent_message: `Synthetic response\n<!-- harness-label ${JSON.stringify(label)} -->` } },
    ];
    fs.writeFileSync(path.join(sessions, 'synthetic.jsonl'), session.map(row => JSON.stringify(row)).join('\n') + '\n');
    const since = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
    const dataDir = path.join(dir, 'cycle');

    collect({ dataDir, since, sessionsDir: sessions });

    const labels = fs.readFileSync(path.join(dataDir, 'training/observed/labels-observed.jsonl'), 'utf8')
      .trim().split('\n').map(JSON.parse);
    assert.equal(labels.length, 1);
    assert.deepEqual(labels[0].intents, ['fix', 'explain']);
  } finally {
    for (const [key, value] of Object.entries(previousEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('cycle dataset rejects direct, aliased, and unresolved checkout destinations before writing either output', t => {
  for (const aliasKind of ['direct', 'ancestor', 'leaf', 'unresolved']) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'system-one-cycle-private-destination-'));
    const forbidden = fs.mkdtempSync(path.join(root, 'ci', '.s1-f9-forbidden-'));
    let alias;
    try {
      const fixture = syntheticCycle(dir);
      let validityOutDir = forbidden;
      if (aliasKind !== 'direct') {
        alias = path.join(dir, `forbidden-${aliasKind}`);
        try { fs.symlinkSync(aliasKind === 'unresolved' ? path.join(forbidden, 'missing-target') : forbidden, alias, 'dir'); }
        catch (error) {
          if (['EACCES', 'EPERM', 'ENOSYS', 'ENOTSUP'].includes(error.code)) {
            t.skip(`directory symlinks unavailable: ${error.code}`);
            return;
          }
          throw error;
        }
        validityOutDir = aliasKind === 'leaf' ? alias : path.join(alias, 'missing', 'validity');
      }

      const safeOutput = path.join(dir, 'safe-output');
      if (aliasKind === 'unresolved') {
        assert.throws(() => buildDataset({ dataDir: dir, holdoutFiles: [fixture.holdout],
          outDir: safeOutput, validityOutDir }), error => error.code === 'ENOENT');
      } else {
        assert.throws(() => buildDataset({ dataDir: dir, holdoutFiles: [fixture.holdout],
          outDir: safeOutput, validityOutDir }), /outside the repository/);
      }
      assertNoDatasetOutputs(safeOutput, forbidden);
    } finally {
      if (alias) fs.rmSync(alias, { recursive: true, force: true });
      fs.rmSync(forbidden, { recursive: true, force: true });
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }
});

test('cycle dataset accepts an external data directory through an external symlink alias', t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'system-one-cycle-external-alias-'));
  const dataDir = path.join(dir, 'data');
  const alias = path.join(dir, 'data-alias');
  try {
    const fixture = syntheticCycle(dataDir);
    try { fs.symlinkSync(dataDir, alias, 'dir'); }
    catch (error) {
      if (['EACCES', 'EPERM', 'ENOSYS', 'ENOTSUP'].includes(error.code)) {
        t.skip(`directory symlinks unavailable: ${error.code}`);
        return;
      }
      throw error;
    }

    buildDataset({ dataDir: alias, holdoutFiles: [fixture.holdout] });
    assert.equal(fs.existsSync(path.join(dataDir, 'training', 'v1', 'prompts.jsonl')), true);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('cycle dataset keeps the .s1-work exception tied to the canonical synthetic destination', t => {
  const base = path.join(root, '.s1-work');
  fs.mkdirSync(base, { recursive: true });
  const dataDir = fs.mkdtempSync(path.join(base, 'f9-canonical-exception-'));
  const alias = path.join(os.tmpdir(), `system-one-cycle-s1-work-alias-${process.pid}`);
  try {
    const fixture = syntheticCycle(dataDir);
    const promptFile = path.join(fixture.training, 'observed', 'prompts-observed.jsonl');
    const prompts = fs.readFileSync(promptFile, 'utf8').trim().split('\n').map(JSON.parse)
      .map(row => ({ ...row, text: 'agent request without the fixture marker' }));
    writeJsonl(promptFile, prompts);
    try { fs.symlinkSync(dataDir, alias, 'dir'); }
    catch (error) {
      if (['EACCES', 'EPERM', 'ENOSYS', 'ENOTSUP'].includes(error.code)) {
        t.skip(`directory symlinks unavailable: ${error.code}`);
        return;
      }
      throw error;
    }

    assert.throws(() => buildDataset({ dataDir: alias, holdoutFiles: [fixture.holdout] }), /synthetic fixture rows/);
    assertNoDatasetOutputs(path.join(dataDir, 'training', 'v1'), path.join(dataDir, 'training', 'v1-validity'));
  } finally {
    fs.rmSync(alias, { recursive: true, force: true });
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});

test('cycle dataset requires the real holdout request.context field', t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'system-one-cycle-holdout-'));
  try {
    const fixture = syntheticCycle(dir);
    fs.writeFileSync(fixture.holdout, JSON.stringify({ schemaVersion: 1, cases: [{ request: { task: 'tier' } }] }));
    assert.throws(() => buildDataset({ dataDir: dir, holdoutFiles: [fixture.holdout] }), /request\.context/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('cycle dataset rejects duplicate observed prompt ids', t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'system-one-cycle-duplicate-'));
  try {
    const fixture = syntheticCycle(dir);
    const promptsFile = path.join(fixture.training, 'observed/prompts-observed.jsonl');
    const prompts = fs.readFileSync(promptsFile, 'utf8').trim().split('\n').map(JSON.parse);
    writeJsonl(promptsFile, [...prompts, { ...prompts[0], text: 'synthetic-duplicate-id-case' }]);
    assert.throws(() => buildDataset({ dataDir: dir, holdoutFiles: [fixture.holdout] }), /duplicate prompt id/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('judge resumes completed rows and records no-majority without prompt text', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'system-one-cycle-judge-'));
  try {
    const training = path.join(dir, 'training');
    writeJsonl(path.join(training, 'observed/prompts-observed.jsonl'), [
      { id: 'done', family: 'f1', source: 'observation', split: 'train', text: 'synthetic-completed-case', previous: 'synthetic-private-context' },
      { id: 'todo', family: 'f2', source: 'observation', split: 'train', text: 'synthetic-pending-case', previous: 'synthetic-private-context' },
      { id: 'intent-only', family: 'f3', source: 'observation', split: 'train', text: 'synthetic-intent-disagreement-case' },
      { id: 'tier-only-no-intent-label', family: 'f4', source: 'observation', split: 'train', text: 'synthetic-tier-disagreement-case' },
    ]);
    writeJsonl(path.join(training, 'observed/labels-observed.jsonl'), [
      { id: 'done', tier: 'tier1', intents: ['feature'] }, { id: 'todo', tier: 'tier1', intents: ['feature'] },
      { id: 'intent-only', tier: 'tier2', intents: ['fix'] },
      { id: 'tier-only-no-intent-label', tier: 'tier1', intents: ['feature'] },
    ]);
    writeJsonl(path.join(training, 'relabel-luna/labels.jsonl'), [
      { id: 'done', gold: 'tier2' }, { id: 'todo', gold: 'tier2' }, { id: 'intent-only', gold: 'tier2' },
      { id: 'tier-only-no-intent-label', gold: 'tier2' },
    ]);
    writeJsonl(path.join(training, 'relabel-luna/labels-intent.jsonl'), [
      { id: 'done', gold: 'feature', secondary: [] }, { id: 'todo', gold: 'feature', secondary: [] },
      { id: 'intent-only', gold: 'feature', secondary: [] },
    ]);
    writeJsonl(path.join(training, 'adjudication/consensus.jsonl'), [
      { id: 'done', status: 'majority', consensus: 'tier2', votes: [{ judge: 'luna', tier: 'tier2' }, { judge: 'opencode', tier: 'tier2' }] },
    ]);
    const calls = [];
    const report = await judgeRows({ dataDir: dir, runJudge: async (engine, batch) => {
      calls.push(engine);
      assert.deepEqual(batch.map(row => row.id), ['todo', 'intent-only', 'tier-only-no-intent-label']);
      return batch.map((row, i) => ({ i,
        tier: row.id === 'intent-only' ? 'tier2' : (engine === 'luna' ? 'tier2' : 'tier3'),
        ...(row.selfIntent === undefined ? {} : { intent: 'fix' }),
      }));
    } });
    const saved = fs.readFileSync(path.join(training, 'adjudication/consensus.jsonl'), 'utf8');
    const rows = saved.trim().split('\n').map(JSON.parse);
    const input = fs.readFileSync(path.join(training, 'adjudication/input.jsonl'), 'utf8').trim().split('\n').map(JSON.parse);

    assert.deepEqual(calls, ['luna', 'opencode']);
    assert.equal(report.voted, 3);
    assert.equal(rows.find(row => row.id === 'todo').status, 'no-majority');
    assert.equal(rows.find(row => row.id === 'intent-only').intentStatus, 'majority');
    assert.equal(rows.find(row => row.id === 'intent-only').intentConsensus, 'fix');
    assert.equal(saved.includes('synthetic-'), false);
    assert.deepEqual(input.map(row => row.id), ['done', 'todo', 'intent-only', 'tier-only-no-intent-label']);
    assert.equal(new Set(input.map(row => row.id)).size, input.length);
    assert.deepEqual(Object.keys(input[0]).sort(), ['id', 'lunaTier', 'selfTier', 'text']);
    assert.deepEqual(Object.keys(input.find(row => row.id === 'intent-only')).sort(),
      ['id', 'lunaIntent', 'lunaTier', 'selfIntent', 'selfTier', 'text']);
    assert.deepEqual(Object.keys(input.find(row => row.id === 'tier-only-no-intent-label')).sort(),
      ['id', 'lunaTier', 'selfTier', 'text']);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('resource guard kills an over-limit child and records peak RSS', async () => {
  let samples = 0;
  let rssReader;
  try { processTreeRssMb(process.pid); rssReader = processTreeRssMb; }
  catch { rssReader = () => (++samples === 1 ? 48 : 128); }
  const result = await runGuarded(process.execPath, ['-e', 'const b=Buffer.allocUnsafe(160*1024*1024); for(let i=0;i<b.length;i+=4096)b[i]=1; const {spawn}=require("node:child_process"); spawn(process.execPath,["-e","setInterval(()=>{},1000)"],{stdio:"ignore"}); setInterval(()=>{},1000);'], {
    maxRssMb: 96, threads: 4, pollMs: 100, rssReader,
  });
  assert.equal(result.killedForLimit, true);
  assert.ok(result.peakRssMb > 96);
  assert.equal(result.monitorFailed, false);
});

test('package writes the contract B manifest and carries evaluation into the private version directory', t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'system-one-cycle-package-'));
  try {
    const version = 'synthetic-v1';
    const runs = path.join(dir, 'training', 'runs', version);
    const catalogs = trainerCatalogs();
    const thresholds = Object.fromEntries(Object.entries(catalogs).map(([task, options]) => [task,
      Object.fromEntries(options.map(id => [id, id === 'unclassified' ? null : 0.5]))]));
    for (const [task, values] of Object.entries(thresholds)) {
      const stage = path.join(runs, task);
      fs.mkdirSync(stage, { recursive: true });
      fs.writeFileSync(path.join(stage, 'harness-routing-v1.safetensors'), `${task}-weights`);
      fs.writeFileSync(path.join(stage, 'harness-routing-v1.json'), JSON.stringify({ context_tokens: 1024 }));
      fs.writeFileSync(path.join(stage, 'calibration.json'), JSON.stringify({ thresholds: values }));
    }
    const candidate = path.join(dir, 'training', 'candidates', version);
    buildVersion({ dataDir: dir, version, sourceDir: runs, versionDir: candidate });
    fs.mkdirSync(path.join(candidate, 'evaluation'), { recursive: true });
    fs.writeFileSync(path.join(candidate, 'evaluation', 'curves.json'), '{}\n');
    fs.writeFileSync(path.join(candidate, 'evaluation', 'trend.json'), '{}\n');

    const output = path.join(dir, 'training', 'versions', version);
    buildVersion({ dataDir: dir, version, sourceDir: candidate, versionDir: output });
    const manifest = JSON.parse(fs.readFileSync(path.join(output, 'manifest.json'), 'utf8'));

    assert.deepEqual(Object.keys(manifest).sort(), ['createdAt', 'evaluation', 'schemaVersion', 'stages', 'version']);
    assert.equal(manifest.schemaVersion, 1);
    assert.equal(manifest.version, version);
    assert.equal(manifest.evaluation, 'evaluation/curves.json');
    assert.deepEqual(manifest.stages.validity.options, catalogs.validity);
    assert.deepEqual(manifest.stages.intent.options, catalogs.intent);
    assert.ok(manifest.stages.intent.options.includes('unclassified'));
    assert.deepEqual(Object.keys(manifest.stages.intent.thresholds), catalogs.intent);
    assert.equal(manifest.stages.intent.thresholds.unclassified, 1);
    assert.ok(manifest.stages.intent.referenceOnly.includes('unclassified'));
    assert.deepEqual(manifest.stages.tier.thresholds, thresholds.tier);
    assert.deepEqual(Object.keys(manifest.stages.tier.thresholds), catalogs.tier);
    assert.match(manifest.stages.intent.sha256, /^[0-9a-f]{64}$/);
    assert.equal(fs.existsSync(path.join(output, 'evaluation', 'trend.json')), true);
    assert.equal('referenceOnly' in manifest.stages.validity, false);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

function writePackageRuns(dir, version, calibrationByTask) {
  const runs = path.join(dir, 'training', 'runs', version);
  for (const [task, values] of Object.entries(calibrationByTask)) {
    const stage = path.join(runs, task);
    fs.mkdirSync(stage, { recursive: true });
    fs.writeFileSync(path.join(stage, 'harness-routing-v1.safetensors'), `${task}-weights`);
    fs.writeFileSync(path.join(stage, 'harness-routing-v1.json'), JSON.stringify({ context_tokens: 1024 }));
    fs.writeFileSync(path.join(stage, 'calibration.json'), JSON.stringify({ thresholds: values }));
  }
  return runs;
}

function trainerThresholds(value = 0.5) {
  return Object.fromEntries(Object.entries(trainerCatalogs()).map(([task, options]) => [task,
    Object.fromEntries(options.map(id => [id, id === 'unclassified' ? null : value]))]));
}

test('package turns a null calibration threshold into 1 and carries referenceOnly through repackaging', t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'system-one-cycle-package-null-'));
  try {
    const version = 'synthetic-null-v1';
    const thresholds = trainerThresholds();
    thresholds.tier.tier2 = null;
    const runs = writePackageRuns(dir, version, thresholds);
    const candidate = path.join(dir, 'training', 'candidates', version);
    buildVersion({ dataDir: dir, version, sourceDir: runs, versionDir: candidate });
    const candidateManifest = JSON.parse(fs.readFileSync(path.join(candidate, 'manifest.json'), 'utf8'));
    assert.equal(candidateManifest.stages.tier.thresholds.tier2, 1);
    assert.deepEqual(candidateManifest.stages.tier.referenceOnly, ['tier2']);

    const output = path.join(dir, 'training', 'versions', version);
    buildVersion({ dataDir: dir, version, sourceDir: candidate, versionDir: output });
    const manifest = JSON.parse(fs.readFileSync(path.join(output, 'manifest.json'), 'utf8'));
    assert.equal(manifest.stages.tier.thresholds.tier2, 1);
    assert.deepEqual(manifest.stages.tier.referenceOnly, ['tier2']);
    assert.equal('referenceOnly' in manifest.stages.validity, false);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('package restores omitted unclassified metadata from a prior candidate without retraining', t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'system-one-cycle-package-legacy-catalog-'));
  try {
    const version = 'synthetic-legacy-catalog-v1';
    const thresholds = trainerThresholds();
    const runs = writePackageRuns(dir, version, thresholds);
    const candidate = path.join(dir, 'training', 'candidates', version);
    buildVersion({ dataDir: dir, version, sourceDir: runs, versionDir: candidate });

    const manifestFile = path.join(candidate, 'manifest.json');
    const oldManifest = JSON.parse(fs.readFileSync(manifestFile, 'utf8'));
    oldManifest.stages.intent.options = oldManifest.stages.intent.options.filter(id => id !== 'unclassified');
    delete oldManifest.stages.intent.thresholds.unclassified;
    oldManifest.stages.intent.referenceOnly = oldManifest.stages.intent.referenceOnly.filter(id => id !== 'unclassified');
    if (!oldManifest.stages.intent.referenceOnly.length) delete oldManifest.stages.intent.referenceOnly;
    fs.writeFileSync(manifestFile, JSON.stringify(oldManifest));

    const output = path.join(dir, 'training', 'versions', version);
    buildVersion({ dataDir: dir, version, sourceDir: candidate, versionDir: output });
    const manifest = JSON.parse(fs.readFileSync(path.join(output, 'manifest.json'), 'utf8'));
    assert.ok(manifest.stages.intent.options.includes('unclassified'));
    assert.equal(manifest.stages.intent.thresholds.unclassified, 1);
    assert.ok(manifest.stages.intent.referenceOnly.includes('unclassified'));
    assert.deepEqual(Object.keys(manifest.stages.intent.thresholds), manifest.stages.intent.options);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('package still rejects a non-null non-finite threshold', t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'system-one-cycle-package-nan-'));
  try {
    const version = 'synthetic-nan-v1';
    const thresholds = trainerThresholds();
    const runs = writePackageRuns(dir, version, thresholds);
    // 1e999 overflows to Infinity, the non-null non-finite value JSON can carry.
    const calibration = path.join(runs, 'tier', 'calibration.json');
    const serialized = JSON.stringify({ thresholds: thresholds.tier });
    const keyValue = `${JSON.stringify('tier2')}:${thresholds.tier.tier2}`;
    fs.writeFileSync(calibration, serialized.replace(keyValue, `${JSON.stringify('tier2')}:1e999`));
    assert.throws(() => buildVersion({ dataDir: dir, version, sourceDir: runs,
      versionDir: path.join(dir, 'training', 'versions', version) }), /finite per-option thresholds/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('package publishes a trainer-catalog version that installs, activates, and reports reference-only scores', async t => {
  const dir = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'system-one-cycle-roundtrip-')));
  const home = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'system-one-cycle-home-')));
  try {
    const version = 'synthetic-roundtrip-v1';
    const catalogs = trainerCatalogs();
    const thresholds = Object.fromEntries(Object.entries(catalogs).map(([task, options]) => [task,
      Object.fromEntries(options.map(id => [id, id === 'unclassified' ? null : 0.5]))]));
    thresholds.intent.fix = null;
    thresholds.tier.tier3 = null;
    const runs = writePackageRuns(dir, version, thresholds);
    const versionDir = path.join(dir, 'training', 'versions', version);
    buildVersion({ dataDir: dir, version, sourceDir: runs, versionDir });
    const packaged = JSON.parse(fs.readFileSync(path.join(versionDir, 'manifest.json'), 'utf8'));
    for (const [stage, ids] of Object.entries(catalogs)) {
      assert.deepEqual(packaged.stages[stage].options, ids);
      assert.deepEqual(Object.keys(packaged.stages[stage].thresholds), ids);
    }
    assert.deepEqual(packaged.stages.intent.referenceOnly, ['fix', 'unclassified']);
    const scoreScript = path.join(root, 'scripts/system-one-cycle/score.py');
    const pythonCode = "import importlib.util,json,sys; spec=importlib.util.spec_from_file_location('score',sys.argv[1]); module=importlib.util.module_from_spec(spec); spec.loader.exec_module(module); print(json.dumps([o['id'] for o in module.trained_catalog(sys.argv[2],'intent',sys.argv[3])]))";
    const scoredCatalog = spawnSync(process.env.PYTHON || 'python3', ['-c', pythonCode, scoreScript,
      path.join(versionDir, 'intent.safetensors'), path.join(root, 'benchmarks/fixtures/system-one-intent-holdout.json')],
    { cwd: root, encoding: 'utf8' });
    assert.equal(scoredCatalog.status, 0, scoredCatalog.stderr);
    assert.deepEqual(JSON.parse(scoredCatalog.stdout), catalogs.intent);

    const publishCommand = spawnSync(process.execPath, [path.join(root, 'scripts/system-one-cycle.js'), 'publish',
      '--data-dir', dir, '--version', version], { cwd: root, encoding: 'utf8' });
    assert.equal(publishCommand.status, 0, publishCommand.stderr);
    const published = JSON.parse(publishCommand.stdout).steps[0];
    assert.equal(published.publishedPath, path.join(dir, 'models', 'cua-s1', version));

    install.installVersion(dir, version, home);
    install.activate(version, home);
    const env = { HARNESS_SYSTEM_ONE_HOME: home };
    const active = provider.readActive(env);
    assert.equal(active.version, version);
    const liveCatalogs = {
      validity: router.VALIDITY_OPTIONS,
      intent: CATALOGS.intent,
      tier: router.TIER_OPTIONS,
    };
    const result = await provider.scoreLive('synthetic request', env, liveCatalogs, async (_stage, request) => ({
      status: 'scored',
      response: {
        schemaVersion: 1, requestHash: request.requestHash, catalogHash: request.catalogHash,
        model: { id: version, revision: version, domain: 'harness-routing-v1' },
        scores: request.options.map(option => ({ id: option.id,
          probability: option.id === 'fix' || option.id === 'tier3' ? 0.99 : option.id === 'tier2' ? 0.8 : 0.1 })),
      },
    }));
    assert.deepEqual(result.referenceOnly, { validity: [], intent: ['fix', 'unclassified'], tier: ['tier3'] });
    assert.equal(result.stageScores.intent.fix, 0.99);
    assert.equal(result.stageScores.intent.unclassified, 0.1);
    assert.equal(result.stageScores.tier.tier3, 0.99);
    const routed = router.routeLive({ tier: 'Tier 1 (Trivial)', floor: null, explicit: false }, result);
    assert.equal(routed.systemOne.intents.fix, 0.99);
    assert.equal(Object.hasOwn(routed.systemOne.intents, 'unclassified'), false);
    assert.equal(routed.systemOne.decision.intents.includes('fix'), false);
    assert.equal(routed.systemOne.decision.tier, 'tier2');
    assert.deepEqual(routed.reference.referenceOnlyOptions, [
      { stage: 'intent', id: 'fix', probability: 0.99 }, { stage: 'intent', id: 'unclassified', probability: 0.1 },
      { stage: 'tier', id: 'tier3', probability: 0.99 },
    ]);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test('all --until build uses prepared synthetic stages and stops before training', t => {
  const base = path.join(root, '.s1-work');
  fs.mkdirSync(base, { recursive: true });
  const dir = fs.mkdtempSync(path.join(base, 'cycle-until-build-'));
  const isolation = fs.mkdtempSync(path.join(os.tmpdir(), 'system-one-cycle-all-isolation-'));
  const home = path.join(isolation, 'home');
  const liveStore = path.join(isolation, 'live-observations');
  const sessions = path.join(isolation, 'codex-sessions');
  fs.mkdirSync(home);
  fs.mkdirSync(liveStore);
  fs.mkdirSync(sessions);
  try {
    const fixture = syntheticCycle(dir);
    fs.writeFileSync(path.join(dir, 'cycle-state.json'), JSON.stringify({ schemaVersion: 1, steps: {
      collect: { completedAt: '2026-11-14T00:00:00.000Z' },
      label: { completedAt: '2026-11-14T00:00:00.000Z' },
      judge: { completedAt: '2026-11-14T00:00:00.000Z' },
    } }));
    const result = spawnSync(process.execPath, [path.join(root, 'scripts/system-one-cycle.js'), 'all', '--until', 'build', '--data-dir', dir,
      '--sessions', sessions, '--holdout', fixture.holdout], {
      cwd: root, encoding: 'utf8', env: { ...process.env, HOME: home, USERPROFILE: home,
        CODEX_HOME: path.join(home, '.codex'), HARNESS_STATE_HOME: path.join(home, '.harness-state'), HARNESS_OBSERVATIONS_DIR: liveStore },
    });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout.includes('synthetic-'), false);
    const state = JSON.parse(fs.readFileSync(path.join(dir, 'cycle-state.json'), 'utf8'));
    assert.ok(state.steps.build.completedAt);
    assert.equal(state.steps.train, undefined);
    assert.equal(fs.existsSync(path.join(dir, 'training/runs')), false);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
    fs.rmSync(isolation, { recursive: true, force: true });
  }
});
