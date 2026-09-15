#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

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

function readJsonTargets(root) {
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
    return { kind: 'json', target, filePath, data, current };
  });
}

function canonicalSkillDirs(root) {
  const manifestPath = path.join(root, '.claude-plugin', 'plugin.json');
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  if (!Array.isArray(manifest.skills)) throw new Error('.claude-plugin/plugin.json missing skills array');
  return manifest.skills.map(entry => {
    const dir = path.resolve(root, entry);
    const boundary = `${root}${path.sep}`;
    if (dir !== root && !dir.startsWith(boundary)) throw new Error(`Skill path escapes repository: ${entry}`);
    if (!fs.existsSync(path.join(dir, 'SKILL.md'))) throw new Error(`Skill path missing SKILL.md: ${entry}`);
    return { entry, dir, rel: path.relative(root, dir).replace(/\\/g, '/') };
  });
}

function changedSkillDirs(root, base) {
  if (!base) return [];
  const skills = canonicalSkillDirs(root);
  let changed;
  try {
    changed = execFileSync(
      'git',
      ['diff', '--name-only', `${base}...HEAD`, '--', ...skills.map(skill => skill.rel)],
      { cwd: root, encoding: 'utf8' }
    ).split(/\r?\n/).filter(Boolean);
  } catch (error) {
    throw new Error(`Unable to diff changed skills from ${base}: ${String(error.stderr || error.message).trim()}`);
  }
  return skills.filter(skill => changed.some(file => file === skill.rel || file.startsWith(`${skill.rel}/`)));
}

function walkSkillDocs(root, dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walkSkillDocs(root, full, out);
    else if (entry.isFile() && entry.name === 'SKILL.md') out.push(full);
  }
  return out;
}

function readSkillTargets(root, base) {
  const records = [];
  for (const skill of changedSkillDirs(root, base)) {
    for (const filePath of walkSkillDocs(root, skill.dir)) {
      const text = fs.readFileSync(filePath, 'utf8');
      const match = text.match(/^(\s{2}version:\s*)(\S+)(\s*)$/m);
      const rel = path.relative(root, filePath).replace(/\\/g, '/');
      if (!match) throw new Error(`${rel} is missing metadata.version`);
      records.push({
        kind: 'skill',
        file: rel,
        filePath,
        text,
        current: match[2],
        prefix: match[1],
        suffix: match[3]
      });
    }
  }
  return records;
}

function syncReleaseVersion(root, version, options = {}) {
  if (!isStableSemVer(version)) {
    throw new Error(`Release version must be stable SemVer x.y.z (no prerelease/build suffix): ${version}`);
  }

  // Read and validate every target before the first write. This keeps a missing
  // manifest or malformed skill version from leaving a half-updated release tree.
  const jsonRecords = readJsonTargets(root);
  const skillRecords = readSkillTargets(root, options.base);
  const records = [...jsonRecords, ...skillRecords];

  if (options.checkOnly) {
    const mismatches = [];
    for (const record of records) {
      const values = Array.isArray(record.current) ? record.current : [record.current];
      if (values.some(value => value !== version)) {
        const name = record.kind === 'json' ? record.target.file : record.file;
        mismatches.push(`${name}: ${values.join(', ')} != ${version}`);
      }
    }
    if (mismatches.length) throw new Error(`Release version drift:\n${mismatches.join('\n')}`);
    return records.map(record => record.kind === 'json' ? record.target.file : record.file);
  }

  for (const record of jsonRecords) record.target.set(record.data, version);
  for (const record of jsonRecords) {
    fs.writeFileSync(record.filePath, `${JSON.stringify(record.data, null, 2)}\n`, 'utf8');
  }
  for (const record of skillRecords) {
    const next = record.text.replace(
      /^(\s{2}version:\s*)(\S+)(\s*)$/m,
      `$1${version}$3`
    );
    fs.writeFileSync(record.filePath, next, 'utf8');
  }

  return records.map(record => record.kind === 'json' ? record.target.file : record.file);
}

function parseArgs(argv) {
  let checkOnly = false;
  let validateOnly = false;
  let version = null;
  let base = null;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--check') checkOnly = true;
    else if (arg === '--validate') validateOnly = true;
    else if (arg === '--base') {
      base = argv[++i];
      if (!base) throw new Error('--base requires a git ref');
    } else if (!version) version = arg;
    else throw new Error(`Unexpected argument: ${arg}`);
  }
  return { checkOnly, validateOnly, version, base };
}

function main(argv = process.argv.slice(2)) {
  const { checkOnly, validateOnly, version, base } = parseArgs(argv);
  if (!version) throw new Error('Usage: sync-release-version.js [--check|--validate] <x.y.z> [--base <git-ref>]');
  if (validateOnly) {
    if (!isStableSemVer(version)) throw new Error(`Release version must be stable SemVer x.y.z: ${version}`);
    console.log(`Valid stable release version: ${version}`);
    return;
  }
  const files = syncReleaseVersion(ROOT, version, { checkOnly, base });
  const skillNote = base ? ` (changed skills since ${base} included)` : '';
  console.log(`${checkOnly ? 'Verified' : 'Synchronized'} release version ${version} across ${files.length} files${skillNote}.`);
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
}

module.exports = {
  VERSION_TARGETS,
  isStableSemVer,
  canonicalSkillDirs,
  changedSkillDirs,
  syncReleaseVersion
};
