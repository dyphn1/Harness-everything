'use strict';

const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const SELF_HEAL = path.join(ROOT, 'harness-everything', 'scripts', 'self-heal.js');
const SKILL = path.join(ROOT, 'environment-detection', 'SKILL.md');
const OPENCODE = path.join(ROOT, 'opencode-plugin', 'index.mjs');

function write(root, relative, content) {
  const target = path.join(root, relative);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, content, 'utf8');
  return target;
}

function treeDigest(root) {
  const hash = crypto.createHash('sha256');
  function walk(dir, relative = '') {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const rel = relative ? `${relative}/${entry.name}` : entry.name;
      const full = path.join(dir, entry.name);
      hash.update(`${entry.isDirectory() ? 'D' : 'F'}:${rel}\0`);
      if (entry.isDirectory()) walk(full, rel);
      else hash.update(fs.readFileSync(full));
    }
  }
  walk(root);
  return hash.digest('hex');
}

function run(workspace, home, args) {
  const env = {
    ...process.env,
    HARNESS_WORKSPACE_ROOT: workspace,
    HARNESS_STATE_HOME: path.join(home, 'state'),
    HOME: home,
    USERPROFILE: home,
    APPDATA: path.join(home, 'AppData', 'Roaming'),
    VSCODE_USER_PROMPTS_FOLDER: path.join(home, 'vscode-prompts'),
  };
  for (const key of ['CLAUDE', 'CLAUDECODE', 'CLAUDE_CODE', 'CURSOR_SANDBOX', 'GITHUB_COPILOT_CHAT', 'COPILOT_AGENT', 'AI_AGENT']) {
    delete env[key];
  }
  return spawnSync(process.execPath, [SELF_HEAL, ...args], {
    cwd: workspace,
    env,
    encoding: 'utf8',
  });
}

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-213-readonly-'));
try {
  const workspace = path.join(tempRoot, 'workspace');
  const home = path.join(tempRoot, 'home');
  fs.mkdirSync(path.join(workspace, '.git'), { recursive: true });
  fs.mkdirSync(home, { recursive: true });

  // Seed all six installer/self-heal adapter surfaces with user-owned content.
  write(workspace, '.claude/settings.json', JSON.stringify({ customSetting: true, hooks: {} }, null, 2));
  write(workspace, '.cursorrules', 'user cursor rule\n');
  write(workspace, '.github/copilot-instructions.md', 'user copilot instruction\n');
  write(workspace, 'AGENTS.md', 'user codex instruction\n');
  write(workspace, '.continue/rules/user.md', '# user continue rule\n');
  write(workspace, '.hermes.md', 'user hermes context\n');

  const beforeAudit = treeDigest(workspace);
  const audit = run(workspace, home, ['--check']);
  assert.strictEqual(audit.status, 0, `read-only audit failed:\n${audit.stdout}\n${audit.stderr}`);
  assert.strictEqual(treeDigest(workspace), beforeAudit, '--check changed the workspace');
  for (const label of ['Claude Code hooks', 'Cursor rules', 'Copilot instructions', 'Codex instructions', 'Continue.dev rules', 'Hermes Agent instructions']) {
    assert.ok(audit.stdout.includes(label), `audit omitted ${label}`);
  }

  // Explicit repair remains available, preserves user-owned content, and is
  // idempotent on the second run.
  const repair = run(workspace, home, []);
  assert.strictEqual(repair.status, 0, `explicit repair failed:\n${repair.stdout}\n${repair.stderr}`);
  assert.strictEqual(JSON.parse(fs.readFileSync(path.join(workspace, '.claude/settings.json'), 'utf8')).customSetting, true);
  assert.match(fs.readFileSync(path.join(workspace, '.cursorrules'), 'utf8'), /user cursor rule/);
  assert.match(fs.readFileSync(path.join(workspace, '.github', 'copilot-instructions.md'), 'utf8'), /user copilot instruction/);
  assert.match(fs.readFileSync(path.join(workspace, 'AGENTS.md'), 'utf8'), /user codex instruction/);
  assert.match(fs.readFileSync(path.join(workspace, '.hermes.md'), 'utf8'), /user hermes context/);
  assert.strictEqual(fs.readFileSync(path.join(workspace, '.continue', 'rules', 'user.md'), 'utf8'), '# user continue rule\n');

  const afterRepair = treeDigest(workspace);
  const secondRepair = run(workspace, home, []);
  assert.strictEqual(secondRepair.status, 0, `second repair failed:\n${secondRepair.stdout}\n${secondRepair.stderr}`);
  assert.strictEqual(treeDigest(workspace), afterRepair, 'explicit repair is not idempotent');

  // The routed skill contract must keep default detection observational and
  // use a portable sibling-skill path rather than a repository/cache root.
  const skill = fs.readFileSync(SKILL, 'utf8');
  assert.ok(skill.includes('self-heal.js" --check'));
  assert.doesNotMatch(skill, /<skills-repo-root>/);
  assert.match(skill, /Never run mutating self-heal during ordinary detection/);
  assert.match(skill, /OpenCode uses its own plugin runtime/);
  assert.match(skill, /skills-only surfaces may have no local repair surface/);

  // OpenCode is a separate runtime surface; its session/plugin startup must
  // not import or invoke the six-adapter installer/self-heal path implicitly.
  const opencode = fs.readFileSync(OPENCODE, 'utf8');
  assert.doesNotMatch(opencode, /self-heal\.js|scripts[\\/]installer\.js/);

  console.log('Issue #213 verified: detection is read-only across six adapters, repair is explicit/idempotent, and OpenCode stays separate.');
} finally {
  fs.rmSync(tempRoot, { recursive: true, force: true });
}
