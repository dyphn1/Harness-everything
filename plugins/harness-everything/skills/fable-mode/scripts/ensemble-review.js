#!/usr/bin/env node
'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const {
  derivePlanId,
  getWorkspaceStateRoot,
} = require('./workflow-plan-consumer');

const ENSEMBLE_EVIDENCE_VERSION = 1;
const SUPPORTED_DIVERSITY = new Set(['model', 'prompt', 'evidence']);
const VERIFICATION_STATUSES = new Set(['pass', 'fail', 'inconclusive']);
const VERIFIER_VERDICTS = new Set(['accept', 'reject', 'inconclusive']);
const CORRECTNESS_STATES = new Set(['pass', 'fail', 'inconclusive']);

function sanitizeId(value, label) {
  const text = String(value || '').trim();
  if (!text) throw new Error(`${label} is required`);
  if (!/^[A-Za-z0-9._-]+$/.test(text)) throw new Error(`${label} contains unsupported characters: ${text}`);
  return text.slice(0, 128);
}

function boundedString(value, label, max = 512) {
  const text = String(value || '').trim();
  if (!text) throw new Error(`${label} is required`);
  if (text.length > max) throw new Error(`${label} exceeds ${max} characters`);
  return text;
}

function normalizeEvidenceRefs(values, label) {
  if (!Array.isArray(values)) throw new Error(`${label} must be an array`);
  return [...new Set(values.map((value, index) => boundedString(value, `${label}[${index}]`, 512)))].sort();
}

function normalizeMetricNumber(value, label, integer = true) {
  if (value === undefined || value === null) return null;
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0 || (integer && !Number.isInteger(number))) {
    throw new Error(`${label} must be a non-negative ${integer ? 'integer' : 'number'} or null`);
  }
  return number;
}

function normalizeMetrics(raw = {}) {
  const correctness = raw.correctness === undefined || raw.correctness === null
    ? null
    : String(raw.correctness);
  if (correctness !== null && !CORRECTNESS_STATES.has(correctness)) {
    throw new Error(`metrics.correctness is invalid: ${correctness}`);
  }
  const failureMode = raw.failureMode === undefined || raw.failureMode === null
    ? null
    : boundedString(raw.failureMode, 'metrics.failureMode', 256);
  return {
    correctness,
    toolCalls: normalizeMetricNumber(raw.toolCalls, 'metrics.toolCalls'),
    tokens: normalizeMetricNumber(raw.tokens, 'metrics.tokens'),
    elapsedMs: normalizeMetricNumber(raw.elapsedMs, 'metrics.elapsedMs', false),
    retries: normalizeMetricNumber(raw.retries, 'metrics.retries'),
    failureMode,
  };
}

function normalizeCandidate(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('candidate must be an object');
  const candidateId = sanitizeId(raw.candidateId, 'candidateId');
  const position = boundedString(raw.position, `${candidateId}.position`, 512);
  const diversity = raw.diversity;
  if (!diversity || typeof diversity !== 'object' || Array.isArray(diversity)) {
    throw new Error(`${candidateId}.diversity must be an object`);
  }
  const modelId = boundedString(diversity.modelId, `${candidateId}.diversity.modelId`, 128);
  const promptVariantId = boundedString(diversity.promptVariantId, `${candidateId}.diversity.promptVariantId`, 128);
  const evidenceSetId = boundedString(diversity.evidenceSetId, `${candidateId}.diversity.evidenceSetId`, 128);

  const verification = raw.objectiveVerification;
  if (!verification || typeof verification !== 'object' || Array.isArray(verification)) {
    throw new Error(`${candidateId}.objectiveVerification must be an object`);
  }
  const status = String(verification.status || '');
  if (!VERIFICATION_STATUSES.has(status)) {
    throw new Error(`${candidateId}.objectiveVerification.status is invalid: ${status}`);
  }

  return {
    candidateId,
    position,
    diversity: { modelId, promptVariantId, evidenceSetId },
    objectiveVerification: {
      status,
      evidenceRefs: normalizeEvidenceRefs(verification.evidenceRefs || [], `${candidateId}.objectiveVerification.evidenceRefs`),
    },
    metrics: normalizeMetrics(raw.metrics || {}),
  };
}

