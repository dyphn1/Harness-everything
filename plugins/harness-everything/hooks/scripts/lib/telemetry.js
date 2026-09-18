'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { getWorkspaceRoot, getStateRoot, getSessionDir } = require('./harness-state');

const TELEMETRY_SCHEMA_VERSION = 1;
const EVENT_TYPES = new Set([
  'skill.invoke',
  'skill.loaded',
  'skill.complete',
  'tool.observed',
]);
const STATUSES = new Set(['unknown', 'success', 'failure', 'aborted']);
const FORBIDDEN_KEYS = new Set([
  'prompt', 'source', 'sourceCode', 'content', 'contents', 'toolArgs', 'toolArguments',
  'arguments', 'command', 'cwd', 'path', 'file', 'filePath', 'user', 'userId', 'email',
  'username', 'message', 'messages', 'transcript',
]);

function telemetryEnabled() {
  const value = String(process.env.HARNESS_TELEMETRY || 'local').toLowerCase();
  return !['0', 'false', 'off', 'disabled', 'none'].includes(value);
}

function nowIso() {
  return new Date().toISOString();
}

function localId(prefix, value) {
  const text = String(value || '').trim();
  if (!text) return null;
  return `${prefix}-${crypto.createHash('sha256').update(text, 'utf8').digest('hex').slice(0, 16)}`;
}

function safeSkillName(value) {
  const text = String(value || '').trim();
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/.test(text)) return null;
  return text.toLowerCase();
}

function safeToolName(value) {
  const text = String(value || '').trim();
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,95}$/.test(text)) return null;
  return text;
}

function finiteDuration(value) {
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 1000) / 1000 : null;
}

function detectHost(payload = {}) {
  const direct = String(payload.host || payload.runtime || '').toLowerCase();
  if (['claude', 'codex', 'opencode'].includes(direct)) return direct;
  if (process.env.CLAUDE_PLUGIN_ROOT || process.env.CLAUDECODE || process.env.CLAUDE_CODE_ENTRYPOINT) return 'claude';
  if (process.env.CODEX_HOME || process.env.CODEX || process.env.PLUGIN_ROOT) return 'codex';
  return 'unknown';
}

function normalizeEvent(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('telemetry event must be an object');
  for (const key of Object.keys(input)) {
    if (FORBIDDEN_KEYS.has(key)) throw new Error(`telemetry field is forbidden by privacy contract: ${key}`);
  }

  const event = String(input.event || '');
  if (!EVENT_TYPES.has(event)) throw new Error(`unsupported telemetry event: ${event}`);
  const status = STATUSES.has(input.status) ? input.status : 'unknown';
  const skillName = input.skillName == null ? null : safeSkillName(input.skillName);
  if (input.skillName != null && !skillName) throw new Error('invalid skillName');

  const timing = input.timing || {};
  const normalized = {
    schemaVersion: TELEMETRY_SCHEMA_VERSION,
    eventId: input.eventId || crypto.randomUUID(),
    event,
    host: ['claude', 'codex', 'opencode', 'unknown'].includes(input.host) ? input.host : 'unknown',
    observedAt: input.observedAt || nowIso(),
    sessionId: input.sessionId || null,
    turnId: input.turnId || null,
    agentId: input.agentId || null,
    invocationId: input.invocationId || null,
    skillName,
    skillVersion: input.skillVersion == null ? null : String(input.skillVersion).slice(0, 40),
    toolName: input.toolName == null ? null : safeToolName(input.toolName),
    status,
    retryCount: Number.isInteger(input.retryCount) && input.retryCount >= 0 ? input.retryCount : 0,
    timing: {
      skillLoadDurationMs: finiteDuration(timing.skillLoadDurationMs),
      activeWindowMs: finiteDuration(timing.activeWindowMs),
      attributedToolDurationMs: finiteDuration(timing.attributedToolDurationMs),
    },
    reasonCodes: [...new Set((input.reasonCodes || []).map(v => String(v).slice(0, 80)).filter(Boolean))].slice(0, 16),
  };
  if (!Number.isFinite(Date.parse(normalized.observedAt))) throw new Error('observedAt must be ISO-8601');
  return normalized;
}

function telemetryFile(root, payload) {
  return path.join(getStateRoot(root || getWorkspaceRoot(payload), payload), 'telemetry', 'events.jsonl');
}

function emitTelemetry(input, options = {}) {
  const started = process.hrtime.bigint();
  try {
    if (!telemetryEnabled()) return { ok: true, disabled: true, overheadMs: 0 };
    const event = normalizeEvent(input);
    const file = options.file || telemetryFile(options.root, options.payload);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.appendFileSync(file, `${JSON.stringify(event)}\n`, 'utf8');
    const overheadMs = Number(process.hrtime.bigint() - started) / 1e6;
    return { ok: true, file, event, overheadMs };
  } catch (error) {
    // Telemetry is observability only. It must never become an execution gate.
    return {
      ok: false,
      error: String(error && (error.message || error)).slice(0, 240),
      overheadMs: Number(process.hrtime.bigint() - started) / 1e6,
    };
  }
}

