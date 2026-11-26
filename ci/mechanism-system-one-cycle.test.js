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
const cycleCli = path.join(root, 'scripts', 'system-one-cycle.js');
const cycleTrainerCatalogs = {
  validity: ['invalid'],
  intent: CATALOGS.intent.map(option => option.id),
  tier: CATALOGS.tier.map(option => option.id).filter(id => id !== 'unclassified'),
};

function outside(rootDir, target) {
  const relative = path.relative(rootDir, target);
  return relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative);
}

function private446Root(t) {
  const dir = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'system-one-cycle-446-')));
  assert.ok(outside(root, dir), '446 cycle fixtures must live outside the repository');
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

function write446Scorer(dir) {
  const file = path.join(dir, 'sitecustomize.py');
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  fs.writeFileSync(file, [
    '# shortcut: replaces model inference, upgrade when H3 needs model-loading or quality evidence.',
    'import json',
    'import math',
    'import os',
    'import sys',
    `_SCORE_SCRIPT = ${JSON.stringify(path.join(root, 'scripts/system-one-cycle/score.py'))}`,
    "if (sys.argv and os.path.normcase(os.path.realpath(sys.argv[0])) == os.path.normcase(os.path.realpath(_SCORE_SCRIPT)) and os.environ.get('S1_446_FIXTURE') == '1'):",
    '    try:',
    "        required_env = ('S1_446_CATALOGS', 'S1_446_CALL_LOG', 'S1_446_QUALITY')",
    "        if any(name not in os.environ for name in required_env): raise ValueError('fixture scorer environment is incomplete')",
    "        names = ('--weights', '--holdout', '--task', '--out')",
    '        args = sys.argv[1:]',
    "        if len(args) != len(names) * 2: raise ValueError('expected --weights, --holdout, --task, --out exactly once')",
    '        values = {}',
    '        for name, value in zip(args[::2], args[1::2]):',
    "            if name not in names or name in values or not value: raise ValueError('expected --weights, --holdout, --task, --out exactly once')",
    '            values[name] = value',
    "        if set(values) != set(names): raise ValueError('expected --weights, --holdout, --task, --out exactly once')",
    "        if not os.path.isfile(values['--weights']): raise ValueError('fixture scorer weights are unavailable')",
    "        if not os.path.isfile(values['--holdout']): raise ValueError('fixture scorer holdout is unavailable')",
    "        catalogs = json.loads(os.environ['S1_446_CATALOGS'])",
    "        task = values['--task']",
    "        if not isinstance(catalogs, dict) or task not in ('validity', 'intent', 'tier') or not isinstance(catalogs.get(task), list) or not catalogs[task] or any(not isinstance(option, str) or not option for option in catalogs[task]): raise ValueError('fixture scorer catalog is invalid')",
    "        if len(set(catalogs[task])) != len(catalogs[task]): raise ValueError('fixture scorer catalog has duplicate ids')",
    "        quality = float(os.environ['S1_446_QUALITY'])",
    "        if not math.isfinite(quality) or not 0 <= quality <= 1: raise ValueError('fixture scorer quality is invalid')",
    "        gold = 'actionable' if task == 'validity' else ('fix' if task == 'intent' else 'tier2')",
    "        scores = {option: (1 - quality if option == 'invalid' else quality) if task == 'validity' else (quality if option == gold else 0.01) for option in catalogs[task]}",
    "        output = values['--out']",
    "        os.makedirs(os.path.dirname(os.path.abspath(output)), exist_ok=True)",
    "        with open(output, 'w', encoding='utf-8', newline='') as stream: stream.write(json.dumps({'id': 'holdout-' + task, 'gold': gold, 'scores': scores}, separators=(',', ':')) + '\\n')",
    "        with open(os.environ['S1_446_CALL_LOG'], 'a', encoding='utf-8', newline='') as stream: stream.write(task + ':holdout\\n')",
    '    except Exception as error:',
    "        sys.stderr.write('S1_446 fixture scorer: ' + str(error) + '\\n')",
    '        sys.stderr.flush()',
    '        sys.stdout.flush()',
    '        os._exit(2)',
    '    sys.stdout.flush()',
    '    sys.stderr.flush()',
    '    os._exit(0)',
  ].join('\n') + '\n', { encoding: 'utf8', mode: 0o700 });
  return {
    python: process.env.PYTHON || (process.platform === 'win32' ? 'python' : 'python3'),
    pythonPath: dir,
    hook: file,
  };
}

function seed446Candidate(dataDir, version, quality) {
  const runDir = path.join(dataDir, 'training', 'runs', version);
  for (const task of ['validity', 'intent', 'tier']) {
    const stageDir = path.join(runDir, task);
    fs.mkdirSync(stageDir, { recursive: true, mode: 0o700 });
    fs.writeFileSync(path.join(stageDir, 'harness-routing-v1.safetensors'), `synthetic-${version}-${task}`);
    fs.writeFileSync(path.join(stageDir, 'harness-routing-v1.json'), '{}\n');
    fs.writeFileSync(path.join(stageDir, 'train-report.json'), '{}\n');
    fs.writeFileSync(path.join(stageDir, 'resource-guard.json'), JSON.stringify({ exitCode: 0, killedForLimit: false, monitorFailed: false }));
    fs.writeFileSync(path.join(stageDir, 'calibration.json'), JSON.stringify({
      thresholds: Object.fromEntries(cycleTrainerCatalogs[task].map(id => [id, 0.5])),
    }));
    const gold = task === 'validity' ? 'actionable' : task === 'intent' ? 'fix' : 'tier2';
    const scores = Object.fromEntries(cycleTrainerCatalogs[task].map(id => [id,
      task === 'validity' ? (id === 'invalid' ? 1 - quality : quality) : (id === gold ? quality : 0.01)]));
    writeJsonl(path.join(stageDir, 'val-scores.jsonl'), [{ id: `validation-${task}`, gold, scores }]);
  }
}

