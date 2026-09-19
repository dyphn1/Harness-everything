#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { contentHash, scoreRuleQuality, screenMemoryForPersistence } = require('./persist-memory');

let emitLessonTelemetry = () => ({ ok: false, unavailable: true });
for (const relative of [
  '../../hooks/scripts/lib/telemetry.js',
  '../../../hooks/scripts/lib/telemetry.js',
]) {
  const candidate = path.resolve(__dirname, relative);
  if (fs.existsSync(candidate)) {
    ({ emitLessonTelemetry } = require(candidate));
    break;
  }
}

let getWorkspaceRoot;
let getWorkspaceStateDir;
try {
  ({ getWorkspaceRoot, getWorkspaceStateDir } = require('../../scripts/lib/workspace'));
} catch (_) {
  getWorkspaceRoot = () => null;
  getWorkspaceStateDir = () => null;
}

const SCHEMA_VERSION = 1;
const TERMINAL = new Set(['rejected', 'validated', 'regressed', 'superseded']);
const OUTCOME_STATES = new Set(['retrieved', 'validated', 'regressed', 'superseded']);

function safeSessionName(value) {
  const text = String(value || 'default').replace(/[^A-Za-z0-9._-]+/g, '_').replace(/^\.+/, '').slice(0, 128);
  return text || 'default';
}

function atomicWriteJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const temporary = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  fs.renameSync(temporary, filePath);
}

function readJson(filePath) {
  try { return JSON.parse(fs.readFileSync(filePath, 'utf8')); } catch (_) { return null; }
}

function candidatePath(workspace, sessionId, candidateId) {
  if (!workspace || !getWorkspaceStateDir(workspace)) throw new Error('workspace state root is unavailable');
  if (!/^lesson-[a-f0-9]{24}$/.test(String(candidateId || ''))) throw new Error('invalid candidate id');
  return path.join(
    getWorkspaceStateDir(workspace),
    'state',
    'sessions',
    safeSessionName(sessionId),
    'learning-candidates',
    `${candidateId}.json`,
  );
}

function loadCandidate({ workspace, sessionId, candidateId }) {
  const file = candidatePath(workspace, sessionId, candidateId);
  const candidate = readJson(file);
  if (!candidate || candidate.schemaVersion !== SCHEMA_VERSION || candidate.candidateId !== candidateId) {
    throw new Error('lesson candidate not found or malformed');
  }
  return { file, candidate };
}

function pushState(candidate, state, reasonCode, evidenceRef = null) {
  const now = new Date().toISOString();
  candidate.state = state;
  candidate.updatedAt = now;
  candidate.history = [...(candidate.history || []), {
    state,
    observedAt: now,
    reasonCode,
    evidenceRef: evidenceRef || null,
  }].slice(-32);
}

function emitCandidateLifecycle(input, candidate, event, state, status = 'unknown') {
  const history = [...(candidate.history || [])].reverse().find(item => item.state === state);
  const reasonCodes = [
    history && history.reasonCode,
    candidate.trigger && candidate.trigger.type ? `trigger:${candidate.trigger.type}` : null,
    ...(candidate.evaluation && Array.isArray(candidate.evaluation.reasonCodes) ? candidate.evaluation.reasonCodes : []),
  ].filter(Boolean);
  return emitLessonTelemetry({
    event,
    root: input.workspace,
    sessionId: input.sessionId || (candidate.provenance && candidate.provenance.sessionId),
    candidateId: candidate.candidateId,
    observedAt: history && history.observedAt,
    status,
    reasonCodes,
  });
}

function replayability(candidate) {
  if (candidate.trigger?.type === 'verifier-fail-pass' &&
      candidate.evidence?.previousStatus === 'fail' &&
      candidate.evidence?.currentStatus === 'pass' &&
      candidate.evidence?.stageId &&
      candidate.evidence?.verificationEvidenceRef) {
    return {
      replayable: true,
      reasonCode: 'objective-verifier-transition-retained',
      method: 'deterministic-transition-check',
    };
  }
  if (candidate.trigger?.type === 'rule-of-3-recovery') {
    return {
      replayable: false,
      reasonCode: 'linear-recovery-is-not-counterfactual-replay',
      method: 'paired-or-later-recurrence-required',
    };
  }
  return {
    replayable: false,
    reasonCode: 'insufficient-structured-evidence',
    method: 'live-evidence-required',
  };
}