function sessionState(payload) {
  const root = getWorkspaceRoot(payload);
  const rawSession = payload && (payload.session_id || payload.sessionId || payload.sessionID);
  const sessionDir = getSessionDir(root, rawSession, payload);
  return {
    root,
    rawSession,
    sessionId: localId('session', rawSession || 'default'),
    file: path.join(sessionDir, 'telemetry-state.json'),
  };
}

function readState(file) {
  try {
    const value = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (value && value.schemaVersion === 1 && value.pending && value.active) return value;
  } catch (_) {}
  return { schemaVersion: 1, pending: {}, active: {} };
}

function writeState(file, state) {
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
    fs.writeFileSync(tmp, `${JSON.stringify(state, null, 2)}\n`, 'utf8');
    fs.renameSync(tmp, file);
    return true;
  } catch (_) {
    return false;
  }
}

function toolUseId(payload) {
  const value = payload && (
    payload.tool_use_id || payload.toolUseId || payload.call_id || payload.callId ||
    payload.tool_call_id || payload.toolCallId
  );
  return value ? localId('call', value) : null;
}

function skillNameFromPayload(payload) {
  const input = (payload && (payload.tool_input || payload.toolInput || payload.input)) || {};
  return safeSkillName(input.skill || input.skill_name || input.skillName || input.name);
}

function skillVersionFromRoots(skillName) {
  if (!skillName) return null;
  const roots = [
    process.env.CLAUDE_PLUGIN_ROOT && path.join(process.env.CLAUDE_PLUGIN_ROOT, skillName, 'SKILL.md'),
    process.env.PLUGIN_ROOT && path.join(process.env.PLUGIN_ROOT, 'skills', skillName, 'SKILL.md'),
  ].filter(Boolean);
  for (const file of roots) {
    try {
      const text = fs.readFileSync(file, 'utf8');
      const metadata = text.match(/metadata:\s*[\s\S]{0,300}?version:\s*["']?([^\s"'\n]+)["']?/i);
      if (metadata) return metadata[1].slice(0, 40);
      const direct = text.match(/^version:\s*["']?([^\s"'\n]+)["']?/mi);
      if (direct) return direct[1].slice(0, 40);
    } catch (_) {}
  }
  return null;
}

function hostStatus(payload) {
  const response = (payload && (payload.tool_response || payload.toolResponse || payload.tool_result)) || {};
  const rawExit = response.exitCode ?? response.exit_code ?? payload?.exitCode ?? payload?.exit_code;
  if (response.is_error === true || response.error || (typeof rawExit === 'number' && rawExit !== 0)) return 'failure';
  if (typeof rawExit === 'number' && rawExit === 0) return 'success';
  return 'unknown';
}

function hostDuration(payload) {
  const response = (payload && (payload.tool_response || payload.toolResponse || payload.tool_result)) || {};
  const candidates = [
    response.duration_ms, response.durationMs, response.elapsed_ms, response.elapsedMs,
    payload && payload.duration_ms, payload && payload.durationMs,
  ];
  return finiteDuration(candidates.find(v => v !== null && v !== undefined && Number.isFinite(Number(v))));
}