function setup446Cycle(t, dataDir, versions, { all = false } = {}) {
  const fixture = syntheticCycle(dataDir);
  if (all) {
    const steps = {
      collect: ['training/observed/prompts-observed.jsonl', 'training/observed/labels-observed.jsonl'],
      label: ['training/relabel-luna/labels.jsonl', 'training/relabel-luna/labels-intent.jsonl'],
      judge: ['training/adjudication/input.jsonl', 'training/adjudication/consensus.jsonl'],
    };
    for (const outputs of Object.values(steps)) {
      for (const relative of outputs) {
        const file = path.join(dataDir, relative);
        fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
        if (!fs.existsSync(file)) fs.writeFileSync(file, '');
      }
    }
    fs.writeFileSync(path.join(dataDir, 'cycle-state.json'), JSON.stringify({ schemaVersion: 1,
      steps: Object.fromEntries(Object.entries(steps).map(([step, outputs]) => [step,
        { completedAt: '2026-11-17T00:00:00.000Z', outputs }])) }));
  }
  for (const { version, quality } of versions) seed446Candidate(dataDir, version, quality);
  const tmp = path.dirname(dataDir);
  const callLog = path.join(tmp, 'scorer-calls.log');
  const scorer = write446Scorer(tmp);
  return { dataDir, holdout: fixture.holdout, ...scorer, callLog, tmp };
}

function environment446(fixture, quality = 0.9) {
  const env = {
    ...process.env,
    HOME: path.join(fixture.tmp, 'home'),
    USERPROFILE: path.join(fixture.tmp, 'user-profile'),
    HARNESS_STATE_HOME: path.join(fixture.tmp, 'state'),
    HARNESS_OBSERVATIONS_DIR: path.join(fixture.tmp, 'observations'),
    TMPDIR: fixture.tmp,
    PYTHON: fixture.python,
    PYTHONPATH: fixture.pythonPath,
    PYTHONNOUSERSITE: '1',
    PYTHONDONTWRITEBYTECODE: '1',
    S1_446_FIXTURE: '1',
    S1_446_CATALOGS: JSON.stringify(cycleTrainerCatalogs),
    S1_446_CALL_LOG: fixture.callLog,
    S1_446_QUALITY: String(quality),
  };
  delete env.HARNESS_SYSTEM_ONE_MODE;
  delete env.PYTHONHOME;
  return env;
}

function run446Cycle(fixture, version, { history, quality = 0.9, all = false, preload } = {}) {
  const args = [cycleCli, all ? 'all' : 'evaluate'];
  if (all) args.push('--until', 'evaluate');
  args.push('--data-dir', fixture.dataDir, '--holdout', fixture.holdout, '--version', version);
  if (history === true) args.push('--history');
  else if (history !== undefined) args.push('--history', history);
  const env = environment446(fixture, quality);
  if (preload) env.NODE_OPTIONS = `--require ${JSON.stringify(preload.replaceAll('\\', '/'))}`;
  return spawnSync(process.execPath, args, { cwd: root, encoding: 'utf8', env });
}

function rows446(history) {
  return fs.readFileSync(history, 'utf8').split(/\r?\n/).filter(Boolean).map(JSON.parse);
}

function writeRows446(history, rows, ending = '\n') {
  fs.mkdirSync(path.dirname(history), { recursive: true, mode: 0o700 });
  fs.writeFileSync(history, rows.map(row => JSON.stringify(row)).join('\n') + (rows.length ? ending : ''));
}

function snapshot446(files) {
  return new Map(files.map(file => [file, fs.readFileSync(file)]));
}

function assertSnapshot446(snapshot) {
  for (const [file, bytes] of snapshot) assert.deepEqual(fs.readFileSync(file), bytes, `${file} changed`);
}

function evaluation446(dataDir, version) {
  const dir = path.join(dataDir, 'training', 'candidates', version, 'evaluation');
  return {
    curves: JSON.parse(fs.readFileSync(path.join(dir, 'curves.json'), 'utf8')),
    trend: JSON.parse(fs.readFileSync(path.join(dir, 'trend.json'), 'utf8')),
  };
}

function assertEvaluationNotMarked(dataDir) {
  const stateFile = path.join(dataDir, 'cycle-state.json');
  if (fs.existsSync(stateFile)) assert.equal(JSON.parse(fs.readFileSync(stateFile, 'utf8')).steps?.evaluate, undefined);
}

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

