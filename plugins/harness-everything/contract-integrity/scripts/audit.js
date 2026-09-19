#!/usr/bin/env node
'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { evaluateEvidence } = require('../../skills/tdd/scripts/quality-gate');

const VERSION = '1.0.0';
const MODES = new Set(['audit', 'strict']);
const ARTIFACT_KINDS = new Set(['ADR', 'SPEC', 'TICKET', 'TEST', 'IMPLEMENTATION']);
const ARTIFACT_STATUSES = new Set(['ACTIVE', 'SUPERSEDED', 'DEPRECATED']);
const REQUIREMENT_STATUSES = new Set(['CURRENT', 'SUPERSEDED']);
const SOURCE_VALIDITY = new Set(['VALID', 'SOURCE_DEFECT', 'SOURCE_CONFLICT']);
const PROBE_STATUSES = new Set(['KILLED', 'SURVIVED', 'INVALID', 'NOT_EVALUATED']);
const DRIFT = new Set([
  'CONSISTENT',
  'UNTRACED_CHANGE',
  'STALE_SPEC',
  'STALE_TEST',
  'STALE_IMPLEMENTATION',
  'SOURCE_DEFECT',
  'SOURCE_CONFLICT',
  'INTENTIONAL_SUPERSESSION',
  'NOT_EVALUATED',
]);

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
function text(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}
function round(value) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}
function unique(values) {
  return [...new Set(values)];
}
function safeRelativePath(value) {
  const p = text(value);
  if (!p || path.isAbsolute(p) || p.includes('\\0')) return false;
  const normalized = p.replace(/\\/g, '/');
  return normalized !== '..' && !normalized.startsWith('../') && !normalized.includes('/../');
}
function rejectUnknownKeys(value, allowed, errors, location) {
  if (!isObject(value)) return;
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) errors.push(`${location} contains unknown field: ${key}`);
  }
}
function readJson(file) {
  return JSON.parse(fs.readFileSync(path.resolve(file), 'utf8'));
}
function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (!isObject(value)) return value;
  return Object.fromEntries(Object.keys(value).sort().map(key => [key, stable(value[key])]));
}

