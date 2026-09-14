'use strict';

const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const matrix = JSON.parse(fs.readFileSync(path.join(ROOT, 'docs', 'platform-compatibility.json'), 'utf8'));
const platforms = require('../hooks/scripts/lib/platforms');
const manifest = require('../scripts/lib/manifest');
const { build } = require('../scripts/build-openai-submission');

const DIMENSIONS = [
  'standaloneSkills',
  'pluginSupport',
  'bundledSkills',
  'hooksLifecycle',
  'projectScope',
  'globalScope',
  'installUninstallSymmetry',
  'assetsReferences',
  'updateSync',
  'liveHostVerification'
];
const STATUSES = new Set(['Supported', 'Mechanism verified', 'Live verified', 'Partial', 'Unsupported', 'Unknown']);
const OFFICIAL_HOSTS = {
  codex: new Set(['learn.chatgpt.com']),
  'chatgpt-openai-plugin': new Set(['help.openai.com', 'developers.openai.com']),
  'claude-code': new Set(['code.claude.com']),
  opencode: new Set(['opencode.ai']),
  'github-copilot': new Set(['docs.github.com']),
  cursor: new Set(['cursor.com', 'prod.cursor.com']),
  continue: new Set(['docs.continue.dev']),
  hermes: new Set(['hermes-agent.nousresearch.com'])
};

function filesUnder(root, base = root, out = []) {
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const full = path.join(root, entry.name);
    if (entry.isDirectory()) filesUnder(full, base, out);
    else if (entry.isFile()) out.push(path.relative(base, full).replace(/\\/g, '/'));
  }
  return out.sort();
}

function sha256(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

assert.strictEqual(matrix.format, 'harness-platform-compatibility-v1');
assert.deepStrictEqual(Object.keys(matrix.status_vocabulary).sort(), [...STATUSES].sort());
assert.deepStrictEqual(matrix.dimensions, DIMENSIONS);
assert.strictEqual(matrix.platforms.length, 8, 'compatibility matrix must cover every issue #82 platform');
assert.deepStrictEqual(
  matrix.platforms.map(platform => platform.id).sort(),
  Object.keys(OFFICIAL_HOSTS).sort()
);

for (const platform of matrix.platforms) {
  assert.ok(Array.isArray(platform.official_sources) && platform.official_sources.length > 0, `${platform.id}: official source list missing`);
  for (const source of platform.official_sources) {
    const url = new URL(source);
    assert.strictEqual(url.protocol, 'https:', `${platform.id}: source must use HTTPS`);
    assert.ok(OFFICIAL_HOSTS[platform.id].has(url.hostname), `${platform.id}: source is not an approved official documentation host: ${source}`);
  }
  assert.deepStrictEqual(Object.keys(platform.capabilities).sort(), [...DIMENSIONS].sort(), `${platform.id}: dimension coverage drifted`);
  for (const dimension of DIMENSIONS) {
    const capability = platform.capabilities[dimension];
    assert.ok(capability && STATUSES.has(capability.status), `${platform.id}/${dimension}: invalid status`);
  }
  assert.strictEqual(
    platform.capabilities.liveHostVerification.status,
    'Unknown',
    `${platform.id}: a live status requires a preserved host artifact before publication`
  );
}

const installerTargetSpecs = {
  codex: { platform: 'codex', project: '.agents/skills', global: '~/.agents/skills' },
  'claude-code': { platform: 'claude', project: '.claude/skills', global: '~/.claude/skills' },
  cursor: { platform: 'cursor', project: '.cursor/skills', global: '~/.agents/skills' },
  'github-copilot': { platform: 'copilot', project: '.github/skills', global: '~/.agents/skills' },
  continue: { platform: 'continue', project: '.continue/skills', global: '~/.continue/skills' },
  hermes: { platform: 'hermes', project: '.agents/skills', global: '~/.hermes/skills' }
};
assert.deepStrictEqual(Object.keys(matrix.installer_targets).sort(), Object.keys(OFFICIAL_HOSTS).sort());
for (const [id, spec] of Object.entries(installerTargetSpecs)) {
  const targetSpec = matrix.installer_targets[id];
  assert.strictEqual(targetSpec.project, spec.project, `${id}: project installer target drifted`);
  assert.strictEqual(targetSpec.global, spec.global, `${id}: global installer target drifted`);
  assert.ok(STATUSES.has(targetSpec.host_discovery_status), `${id}: installer target status is invalid`);
}

const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-2w-workspace-'));
const userHome = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-2w-home-'));
try {
  for (const [id, spec] of Object.entries(installerTargetSpecs)) {
    const adapter = platforms.find(platform => platform.name === spec.platform);
    assert.ok(adapter, `${id}: installer adapter missing`);
    const local = adapter.getSkillsTarget({ workspaceRoot, userHome, isGlobal: false, manifest });
    const global = adapter.getSkillsTarget({ workspaceRoot, userHome, isGlobal: true, manifest });
    const expectedLocal = path.join(workspaceRoot, ...spec.project.split('/'));
    const expectedGlobal = path.join(userHome, ...spec.global.replace('~/', '').split('/'));
    assert.strictEqual(path.resolve(local.path), path.resolve(expectedLocal), `${id}: local adapter target drifted`);
    assert.strictEqual(path.resolve(global.path), path.resolve(expectedGlobal), `${id}: global adapter target drifted`);
  }
} finally {
  fs.rmSync(workspaceRoot, { recursive: true, force: true });
  fs.rmSync(userHome, { recursive: true, force: true });
}

const portableManifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'plugins', 'harness-everything', 'plugin.json'), 'utf8'));
const compatibilityManifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'plugins', 'harness-everything', '.codex-plugin', 'plugin.json'), 'utf8'));
assert.strictEqual(portableManifest.$schema, 'https://agent-plugins.org/schemas/1.0.0/plugin.schema.json');
assert.strictEqual(portableManifest.extensions?.['com.openai']?.hooks, './hooks/hooks.json');
assert.deepStrictEqual(portableManifest.extensions?.['com.openai']?.interface, compatibilityManifest.interface);
assert.ok(fs.existsSync(path.join(ROOT, 'plugins', 'harness-everything', 'skills', 'harness-everything', 'SKILL.md')));

