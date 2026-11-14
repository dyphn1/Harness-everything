'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { dataPath, writeJson, assertPrivateDataDir } = require('./common');
const { TASKS } = require('./train');
const { CATALOGS } = require('../../harness-everything/scripts/system-one/catalogs');

const OPTIONS = {
  validity: ['invalid'],
  intent: CATALOGS.intent.map(option => option.id),
  tier: ['tier1', 'tier2', 'tier3'],
};

function validateVersion(version) {
  if (typeof version !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(version)) throw new Error('invalid --version');
  return version;
}

function digest(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function copy(source, target) {
  fs.mkdirSync(path.dirname(target), { recursive: true, mode: 0o700 });
  fs.copyFileSync(source, target);
  if (process.platform !== 'win32') fs.chmodSync(target, 0o600);
}

function safeRelative(value) {
  return typeof value === 'string' && value.length > 0 && !path.isAbsolute(value)
    && !value.split(/[\\/]/).some(part => part === '..' || part === '.');
}

function buildVersion({ dataDir, version, versionDir, sourceDir }) {
  validateVersion(version);
  const privateDir = assertPrivateDataDir(dataDir);
  const target = assertPrivateDataDir(versionDir || dataPath(privateDir, 'training', 'versions', version));
  const source = assertPrivateDataDir(sourceDir ? path.resolve(sourceDir) : dataPath(privateDir, 'training', 'runs', version));
  const sourceManifestPath = path.join(source, 'manifest.json');
  const hasManifest = fs.existsSync(sourceManifestPath);
  const prior = hasManifest ? JSON.parse(fs.readFileSync(sourceManifestPath, 'utf8')) : null;
  if (prior && (prior.schemaVersion !== 1 || prior.version !== version || !prior.stages || typeof prior.stages !== 'object')) {
    throw new Error('candidate manifest does not match the requested version');
  }
  const stages = {};

  for (const task of TASKS) {
    let sourceWeights;
    let sourceConfig;
    let options;
    let thresholds;
    let targetWeights = `${task}.safetensors`;
    let targetConfig = `${task}.json`;

    if (prior) {
      const stage = prior.stages?.[task];
      if (!stage || !safeRelative(stage.weights) || !safeRelative(stage.config)) throw new Error(`candidate manifest is missing ${task}`);
      sourceWeights = path.join(source, stage.weights);
      sourceConfig = path.join(source, stage.config);
      options = stage.options;
      thresholds = stage.thresholds;
      if (digest(sourceWeights) !== stage.sha256) throw new Error(`${task} checkpoint hash does not match its manifest`);
    } else {
      const runDir = path.join(source, task);
      sourceWeights = path.join(runDir, 'harness-routing-v1.safetensors');
      sourceConfig = path.join(runDir, 'harness-routing-v1.json');
      const calibration = JSON.parse(fs.readFileSync(path.join(runDir, 'calibration.json'), 'utf8'));
      thresholds = calibration.thresholds;
      options = OPTIONS[task];
    }
    if (!Array.isArray(options) || !options.length || new Set(options).size !== options.length
        || !thresholds || Object.keys(thresholds).some(id => !options.includes(id))
        || Object.values(thresholds).some(value => !Number.isFinite(value))) {
      throw new Error(`${task} calibration has no finite per-option thresholds`);
    }
    if (!fs.existsSync(sourceWeights) || !fs.existsSync(sourceConfig)) throw new Error(`${task} checkpoint artifacts are missing`);
    const targetWeightsPath = path.join(target, targetWeights);
    const targetConfigPath = path.join(target, targetConfig);
    if (path.resolve(sourceWeights) !== targetWeightsPath) copy(sourceWeights, targetWeightsPath);
    if (path.resolve(sourceConfig) !== targetConfigPath) copy(sourceConfig, targetConfigPath);
    stages[task] = { weights: targetWeights, config: targetConfig, sha256: digest(targetWeightsPath),
      options: [...options], thresholds: { ...thresholds } };
  }

  const sourceEvaluation = path.join(source, 'evaluation');
  const targetEvaluation = path.join(target, 'evaluation');
  let evaluation = null;
  if (fs.existsSync(path.join(sourceEvaluation, 'curves.json'))) {
    fs.mkdirSync(targetEvaluation, { recursive: true, mode: 0o700 });
    for (const file of ['curves.json', 'trend.json']) {
      const from = path.join(sourceEvaluation, file);
      if (fs.existsSync(from) && path.resolve(from) !== path.join(targetEvaluation, file)) copy(from, path.join(targetEvaluation, file));
    }
    evaluation = 'evaluation/curves.json';
  } else if (prior?.evaluation !== null && prior?.evaluation !== undefined) {
    if (!safeRelative(prior.evaluation) || !fs.existsSync(path.join(source, prior.evaluation))) throw new Error('candidate evaluation artifact is missing');
    const relative = prior.evaluation.split(/[\\/]/).join(path.sep);
    const from = path.join(source, relative);
    const to = path.join(target, relative);
    if (path.resolve(from) !== to) copy(from, to);
    evaluation = relative.split(path.sep).join('/');
  }

  const manifest = { schemaVersion: 1, version, createdAt: prior?.createdAt || new Date().toISOString(), stages, evaluation };
  writeJson(path.join(target, 'manifest.json'), manifest);
  return { version, versionDir: target, evaluation };
}

module.exports = { buildVersion, validateVersion, digest, safeRelative };
