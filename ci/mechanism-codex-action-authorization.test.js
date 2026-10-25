#!/usr/bin/env node
'use strict';

// End-to-end contract for scoped Codex consent: a blocked structured mutation
// exposes a pending challenge; only a host-submitted exact challenge response
// may authorize that same input once in the consent turn.
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn, spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const actionGate = require(path.join(ROOT, 'hooks/scripts/action-gate.js'));
const PRE_HOOK = path.join(ROOT, 'hooks/scripts/codex-action-gate-pre.js');
const PROMPT_HOOK = path.join(ROOT, 'hooks/scripts/codex-user-prompt.js');
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-codex-auth-'));
const workspace = path.join(tempRoot, 'workspace');
const stateHome = path.join(tempRoot, 'state');
fs.mkdirSync(workspace, { recursive: true });

const env = {
  ...process.env,
  HARNESS_ACTION_GATE_HOST: 'codex',
  HARNESS_STATE_HOME: stateHome,
  HARNESS_WORKSPACE_ROOT: workspace,
  HARNESS_ACTION_GATE_STDIN_TIMEOUT_MS: '2000',
};

function runHook(script, payload) {
  const result = spawnSync(process.execPath, [script], {
    cwd: workspace,
    env,
    input: JSON.stringify(payload),
    encoding: 'utf8',
    timeout: 20000,
    maxBuffer: 1024 * 1024,
  });
  assert.ifError(result.error);
  return result;
}

function runHookAsync(script, payload) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [script], { cwd: workspace, env, stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8').on('data', chunk => { stdout += chunk; });
    child.stderr.setEncoding('utf8').on('data', chunk => { stderr += chunk; });
    child.on('error', reject);
    child.on('close', status => resolve({ status, stdout, stderr }));
    child.stdin.end(JSON.stringify(payload));
  });
}

function toolPayload({ sessionId = 'codex-auth-session', turnId = 'turn-before-consent', toolUseId = 'call-1', title = 'Create draft PR' } = {}) {
  return {
    hook_event_name: 'PreToolUse',
    session_id: sessionId,
    turn_id: turnId,
    tool_use_id: toolUseId,
    tool_name: 'mcp__demo__create_pull_request',
    tool_input: {
      repository: 'acme/harness',
      head: 'codex/fix-codex-authorization',
      base: 'main',
      title,
      body: 'Draft description for the authorized change.',
    },
    permission_mode: 'default',
    cwd: workspace,
  };
}

function userConsent(sessionId, turnId, challengeId) {
  return {
    hook_event_name: 'UserPromptSubmit',
    session_id: sessionId,
    turn_id: turnId,
    prompt: `HARNESS APPROVE ${challengeId}`,
    cwd: workspace,
  };
}

