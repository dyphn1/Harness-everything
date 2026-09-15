#!/usr/bin/env node
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn, spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const actionGatePath = path.join(ROOT, 'hooks', 'scripts', 'action-gate.js');
const pluginActionGatePath = path.join(ROOT, 'plugins', 'harness-everything', 'hooks', 'scripts', 'action-gate.js');
const rulesPath = path.join(ROOT, 'hooks', 'scripts', 'action-gate-rules.json');
const actionGate = require(actionGatePath);
const claudePlatform = require(path.join(ROOT, 'hooks', 'scripts', 'lib', 'platforms', 'claude.js'));

let failed = 0;
function check(condition, message) {
  if (condition) console.log(`  PASS ${message}`);
  else {
    console.error(`  FAIL ${message}`);
    failed++;
  }
}

function collectCommands(manifest) {
  const commands = [];
  for (const [event, groups] of Object.entries((manifest && manifest.hooks) || {})) {
    for (const group of groups || []) {
      for (const hook of group.hooks || []) {
        if (hook.type === 'command' && hook.command) commands.push({ event, command: hook.command });
      }
    }
  }
  return commands;
}

function scriptFromClaudeCommand(command, pluginRoot) {
  const match = String(command).match(/^node\s+"([^"]+)"/);
  if (!match) return null;
  return match[1].replace(/\$\{CLAUDE_PLUGIN_ROOT\}/g, pluginRoot);
}

function probeHookModule(entry, script, cwd) {
  if (entry.event === 'SessionStart') {
    return spawnSync(process.execPath, [script], {
      cwd,
      encoding: 'utf8',
      input: JSON.stringify({
        hook_event_name: 'SessionStart',
        session_id: 'issue99-cwd-probe',
        cwd,
      }),
      env: { ...process.env, CLAUDE_PLUGIN_ROOT: ROOT },
    });
  }
  return spawnSync(process.execPath, ['-e', 'require(process.argv[1])', script], {
    cwd,
    encoding: 'utf8',
    env: { ...process.env, CLAUDE_PLUGIN_ROOT: ROOT },
  });
}

function readAudit(sessionDir, toolUseId) {
  const file = path.join(sessionDir, 'action-gate', `${toolUseId}.json`);
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function makePayload(command, options = {}) {
  return {
    session_id: options.sessionId || 'issue99',
    hook_event_name: options.event || 'PreToolUse',
    tool_name: options.tool || 'Bash',
    tool_use_id: options.toolUseId || 'issue99-tool',
    tool_input: { command },
    cwd: options.cwd || ROOT,
  };
}

function runTimerExitCase(scriptPath, cwd) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [scriptPath], {
      cwd,
      env: {
        ...process.env,
        HARNESS_ACTION_GATE_HOST: 'codex',
        HARNESS_ACTION_GATE_STDIN_TIMEOUT_MS: '50',
      },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', chunk => { stdout += chunk.toString(); });
    child.stderr.on('data', chunk => { stderr += chunk.toString(); });
    child.on('error', reject);
    child.on('close', code => resolve({ code, stdout, stderr }));

    child.stdin.write(JSON.stringify(makePayload('git push --force origin main', {
      toolUseId: 'timer-block',
      cwd,
    })));
    setTimeout(() => child.stdin.end(), 140);
  });
}

