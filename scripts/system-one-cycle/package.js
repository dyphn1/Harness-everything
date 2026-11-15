'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { REPO, dataPath, writeJson, assertPrivateDataDir } = require('./common');
const { TASKS } = require('./train');
const { validateVersionManifest } = require('../../harness-everything/scripts/system-one/manifest');

function trainerCatalogs() {
  const trainer = path.join(REPO, 'scripts', 'system-one-train.py');
  const code = 'import importlib.util,json,sys; spec=importlib.util.spec_from_file_location("system_one_train",sys.argv[1]); module=importlib.util.module_from_spec(spec); spec.loader.exec_module(module); print(json.dumps({task:[o["id"] for o in module.catalog_for(task)] for task in ("validity","intent","tier")}))';
  const python = process.env.PYTHON || (process.platform === 'win32' ? 'python' : 'python3');
  const result = spawnSync(python, ['-c', code, trainer], { cwd: REPO, encoding: 'utf8', windowsHide: true });
  if (result.error || result.status !== 0) throw new Error('trainer-catalog-unavailable');
  let catalogs;
  try { catalogs = JSON.parse(result.stdout); } catch { throw new Error('trainer-catalog-invalid'); }
  if (!catalogs || Object.keys(catalogs).sort().join(',') !== [...TASKS].sort().join(',')
      || TASKS.some(task => !Array.isArray(catalogs[task]) || !catalogs[task].length
        || catalogs[task].some(id => typeof id !== 'string')
        || (task !== 'intent' && catalogs[task].includes('unclassified'))
        || new Set(catalogs[task]).size !== catalogs[task].length)) {
    throw new Error('trainer-catalog-invalid');
  }
  return catalogs;
}

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
  const catalogs = trainerCatalogs();
  const target = assertPrivateDataDir(versionDir || dataPath(privateDir, 'training', 'versions', version));
  const source = assertPrivateDataDir(sourceDir ? path.resolve(sourceDir) : dataPath(privateDir, 'training', 'runs', version));
  const sourceManifestPath = path.join(source, 'manifest.json');
  const hasManifest = fs.existsSync(sourceManifestPath);
  const prior = hasManifest ? JSON.parse(fs.readFileSync(sourceManifestPath, 'utf8')) : null;
  if (prior) validateVersionManifest(prior, version);
  const stages = {};

  for (const task of TASKS) {
    let sourceWeights;
    let sourceConfig;
    let options;
    let thresholds;
    let priorReferenceOnly = [];
    let targetWeights = `${task}.safetensors`;
    let targetConfig = `${task}.json`;

    if (prior) {
      const stage = prior.stages?.[task];
      if (!stage || !safeRelative(stage.weights) || !safeRelative(stage.config)) throw new Error(`candidate manifest is missing ${task}`);
      options = catalogs[task];
      const legacyOptions = task === 'intent' ? options.filter(id => id !== 'unclassified') : options;
      if (!Array.isArray(stage.options) || (stage.options.join('\0') !== options.join('\0')
          && stage.options.join('\0') !== legacyOptions.join('\0'))) {
        throw new Error(`${task} checkpoint catalog does not match the trainer catalog`);
      }
      sourceWeights = path.join(source, stage.weights);
      sourceConfig = path.join(source, stage.config);
      thresholds = { ...stage.thresholds };
      priorReferenceOnly = stage.referenceOnly ?? [];
      if (digest(sourceWeights) !== stage.sha256) throw new Error(`${task} checkpoint hash does not match its manifest`);
    } else {
      const runDir = path.join(source, task);
      sourceWeights = path.join(runDir, 'harness-routing-v1.safetensors');
      sourceConfig = path.join(runDir, 'harness-routing-v1.json');
      const calibration = JSON.parse(fs.readFileSync(path.join(runDir, 'calibration.json'), 'utf8'));
      thresholds = calibration.thresholds;
      options = catalogs[task];
    }
    // Older packages omitted this non-selectable intent option; restore its metadata without retraining.
    if (task === 'intent' && options.includes('unclassified') && thresholds && typeof thresholds === 'object'
        && !Array.isArray(thresholds) && !Object.hasOwn(thresholds, 'unclassified')) {
      thresholds = { ...thresholds, unclassified: null };
    }
    if (!Array.isArray(options) || !options.length || new Set(options).size !== options.length
        || !thresholds || Object.keys(thresholds).length !== options.length
        || options.some(id => !Object.hasOwn(thresholds, id))
        || Object.values(thresholds).some(value => value !== null && (!Number.isFinite(value) || value < 0 || value > 1))
        || !Array.isArray(priorReferenceOnly) || priorReferenceOnly.some(id => !options.includes(id))) {
      throw new Error(`${task} calibration has no finite per-option thresholds`);
    }
    // A null threshold means calibration found no cutoff reaching the precision target: the option
    // is reference-only, pinned to 1 so it is never auto-selected while its score is still reported.
    const referenceOnly = options.filter(id => thresholds[id] === null || priorReferenceOnly.includes(id));
    const finalThresholds = Object.fromEntries(options.map(id => [id, thresholds[id] === null ? 1 : thresholds[id]]));
    if (!fs.existsSync(sourceWeights) || !fs.existsSync(sourceConfig)) throw new Error(`${task} checkpoint artifacts are missing`);
    const targetWeightsPath = path.join(target, targetWeights);
    const targetConfigPath = path.join(target, targetConfig);
    if (path.resolve(sourceWeights) !== targetWeightsPath) copy(sourceWeights, targetWeightsPath);
    if (path.resolve(sourceConfig) !== targetConfigPath) copy(sourceConfig, targetConfigPath);
    stages[task] = { weights: targetWeights, config: targetConfig, sha256: digest(targetWeightsPath),
      options: [...options], thresholds: finalThresholds, ...(referenceOnly.length ? { referenceOnly } : {}) };
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
  validateVersionManifest(manifest, version);
  writeJson(path.join(target, 'manifest.json'), manifest);
  return { version, versionDir: target, evaluation };
}

function publishVersion({ dataDir, version }) {
  validateVersion(version);
  const privateDir = assertPrivateDataDir(dataDir);
  const source = dataPath(privateDir, 'training', 'versions', version);
  const target = dataPath(privateDir, 'models', 'cua-s1', version);
  const sourceStat = fs.lstatSync(source);
  const manifestFile = path.join(source, 'manifest.json');
  const manifestStat = fs.lstatSync(manifestFile);
  if (!sourceStat.isDirectory() || sourceStat.isSymbolicLink() || !manifestStat.isFile() || manifestStat.isSymbolicLink()) {
    throw new Error('invalid-package: version directory must contain a regular manifest');
  }
  validateVersionManifest(JSON.parse(fs.readFileSync(manifestFile, 'utf8')), version);
  for (const parent of [path.join(privateDir, 'models'), path.join(privateDir, 'models', 'cua-s1')]) {
    try {
      const stat = fs.lstatSync(parent);
      if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('invalid-publish-dir');
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      fs.mkdirSync(parent, { mode: 0o700 });
    }
  }
  try { fs.lstatSync(target); throw new Error('publish-target-exists'); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  try { fs.cpSync(source, target, { recursive: true, errorOnExist: true, force: false }); }
  catch (error) {
    fs.rmSync(target, { recursive: true, force: true });
    throw error;
  }
  return { version, publishedPath: target };
}

module.exports = { buildVersion, publishVersion, trainerCatalogs, validateVersion, digest, safeRelative };
