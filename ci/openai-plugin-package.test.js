'use strict';

const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const PLUGIN = path.join(ROOT, 'plugins', 'harness-everything');
const SOURCE_MANIFEST = JSON.parse(fs.readFileSync(path.join(ROOT, '.claude-plugin', 'plugin.json'), 'utf8'));
const PLUGIN_MANIFEST = JSON.parse(fs.readFileSync(path.join(PLUGIN, '.codex-plugin', 'plugin.json'), 'utf8'));

function sha256(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function filesUnder(root, base = root, out = []) {
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const full = path.join(root, entry.name);
    if (entry.isDirectory()) filesUnder(full, base, out);
    else if (entry.isFile()) out.push(path.relative(base, full).replace(/\\/g, '/'));
  }
  return out.sort();
}

function assertTreesEqual(source, packaged, name) {
  assert.ok(fs.existsSync(packaged), `${name}: packaged skill directory missing`);
  const sourceFiles = filesUnder(source);
  const packagedFiles = filesUnder(packaged);
  assert.deepStrictEqual(packagedFiles, sourceFiles, `${name}: packaged file list drifted from canonical source`);
  for (const relative of sourceFiles) {
    assert.strictEqual(
      sha256(path.join(packaged, relative)),
      sha256(path.join(source, relative)),
      `${name}/${relative}: packaged bytes drifted from canonical source`
    );
  }
}

assert.strictEqual(PLUGIN_MANIFEST.name, 'harness-everything');
assert.strictEqual(PLUGIN_MANIFEST.version, SOURCE_MANIFEST.version, 'OpenAI plugin version must match canonical plugin version');
assert.strictEqual(PLUGIN_MANIFEST.skills, './skills/');
assert.strictEqual(PLUGIN_MANIFEST.hooks, './hooks/hooks.json');
assert.ok(!Object.prototype.hasOwnProperty.call(PLUGIN_MANIFEST, 'agents'), 'OpenAI manifest must not claim an undocumented agents field');

const skillNames = (SOURCE_MANIFEST.skills || []).map(entry => path.basename(entry)).sort();
const packagedSkillNames = fs.readdirSync(path.join(PLUGIN, 'skills'), { withFileTypes: true })
  .filter(entry => entry.isDirectory())
  .map(entry => entry.name)
  .sort();
assert.strictEqual(skillNames.length, 26, 'canonical suite should contain 26 skills');
assert.deepStrictEqual(packagedSkillNames, skillNames, 'OpenAI package must contain exactly the canonical skill set');
for (const entry of SOURCE_MANIFEST.skills) {
  const source = path.resolve(ROOT, entry);
  const name = path.basename(source);
  assertTreesEqual(source, path.join(PLUGIN, 'skills', name), name);
}

const marketplace = JSON.parse(fs.readFileSync(path.join(ROOT, '.agents', 'plugins', 'marketplace.json'), 'utf8'));
const marketEntry = marketplace.plugins.find(plugin => plugin.name === 'harness-everything');
assert.ok(marketEntry, 'repo marketplace must expose harness-everything');
assert.strictEqual(marketEntry.source.path, './plugins/harness-everything');
assert.ok(fs.existsSync(path.join(ROOT, marketEntry.source.path, '.codex-plugin', 'plugin.json')), 'marketplace source must resolve to an installable plugin');

const hooks = JSON.parse(fs.readFileSync(path.join(PLUGIN, 'hooks', 'hooks.json'), 'utf8'));
assert.ok(hooks.hooks.SessionStart?.length, 'SessionStart hook missing');
assert.ok(hooks.hooks.UserPromptSubmit?.length, 'UserPromptSubmit hook missing');
const hookText = JSON.stringify(hooks);
assert.match(hookText, /PLUGIN_ROOT/, 'plugin hooks must resolve from PLUGIN_ROOT');
assert.match(hookText, /commandWindows/, 'plugin hooks need a Windows command override');

const session = spawnSync(process.execPath, [path.join(PLUGIN, 'hooks', 'session-start.js')], { encoding: 'utf8' });
assert.strictEqual(session.status, 0, session.stderr);
assert.match(session.stdout, /Cognitive OS policy is active/);
assert.match(session.stdout, /Route before execution/);
assert.match(session.stdout, /Verify before claim/);
assert.match(session.stdout, /3 same-signature failures/);

const kernel = path.join(PLUGIN, 'skills', 'harness-everything', 'scripts', 'kernel-router.js');
function route(prompt) {
  return spawnSync(process.execPath, [kernel], {
    input: JSON.stringify({ prompt }),
    encoding: 'utf8',
    cwd: ROOT,
    env: { ...process.env }
  });
}

const prompt = 'Implement a new API behavior with tests and update multiple files.';
const first = route(prompt);
const second = route(prompt);
assert.strictEqual(first.status, 0, first.stderr);
assert.strictEqual(second.status, 0, second.stderr);
assert.strictEqual(first.stdout, second.stdout, 'identical routing input must produce identical output');
assert.match(first.stdout, /RECOMMENDED TIER:\s*Tier 2/i);
assert.match(first.stdout, /REQUIRED HARNESS INVARIANTS/);
assert.match(first.stdout, /SUGGESTED SKILLS \(ADVISORY/);
assert.doesNotMatch(first.stdout, /BASE EXECUTION LOOP/);
assert.match(first.stdout, /Do not enforce workflow order/);

const trivial = route('Fix one spelling typo in README documentation.');
assert.strictEqual(trivial.status, 0, trivial.stderr);
assert.match(trivial.stdout, /RECOMMENDED TIER:\s*Tier 1/i);
assert.match(trivial.stdout, /No mandatory domain skill/);

console.log(`OpenAI plugin package verified: ${skillNames.length} skills, hooks, marketplace, deterministic routing.`);
