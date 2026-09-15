#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const STABLE_SEMVER = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;

const VERSION_TARGETS = [
  { file: 'package.json', get: data => data.version, set: (data, v) => { data.version = v; } },
  {
    file: 'package-lock.json',
    get: data => [data.version, data.packages && data.packages[''] && data.packages[''].version],
    set: (data, v) => {
      if (!data.packages || !data.packages['']) throw new Error('package-lock.json missing packages[""]');
      data.version = v;
      data.packages[''].version = v;
    }
  },
  { file: '.claude-plugin/plugin.json', get: data => data.version, set: (data, v) => { data.version = v; } },
  {
    file: '.claude-plugin/marketplace.json',
    get: data => {
      const entry = Array.isArray(data.plugins) ? data.plugins.find(p => p && p.name === 'harness-everything') : null;
      return entry && entry.version;
    },
    set: (data, v) => {
      const entry = Array.isArray(data.plugins) ? data.plugins.find(p => p && p.name === 'harness-everything') : null;
      if (!entry) throw new Error('.claude-plugin/marketplace.json missing harness-everything plugin entry');
      entry.version = v;
    }
  },
  { file: 'plugins/harness-everything/plugin.json', get: data => data.version, set: (data, v) => { data.version = v; } },
  { file: 'plugins/harness-everything/.codex-plugin/plugin.json', get: data => data.version, set: (data, v) => { data.version = v; } },
  { file: 'opencode-plugin/plugin.json', get: data => data.version, set: (data, v) => { data.version = v; } }
];

function isStableSemVer(version) {
  return STABLE_SEMVER.test(String(version || ''));
}

function readTargets(root) {
  return VERSION_TARGETS.map(target => {
    const filePath = path.join(root, target.file);
    if (!fs.existsSync(filePath)) throw new Error(`Missing release version target: ${target.file}`);
    let data;
    try {
      data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    } catch (error) {
      throw new Error(`Invalid JSON in ${target.file}: ${error.message}`);
    }
    const current = target.get(data);
    if (Array.isArray(current)) {
      if (current.some(value => typeof value !== 'string' || !value)) {
        throw new Error(`${target.file} is missing one or more owned version fields`);
      }
    } else if (typeof current !== 'string' || !current) {
      throw new Error(`${target.file} is missing its owned version field`);
    }
    return { target, filePath, data, current };
  });
}

function syncReleaseVersion(root, version, options = {}) {
  if (!isStableSemVer(version)) {
    throw new Error(`Release version must be stable SemVer x.y.z (no prerelease/build suffix): ${version}`);
  }

  const records = readTargets(root);
  if (options.checkOnly) {
    const mismatches = [];
    for (const record of records) {
      const values = Array.isArray(record.current) ? record.current : [record.current];
      if (values.some(value => value !== version)) {
        mismatches.push(`${record.target.file}: ${values.join(', ')} != ${version}`);
      }
    }
    if (mismatches.length) throw new Error(`Release version drift:\n${mismatches.join('\n')}`);
    return records.map(record => record.target.file);
  }

  // Parse and validate every target before the first write so a malformed or
  // missing manifest cannot leave a half-updated release tree.
  for (const record of records) record.target.set(record.data, version);
  for (const record of records) {
    fs.writeFileSync(record.filePath, `${JSON.stringify(record.data, null, 2)}\n`, 'utf8');
  }
  return records.map(record => record.target.file);
}

function main(argv = process.argv.slice(2)) {
  const mode = argv[0];
  if (mode === '--validate') {
    const version = argv[1];
    if (!isStableSemVer(version)) throw new Error(`Release version must be stable SemVer x.y.z: ${version || '(missing)'}`);
    console.log(`Valid stable release version: ${version}`);
    return;
  }

  const checkOnly = mode === '--check';
  const version = checkOnly ? argv[1] : mode;
  if (!version) throw new Error('Usage: sync-release-version.js [--check|--validate] <x.y.z>');
  const files = syncReleaseVersion(ROOT, version, { checkOnly });
  console.log(`${checkOnly ? 'Verified' : 'Synchronized'} release version ${version} across ${files.length} files.`);
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
}

module.exports = { VERSION_TARGETS, isStableSemVer, syncReleaseVersion };