const marketplace = JSON.parse(fs.readFileSync(path.join(ROOT, '.agents', 'plugins', 'marketplace.json'), 'utf8'));
const marketplaceEntry = marketplace.plugins.find(plugin => plugin.name === 'harness-everything');
assert.strictEqual(marketplaceEntry?.source?.path, './plugins/harness-everything');
assert.ok(fs.existsSync(path.join(ROOT, marketplaceEntry.source.path, '.codex-plugin', 'plugin.json')));
const claudeMarketplace = JSON.parse(fs.readFileSync(path.join(ROOT, '.claude-plugin', 'marketplace.json'), 'utf8'));
assert.ok(claudeMarketplace.plugins.some(plugin => plugin.source === './'), 'Claude marketplace must remain a repository-root import path');

const tempOutput = path.join(os.tmpdir(), `harness-2w-submission-${process.pid}.zip`);
try {
  const result = build(tempOutput);
  const publicManifest = JSON.parse(fs.readFileSync(result.manifestPath, 'utf8'));
  const packagedFiles = filesUnder(path.join(ROOT, 'plugins', 'harness-everything', 'skills')).map(file => `skills/${file}`);
  assert.deepStrictEqual(publicManifest.files.map(file => file.path), packagedFiles);
  assert.ok(publicManifest.files.every(file => file.path.startsWith('skills/')));
  assert.ok(publicManifest.files.every(file => !/(^|\/)(hooks|\.codex-plugin)(\/|$)/.test(file.path)));
  assert.strictEqual(publicManifest.bundle_sha256, sha256(tempOutput));
} finally {
  fs.rmSync(tempOutput, { force: true });
  fs.rmSync(tempOutput.replace(/\.zip$/i, '') + '.manifest.json', { force: true });
}

const capabilityDocs = fs.readFileSync(path.join(ROOT, 'docs', 'platform-capabilities.md'), 'utf8');
assert.match(capabilityDocs, /platform-compatibility\.json/);
assert.match(capabilityDocs, /Continue\.dev[\s\S]*`Unknown` for standalone `SKILL\.md` discovery/);
assert.match(capabilityDocs, /live plugin loading remains unverified/i);
assert.match(capabilityDocs, /no fresh host-session artifacts/i);

console.log('Platform compatibility verified: official-source matrix, installer targets, package manifests, and public bundle boundaries.');
