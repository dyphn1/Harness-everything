#!/usr/bin/env node

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const projectRoot = path.resolve(__dirname, '..');
const manifestPath = path.join(projectRoot, '.claude-plugin', 'plugin.json');
const marketplacePath = path.join(projectRoot, '.claude-plugin', 'marketplace.json');
const conventionalHooksPath = path.join(projectRoot, 'hooks', 'hooks.json');

function insideProject(target) {
  const relative = path.relative(projectRoot, target);
  return relative !== '' && !relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative);
}

function resolvePluginPath(reference, label) {
  assert.strictEqual(typeof reference, 'string', `${label} must be a string path`);
  assert.ok(reference.startsWith('./'), `${label} must be explicitly plugin-root relative: ${reference}`);
  const resolved = path.resolve(projectRoot, reference);
  assert.ok(insideProject(resolved), `${label} must stay inside the plugin root: ${reference}`);
  return resolved;
}

function validateCommandTarget(command, label) {
  assert.strictEqual(typeof command, 'string', `${label} command must be a string`);

  // Harness deliberately uses direct Node hook commands. This avoids the known
  // Windows shell-wrapper/path failure class while keeping plugin-root paths portable.
  assert.match(
    command,
    /^node\s+["']?\$\{CLAUDE_PLUGIN_ROOT\}\//,
    `${label} must invoke Node directly from \\${CLAUDE_PLUGIN_ROOT}: ${command}`
  );

  const targetPattern = /\$\{CLAUDE_PLUGIN_ROOT\}\/([^"'\s]+)/g;
  const targets = [...command.matchAll(targetPattern)].map(match => match[1]);
  assert.ok(targets.length > 0, `${label} must reference at least one plugin-root target`);

  for (const relativeTarget of targets) {
    const resolved = path.resolve(projectRoot, relativeTarget);
    assert.ok(insideProject(resolved), `${label} target escapes plugin root: ${relativeTarget}`);
    assert.ok(fs.existsSync(resolved), `${label} references missing file: ${relativeTarget}`);
  }
}

assert.ok(fs.existsSync(manifestPath), '.claude-plugin/plugin.json must exist');
assert.ok(fs.existsSync(marketplacePath), '.claude-plugin/marketplace.json must exist');
assert.ok(fs.existsSync(conventionalHooksPath), 'hooks/hooks.json must remain available for convention-based discovery');

const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
const marketplace = JSON.parse(fs.readFileSync(marketplacePath, 'utf8'));
const hookConfig = JSON.parse(fs.readFileSync(conventionalHooksPath, 'utf8'));

assert.ok(
  typeof marketplace.description === 'string' && marketplace.description.trim().length > 0,
  'Claude marketplace must have a top-level description so strict host validation does not regress'
);

const marketplaceEntry = marketplace.plugins.find(entry => entry && entry.name === manifest.name);
assert.ok(marketplaceEntry, `marketplace must contain plugin entry ${manifest.name}`);
assert.strictEqual(marketplaceEntry.source, './', 'Claude marketplace entry must continue to point at the repository plugin root');
assert.strictEqual(marketplaceEntry.version, manifest.version, 'Claude marketplace and plugin manifest versions must stay synchronized');
assert.ok(
  !Object.prototype.hasOwnProperty.call(marketplaceEntry, 'hooks'),
  'Do not duplicate hook component registration in the marketplace entry; use hooks/hooks.json convention discovery'
);

const manifestHooks = manifest.hooks;
if (manifestHooks !== undefined) {
  const refs = Array.isArray(manifestHooks) ? manifestHooks : [manifestHooks];
  const normalized = refs
    .filter(ref => typeof ref === 'string')
    .map(ref => ref.replace(/\\/g, '/').replace(/^\.\//, ''));

  assert.ok(
    !normalized.includes('hooks/hooks.json'),
    'Do not explicitly register hooks/hooks.json in .claude-plugin/plugin.json; Claude Code auto-discovers the conventional hook file and duplicate registration has caused plugin-load regressions.'
  );
}

assert.ok(Array.isArray(manifest.skills) && manifest.skills.length > 0, 'Claude plugin must declare packaged skills');
for (const skillRef of manifest.skills) {
  const skillDir = resolvePluginPath(skillRef, `skill ${skillRef}`);
  assert.ok(fs.statSync(skillDir).isDirectory(), `skill path must be a directory: ${skillRef}`);
  assert.ok(fs.existsSync(path.join(skillDir, 'SKILL.md')), `skill path must contain SKILL.md: ${skillRef}`);
}

assert.ok(Array.isArray(manifest.agents) && manifest.agents.length > 0, 'Claude plugin must declare packaged agents');
for (const agentRef of manifest.agents) {
  const agentPath = resolvePluginPath(agentRef, `agent ${agentRef}`);
  assert.ok(fs.statSync(agentPath).isFile(), `agent path must exist as a file: ${agentRef}`);
}

assert.ok(hookConfig && typeof hookConfig.hooks === 'object', 'hooks/hooks.json must contain a hooks object');
let commandHookCount = 0;
for (const [eventName, registrations] of Object.entries(hookConfig.hooks)) {
  assert.ok(Array.isArray(registrations), `${eventName} registrations must be an array`);
  for (const registration of registrations) {
    assert.ok(Array.isArray(registration.hooks), `${eventName} registration must contain a hooks array`);
    for (const hook of registration.hooks) {
      if (hook.type !== 'command') continue;
      commandHookCount += 1;
      validateCommandTarget(hook.command, `${eventName}/${registration.id || 'unnamed'}`);
    }
  }
}
assert.ok(commandHookCount > 0, 'Claude plugin should contain command hooks to validate');

// Negative control for anthropics/claude-code#77912: the host validator has
// historically accepted dangling hook command targets, so the repository gate must not.
assert.throws(
  () => validateCommandTarget('node "${CLAUDE_PLUGIN_ROOT}/hooks/scripts/DOES-NOT-EXIST.js"', 'negative-control'),
  /references missing file/,
  'missing hook command targets must fail repository validation'
);

// Ensure the optional staging helper can produce a plugin-only tree for host validation
// without a marketplace file masking per-plugin manifest problems.
const { stageClaudePlugin } = require('../scripts/stage-claude-plugin');
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-claude-plugin-'));
const stagedRoot = path.join(tempRoot, 'plugin');
try {
  stageClaudePlugin(stagedRoot, { quiet: true });
  assert.ok(fs.existsSync(path.join(stagedRoot, '.claude-plugin', 'plugin.json')), 'staged plugin must contain plugin.json');
  assert.ok(fs.existsSync(path.join(stagedRoot, 'hooks', 'hooks.json')), 'staged plugin must contain hooks/hooks.json');
  assert.ok(!fs.existsSync(path.join(stagedRoot, '.claude-plugin', 'marketplace.json')), 'plugin-only stage must exclude marketplace.json');
} finally {
  fs.rmSync(tempRoot, { recursive: true, force: true });
}

console.log(`PASS: Claude plugin manifest, marketplace, ${manifest.skills.length} skills, ${manifest.agents.length} agents, and ${commandHookCount} hook commands are internally consistent.`);