test('446 cross-cycle: A/v0 and B/v1 share history, compare against the first holdout, and promote unchanged quality', t => {
  const tmp = private446Root(t);
  const sharedParent = path.join(tmp, 'shared');
  fs.mkdirSync(sharedParent, { mode: 0o755 });
  if (process.platform !== 'win32') fs.chmodSync(sharedParent, 0o755);
  const history = path.join(sharedParent, 'history', 'private-history.jsonl');
  const monthA = setup446Cycle(t, path.join(tmp, 'month-a'), [{ version: 'v0', quality: 0.9 }], { all: true });
  const monthB = setup446Cycle(t, path.join(tmp, 'month-b'), [{ version: 'v1', quality: 0.9 }], { all: true });

  const a = run446Cycle(monthA, 'v0', { history, quality: 0.9, all: true });
  assert.equal(a.status, 0, a.stderr || a.stdout);
  const b = run446Cycle(monthB, 'v1', { history, quality: 0.9, all: true });
  assert.equal(b.status, 0, b.stderr || b.stdout);

  const { curves, trend } = evaluation446(monthB.dataDir, 'v1');
  assert.equal(curves.floor.detail.status, 'checked',
    `B must use A's shared holdout baseline; got ${curves.floor.detail.status} with ${trend.verdict}`);
  assert.equal(curves.floor.detail.baselineVersion, 'v0');
  for (const stage of Object.values(curves.floor.detail.stages)) {
    assert.equal(stage.baselineVersion, 'v0');
    assert.equal(stage.baselineAvailable, true);
    assert.deepEqual(stage.deltas, { auc: 0, logLoss: 0, ece: 0 });
  }
  assert.equal(trend.verdict, 'promote');
  assert.deepEqual(rows446(history).map(row => row.version), ['v0', 'v1']);
  assert.ok(outside(monthA.dataDir, history));
  assert.ok(outside(monthB.dataDir, history));
  if (process.platform !== 'win32') {
    assert.equal(fs.statSync(sharedParent).mode & 0o777, 0o755, 'an existing shared parent must not be chmodded');
    assert.equal(fs.statSync(path.dirname(history)).mode & 0o777, 0o700);
    assert.equal(fs.statSync(history).mode & 0o777, 0o600);
  }
});

test('446 H3: fixture-selected Python runs commands and intercepts only the production scorer', t => {
  const rootDir = private446Root(t);
  const fixtureDir = path.join(rootDir, 'fixture path with spaces');
  const fixture = setup446Cycle(t, path.join(fixtureDir, 'data'), [{ version: 'h3-v0', quality: 0.9 }], { all: true });
  const env = environment446(fixture);

  const probe = spawnSync(fixture.python, ['-c', "import json,sitecustomize,sys; print(json.dumps({'sentinel':'S1_446_PYTHON_SENTINEL','executable':sys.executable,'version':sys.version.split()[0],'hook':sitecustomize.__file__}))"],
    { cwd: root, encoding: 'utf8', env, windowsHide: true });
  assert.equal(probe.status, 0, probe.stderr);
  const python = JSON.parse(probe.stdout);
  assert.equal(python.sentinel, 'S1_446_PYTHON_SENTINEL', 'fixture-selected executable must execute Python -c');
  assert.ok(path.isAbsolute(python.executable), 'Python must report its actual interpreter path');
  assert.match(python.version, /^\d+\.\d+(?:\.\d+)?$/);
  assert.equal(fs.realpathSync.native(python.hook), path.join(fixture.tmp, 'sitecustomize.py'));
  assert.doesNotMatch(fixture.python, /\.(?:js|cmd)$/i, 'PYTHON must be a real interpreter, not a script wrapper');
  assert.ok(fixture.tmp.includes(' '), 'fixture transport must support paths with spaces');

  const unrelatedDir = path.join(fixture.tmp, 'unrelated');
  fs.mkdirSync(unrelatedDir, { recursive: true });
  const unrelatedScript = path.join(unrelatedDir, 'score.py');
  fs.writeFileSync(unrelatedScript, "print('S1_446_UNRELATED_SCORE')\n", 'utf8');
  const unrelated = spawnSync(fixture.python, [unrelatedScript], { cwd: root, encoding: 'utf8', env, windowsHide: true });
  assert.equal(unrelated.status, 0, unrelated.stderr);
  assert.equal(unrelated.stdout.trim(), 'S1_446_UNRELATED_SCORE', 'an unrelated score.py must run normally');

  const failedCommand = spawnSync(fixture.python, ['-c', 'raise SystemExit(37)'],
    { cwd: root, encoding: 'utf8', env, windowsHide: true });
  assert.equal(failedCommand.status, 37, 'a real failing Python -c command must retain its exit status');

  const result = run446Cycle(fixture, 'h3-v0', { quality: 0.9, all: true });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const versionDir = path.join(fixture.dataDir, 'training', 'candidates', 'h3-v0');
  const manifest = JSON.parse(fs.readFileSync(path.join(versionDir, 'manifest.json'), 'utf8'));
  const evaluationDir = path.join(versionDir, 'evaluation');
  const goldByTask = { validity: 'actionable', intent: 'fix', tier: 'tier2' };
  for (const [task, ids] of Object.entries(cycleTrainerCatalogs)) {
    assert.deepEqual(manifest.stages[task].options, ids, `real trainer catalog for ${task} must match fixture options`);
    const rows = fs.readFileSync(path.join(evaluationDir, `${task}-holdout-scores.jsonl`), 'utf8').trim().split(/\r?\n/).map(JSON.parse);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].id, `holdout-${task}`);
    assert.equal(rows[0].gold, goldByTask[task]);
    assert.deepEqual(Object.keys(rows[0].scores), ids);
  }
  assert.deepEqual(fs.readFileSync(fixture.callLog, 'utf8').trim().split(/\r?\n/), [
    'validity:holdout', 'intent:holdout', 'tier:holdout',
  ]);

  const malformed = spawnSync(fixture.python, [path.join(root, 'scripts/system-one-cycle/score.py'), '--task', 'validity'],
    { cwd: root, encoding: 'utf8', env, windowsHide: true });
  assert.notEqual(malformed.status, 0, 'malformed scorer arguments must fail in the fixture hook');
  assert.match(malformed.stderr, /S1_446 fixture scorer: expected --weights, --holdout, --task, --out/);

  const noHookEnv = { ...env, PYTHONPATH: path.join(fixture.tmp, 'empty-pythonpath') };
  delete noHookEnv.S1_446_CATALOGS;
  delete noHookEnv.S1_446_CALL_LOG;
  delete noHookEnv.S1_446_QUALITY;
  const noHookOutput = path.join(fixture.tmp, 'without-hook.jsonl');
  const noHook = spawnSync(fixture.python, [path.join(root, 'scripts/system-one-cycle/score.py'),
    '--weights', path.join(versionDir, 'validity.safetensors'), '--holdout', path.join(root, 'benchmarks/fixtures/system-one-holdout.json'),
    '--task', 'validity', '--out', noHookOutput], { cwd: root, encoding: 'utf8', env: noHookEnv, windowsHide: true });
  assert.notEqual(noHook.status, 0, 'without scoring interception the fixture scorer smoke path must fail, not skip');
  assert.equal(fs.existsSync(noHookOutput), false);
});