function sha256File(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function gitRevision(workspace) {
  if (!workspace) return null;
  const result = spawnSync('git', ['rev-parse', 'HEAD'], {
    cwd: workspace,
    encoding: 'utf8',
    windowsHide: true,
  });
  return result.status === 0 ? String(result.stdout || '').trim() || null : null;
}

function artifactFingerprints(trace, workspace) {
  if (!workspace) return [];
  const root = path.resolve(workspace);
  return (trace?.artifacts || []).map(artifact => {
    const full = path.resolve(root, artifact.path);
    const inside = full === root || full.startsWith(root + path.sep);
    if (!inside || !fs.existsSync(full) || !fs.statSync(full).isFile()) {
      return { id: artifact.id, path: artifact.path, sha256: null, missing: true };
    }
    return { id: artifact.id, path: artifact.path, sha256: sha256File(full), missing: false };
  });
}

function buildProvenance(args, trace) {
  const workspace = args.workspace ? path.resolve(args.workspace) : null;
  return {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    auditVersion: VERSION,
    nodeVersion: process.version,
    command: 'node contract-integrity/scripts/audit.js <trace> [--tdd-evidence <evidence>] [--workspace <workspace>]',
    gitRevision: gitRevision(workspace || process.cwd()),
    workspaceIsolation: unique((trace?.probes || []).map(probe => probe.workspaceIsolation).filter(Boolean)),
    inputs: {
      trace: { sha256: sha256File(path.resolve(args.input)) },
      tddEvidence: args.tddEvidence ? { sha256: sha256File(path.resolve(args.tddEvidence)) } : null,
    },
    artifacts: artifactFingerprints(trace, workspace),
  };
}

function verifyFreshReport(report, args, trace) {
  const reasons = [];
  if (!isObject(report?.provenance) || !isObject(report.provenance.inputs)) {
    return { fresh: false, authorizesCompletion: false, reasons: ['report-provenance-missing'] };
  }
  const currentTraceHash = sha256File(path.resolve(args.input));
  if (report.provenance.inputs.trace?.sha256 !== currentTraceHash) reasons.push('trace-changed-since-audit');
  const currentTddHash = args.tddEvidence ? sha256File(path.resolve(args.tddEvidence)) : null;
  const reportedTddHash = report.provenance.inputs.tddEvidence?.sha256 || null;
  if (currentTddHash !== reportedTddHash) reasons.push('tdd-evidence-changed-since-audit');

  if (Array.isArray(report.provenance.artifacts) && report.provenance.artifacts.length > 0) {
    if (!args.workspace) reasons.push('workspace-required-for-artifact-freshness');
    else {
      const current = new Map(artifactFingerprints(trace, args.workspace).map(item => [item.id, item]));
      for (const prior of report.provenance.artifacts) {
        const now = current.get(prior.id);
        if (!now || now.missing || prior.missing || now.sha256 !== prior.sha256) {
          reasons.push(`artifact-changed-since-audit:${prior.id}`);
        }
      }
    }
  }
  return {
    fresh: reasons.length === 0,
    authorizesCompletion: reasons.length === 0 && report.completionGate === 'PASS' && report.result === 'PASS',
    reasons: unique(reasons),
  };
}

function repairGuidance(requirements) {
  const priorityOrder = { BLOCKER: 0, HIGH: 1, MEDIUM: 2 };
  const recommendations = [];
  const add = (priority, req, code, action) => recommendations.push({
    priority,
    requirementId: req.requirementId,
    sourceRef: req.sourceRef || null,
    code,
    action,
  });

  for (const req of requirements) {
    if (req.lifecycleStatus !== 'CURRENT') continue;
    if (req.drift.includes('SOURCE_CONFLICT')) add('BLOCKER', req, 'resolve-source-conflict', 'Resolve the authoritative source conflict before changing tests or implementation.');
    if (req.drift.includes('SOURCE_DEFECT')) add('BLOCKER', req, 'repair-source-defect', 'Repair or explicitly supersede the defective authoritative source before completion.');
    if (req.protection.status === 'SURVIVED') add('BLOCKER', req, 'strengthen-weak-oracle', 'Strengthen the requirement-linked observable assertion so every required contract probe is killed for the expected reason.');
    if (req.drift.includes('STALE_SPEC')) add('HIGH', req, 'update-living-spec', 'Update the living specification and requirement revision before accepting behavior that moved ahead of the contract.');
    if (req.drift.includes('STALE_TEST')) add('HIGH', req, 'refresh-requirement-tests', 'Update requirement-linked tests and RED evidence against the current living specification.');
    if (req.drift.includes('STALE_IMPLEMENTATION')) add('HIGH', req, 'refresh-implementation-evidence', 'Attach implementation evidence for the current requirement revision and rerun verification.');
    if (req.drift.includes('UNTRACED_CHANGE')) add('HIGH', req, 'repair-contract-lineage', 'Restore ADR/spec/ticket/test/implementation lineage for this requirement before completion.');
    if (req.protection.status === 'NOT_EVALUATED') add('HIGH', req, 'execute-required-probes', 'Execute every predeclared required contract probe in an isolated supported adapter or retain NOT_EVALUATED.');
    if (req.completeness.result !== 'PASS' || req.completeness.score < 100) add('HIGH', req, 'complete-tdd-evidence', 'Repair the existing #58 completeness evidence; do not compensate with protection score.');
  }

  const seen = new Set();
  return recommendations
    .filter(item => {
      const key = `${item.requirementId}:${item.code}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((a, b) => priorityOrder[a.priority] - priorityOrder[b.priority] ||
      String(a.requirementId).localeCompare(String(b.requirementId)) ||
      a.code.localeCompare(b.code));
}

function validateTrace(input) {
  const errors = [];
  if (!isObject(input)) return ['trace root must be an object'];
  if (input.schemaVersion !== VERSION) errors.push(`schemaVersion must be ${VERSION}`);
  if (!MODES.has(input.mode)) errors.push('mode must be audit or strict');
  if (!Array.isArray(input.artifacts)) errors.push('artifacts must be an array');
  if (!Array.isArray(input.requirements) || input.requirements.length === 0) errors.push('requirements must be a non-empty array');
  if (!Array.isArray(input.probes)) errors.push('probes must be an array');
  if (errors.length) return errors;

  const artifactIds = new Set();
  for (const [index, artifact] of input.artifacts.entries()) {
    const p = `artifacts[${index}]`;
    if (!isObject(artifact)) { errors.push(`${p} must be an object`); continue; }
    rejectUnknownKeys(artifact, new Set(['id','kind','path','status','revision','requirementId','requirementRevision','changeImpact','supersedes','evidenceRef']), errors, p);
    if (!text(artifact.id)) errors.push(`${p}.id is required`);
    else if (artifactIds.has(artifact.id)) errors.push(`duplicate artifact id: ${artifact.id}`);
    else artifactIds.add(artifact.id);
    if (!ARTIFACT_KINDS.has(artifact.kind)) errors.push(`${p}.kind is invalid`);
    if (!safeRelativePath(artifact.path)) errors.push(`${p}.path must be a repo-relative non-traversing path`);
    if (!ARTIFACT_STATUSES.has(artifact.status)) errors.push(`${p}.status is invalid`);
    if (!Number.isInteger(artifact.revision) || artifact.revision < 1) errors.push(`${p}.revision must be >= 1`);
    if (artifact.requirementRevision != null && (!Number.isInteger(artifact.requirementRevision) || artifact.requirementRevision < 1)) {
      errors.push(`${p}.requirementRevision must be null or >= 1`);
    }
    if (artifact.kind === 'TICKET' && !['none','implementation','behavior','architecture'].includes(artifact.changeImpact)) {
      errors.push(`${p}.changeImpact is required for tickets`);
    }
    if (artifact.kind !== 'TICKET' && artifact.changeImpact !== undefined) errors.push(`${p}.changeImpact is ticket-only`);
    if (artifact.supersedes !== undefined && (!Array.isArray(artifact.supersedes) || new Set(artifact.supersedes).size !== artifact.supersedes.length)) {
      errors.push(`${p}.supersedes must be a unique array`);
    }
  }

  const requirementIds = new Set();
  for (const [index, requirement] of input.requirements.entries()) {
    const p = `requirements[${index}]`;
    if (!isObject(requirement)) { errors.push(`${p} must be an object`); continue; }
    rejectUnknownKeys(requirement, new Set(['requirementId','revision','status','specId','decisionIds','ticketIds','testIds','implementationIds','requiredProbeIds','sourceValidity','supersededBy']), errors, p);
    if (!text(requirement.requirementId)) errors.push(`${p}.requirementId is required`);
    else if (requirementIds.has(requirement.requirementId)) errors.push(`duplicate requirementId: ${requirement.requirementId}`);
    else requirementIds.add(requirement.requirementId);
    if (!Number.isInteger(requirement.revision) || requirement.revision < 1) errors.push(`${p}.revision must be >= 1`);
    if (!REQUIREMENT_STATUSES.has(requirement.status)) errors.push(`${p}.status is invalid`);
    if (!text(requirement.specId)) errors.push(`${p}.specId is required`);
    for (const field of ['decisionIds','ticketIds','testIds','implementationIds','requiredProbeIds']) {
      if (!Array.isArray(requirement[field])) errors.push(`${p}.${field} must be an array`);
      else if (new Set(requirement[field]).size !== requirement[field].length) errors.push(`${p}.${field} must not contain duplicates`);
    }
    if (!SOURCE_VALIDITY.has(requirement.sourceValidity)) errors.push(`${p}.sourceValidity is invalid`);
    if (requirement.status === 'SUPERSEDED' && !text(requirement.supersededBy)) errors.push(`${p}.supersededBy is required for superseded requirements`);
    if (requirement.status === 'CURRENT' && requirement.supersededBy != null) errors.push(`${p}.supersededBy must be null/omitted for current requirements`);
  }

  const probeIds = new Set();
  for (const [index, probe] of input.probes.entries()) {
    const p = `probes[${index}]`;
    if (!isObject(probe)) { errors.push(`${p} must be an object`); continue; }
    rejectUnknownKeys(probe, new Set(['probeId','requirementId','status','sourceSection','evidenceRef','workspaceIsolation','failureClass']), errors, p);
    if (!text(probe.probeId)) errors.push(`${p}.probeId is required`);
    else if (probeIds.has(probe.probeId)) errors.push(`duplicate probeId: ${probe.probeId}`);
    else probeIds.add(probe.probeId);
    if (!text(probe.requirementId)) errors.push(`${p}.requirementId is required`);
    if (!PROBE_STATUSES.has(probe.status)) errors.push(`${p}.status is invalid`);
    if (!text(probe.sourceSection)) errors.push(`${p}.sourceSection is required`);
    if (!['isolated','not-isolated','unknown'].includes(probe.workspaceIsolation)) errors.push(`${p}.workspaceIsolation is invalid`);
    if (!['contract','build','infrastructure','flaky','none','unknown'].includes(probe.failureClass)) errors.push(`${p}.failureClass is invalid`);
    if (['KILLED','SURVIVED'].includes(probe.status) && !text(probe.evidenceRef)) errors.push(`${p}.evidenceRef is required for evaluated probes`);
    if (probe.status === 'KILLED' && probe.failureClass !== 'contract') {
      errors.push(`${p}: KILLED requires failureClass=contract; compile/build/infrastructure failures are invalid protection evidence`);
    }
    if (['KILLED','SURVIVED'].includes(probe.status) && probe.workspaceIsolation !== 'isolated') {
      errors.push(`${p}: evaluated probes require isolated workspace evidence`);
    }
  }
  return errors;
}

function artifactMap(trace) {
  return new Map(trace.artifacts.map(artifact => [artifact.id, artifact]));
}

function expectedKind(map, id, kind, errors, location) {
  const artifact = map.get(id);
  if (!artifact) { errors.push(`${location}: missing artifact ${id}`); return null; }
  if (artifact.kind !== kind) { errors.push(`${location}: ${id} must be ${kind}, got ${artifact.kind}`); return null; }
  return artifact;
}

function classifyLineage(requirement, map) {
  const statuses = [];
  const reasons = [];
  const links = [];

  const spec = map.get(requirement.specId);
  if (!spec || spec.kind !== 'SPEC') {
    statuses.push('UNTRACED_CHANGE');
    reasons.push('missing-current-spec-link');
  } else {
    links.push({ from: requirement.requirementId, to: spec.id, relation: 'defined-by' });
    if (spec.status !== 'ACTIVE' || spec.revision !== requirement.revision) {
      statuses.push('STALE_SPEC');
      reasons.push(spec.status !== 'ACTIVE' ? 'spec-not-active' : 'spec-revision-mismatch');
    }
  }

  if (requirement.sourceValidity === 'SOURCE_DEFECT') {
    statuses.push('SOURCE_DEFECT');
    reasons.push('declared-source-defect');
  }
  if (requirement.sourceValidity === 'SOURCE_CONFLICT') {
    statuses.push('SOURCE_CONFLICT');
    reasons.push('declared-source-conflict');
  }

  if (requirement.status === 'SUPERSEDED') {
    statuses.push('INTENTIONAL_SUPERSESSION');
    reasons.push('requirement-explicitly-superseded');
    links.push({ from: requirement.requirementId, to: requirement.supersededBy, relation: 'superseded-by' });
    return { statuses: unique(statuses), reasons: unique(reasons), links };
  }

  for (const id of requirement.decisionIds || []) {
    const adr = map.get(id);
    if (!adr || adr.kind !== 'ADR') {
      statuses.push('UNTRACED_CHANGE');
      reasons.push(`missing-decision:${id}`);
      continue;
    }
    links.push({ from: id, to: requirement.requirementId, relation: 'governs' });
    if (adr.status !== 'ACTIVE') {
      statuses.push('UNTRACED_CHANGE');
      reasons.push(`decision-not-active:${id}`);
    }
  }

  if (!requirement.ticketIds?.length) {
    statuses.push('UNTRACED_CHANGE');
    reasons.push('no-ticket-lineage');
  }
  for (const id of requirement.ticketIds || []) {
    const ticket = map.get(id);
    if (!ticket || ticket.kind !== 'TICKET') {
      statuses.push('UNTRACED_CHANGE');
      reasons.push(`missing-ticket:${id}`);
      continue;
    }
    links.push({ from: requirement.requirementId, to: id, relation: 'implemented-by-change' });
    const targetRevision = ticket.requirementRevision;
    if (ticket.requirementId !== requirement.requirementId) {
      statuses.push('UNTRACED_CHANGE');
      reasons.push(`ticket-requirement-mismatch:${id}`);
    }
    if (Number.isInteger(targetRevision) && targetRevision > requirement.revision && ['behavior','architecture'].includes(ticket.changeImpact)) {
      statuses.push('STALE_SPEC');
      statuses.push('UNTRACED_CHANGE');
      reasons.push(`ticket-ahead-of-contract:${id}`);
    } else if (Number.isInteger(targetRevision) && targetRevision !== requirement.revision) {
      statuses.push('UNTRACED_CHANGE');
      reasons.push(`ticket-revision-mismatch:${id}`);
    }
    if (ticket.changeImpact === 'architecture' && !(requirement.decisionIds || []).length) {
      statuses.push('UNTRACED_CHANGE');
      reasons.push(`architecture-change-without-decision-lineage:${id}`);
    }
  }

  if (!requirement.testIds?.length) {
    statuses.push('STALE_TEST');
    reasons.push('no-test-lineage');
  }
  for (const id of requirement.testIds || []) {
    const testArtifact = map.get(id);
    if (!testArtifact || testArtifact.kind !== 'TEST') {
      statuses.push('STALE_TEST');
      reasons.push(`missing-test:${id}`);
      continue;
    }
    links.push({ from: requirement.requirementId, to: id, relation: 'protected-by' });
    if (testArtifact.requirementId !== requirement.requirementId || testArtifact.requirementRevision !== requirement.revision || testArtifact.status !== 'ACTIVE') {
      statuses.push('STALE_TEST');
      reasons.push(`test-lineage-mismatch:${id}`);
    }
  }

  if (!requirement.implementationIds?.length) {
    statuses.push('STALE_IMPLEMENTATION');
    reasons.push('no-implementation-lineage');
  }
  for (const id of requirement.implementationIds || []) {
    const impl = map.get(id);
    if (!impl || impl.kind !== 'IMPLEMENTATION') {
      statuses.push('STALE_IMPLEMENTATION');
      reasons.push(`missing-implementation:${id}`);
      continue;
    }
    links.push({ from: requirement.requirementId, to: id, relation: 'realized-by' });
    if (impl.requirementId !== requirement.requirementId || impl.requirementRevision !== requirement.revision || impl.status !== 'ACTIVE') {
      statuses.push('STALE_IMPLEMENTATION');
      reasons.push(`implementation-lineage-mismatch:${id}`);
    }
  }

  if (statuses.length === 0) statuses.push('CONSISTENT');
  return { statuses: unique(statuses), reasons: unique(reasons), links };
}

function protectionForRequirement(requirement, probesById, currentSpec = null) {
  const expected = requirement.requiredProbeIds || [];
  if (expected.length === 0) {
    return {
      status: 'NOT_EVALUATED',
      score: 0,
      required: 0,
      killed: 0,
      survived: 0,
      invalid: 0,
      missing: [],
      reasonCodes: ['no-required-probes-declared'],
    };
  }

  let killed = 0;
  let survived = 0;
  let invalid = 0;
  const missing = [];
  const reasonCodes = [];

  for (const id of expected) {
    const probe = probesById.get(id);
    if (!probe || probe.requirementId !== requirement.requirementId) {
      missing.push(id);
      continue;
    }
    const sourceMatchesCurrentSpec = currentSpec && typeof probe.sourceSection === 'string' &&
      (probe.sourceSection === currentSpec.path || probe.sourceSection.startsWith(`${currentSpec.path}#`));
    if (!sourceMatchesCurrentSpec) {
      invalid++;
      reasonCodes.push('probe-source-not-current-spec');
      continue;
    }
    if (probe.status === 'KILLED' && probe.failureClass === 'contract' && probe.workspaceIsolation === 'isolated' && text(probe.evidenceRef)) killed++;
    else if (probe.status === 'SURVIVED') survived++;
    else invalid++;
  }

  if (missing.length || invalid) {
    reasonCodes.push(...(missing.length ? ['required-probe-missing'] : []), ...(invalid ? ['invalid-probe-evidence'] : []));
    return { status: 'NOT_EVALUATED', score: 0, required: expected.length, killed, survived, invalid, missing, reasonCodes };
  }
  if (survived > 0) {
    return {
      status: 'SURVIVED',
      score: 0,
      required: expected.length,
      killed,
      survived,
      invalid,
      missing,
      reasonCodes: ['required-contract-probe-survived'],
    };
  }
  if (killed === expected.length) {
    return {
      status: 'PROTECTED',
      score: 100,
      required: expected.length,
      killed,
      survived,
      invalid,
      missing,
      reasonCodes: ['all-predeclared-contract-probes-killed'],
    };
  }
  return { status: 'NOT_EVALUATED', score: 0, required: expected.length, killed, survived, invalid, missing, reasonCodes: ['probe-evidence-incomplete'] };
}

function completenessByRequirement(tddEvidence) {
  if (!tddEvidence) return { report: null, byId: new Map(), score: 0, result: 'NOT_EVALUATED' };
  const report = evaluateEvidence(tddEvidence);
  const byId = new Map(report.requirements.map(req => [req.requirementId, { score: req.score, result: req.result }]));
  return { report, byId, score: report.score, result: report.result };
}

function evaluateTrace(trace, options = {}) {
  const validationErrors = validateTrace(trace);
  const map = Array.isArray(trace?.artifacts) ? artifactMap(trace) : new Map();
  const probesById = new Map((trace?.probes || []).map(probe => [probe.probeId, probe]));
  const completeness = completenessByRequirement(options.tddEvidence || null);
  const reportRequirements = [];
  const links = [];
  const globalErrors = [...validationErrors];

  if (validationErrors.length === 0) {
    const reqIds = new Set(trace.requirements.map(req => req.requirementId));
    for (const artifact of trace.artifacts) {
      for (const prior of artifact.supersedes || []) {
        if (!map.has(prior)) globalErrors.push(`artifact ${artifact.id} supersedes missing artifact ${prior}`);
        else links.push({ from: artifact.id, to: prior, relation: 'supersedes' });
      }
    }
    for (const requirement of trace.requirements) {
      if (requirement.status === 'SUPERSEDED' && !reqIds.has(requirement.supersededBy)) {
        globalErrors.push(`${requirement.requirementId}: supersededBy target does not exist: ${requirement.supersededBy}`);
      }
    }
  }

  for (const requirement of trace?.requirements || []) {
    const lineage = classifyLineage(requirement, map);
    links.push(...lineage.links);
    const currentSpec = map.get(requirement.specId) || null;
    const protection = protectionForRequirement(requirement, probesById, currentSpec);
    const quality = completeness.byId.get(requirement.requirementId) || { score: 0, result: 'NOT_EVALUATED' };
    const statuses = [...lineage.statuses];
    const qualityDetail = completeness.report?.requirements?.find(item => item.requirementId === requirement.requirementId) || null;
    if (qualityDetail && currentSpec && qualityDetail.source?.status === 'AUTHORITATIVE' &&
        qualityDetail.source.path !== currentSpec.path) {
      statuses.push('STALE_TEST');
      lineage.reasons.push('tdd-source-not-current-spec');
    }
    if (requirement.status === 'CURRENT' && protection.status === 'NOT_EVALUATED') statuses.push('NOT_EVALUATED');
    if (requirement.status === 'CURRENT' && quality.result === 'NOT_EVALUATED') statuses.push('NOT_EVALUATED');
    const blocking = statuses.filter(status => !['CONSISTENT','INTENTIONAL_SUPERSESSION'].includes(status));
    reportRequirements.push({
      requirementId: requirement.requirementId,
      revision: requirement.revision,
      lifecycleStatus: requirement.status,
      sourceRef: currentSpec ? `${currentSpec.path}#${requirement.requirementId}` : null,
      drift: unique(statuses),
      reasonCodes: lineage.reasons,
      completeness: quality,
      protection,
      gateEligible: requirement.status === 'SUPERSEDED' ? true : blocking.length === 0 && quality.result === 'PASS' && protection.status === 'PROTECTED',
    });
  }

  const current = reportRequirements.filter(req => req.lifecycleStatus === 'CURRENT');
  const completenessScore = current.length
    ? round(current.reduce((sum, req) => sum + req.completeness.score, 0) / current.length)
    : 0;
  const protectionScore = current.length
    ? round(current.reduce((sum, req) => sum + req.protection.score, 0) / current.length)
    : 0;
  const contractIntegrityScore = Math.min(completenessScore, protectionScore);
  const driftCounts = Object.fromEntries([...DRIFT].map(status => [status, 0]));
  for (const req of reportRequirements) for (const status of req.drift) driftCounts[status] = (driftCounts[status] || 0) + 1;

  const strictPass = globalErrors.length === 0 &&
    current.length > 0 &&
    current.every(req => req.gateEligible) &&
    contractIntegrityScore === 100;

  return {
    schemaVersion: VERSION,
    mode: trace?.mode || null,
    result: globalErrors.length ? 'FAIL' : (strictPass ? 'PASS' : (trace?.mode === 'audit' ? 'AUDIT' : 'FAIL')),
    completionGate: strictPass ? 'PASS' : (current.some(req => req.drift.includes('NOT_EVALUATED')) ? 'NOT_EVALUATED' : 'FAIL'),
    gateEligible: strictPass,
    scores: {
      completenessScore,
      protectionScore,
      contractIntegrityScore,
      formula: 'min(completenessScore, protectionScore)',
    },
    counts: {
      artifacts: trace?.artifacts?.length || 0,
      requirements: reportRequirements.length,
      currentRequirements: current.length,
      probes: trace?.probes?.length || 0,
    },
    driftCounts,
    requirements: reportRequirements,
    repairGuidance: repairGuidance(reportRequirements),
    graph: {
      nodes: [
        ...(trace?.artifacts || []).map(artifact => ({ id: artifact.id, kind: artifact.kind, status: artifact.status, path: artifact.path })),
        ...(trace?.requirements || []).map(req => ({ id: req.requirementId, kind: 'REQUIREMENT', status: req.status, revision: req.revision })),
      ],
      links: unique(links.map(link => JSON.stringify(stable(link)))).map(value => JSON.parse(value)),
    },
    tddQuality: completeness.report,
    errors: globalErrors,
  };
}

function markdown(report) {
  const lines = [
    '# Contract Integrity Report',
    '',
    `- Mode: **${report.mode}**`,
    `- Result: **${report.result}**`,
    `- Completion gate: **${report.completionGate}**`,
    `- Completeness score: **${report.scores.completenessScore}**`,
    `- Protection score: **${report.scores.protectionScore}**`,
    `- Contract integrity score: **${report.scores.contractIntegrityScore}** = min(completeness, protection)`,
    '',
    '| Requirement | Rev | Drift | Completeness | Protection | Gate |',
    '| --- | ---: | --- | ---: | --- | --- |',
  ];
  for (const req of report.requirements) {
    lines.push(`| ${req.requirementId} | ${req.revision} | ${req.drift.join(', ')} | ${req.completeness.score} | ${req.protection.status} | ${req.gateEligible ? 'PASS' : 'FAIL'} |`);
  }
  if (report.repairGuidance?.length) {
    lines.push('', '## Repair Guidance', '');
    for (const item of report.repairGuidance) {
      lines.push(`- **${item.priority}** ${item.requirementId}${item.sourceRef ? ` (${item.sourceRef})` : ''}: ${item.action} [${item.code}]`);
    }
  }
  if (report.errors.length) {
    lines.push('', '## Errors', '', ...report.errors.map(error => `- ${error}`));
  }
  if (report.provenance) {
    lines.push('', '## Provenance', '');
    lines.push(`- Audit version: ${report.provenance.auditVersion}`);
    lines.push(`- Git revision: ${report.provenance.gitRevision || 'unknown'}`);
    lines.push(`- Trace SHA-256: ${report.provenance.inputs?.trace?.sha256 || 'unknown'}`);
    lines.push(`- TDD evidence SHA-256: ${report.provenance.inputs?.tddEvidence?.sha256 || 'none'}`);
  }
  lines.push('', '## Evidence boundary', '');
  lines.push('- Completeness is derived by the existing #58 evaluator; aggregate scores supplied by agents are ignored.');
  lines.push('- Protection counts only predeclared required probes. Extra/padded probes do not raise a requirement score.');
  lines.push('- Build/infrastructure/flaky failures are invalid probe evidence and cannot count as killed contract probes.');
  lines.push('- Audit mode reports legacy debt without authorizing completion; strict mode fails on any unresolved drift or NOT_EVALUATED protection.');
  return `${lines.join('\n')}\n`;
}

function parseArgs(argv) {
  const args = { input: null, tddEvidence: null, output: null, markdown: null, workspace: null, verifyFresh: null };
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    if (!args.input && !token.startsWith('--')) args.input = token;
    else if (token === '--tdd-evidence') args.tddEvidence = argv[++i];
    else if (token === '--output') args.output = argv[++i];
    else if (token === '--markdown') args.markdown = argv[++i];
    else if (token === '--workspace') args.workspace = argv[++i];
    else if (token === '--verify-fresh') args.verifyFresh = argv[++i];
    else throw new Error(`unknown argument: ${token}`);
  }
  return args;
}

function runCli(argv) {
  let args;
  try { args = parseArgs(argv.slice(2)); }
  catch (error) { console.error(`Contract Integrity: FAIL\n- ${error.message}`); return 2; }
  if (!args.input) {
    console.error('Usage: node contract-integrity/scripts/audit.js <trace.json> [--tdd-evidence <#58-evidence.json>] [--workspace <root>] [--output report.json] [--markdown report.md] [--verify-fresh prior-report.json]');
    return 2;
  }

  let trace;
  let tddEvidence = null;
  try {
    trace = readJson(args.input);
    if (args.tddEvidence) tddEvidence = readJson(args.tddEvidence);
  } catch (error) {
    console.error(`Contract Integrity: FAIL\n- ${error.message}`);
    return 2;
  }

  if (args.verifyFresh) {
    let prior;
    try { prior = readJson(args.verifyFresh); }
    catch (error) {
      console.error(`Contract Integrity Freshness: FAIL\n- ${error.message}`);
      return 2;
    }
    const freshness = verifyFreshReport(prior, args, trace);
    console.log(`Contract Integrity Freshness: ${freshness.authorizesCompletion ? 'PASS' : 'FAIL'}`);
    for (const reason of freshness.reasons) console.error(`- ${reason}`);
    return freshness.authorizesCompletion ? 0 : 1;
  }

  const report = evaluateTrace(trace, { tddEvidence });
  report.provenance = buildProvenance(args, trace);
  if (args.workspace) {
    const missing = report.provenance.artifacts.filter(item => item.missing);
    if (trace.mode === 'strict' && missing.length) {
      report.result = 'FAIL';
      report.completionGate = 'FAIL';
      report.gateEligible = false;
      report.errors.push(...missing.map(item => `provenance artifact missing from workspace: ${item.id} -> ${item.path}`));
    }
  }
  console.log(`Contract Integrity: ${report.result}`);
  console.log(`Scores: completeness=${report.scores.completenessScore} protection=${report.scores.protectionScore} integrity=${report.scores.contractIntegrityScore}`);
  console.log(`Gate: ${report.completionGate}`);
  for (const req of report.requirements) console.log(`- ${req.requirementId}: ${req.drift.join(', ')} / protection=${req.protection.status}`);
  for (const error of report.errors) console.error(`- error: ${error}`);

  if (args.output) {
    fs.mkdirSync(path.dirname(path.resolve(args.output)), { recursive: true });
    fs.writeFileSync(path.resolve(args.output), `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  }
  if (args.markdown) {
    fs.mkdirSync(path.dirname(path.resolve(args.markdown)), { recursive: true });
    fs.writeFileSync(path.resolve(args.markdown), markdown(report), 'utf8');
  }

  if (report.errors.length) return 2;
  if (trace.mode === 'audit') return 0;
  return report.result === 'PASS' ? 0 : 1;
}

if (require.main === module) process.exit(runCli(process.argv));

module.exports = {
  DRIFT,
  VERSION,
  buildProvenance,
  classifyLineage,
  evaluateTrace,
  markdown,
  repairGuidance,
  protectionForRequirement,
  runCli,
  validateTrace,
  verifyFreshReport,
};
