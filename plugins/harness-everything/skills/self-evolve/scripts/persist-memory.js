#!/usr/bin/env node
'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
let getWorkspaceRoot;
let getWorkspaceStateDir;
let getWorkspaceKey;
try {
  ({ getWorkspaceRoot, getWorkspaceStateDir, getWorkspaceKey } = require('../../scripts/lib/workspace'));
} catch (err) {
  getWorkspaceRoot = () => null;
  getWorkspaceStateDir = () => null;
  getWorkspaceKey = () => null;
}

// NOTE: this script ships standalone - it is copied whole into every install
// target. When the canonical workspace resolver is not present, persistence
// fails closed rather than guessing a project root (issue #42).

const SECRET_PATTERNS = [
  ['github-token', /\bgh[pousr]_[A-Za-z0-9]{20,}\b/],
  ['openai-key', /\bsk-(?:proj-)?[A-Za-z0-9_-]{20,}\b/],
  ['aws-access-key', /\bAKIA[0-9A-Z]{16}\b/],
  ['private-key', /-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----/],
  ['jwt', /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/],
  ['credential-assignment', /\b(?:api[_-]?key|access[_-]?token|auth[_-]?token|password|passwd|secret)\s*[:=]\s*["']?[A-Za-z0-9_./+=:-]{8,}/i],
];

const INJECTION_PATTERNS = [
  ['ignore-prior-instructions', /\bignore\s+(?:all\s+)?(?:previous|prior|above)\s+(?:instructions|messages|rules)\b/i],
  ['replace-instructions', /\b(?:follow|obey)\s+(?:these|the following)\s+instructions\s+instead\b/i],
  ['role-override', /\byou\s+are\s+now\b/i],
  ['instruction-override', /\boverride\s+(?:the\s+)?(?:system|developer|safety|previous|prior)\s+(?:instructions|message|prompt|rules)\b/i],
  ['system-prompt-exfiltration', /\b(?:reveal|print|show|expose)\s+(?:the\s+)?(?:system|developer)\s+prompt\b/i],
  ['role-token', /<\|(?:system|developer|assistant)\|>/i],
  ['jailbreak-marker', /\b(?:jailbreak|prompt[- ]injection)\b/i],
];

function parseArgs(argv) {
  const parsed = {
    help: false,
    memoryText: null,
    source: 'manual-unspecified',
    authorization: null,
    validUntil: null,
    retentionDays: null,
    scopeTask: null,
    scopeRequirement: null,
    scopeRole: null,
  };
  const valued = new Map([
    ['--source', 'source'],
    ['--authorization', 'authorization'],
    ['--valid-until', 'validUntil'],
    ['--retention-days', 'retentionDays'],
    ['--scope-task', 'scopeTask'],
    ['--scope-requirement', 'scopeRequirement'],
    ['--scope-role', 'scopeRole'],
  ]);
  for (let index = 0; index < argv.length; index++) {
    const token = argv[index];
    if (token === '--help' || token === '-h') {
      parsed.help = true;
      continue;
    }
    const direct = valued.get(token);
    if (direct) {
      if (index + 1 >= argv.length) throw new Error(`${token} requires a value`);
      parsed[direct] = argv[++index];
      continue;
    }
    const equals = [...valued.entries()].find(([flag]) => token.startsWith(`${flag}=`));
    if (equals) {
      parsed[equals[1]] = token.slice(equals[0].length + 1);
      continue;
    }
    if (token.startsWith('-')) throw new Error(`unknown option: ${token}`);
    if (parsed.memoryText !== null) throw new Error('exactly one memory rule positional argument is allowed');
    parsed.memoryText = token;
  }
  if (parsed.retentionDays !== null) {
    const days = Number(parsed.retentionDays);
    if (!Number.isInteger(days) || days < 1 || days > 3650) throw new Error('--retention-days must be an integer from 1 to 3650');
    parsed.retentionDays = days;
  }
  return parsed;
}
function normalizeSource(value) {
  const source = String(value || 'manual-unspecified').trim();
  if (!source) return 'manual-unspecified';
  if (/[\r\n\0]/.test(source)) throw new Error('source provenance must be one line');
  if (source.length > 240) throw new Error('source provenance exceeds 240 characters');
  const secretReasons = detectReasonCodes(source, SECRET_PATTERNS);
  if (secretReasons.length > 0) throw new Error(`source provenance rejected by secret screening: ${secretReasons.join(', ')}`);
  return source;
}

function detectReasonCodes(text, patterns) {
  const reasons = [];
  for (const [reasonCode, pattern] of patterns) {
    if (pattern.test(text)) reasons.push(reasonCode);
  }
  return reasons;
}

function screenMemoryForPersistence(text) {
  const value = String(text || '');
  const secretReasonCodes = detectReasonCodes(value, SECRET_PATTERNS);
  const injectionReasonCodes = detectReasonCodes(value, INJECTION_PATTERNS);
  return {
    allowed: secretReasonCodes.length === 0 && injectionReasonCodes.length === 0,
    secretReasonCodes,
    injectionReasonCodes,
  };
}

function calculateSimilarity(text1, text2) {
  const words1 = text1.toLowerCase().split(/\s+/);
  const words2 = text2.toLowerCase().split(/\s+/);
  const set1 = new Set(words1);
  const set2 = new Set(words2);
  let intersection = 0;
  for (const word of set1) {
    if (set2.has(word)) intersection++;
  }
  const union = set1.size + set2.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

function scoreRuleQuality(ruleText, existingRules = []) {
  let score = 0;
  if (/\.\w{2,4}/.test(ruleText)) score += 2;
  if (/Error|Exception|Warning|錯誤|異常|警告/.test(ruleText)) score += 2;
  if (/\b(test|lint|build|verify|check|測試|檢查)\b/i.test(ruleText)) score += 1;
  if (/^(Always|Never|Check|Verify|Prefer|Avoid|Use|不要|總是|檢查|驗證|避免|使用)/i.test(ruleText)) score += 3;
  if (/^(should|must|will|needs? to|ought|應該|必須|需要)/i.test(ruleText)) score += 2;
  const isDuplicate = existingRules.some(existing => calculateSimilarity(ruleText, existing) > 0.7);
  if (!isDuplicate) score += 3;
  if (ruleText.length > 20 && ruleText.length < 200) score += 1;
  return Math.min(score, 10);
}

function extractExistingRules(rulesFile) {
  if (!fs.existsSync(rulesFile)) return [];
  try {
    const content = fs.readFileSync(rulesFile, 'utf8');
    const ruleMatches = content.match(/^- .+$/gm) || [];
    return ruleMatches.map(rule => rule.substring(2));
  } catch (err) {
    return [];
  }
}

function contentHash(text) {
  return crypto.createHash('sha256').update(String(text), 'utf8').digest('hex');
}

const MEMORY_INDEX_SCHEMA_VERSION = 1;
const PARAPHRASE_REVIEW_THRESHOLD = 0.45;
const DUPLICATE_REVIEW_THRESHOLD = 0.70;

function readJson(filePath) {
  try { return JSON.parse(fs.readFileSync(filePath, 'utf8')); } catch (_) { return null; }
}

function atomicWriteJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const temporary = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  fs.renameSync(temporary, filePath);
}

function atomicWriteText(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const temporary = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(temporary, value, 'utf8');
  fs.renameSync(temporary, filePath);
}

function safeSessionName(sessionId) {
  const value = String(sessionId || '').replace(/[^A-Za-z0-9._-]+/g, '_').replace(/^\.+/, '').slice(0, 128);
  return value || null;
}

function listWorkflowAuthorizations(workspaceRoot, capability) {
  if (!workspaceRoot || typeof getWorkspaceStateDir !== 'function' || !capability) return [];
  const stateDir = getWorkspaceStateDir(workspaceRoot);
  if (!stateDir) return [];
  const sessionsRoot = path.join(stateDir, 'state', 'sessions');
  let entries = [];
  try { entries = fs.readdirSync(sessionsRoot, { withFileTypes: true }); } catch (_) { return []; }
  const wantedHash = contentHash(capability);
  const matches = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const workflowFile = path.join(sessionsRoot, entry.name, 'workflow-run.json');
    const workflow = readJson(workflowFile);
    const auth = workflow && workflow.memoryAuthorization;
    if (!workflow || workflow.schemaVersion !== 2 || !workflow.workflowId || !workflow.sessionId || !auth) continue;
    if (auth.schemaVersion !== 1 || auth.capabilityHash !== wantedHash || auth.usedAt) continue;
    if (auth.workflowId !== workflow.workflowId || auth.sessionId !== workflow.sessionId) continue;
    if (safeSessionName(workflow.sessionId) !== entry.name) continue;
    const disposition = workflow.workflowPlan && workflow.workflowPlan.memory && workflow.workflowPlan.memory.write;
    if (auth.writeDisposition !== disposition || !['none', 'propose', 'persist-via-self-evolve'].includes(disposition)) continue;
    if (['blocked', 'failed', 'deferred'].includes(workflow.state)) continue;
    let effectiveDisposition = disposition;
    const reasonCodes = [];
    if (disposition === 'persist-via-self-evolve' && String(workflow.strategy || '').startsWith('fable-') &&
        workflow.runId && workflow.state !== 'satisfied') {
      effectiveDisposition = 'propose';
      reasonCodes.push('active-fable-worker-candidate-only');
    }
    matches.push({
      workflowFile,
      sessionDir: path.dirname(workflowFile),
      workflow,
      sessionId: workflow.sessionId,
      workflowId: workflow.workflowId,
      runId: workflow.runId || null,
      writerRole: auth.writerRole || 'coordinator',
      disposition,
      effectiveDisposition,
      reasonCodes,
    });
  }
  return matches;
}

function resolveMemoryAuthorization(workspaceRoot, capability) {
  if (!capability) return { ok: false, message: 'memory write requires the single-use workflow authorization capability' };
  const matches = listWorkflowAuthorizations(workspaceRoot, capability);
  if (matches.length !== 1) {
    return { ok: false, message: matches.length === 0 ? 'memory authorization is invalid, used, expired, or not bound to this workspace' : 'memory authorization is ambiguous across runtime sessions' };
  }
  return { ok: true, ...matches[0] };
}

function consumeAuthorization(auth, resultDisposition) {
  const workflow = readJson(auth.workflowFile);
  if (!workflow || workflow.workflowId !== auth.workflowId || workflow.sessionId !== auth.sessionId ||
      !workflow.memoryAuthorization || workflow.memoryAuthorization.usedAt) {
    throw new Error('memory authorization changed before commit; refusing write');
  }
  workflow.memoryAuthorization.usedAt = new Date().toISOString();
  workflow.memoryAuthorization.resultDisposition = resultDisposition;
  atomicWriteJson(auth.workflowFile, workflow);
}

function normalizeTerms(value) {
  const stop = new Set(['the','and','for','with','from','this','that','into','when','then','before','after','always','never','should','must','use','using','verify','check']);
  const matches = String(value || '').toLowerCase().match(/[\p{L}\p{N}][\p{L}\p{N}._-]{1,}/gu) || [];
  return [...new Set(matches.filter(term => !stop.has(term)))].slice(0, 48);
}

function normalizeRoles(value) {
  return [...new Set(String(value || '').split(',').map(item => item.trim().toLowerCase()).filter(Boolean))].slice(0, 16);
}

function resolveValidUntil(validUntil, retentionDays) {
  if (validUntil && retentionDays) throw new Error('use either --valid-until or --retention-days, not both');
  if (retentionDays) return new Date(Date.now() + retentionDays * 86400000).toISOString();
  if (!validUntil) return null;
  const timestamp = Date.parse(validUntil);
  if (!Number.isFinite(timestamp)) throw new Error('--valid-until must be an ISO-8601 date/time');
  if (timestamp <= Date.now()) throw new Error('--valid-until must be in the future');
  return new Date(timestamp).toISOString();
}

function loadMemoryIndex(indexFile) {
  if (!fs.existsSync(indexFile)) return { schemaVersion: MEMORY_INDEX_SCHEMA_VERSION, records: [] };
  const parsed = readJson(indexFile);
  if (!parsed || parsed.schemaVersion !== MEMORY_INDEX_SCHEMA_VERSION || !Array.isArray(parsed.records)) {
    throw new Error('memory-index.json is malformed; refusing to overwrite durable metadata');
  }
  return parsed;
}

function maxSimilarity(ruleText, existingRules) {
  let best = { score: 0, text: null };
  for (const existing of existingRules) {
    const score = calculateSimilarity(ruleText, existing);
    if (score > best.score) best = { score, text: existing };
  }
  return best;
}

function writeCandidate(auth, record) {
  const candidateDir = path.join(auth.sessionDir, 'memory-candidates');
  const candidateFile = path.join(candidateDir, `${record.candidateId}.json`);
  atomicWriteJson(candidateFile, record);
  consumeAuthorization(auth, record.status);
  return candidateFile;
}

function candidateRecord(auth, ruleText, provenance, screening, qualityScore, similarity, reasonCodes, scope) {
  const hash = contentHash(ruleText);
  return {
    schemaVersion: 1,
    candidateId: `candidate-${hash.slice(0, 20)}`,
    contentSha256: hash,
    ruleText,
    source: provenance,
    status: 'proposed',
    reasonCodes: [...new Set(reasonCodes)],
    qualityScore,
    screening: { secret: 'clear', promptInjection: 'clear' },
    similarity: similarity.score > 0 ? { score: similarity.score, existingRule: similarity.text } : null,
    scope,
    authorization: {
      sessionId: auth.sessionId,
      workflowId: auth.workflowId,
      runId: auth.runId,
      writerRole: auth.writerRole,
      requestedDisposition: auth.disposition,
      effectiveDisposition: auth.effectiveDisposition,
    },
    createdAt: new Date().toISOString(),
  };
}

function persistMemory({
  memoryText,
  source = 'manual-unspecified',
  authorization = null,
  validUntil = null,
  retentionDays = null,
  scopeTask = null,
  scopeRequirement = null,
  scopeRole = null,
}) {
  const ruleText = String(memoryText || '').trim();
  if (!ruleText) return { ok: false, exitCode: 1, message: 'memory rule is required' };

  const screening = screenMemoryForPersistence(ruleText);
  if (!screening.allowed) {
    const reasons = [...screening.secretReasonCodes, ...screening.injectionReasonCodes];
    return { ok: false, exitCode: 2, screening, message: `memory rejected by persistence screening: ${reasons.join(', ')}` };
  }

  let provenance;
  let resolvedValidUntil;
  try {
    provenance = normalizeSource(source);
    resolvedValidUntil = resolveValidUntil(validUntil, retentionDays);
  } catch (err) {
    return { ok: false, exitCode: 2, screening, message: err.message };
  }

  const currentDir = getWorkspaceRoot();
  if (!currentDir) {
    return { ok: false, exitCode: 1, screening, message: 'Cannot persist project memory without a resolved git workspace.' };
  }

  const auth = resolveMemoryAuthorization(currentDir, authorization);
  if (!auth.ok) {
    return { ok: false, exitCode: 3, screening, message: auth.message };
  }
  if (auth.effectiveDisposition === 'none') {
    return { ok: false, exitCode: 3, screening, message: 'current workflow memory.write=none forbids durable memory and proposals' };
  }

  const memoryDir = path.join(currentDir, 'memories', 'repo');
  const rulesFile = path.join(memoryDir, 'RULES.md');
  const indexFile = path.join(memoryDir, 'memory-index.json');
  const existingRules = extractExistingRules(rulesFile);
  const similarity = maxSimilarity(ruleText, existingRules);
  const qualityScore = scoreRuleQuality(ruleText, existingRules);
  const baseQualityScore = scoreRuleQuality(ruleText, []);
  if (Math.max(qualityScore, baseQualityScore) < 5) {
    return { ok: false, exitCode: 1, screening, qualityScore, message: `Rule rejected - score ${qualityScore}/10 (minimum 5 required)` };
  }

  const scope = {
    taskTerms: normalizeTerms(scopeTask || ruleText),
    requirementTerms: normalizeTerms(scopeRequirement),
    roles: normalizeRoles(scopeRole),
  };
  const candidateReasons = [...auth.reasonCodes];
  if (similarity.score > DUPLICATE_REVIEW_THRESHOLD) candidateReasons.push('likely-duplicate-review-required');
  else if (similarity.score >= PARAPHRASE_REVIEW_THRESHOLD) candidateReasons.push('possible-paraphrase-review-required');

  if (auth.effectiveDisposition === 'propose' || candidateReasons.some(reason => /review-required$/.test(reason))) {
    if (auth.effectiveDisposition === 'propose') candidateReasons.push('workflow-proposal-only');
    const candidate = candidateRecord(auth, ruleText, provenance, screening, Math.max(qualityScore, baseQualityScore), similarity, candidateReasons, scope);
    const candidateFile = writeCandidate(auth, candidate);
    return {
      ok: true,
      exitCode: 0,
      persisted: false,
      disposition: 'proposed',
      candidateFile,
      qualityScore: candidate.qualityScore,
      source: provenance,
      contentSha256: candidate.contentSha256,
      screening,
      reasonCodes: candidate.reasonCodes,
    };
  }

  if (auth.effectiveDisposition !== 'persist-via-self-evolve') {
    return { ok: false, exitCode: 3, screening, message: `unsupported memory.write disposition: ${auth.effectiveDisposition}` };
  }

  const hash = contentHash(ruleText);
  const now = new Date().toISOString();
  const record = {
    schemaVersion: 1,
    id: `mem-${hash.slice(0, 20)}`,
    contentSha256: hash,
    ruleText,
    source: provenance,
    status: 'active',
    createdAt: now,
    reviewedAt: now,
    validUntil: resolvedValidUntil,
    workspaceKey: typeof getWorkspaceKey === 'function' ? getWorkspaceKey(currentDir) : null,
    writer: {
      sessionId: auth.sessionId,
      workflowId: auth.workflowId,
      runId: auth.runId,
      role: auth.writerRole,
      disposition: auth.disposition,
    },
    screening: { secret: 'clear', promptInjection: 'clear' },
    qualityScore,
    scope,
  };

  fs.mkdirSync(memoryDir, { recursive: true });
  const index = loadMemoryIndex(indexFile);
  if (index.records.some(item => item.contentSha256 === hash && item.status !== 'superseded')) {
    const candidate = candidateRecord(auth, ruleText, provenance, screening, Math.max(qualityScore, baseQualityScore), { score: 1, text: ruleText }, ['indexed-duplicate-review-required'], scope);
    const candidateFile = writeCandidate(auth, candidate);
    return { ok: true, exitCode: 0, persisted: false, disposition: 'proposed', candidateFile, qualityScore, source: provenance, contentSha256: hash, screening, reasonCodes: candidate.reasonCodes };
  }

  const timestamp = now.slice(0, 10);
  const formattedMemory = [
    '',
    `## [${timestamp}] Self-Evolution Insight (Quality: ${qualityScore}/10)`,
    `Memory-ID: ${record.id}`,
    `Source: ${provenance}`,
    `Content-SHA256: ${hash}`,
    `Retention: ${resolvedValidUntil ? `valid-until=${resolvedValidUntil}` : 'no-explicit-expiry'}`,
    'Screening: secret=clear; prompt-injection=clear',
    `- ${ruleText}`,
    '',
  ].join('\n');

  const previousRules = fs.existsSync(rulesFile) ? fs.readFileSync(rulesFile, 'utf8') : '';
  const nextIndex = { ...index, updatedAt: now, records: [...index.records, record] };
  try {
    atomicWriteText(rulesFile, previousRules + formattedMemory);
    atomicWriteJson(indexFile, nextIndex);
  } catch (err) {
    try { atomicWriteText(rulesFile, previousRules); } catch (_) { /* best-effort rollback */ }
    throw err;
  }
  consumeAuthorization(auth, 'persisted');

  return {
    ok: true,
    exitCode: 0,
    persisted: true,
    disposition: 'persisted',
    rulesFile,
    indexFile,
    memoryId: record.id,
    qualityScore,
    source: provenance,
    contentSha256: hash,
    screening,
    validUntil: resolvedValidUntil,
  };
}
function printHelp() {
  console.log(`Persist or propose a defensive project-memory rule under the active Harness workflow contract.

Usage:
  node persist-memory.js "<insight>" --authorization <single-use-capability> [options]

Options:
  --source <provenance>
  --valid-until <ISO-8601> | --retention-days <1..3650>
  --scope-task <task context>
  --scope-requirement <requirement ids/text>
  --scope-role <comma-separated roles>

Authorization behavior:
- memory.write=none: reject
- memory.write=propose: write only a session-scoped review candidate
- memory.write=persist-via-self-evolve: persist after screening/quality/dedup checks
- active Fable runs remain candidate-only so workers cannot directly mutate durable memory
- the opaque capability is issued by the router and bound to one workflow/session; --role/--session-id self-claims are not accepted

Durable metadata is stored in memories/repo/memory-index.json. Expiry never deletes the rule; scoped retrieval excludes stale/expired/unrelated records and treats retrieved memory as untrusted data.`);
}
if (require.main === module) {
  let parsed;
  try {
    parsed = parseArgs(process.argv.slice(2));
  } catch (err) {
    console.error(`[self-evolve] ${err.message}`);
    process.exit(1);
  }

  if (parsed.help) {
    printHelp();
    process.exit(0);
  }
  if (!parsed.memoryText) {
    console.error('Usage: node persist-memory.js "<insight to remember>" --authorization <single-use-capability> [options]');
    process.exit(1);
  }

  try {
    const result = persistMemory(parsed);
    if (!result.ok) {
      const prefix = result.exitCode === 2 ? '[Persistence Screening]' : '[Quality Gate]';
      console.error(`${prefix} ${result.message}`);
      if (result.qualityScore !== undefined && result.qualityScore < 5) {
        console.error('Suggestions to improve:');
        console.error('- Be more specific (mention file types, error patterns)');
        console.error('- Start with action verbs (Always, Never, Check, Verify)');
        console.error('- Ensure the rule is actionable and not already captured');
      }
      process.exit(result.exitCode);
    }
    if (result.persisted) console.log(`[Success] Memory persisted to ${result.rulesFile} (Quality: ${result.qualityScore}/10, Source: ${result.source})`);
    else console.log(`[Candidate] Memory proposal written to ${result.candidateFile} (${(result.reasonCodes || []).join(', ') || 'proposal-only'})`);
  } catch (err) {
    console.error(`[Error] Failed to write memory: ${err.message}`);
    process.exit(1);
  }
}

module.exports = {
  calculateSimilarity,
  contentHash,
  extractExistingRules,
  parseArgs,
  persistMemory,
  scoreRuleQuality,
  screenMemoryForPersistence,
  resolveMemoryAuthorization,
  normalizeTerms,
  loadMemoryIndex,
  MEMORY_INDEX_SCHEMA_VERSION,
};
