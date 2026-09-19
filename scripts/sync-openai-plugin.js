#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, '.claude-plugin', 'plugin.json'), 'utf8'));
const pluginSkillsRoot = path.join(ROOT, 'plugins', 'harness-everything', 'skills');
const pluginRoot = path.join(ROOT, 'plugins', 'harness-everything');
const pluginHooksRoot = path.join(pluginRoot, 'hooks');
const sourceHooksScriptsRoot = path.join(ROOT, 'hooks', 'scripts');

function normalizeText(file) {
  const bytes = fs.readFileSync(file);
  // Skills and hooks are text, but keeping binary assets byte-preserving makes
  // this copier safe if a referenced asset is added later.
  if (bytes.includes(0)) return;
  const normalized = bytes.toString('utf8').replace(/\r\n/g, '\n');
  fs.writeFileSync(file, normalized, 'utf8');
}

function normalizeTree(root) {
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const full = path.join(root, entry.name);
    if (entry.isDirectory()) normalizeTree(full);
    else if (entry.isFile()) normalizeText(full);
  }
}

function syncTree(source, destination) {
  fs.rmSync(destination, { recursive: true, force: true });
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  if (fs.statSync(source).isDirectory()) {
    fs.cpSync(source, destination, { recursive: true });
    normalizeTree(destination);
  } else {
    fs.copyFileSync(source, destination);
    normalizeText(destination);
  }
}

fs.mkdirSync(pluginSkillsRoot, { recursive: true });

const expected = new Set();
for (const entry of manifest.skills || []) {
  const source = path.resolve(ROOT, entry);
  const name = path.basename(source);
  const destination = path.join(pluginSkillsRoot, name);
  expected.add(name);
  syncTree(source, destination);
  console.log(`synced ${name}`);
}

for (const name of fs.readdirSync(pluginSkillsRoot)) {
  if (!expected.has(name)) fs.rmSync(path.join(pluginSkillsRoot, name), { recursive: true, force: true });
}

// The Claude hook definitions are host-specific, but their enforcement
// scripts are shared. Package the scripts plus the small runtime libraries
// they require so every OpenAI hook is self-contained under PLUGIN_ROOT.
const packageHookScriptsRoot = path.join(pluginHooksRoot, 'scripts');
syncTree(sourceHooksScriptsRoot, packageHookScriptsRoot);

const packageWorkspace = path.join(packageHookScriptsRoot, 'lib', 'workspace.js');
syncTree(path.join(ROOT, 'scripts', 'lib', 'workspace.js'), packageWorkspace);

const packageAdvisoryText = path.join(pluginRoot, 'scripts', 'lib', 'advisory-text.js');
syncTree(path.join(ROOT, 'scripts', 'lib', 'advisory-text.js'), packageAdvisoryText);

// Contract-integrity is shared runtime, not a directly-routed 27th skill.
// Package it under the plugin root and rewrite its one canonical TDD import
// to the packaged skill tree.
const packageContractRoot = path.join(pluginRoot, 'contract-integrity');
const packageContractAudit = path.join(packageContractRoot, 'scripts', 'audit.js');
syncTree(path.join(ROOT, 'contract-integrity', 'scripts', 'audit.js'), packageContractAudit);
syncTree(path.join(ROOT, 'contract-integrity', 'scripts', 'node-probe-adapter.js'), path.join(packageContractRoot, 'scripts', 'node-probe-adapter.js'));
syncTree(path.join(ROOT, 'contract-integrity', 'ADAPTERS.md'), path.join(packageContractRoot, 'ADAPTERS.md'));
const contractAuditSource = fs.readFileSync(packageContractAudit, 'utf8');
fs.writeFileSync(
  packageContractAudit,
  contractAuditSource.replace("require('../../tdd/scripts/quality-gate')", "require('../../skills/tdd/scripts/quality-gate')"),
  'utf8'
);

// The source hook state module is shared with Claude and uses the repository
// layout. Rewrite only that import in the packaged copy; all other relative
// imports remain inside the package tree.
const packageState = path.join(packageHookScriptsRoot, 'lib', 'harness-state.js');
const stateSource = fs.readFileSync(packageState, 'utf8');
fs.writeFileSync(
  packageState,
  stateSource.replace("require('../../../scripts/lib/workspace')", "require('./workspace')"),
  'utf8'
);

const packageSessionStart = path.join(pluginHooksRoot, 'session-start.js');
syncTree(path.join(sourceHooksScriptsRoot, 'openai-session-start.js'), packageSessionStart);
const sessionSource = fs.readFileSync(packageSessionStart, 'utf8');
fs.writeFileSync(
  packageSessionStart,
  sessionSource.replace("require('./lib/harness-state')", "require('./scripts/lib/harness-state')"),
  'utf8'
);

console.log(`OpenAI plugin skills and runtime synchronized: ${expected.size} skills`);
