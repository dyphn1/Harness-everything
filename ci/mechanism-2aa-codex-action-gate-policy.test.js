#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const actionGate = require(path.join(ROOT, 'hooks', 'scripts', 'action-gate.js'));
const preAdapter = require(path.join(ROOT, 'hooks', 'scripts', 'codex-action-gate-pre.js'));
const permissionRequest = require(path.join(ROOT, 'hooks', 'scripts', 'codex-permission-request.js'));

const pluginRoot = path.join(ROOT, 'plugins', 'harness-everything');
const pluginHooksPath = path.join(pluginRoot, 'hooks', 'hooks.json');
const canonicalPre = path.join(ROOT, 'hooks', 'scripts', 'codex-action-gate-pre.js');
const packagedPre = path.join(pluginRoot, 'hooks', 'scripts', 'codex-action-gate-pre.js');
const canonicalPost = path.join(ROOT, 'hooks', 'scripts', 'codex-action-gate-post.js');
const packagedPost = path.join(pluginRoot, 'hooks', 'scripts', 'codex-action-gate-post.js');
const canonicalPermission = path.join(ROOT, 'hooks', 'scripts', 'codex-permission-request.js');
const packagedPermission = path.join(pluginRoot, 'hooks', 'scripts', 'codex-permission-request.js');

function payload(command, options = {}) {
  return {
    session_id: options.sessionId || 'codex-action-gate-policy-test',
    hook_event_name: options.event || 'PreToolUse',
    turn_id: options.turnId || 'turn_policy_test',
    tool_name: options.tool || 'Bash',
    tool_use_id: options.toolUseId || 'toolu_policy_test',
    tool_input: options.tool === 'apply_patch' ? { patch: command } : { command },
    permission_mode: options.permissionMode || 'default',
    cwd: ROOT,
  };
}

