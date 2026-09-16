#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const actionGate = require('./action-gate');

const ATTRIBUTION_DIR_ENV = 'HARNESS_ACTION_GATE_ATTRIBUTION_DIR';
const ATTRIBUTION_NONCE_ENV = 'HARNESS_ACTION_GATE_RUN_NONCE';
const EVENT_KIND = 'codex-pretooluse-enter';

function textOrNull(value, maxLength = 200) {
  if (value === undefined || value === null || value === '') return null;
  return String(value).slice(0, maxLength);
}

function attributionDirectory(options = {}) {
  return options.attributionDir || process.env[ATTRIBUTION_DIR_ENV] || null;
}

function attributionRecord(payload, options = {}) {
  let detectedHost = 'unknown';
  try { detectedHost = actionGate.detectHost(payload, options.host); } catch (_) { /* diagnostic only */ }

  return {
    schemaVersion: 1,
    eventKind: EVENT_KIND,
    observedAt: new Date().toISOString(),
    hookEventName: actionGate.hookEventOf(payload),
    detectedHost,
    sessionId: textOrNull(payload && (payload.session_id || payload.sessionId)),
    turnId: textOrNull(payload && (payload.turn_id || payload.turnId)),
    toolUseId: textOrNull(payload && (payload.tool_use_id || payload.toolUseId)),
    toolName: textOrNull(payload && (payload.tool_name || payload.toolName)),
    permissionMode: textOrNull(payload && (payload.permission_mode || payload.permissionMode)),
    payloadHash: actionGate.hashExact(actionGate.exactPayloadText(payload)),
    runNonce: textOrNull(options.runNonce || process.env[ATTRIBUTION_NONCE_ENV]),
  };
}

function safeFileToken(value) {
  return String(value || 'event').replace(/[^A-Za-z0-9._-]+/g, '_').slice(0, 120) || 'event';
}

function writeAttribution(payload, options = {}) {
  const dir = attributionDirectory(options);
  if (!dir) return { enabled: false, file: null, record: null, error: null };

  const record = attributionRecord(payload, options);
  const key = record.toolUseId || record.turnId || record.payloadHash.slice(0, 20);
  const file = path.join(dir, `${Date.now()}-${process.pid}-${safeFileToken(key)}.json`);
  const temp = `${file}.${process.pid}.tmp`;

  try {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(temp, `${JSON.stringify(record, null, 2)}\n`, 'utf8');
    fs.renameSync(temp, file);
    return { enabled: true, file, record, error: null };
  } catch (err) {
    try { if (fs.existsSync(temp)) fs.rmSync(temp, { force: true }); } catch (_) { /* best effort */ }
    return {
      enabled: true,
      file: null,
      record,
      error: err && err.message ? err.message : String(err),
    };
  }
}

function processPayload(payload, options = {}) {
  // Attribution is deliberately diagnostic-only. A write failure cannot turn a
  // Harness decision into allow, deny, or ask; the action-gate remains the sole
  // authorization path for this hook invocation.
  const attribution = writeAttribution(payload, options);
  let result;
  try {
    result = actionGate.processEvent(payload, options);
  } catch (err) {
    result = actionGate.internalErrorDecision(payload, err, options);
  }
  return { ...result, attribution };
}

function emitResult(result) {
  if (result.stderr) console.error(result.stderr);
  if (result.stdout) process.stdout.write(`${JSON.stringify(result.stdout)}\n`);
  return result.exitCode || 0;
}

function runPayload(payload) {
  return emitResult(processPayload(payload));
}

function setExitCodeIfDefined(code) {
  if (Number.isInteger(code)) process.exitCode = code;
}

function readStdinAndRun() {
  if (process.stdin.isTTY) return runPayload(null);
  let raw = '';
  let finished = false;
  const finish = () => {
    if (finished) return undefined;
    finished = true;
    let payload = {};
    try { payload = JSON.parse(raw || '{}'); } catch (err) {
      return emitResult(actionGate.internalErrorDecision({}, new Error(`invalid hook JSON: ${err.message}`)));
    }
    return runPayload(payload);
  };

  const timeoutMsRaw = Number(process.env.HARNESS_ACTION_GATE_STDIN_TIMEOUT_MS);
  const timeoutMs = Number.isFinite(timeoutMsRaw) && timeoutMsRaw > 0 ? timeoutMsRaw : 500;
  const timer = setTimeout(() => setExitCodeIfDefined(finish()), timeoutMs);
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', chunk => { raw += chunk; });
  process.stdin.on('end', () => {
    clearTimeout(timer);
    setExitCodeIfDefined(finish());
  });
  process.stdin.on('error', err => {
    clearTimeout(timer);
    setExitCodeIfDefined(emitResult(actionGate.internalErrorDecision({}, err)));
  });
  return 0;
}

if (require.main === module) {
  setExitCodeIfDefined(readStdinAndRun());
}

module.exports = {
  ATTRIBUTION_DIR_ENV,
  ATTRIBUTION_NONCE_ENV,
  EVENT_KIND,
  attributionDirectory,
  attributionRecord,
  processPayload,
  readStdinAndRun,
  writeAttribution,
};
