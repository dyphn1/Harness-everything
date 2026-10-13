#!/usr/bin/env node
'use strict';

// Backfill valid Codex self-report labels from local rollout files into the
// private System One observations store. The importer never uploads session
// data and only persists user prompt text after the standard local redaction.

const fs = require('fs');
const os = require('os');
const path = require('path');
const readline = require('readline');
const { createReadStream } = require('fs');
const obs = require('../hooks/scripts/lib/observations');

const DEFAULT_SINCE = '2026-09-27';

function option(args, name, fallback) {
  const index = args.indexOf(name);
  return index === -1 ? fallback : args[index + 1];
}

function defaultCodexHome(env = process.env) {
  return path.resolve(env.CODEX_HOME || path.join(os.homedir(), '.codex'));
}

function parseSince(value) {
  const text = String(value || DEFAULT_SINCE);
  const normalized = /^\d{4}-\d{2}-\d{2}$/.test(text) ? text + 'T00:00:00.000Z' : text;
  const timestamp = Date.parse(normalized);
  if (!Number.isFinite(timestamp)) throw new Error('--since must be an ISO date or timestamp');
  return timestamp;
}

function sessionFiles(root) {
  if (!fs.existsSync(root)) throw new Error('Codex sessions directory does not exist: ' + root);
  const files = [];
  function walk(directory) {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const full = path.join(directory, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.isFile() && entry.name.endsWith('.jsonl')) files.push(full);
    }
  }
  walk(root);
  return files;
}

function firstUserText(payload) {
  if (typeof payload.content === 'string') return payload.content;
  if (!Array.isArray(payload.content)) return '';
  const item = payload.content.find(entry => entry && entry.type === 'input_text' && typeof entry.text === 'string');
  return item ? item.text : '';
}

function assistantText(payload) {
  if (typeof payload.content === 'string') return payload.content;
  if (!Array.isArray(payload.content)) return '';
  return payload.content
    .filter(entry => entry && ['output_text', 'text'].includes(entry.type) && typeof entry.text === 'string')
    .map(entry => entry.text)
    .join('\n');
}

function isoTimestamp(value) {
  const timestamp = Date.parse(String(value || ''));
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : null;
}

function completionLabel(message) {
  const result = obs.parseLabelLine(typeof message === 'string' ? message : '');
  if (result.label) return { label: result.label, reason: null };
  return { label: null, reason: result.reason };
}

function reconcileFinalMessage(payload, current) {
  const hasCompletionMessage = Object.prototype.hasOwnProperty.call(payload, 'last_agent_message') &&
    typeof payload.last_agent_message === 'string';
  const assistantCanRepresentFinal = current.lastAssistantPhase !== 'commentary';
  const assistantMessage = assistantCanRepresentFinal ? current.lastAssistantMessage : '';
  let message = hasCompletionMessage ? payload.last_agent_message : assistantMessage;
  let parsed = completionLabel(message);
  let ambiguous = false;

  if (hasCompletionMessage && parsed.reason === 'label-missing' && assistantMessage) {
    const assistantParsed = completionLabel(assistantMessage);
    if (assistantParsed.label) {
      const sameBody = obs.stripLabels(message) === obs.stripLabels(assistantMessage);
      if (sameBody) {
        message = assistantMessage;
        parsed = assistantParsed;
      } else if (!sameBody) {
        // Both sources describe the final reply, but disagree about its body.
        // Do not guess which text is authoritative or let either seed context.
        message = null;
        parsed = { label: null, reason: 'label-missing' };
        ambiguous = true;
      }
    }
  }

  return { message, parsed, ambiguous };
}

function blankReport(filesScanned) {
  return {
    since: DEFAULT_SINCE,
    filesScanned,
    turnsScanned: 0,
    eligibleTurns: 0,
    validLabels: 0,
    imported: 0,
    migratedUnobservedBehavior: 0,
    skipped: {
      beforeCutoff: 0,
      missingLabel: 0,
      invalidLabel: 0,
      missingPrompt: 0,
      invalidTimestamp: 0,
      turnMismatch: 0,
      duplicate: 0,
      ambiguousLiveMatch: 0,
      ambiguousFinalMessage: 0,
    },
    failed: { lockTimeout: 0 },
    errors: [],
  };
}