function challengeIdFrom(result) {
  const match = `${result.stdout || ''}\n${result.stderr || ''}`
    .match(/(?:challenge(?:\s+id)?[:# ]+)([A-Za-z0-9._-]{8,})/i);
  return match && match[1];
}

function authorizationDirectoryFor(sessionId) {
  const { getWorkspaceKey } = require(path.join(ROOT, 'scripts/lib/workspace'));
  return path.join(stateHome, 'workspaces', getWorkspaceKey(workspace), 'state', 'sessions',
    sessionId, 'codex-action-authorization');
}

function grantFileFor(sessionId, challengeId) {
  return path.join(authorizationDirectoryFor(sessionId), 'grants', `${challengeId}.json`);
}

async function main() {
try {
  assert.ok(fs.existsSync(PRE_HOOK), 'Codex PreToolUse entrypoint is present');
  assert.ok(fs.existsSync(PROMPT_HOOK), 'Codex UserPromptSubmit entrypoint is present');

  // Positive control: a read-only structured action remains ungated.
  const safeRead = runHook(PRE_HOOK, {
    ...toolPayload({ toolUseId: 'read-control' }),
    tool_name: 'mcp__demo__get_pull_request',
  });
  assert.strictEqual(safeRead.status, 0, 'read control should pass');

  // Shell rules remain governed by the existing action gate, not this scoped
  // structured-mutation consent flow.
  const shellSession = 'codex-auth-shell-session';
  const shellAction = toolPayload({ sessionId: shellSession, turnId: 'turn-before-consent' });
  shellAction.tool_name = 'Bash';
  shellAction.tool_input = { command: 'git push --force origin main' };
  const shellBlock = runHook(PRE_HOOK, shellAction);
  const shellChallengeId = challengeIdFrom(shellBlock);
  const shellChallengeDir = path.join(authorizationDirectoryFor(shellSession), 'challenges');
  const shellChallengeCount = fs.existsSync(shellChallengeDir)
    ? fs.readdirSync(shellChallengeDir).filter(name => name.endsWith('.json')).length
    : 0;
  const shellConsent = runHook(PROMPT_HOOK, userConsent(
    shellSession,
    'turn-consent',
    shellChallengeId || 'ch-000000000000000000000000',
  ));
  const shellRetry = runHook(PRE_HOOK, {
    ...shellAction,
    turn_id: 'turn-consent',
    tool_use_id: 'call-shell-retry',
  });
  assert.deepStrictEqual({
    blocked: shellBlock.status,
    challengeExposed: Boolean(shellChallengeId),
    challengesStored: shellChallengeCount,
    retry: shellRetry.status,
    consentHandled: shellConsent.status,
  }, {
    blocked: 2,
    challengeExposed: false,
    challengesStored: 0,
    retry: 2,
    consentHandled: 0,
  }, 'Codex shell-governed actions must block without entering scoped mutation consent');

  // An own JSON __proto__ property is part of the tool input and must change
  // the digest; it must not disappear during stable serialization.
  const protoSession = 'codex-auth-proto-session';
  const approvedAction = toolPayload({ sessionId: protoSession, turnId: 'turn-before-consent' });
  const protoBlock = runHook(PRE_HOOK, approvedAction);
  assert.strictEqual(protoBlock.status, 2, 'unapproved prototype-input action must block');
  const protoChallengeId = challengeIdFrom(protoBlock);
  assert.ok(protoChallengeId, 'prototype-input action should expose a challenge id');
  const protoConsent = runHook(PROMPT_HOOK, userConsent(protoSession, 'turn-consent', protoChallengeId));
  assert.strictEqual(protoConsent.status, 0, 'prototype-input consent should be processed');
  const alteredInput = JSON.parse(JSON.stringify(approvedAction.tool_input));
  Object.defineProperty(alteredInput, '__proto__', { value: { changed: true }, enumerable: true });
  const alteredProtoRetry = runHook(PRE_HOOK, {
    ...approvedAction,
    turn_id: 'turn-consent',
    tool_use_id: 'call-altered-proto-input',
    tool_input: alteredInput,
  });
  assert.strictEqual(alteredProtoRetry.status, 2, 'adding an own __proto__ input field must invalidate the approved digest');

  // Missing host identity must not bind consent to the workspace default
  // session bucket. Missing turns likewise cannot form a usable grant.
  const missingSessionAction = toolPayload({ sessionId: null, turnId: 'turn-before-consent' });
  const missingSessionBlock = runHook(PRE_HOOK, missingSessionAction);
  assert.strictEqual(missingSessionBlock.status, 2, 'missing-session action must initially block');
  const missingSessionChallenge = challengeIdFrom(missingSessionBlock);
  assert.ok(missingSessionChallenge, 'missing-session block should expose its challenge');
  const missingSessionConsent = runHook(PROMPT_HOOK, userConsent(null, 'turn-consent', missingSessionChallenge));
  assert.strictEqual(missingSessionConsent.status, 0, 'missing-session consent event should be handled');
  const missingSessionRetry = runHook(PRE_HOOK, toolPayload({
    sessionId: null,
    turnId: 'turn-consent',
    toolUseId: 'call-missing-session',
  }));
  assert.strictEqual(missingSessionRetry.status, 2, 'missing session_id must not authorize a retry');

  const missingTurnSession = 'codex-auth-missing-turn-session';
  const missingTurnAction = toolPayload({ sessionId: missingTurnSession });
  delete missingTurnAction.turn_id;
  const missingTurnBlock = runHook(PRE_HOOK, missingTurnAction);
  assert.strictEqual(missingTurnBlock.status, 2, 'missing-turn action must initially block');
  const missingTurnChallenge = challengeIdFrom(missingTurnBlock);
  assert.ok(missingTurnChallenge, 'missing-turn block should expose its challenge');
  const missingTurnConsent = runHook(PROMPT_HOOK, userConsent(missingTurnSession, undefined, missingTurnChallenge));
  assert.strictEqual(missingTurnConsent.status, 0, 'missing-turn consent event should be handled');
  const missingTurnRetry = runHook(PRE_HOOK, {
    ...missingTurnAction,
    tool_use_id: 'call-missing-turn',
  });
  assert.strictEqual(missingTurnRetry.status, 2, 'missing turn_id must not authorize a retry');

  // A grant file is claimed before its contents are rewritten. Both the
  // current extensionless marker and the earlier JSON marker must stay denied.
  for (const [claimedSession, marker] of [
    ['codex-auth-claimed-session', '.consumed'],
    ['codex-auth-legacy-claimed-session', '.consumed.json'],
  ]) {
    const claimedBlock = runHook(PRE_HOOK, toolPayload({ sessionId: claimedSession, turnId: 'turn-before-consent' }));
    assert.strictEqual(claimedBlock.status, 2, 'unapproved claim-window fixture must block');
    const claimedChallengeId = challengeIdFrom(claimedBlock);
    assert.ok(claimedChallengeId, 'claim-window fixture should expose a challenge id');
    const claimedConsent = runHook(PROMPT_HOOK, userConsent(claimedSession, 'turn-consent', claimedChallengeId));
    assert.strictEqual(claimedConsent.status, 0, 'claim-window fixture consent should be processed');
    const grantFile = grantFileFor(claimedSession, claimedChallengeId);
    const claimedFile = path.join(path.dirname(grantFile), `${claimedChallengeId}${marker}`);
    assert.ok(fs.existsSync(grantFile), 'consent should create the available grant file');
    fs.renameSync(grantFile, claimedFile);
    const claimedRetry = runHook(PRE_HOOK, toolPayload({
      sessionId: claimedSession,
      turnId: 'turn-consent',
      toolUseId: `call-after-claim-window-${marker.replace(/\W/g, '')}`,
    }));
    assert.strictEqual(claimedRetry.status, 2, `a ${marker} claim marker must not authorize a retry before consumed=true is persisted`);
  }

  // Baseline witness: an unauthorised mutation must block before consent.
  const sessionId = 'codex-auth-session';
  const blocked = runHook(PRE_HOOK, toolPayload({ sessionId }));
  assert.strictEqual(blocked.status, 2, 'unapproved structured mutation must fail closed');

  // The blocked call must expose a challenge that the host can bind to a
  // later explicit consent event.
  const challengeMatch = `${blocked.stdout || ''}\n${blocked.stderr || ''}`
    .match(/(?:challenge(?:\s+id)?[:# ]+)([A-Za-z0-9._-]{8,})/i);
  assert.ok(challengeMatch, 'blocked Codex structured mutation should expose a pending challenge id');
  const challengeId = challengeMatch[1];
  const blockText = String(blocked.stderr || '');
  const expectedDigest = actionGate.normalizeActionDescriptor(toolPayload({ sessionId })).payloadHash;
  assert.ok(blockText.includes('mcp__demo__create_pull_request'), 'block output should identify the approved tool');
  assert.ok(blockText.includes(expectedDigest), 'block output should show the full-input digest');
  assert.ok(blockText.includes(`HARNESS APPROVE ${challengeId}`), 'block output should show the exact approval prompt');
  assert.ok(!blockText.includes('Draft description for the authorized change.'), 'block output should not expose raw tool input');

  // A prompt that names the challenge is the only consent source. The real
  // UserPromptSubmit entrypoint must bind it to host session + consent turn.
  // Wrong session, changed full input, and an agent-supplied authorization
  // claim are negative controls. None may spend or widen the pending grant.
  const wrongSessionConsent = runHook(PROMPT_HOOK, userConsent('other-session', 'turn-consent', challengeId));
  assert.strictEqual(wrongSessionConsent.status, 0, 'wrong-session prompt event should be handled without turning into a host error');
  const wrongSession = runHook(PRE_HOOK, toolPayload({ sessionId, turnId: 'turn-consent', toolUseId: 'wrong-session' }));
  assert.strictEqual(wrongSession.status, 2, 'a challenge cannot be approved from another session');

  const accepted = runHook(PROMPT_HOOK, userConsent(sessionId, 'turn-consent', challengeId));
  assert.strictEqual(accepted.status, 0, 'exact consent prompt should be processed by UserPromptSubmit');
  const changedInput = runHook(PRE_HOOK, toolPayload({ sessionId, turnId: 'turn-consent', toolUseId: 'changed-input', title: 'Different PR' }));
  assert.strictEqual(changedInput.status, 2, 'grant must not authorize a changed full tool input');
  const selfAsserted = toolPayload({ sessionId, turnId: 'turn-consent', toolUseId: 'self-asserted' });
  selfAsserted.tool_input.authorization = { approved: true, scope: '*' };
  const forgedClaim = runHook(PRE_HOOK, selfAsserted);
  assert.strictEqual(forgedClaim.status, 2, 'tool-input authorization JSON must never be a trusted grant');

  // The matching tool + full input is allowed once in the consent turn without
  // a hook-level allow decision that could override Codex's native permissions.
  const concurrentRetries = await Promise.all([
    runHookAsync(PRE_HOOK, toolPayload({ sessionId, turnId: 'turn-consent', toolUseId: 'call-retry-a' })),
    runHookAsync(PRE_HOOK, toolPayload({ sessionId, turnId: 'turn-consent', toolUseId: 'call-retry-b' })),
  ]);
  assert.deepStrictEqual(concurrentRetries.map(result => result.status).sort(), [0, 2], 'atomic consume must authorize exactly one concurrent exact retry');
  const allowedRetry = concurrentRetries.find(result => result.status === 0);
  assert.strictEqual(allowedRetry.stdout, '', 'scoped grant must not emit a Codex permissionDecision=allow');
  const replay = runHook(PRE_HOOK, toolPayload({ sessionId, turnId: 'turn-consent', toolUseId: 'call-replay' }));
  assert.strictEqual(replay.status, 2, 'a consumed grant must not authorize a replay');

  // A separate grant that is not used in its consent turn expires at the next turn.
  const laterAction = toolPayload({ sessionId, turnId: 'turn-before-consent-2', toolUseId: 'call-2', title: 'Create second draft PR' });
  const blockedAgain = runHook(PRE_HOOK, laterAction);
  const secondChallenge = `${blockedAgain.stdout || ''}\n${blockedAgain.stderr || ''}`
    .match(/(?:challenge(?:\s+id)?[:# ]+)([A-Za-z0-9._-]{8,})/i);
  assert.ok(secondChallenge, 'second blocked action should expose its own pending challenge');
  const acceptedButUnused = runHook(PROMPT_HOOK, userConsent(sessionId, 'turn-consent-2', secondChallenge[1]));
  assert.strictEqual(acceptedButUnused.status, 0);
  const nextBlocked = runHook(PRE_HOOK, { ...laterAction, turn_id: 'turn-later', tool_use_id: 'call-later' });
  assert.strictEqual(nextBlocked.status, 2, 'an unused grant must not survive its consent turn');

  console.log('PASS: Codex structured authorization challenge is exact, scoped, and one-use.');
} finally {
  fs.rmSync(tempRoot, { recursive: true, force: true });
}
}

main().catch(err => {
  console.error(err);
  process.exitCode = 1;
});
