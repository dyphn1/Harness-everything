'use strict';

const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const PLUGIN = path.join(ROOT, 'plugins', 'harness-everything');
const ROOT_PKG = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
const SOURCE_MANIFEST = JSON.parse(fs.readFileSync(path.join(ROOT, '.claude-plugin', 'plugin.json'), 'utf8'));

function sha256File(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

// 1. Manifest structure & schema
const AGY_MANIFEST_PATH = path.join(PLUGIN, '.antigravity-plugin', 'plugin.json');
assert.ok(fs.existsSync(AGY_MANIFEST_PATH), '.antigravity-plugin/plugin.json must exist');
const agyManifest = JSON.parse(fs.readFileSync(AGY_MANIFEST_PATH, 'utf8'));

assert.strictEqual(agyManifest.name, 'harness-everything', 'name must be harness-everything');
assert.strictEqual(agyManifest.version, ROOT_PKG.version, 'version must match package.json');
assert.ok(typeof agyManifest.description === 'string' && agyManifest.description.length > 0, 'description must be non-empty');
assert.ok(agyManifest.author && agyManifest.author.name, 'author name must be present');
assert.match(agyManifest.repository, /^https:\/\/github\.com\//, 'repository must be valid HTTPS github URL');
assert.match(agyManifest.homepage, /^https:\/\/github\.com\//, 'homepage must be valid HTTPS URL');
assert.strictEqual(agyManifest.license, 'Apache-2.0', 'license must be Apache-2.0');
assert.ok(Array.isArray(agyManifest.keywords) && agyManifest.keywords.length > 0, 'keywords must be non-empty array');

// 2. Rules integration (AGENTS.md)
const RULES_PATH = path.join(PLUGIN, 'rules', 'AGENTS.md');
assert.ok(fs.existsSync(RULES_PATH), 'plugins/harness-everything/rules/AGENTS.md must exist');
assert.strictEqual(sha256File(RULES_PATH), sha256File(path.join(ROOT, 'AGENTS.md')), 'rules/AGENTS.md must match repository AGENTS.md byte-for-byte');

// 3. AGY hook runtime parity between hooks/scripts/ and plugins/harness-everything/hooks/scripts/
const HOOKS_JSON = path.join(PLUGIN, 'hooks.json');
assert.ok(fs.existsSync(HOOKS_JSON), 'plugins/harness-everything/hooks.json must exist at plugin root');
JSON.parse(fs.readFileSync(HOOKS_JSON, 'utf8'));

const agyHookFiles = [
  'agy-session-start.js',
  'agy-pre-invocation.js',
  'agy-pre-tool.js',
  'agy-post-tool.js',
  'agy-stop.js',
  path.join('lib', 'agy-adapter-core.js')
];
for (const rel of agyHookFiles) {
  const sourceFile = path.join(ROOT, 'hooks', 'scripts', rel);
  const packagedFile = path.join(PLUGIN, 'hooks', 'scripts', rel);
  assert.ok(fs.existsSync(sourceFile), `Source hook script missing: ${rel}`);
  assert.ok(fs.existsSync(packagedFile), `Packaged hook script missing: ${rel}`);
  assert.strictEqual(sha256File(packagedFile), sha256File(sourceFile), `Packaged hook script must match source byte-for-byte: ${rel}`);
}

// 4. Canonical skills parity
const expectedSkills = (SOURCE_MANIFEST.skills || []).map(entry => path.basename(entry)).sort();
const packagedSkills = fs.readdirSync(path.join(PLUGIN, 'skills'), { withFileTypes: true })
  .filter(entry => entry.isDirectory())
  .map(entry => entry.name)
  .sort();

assert.strictEqual(expectedSkills.length, 28, 'canonical suite should contain 28 skills');
assert.deepStrictEqual(packagedSkills, expectedSkills, 'AGY package must contain exactly the 28 canonical skills');

for (const skillName of packagedSkills) {
  const skillFile = path.join(PLUGIN, 'skills', skillName, 'SKILL.md');
  assert.ok(fs.existsSync(skillFile), `${skillName} must contain SKILL.md`);
  const content = fs.readFileSync(skillFile, 'utf8');
  assert.ok(content.includes('## USE FOR:'), `${skillName} must contain ## USE FOR:`);
  assert.ok(content.includes('## DO NOT USE FOR:'), `${skillName} must contain ## DO NOT USE FOR:`);
}

console.log('Antigravity (AGY) plugin package verified: manifest, rules, hooks parity, and 28 canonical skills in lockstep.');