async function importSessions(options = {}) {
  const sessionsRoot = path.resolve(options.sessionsDir || path.join(defaultCodexHome(options.env), 'sessions'));
  const store = path.resolve(options.store || obs.storeRoot(options.env));
  const since = options.since || DEFAULT_SINCE;
  const cutoff = parseSince(since);
  const files = sessionFiles(sessionsRoot);
  const report = blankReport(files.length);
  report.since = since;
  const migrated = obs.markSessionBackfillBehaviorUnobserved(store, { lockTimeoutMs: options.lockTimeoutMs });
  if (migrated === null) {
    report.failed.lockTimeout++;
    report.errors.push('Observation store lock timed out during behavior migration; no session rows were imported.');
    return report;
  }
  report.migratedUnobservedBehavior = migrated;

  for (const file of files) {
    let sessionId = path.basename(file, '.jsonl');
    let turnNumber = 0;
    let current = null;
    let previousFinal = '';
    let previousAt = null;
    const lines = readline.createInterface({ input: createReadStream(file, { encoding: 'utf8' }), crlfDelay: Infinity });

    for await (const line of lines) {
      if (!line) continue;
      let row;
      try { row = JSON.parse(line); } catch (_) { continue; }
      const payload = row.payload && typeof row.payload === 'object' ? row.payload : {};
      if (row.type === 'session_meta') {
        sessionId = String(payload.session_id || payload.id || sessionId);
        continue;
      }
      if (row.type === 'event_msg' && payload.type === 'task_started') {
        if (current) current = null;
        turnNumber++;
        current = {
          turn: turnNumber,
          turnId: String(payload.turn_id || ''),
          startedAt: isoTimestamp(row.timestamp || payload.started_at),
          prompt: '',
          promptSeen: false,
          lastAssistantMessage: '',
          lastAssistantPhase: null,
          previous: '',
          previousAt: null,
        };
        if (previousFinal && previousAt && current.startedAt) {
          const age = Date.parse(current.startedAt) - Date.parse(previousAt);
          if (age >= 0 && age <= obs.RETENTION_MS) {
            current.previous = obs.redact(obs.tailBytes(obs.stripLabels(previousFinal), obs.PREVIOUS_BYTES));
            current.previousAt = previousAt;
          }
        }
        continue;
      }
      if (!current) continue;
      if (row.type === 'response_item' && payload.type === 'message' && payload.role === 'user' && !current.promptSeen) {
        current.promptSeen = true;
        current.prompt = firstUserText(payload);
        continue;
      }
      if (row.type === 'response_item' && payload.type === 'message' && payload.role === 'assistant') {
        current.lastAssistantMessage = assistantText(payload);
        current.lastAssistantPhase = typeof payload.phase === 'string' ? payload.phase : null;
        continue;
      }
      if (row.type !== 'event_msg' || payload.type !== 'task_complete') continue;
      const completedTurnId = String(payload.turn_id || '');
      if (current.turnId && completedTurnId && current.turnId !== completedTurnId) {
        report.skipped.turnMismatch++;
        continue;
      }
      if (!current.turnId && completedTurnId) current.turnId = completedTurnId;

      report.turnsScanned++;
      const startedMs = Date.parse(current.startedAt || '');
      const reconciledFinal = reconcileFinalMessage(payload, current);
      const finalMessage = reconciledFinal.message;
      if (!Number.isFinite(startedMs)) {
        report.skipped.invalidTimestamp++;
      } else if (startedMs < cutoff) {
        report.skipped.beforeCutoff++;
      } else {
        report.eligibleTurns++;
        const parsed = reconciledFinal.parsed;
        if (reconciledFinal.ambiguous) {
          report.skipped.ambiguousFinalMessage++;
        } else if (!parsed.label) {
          report.skipped[parsed.reason === 'label-missing' ? 'missingLabel' : 'invalidLabel']++;
        } else {
          report.validLabels++;
          if (!current.prompt || !current.prompt.trim()) {
            report.skipped.missingPrompt++;
          } else {
            const prompt = obs.redact(current.prompt);
            const previous = current.previous || '';
            const text = { prompt, previous };
            const completedAt = isoTimestamp(payload.completed_at || row.timestamp) || current.startedAt;
            const capturedAt = current.previousAt
              ? Math.min(startedMs, Date.parse(current.previousAt))
              : startedMs;
            const validUntil = new Date(capturedAt + obs.RETENTION_MS).toISOString();
            const expired = Date.parse(validUntil) <= Date.now();
            const record = {
              id: obs.sha('session-backfill:' + sessionId + ':' + (current.turnId || current.turn) + ':' + current.startedAt, 24),
              source: 'observation',
              captureMethod: 'session-backfill',
              status: expired ? 'expired' : 'active',
              ...(expired ? { textDeleted: true } : {}),
              observedAt: completedAt,
              validUntil,
              contentSha256: obs.sha(JSON.stringify(text)),
              host: 'codex',
              turn: current.turn,
              writer: { sessionId, ...(current.turnId ? { turnId: current.turnId } : {}) },
              scope: { taskTerms: obs.normalizeTerms(prompt), requirementTerms: [], roles: [] },
              promptBytes: Buffer.byteLength(prompt, 'utf8'),
              router: null,
              behavior: null,
              selfReport: parsed.label,
              selfReportReason: null,
            };
            const appendOptions = {
              dedupeById: true,
              dedupeByTurn: true,
              ...(options.lockTimeoutMs === undefined ? {} : { lockTimeoutMs: options.lockTimeoutMs }),
            };
            const appended = obs.appendRecordDetailed(store, record, expired ? null : text, appendOptions);
            if (appended.status === 'appended') report.imported++;
            else if (appended.status === 'duplicate') report.skipped.duplicate++;
            else if (appended.status === 'ambiguous') report.skipped.ambiguousLiveMatch++;
            else if (appended.status === 'lock-timeout') {
              report.failed.lockTimeout++;
              report.errors.push('Observation store lock timed out while appending a session turn; the record was not persisted.');
              return report;
            }
          }
        }
      }

      previousFinal = reconciledFinal.ambiguous ? '' : (typeof finalMessage === 'string' ? finalMessage : '');
      previousAt = previousFinal ? isoTimestamp(payload.completed_at || row.timestamp) : null;
      current = null;
    }
  }
  return report;
}