test('446 cross-cycle: cumulative holdout drift stays measured against A/v0 after partial recovery', t => {
  const tmp = private446Root(t);
  const history = path.join(tmp, 'shared', 'private-history.jsonl');
  const monthA = setup446Cycle(t, path.join(tmp, 'month-a'), [{ version: 'v0', quality: 0.9 }], { all: true });
  const monthB = setup446Cycle(t, path.join(tmp, 'month-b'), [
    { version: 'v1', quality: 0.7 }, { version: 'v2', quality: 0.8 },
  ], { all: true });

  for (const [fixture, version, quality] of [[monthA, 'v0', 0.9], [monthB, 'v1', 0.7], [monthB, 'v2', 0.8]]) {
    const result = run446Cycle(fixture, version, { history, quality, all: true });
    assert.equal(result.status, 0, result.stderr || result.stdout);
  }

  const { curves, trend } = evaluation446(monthB.dataDir, 'v2');
  assert.equal(curves.floor.detail.status, 'regression');
  assert.equal(curves.floor.oldHoldoutRegression, true);
  assert.equal(curves.floor.detail.baselineVersion, 'v0');
  assert.ok(Object.values(curves.floor.detail.stages).every(stage => stage.baselineVersion === 'v0'));
  assert.equal(trend.verdict, 'hold');
});

test('446 cross-cycle: four evaluations detect two worsening transitions across A and B directories', t => {
  const tmp = private446Root(t);
  const history = path.join(tmp, 'shared', 'private-history.jsonl');
  const monthA = setup446Cycle(t, path.join(tmp, 'month-a'), [{ version: 'v0', quality: 0.9 }], { all: true });
  const monthB = setup446Cycle(t, path.join(tmp, 'month-b'), [
    { version: 'v1', quality: 0.8 }, { version: 'v2', quality: 0.7 }, { version: 'v3', quality: 0.6 },
  ], { all: true });

  for (const [fixture, version, quality] of [
    [monthA, 'v0', 0.9], [monthB, 'v1', 0.8], [monthB, 'v2', 0.7], [monthB, 'v3', 0.6],
  ]) {
    const result = run446Cycle(fixture, version, { history, quality, all: true });
    assert.equal(result.status, 0, result.stderr || result.stdout);
  }

  const { trend } = evaluation446(monthB.dataDir, 'v3');
  assert.equal(trend.verdict, 'rollback');
  assert.ok(trend.reasons.some(reason => reason.includes('two consecutive cycles (v0 → v1 → v2)')));
  assert.deepEqual(rows446(history).map(row => row.version), ['v0', 'v1', 'v2', 'v3']);
});

test('446 cross-cycle: resume keeps one immutable row, repairs a missing append, and rejects conflicting reuse', t => {
  const tmp = private446Root(t);
  const history = path.join(tmp, 'month-b', 'training', 'history.jsonl');
  const alternateHistory = path.join(tmp, 'alternate', 'private-history.jsonl');
  const monthA = setup446Cycle(t, path.join(tmp, 'month-a'), [{ version: 'v0', quality: 0.9 }], { all: true });
  const monthB = setup446Cycle(t, path.join(tmp, 'month-b'), [{ version: 'v1', quality: 0.9 }], { all: true });
  const a = run446Cycle(monthA, 'v0', { quality: 0.9, all: true });
  assert.equal(a.status, 0, a.stderr || a.stdout);
  const baseline = rows446(path.join(monthA.dataDir, 'training', 'history.jsonl'))[0];
  fs.mkdirSync(path.dirname(history), { recursive: true, mode: 0o700 });
  fs.writeFileSync(history, `${JSON.stringify(baseline)}\n`);
  const b = run446Cycle(monthB, 'v1', { quality: 0.9, all: true });
  assert.equal(b.status, 0, b.stderr || b.stdout);
  const callsBeforeResume = fs.readFileSync(monthB.callLog, 'utf8').trim().split(/\r?\n/).length;
  const original = fs.readFileSync(history, 'utf8');
  const completeResume = run446Cycle(monthB, 'v1', { history, quality: 0.9 });
  assert.equal(completeResume.status, 0, completeResume.stderr || completeResume.stdout);
  assert.equal(fs.readFileSync(history, 'utf8'), original);
  assert.equal(rows446(history).filter(row => row.version === 'v1').length, 1);

  const savedBaseline = rows446(history).find(row => row.version === 'v0');
  fs.writeFileSync(history, `${JSON.stringify(savedBaseline)}\n`);
  fs.mkdirSync(path.dirname(alternateHistory), { recursive: true, mode: 0o700 });
  fs.writeFileSync(alternateHistory, `${JSON.stringify(savedBaseline)}\n`);
  const repaired = run446Cycle(monthB, 'v1', { history: alternateHistory, quality: 0.9 });
  assert.equal(repaired.status, 0, repaired.stderr || repaired.stdout);
  assert.deepEqual(rows446(history).map(row => row.version), ['v0']);
  assert.ok(fs.existsSync(alternateHistory), 'resume must reconcile to the selected alternate history file');
  assert.deepEqual(rows446(alternateHistory).map(row => row.version), ['v0', 'v1']);
  assert.equal(fs.readFileSync(monthB.callLog, 'utf8').trim().split(/\r?\n/).length, callsBeforeResume,
    'resume reconciliation must not rescore');
  const restored = rows446(alternateHistory).find(row => row.version === 'v1');
  assert.deepEqual(restored, evaluation446(monthB.dataDir, 'v1').curves);
  const restoredBytes = fs.readFileSync(alternateHistory, 'utf8');
  const secondResume = run446Cycle(monthB, 'v1', { history: alternateHistory, quality: 0.9 });
  assert.equal(secondResume.status, 0, secondResume.stderr || secondResume.stdout);
  assert.equal(fs.readFileSync(alternateHistory, 'utf8'), restoredBytes);
  assert.equal(rows446(alternateHistory).filter(row => row.version === 'v1').length, 1);

  const conflictingRows = rows446(alternateHistory);
  conflictingRows.find(row => row.version === 'v1').stages.validity.logLoss += 1;
  fs.writeFileSync(alternateHistory, `${conflictingRows.map(row => JSON.stringify(row)).join('\n')}\n`);
  const conflictingBytes = fs.readFileSync(alternateHistory, 'utf8');
  const conflict = run446Cycle(monthB, 'v1', { history: alternateHistory, quality: 0.9 });
  assert.notEqual(conflict.status, 0, 'conflicting reuse of an immutable version must fail');
  assert.equal(fs.readFileSync(alternateHistory, 'utf8'), conflictingBytes, 'conflict must not overwrite history');
  assert.doesNotMatch(conflict.stderr, /synthetic-|holdout-|validation-/);
});

