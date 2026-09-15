#!/usr/bin/env node
'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const {
  getWorkspaceRoot,
  getSessionDir,
} = require('./lib/harness-state');
const {
  RULES_PATH,
  classify,
  exactPayloadText,
  loadRuleTable,
} = require('./action-gate');

function hookEventOf(payload) {
  return String((payload && (payload.hook_event_name || payload.hookEventName)) || 'PermissionRequest');
}

function toolNameOf(payload) {
  return String((payload && (payload.tool_name || payload.toolName)) || '');
}

function hashExact(value) {
  return crypto.createHash('sha256').update(String(value || ''), 'utf8').digest('hex');
}

function safePart(value, fallback) {
  const text = String(value || '').replace(/[^A-Za-z0-9._-]+/g, '_').slice(0, 120);
  return text || fallback;
}

function sessionContext(payload, overrideSessionDir) {
  if (overrideSessionDir) return { sessionDir: overrideSessionDir };
  const root = getWorkspaceRoot(payload);
  const sessionId = payload && (payload.session_id || payload.sessionId);
  return { sessionDir: getSessionDir(root, sessionId, payload) };
}

function atomicWriteJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const temp = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(temp, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  fs.renameSync(temp, filePath);
}

function auditPermissionRequest(payload, options = {}) {
  const event = hookEventOf(payload);
  if (event !== 'PermissionRequest') return { kind: 'noop', exitCode: 0, record: null, auditFile: null };

  const context = sessionContext(payload, options.sessionDir);
  const table = options.ruleTable || loadRuleTable(options.rulePath || RULES_PATH);
  const rule = classify(payload, table.rules, context.sessionDir);
  const exact = exactPayloadText(payload);
  const payloadHash = hashExact(exact);
  const turnId = (payload && (payload.turn_id || payload.turnId)) || null;
  const now = new Date().toISOString();
  const record = {
    schemaVersion: 1,
    event: 'PermissionRequest',
    host: 'codex',
    turnId,
    toolName: toolNameOf(payload),
    payloadHash,
    matchedRule: rule ? rule.id : null,
    ruleReason: rule ? rule.reason : null,
    permissionMode: (payload && (payload.permission_mode || payload.permissionMode)) || null,
    disposition: 'deferred-to-codex-approval',
    correlation: 'turn-id-and-payload-hash-only',
    exactToolCallCorrelation: false,
    ruleTableSource: table.source,
    degradedRuleTable: table.degraded,
    degradationReason: table.degradationReason,
    createdAt: now,
    updatedAt: now,
  };

  const dir = path.join(context.sessionDir, 'action-gate', 'codex-permission-request');
  const file = path.join(dir, `${safePart(turnId, 'turn')}-${payloadHash.slice(0, 24)}.json`);
  atomicWriteJson(file, record);

  // PermissionRequest means Codex is already entering its native approval flow.
  // Returning no allow/deny decision preserves that flow. This hook must never
  // be treated as a way to manufacture an approval prompt for an otherwise
  // permitted action.
  return { kind: 'defer', exitCode: 0, stdout: null, stderr: null, record, auditFile: file };
}

function internalErrorResult(err) {
  return {
    kind: 'audit-error',
    exitCode: 0,
    stdout: null,
    stderr: `[Harness actionGate] Codex PermissionRequest audit failed: ${err.message}. Native Codex approval flow remains authoritative.`,
  };
}

function processPayload(payload, options = {}) {
  try {
    return auditPermissionRequest(payload, options);
  } catch (err) {
    return internalErrorResult(err);
  }
}

function emitResult(result) {
  if (result.stderr) console.error(result.stderr);
  if (result.stdout) process.stdout.write(`${JSON.stringify(result.stdout)}\n`);
  return result.exitCode || 0;
}

function run() {
  let raw = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', chunk => { raw += chunk; });
  process.stdin.on('end', () => {
    let payload = {};
    try {
      payload = JSON.parse(raw || '{}');
    } catch (err) {
      process.exitCode = emitResult(internalErrorResult(new Error(`invalid hook JSON: ${err.message}`)));
      return;
    }
    process.exitCode = emitResult(processPayload(payload));
  });
  process.stdin.on('error', err => {
    process.exitCode = emitResult(internalErrorResult(err));
  });
}

if (require.main === module) run();

module.exports = {
  auditPermissionRequest,
  hashExact,
  internalErrorResult,
  processPayload,
};
