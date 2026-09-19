'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const {
  getWorkspaceRoot,
  getSessionId,
  getSessionDir,
} = require('./harness-state');
const { emitLessonTelemetry } = require('./telemetry');

const SCHEMA_VERSION = 1;
const TRIGGERS = new Set(['rule-of-3-recovery', 'verifier-fail-pass']);

function atomicWriteJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const temporary = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  fs.renameSync(temporary, filePath);
}

function readJson(filePath) {
  try { return JSON.parse(fs.readFileSync(filePath, 'utf8')); } catch (_) { return null; }
}

function safeText(value, max = 160) {
  const text = String(value || '').replace(/[\r\n\0]+/g, ' ').trim();
  return text ? text.slice(0, max) : null;
}

function safeId(value) {
  const text = safeText(value, 180);
  return text && /^[A-Za-z0-9._:@/-]+$/.test(text) ? text : null;
}

function hash(value) {
  return crypto.createHash('sha256').update(String(value), 'utf8').digest('hex');
}

function workflowIdentity(sessionDir) {
  const workflow = readJson(path.join(sessionDir, 'workflow-run.json'));
  return {
    workflowId: safeId(workflow && workflow.workflowId),
    runId: safeId(workflow && workflow.runId),
    strategy: safeText(workflow && workflow.strategy, 80),
  };
}

function candidateDirectory(sessionDir) {
  return path.join(sessionDir, 'learning-candidates');
}

function sourceIds(values) {
  return [...new Set((values || []).map(value => safeId(value)).filter(Boolean))].slice(0, 16);
}

function minimalEvidence(triggerType, evidence = {}) {
  if (triggerType === 'rule-of-3-recovery') {
    return {
      failureSignature: safeId(evidence.failureSignature),
      failureCategory: safeText(evidence.failureCategory, 40),
      zoomOutCycles: Number.isInteger(evidence.zoomOutCycles) ? evidence.zoomOutCycles : 1,
      recovered: evidence.recovered === true,
    };
  }
  if (triggerType === 'verifier-fail-pass') {
    return {
      planId: safeId(evidence.planId),
      runId: safeId(evidence.runId),
      stageId: safeId(evidence.stageId),
      previousStatus: evidence.previousStatus === 'fail' ? 'fail' : null,
      currentStatus: evidence.currentStatus === 'pass' ? 'pass' : null,
      verificationEvidenceRef: safeText(evidence.verificationEvidenceRef, 240),
    };
  }
  return {};
}

function createLearningOpportunity(payload, input = {}) {
  const triggerType = String(input.triggerType || '');
  if (!TRIGGERS.has(triggerType)) throw new Error(`unsupported learning trigger: ${triggerType}`);

  const root = getWorkspaceRoot(payload);
  const sessionId = getSessionId(payload);
  const sessionDir = getSessionDir(root, sessionId, payload);
  const identity = workflowIdentity(sessionDir);
  const ids = sourceIds(input.sourceEventIds);
  if (ids.length === 0) throw new Error('learning opportunity requires at least one source event id');

  const evidence = minimalEvidence(triggerType, input.evidence);
  const fingerprint = hash(JSON.stringify({
    sessionId,
    triggerType,
    sourceEventIds: ids,
    evidence,
  }));
  const candidateId = `lesson-${fingerprint.slice(0, 24)}`;
  const file = path.join(candidateDirectory(sessionDir), `${candidateId}.json`);
  const existing = readJson(file);
  if (existing) return { created: false, file, candidate: existing };

  const observedAt = new Date().toISOString();
  const candidate = {
    schemaVersion: SCHEMA_VERSION,
    candidateId,
    contentHash: null,
    state: 'proposed',
    trigger: {
      type: triggerType,
      reasonCodes: triggerType === 'rule-of-3-recovery'
        ? ['repeated-failure', 'zoom-out-completed', 'verified-subsequent-success']
        : ['verifier-failed', 'later-verifier-pass'],
      sourceEventIds: ids,
      evidenceClass: triggerType === 'verifier-fail-pass' ? 'objective-transition' : 'runtime-recovery',
    },
    provenance: {
      sessionId,
      workflowId: identity.workflowId,
      runId: identity.runId,
      strategy: identity.strategy,
    },
    evidence,
    generalizedRule: null,
    scope: { task: null, requirement: null, role: null },
    screening: null,
    evaluation: null,
    persistence: null,
    outcome: null,
    history: [
      { state: 'observed', observedAt, reasonCode: 'runtime-learning-opportunity' },
      { state: 'proposed', observedAt, reasonCode: 'objective-recovery-trigger' },
    ],
    createdAt: observedAt,
    updatedAt: observedAt,
  };
  atomicWriteJson(file, candidate);
  const lifecycleReasonCodes = [...candidate.trigger.reasonCodes, `trigger:${triggerType}`];
  emitLessonTelemetry({
    event: 'learning_opportunity',
    root,
    payload,
    sessionId,
    candidateId,
    observedAt,
    status: 'success',
    reasonCodes: lifecycleReasonCodes,
  });
  emitLessonTelemetry({
    event: 'lesson_proposed',
    root,
    payload,
    sessionId,
    candidateId,
    observedAt,
    status: 'success',
    reasonCodes: lifecycleReasonCodes,
  });
  return { created: true, file, candidate };
}

module.exports = {
  SCHEMA_VERSION,
  TRIGGERS,
  atomicWriteJson,
  candidateDirectory,
  createLearningOpportunity,
  hash,
  readJson,
};