test('446 cross-cycle: default history remains local and explicit history validation fails closed', t => {
  const tmp = private446Root(t);
  const local = setup446Cycle(t, path.join(tmp, 'default-cycle'), [{ version: 'default-v0', quality: 0.9 }]);
  const defaultRun = run446Cycle(local, 'default-v0', { quality: 0.9 });
  assert.equal(defaultRun.status, 0, defaultRun.stderr || defaultRun.stdout);
  const defaultHistory = path.join(local.dataDir, 'training', 'history.jsonl');
  assert.deepEqual(rows446(defaultHistory).map(row => row.version), ['default-v0']);

  const bare = setup446Cycle(t, path.join(tmp, 'bare-cycle'), [{ version: 'bare-v0', quality: 0.9 }]);
  const bareResult = run446Cycle(bare, 'bare-v0', { history: true, quality: 0.9 });
  assert.notEqual(bareResult.status, 0, 'bare --history must be rejected');
  assertEvaluationNotMarked(bare.dataDir);

  const repositoryPath = setup446Cycle(t, path.join(tmp, 'repository-cycle'), [{ version: 'repo-v0', quality: 0.9 }]);
  const repoResult = run446Cycle(repositoryPath, 'repo-v0', { history: path.join(root, 'docs/system-one-cycle.md'), quality: 0.9 });
  assert.notEqual(repoResult.status, 0, 'repository-contained history must be rejected');
  assert.equal(fs.existsSync(path.join(repositoryPath.dataDir, 'cycle-state.json')), false);

  const directory = path.join(tmp, 'history-is-directory');
  fs.mkdirSync(directory);
  const directoryFixture = setup446Cycle(t, path.join(tmp, 'directory-cycle'), [{ version: 'directory-v0', quality: 0.9 }]);
  const directoryResult = run446Cycle(directoryFixture, 'directory-v0', { history: directory, quality: 0.9 });
  assert.notEqual(directoryResult.status, 0, 'history destinations must be files, not directories');
  assert.equal(fs.existsSync(path.join(directoryFixture.dataDir, 'cycle-state.json')), false);

  const symlink = path.join(tmp, 'history-symlink.jsonl');
  try { fs.symlinkSync(path.join(root, 'docs/system-one-cycle.md'), symlink); }
  catch (error) {
    if (!['EACCES', 'EPERM', 'ENOSYS', 'ENOTSUP'].includes(error.code)) throw error;
    t.diagnostic(`symlink path leg unavailable: ${error.code}; direct repository-path control ran`);
  }
  if (fs.existsSync(symlink)) {
    const symlinkFixture = setup446Cycle(t, path.join(tmp, 'symlink-cycle'), [{ version: 'symlink-v0', quality: 0.9 }]);
    const symlinkResult = run446Cycle(symlinkFixture, 'symlink-v0', { history: symlink, quality: 0.9 });
    assert.notEqual(symlinkResult.status, 0, 'symlink resolving into the repository must be rejected');
    assert.equal(fs.existsSync(path.join(symlinkFixture.dataDir, 'cycle-state.json')), false);
  }

  const malformed = setup446Cycle(t, path.join(tmp, 'malformed-cycle'), [{ version: 'malformed-v0', quality: 0.9 }]);
  const malformedHistory = path.join(tmp, 'malformed-history.jsonl');
  fs.writeFileSync(malformedHistory, 'PRIVATE_SCORE_SENTINEL {not-json}\n');
  const malformedResult = run446Cycle(malformed, 'malformed-v0', { history: malformedHistory, quality: 0.9 });
  assert.notEqual(malformedResult.status, 0, 'malformed history must not bootstrap as empty');
  assert.doesNotMatch(malformedResult.stderr, /PRIVATE_SCORE_SENTINEL/);
  assert.equal(fs.existsSync(path.join(malformed.dataDir, 'cycle-state.json')), false);

  const appendFailure = setup446Cycle(t, path.join(tmp, 'append-failure-cycle'), [{ version: 'append-v0', quality: 0.9 }]);
  const parentFile = path.join(tmp, 'not-a-directory');
  fs.writeFileSync(parentFile, 'fixture');
  const failedHistory = run446Cycle(appendFailure, 'append-v0', {
    history: path.join(parentFile, 'private-history.jsonl'), quality: 0.9,
  });
  assert.notEqual(failedHistory.status, 0, 'history append failure must fail evaluation');
  assert.equal(fs.existsSync(path.join(appendFailure.dataDir, 'cycle-state.json')), false);
});