function parseArgs(args) {
  if (args.length % 2 !== 0) throw new Error('Usage: node scripts/system-one-observations-import-codex-sessions.js [--sessions DIR] [--store DIR] [--since YYYY-MM-DD]');
  const result = { sessionsDir: undefined, store: undefined, since: DEFAULT_SINCE };
  for (let index = 0; index < args.length; index += 2) {
    const name = args[index];
    const value = args[index + 1];
    if (!value || !['--sessions', '--store', '--since'].includes(name)) {
      throw new Error('Usage: node scripts/system-one-observations-import-codex-sessions.js [--sessions DIR] [--store DIR] [--since YYYY-MM-DD]');
    }
    if (name === '--sessions') result.sessionsDir = value;
    else if (name === '--store') result.store = value;
    else result.since = value;
  }
  return result;
}

async function main(args = process.argv.slice(2)) {
  try {
    const report = await importSessions(parseArgs(args));
    process.stdout.write(JSON.stringify(report, null, 2) + '\n');
    return report.failed.lockTimeout ? 1 : 0;
  } catch (error) {
    process.stderr.write('ERROR: ' + error.message + '\n');
    return 1;
  }
}

if (require.main === module) main().then(code => { process.exitCode = code; });

module.exports = { DEFAULT_SINCE, assistantText, firstUserText, importSessions, parseSince, reconcileFinalMessage, sessionFiles };
