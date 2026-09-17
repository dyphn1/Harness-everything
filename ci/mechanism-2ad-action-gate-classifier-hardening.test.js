#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const canonicalScript = path.join(ROOT, 'hooks', 'scripts', 'action-gate.js');
const pluginScript = path.join(ROOT, 'plugins', 'harness-everything', 'hooks', 'scripts', 'action-gate.js');
const canonicalRules = path.join(ROOT, 'hooks', 'scripts', 'action-gate-rules.json');
const pluginRules = path.join(ROOT, 'plugins', 'harness-everything', 'hooks', 'scripts', 'action-gate-rules.json');
const actionGate = require(canonicalScript);

const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-action-gate-hardening-'));
const sessionDir = path.join(temp, 'session');
fs.mkdirSync(path.join(sessionDir, 'scratch'), { recursive: true });

function payload(command, tool = 'Bash', cwd = ROOT) {
  return {
    session_id: 'classifier-hardening',
    hook_event_name: 'PreToolUse',
    tool_name: tool,
    tool_input: { command },
    cwd,
  };
}

function matched(table, command, expected, tool = 'Bash', cwd = ROOT) {
  const rule = actionGate.classify(payload(command, tool, cwd), table.rules, sessionDir);
  assert.ok(rule, `${command} should match ${expected}`);
  assert.strictEqual(rule.id, expected, `${command} should match ${expected}, got ${rule && rule.id}`);
}

function allowed(table, command, tool = 'Bash', cwd = ROOT) {
  const rule = actionGate.classify(payload(command, tool, cwd), table.rules, sessionDir);
  assert.strictEqual(rule, null, `${command} should not be classified as destructive`);
}

try {
  assert.strictEqual(fs.readFileSync(canonicalScript, 'utf8'), fs.readFileSync(pluginScript, 'utf8'), 'canonical and packaged action-gate scripts must remain byte-identical');
  assert.strictEqual(fs.readFileSync(canonicalRules, 'utf8'), fs.readFileSync(pluginRules, 'utf8'), 'canonical and packaged action-gate rule tables must remain byte-identical');

  const table = actionGate.loadRuleTable(canonicalRules);
  assert.strictEqual(table.degraded, false, 'production rule table must load normally');

  const builtinById = new Map(actionGate.BUILTIN_RULES.map(rule => [rule.id, rule]));
  for (const rule of table.rules) {
    const fallback = builtinById.get(rule.id);
    assert.ok(fallback, `built-in fallback must contain ${rule.id}`);
    assert.deepStrictEqual(
      { tools: fallback.tools, pattern: fallback.pattern, flags: fallback.flags, reason: fallback.reason, scope: fallback.scope },
      { tools: rule.tools, pattern: rule.pattern, flags: rule.flags, reason: rule.reason, scope: rule.scope },
      `built-in fallback must stay aligned with configured rule ${rule.id}`,
    );
  }

  // Confirmed fail-open variants from #100.
  matched(table, 'git -C . push --force origin main', 'git-force-push');
  matched(table, 'git push origin +main', 'git-force-push');
  matched(table, 'git push -uf origin main', 'git-force-push');
  matched(table, 'git reset -q --hard HEAD~1', 'git-reset-hard');
  matched(table, 'git -c key=value reset --hard', 'git-reset-hard');
  matched(table, 'sudo rm -rf /opt/app', 'recursive-delete');
  matched(table, 'bash -c "rm -rf C:/important"', 'recursive-delete');
  matched(table, 'ri -Recurse -Force C:\\repo\\x', 'powershell-recursive-force-delete', 'PowerShell');
  matched(table, 'rm -r -fo C:\\repo\\x', 'powershell-recursive-force-delete', 'PowerShell');

  // Quoted/descriptive text is not an executable destructive command.
  allowed(table, 'node -e "console.log(\'Remove-Item -Recurse -Force C:\\\\repo\\\\x\')"', 'Bash');
  allowed(table, 'echo "never DROP TABLE users"');
  allowed(table, 'grep -rn "npm publish" docs/');
  allowed(table, 'git push origin main');

  // Scratch cleanup keeps working for direct commands and PowerShell aliases.
  const bashScratch = process.platform === 'win32' ? '/tmp/harness-action-gate-safe' : path.join(os.tmpdir(), 'harness-action-gate-safe');
  allowed(table, `rm -rf "${bashScratch}"`, 'Bash');
  const psScratch = path.join(sessionDir, 'scratch', 'build');
  allowed(table, `rm -r -fo "${psScratch}"`, 'PowerShell');
  allowed(table, `ri -Recurse -Force "${psScratch}"`, 'PowerShell');

  // An unresolved variable remains conservative rather than creating a new
  // fail-open path: the gate cannot prove that the target is scratch space.
  matched(table, 'rm -rf "$S"', 'recursive-delete');

  console.log('PASS: destructive-command classifier covers confirmed bypasses while suppressing quoted-text false positives');
} finally {
  fs.rmSync(temp, { recursive: true, force: true });
}