test('443 R6: resumes after an interrupted history append exactly once', t => {
  const tmp = private446Root(t);
  const history = path.join(tmp, 'history.jsonl');
  const version = 'v1';
  const fixture = setup446Cycle(t, path.join(tmp, 'cycle'), [
    { version: 'v0', quality: 0.9 }, { version, quality: 0.9 },
  ]);
  assert.equal(run446Cycle(fixture, 'v0', { history }).status, 0);
  const prefix = fs.readFileSync(history, 'utf8');
  const preload = path.join(tmp, 'fail-history-append.cjs');
  fs.writeFileSync(preload, `
    const fs = require('node:fs');
    const append = fs.appendFileSync;
    fs.appendFileSync = (file, ...args) => {
      if (file === ${JSON.stringify(fs.realpathSync.native(history))}) throw new Error('injected history append failure');
      return append(file, ...args);
    };
  `);

  const interrupted = run446Cycle(fixture, version, { history, preload });
  assert.notEqual(interrupted.status, 0);
  const candidate = path.join(fixture.dataDir, 'training', 'candidates', version);
  const manifest = path.join(candidate, 'manifest.json');
  const evaluationFiles = snapshot446(['curves.json', 'trend.json'].map(file =>
    path.join(candidate, 'evaluation', file)));
  assert.equal(fs.readFileSync(history, 'utf8'), prefix);
  assert.equal(JSON.parse(fs.readFileSync(manifest, 'utf8')).evaluation, null);
  const callsAfterFailure = fs.readFileSync(fixture.callLog, 'utf8');

  const resumed = run446Cycle(fixture, version, { history });
  assert.equal(resumed.status, 0, resumed.stderr || resumed.stdout);
  assert.equal(JSON.parse(resumed.stdout).steps[0].resumed, true);
  assert.equal(JSON.parse(fs.readFileSync(manifest, 'utf8')).evaluation, 'evaluation/curves.json');
  const restored = fs.readFileSync(history, 'utf8');
  assert.equal(restored, prefix + JSON.stringify(evaluation446(fixture.dataDir, version).curves) + '\n');

  const repeated = run446Cycle(fixture, version, { history });
  assert.equal(repeated.status, 0, repeated.stderr || repeated.stdout);
  assert.equal(fs.readFileSync(history, 'utf8'), restored);
  assert.equal(fs.readFileSync(fixture.callLog, 'utf8'), callsAfterFailure);
  assertSnapshot446(evaluationFiles);
});

test('446 H2: rejects changed same-id baseline before append, including an existing identical candidate', t => {
  const tmp = private446Root(t);
  const originalHistory = path.join(tmp, 'original-history.jsonl');
  const absentHistory = path.join(tmp, 'alternate-absent.jsonl');
  const presentHistory = path.join(tmp, 'alternate-present.jsonl');
  const monthA = setup446Cycle(t, path.join(tmp, 'month-a'), [{ version: 'v0', quality: 0.8 }], { all: true });
  const monthB = setup446Cycle(t, path.join(tmp, 'month-b'), [{ version: 'v1', quality: 0.9 }], { all: true });
  assert.equal(run446Cycle(monthA, 'v0', { history: originalHistory, quality: 0.8, all: true }).status, 0);
  assert.equal(run446Cycle(monthB, 'v1', { history: originalHistory, quality: 0.9, all: true }).status, 0);
  const candidate = rows446(originalHistory).find(row => row.version === 'v1');

  const alternateA = setup446Cycle(t, path.join(tmp, 'alternate-a'), [{ version: 'v0', quality: 0.99 }], { all: true });
  assert.equal(run446Cycle(alternateA, 'v0', { history: absentHistory, quality: 0.99, all: true }).status, 0);
  const alternateBaseline = rows446(absentHistory)[0];
  writeRows446(absentHistory, [alternateBaseline]);
  const stateFile = path.join(monthB.dataDir, 'cycle-state.json');
  const paths = [absentHistory, ...['curves.json', 'trend.json'].map(file =>
    path.join(monthB.dataDir, 'training', 'candidates', 'v1', 'evaluation', file)),
  path.join(monthB.dataDir, 'training', 'candidates', 'v1', 'manifest.json'),
  stateFile, monthB.callLog];
  const beforeAbsent = snapshot446(paths);
  const absent = run446Cycle(monthB, 'v1', { history: absentHistory, quality: 0.9 });
  assert.notEqual(absent.status, 0, 'a cached promotion must reject a changed same-id baseline');
  assertSnapshot446(beforeAbsent);
  assert.doesNotMatch(`${absent.stdout}\n${absent.stderr}`, /0\.99|synthetic-|holdout-|validation-/);

  const freshHistory = path.join(tmp, 'fresh-diagnostic.jsonl');
  writeRows446(freshHistory, [alternateBaseline]);
  const freshB = setup446Cycle(t, path.join(tmp, 'fresh-b'), [{ version: 'v1', quality: 0.9 }], { all: true });
  assert.equal(run446Cycle(freshB, 'v1', { history: freshHistory, quality: 0.9, all: true }).status, 0);
  assert.equal(evaluation446(freshB.dataDir, 'v1').curves.floor.detail.status, 'regression');
  assert.equal(evaluation446(freshB.dataDir, 'v1').trend.verdict, 'hold');

  writeRows446(presentHistory, [alternateBaseline, candidate]);
  const beforePresent = snapshot446([...paths.filter(file => file !== absentHistory), presentHistory]);
  const present = run446Cycle(monthB, 'v1', { history: presentHistory, quality: 0.9 });
  assert.notEqual(present.status, 0, 'an identical candidate row must not bypass baseline validation');
  assertSnapshot446(beforePresent);
  assert.doesNotMatch(`${present.stdout}\n${present.stderr}`, /0\.99|synthetic-|holdout-|validation-/);

  const matching = fs.readFileSync(originalHistory, 'utf8');
  const matchingResume = run446Cycle(monthB, 'v1', { history: originalHistory, quality: 0.9 });
  assert.equal(matchingResume.status, 0, matchingResume.stderr || matchingResume.stdout);
  assert.equal(fs.readFileSync(originalHistory, 'utf8'), matching, 'matching history resume stays byte-stable');
});

