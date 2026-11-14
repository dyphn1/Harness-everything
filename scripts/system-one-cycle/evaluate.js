'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { REPO, dataPath, writeJson, assertPrivateDataDir } = require('./common');
const { buildVersion } = require('./package');
const { TASKS } = require('./train');

const HOLDOUTS = { validity: 'system-one-holdout.json', tier: 'system-one-holdout.json', intent: 'system-one-intent-holdout.json' };

function runProcess(command, args) {
  const result = spawnSync(command, args, { cwd: REPO, stdio: 'ignore', windowsHide: true });
  if (result.error || result.status !== 0) throw new Error(`${path.basename(command)} failed${result.status === null ? '' : ` (${result.status})`}`);
}

function pythonExecutable() {
  return process.env.PYTHON || (process.platform === 'win32' ? 'python' : 'python3');
}

function evaluateCycle({ dataDir, version }) {
  const privateDir = assertPrivateDataDir(dataDir);
  const source = dataPath(privateDir, 'training', 'runs', version);
  const versionDir = dataPath(privateDir, 'training', 'candidates', version);
  const evaluationDir = path.join(versionDir, 'evaluation');
  const curvesFile = path.join(evaluationDir, 'curves.json');
  const trendFile = path.join(evaluationDir, 'trend.json');
  if (fs.existsSync(curvesFile) && fs.existsSync(trendFile)) {
    const manifestFile = path.join(versionDir, 'manifest.json');
    const manifest = JSON.parse(fs.readFileSync(manifestFile, 'utf8'));
    manifest.evaluation = 'evaluation/curves.json';
    writeJson(manifestFile, manifest);
    const trend = JSON.parse(fs.readFileSync(trendFile, 'utf8'));
    return { version, verdict: trend.verdict, compared: trend.compared.length, resumed: true };
  }
  const curvesScript = path.join(REPO, 'scripts', 'system-one-curves.js');
  if (!fs.existsSync(curvesScript)) throw new Error('contract C curves CLI is not available in this checkout');
  buildVersion({ dataDir: privateDir, version, sourceDir: source, versionDir });

  fs.mkdirSync(evaluationDir, { recursive: true, mode: 0o700 });
  const scoreScript = path.join(__dirname, 'score.py');
  const holdoutDir = path.join(REPO, 'benchmarks', 'fixtures');
  const curvesArgs = ['--version', version, '--version-dir', versionDir];
  for (const task of TASKS) {
    const heldOut = path.join(holdoutDir, HOLDOUTS[task]);
    const scores = path.join(evaluationDir, `${task}-holdout-scores.jsonl`);
    runProcess(pythonExecutable(), [scoreScript, '--weights', path.join(versionDir, `${task}.safetensors`), '--holdout', heldOut, '--task', task, '--out', scores]);
    curvesArgs.push('--val-scores', `${task}=${path.join(source, task, 'val-scores.jsonl')}`);
    curvesArgs.push('--holdout-scores', `${task}=${scores}`);
  }
  const history = dataPath(privateDir, 'training', 'history.jsonl');
  curvesArgs.push('--history', history, '--out', evaluationDir);
  runProcess(process.execPath, [curvesScript, ...curvesArgs]);

  const manifestFile = path.join(versionDir, 'manifest.json');
  const manifest = JSON.parse(fs.readFileSync(manifestFile, 'utf8'));
  manifest.evaluation = 'evaluation/curves.json';
  writeJson(manifestFile, manifest);
  const trend = JSON.parse(fs.readFileSync(path.join(evaluationDir, 'trend.json'), 'utf8'));
  return { version, verdict: trend.verdict, compared: trend.compared.length };
}

module.exports = { evaluateCycle, HOLDOUTS };