function evaluateCandidate(input) {
  const { file, candidate } = loadCandidate(input);
  if (TERMINAL.has(candidate.state) || candidate.state === 'persisted') {
    throw new Error(`candidate in terminal state: ${candidate.state}`);
  }
  const rule = String(input.rule || '').trim();
  if (!rule) throw new Error('evaluate requires --rule with a generalized reusable lesson');

  const screening = screenMemoryForPersistence(rule);
  const qualityScore = scoreRuleQuality(rule, []);
  candidate.generalizedRule = rule;
  candidate.contentHash = contentHash(rule);
  candidate.scope = {
    task: String(input.scopeTask || '').trim() || null,
    requirement: String(input.scopeRequirement || '').trim() || null,
    role: String(input.scopeRole || '').trim() || null,
  };
  candidate.screening = {
    allowed: screening.allowed,
    secretReasonCodes: screening.secretReasonCodes,
    injectionReasonCodes: screening.injectionReasonCodes,
    qualityScore,
  };
  pushState(candidate, 'screened', screening.allowed ? 'screening-clear' : 'screening-rejected');

  if (!screening.allowed || qualityScore < 5) {
    candidate.evaluation = {
      disposition: 'rejected',
      reasonCodes: [
        ...screening.secretReasonCodes,
        ...screening.injectionReasonCodes,
        ...(qualityScore < 5 ? ['quality-below-threshold'] : []),
      ],
      replayable: false,
      method: 'screening',
      improvementClaim: false,
    };
    pushState(candidate, 'rejected', 'candidate-screening-or-quality-failed');
    atomicWriteJson(file, candidate);
    emitCandidateLifecycle(input, candidate, 'lesson_screened', 'screened', screening.allowed ? 'success' : 'failure');
    emitCandidateLifecycle(input, candidate, 'lesson_rejected', 'rejected', 'failure');
    return { file, candidate };
  }

  const replay = replayability(candidate);
  const disposition = replay.replayable ? 'accepted' : 'inconclusive';
  candidate.evaluation = {
    disposition,
    reasonCodes: [replay.reasonCode],
    replayable: replay.replayable,
    method: replay.method,
    improvementClaim: false,
    note: 'Accepted means eligible for governed memory promotion; it is not a claim of behavioral improvement.',
  };
  pushState(candidate, 'evaluated', replay.reasonCode);
  pushState(candidate, disposition, disposition === 'accepted' ? 'eligible-for-governed-promotion' : 'paired-or-later-evidence-required');
  atomicWriteJson(file, candidate);
  emitCandidateLifecycle(input, candidate, 'lesson_screened', 'screened', 'success');
  emitCandidateLifecycle(input, candidate, 'lesson_evaluated', 'evaluated', 'success');
  emitCandidateLifecycle(
    input,
    candidate,
    disposition === 'accepted' ? 'lesson_accepted' : 'lesson_inconclusive',
    disposition,
    disposition === 'accepted' ? 'success' : 'unknown',
  );
  return { file, candidate };
}

function promoteCandidate(input) {
  const { file, candidate } = loadCandidate(input);
  if (candidate.state !== 'accepted' || candidate.evaluation?.disposition !== 'accepted') {
    throw new Error('only accepted lesson candidates may be promoted');
  }
  if (!candidate.generalizedRule) throw new Error('accepted candidate has no generalized rule');
  if (!input.authorization) throw new Error('promotion requires --authorization from the current #134 workflow contract');

  const args = [
    path.join(__dirname, 'persist-memory.js'),
    candidate.generalizedRule,
    '--authorization', input.authorization,
    '--source', `lesson-candidate:${candidate.candidateId}`,
  ];
  if (candidate.scope?.task) args.push('--scope-task', candidate.scope.task);
  if (candidate.scope?.requirement) args.push('--scope-requirement', candidate.scope.requirement);
  if (candidate.scope?.role) args.push('--scope-role', candidate.scope.role);
  if (input.retentionDays) args.push('--retention-days', String(input.retentionDays));

  const result = spawnSync(process.execPath, args, {
    cwd: input.workspace,
    encoding: 'utf8',
    env: process.env,
  });
  if (result.status !== 0) {
    candidate.persistence = {
      disposition: 'failed',
      exitCode: result.status,
      reasonCode: 'memory-governance-rejected-promotion',
    };
    atomicWriteJson(file, candidate);
    return { ok: false, exitCode: result.status || 1, stdout: result.stdout, stderr: result.stderr, candidate };
  }

  const persisted = /\[Success\] Memory persisted/.test(String(result.stdout || ''));
  let promotionWriter = null;
  if (persisted) {
    const index = readJson(path.join(input.workspace, 'memories', 'repo', 'memory-index.json'));
    const record = index && Array.isArray(index.records)
      ? index.records.find(item => item.source === `lesson-candidate:${candidate.candidateId}`)
      : null;
    if (record && record.writer) {
      promotionWriter = {
        sessionId: record.writer.sessionId || null,
        workflowId: record.writer.workflowId || null,
        runId: record.writer.runId || null,
        role: record.writer.role || null,
      };
    }
  }
  candidate.persistence = {
    disposition: persisted ? 'persisted' : 'proposed',
    authorizedBy: 'workflow-memory-capability',
    promotionWriter,
    observedAt: new Date().toISOString(),
  };
  if (persisted) pushState(candidate, 'persisted', 'accepted-and-authorized-memory-write');
  else pushState(candidate, 'accepted', 'memory-governance-held-as-review-candidate');
  atomicWriteJson(file, candidate);
  if (persisted) emitCandidateLifecycle(input, candidate, 'lesson_persisted', 'persisted', 'success');
  return { ok: true, exitCode: 0, persisted, stdout: result.stdout, stderr: result.stderr, candidate };
}

