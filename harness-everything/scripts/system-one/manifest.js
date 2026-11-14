'use strict';

const fs = require('node:fs');
const path = require('node:path');

const STAGES = ['validity', 'intent', 'tier'];
const SAFE_ID = /^[a-z0-9._-]{1,80}$/;
const HASH = /^[a-f0-9]{64}$/;
const VERSION = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const SAFE_PATH_PART = /^[A-Za-z0-9._-]+$/;
const exact = (value, keys) => value && typeof value === 'object' && !Array.isArray(value)
  && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));

function safeRelative(value) {
  return typeof value === 'string' && value.length > 0 && !value.includes('\\')
    && !path.posix.isAbsolute(value) && !path.win32.isAbsolute(value)
    && value.split('/').every(part => SAFE_PATH_PART.test(part) && part !== '.' && part !== '..');
}

function validateVersionManifest(manifest, expectedVersion) {
  const fail = detail => { throw new TypeError(`invalid-manifest: ${detail}`); };
  if (!exact(manifest, ['schemaVersion', 'version', 'createdAt', 'stages', 'evaluation'])
      || manifest.schemaVersion !== 1 || typeof manifest.version !== 'string' || !VERSION.test(manifest.version)
      || (expectedVersion !== undefined && manifest.version !== expectedVersion)
      || typeof manifest.createdAt !== 'string' || !Number.isFinite(Date.parse(manifest.createdAt))
      || !exact(manifest.stages, STAGES)
      || !(manifest.evaluation === null || safeRelative(manifest.evaluation))) fail('invalid version manifest');

  for (const name of STAGES) {
    const stage = manifest.stages[name];
    const fields = ['weights', 'config', 'sha256', 'options', 'thresholds'];
    if (!(exact(stage, fields) || exact(stage, [...fields, 'referenceOnly']))
        || !safeRelative(stage.weights) || !safeRelative(stage.config) || !HASH.test(stage.sha256)
        || !Array.isArray(stage.options) || !stage.options.length
        || stage.options.some(id => typeof id !== 'string' || !SAFE_ID.test(id)
          || (id === 'unclassified' && name !== 'intent'))
        || new Set(stage.options).size !== stage.options.length || !exact(stage.thresholds, stage.options)
        || Object.values(stage.thresholds).some(value => typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1)) {
      fail(`malformed ${name} stage`);
    }
    if (Object.hasOwn(stage, 'referenceOnly')
        && (!Array.isArray(stage.referenceOnly) || new Set(stage.referenceOnly).size !== stage.referenceOnly.length
          || stage.referenceOnly.some(id => !stage.options.includes(id) || stage.thresholds[id] !== 1))) {
      fail(`malformed ${name} referenceOnly`);
    }
  }
  return manifest;
}

if (require.main === module) {
  try {
    const file = process.argv[2];
    const source = file ? fs.readFileSync(file, 'utf8') : fs.readFileSync(0, 'utf8');
    validateVersionManifest(JSON.parse(source));
  } catch (_) { process.exitCode = 1; }
}

module.exports = { STAGES, validateVersionManifest };
