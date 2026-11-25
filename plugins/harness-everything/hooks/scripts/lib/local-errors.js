'use strict';
// Local error store (#496 D1): bounded, redacted local storage for tool-failure
// occurrences and provisional local lessons alongside System One observations.
// Shares observations.storeRoot(), .index.lock, and atomic JSON writes, while
// keeping records in errors-index.json (separate from observations-index.json
// and System One training exports).

const crypto = require('node:crypto');
const path = require('node:path');
const observations = require('./observations');
const { resolveWorkspaceIdentity } = require('./harness-state');
const { validateMatch } = require('./ledger-match');

const SCHEMA_VERSION = 1;
const INDEX_FILE = 'errors-index.json';
const INDEX_KIND = 'local-error-store';
const DESTINATIONS = Object.freeze(['harness', 'project', 'unknown']);
const COMMAND_CLASSES = Object.freeze(['git', 'gh', 'test', 'build', 'package', 'shell']);
const HOSTS = Object.freeze(['claude', 'codex', 'opencode', 'unknown']);
const IDENTIFIER_PATTERN = /^[a-z0-9][a-z0-9_-]{0,63}$/;
const RECORD_ID_PATTERN = /^E-\d{4,}$/;
const RESERVED_E_PREFIX = /^E-/i;
const WORKSPACE_CONTEXT_KEYS = Object.freeze([
  'workspace_root', 'workspaceRoot', 'project_root', 'projectRoot',
  'working_directory', 'workingDirectory', 'cwd', 'root',
]);
const WORKSPACE_ENV_KEYS = Object.freeze([
  'HARNESS_WORKSPACE_ROOT', 'CLAUDE_PROJECT_DIR', 'CODEX_PROJECT_DIR',
]);
const SECRET_QUERY_KEY_PATTERN = /(?:token|secret|password|passwd|api[_-]?key|apikey|auth|sig(?:nature)?|credential|bearer|jwt|private[_-]?key|(?:^|[_-])(?:key|pwd|sid|cred|session|cookie)(?:$|[_-]))/i;
const SECRET_FRAGMENT_PARAM_PATTERN = /(?:^|[&#])[^=]*(?:token|secret|password|passwd|api[_-]?key|apikey|auth|sig(?:nature)?)=/i;

const LIMITS = Object.freeze({
  maxExcerptBytes: 2048,
  maxLessonChars: 4096,
  maxCueChars: 4096,
  maxMatchedLedgerIds: 16,
  maxRecordsPerWorkspace: 200,
  maxTotalRecords: 1000,
  maxIndexBytes: 2 * 1024 * 1024,
  defaultLockTimeoutMs: 50,
  retentionMs: observations.RETENTION_MS,
});

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function validIdentifier(value) {
  return typeof value === 'string' && IDENTIFIER_PATTERN.test(value);
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function redactErrorText(text, env = process.env) {
  let out = observations.redact(text);
  for (const key of ['HOME', 'USERPROFILE']) {
    const home = env && typeof env[key] === 'string' ? env[key] : '';
    if (home && home.length > 1) {
      out = out.replace(new RegExp(escapeRegExp(home), 'g'), '<home>');
    }
  }
  // Omit suspected credentials and token-like strings.
  out = out.replace(/(https?:\/\/)([^:@/\s]+):([^@/\s]+)@/gi, '$1<redacted>@');
  out = out.replace(/(\b(?:proxy-)?authorization[ \t]*:[ \t]*)(?:basic|bearer)\b[ \t]+[^\r\n]*/gi, '$1<redacted>');
  out = out.replace(/\b(Bearer\s+)[A-Za-z0-9._~+/=-]{8,}\b/gi, '$1<redacted>');
  out = out.replace(/\b(?:gh[pousr]_[A-Za-z0-9_]{20,}|github_pat_[A-Za-z0-9_]{20,})\b/g, '<redacted>');
  out = out.replace(/\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g, '<redacted>');
  out = out.replace(/\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g, '<redacted>');
  out = out.replace(/\b(?:sk|pk|rk|ak|pat|tok)[_-][A-Za-z0-9_-]{16,}\b/gi, '<redacted>');
  out = out.replace(
    /(\b[A-Za-z0-9_]*(?:token|secret|password|passwd|api[_-]?key|auth(?:orization)?)[A-Za-z0-9_]*\s*[:=]\s*)(?:"[^"\r\n]*"|'[^'\r\n]*'|[^\s"'<>|;,]+)/gi,
    '$1<redacted>'
  );
  return out;
}

function normalizeCommandClass(input) {
  if (isObject(input)) {
    if (typeof input.commandClass === 'string' && COMMAND_CLASSES.includes(input.commandClass)) {
      return input.commandClass;
    }
    if (input.command !== undefined && input.command !== null) {
      return observations.classifyCommand(input.command);
    }
    return 'shell';
  }
  if (typeof input === 'string' && COMMAND_CLASSES.includes(input)) return input;
  return observations.classifyCommand(input);
}

function detectDiagnosticFamilies(redactedOutput) {
  const families = new Set();
  const text = String(redactedOutput || '');

  // Commitlint diagnostic lines: `✖   <message> [<rule-id>]`
  const commitlintRules = new Set();
  for (const line of text.split(/\r?\n/)) {
    const found = line.match(/^\s*✖\s+[^[]+\[([a-z0-9][a-z0-9_-]{0,40})\]\s*$/);
    if (found) commitlintRules.add(found[1]);
  }
  for (const rule of [...commitlintRules].sort()) {
    families.add(`commitlint-${rule}`);
  }

  // Git non-fast-forward rejection.
  if (/\[rejected\][^\n]*non-fast-forward/i.test(text) ||
      (/failed to push some refs/i.test(text) && /non-fast-forward/i.test(text))) {
    families.add('git-non-fast-forward');
  }

  // npm ERR! / npm error code failure.
  if (/^\s*npm (?:ERR!|error\b)/m.test(text)) {
    families.add('npm-err');
  }

  // EPERM / operation not permitted.
  if (/\bEPERM\b/.test(text) || /operation not permitted/i.test(text)) {
    families.add('eperm');
  }

  return [...families].sort();
}

function normalizeFallbackText(redactedOutput) {
  return String(redactedOutput || '')
    .toLowerCase()
    .replace(/\b\d{4}-\d{2}-\d{2}[t ]\d{2}[:_]\d{2}[:_]\d{2}(?:[._]\d+)?z?\b/g, '<ts>')
    .replace(/[a-z]:\\[^\s"'<>|]+/g, '<path>')
    .replace(/(?:\/[a-z0-9._-]+){2,}/g, '<path>')
    .replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/g, '<uuid>')
    .replace(/\b[0-9a-f]{7,64}\b/g, '<hex>')
    .replace(/:\d+:\d+\b/g, ':<loc>')
    .replace(/\b\d+\b/g, '<n>')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeSignature(input, options = {}) {
  const env = options.env || process.env;
  const cmdClass = normalizeCommandClass(input);
  const rawOutput = isObject(input) ? (input.output ?? input.outputExcerpt ?? '') : String(input || '');
  // Redact BEFORE signature derivation so volatile secrets/paths/emails never affect signatures.
  const redacted = redactErrorText(rawOutput, env);
  const families = detectDiagnosticFamilies(redacted);

  let suffix;
  if (families.length === 1) {
    suffix = families[0];
  } else if (families.length > 1) {
    // Order-independent composite for ambiguous multi-family output (E-0027).
    suffix = `multi-${observations.sha(families.join(','), 8)}`;
  } else {
    const normalized = normalizeFallbackText(redacted);
    suffix = normalized ? `generic-${observations.sha(normalized, 12)}` : 'unknown';
  }

  const candidate = `v1-${cmdClass}-${suffix}`;
  if (candidate.length <= 64 && validIdentifier(candidate)) return candidate;
  return `v1-${cmdClass}-${observations.sha(candidate, 12)}`;
}

function opaqueKey(value) {
  if (typeof value !== 'string' || !value.trim()) return null;
  return observations.sha(value.trim(), 24);
}

function extractWorkspacePath(input, depth = 0) {
  if (typeof input === 'string' && input.trim()) return input.trim();
  if (!isObject(input) || depth > 2) return null;
  for (const key of WORKSPACE_CONTEXT_KEYS) {
    const value = input[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
    if (isObject(value)) {
      const nested = extractWorkspacePath(value, depth + 1);
      if (nested) return nested;
    }
  }
  for (const key of ['workspace', 'project', 'host', 'context']) {
    if (isObject(input[key])) {
      const nested = extractWorkspacePath(input[key], depth + 1);
      if (nested) return nested;
    }
  }
  return null;
}

function extractBoundEnvRoot(env) {
  if (!isObject(env)) return null;
  for (const key of WORKSPACE_ENV_KEYS) {
    if (typeof env[key] === 'string' && env[key].trim()) return env[key].trim();
  }
  return null;
}

function isBoundedWorkspaceKey(value) {
  return typeof value === 'string' && Boolean(value.trim()) && value.length <= 256 && !/[\0\r\n]/.test(value);
}

function resolveCanonicalWorkspaceKey(input, options = {}) {
  const env = options.env || process.env;
  const boundPath = extractWorkspacePath(input) || extractBoundEnvRoot(env);
  if (!boundPath) return null;
  const identity = resolveWorkspaceIdentity({ workspaceRoot: boundPath });
  if (!identity || !identity.workspaceRoot || !identity.workspaceKey || identity.workspaceKey === 'unbound-workspace') {
    return null;
  }
  return identity.workspaceKey;
}

function resolveWriterWorkspaceKey(input, options = {}) {
  const hasSuppliedKey = isObject(input) && input.workspaceKey !== undefined && input.workspaceKey !== null && input.workspaceKey !== '';
  const canonicalKey = resolveCanonicalWorkspaceKey(input, options);
  if (!canonicalKey) {
    throw new Error('invalid workspaceKey: resolvable workspace context required');
  }
  if (hasSuppliedKey) {
    if (!isBoundedWorkspaceKey(input.workspaceKey) || input.workspaceKey.trim() !== canonicalKey) {
      throw new Error('invalid workspaceKey: supplied key disagrees with canonical workspace identity');
    }
  }
  return canonicalKey;
}

function resolveWorkspaceKey(input, options = {}) {
  return resolveWriterWorkspaceKey(input, options);
}

function normalizeHost(value) {
  const host = String(value || 'unknown').trim().toLowerCase();
  return HOSTS.includes(host) ? host : 'unknown';
}

function normalizeDestination(value, strict = false) {
  if (value === undefined || value === null || value === '') return 'unknown';
  if (typeof value === 'string' && DESTINATIONS.includes(value)) return value;
  if (strict) throw new Error(`invalid destination: ${value}`);
  return 'unknown';
}

function normalizeMatchedLedgerIds(ids) {
  if (!Array.isArray(ids)) return [];
  const out = [];
  const seen = new Set();
  for (const item of ids) {
    if (typeof item !== 'string') continue;
    const trimmed = item.trim();
    if (!trimmed || seen.has(trimmed)) continue;
    if (!RECORD_ID_PATTERN.test(trimmed) && !validIdentifier(trimmed)) continue;
    seen.add(trimmed);
    out.push(trimmed);
    if (out.length >= LIMITS.maxMatchedLedgerIds) break;
  }
  return out;
}

function makeProvisionalId(parts) {
  return `p-${observations.sha(JSON.stringify(parts), 20)}`;
}

function validateProvisionalId(id) {
  if (!validIdentifier(id) || RESERVED_E_PREFIX.test(id)) {
    throw new Error('invalid provisionalId: must be a lowercase matcher identifier outside E- namespace');
  }
  return id;
}

function hasTokenShapedValue(value) {
  if (typeof value !== 'string' || !value) return false;
  if (/^(?:Bearer|Basic|Token)\s+\S{8,}/i.test(value)) return true;
  if (/\b(?:gh[pousr]_[A-Za-z0-9_]{20,}|github_pat_[A-Za-z0-9_]{20,})\b/.test(value)) return true;
  if (/\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/.test(value)) return true;
  if (/\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/.test(value)) return true;
  if (/\b(?:sk|pk|rk|ak|pat|tok|xox[baprs])[_-][A-Za-z0-9_-]{16,}\b/i.test(value)) return true;
  if (/^[0-9a-f]{32,}$/i.test(value)) return true;
  if (value.length >= 24 && /^[A-Za-z0-9._~+/=-]+$/.test(value) &&
      /[A-Za-z]/.test(value) && /\d/.test(value) && (/[A-Z]/.test(value) || /[+/=]/.test(value))) {
    return true;
  }
  return false;
}

function validateIssueUrl(url) {
  if (url === undefined || url === null || url === '') return null;
  if (typeof url !== 'string' || url.length > 512 || /[\s\0]/.test(url)) {
    throw new Error('invalid issueUrl');
  }
  let parsed;
  try { parsed = new URL(url); } catch (_) { throw new Error('invalid issueUrl'); }
  if (parsed.protocol !== 'https:') throw new Error('invalid issueUrl: https required');
  if (parsed.username !== '' || parsed.password !== '' || /^https:\/\/[^/?#]*@/i.test(url)) {
    throw new Error('invalid issueUrl: userinfo not allowed');
  }
  for (const [key, value] of parsed.searchParams.entries()) {
    if (SECRET_QUERY_KEY_PATTERN.test(key) || hasTokenShapedValue(value)) {
      throw new Error('invalid issueUrl: credential query parameter not allowed');
    }
  }
  if (parsed.hash) {
    const hashBody = parsed.hash.slice(1);
    if (hasTokenShapedValue(hashBody) || SECRET_FRAGMENT_PARAM_PATTERN.test(hashBody)) {
      throw new Error('invalid issueUrl: credential fragment not allowed');
    }
  }
  return parsed.toString();
}

function validatePromotionId(promotionId) {
  if (promotionId === undefined || promotionId === null || promotionId === '') return null;
  if (typeof promotionId !== 'string' || !RECORD_ID_PATTERN.test(promotionId)) {
    throw new Error('invalid promotionId');
  }
  return promotionId;
}

function effectiveLimits(overrides) {
  if (!isObject(overrides)) return LIMITS;
  const pick = (key, fallback) => (Number.isFinite(overrides[key]) && overrides[key] > 0 ? overrides[key] : fallback);
  return {
    maxExcerptBytes: pick('maxExcerptBytes', LIMITS.maxExcerptBytes),
    maxLessonChars: pick('maxLessonChars', LIMITS.maxLessonChars),
    maxCueChars: pick('maxCueChars', LIMITS.maxCueChars),
    maxMatchedLedgerIds: pick('maxMatchedLedgerIds', LIMITS.maxMatchedLedgerIds),
    maxRecordsPerWorkspace: pick('maxRecordsPerWorkspace', LIMITS.maxRecordsPerWorkspace),
    maxTotalRecords: pick('maxTotalRecords', LIMITS.maxTotalRecords),
    maxIndexBytes: pick('maxIndexBytes', LIMITS.maxIndexBytes),
    defaultLockTimeoutMs: pick('defaultLockTimeoutMs', LIMITS.defaultLockTimeoutMs),
    retentionMs: pick('retentionMs', LIMITS.retentionMs),
  };
}

function evictOne(records, predicate) {
  // Prefer evicting oldest occurrence before evicting any provisional lesson.
  const occIdx = records.findIndex(r => r.kind === 'occurrence' && predicate(r));
  if (occIdx !== -1) { records.splice(occIdx, 1); return true; }
  const anyIdx = records.findIndex(predicate);
  if (anyIdx !== -1) { records.splice(anyIdx, 1); return true; }
  return false;
}

function withinRetention(record, now, retentionMs) {
  const ts = Date.parse(record && record.createdAt || '');
  return !Number.isFinite(ts) || ts > now - retentionMs;
}

function enforceBounds(index, workspaceKey, limits, now) {
  index.records = index.records.filter(r => withinRetention(r, now, limits.retentionMs));

  // Per-workspace cap.
  const inWorkspace = () => index.records.filter(r => r.workspaceKey === workspaceKey).length;
  while (inWorkspace() > limits.maxRecordsPerWorkspace) {
    if (!evictOne(index.records, r => r.workspaceKey === workspaceKey)) break;
  }

  // Global record cap.
  while (index.records.length > limits.maxTotalRecords) {
    if (!evictOne(index.records, () => true)) break;
  }

  // Total index byte cap.
  while (index.records.length > 1 && Buffer.byteLength(JSON.stringify(index), 'utf8') > limits.maxIndexBytes) {
    if (!evictOne(index.records, () => true)) break;
  }
}

function getStorePath(options = {}) {
  const root = options.root || observations.storeRoot(options.env || process.env);
  return { root, file: path.join(root, INDEX_FILE) };
}

function loadIndex(file) {
  const raw = observations.readJson(file, null);
  if (raw && raw.schemaVersion === SCHEMA_VERSION && raw.kind === INDEX_KIND && Array.isArray(raw.records)) {
    return raw;
  }
  return { schemaVersion: SCHEMA_VERSION, kind: INDEX_KIND, records: [] };
}

function appendOccurrence(input, options = {}) {
  try {
    if (!isObject(input)) return { status: 'invalid', record: null };
    const env = options.env || process.env;
    const limits = effectiveLimits(options.limits);
    const { root, file } = getStorePath({ root: options.root, env });
    const now = Number.isFinite(options.now) ? options.now : Date.now();
    const createdAt = typeof input.createdAt === 'string' && Number.isFinite(Date.parse(input.createdAt))
      ? input.createdAt : new Date(now).toISOString();

    let workspaceKey;
    try {
      workspaceKey = resolveWriterWorkspaceKey(input, { env });
    } catch (error) {
      return { status: 'invalid', record: null, error: error && error.message ? error.message : String(error) };
    }
    const host = normalizeHost(input.host);
    const sessionKey = opaqueKey(input.sessionKey);
    const toolUseId = opaqueKey(input.toolUseId);
    const commandClass = normalizeCommandClass(input);
    const rawOutput = input.output ?? input.outputExcerpt ?? '';
    const redactedOutput = redactErrorText(rawOutput, env);
    const outputExcerpt = observations.tailBytes(redactedOutput, limits.maxExcerptBytes);
    const signature = typeof input.signature === 'string' && validIdentifier(input.signature)
      ? input.signature
      : normalizeSignature({ commandClass, output: redactedOutput }, { env });
    const exitCode = Number.isInteger(input.exitCode) ? input.exitCode : null;
    const matchedLedgerIds = normalizeMatchedLedgerIds(input.matchedLedgerIds);
    const destination = normalizeDestination(input.destination, false);

    const hasIdempotencyKey = Boolean(sessionKey && toolUseId);
    const provisionalId = hasIdempotencyKey
      ? makeProvisionalId(['occurrence', workspaceKey, host, sessionKey, toolUseId])
      : makeProvisionalId(['occurrence', workspaceKey, host, signature, createdAt, crypto.randomBytes(8).toString('hex')]);

    const record = {
      schemaVersion: SCHEMA_VERSION,
      kind: 'occurrence',
      provisionalId,
      workspaceKey,
      destination,
      createdAt,
      signature,
      source: 'tool-failure',
      host,
      sessionKey,
      toolUseId,
      commandClass,
      exitCode,
      outputExcerpt,
      matchedLedgerIds,
    };

    const lockTimeoutMs = Number.isFinite(options.lockTimeoutMs) && options.lockTimeoutMs >= 0
      ? options.lockTimeoutMs : limits.defaultLockTimeoutMs;

    let outcome = null;
    let saved = record;
    const locked = observations.withLock(root, () => {
      const index = loadIndex(file);
      if (hasIdempotencyKey) {
        const existing = index.records.find(r =>
          r.kind === 'occurrence' &&
          r.host === host &&
          r.workspaceKey === workspaceKey &&
          r.sessionKey === sessionKey &&
          r.toolUseId === toolUseId
        );
        if (existing) {
          outcome = 'duplicate';
          saved = existing;
          return;
        }
      }
      index.records.push(record);
      enforceBounds(index, workspaceKey, limits, now);
      observations.writeJsonAtomic(file, index);
      outcome = 'appended';
    }, { timeoutMs: lockTimeoutMs });

    if (!locked) return { status: 'lock-timeout', record: null };
    return { status: outcome || 'appended', record: saved };
  } catch (error) {
    return { status: 'error', record: null, error: error && error.message ? error.message : String(error) };
  }
}

function addProvisionalLesson(input, options = {}) {
  if (!isObject(input)) throw new Error('invalid provisional lesson input');
  const env = options.env || process.env;
  const limits = effectiveLimits(options.limits);
  const { root, file } = getStorePath({ root: options.root, env });
  const now = Number.isFinite(options.now) ? options.now : Date.now();
  const createdAt = typeof input.createdAt === 'string' && Number.isFinite(Date.parse(input.createdAt))
    ? input.createdAt : new Date(now).toISOString();

  const workspaceKey = resolveWriterWorkspaceKey(input, { env });
  const destination = normalizeDestination(input.destination, true);
  if (!validIdentifier(input.signature)) throw new Error('invalid signature');
  const match = validateMatch(input.match);

  if (typeof input.lesson !== 'string' || !input.lesson.trim()) throw new Error('invalid lesson');
  const lesson = redactErrorText(input.lesson.trim(), env).slice(0, limits.maxLessonChars);
  if (!lesson.trim()) throw new Error('invalid lesson');

  let cue;
  if (input.cue !== undefined && input.cue !== null) {
    if (typeof input.cue !== 'string') throw new Error('invalid cue');
    cue = redactErrorText(input.cue.trim(), env).slice(0, limits.maxCueChars);
  }

  const issueUrl = validateIssueUrl(input.issueUrl);
  const promotionId = validatePromotionId(input.promotionId);

  const provisionalId = input.provisionalId !== undefined && input.provisionalId !== null
    ? validateProvisionalId(input.provisionalId)
    : makeProvisionalId(['provisional-lesson', workspaceKey, input.signature, match, lesson]);

  const record = {
    schemaVersion: SCHEMA_VERSION,
    kind: 'provisional-lesson',
    provisionalId,
    workspaceKey,
    destination,
    createdAt,
    signature: input.signature,
    match,
    lesson,
    ...(cue !== undefined ? { cue } : {}),
    issueUrl,
    promotionId,
  };

  const lockTimeoutMs = Number.isFinite(options.lockTimeoutMs) && options.lockTimeoutMs >= 0
    ? options.lockTimeoutMs : limits.defaultLockTimeoutMs;

  let outcome = null;
  let saved = record;
  const locked = observations.withLock(root, () => {
    const index = loadIndex(file);
    const existing = index.records.find(r =>
      r.kind === 'provisional-lesson' &&
      r.workspaceKey === workspaceKey &&
      r.provisionalId === provisionalId
    );
    if (existing) {
      outcome = 'duplicate';
      saved = existing;
      return;
    }
    index.records.push(record);
    enforceBounds(index, workspaceKey, limits, now);
    observations.writeJsonAtomic(file, index);
    outcome = 'appended';
  }, { timeoutMs: lockTimeoutMs });

  if (!locked) return { status: 'lock-timeout', record: null };
  return { status: outcome || 'appended', record: saved };
}

function listRecords(options = {}) {
  try {
    const env = options.env || process.env;
    const limits = effectiveLimits(options.limits);
    const now = Number.isFinite(options.now) ? options.now : Date.now();
    const { file } = getStorePath({ root: options.root, env });
    const index = loadIndex(file);
    let targetWorkspace = null;
    const hasWorkspaceContext = Boolean(extractWorkspacePath(options));
    const hasSuppliedKey = options.workspaceKey !== undefined && options.workspaceKey !== null && options.workspaceKey !== '';
    if (hasWorkspaceContext) {
      const canonicalKey = resolveCanonicalWorkspaceKey(options, { env });
      if (!canonicalKey) return [];
      if (hasSuppliedKey) {
        if (!isBoundedWorkspaceKey(options.workspaceKey) || options.workspaceKey.trim() !== canonicalKey) {
          return [];
        }
      }
      targetWorkspace = canonicalKey;
    } else if (hasSuppliedKey) {
      if (!isBoundedWorkspaceKey(options.workspaceKey)) return [];
      targetWorkspace = options.workspaceKey.trim();
    }
    let records = index.records.filter(record => {
      if (!isObject(record)) return false;
      if (!withinRetention(record, now, limits.retentionMs)) return false;
      if (targetWorkspace && record.workspaceKey !== targetWorkspace) return false;
      if (options.kind && record.kind !== options.kind) return false;
      if (options.destination && record.destination !== options.destination) return false;
      if (options.signature && record.signature !== options.signature) return false;
      return true;
    });
    if (Number.isInteger(options.limit) && options.limit >= 0) {
      records = records.slice(-options.limit);
    }
    return records.map(r => JSON.parse(JSON.stringify(r)));
  } catch (_) {
    return [];
  }
}

module.exports = {
  SCHEMA_VERSION,
  INDEX_FILE,
  INDEX_KIND,
  DESTINATIONS,
  COMMAND_CLASSES,
  LIMITS,
  getStorePath,
  resolveWorkspaceKey,
  redactErrorText,
  normalizeSignature,
  validateMatch,
  appendOccurrence,
  addProvisionalLesson,
  listRecords,
};