function observeCandidate(input) {
  const { file, candidate } = loadCandidate(input);
  const next = String(input.outcome || '');
  if (!OUTCOME_STATES.has(next)) throw new Error('observe requires retrieved|validated|regressed|superseded');
  if (next === 'retrieved' && !['persisted', 'retrieved'].includes(candidate.state)) {
    throw new Error('only persisted lessons may be marked retrieved');
  }
  if (['validated', 'regressed', 'superseded'].includes(next) && !['persisted', 'retrieved', 'validated', 'regressed'].includes(candidate.state)) {
    throw new Error(`${next} requires persisted/retrieved lesson state`);
  }
  const evidenceRef = String(input.evidence || '').trim();
  if (!evidenceRef) throw new Error('outcome transition requires --evidence');
  candidate.outcome = {
    state: next,
    evidenceRef,
    observedAt: new Date().toISOString(),
  };
  pushState(candidate, next, `lesson-${next}`, evidenceRef);
  atomicWriteJson(file, candidate);
  // Retrieval telemetry is emitted by the actual scoped retrieval path so the
  // funnel measures exposure, not an operator-authored lifecycle annotation.
  if (next !== 'retrieved') {
    const event = {
      validated: 'lesson_validated',
      regressed: 'lesson_regressed',
      superseded: 'lesson_superseded',
    }[next];
    if (event) emitCandidateLifecycle(input, candidate, event, next, next === 'regressed' ? 'failure' : 'success');
  }
  return { file, candidate };
}

function listCandidates({ workspace, sessionId }) {
  const base = path.join(getWorkspaceStateDir(workspace), 'state', 'sessions', safeSessionName(sessionId), 'learning-candidates');
  let files = [];
  try { files = fs.readdirSync(base).filter(name => /^lesson-[a-f0-9]{24}\.json$/.test(name)); } catch (_) { return []; }
  return files.map(name => readJson(path.join(base, name))).filter(Boolean);
}

function option(args, name) {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : null;
}

function parseCli(argv) {
  const command = argv[0];
  const workspace = path.resolve(option(argv, '--workspace') || getWorkspaceRoot() || process.cwd());
  const base = {
    command,
    workspace,
    sessionId: option(argv, '--session-id') || 'default',
    candidateId: option(argv, '--candidate-id'),
  };
  return {
    ...base,
    rule: option(argv, '--rule'),
    authorization: option(argv, '--authorization'),
    scopeTask: option(argv, '--scope-task'),
    scopeRequirement: option(argv, '--scope-requirement'),
    scopeRole: option(argv, '--scope-role'),
    retentionDays: option(argv, '--retention-days'),
    outcome: option(argv, '--outcome'),
    evidence: option(argv, '--evidence'),
  };
}

function main() {
  try {
    const args = parseCli(process.argv.slice(2));
    let result;
    if (args.command === 'list') result = listCandidates(args);
    else if (args.command === 'show') result = loadCandidate(args).candidate;
    else if (args.command === 'evaluate') result = evaluateCandidate(args);
    else if (args.command === 'promote') result = promoteCandidate(args);
    else if (args.command === 'observe') result = observeCandidate(args);
    else throw new Error('Usage: lesson-candidate.js <list|show|evaluate|promote|observe> --workspace <root> --session-id <id> [--candidate-id <id>] ...');
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    if (result && result.ok === false) process.exitCode = result.exitCode || 1;
  } catch (error) {
    console.error(`[self-evolve] ${error.message}`);
    process.exitCode = 1;
  }
}

if (require.main === module) main();

module.exports = {
  SCHEMA_VERSION,
  candidatePath,
  evaluateCandidate,
  listCandidates,
  loadCandidate,
  observeCandidate,
  promoteCandidate,
  replayability,
};
