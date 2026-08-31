#!/usr/bin/env node
/**
 * Verify a Harness installation against this package source.
 *
 * The install manifest records where Harness copied each skill. This command
 * checks its package version, every recorded skill, and the complete file
 * tree, so an old install is reported as stale instead of looking healthy.
 */

const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { getWorkspaceRoot } = require('./lib/workspace');
const manifest = require('./lib/manifest');

const sourceRoot = path.resolve(__dirname, '..');
const packageVersion = require(path.join(sourceRoot, 'package.json')).version;
const userHome = os.homedir();

function fileTreeHash(root) {
  if (!fs.existsSync(root)) return null;
  const files = [];
  function walk(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.isFile()) files.push(path.relative(root, full).replace(/\\/g, '/') + ':' + crypto.createHash('sha256').update(fs.readFileSync(full)).digest('hex'));
    }
  }
  walk(root);
  return crypto.createHash('sha256').update(files.sort().join('\n')).digest('hex');
}

function availableSkills() {
  return new Set(fs.readdirSync(sourceRoot, { withFileTypes: true })
    .filter(entry => entry.isDirectory() && fs.existsSync(path.join(sourceRoot, entry.name, 'SKILL.md')))
    .map(entry => entry.name));
}

function isHarnessSkill(dir) {
  const skillMd = path.join(dir, 'SKILL.md');
  if (!fs.existsSync(skillMd)) return false;
  const raw = fs.readFileSync(skillMd, 'utf8');
  return /(?:^|\n)\s*author:\s*["']?Miya Daniel["']?/m.test(raw);
}

function verifyManifest(manifestPath, expectedSkillRoot) {
  const failures = [];
  if (!fs.existsSync(manifestPath)) {
    const known = availableSkills();
    const legacy = expectedSkillRoot && fs.existsSync(expectedSkillRoot)
      ? fs.readdirSync(expectedSkillRoot, { withFileTypes: true })
        .filter(entry => entry.isDirectory() && known.has(entry.name) && isHarnessSkill(path.join(expectedSkillRoot, entry.name)))
        .map(entry => entry.name)
      : [];
    if (!legacy.length) return { checked: false, failures };
    failures.push(`STALE untracked installation: ${legacy.length} Harness skill copy/copies have no manifest`);
    for (const id of legacy) {
      if (fileTreeHash(path.join(sourceRoot, id)) !== fileTreeHash(path.join(expectedSkillRoot, id))) {
        failures.push(`STALE tree: ${id} differs from source`);
      }
    }
    return { checked: true, failures };
  }
  const data = manifest.readManifest(manifestPath);
  if (data.package !== manifest.PACKAGE_NAME) failures.push(`manifest package is ${data.package || '(missing)'}`);
  if (data.version !== packageVersion) failures.push(`STALE version: installed ${data.version || '(missing)'}, source ${packageVersion}`);
  const known = availableSkills();
  const recordedPaths = new Set();
  for (const entry of data.skills || []) {
    const dir = entry.dirPath;
    recordedPaths.add(path.resolve(dir || ''));
    if (!entry.id || !known.has(entry.id)) {
      failures.push(`unknown or removed skill in manifest: ${entry.id || '(missing id)'}`);
      continue;
    }
    if (!dir || !fs.existsSync(dir)) {
      failures.push(`missing installed skill: ${entry.id}`);
      continue;
    }
    const sourceHash = fileTreeHash(path.join(sourceRoot, entry.id));
    const installedHash = fileTreeHash(dir);
    if (sourceHash !== installedHash) failures.push(`STALE tree: ${entry.id} differs from source`);
  }
  if (expectedSkillRoot && fs.existsSync(expectedSkillRoot)) {
    for (const entry of fs.readdirSync(expectedSkillRoot, { withFileTypes: true })) {
      const dir = path.join(expectedSkillRoot, entry.name);
      if (entry.isDirectory() && isHarnessSkill(dir) && !recordedPaths.has(path.resolve(dir))) {
        failures.push(`untracked Harness skill copy: ${entry.name}`);
      }
    }
  }
  return { checked: true, failures };
}

function parseArgs() {
  const args = process.argv.slice(2);
  const value = (name) => {
    const i = args.indexOf(name);
    return i === -1 ? undefined : args[i + 1];
  };
  return {
    root: value('--root') ? path.resolve(value('--root')) : getWorkspaceRoot(),
    manifestPath: value('--manifest') ? path.resolve(value('--manifest')) : undefined,
    global: args.includes('--global'),
  };
}

function main() {
  const options = parseArgs();
  const targets = options.manifestPath
    ? [{ manifestPath: options.manifestPath, skillRoot: path.dirname(options.manifestPath).replace(/harness-everything$/, 'skills') }]
    : options.global
      ? [{ manifestPath: manifest.getManifestPath(path.join(userHome, '.agents')), skillRoot: path.join(userHome, '.agents', 'skills') }]
      : [
        ['.claude', '.claude/skills'], ['.cursor', '.cursor/skills'], ['.github', '.github/skills'],
        ['.codex', '.codex/skills'], ['.continue', '.continue/skills'],
      ].map(([home, skillsPath]) => ({
        manifestPath: manifest.getManifestPath(path.join(options.root, home)),
        skillRoot: path.join(options.root, skillsPath),
      }));
  let checked = 0;
  let failures = 0;
  for (const target of targets) {
    const result = verifyManifest(target.manifestPath, target.skillRoot);
    if (!result.checked) continue;
    checked++;
    console.log(`Checking ${path.relative(options.root, target.manifestPath) || target.manifestPath}...`);
    if (result.failures.length) {
      result.failures.forEach(failure => console.error(`  FAIL ${failure}`));
      failures += result.failures.length;
    } else console.log('  PASS version and skill tree match source.');
  }
  if (!checked) {
    console.error('No Harness installation manifest found. Install Harness before verifying it.');
    process.exit(1);
  }
  if (failures) {
    console.error(`INSTALL VERIFICATION FAILED: ${failures} problem(s).`);
    process.exit(1);
  }
  console.log(`INSTALL VERIFICATION PASSED: ${checked} manifest(s).`);
}

if (require.main === module) main();
module.exports = { fileTreeHash, verifyManifest };
