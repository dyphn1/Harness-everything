'use strict';

// Cooperative Codex explicit-authorization state. This is NOT tamperproof:
// it is local hook state keyed by host session. A local process or user can
// delete or rewrite it. It records consent only; it never bypasses Codex's
// native permission controls.
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const { getWorkspaceRoot, getSessionDir } = require('./harness-state');

const DIR_NAME = 'codex-action-authorization';
const CHALLENGES = 'challenges';
const GRANTS = 'grants';

function sessionDirOf(payload, options) {
  if (options && options.sessionDir) return options.sessionDir;
  const root = (options && options.root) || getWorkspaceRoot(payload);
  const sessionId = payload && (payload.session_id || payload.sessionId);
  return getSessionDir(root, sessionId, payload);
}

function safeToken(value) {
  return String(value || 'x').replace(/[^A-Za-z0-9._-]+/g, '_').slice(0, 160) || 'x';
}

function authDir(payload, options, leaf) {
  return path.join(sessionDirOf(payload, options), DIR_NAME, leaf);
}

function challengesDir(payload, options) { return authDir(payload, options, CHALLENGES); }
function grantsDir(payload, options) { return authDir(payload, options, GRANTS); }

function ensureDir(dir) { fs.mkdirSync(dir, { recursive: true }); }

function readJson(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (_) { return null; }
}

function atomicWriteJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const temp = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(temp, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  fs.renameSync(temp, filePath);
}

function newChallengeId() {
  return `ch-${crypto.randomBytes(12).toString('hex')}`;
}

// Canonical challenge ids are minted by this helper as ch-<24 hex>. A pending
// grant is stored as exactly <challengeId>.json. Anything with an extra suffix
// (.consumed, .consumed.json, etc.) is a claim/consumed record, not pending.
const CANONICAL_CHALLENGE_ID = /^ch-[0-9a-f]{24}$/;
function isPendingGrantFileName(name) {
  if (typeof name !== 'string') return false;
  const match = name.match(/^([^/\\]+)\.json$/);
  if (!match) return false;
  return CANONICAL_CHALLENGE_ID.test(match[1]);
}

function toolNameOf(payload) {
  return String((payload && (payload.tool_name || payload.toolName)) || '');
}

function validIdentity(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function actionGateModule() {
  try { return require(path.join(__dirname, '..', 'action-gate.js')); } catch (_) { return null; }
}

function canonicalDigest(payload) {
  const ag = actionGateModule();
  if (ag && typeof ag.exactPayloadText === 'function' && typeof ag.hashExact === 'function') {
    return ag.hashExact(ag.exactPayloadText(payload));
  }
  const input = (payload && (payload.tool_input || payload.toolInput || payload.input)) || {};
  return crypto.createHash('sha256').update(JSON.stringify(input), 'utf8').digest('hex');
}

function issueChallenge(payload, options) {
  options = options || {};
  const challengeId = options.challengeId || newChallengeId();
  const dir = challengesDir(payload, options);
  ensureDir(dir);
  const file = path.join(dir, `${safeToken(challengeId)}.json`);
  const record = {
    schemaVersion: 1,
    challengeId,
    sessionId: payload && (payload.session_id || payload.sessionId) || null,
    toolName: options.toolName || toolNameOf(payload),
    digest: options.digest || canonicalDigest(payload),
    createdAt: new Date().toISOString(),
  };
  atomicWriteJson(file, record);
  return challengeId;
}

function bindConsent(payload, options) {
  options = options || {};
  const challengeId = options.challengeId;
  if (!challengeId) return { bound: false, reason: 'missing-challenge-id' };

  const dir = challengesDir(payload, options);
  const file = path.join(dir, `${safeToken(challengeId)}.json`);
  const challenge = readJson(file);
  if (!challenge) return { bound: false, reason: 'challenge-not-found' };

  const sessionId = payload && (payload.session_id || payload.sessionId);
  if (challenge.sessionId && challenge.sessionId !== sessionId) {
    return { bound: false, reason: 'session-mismatch' };
  }

  const consentTurn = payload && (payload.turn_id || payload.turnId);
  if (!validIdentity(sessionId) || !validIdentity(consentTurn)) {
    return { bound: false, reason: 'missing-identity' };
  }
  const gdir = grantsDir(payload, options);
  ensureDir(gdir);
  const grantFile = path.join(gdir, `${safeToken(challengeId)}.json`);
  const grant = {
    schemaVersion: 1,
    challengeId,
    sessionId,
    consentTurn: consentTurn || null,
    toolName: challenge.toolName,
    digest: challenge.digest,
    createdAt: new Date().toISOString(),
    consumed: false,
  };
  atomicWriteJson(grantFile, grant);
  return { bound: true, challenge };
}

function consumeGrantIfValid(payload, options) {
  options = options || {};
  const sessionId = payload && (payload.session_id || payload.sessionId);
  const turnId = payload && (payload.turn_id || payload.turnId);
  if (!validIdentity(sessionId) || !validIdentity(turnId)) {
    return { authorized: false };
  }
  const toolName = toolNameOf(payload);
  const digest = canonicalDigest(payload);

  const dir = grantsDir(payload, options);
  let files = [];
  try { files = fs.readdirSync(dir).filter(isPendingGrantFileName); } catch (_) { files = []; }

  for (const name of files) {
    const file = path.join(dir, name);
    const grant = readJson(file);
    if (!grant || grant.consumed) continue;
    if (grant.sessionId !== sessionId) continue;
    if (grant.consentTurn !== turnId) continue; // cross-turn / expired
    if (grant.toolName !== toolName) continue;
    if (grant.digest !== digest) continue;

    // Atomic consume: first rename wins.
    const consumedFile = path.join(dir, `${path.basename(name, '.json')}.consumed`);
    try {
      fs.renameSync(file, consumedFile);
    } catch (_) {
      continue; // lost race or already consumed
    }
    grant.consumed = true;
    grant.consumedAt = new Date().toISOString();
    try { atomicWriteJson(consumedFile, grant); } catch (_) { /* best effort */ }
    return { authorized: true };
  }
  return { authorized: false };
}

function isExactConsentPrompt(prompt) {
  return /^HARNESS APPROVE [A-Za-z0-9._-]{8,}$/.test(String(prompt || ''));
}

function parseConsentPrompt(prompt) {
  const match = String(prompt || '').match(/^HARNESS APPROVE ([A-Za-z0-9._-]{8,})$/);
  return match ? match[1] : null;
}

module.exports = {
  bindConsent,
  consumeGrantIfValid,
  issueChallenge,
  isExactConsentPrompt,
  parseConsentPrompt,
  canonicalDigest,
  toolNameOf,
};
