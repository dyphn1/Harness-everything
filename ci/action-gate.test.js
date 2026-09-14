#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const actionGate = require(path.join(ROOT, 'hooks', 'scripts', 'action-gate.js'));
const rulesPath = path.join(ROOT, 'hooks', 'scripts', 'action-gate-rules.json');
const pluginScript = path.join(ROOT, 'plugins', 'harness-everything', 'hooks', 'scripts', 'action-gate.js');
const pluginRules = path.join(ROOT, 'plugins', 'harness-everything', 'hooks', 'scripts', 'action-gate-rules.json');

let failed = 0;
function check(condition, message) {
  if (condition) console.log(`  PASS ${message}`);
  else {
    console.error(`  FAIL ${message}`);
    failed++;
  }
}

function payload(command, options = {}) {
  return {
    session_id: options.sessionId || 'phase5-test',
    hook_event_name: options.event || 'PreToolUse',
    tool_name: options.tool || 'Bash',
    tool_use_id: options.toolUseId || `toolu_${Math.random().toString(16).slice(2)}`,
    tool_input: options.tool === 'apply_patch' ? { patch: command } : { command },
    permission_mode: options.permissionMode || 'default',
    cwd: options.cwd || ROOT,
    ...(options.extra || {}),
  };
}

function readAudit(sessionDir, toolUseId) {
  const file = path.join(sessionDir, 'action-gate', `${toolUseId}.json`);
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function cleanTemp(dir) {
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_) {}
}

console.log('=== Issue #85 Phase 5 — Pre-action gate ===');
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-action-gate-'));
const sessionDir = path.join(tempRoot, 'session');
fs.mkdirSync(sessionDir, { recursive: true });

