'use strict';

const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const PLUGIN = path.join(ROOT, 'plugins', 'harness-everything');
const ROOT_PKG = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
const SOURCE_MANIFEST = JSON.parse(fs.readFileSync(path.join(ROOT, '.claude-plugin', 'plugin.json'), 'utf8'));

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
const rootAgentsSha = crypto.createHash('sha256').update(fs.readFileSync(path.join(ROOT, 'AGENTS.md'))).digest('hex');
const pluginAgentsSha = crypto.createHash('sha256').update(fs.readFileSync(RULES_PATH)).digest('hex');
assert.strictEqual(pluginAgentsSha, rootAgentsSha, 'rules/AGENTS.md must match repository AGENTS.md byte-for-byte');

// 3. Canonical skills parity
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

console.log('Antigravity (AGY) plugin package verified: manifest, rules, and 28 canonical skills in lockstep.');