test('446 H2: rejects stale predecessor metrics and reordered trend rows before writes', t => {
  const tmp = private446Root(t);
  const originalHistory = path.join(tmp, 'original-history.jsonl');
  const monthA = setup446Cycle(t, path.join(tmp, 'month-a'), [{ version: 'v0', quality: 0.9 }], { all: true });
  const monthB = setup446Cycle(t, path.join(tmp, 'month-b'), [
    { version: 'v1', quality: 0.8 }, { version: 'v2', quality: 0.7 }, { version: 'v3', quality: 0.6 },
  ], { all: true });
  for (const [fixture, version, quality] of [
    [monthA, 'v0', 0.9], [monthB, 'v1', 0.8], [monthB, 'v2', 0.7], [monthB, 'v3', 0.6],
  ]) assert.equal(run446Cycle(fixture, version, { history: originalHistory, quality, all: true }).status, 0);
  assert.equal(evaluation446(monthB.dataDir, 'v3').trend.verdict, 'rollback');

  const changedHistory = path.join(tmp, 'changed-prior-history.jsonl');
  const changedB = setup446Cycle(t, path.join(tmp, 'changed-b'), [
    { version: 'v1', quality: 0.8 }, { version: 'v2', quality: 0.9 },
  ], { all: true });
  const changedA = setup446Cycle(t, path.join(tmp, 'changed-a'), [{ version: 'v0', quality: 0.9 }], { all: true });
  assert.equal(run446Cycle(changedA, 'v0', { history: changedHistory, quality: 0.9, all: true }).status, 0);
  assert.equal(run446Cycle(changedB, 'v1', { history: changedHistory, quality: 0.8, all: true }).status, 0);
  assert.equal(run446Cycle(changedB, 'v2', { history: changedHistory, quality: 0.9, all: true }).status, 0);
  const changedBytes = fs.readFileSync(changedHistory, 'utf8');
  const changedPaths = [changedHistory,
    path.join(monthB.dataDir, 'training', 'candidates', 'v3', 'evaluation', 'curves.json'),
    path.join(monthB.dataDir, 'training', 'candidates', 'v3', 'evaluation', 'trend.json'),
    path.join(monthB.dataDir, 'training', 'candidates', 'v3', 'manifest.json'),
    path.join(monthB.dataDir, 'cycle-state.json'), monthB.callLog];
  const changedBefore = snapshot446(changedPaths);
  const changed = run446Cycle(monthB, 'v3', { history: changedHistory, quality: 0.6 });
  assert.notEqual(changed.status, 0, 'same baseline with changed prior comparison rows must reject a stale rollback');
  assertSnapshot446(changedBefore);
  assert.equal(fs.readFileSync(changedHistory, 'utf8'), changedBytes);

  const reorderedHistory = path.join(tmp, 'reordered-history.jsonl');
  writeRows446(reorderedHistory, [rows446(originalHistory)[0], rows446(originalHistory)[2], rows446(originalHistory)[1]]);
  const reorderedBytes = fs.readFileSync(reorderedHistory, 'utf8');
  const reordered = run446Cycle(monthB, 'v3', { history: reorderedHistory, quality: 0.6 });
  assert.notEqual(reordered.status, 0, 'saved predecessor ids must retain their original order');
  assert.equal(fs.readFileSync(reorderedHistory, 'utf8'), reorderedBytes);
});

test('446 H2: resumes bootstrap and older candidates against their original predecessor prefixes', t => {
  const tmp = private446Root(t);
  const history = path.join(tmp, 'shared-history.jsonl');
  const monthA = setup446Cycle(t, path.join(tmp, 'month-a'), [{ version: 'v0', quality: 0.9 }], { all: true });
  const monthB = setup446Cycle(t, path.join(tmp, 'month-b'), [
    { version: 'v1', quality: 0.9 }, { version: 'v2', quality: 0.9 },
  ], { all: true });
  for (const [fixture, version] of [[monthA, 'v0'], [monthB, 'v1'], [monthB, 'v2']]) {
    const result = run446Cycle(fixture, version, { history, quality: 0.9, all: true });
    assert.equal(result.status, 0, result.stderr || result.stdout);
  }
  const original = fs.readFileSync(history, 'utf8');
  const callsBefore = fs.readFileSync(monthB.callLog, 'utf8');
  const bootstrap = evaluation446(monthA.dataDir, 'v0');
  assert.equal(bootstrap.trend.verdict, 'hold');
  assert.equal(run446Cycle(monthA, 'v0', { history, quality: 0.9 }).status, 0);
  const older = evaluation446(monthB.dataDir, 'v1');
  assert.equal(run446Cycle(monthB, 'v1', { history, quality: 0.9 }).status, 0);
  assert.deepEqual(evaluation446(monthB.dataDir, 'v1').trend, older.trend);
  assert.equal(fs.readFileSync(history, 'utf8'), original);
  assert.equal(fs.readFileSync(monthB.callLog, 'utf8'), callsBefore, 'resume must not rescore');
});

