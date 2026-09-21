'use strict';

const path = require('path');
const { atomicWriteJson, readJson } = require('./fable-contracts');

const OBLIGATION_SCHEMA_VERSION = 1;
const OBLIGATION_FILE = 'workflow-obligations.json';
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const ALLOWED_ESCAPE_REASONS = new Set(['workflow-uncovered-scope', 'host-capability-unavailable']);

function obligationPath(sessionDir) {
  return path.join(sessionDir, OBLIGATION_FILE);
}

function shouldMaterializeObligations(plan) {
  return Boolean(
    plan &&
    plan.strategySelection === 'selected' &&
    ['tier2', 'tier3'].includes(plan.tier) &&
    plan.strategy &&
    !String(plan.strategy).startsWith('fable-')
  );
}

function suggestedBindings(plan, kind) {
  const skills = Array.isArray(plan?.suggestedSkills) ? plan.suggestedSkills : [];
  if (kind === 'verification') return skills.filter(skill => skill === 'verification-loop');
  if (kind === 'execution') return skills.filter(skill => skill !== 'verification-loop');
  return [];
}

function obligationTemplates(plan) {
  return [
    {
      id: 'scope',
      kind: 'scope',
      requirement: 'Establish the current task/environment scope and the evidence needed to proceed.',
      required: true,
      escapable: false,
      suggestedSkills: suggestedBindings(plan, 'scope'),
    },
    {
      id: 'execute',
      kind: 'execution',
      requirement: 'Perform the bounded work required by the selected workflow while preserving applicable invariants.',
      required: true,
      escapable: true,
      suggestedSkills: suggestedBindings(plan, 'execution'),
    },
    {
      id: 'verify',
      kind: 'verification',
      requirement: 'Produce objective verification evidence appropriate to the completed work before claiming completion.',
      required: true,
      escapable: false,
      suggestedSkills: suggestedBindings(plan, 'verification'),
    },
  ];
}

function materializeObligations(context, plan) {
  if (!shouldMaterializeObligations(plan)) return null;
  const now = new Date().toISOString();
  const set = {
    schemaVersion: OBLIGATION_SCHEMA_VERSION,
    workflowId: context.workflow.workflowId,
    sessionId: context.sessionId,
    strategy: plan.strategy,
    tier: plan.tier,
    revision: context.workflow.revision,
    createdAt: now,
    obligations: obligationTemplates(plan).map(item => ({
      ...item,
      status: 'pending',
      evidence: null,
      reasonCode: null,
      scope: null,
      updatedAt: null,
    })),
  };
  atomicWriteJson(obligationPath(context.sessionDir), set);
  context.workflow.obligationContract = {
    schemaVersion: OBLIGATION_SCHEMA_VERSION,
    file: OBLIGATION_FILE,
    revision: set.revision,
  };
  return set;
}

function validateObligationSet(context, set) {
  if (!set || set.schemaVersion !== OBLIGATION_SCHEMA_VERSION) return 'schema-invalid';
  if (set.workflowId !== context.workflow?.workflowId || set.sessionId !== context.sessionId) return 'correlation-invalid';
  if (set.strategy !== context.workflow?.strategy || set.tier !== context.workflow?.tier) return 'plan-mismatch';
  if (!Array.isArray(set.obligations) || set.obligations.length === 0) return 'obligations-empty';
  const ids = new Set();
  for (const obligation of set.obligations) {
    if (!obligation || !SAFE_ID.test(obligation.id || '') || ids.has(obligation.id)) return 'obligation-id-invalid';
    ids.add(obligation.id);
    if (!['pending', 'pass', 'escaped', 'blocked'].includes(obligation.status)) return 'obligation-status-invalid';
  }
  return null;
}

function loadObligationSet(context) {
  const set = readJson(obligationPath(context.sessionDir));
  const error = validateObligationSet(context, set);
  return { set: error ? null : set, error };
}

function updateObligation(context, obligationId, disposition, options = {}) {
  if (!SAFE_ID.test(obligationId || '')) throw new Error('--obligation-id must be a stable obligation id');
  if (!['pass', 'escaped', 'blocked'].includes(disposition)) throw new Error('--disposition must be pass, escaped, or blocked');
  const loaded = loadObligationSet(context);
  if (!loaded.set) throw new Error('workflow obligation contract unavailable or invalid: ' + loaded.error);
  const obligation = loaded.set.obligations.find(item => item.id === obligationId);
  if (!obligation) throw new Error('unknown workflow obligation: ' + obligationId);
  const evidence = String(options.evidence || '').trim();
  if (!evidence) throw new Error('--evidence is required for every obligation disposition');
  const reasonCode = String(options.reasonCode || '').trim() || null;
  const scope = String(options.scope || '').trim() || null;
  if (disposition === 'escaped') {
    if (!obligation.escapable) throw new Error('this obligation cannot be escaped');
    if (!ALLOWED_ESCAPE_REASONS.has(reasonCode)) throw new Error('escaped obligations require workflow-uncovered-scope or host-capability-unavailable');
    if (!scope) throw new Error('--scope is required when escaping an obligation');
  }
  if (disposition === 'blocked' && !reasonCode) throw new Error('--reason-code is required when blocking an obligation');
  obligation.status = disposition;
  obligation.evidence = evidence;
  obligation.reasonCode = reasonCode;
  obligation.scope = scope;
  obligation.updatedAt = new Date().toISOString();
  atomicWriteJson(obligationPath(context.sessionDir), loaded.set);
  return obligation;
}

function unresolvedObligations(context) {
  const plan = context.workflow?.workflowPlan;
  if (!shouldMaterializeObligations(plan)) return [];
  const loaded = loadObligationSet(context);
  if (!loaded.set) return ['obligations:' + (loaded.error || 'missing')];
  const unresolved = [];
  for (const obligation of loaded.set.obligations) {
    if (obligation.status === 'pending') unresolved.push(obligation.id + ':pending');
    else if (obligation.status === 'blocked') unresolved.push(obligation.id + ':blocked');
    else if (!obligation.evidence) unresolved.push(obligation.id + ':evidence-missing');
    else if (obligation.status === 'escaped' && (!obligation.escapable || !ALLOWED_ESCAPE_REASONS.has(obligation.reasonCode) || !obligation.scope)) {
      unresolved.push(obligation.id + ':escape-invalid');
    }
  }
  return unresolved;
}

module.exports = {
  OBLIGATION_FILE,
  ALLOWED_ESCAPE_REASONS,
  obligationPath,
  shouldMaterializeObligations,
  materializeObligations,
  loadObligationSet,
  updateObligation,
  unresolvedObligations,
};