function recordSkillHook(payload) {
  try {
    const hookEvent = String(payload?.hook_event_name || payload?.hookEventName || '');
    const toolName = String(payload?.tool_name || payload?.toolName || '');
    const stateContext = sessionState(payload || {});
    const state = readState(stateContext.file);
    const host = detectHost(payload);
    const callId = toolUseId(payload) || localId('call', `${Date.now()}:${toolName}`);

    if (hookEvent === 'PreToolUse' && toolName === 'Skill') {
      const skillName = skillNameFromPayload(payload);
      if (!skillName) return { ok: true, ignored: true, reason: 'skill-name-unavailable' };
      const invocationId = crypto.randomUUID();
      const startedAt = Date.now();
      state.pending[callId] = {
        invocationId,
        skillName,
        skillVersion: skillVersionFromRoots(skillName),
        startedAt,
      };
      writeState(stateContext.file, state);
      return emitTelemetry({
        event: 'skill.invoke',
        host,
        sessionId: stateContext.sessionId,
        turnId: localId('turn', payload.turn_id || payload.turnId),
        agentId: localId('agent', payload.agent_id || payload.agentId),
        invocationId,
        skillName,
        skillVersion: state.pending[callId].skillVersion,
        status: 'unknown',
        reasonCodes: ['host-skill-tool-pre'],
      }, { root: stateContext.root, payload });
    }

    if ((hookEvent === 'PostToolUse' || hookEvent === 'PostToolUseFailure') && toolName === 'Skill') {
      const pending = state.pending[callId];
      if (!pending) return { ok: true, ignored: true, reason: 'uncorrelated-skill-load' };
      delete state.pending[callId];
      const status = hookEvent === 'PostToolUseFailure' ? 'failure' : hostStatus(payload);
      const endedAt = Date.now();
      const loadDuration = Math.max(0, endedAt - pending.startedAt);
      if (status === 'failure') {
        writeState(stateContext.file, state);
        emitTelemetry({
          event: 'skill.loaded', host, sessionId: stateContext.sessionId,
          invocationId: pending.invocationId, skillName: pending.skillName,
          skillVersion: pending.skillVersion, status: 'failure',
          timing: { skillLoadDurationMs: loadDuration },
          reasonCodes: ['host-skill-tool-failed'],
        }, { root: stateContext.root, payload });
        return emitTelemetry({
          event: 'skill.complete', host, sessionId: stateContext.sessionId,
          invocationId: pending.invocationId, skillName: pending.skillName,
          skillVersion: pending.skillVersion, status: 'failure',
          timing: { skillLoadDurationMs: loadDuration, activeWindowMs: 0 },
          reasonCodes: ['load-failure-terminal'],
        }, { root: stateContext.root, payload });
      }
      state.active[pending.invocationId] = {
        ...pending,
        loadedAt: endedAt,
        skillLoadDurationMs: loadDuration,
        attributedToolDurationMs: null,
        observedToolCount: 0,
      };
      writeState(stateContext.file, state);
      return emitTelemetry({
        event: 'skill.loaded', host, sessionId: stateContext.sessionId,
        invocationId: pending.invocationId, skillName: pending.skillName,
        skillVersion: pending.skillVersion, status: status === 'success' ? 'success' : 'unknown',
        timing: { skillLoadDurationMs: loadDuration },
        reasonCodes: ['host-skill-tool-post'],
      }, { root: stateContext.root, payload });
    }

    if (hookEvent === 'Stop') {
      const stoppedAt = Date.now();
      const results = [];
      for (const [invocationId, active] of Object.entries(state.active)) {
        results.push(emitTelemetry({
          event: 'skill.complete',
          host,
          sessionId: stateContext.sessionId,
          invocationId,
          skillName: active.skillName,
          skillVersion: active.skillVersion,
          status: payload?.reason === 'aborted' || payload?.stop_reason === 'aborted' ? 'aborted' : 'unknown',
          timing: {
            skillLoadDurationMs: active.skillLoadDurationMs,
            activeWindowMs: Math.max(0, stoppedAt - active.loadedAt),
            attributedToolDurationMs: active.attributedToolDurationMs,
          },
          reasonCodes: ['turn-boundary-completion-window'],
        }, { root: stateContext.root, payload }));
        delete state.active[invocationId];
      }
      state.pending = {};
      writeState(stateContext.file, state);
      return { ok: results.every(result => result.ok), results };
    }

    return { ok: true, ignored: true };
  } catch (error) {
    return { ok: false, error: String(error && (error.message || error)).slice(0, 240) };
  }
}

function observeTool(payload) {
  try {
    if (!telemetryEnabled()) return { ok: true, disabled: true };
    const stateContext = sessionState(payload || {});
    const state = readState(stateContext.file);
    const active = Object.entries(state.active);
    if (active.length === 0) return { ok: true, ignored: true };
    const toolName = safeToolName(payload?.tool_name || payload?.toolName || payload?.tool || 'unknown');
    const duration = hostDuration(payload);
    const host = detectHost(payload);
    const status = hostStatus(payload);
    const results = [];
    for (const [invocationId, entry] of active) {
      if (duration !== null) {
        entry.attributedToolDurationMs = (entry.attributedToolDurationMs || 0) + duration;
      }
      entry.observedToolCount = (entry.observedToolCount || 0) + 1;
      results.push(emitTelemetry({
        event: 'tool.observed',
        host,
        sessionId: stateContext.sessionId,
        invocationId,
        skillName: entry.skillName,
        skillVersion: entry.skillVersion,
        toolName,
        status,
        timing: { attributedToolDurationMs: duration },
        reasonCodes: [
          duration === null ? 'host-tool-duration-unavailable' : 'host-tool-duration-observed',
          'skill-active-window-overlap',
        ],
      }, { root: stateContext.root, payload }));
    }
    writeState(stateContext.file, state);
    return { ok: results.every(result => result.ok), results };
  } catch (error) {
    return { ok: false, error: String(error && (error.message || error)).slice(0, 240) };
  }
}

function readEvents(file) {
  if (!fs.existsSync(file)) return [];
  return fs.readFileSync(file, 'utf8').split(/\r?\n/).filter(Boolean).map((line, index) => {
    try { return normalizeEvent(JSON.parse(line)); }
    catch (error) { return { invalid: true, line: index + 1, error: error.message }; }
  });
}

module.exports = {
  EVENT_TYPES,
  FORBIDDEN_KEYS,
  STATUSES,
  TELEMETRY_SCHEMA_VERSION,
  detectHost,
  emitTelemetry,
  hostDuration,
  localId,
  normalizeEvent,
  observeTool,
  readEvents,
  recordSkillHook,
  safeSkillName,
  telemetryEnabled,
  telemetryFile,
};