function commandPaths(hooks) {
  const paths = [];
  for (const groups of Object.values(hooks || {})) {
    for (const group of groups || []) {
      for (const hook of group.hooks || []) {
        for (const field of ['command', 'commandWindows']) {
          const command = hook[field];
          if (typeof command !== 'string') continue;
          const match = command.match(/(?:\$PLUGIN_ROOT|%PLUGIN_ROOT%)[\\/]([^"']+)/);
          if (match) paths.push(match[1].replace(/\\/g, '/'));
        }
      }
    }
  }
  return paths;
}

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-codex-policy-'));
const sessionDir = path.join(tempRoot, 'session');
const attributionDir = path.join(tempRoot, 'attribution');
fs.mkdirSync(sessionDir, { recursive: true });

try {
  assert.ok(fs.existsSync(canonicalPre), 'Codex PreToolUse adapter must live in canonical hooks/scripts');
  assert.ok(fs.existsSync(packagedPre), 'Codex PreToolUse adapter must be packaged');
  assert.strictEqual(fs.readFileSync(canonicalPre, 'utf8'), fs.readFileSync(packagedPre, 'utf8'), 'canonical and packaged Codex PreToolUse adapters must be byte-equivalent');

  assert.ok(fs.existsSync(canonicalPost), 'Codex PostToolUse adapter must live in canonical hooks/scripts so plugin:sync cannot delete it');
  assert.ok(fs.existsSync(packagedPost), 'Codex PostToolUse adapter must be packaged');
  assert.strictEqual(fs.readFileSync(canonicalPost, 'utf8'), fs.readFileSync(packagedPost, 'utf8'), 'canonical and packaged Codex PostToolUse adapters must be byte-equivalent');

  assert.ok(fs.existsSync(canonicalPermission), 'Codex PermissionRequest adapter must live in canonical hooks/scripts');
  assert.ok(fs.existsSync(packagedPermission), 'Codex PermissionRequest adapter must be packaged');
  assert.strictEqual(fs.readFileSync(canonicalPermission, 'utf8'), fs.readFileSync(packagedPermission, 'utf8'), 'canonical and packaged PermissionRequest adapters must be byte-equivalent');

  const hookConfig = JSON.parse(fs.readFileSync(pluginHooksPath, 'utf8'));
  assert.ok(Array.isArray(hookConfig.hooks.PermissionRequest), 'Codex plugin must declare PermissionRequest');
  assert.ok(!Object.prototype.hasOwnProperty.call(hookConfig.hooks, 'PostToolUseFailure'), 'Codex plugin must not invent PostToolUseFailure');
  const preCommands = hookConfig.hooks.PreToolUse.flatMap(group => (group.hooks || []).map(hook => hook.command || ''));
  assert.ok(preCommands.some(command => command.includes('codex-action-gate-pre.js')), 'Codex PreToolUse must invoke the attribution-aware action-gate adapter');
  const permissionCommands = hookConfig.hooks.PermissionRequest.flatMap(group => (group.hooks || []).map(hook => hook.command || ''));
  assert.ok(permissionCommands.some(command => command.includes('codex-permission-request.js')), 'PermissionRequest must invoke the native approval observer');

  for (const relativePath of new Set(commandPaths(hookConfig.hooks))) {
    assert.ok(fs.existsSync(path.join(pluginRoot, relativePath)), `hook command target must exist in plugin package: ${relativePath}`);
  }

  const table = actionGate.loadRuleTable(path.join(ROOT, 'hooks', 'scripts', 'action-gate-rules.json'));
  const destructive = payload('git push --force origin main', { toolUseId: 'codex-hard-block' });
  const pre = actionGate.evaluatePreToolUse(destructive, { host: 'codex', sessionDir, ruleTable: table });
  assert.strictEqual(pre.kind, 'block', 'Codex destructive PreToolUse must remain fail-closed');
  assert.strictEqual(pre.exitCode, 2, 'Codex destructive PreToolUse must use the supported exit-2 block fallback');
  assert.strictEqual(pre.stdout, null, 'Codex PreToolUse must never emit permissionDecision=ask');
  assert.ok(pre.stderr.includes('git-force-push'), 'Codex block reason must identify the matched rule');

  const attributedSafe = preAdapter.processPayload(payload('git status --short', {
    toolUseId: 'codex-attribution-safe',
    turnId: 'turn_attribution_user',
  }), {
    host: 'codex',
    sessionDir,
    ruleTable: table,
    attributionDir,
    runNonce: 'reviewer-user',
  });
  assert.strictEqual(attributedSafe.kind, 'allow', 'attribution must not change an otherwise-safe action-gate result');
  assert.strictEqual(attributedSafe.attribution.enabled, true, 'explicit attribution mode must write hook-entry evidence');
  assert.ok(attributedSafe.attribution.file && fs.existsSync(attributedSafe.attribution.file), 'hook-entry attribution artifact must exist');
  const attribution = JSON.parse(fs.readFileSync(attributedSafe.attribution.file, 'utf8'));
  assert.strictEqual(attribution.eventKind, 'codex-pretooluse-enter');
  assert.strictEqual(attribution.detectedHost, 'codex');
  assert.strictEqual(attribution.toolName, 'Bash');
  assert.strictEqual(attribution.toolUseId, 'codex-attribution-safe');
  assert.strictEqual(attribution.turnId, 'turn_attribution_user');
  assert.strictEqual(attribution.runNonce, 'reviewer-user');
  assert.strictEqual(attribution.payloadHash, actionGate.hashExact('git status --short'));
  assert.ok(!Object.prototype.hasOwnProperty.call(attribution, 'command'), 'attribution evidence must not persist raw command text');
  assert.ok(!Object.prototype.hasOwnProperty.call(attribution, 'toolInput'), 'attribution evidence must not persist raw tool input');
  assert.ok(!Object.prototype.hasOwnProperty.call(attribution, 'cwd'), 'attribution evidence must not persist the working directory');

  const attributedBlock = preAdapter.processPayload(payload('git push --force origin main', {
    toolUseId: 'codex-attribution-block',
    turnId: 'turn_attribution_auto_review',
  }), {
    host: 'codex',
    sessionDir,
    ruleTable: table,
    attributionDir,
    runNonce: 'reviewer-auto-review',
  });
  assert.strictEqual(attributedBlock.kind, 'block', 'attribution must not weaken the Codex hard-block fallback');
  assert.strictEqual(attributedBlock.exitCode, 2);
  assert.ok(attributedBlock.attribution.file && fs.existsSync(attributedBlock.attribution.file), 'destructive hook entry must be attributable before the block result');

  const blockedParent = path.join(tempRoot, 'not-a-directory');
  fs.writeFileSync(blockedParent, 'fixture', 'utf8');
  const failedAttribution = preAdapter.processPayload(payload('git push --force origin main', {
    toolUseId: 'codex-attribution-write-failure',
  }), {
    host: 'codex',
    sessionDir,
    ruleTable: table,
    attributionDir: path.join(blockedParent, 'child'),
  });
  assert.strictEqual(failedAttribution.kind, 'block', 'attribution write failure must never authorize a destructive action');
  assert.strictEqual(failedAttribution.exitCode, 2);
  assert.ok(failedAttribution.attribution.error, 'diagnostic write failure should be observable to deterministic tests');

  const approvalPayload = payload('git push --force origin main', {
    event: 'PermissionRequest',
    toolUseId: undefined,
    turnId: 'turn_native_approval',
  });
  delete approvalPayload.tool_use_id;
  const approval = permissionRequest.processPayload(approvalPayload, { sessionDir, ruleTable: table });
  assert.strictEqual(approval.kind, 'defer', 'PermissionRequest must defer to Codex native approval');
  assert.strictEqual(approval.exitCode, 0, 'PermissionRequest observer must not block an approval already surfaced by Codex');
  assert.strictEqual(approval.stdout, null, 'PermissionRequest observer must emit no allow/deny decision');
  assert.strictEqual(approval.record.disposition, 'deferred-to-codex-approval');
  assert.strictEqual(approval.record.matchedRule, 'git-force-push');
  assert.strictEqual(approval.record.exactToolCallCorrelation, false, 'PermissionRequest audit must not claim unavailable tool_use_id correlation');
  assert.strictEqual(approval.record.correlation, 'turn-id-and-payload-hash-only');
  assert.ok(fs.existsSync(approval.auditFile), 'PermissionRequest audit evidence must be persisted');

  const stored = JSON.parse(fs.readFileSync(approval.auditFile, 'utf8'));
  assert.strictEqual(stored.payloadHash, permissionRequest.hashExact('git push --force origin main'), 'PermissionRequest audit must hash the exact tool payload');
  assert.ok(!Object.prototype.hasOwnProperty.call(stored, 'command'), 'PermissionRequest audit must not persist raw command text');
  assert.ok(!Object.prototype.hasOwnProperty.call(stored, 'toolInput'), 'PermissionRequest audit must not persist raw tool input');

  const safeApproval = permissionRequest.processPayload(payload('git status', {
    event: 'PermissionRequest',
    turnId: 'turn_safe_native_approval',
  }), { sessionDir, ruleTable: table });
  assert.strictEqual(safeApproval.kind, 'defer');
  assert.strictEqual(safeApproval.record.matchedRule, null, 'native approval audit may exist even when Harness classifier has no destructive match');

  const error = permissionRequest.internalErrorResult(new Error('synthetic failure'));
  assert.strictEqual(error.exitCode, 0, 'PermissionRequest audit failure must not override an approval Codex already surfaced');
  assert.strictEqual(error.stdout, null, 'PermissionRequest audit failure must not emit allow/deny/ask');
  assert.ok(/Native Codex approval flow remains authoritative/.test(error.stderr));

  console.log('PASS: Codex action-gate uses supported hard blocking, attributable PreToolUse entry evidence, and non-authorizing PermissionRequest observation.');
} finally {
  fs.rmSync(tempRoot, { recursive: true, force: true });
}