function diversityFingerprint(candidate) {
  return [
    candidate.diversity.modelId,
    candidate.diversity.promptVariantId,
    candidate.diversity.evidenceSetId,
  ].join('|');
}

function fingerprintHash(candidate) {
  return crypto.createHash('sha256').update(diversityFingerprint(candidate)).digest('hex').slice(0, 16);
}

function normalizeVerifier(raw, candidateIds) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('independent verifier evidence is required');
  const verifierId = sanitizeId(raw.verifierId, 'verifierId');
  if (candidateIds.has(verifierId)) throw new Error('verifierId must not reuse a candidateId');
  if (raw.independent !== true) throw new Error('verifier must declare independent=true');
  const verdict = String(raw.verdict || '');
  if (!VERIFIER_VERDICTS.has(verdict)) throw new Error(`verifier verdict is invalid: ${verdict}`);
  const position = raw.position === null || raw.position === undefined
    ? null
    : boundedString(raw.position, 'verifier.position', 512);
  if (verdict === 'accept' && !position) throw new Error('accept verdict requires verifier.position');
  const evidenceRefs = normalizeEvidenceRefs(raw.evidenceRefs || [], 'verifier.evidenceRefs');
  if (evidenceRefs.length === 0) throw new Error('independent verifier must provide at least one evidence reference');
  return { verifierId, independent: true, verdict, position, evidenceRefs };
}

function validateEnsembleConfig(plan) {
  if (!plan || typeof plan !== 'object' || Array.isArray(plan)) throw new Error('workflow plan must be an object');
  const config = plan.ensemble;
  if (!config || typeof config !== 'object' || Array.isArray(config)) throw new Error('workflow plan does not enable ensemble review');
  if (!Number.isInteger(config.maxCandidates) || config.maxCandidates < 2 || config.maxCandidates > 4) {
    throw new Error('ensemble.maxCandidates must be an integer from 2 through 4');
  }
  if (!Array.isArray(config.diversity) || config.diversity.length === 0) {
    throw new Error('ensemble.diversity must be a non-empty array');
  }
  for (const dimension of config.diversity) {
    if (!SUPPORTED_DIVERSITY.has(dimension)) throw new Error(`unsupported ensemble diversity dimension: ${dimension}`);
  }
  if (config.synthesis !== 'preserve-disagreement') throw new Error('ensemble.synthesis must be preserve-disagreement');
  if (config.verifier !== 'independent') throw new Error('ensemble.verifier must be independent');
  return {
    maxCandidates: config.maxCandidates,
    diversity: [...new Set(config.diversity)],
    synthesis: config.synthesis,
    verifier: config.verifier,
    reasonCodes: Array.isArray(config.reasonCodes) ? [...new Set(config.reasonCodes.filter(Boolean))] : [],
  };
}

function pairedEvidenceAllowsImprovementClaim(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return false;
  return raw.paired === true &&
    raw.sameEngineModelFixtureRubricConfig === true &&
    Number.isInteger(raw.sampleCount) && raw.sampleCount > 0 &&
    raw.effectEstimate !== undefined && raw.effectEstimate !== null &&
    raw.uncertainty !== undefined && raw.uncertainty !== null;
}