try {
  const table = actionGate.loadRuleTable(rulesPath);
  check(table.degraded === false, 'production action-gate rule table loads without fallback');
  check(table.rules.length >= 9, 'production rule table is non-empty and keeps the destructive baseline');
  const requiredIds = [
    'git-force-push',
    'git-reset-hard',
    'git-clean-force-delete',
    'recursive-delete',
    'powershell-recursive-force-delete',
    'sql-destructive-ddl',
    'package-publish',
    'github-release-create',
    'production-deploy',
  ];
  for (const id of requiredIds) check(table.rules.some(rule => rule.id === id), `rule table contains ${id}`);

  const force = payload('git push --force origin main', { toolUseId: 'force-push' });
  const forceDecision = actionGate.evaluatePreToolUse(force, { host: 'claude', sessionDir, ruleTable: table });
  check(forceDecision.kind === 'ask' && forceDecision.exitCode === 0, 'Claude force-push returns ask instead of block/allow');
  check(forceDecision.stdout && forceDecision.stdout.hookSpecificOutput.permissionDecision === 'ask', 'ask decision uses Claude PreToolUse hookSpecificOutput');
  check(forceDecision.stdout.hookSpecificOutput.permissionDecisionReason.includes('git-force-push'), 'ask reason names the matched rule');
  const forceAudit = readAudit(sessionDir, 'force-push');
  check(forceAudit.disposition === 'pending-approval', 'matched Claude action is audited as pending-approval');
  check(forceAudit.matchedRule === 'git-force-push', 'audit records matched rule');
  check(forceAudit.commandHash === actionGate.hashExact('git push --force origin main'), 'audit hashes the exact command payload');

  const statusDecision = actionGate.evaluatePreToolUse(payload('git status', { toolUseId: 'status' }), { host: 'claude', sessionDir, ruleTable: table });
  check(statusDecision.kind === 'allow' && statusDecision.stdout === null, 'git status passes untouched');
  check(!fs.existsSync(path.join(sessionDir, 'action-gate', 'status.json')), 'safe unmatched command creates no gate audit record');

  for (const mode of ['default', 'acceptEdits', 'plan', 'auto', 'dontAsk', 'bypassPermissions']) {
    const result = actionGate.evaluatePreToolUse(
      payload('git push --force-with-lease origin main', { permissionMode: mode, toolUseId: `mode-${mode}` }),
      { host: 'claude', sessionDir, ruleTable: table },
    );
    check(result.kind === 'ask', `mechanism emits ask under permission_mode=${mode} (live host behavior remains unverified)`);
  }

  const routerFalse = payload('git reset --hard HEAD~1', {
    toolUseId: 'router-false',
    extra: { workflowPlan: { actionGate: { required: false, reasonCodes: [], disposition: null } } },
  });
  const routerFalseDecision = actionGate.evaluatePreToolUse(routerFalse, { host: 'claude', sessionDir, ruleTable: table });
  check(routerFalseDecision.kind === 'ask', 'command classification gates destructive action even when router hint says not required');
  check(readAudit(sessionDir, 'router-false').routerActionGate.required === false, 'router actionGate hint is recorded without controlling enforcement');

  const routerTrueSafe = payload('git status', {
    toolUseId: 'router-true-safe',
    extra: { workflowPlan: { actionGate: { required: true, reasonCodes: ['irreversible-action'], disposition: 'pending-approval' } } },
  });
  check(actionGate.evaluatePreToolUse(routerTrueSafe, { host: 'claude', sessionDir, ruleTable: table }).kind === 'allow', 'safe command is not gated solely because prompt router predicted risk');

  const nonScratchTarget = process.platform === 'win32'
    ? 'C:\\workspace\\harness-project\\build'
    : '/opt/harness-project/build';
  const psDelete = payload(`Remove-Item -Recurse -Force "${nonScratchTarget}"`, { tool: 'PowerShell', toolUseId: 'ps-delete' });
  const psDeleteDecision = actionGate.evaluatePreToolUse(psDelete, { host: 'claude', sessionDir, ruleTable: table });
  check(psDeleteDecision.kind === 'ask' && psDeleteDecision.rule.id === 'powershell-recursive-force-delete', 'PowerShell recursive force delete outside scratch is gated');

  const scratchTarget = path.join(sessionDir, 'scratch', 'build');
  const psScratch = payload(`Remove-Item -Recurse -Force "${scratchTarget}"`, { tool: 'PowerShell', toolUseId: 'ps-scratch' });
  check(actionGate.evaluatePreToolUse(psScratch, { host: 'claude', sessionDir, ruleTable: table }).kind === 'allow', 'PowerShell recursive force delete inside session scratch is exempt');

  const rmDelete = actionGate.evaluatePreToolUse(payload(`rm -rf "${nonScratchTarget}"`, { toolUseId: 'rm-delete' }), { host: 'claude', sessionDir, ruleTable: table });
  check(rmDelete.kind === 'ask' && rmDelete.rule.id === 'recursive-delete', 'rm -rf outside scratch is gated');
  const rmScratch = actionGate.evaluatePreToolUse(payload(`rm -rf "${path.join(os.tmpdir(), 'harness-safe-scratch')}"`, { toolUseId: 'rm-scratch' }), { host: 'claude', sessionDir, ruleTable: table });
  check(rmScratch.kind === 'allow', 'rm -rf inside OS temp is exempt');

  const ruleCases = [
    ['git reset --hard HEAD', 'git-reset-hard'],
    ['git clean -fd', 'git-clean-force-delete'],
    ['psql -c "DROP TABLE users"', 'sql-destructive-ddl'],
    ['npm publish', 'package-publish'],
    ['gh release create v1.2.3', 'github-release-create'],
    ['npm run deploy', 'production-deploy'],
  ];
  for (let i = 0; i < ruleCases.length; i++) {
    const [command, expected] = ruleCases[i];
    const result = actionGate.evaluatePreToolUse(payload(command, { toolUseId: `rule-${i}` }), { host: 'claude', sessionDir, ruleTable: table });
    check(result.kind === 'ask' && result.rule.id === expected, `${command} matches ${expected}`);
  }

  const codexDecision = actionGate.evaluatePreToolUse(payload('git push -f origin main', { toolUseId: 'codex-block' }), { host: 'codex', sessionDir, ruleTable: table });
  check(codexDecision.kind === 'block' && codexDecision.exitCode === 2, 'host without verified ask-style decision blocks with exit 2');
  check(codexDecision.stderr.includes('git-force-push'), 'non-ask host block reason names the matched rule');
  check(readAudit(sessionDir, 'codex-block').disposition === 'rejected', 'non-ask host block is audited as rejected');

  const internalAsk = actionGate.internalErrorDecision(payload('git status', { toolUseId: 'internal-ask' }), new Error('synthetic failure'), { host: 'claude', sessionDir });
  check(internalAsk.kind === 'ask' && internalAsk.stdout.hookSpecificOutput.permissionDecision === 'ask', 'internal action-gate error on Claude fails closed to ask');
  const internalBlock = actionGate.internalErrorDecision(payload('git status', { toolUseId: 'internal-block' }), new Error('synthetic failure'), { host: 'codex', sessionDir });
  check(internalBlock.kind === 'block' && internalBlock.exitCode === 2, 'internal error on host without ask fails closed to block');

  const invalidPath = path.join(tempRoot, 'invalid-rules.json');
  fs.writeFileSync(invalidPath, '{ not-json', 'utf8');
  const degraded = actionGate.loadRuleTable(invalidPath);
  check(degraded.degraded === true && degraded.rules.length > 0, 'missing/invalid rule table visibly falls back to built-in defaults');
  const degradedDecision = actionGate.evaluatePreToolUse(payload('git push --force origin main', { toolUseId: 'degraded' }), { host: 'claude', sessionDir, ruleTable: degraded });
  check(degradedDecision.kind === 'ask', 'built-in fallback still gates destructive action');
  check(degradedDecision.stdout.hookSpecificOutput.permissionDecisionReason.includes('degraded'), 'fallback degradation is visible in the approval reason');

  const emptyPath = path.join(tempRoot, 'empty-rules.json');
  fs.writeFileSync(emptyPath, JSON.stringify({ schemaVersion: 1, rules: [] }), 'utf8');
  const empty = actionGate.loadRuleTable(emptyPath);
  check(empty.degraded === false && empty.rules.length === 0, 'valid empty rule table does not silently activate built-in defaults');
  check(actionGate.evaluatePreToolUse(payload('git push --force origin main', { toolUseId: 'empty' }), { host: 'claude', sessionDir, ruleTable: empty }).kind === 'allow', 'empty-table mutation control disables detection, proving production non-empty assertion is meaningful');

  const execPayload = payload('npm publish', { toolUseId: 'exec-ok' });
  actionGate.evaluatePreToolUse(execPayload, { host: 'claude', sessionDir, ruleTable: table });
  const execResult = actionGate.processEvent({ ...execPayload, hook_event_name: 'PostToolUse' }, { sessionDir });
  check(execResult.record && execResult.record.disposition === 'executed', 'PostToolUse closes approved payload as executed');
  check(execResult.record.commandHash === actionGate.hashExact('npm publish'), 'executed audit keeps exact approved payload hash');

  const failPayload = payload('gh release create v9', { toolUseId: 'exec-fail' });
  actionGate.evaluatePreToolUse(failPayload, { host: 'claude', sessionDir, ruleTable: table });
  const failResult = actionGate.processEvent({ ...failPayload, hook_event_name: 'PostToolUseFailure' }, { sessionDir });
  check(failResult.record && failResult.record.disposition === 'executed' && failResult.record.executionFailure === true, 'PostToolUseFailure records attempted execution without pretending success');

  const mismatchPayload = payload('git push --force origin main', { toolUseId: 'exec-mismatch' });
  actionGate.evaluatePreToolUse(mismatchPayload, { host: 'claude', sessionDir, ruleTable: table });
  const mismatch = actionGate.processEvent({ ...mismatchPayload, hook_event_name: 'PostToolUse', tool_input: { command: 'git push --force origin other' } }, { sessionDir });
  check(mismatch.record && mismatch.record.disposition === 'integrity-violation', 'post-tool payload mismatch is never accepted as the approved command');

  const pendingPayload = payload('terraform apply', { toolUseId: 'pending-stop' });
  actionGate.evaluatePreToolUse(pendingPayload, { host: 'claude', sessionDir, ruleTable: table });
  const stop = actionGate.processEvent({ session_id: 'phase5-test', hook_event_name: 'Stop', tool_name: 'Stop', tool_input: {} }, { sessionDir });
  check(stop.rejected >= 1, 'Stop closes unexecuted pending approvals');
  check(readAudit(sessionDir, 'pending-stop').disposition === 'rejected', 'unexecuted pending approval is audited as rejected');

  const canonicalHooks = JSON.parse(fs.readFileSync(path.join(ROOT, 'hooks', 'hooks.json'), 'utf8'));
  const canonicalPre = canonicalHooks.hooks.PreToolUse.find(group => group.id === 'harness:pre:action-gate');
  check(canonicalPre && canonicalPre.matcher === 'Bash|PowerShell', 'Claude hook manifest wires action-gate to Bash|PowerShell');
  check(canonicalHooks.hooks.PostToolUse.some(group => group.id === 'harness:post:action-gate-audit'), 'Claude hook manifest audits successful tool execution');
  check(canonicalHooks.hooks.PostToolUseFailure.some(group => group.id === 'harness:post-failure:action-gate-audit'), 'Claude hook manifest audits failed tool execution');
  check(canonicalHooks.hooks.Stop.some(group => group.id === 'harness:stop:action-gate-audit'), 'Claude hook manifest closes unresolved approvals on Stop');

  const pluginHooks = JSON.parse(fs.readFileSync(path.join(ROOT, 'plugins', 'harness-everything', 'hooks', 'hooks.json'), 'utf8'));
  const pluginPre = pluginHooks.hooks.PreToolUse.find(group => group.matcher === 'Bash|apply_patch');
  check(pluginPre && pluginPre.hooks.some(hook => /action-gate\.js/.test(hook.command)), 'OpenAI plugin wires action-gate to Bash|apply_patch');
  check(pluginHooks.hooks.PostToolUseFailure.some(group => group.matcher === 'Bash|apply_patch' && group.hooks.some(hook => /action-gate\.js/.test(hook.command))), 'OpenAI plugin records failed gated tool execution');
  check(pluginHooks.hooks.Stop.some(group => group.hooks.some(hook => /action-gate\.js/.test(hook.command))), 'OpenAI plugin closes pending approvals at Stop');

  check(fs.readFileSync(rulesPath, 'utf8') === fs.readFileSync(pluginRules, 'utf8'), 'canonical and plugin action-gate rule tables are byte-identical');
  check(fs.existsSync(pluginScript), 'OpenAI plugin packages action-gate runtime');
} catch (err) {
  console.error(err.stack || err.message);
  failed++;
} finally {
  cleanTemp(tempRoot);
}

console.log(`\n${failed === 0 ? 'PASS' : 'FAIL'}: action-gate phase 5 (${failed} failure${failed === 1 ? '' : 's'})`);
process.exit(failed === 0 ? 0 : 1);