test('446 H2: fresh append separates a valid history without LF and the next evaluation reads it', t => {
  const tmp = private446Root(t);
  const history = path.join(tmp, 'shared-history.jsonl');
  const monthA = setup446Cycle(t, path.join(tmp, 'month-a'), [{ version: 'v0', quality: 0.9 }], { all: true });
  const monthB = setup446Cycle(t, path.join(tmp, 'month-b'), [
    { version: 'v1', quality: 0.9 }, { version: 'v2', quality: 0.9 },
  ], { all: true });
  assert.equal(run446Cycle(monthA, 'v0', { history, quality: 0.9, all: true }).status, 0);
  const original = fs.readFileSync(history, 'utf8');
  assert.ok(original.endsWith('\n'));
  const prefix = original.slice(0, -1);
  fs.writeFileSync(history, prefix);

  const firstAppend = run446Cycle(monthB, 'v1', { history, quality: 0.9, all: true });
  assert.equal(firstAppend.status, 0, firstAppend.stderr || firstAppend.stdout);
  const afterFirst = fs.readFileSync(history, 'utf8');
  assert.ok(afterFirst.startsWith(prefix), 'the original history bytes must remain a prefix');
  assert.ok(afterFirst.slice(prefix.length).startsWith('\n{'), 'append must restore the missing JSONL separator');
  assert.deepEqual(rows446(history).map(row => row.version), ['v0', 'v1']);

  const secondAppend = run446Cycle(monthB, 'v2', { history, quality: 0.9, all: true });
  assert.equal(secondAppend.status, 0, secondAppend.stderr || secondAppend.stdout);
  assert.deepEqual(rows446(history).map(row => row.version), ['v0', 'v1', 'v2']);
});

test('446 H2: missing-append resume repairs no-LF once; duplicate and conflict no-ops preserve bytes', t => {
  const tmp = private446Root(t);
  const sourceHistory = path.join(tmp, 'source-history.jsonl');
  const alternateHistory = path.join(tmp, 'alternate-history.jsonl');
  const monthA = setup446Cycle(t, path.join(tmp, 'month-a'), [{ version: 'v0', quality: 0.9 }], { all: true });
  const monthB = setup446Cycle(t, path.join(tmp, 'month-b'), [{ version: 'v1', quality: 0.9 }], { all: true });
  assert.equal(run446Cycle(monthA, 'v0', { history: sourceHistory, quality: 0.9, all: true }).status, 0);
  assert.equal(run446Cycle(monthB, 'v1', { history: sourceHistory, quality: 0.9, all: true }).status, 0);
  const baseline = rows446(sourceHistory)[0];
  writeRows446(alternateHistory, [baseline], '');
  const callsBefore = fs.readFileSync(monthB.callLog, 'utf8');

  const resume = run446Cycle(monthB, 'v1', { history: alternateHistory, quality: 0.9 });
  assert.equal(resume.status, 0, resume.stderr || resume.stdout);
  let bytes = fs.readFileSync(alternateHistory, 'utf8');
  assert.ok(bytes.startsWith(JSON.stringify(baseline)));
  assert.ok(bytes.slice(JSON.stringify(baseline).length).startsWith('\n{'), 'resume append must restore its missing separator');
  assert.deepEqual(rows446(alternateHistory).map(row => row.version), ['v0', 'v1']);
  assert.equal(fs.readFileSync(monthB.callLog, 'utf8'), callsBefore, 'cached resume must not rescore');

  fs.writeFileSync(alternateHistory, bytes.slice(0, -1));
  const noFinalLf = fs.readFileSync(alternateHistory, 'utf8');
  const duplicate = run446Cycle(monthB, 'v1', { history: alternateHistory, quality: 0.9 });
  assert.equal(duplicate.status, 0, duplicate.stderr || duplicate.stdout);
  assert.equal(fs.readFileSync(alternateHistory, 'utf8'), noFinalLf, 'deduplication must not normalize a no-op');

  const timestampRows = rows446(alternateHistory);
  timestampRows.find(row => row.version === 'v1').createdAt = '2026-11-17T00:00:00.000Z';
  writeRows446(alternateHistory, timestampRows, '');
  const timestampBytes = fs.readFileSync(alternateHistory, 'utf8');
  const timestampResume = run446Cycle(monthB, 'v1', { history: alternateHistory, quality: 0.9 });
  assert.equal(timestampResume.status, 0, timestampResume.stderr || timestampResume.stdout);
  assert.equal(fs.readFileSync(alternateHistory, 'utf8'), timestampBytes, 'timestamp-only identity remains a byte-stable no-op');

  const conflictingRows = rows446(alternateHistory);
  conflictingRows.find(row => row.version === 'v1').stages.validity.logLoss += 1;
  writeRows446(alternateHistory, conflictingRows, '');
  const conflictBytes = fs.readFileSync(alternateHistory, 'utf8');
  const conflict = run446Cycle(monthB, 'v1', { history: alternateHistory, quality: 0.9 });
  assert.notEqual(conflict.status, 0, 'conflicting duplicate must reject');
  assert.equal(fs.readFileSync(alternateHistory, 'utf8'), conflictBytes, 'rejection must not normalize history');
});
