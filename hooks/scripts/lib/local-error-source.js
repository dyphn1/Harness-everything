'use strict';
// Provisional local lesson source reader (#496 C2) for hooks/scripts/lib/ledger-match.js.
// Reads workspace-scoped provisional lessons from local-errors.js on each lookup,
// projecting only the bounded matcher fields and failing open on any store error.

const localErrors = require('./local-errors');

const IDENTIFIER_PATTERN = /^[a-z0-9][a-z0-9_-]{0,63}$/;
const RECORD_ID_PATTERN = /^E-\d{4,}$/;
const RESERVED_E_PREFIX = /^E-/i;
const DEFAULT_MAX_CANDIDATES = 32;
const DEFAULT_MAX_BYTES = 64 * 1024;
const DEFAULT_MAX_TEXT_CHARS = 4096;

function validIdentifier(value) {
  return typeof value === 'string' && IDENTIFIER_PATTERN.test(value);
}

function projectProvisionalRecord(record, maxTextChars) {
  if (!record || typeof record !== 'object' || record.kind !== 'provisional-lesson') return null;

  const identity = record.provisionalId;
  if (!validIdentifier(identity) || RESERVED_E_PREFIX.test(identity)) return null;

  if (typeof record.lesson !== 'string') return null;
  const lesson = record.lesson.trim().slice(0, maxTextChars);
  if (!lesson) return null;

  let match;
  try {
    match = localErrors.validateMatch(record.match);
  } catch (_) {
    return null;
  }

  const candidate = { identity, match, lesson };

  if (validIdentifier(record.signature)) {
    candidate.signature = record.signature;
  }

  if (typeof record.promotionId === 'string' && RECORD_ID_PATTERN.test(record.promotionId)) {
    candidate.promotionId = record.promotionId;
  }

  if (typeof record.cue === 'string') {
    candidate.cue = record.cue.slice(0, maxTextChars);
  }

  return candidate;
}

// Mirror ledger-match.js validProvisionalCandidate shape when checking byte budget
// so readProvisional's serialized byte check cannot fail on accepted candidates.
function matcherSerializedBytes(candidates) {
  const transformed = candidates.map(candidate => ({
    id: candidate.identity,
    identity: candidate.signature ? `signature:${candidate.signature}` : `identity:${candidate.identity}`,
    signature: candidate.signature || null,
    promotionId: candidate.promotionId || null,
    match: candidate.match,
    cue: candidate.cue || '',
    lesson: candidate.lesson,
    source: 'provisional',
  }));
  return Buffer.byteLength(JSON.stringify(transformed), 'utf8');
}

function createProvisionalSource(options = {}) {
  const env = options && options.env ? options.env : process.env;
  const root = options && typeof options.root === 'string' && options.root ? options.root : undefined;
  const boundWorkspaceRoot = options && typeof options.workspaceRoot === 'string' && options.workspaceRoot.trim()
    ? options.workspaceRoot.trim()
    : null;

  return function provisionalSource(workspaceIdentity, budget = {}) {
    try {
      const maxCandidates = Number.isInteger(budget && budget.maxCandidates) && budget.maxCandidates > 0
        ? budget.maxCandidates
        : DEFAULT_MAX_CANDIDATES;
      const maxBytes = Number.isInteger(budget && budget.maxBytes) && budget.maxBytes > 0
        ? budget.maxBytes
        : DEFAULT_MAX_BYTES;
      const maxTextChars = Number.isInteger(budget && budget.maxTextChars) && budget.maxTextChars > 0
        ? budget.maxTextChars
        : DEFAULT_MAX_TEXT_CHARS;

      const query = {
        env,
        kind: 'provisional-lesson',
        ...(root ? { root } : {}),
      };

      if (boundWorkspaceRoot) {
        query.workspaceRoot = boundWorkspaceRoot;
      } else if (typeof workspaceIdentity === 'string' && workspaceIdentity.trim()) {
        query.workspaceKey = workspaceIdentity.trim();
      } else {
        return [];
      }

      const records = localErrors.listRecords(query);
      if (!Array.isArray(records) || !records.length) return [];

      const projected = [];
      for (const record of records) {
        if (projected.length >= maxCandidates) break;
        const candidate = projectProvisionalRecord(record, maxTextChars);
        if (!candidate) continue;
        const next = [...projected, candidate];
        if (Buffer.byteLength(JSON.stringify(next), 'utf8') > maxBytes) continue;
        if (matcherSerializedBytes(next) > maxBytes) continue;
        projected.push(candidate);
      }
      return projected;
    } catch (_) {
      return [];
    }
  };
}

module.exports = {
  createProvisionalSource,
  projectProvisionalRecord,
};
