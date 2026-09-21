'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const repoRoot = path.resolve(__dirname, '..');
const packagedPlugin = path.join(repoRoot, 'plugins', 'harness-everything');

function runNode(script, args, options) {
  return spawnSync(process.execPath, [script, ...args], {
    cwd: options.cwd,
    env: { ...process.env, ...options.env },
    input: options.input,
    encoding: 'utf8'
  });
}

function describe(result) {
  return [result.stdout, result.stderr].filter(Boolean).join('\n');
}

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-openai-plugin-'));
try {
  const pluginRoot = path.join(tempRoot, 'plugin');
  const workspaceRoot = path.join(tempRoot, 'workspace');
  const stateHome = path.join(tempRoot, 'state');
  fs.cpSync(packagedPlugin, pluginRoot, { recursive: true });
  fs.mkdirSync(workspaceRoot, { recursive: true });
  fs.mkdirSync(stateHome, { recursive: true });
  fs.mkdirSync(path.join(workspaceRoot, '.git'), { recursive: true });
  fs.writeFileSync(path.join(workspaceRoot, 'AGENTS.md'), '# managed workspace\n', 'utf8');

  const env = {
    HARNESS_STATE_HOME: stateHome,
    HARNESS_WORKSPACE_ROOT: workspaceRoot,
  };

  const scriptsRoot = path.join(pluginRoot, 'skills', 'harness-everything', 'scripts');
  const selfHeal = runNode(path.join(scriptsRoot, 'self-heal.js'), ['--check'], {
    cwd: workspaceRoot,
    env,
  });
  assert.strictEqual(selfHeal.status, 0, `packaged self-heal --check failed:\n${describe(selfHeal)}`);

  const installer = runNode(path.join(pluginRoot, 'scripts', 'installer.js'), ['--codex', '--no-skills', '--yes'], {
    cwd: workspaceRoot,
    env,
  });
  assert.strictEqual(installer.status, 0, `packaged installer failed:\n${describe(installer)}`);
  assert.match(
    fs.readFileSync(path.join(workspaceRoot, 'AGENTS.md'), 'utf8'),
    /Harness OS Guidance \(Advisory\)/,
    'packaged installer did not write the Codex advisory file'
  );

  const bootstrap = runNode(path.join(scriptsRoot, 'bootstrap.js'), [], {
    cwd: workspaceRoot,
    env,
    input: JSON.stringify({ session_id: 'packaged-runtime-smoke', cwd: workspaceRoot }),
  });
  assert.strictEqual(bootstrap.status, 0, `packaged bootstrap failed:\n${describe(bootstrap)}`);
  assert.match(describe(bootstrap), /Harness OS initialized/, 'packaged bootstrap did not initialize Harness');

  const tierRouter = runNode(path.join(scriptsRoot, 'tier-router.js'), ['audit the repository and run tests'], {
    cwd: workspaceRoot,
    env,
  });
  assert.strictEqual(tierRouter.status, 0, `packaged tier-router failed:\n${describe(tierRouter)}`);
  assert.doesNotMatch(
    describe(tierRouter),
    /BASE EXECUTION LOOP: Load 'todo-driven-workflow'/,
    'direct packaged tier-router still emits retired mandatory todo guidance'
  );
  assert.match(describe(tierRouter), /WORKFLOW STRATEGY:/, 'packaged tier-router did not emit the workflow contract');

  console.log('OpenAI packaged helper runtime smoke test passed');
} finally {
  fs.rmSync(tempRoot, { recursive: true, force: true });
}