function synthesizeEnsemble({ plan, candidates, verifier, pairedEvidence = null }) {
  const config = validateEnsembleConfig(plan);
  if (!Array.isArray(candidates)) throw new Error('candidates must be an array');
  if (candidates.length < 2) throw new Error('ensemble review requires at least two candidates');
  if (candidates.length > config.maxCandidates) {
    throw new Error(`candidate count ${candidates.length} exceeds ensemble.maxCandidates=${config.maxCandidates}`);
  }

  const normalized = candidates.map(normalizeCandidate);
  const candidateIds = new Set();
  const fingerprints = new Set();
  for (const candidate of normalized) {
    if (candidateIds.has(candidate.candidateId)) throw new Error(`duplicate candidateId: ${candidate.candidateId}`);
    candidateIds.add(candidate.candidateId);
    const fingerprint = diversityFingerprint(candidate);
    if (fingerprints.has(fingerprint)) {
      throw new Error(`candidates are not independent: duplicate model/prompt/evidence fingerprint for ${candidate.candidateId}`);
    }
    fingerprints.add(fingerprint);
  }

  const normalizedVerifier = normalizeVerifier(verifier, candidateIds);
  const byPosition = new Map();
  for (const candidate of normalized) {
    if (!byPosition.has(candidate.position)) byPosition.set(candidate.position, []);
    byPosition.get(candidate.position).push(candidate);
  }

  const positions = [...byPosition.entries()]
    .map(([position, members]) => ({
      position,
      count: members.length,
      candidateIds: members.map(member => member.candidateId).sort(),
      verificationStatuses: members.map(member => member.objectiveVerification.status).sort(),
      evidenceRefs: [...new Set(members.flatMap(member => member.objectiveVerification.evidenceRefs))].sort(),
    }))
    .sort((left, right) => left.position.localeCompare(right.position));

  const maxCount = Math.max(...positions.map(entry => entry.count));
  const leaders = positions.filter(entry => entry.count === maxCount);
  const strictMajority = leaders.length === 1 && maxCount > normalized.length / 2
    ? leaders[0].position
    : null;
  const unanimous = positions.length === 1 ? positions[0].position : null;
  const proposedPosition = unanimous || strictMajority;
  const proposedMembers = proposedPosition ? byPosition.get(proposedPosition) : [];
  const objectiveFailureBlocks = proposedMembers.some(candidate => candidate.objectiveVerification.status === 'fail');

  let disposition = 'disagreement-preserved';
  let selectedPosition = null;
  const reasonCodes = [...config.reasonCodes];
  if (objectiveFailureBlocks) {
    disposition = 'blocked-objective-failure';
    reasonCodes.push('objective-verification-failure');
  } else if (!proposedPosition) {
    reasonCodes.push('no-strict-majority');
  } else if (normalizedVerifier.verdict === 'reject') {
    disposition = 'verifier-rejected';
    reasonCodes.push('independent-verifier-rejected');
  } else if (normalizedVerifier.verdict === 'inconclusive') {
    disposition = 'verifier-inconclusive';
    reasonCodes.push('independent-verifier-inconclusive');
  } else if (normalizedVerifier.position !== proposedPosition) {
    disposition = 'verifier-position-mismatch';
    reasonCodes.push('independent-verifier-position-mismatch');
  } else {
    disposition = 'accepted';
    selectedPosition = proposedPosition;
    reasonCodes.push('independent-verifier-accepted');
  }

  const improvementAllowed = pairedEvidenceAllowsImprovementClaim(pairedEvidence);
  const minorityPositions = positions
    .filter(entry => entry.position !== selectedPosition)
    .map(entry => entry.position);

  return {
    schemaVersion: ENSEMBLE_EVIDENCE_VERSION,
    ensemble: config,
    candidateCount: normalized.length,
    candidateSummaries: normalized.map(candidate => ({
      candidateId: candidate.candidateId,
      position: candidate.position,
      diversityFingerprint: fingerprintHash(candidate),
      objectiveVerification: candidate.objectiveVerification,
    })),
    positions,
    disagreement: positions.length > 1,
    minorityPositions,
    proposedPosition,
    selectedPosition,
    disposition,
    verifier: normalizedVerifier,
    reasonCodes: [...new Set(reasonCodes)],
    measurement: {
      sourceIssues: ['#71', '#83'],
      correctness: normalized.map(candidate => ({
        candidateId: candidate.candidateId,
        value: candidate.metrics.correctness,
      })),
      executionCost: normalized.map(candidate => ({
        candidateId: candidate.candidateId,
        toolCalls: candidate.metrics.toolCalls,
        tokens: candidate.metrics.tokens,
        elapsedMs: candidate.metrics.elapsedMs,
        retries: candidate.metrics.retries,
      })),
      failureModes: normalized.map(candidate => ({
        candidateId: candidate.candidateId,
        failureMode: candidate.metrics.failureMode,
      })),
      telemetryOptional: true,
    },
    improvementClaim: {
      allowed: improvementAllowed,
      reasonCode: improvementAllowed ? 'paired-evidence-present' : 'paired-evidence-required',
    },
  };
}

function atomicWriteJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tempPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tempPath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  fs.renameSync(tempPath, filePath);
}

function writeCorrelatedEvidence({ routerContract, workspaceRoot, runId, synthesis }) {
  const root = path.resolve(workspaceRoot || process.cwd());
  const planId = derivePlanId(routerContract);
  const cleanRunId = sanitizeId(runId, 'runId');
  const runRoot = path.join(getWorkspaceStateRoot(root), 'fable-runs', cleanRunId);
  const manifestPath = path.join(runRoot, 'run.json');
  if (!fs.existsSync(manifestPath)) throw new Error(`run manifest not found: ${manifestPath}`);
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  if (manifest.planId !== planId) throw new Error('run manifest planId does not match router contract');
  if (manifest.runId !== cleanRunId) throw new Error('run manifest runId mismatch');
  const artifact = {
    ...synthesis,
    planId,
    runId: cleanRunId,
    generatedAt: new Date().toISOString(),
  };
  const evidencePath = path.join(runRoot, 'ensemble.json');
  atomicWriteJson(evidencePath, artifact);
  return { artifact, evidencePath };
}

function parseArgs(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index++) {
    const token = argv[index];
    if (token === '--plan-file') args.planFile = argv[++index];
    else if (token === '--candidates-file') args.candidatesFile = argv[++index];
    else if (token === '--verifier-file') args.verifierFile = argv[++index];
    else if (token === '--paired-evidence-file') args.pairedEvidenceFile = argv[++index];
    else if (token === '--root') args.root = argv[++index];
    else if (token === '--run-id') args.runId = argv[++index];
    else if (token === '--help' || token === '-h') args.help = true;
    else throw new Error(`unknown argument: ${token}`);
  }
  return args;
}

function usage() {
  return 'Usage: node fable-mode/scripts/ensemble-review.js --plan-file <router-contract.json> --candidates-file <candidates.json> --verifier-file <verifier.json> --root <workspace> --run-id <runId> [--paired-evidence-file <paired.json>]';
}

if (require.main === module) {
  try {
    const args = parseArgs(process.argv.slice(2));
    if (args.help) {
      console.log(usage());
      process.exit(0);
    }
    if (!args.planFile || !args.candidatesFile || !args.verifierFile || !args.root || !args.runId) {
      throw new Error(usage());
    }
    const routerContract = JSON.parse(fs.readFileSync(path.resolve(args.planFile), 'utf8'));
    const candidatesPayload = JSON.parse(fs.readFileSync(path.resolve(args.candidatesFile), 'utf8'));
    const verifier = JSON.parse(fs.readFileSync(path.resolve(args.verifierFile), 'utf8'));
    const pairedEvidence = args.pairedEvidenceFile
      ? JSON.parse(fs.readFileSync(path.resolve(args.pairedEvidenceFile), 'utf8'))
      : null;
    const synthesis = synthesizeEnsemble({
      plan: routerContract.workflowPlan,
      candidates: Array.isArray(candidatesPayload) ? candidatesPayload : candidatesPayload.candidates,
      verifier,
      pairedEvidence,
    });
    const result = writeCorrelatedEvidence({
      routerContract,
      workspaceRoot: args.root,
      runId: args.runId,
      synthesis,
    });
    process.stdout.write(`${JSON.stringify({ ...result.artifact, evidencePath: result.evidencePath })}\n`);
  } catch (err) {
    console.error(`[FABLE ENSEMBLE REVIEW] ${err.message}`);
    process.exit(2);
  }
}

module.exports = {
  ENSEMBLE_EVIDENCE_VERSION,
  diversityFingerprint,
  normalizeCandidate,
  pairedEvidenceAllowsImprovementClaim,
  synthesizeEnsemble,
  validateEnsembleConfig,
  writeCorrelatedEvidence,
};