async function main() {
  console.log('=== Issue #99 — runtime correctness ===');
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-issue99-'));
  const sessionDir = path.join(tempRoot, 'session');
  fs.mkdirSync(sessionDir, { recursive: true });

  try {
    const hooks = JSON.parse(fs.readFileSync(path.join(ROOT, 'hooks', 'hooks.json'), 'utf8'));
    const commands = collectCommands(hooks);
    check(commands.length > 0, 'canonical Claude hook manifest contains command hooks');
    check(commands.every(entry => entry.command.includes('${CLAUDE_PLUGIN_ROOT}/')), 'every canonical Claude plugin hook is anchored to CLAUDE_PLUGIN_ROOT');

    for (const entry of commands) {
      const script = scriptFromClaudeCommand(entry.command, ROOT);
      check(Boolean(script) && fs.existsSync(script), `${entry.event} hook resolves from plugin root: ${path.relative(ROOT, script || '')}`);
      if (!script || !fs.existsSync(script)) continue;
      const loaded = probeHookModule(entry, script, tempRoot);
      check(
        loaded.status === 0 && !/MODULE_NOT_FOUND|Cannot find module/i.test(`${loaded.stdout}\n${loaded.stderr}`),
        `${entry.event} hook resolves and starts from unrelated cwd`,
      );
    }

    const targetWorkspace = path.join(tempRoot, 'installed-project');
    fs.mkdirSync(targetWorkspace, { recursive: true });
    const claudeHooks = {
      mergeHarnessHooks(config, resolved) { config.hooks = resolved; },
      removeHarnessHooks() {},
    };
    const manifest = {
      PACKAGE_NAME: 'harness-everything',
      HARNESS_AUTHOR: 'Miya Daniel',
      getManifestPath(dir) { return path.join(dir, 'harness-manifest.json'); },
    };
    claudePlatform.install({
      isGlobal: false,
      targetWorkspaceRoot: targetWorkspace,
      harnessSourceDir: ROOT,
      packageVersion: 'issue99-test',
      claudeHooks,
      manifest,
    });
    const installedSettings = JSON.parse(fs.readFileSync(path.join(targetWorkspace, '.claude', 'settings.json'), 'utf8'));
    const installedCommands = collectCommands(installedSettings);
    check(installedCommands.length === commands.length, 'Claude installer preserves the full hook command set');
    for (const entry of installedCommands) {
      check(!entry.command.includes('${CLAUDE_PLUGIN_ROOT}'), `${entry.event} installer substitutes CLAUDE_PLUGIN_ROOT`);
      const match = entry.command.match(/^node\s+"([^"]+)"/);
      check(Boolean(match) && path.isAbsolute(match[1]) && fs.existsSync(match[1]), `${entry.event} installer writes an existing absolute hook path`);
    }

    const table = actionGate.loadRuleTable(rulesPath);
    const outside = process.platform === 'win32' ? 'C:\\harness-issue99-critical' : '/opt/harness-issue99-critical';
    const safeOne = path.join(os.tmpdir(), 'harness-issue99-safe-a');
    const safeTwo = path.join(os.tmpdir(), 'harness-issue99-safe-b');

    const chainedBash = makePayload(`rm -rf "${safeOne}" && rm -rf "${outside}"`, { toolUseId: 'bash-chain' });
    const chainedBashDecision = actionGate.evaluatePreToolUse(chainedBash, { host: 'claude', sessionDir, ruleTable: table });
    check(chainedBashDecision.kind === 'defer' && chainedBashDecision.rule.id === 'recursive-delete', 'chained rm checks every target and gates the outside-scratch delete');

    const safeBashDecision = actionGate.evaluatePreToolUse(
      makePayload(`rm -rf "${safeOne}" && rm -rf "${safeTwo}"`, { toolUseId: 'bash-safe-chain' }),
      { host: 'claude', sessionDir, ruleTable: table },
    );
    check(safeBashDecision.kind === 'allow', 'chained rm remains exempt when every target is scratch/temp');

    const chainedPs = makePayload(
      `Remove-Item -Recurse -Force "${safeOne}"; Remove-Item -Recurse -Force "${outside}"`,
      { tool: 'PowerShell', toolUseId: 'ps-chain' },
    );
    const chainedPsDecision = actionGate.evaluatePreToolUse(chainedPs, { host: 'claude', sessionDir, ruleTable: table });
    check(chainedPsDecision.kind === 'defer' && chainedPsDecision.rule.id === 'powershell-recursive-force-delete', 'chained Remove-Item checks every target and gates the outside-scratch delete');

    const pre = makePayload('npm publish', { toolUseId: 'post-error-preserve' });
    actionGate.evaluatePreToolUse(pre, { host: 'claude', sessionDir, ruleTable: table });
    actionGate.processEvent({ ...pre, hook_event_name: 'PostToolUse' }, { sessionDir });
    const beforeError = readAudit(sessionDir, 'post-error-preserve');
    check(beforeError.disposition === 'executed', 'setup: approved payload reaches executed before audit-error probe');

    const postError = actionGate.internalErrorDecision(
      { ...pre, hook_event_name: 'PostToolUse' },
      new Error('synthetic post-tool audit failure'),
      { host: 'claude', sessionDir },
    );
    check(postError.kind === 'audit-error' && postError.exitCode === 0 && postError.stdout === null, 'PostToolUse internal error never emits a PreToolUse ask decision');
    check(readAudit(sessionDir, 'post-error-preserve').disposition === 'executed', 'PostToolUse internal error does not overwrite an executed audit record');

    const stopError = actionGate.internalErrorDecision(
      { ...pre, hook_event_name: 'Stop' },
      new Error('synthetic stop audit failure'),
      { host: 'claude', sessionDir },
    );
    check(stopError.kind === 'audit-error' && stopError.stdout === null, 'Stop internal error remains an audit error, not an authorization prompt');

    check(fs.readFileSync(actionGatePath, 'utf8') === fs.readFileSync(pluginActionGatePath, 'utf8'), 'canonical and Codex/OpenAI plugin action-gate runtimes are byte-identical');

    const timerResult = await runTimerExitCase(actionGatePath, tempRoot);
    check(timerResult.code === 2, 'stdin timeout path preserves Codex exit-2 fail-closed decision');
    check(/git-force-push/.test(timerResult.stderr), 'stdin timeout block still reports the matched destructive rule');
  } catch (err) {
    console.error(err.stack || err.message);
    failed++;
  } finally {
    try { fs.rmSync(tempRoot, { recursive: true, force: true }); } catch (_) {}
  }

  console.log(`\n${failed === 0 ? 'PASS' : 'FAIL'}: issue #99 runtime correctness (${failed} failure${failed === 1 ? '' : 's'})`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch(err => {
  console.error(err.stack || err.message);
  process.exit(1);
});
