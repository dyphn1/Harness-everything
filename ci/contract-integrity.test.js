#!/usr/bin/env node
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const {
  DRIFT,
  evaluateTrace,
  markdown,
  validateTrace,
} = require(path.join(ROOT, 'contract-integrity/scripts/audit.js'));
const { evaluateEvidence } = require(path.join(ROOT, 'tdd/scripts/quality-gate.js'));

let failed = 0;
function check(condition, message, detail = '') {
  if (condition) console.log(`  PASS ${message}`);
  else {
    console.error(`  FAIL ${message}${detail ? ` — ${detail}` : ''}`);
    failed++;
  }
}
function clone(value) {
  return JSON.parse(JSON.stringify(value));
}
function fixture(name) {
  return JSON.parse(fs.readFileSync(path.join(ROOT, 'contract-integrity', 'fixtures', name), 'utf8'));
}
function tddEvidence(specPath = 'docs/specs/api.md', section = 'REQ-001') {
  const value = JSON.parse(fs.readFileSync(path.join(ROOT, 'tdd', 'fixtures', 'pass-evidence.json'), 'utf8'));
  value.requirements[0].source.path = specPath;
  value.requirements[0].source.section = section;
  return value;
}
function req(report, id = 'REQ-001') {
  return report.requirements.find(item => item.requirementId === id);
}

console.log('=== Contract Integrity Phase 1-2 (#84) ===');

const baseline = fixture('consistent-trace.json');
const baselineTdd = tddEvidence();
const legacyQuality = evaluateEvidence(baselineTdd);
check(legacyQuality.result === 'PASS' && legacyQuality.score === 100, '#58 completeness evaluator remains independently backward compatible');

const baselineReport = evaluateTrace(baseline, { tddEvidence: baselineTdd });
check(baselineReport.result === 'PASS' && baselineReport.completionGate === 'PASS', 'fully traced current contract passes strict reconciliation');
check(baselineReport.scores.completenessScore === 100 && baselineReport.scores.protectionScore === 100 && baselineReport.scores.contractIntegrityScore === 100, 'integrity score is min(100 completeness, 100 protection)');
check(req(baselineReport).drift.length === 1 && req(baselineReport).drift[0] === 'CONSISTENT', 'consistent requirement has no fabricated drift category');
check(req(baselineReport).protection.status === 'PROTECTED' && req(baselineReport).protection.required === 1, 'only predeclared required probe evidence determines protection');

const drift = fixture('ticket-drift-trace.json');
const driftReport = evaluateTrace(drift, { tddEvidence: baselineTdd });
check(driftReport.result === 'FAIL', 'strict mode fails when ticket feedback moves behavior ahead of living contract');
check(req(driftReport).drift.includes('STALE_SPEC') && req(driftReport).drift.includes('UNTRACED_CHANGE'), 'ticket-ahead fixture reports exact stale-spec and untraced-change categories');
check(req(driftReport).reasonCodes.some(code => code.startsWith('ticket-ahead-of-contract:')), 'drift report points to the ticket that outran the contract');

const reconciled = fixture('reconciled-trace.json');
const reconciledTdd = tddEvidence('docs/specs/api.md', 'REQ-001-v2');
const reconciledReport = evaluateTrace(reconciled, { tddEvidence: reconciledTdd });
check(reconciledReport.result === 'PASS' && req(reconciledReport).drift.includes('CONSISTENT'), 'ADR amendment + living spec/test/implementation revision reconciliation restores PASS');
check(reconciledReport.graph.links.some(link => link.relation === 'supersedes' && link.from === 'ADR-002' && link.to === 'ADR-001'), 'decision supersession is linked instead of appending ticket chronology to old ADR');

const staleQuality = evaluateTrace(reconciled, { tddEvidence: tddEvidence('docs/old-api.md', 'REQ-001') });
check(req(staleQuality).drift.includes('STALE_TEST') && req(staleQuality).reasonCodes.includes('tdd-source-not-current-spec'), '#58 evidence bound to an old source cannot certify the current living spec');
check(staleQuality.result === 'FAIL', 'stale #58 source binding blocks strict completion despite a 100 completeness score');

const staleProbe = clone(reconciled);
staleProbe.probes[0].sourceSection = 'docs/old-api.md#REQ-001';
const staleProbeReport = evaluateTrace(staleProbe, { tddEvidence: reconciledTdd });
check(req(staleProbeReport).protection.status === 'NOT_EVALUATED', 'probe derived from a stale source section is rejected as protection evidence');
check(staleProbeReport.scores.protectionScore === 0 && staleProbeReport.scores.contractIntegrityScore === 0, 'stale probe evidence fails closed to zero protection');

const padding = clone(baseline);
padding.probes[0].status = 'SURVIVED';
padding.probes[0].failureClass = 'none';
for (let i = 0; i < 10; i++) {
  padding.probes.push({
    probeId: `PAD-${i}`,
    requirementId: 'REQ-001',
    status: 'KILLED',
    sourceSection: 'docs/specs/api.md#REQ-001',
    evidenceRef: `probe:padding-${i}`,
    workspaceIsolation: 'isolated',
    failureClass: 'contract',
  });
}
const paddedReport = evaluateTrace(padding, { tddEvidence: baselineTdd });
check(req(paddedReport).protection.status === 'SURVIVED' && paddedReport.scores.protectionScore === 0, 'extra killed probes cannot dilute one surviving predeclared required probe');
check(paddedReport.result === 'FAIL', 'padding tests/probes cannot turn a weak protection result green');

const invalidKill = clone(baseline);
invalidKill.probes[0].failureClass = 'build';
const invalidErrors = validateTrace(invalidKill);
check(invalidErrors.some(error => /KILLED requires failureClass=contract/.test(error)), 'compile/build failure cannot be counted as a killed contract probe');
const invalidKillReport = evaluateTrace(invalidKill, { tddEvidence: baselineTdd });
check(invalidKillReport.errors.length > 0 && invalidKillReport.result === 'FAIL', 'invalid probe evidence fails closed rather than lowering thresholds');

const notEvaluated = clone(baseline);
notEvaluated.probes = [];
const notEvaluatedReport = evaluateTrace(notEvaluated, { tddEvidence: baselineTdd });
check(req(notEvaluatedReport).protection.status === 'NOT_EVALUATED', 'missing required probe is explicit NOT_EVALUATED');
check(notEvaluatedReport.completionGate === 'NOT_EVALUATED' && notEvaluatedReport.result === 'FAIL', 'strict mode cannot authorize completion without protection evidence');

const auditOnly = clone(baseline);
auditOnly.mode = 'audit';
auditOnly.requirements[0].ticketIds = [];
auditOnly.requirements[0].testIds = [];
auditOnly.requirements[0].implementationIds = [];
auditOnly.requirements[0].requiredProbeIds = [];
auditOnly.probes = [];
const auditReport = evaluateTrace(auditOnly, { tddEvidence: null });
check(auditReport.result === 'AUDIT' && auditReport.gateEligible === false, 'audit-only adoption reports legacy debt without claiming completion eligibility');
check(req(auditReport).drift.includes('UNTRACED_CHANGE') && req(auditReport).drift.includes('STALE_TEST') && req(auditReport).drift.includes('STALE_IMPLEMENTATION') && req(auditReport).drift.includes('NOT_EVALUATED'), 'legacy audit exposes missing ticket/test/implementation/protection links');

const sourceDefect = clone(baseline);
sourceDefect.requirements[0].sourceValidity = 'SOURCE_DEFECT';
const defectReport = evaluateTrace(sourceDefect, { tddEvidence: baselineTdd });
check(req(defectReport).drift.includes('SOURCE_DEFECT') && defectReport.result === 'FAIL', 'source defect stays distinct and fail-closed in strict mode');

const sourceConflict = clone(baseline);
sourceConflict.requirements[0].sourceValidity = 'SOURCE_CONFLICT';
const conflictReport = evaluateTrace(sourceConflict, { tddEvidence: baselineTdd });
check(req(conflictReport).drift.includes('SOURCE_CONFLICT') && conflictReport.result === 'FAIL', 'source conflict stays distinct and fail-closed');

const supersession = clone(baseline);
supersession.requirements.unshift({
  requirementId: 'REQ-OLD',
  revision: 1,
  status: 'SUPERSEDED',
  specId: 'SPEC-001',
  decisionIds: [],
  ticketIds: [],
  testIds: [],
  implementationIds: [],
  requiredProbeIds: [],
  sourceValidity: 'VALID',
  supersededBy: 'REQ-001',
});
const supersessionReport = evaluateTrace(supersession, { tddEvidence: baselineTdd });
check(req(supersessionReport, 'REQ-OLD').drift.includes('INTENTIONAL_SUPERSESSION'), 'explicit requirement supersession is distinguished from stale/untraced drift');
check(supersessionReport.result === 'PASS', 'historical superseded requirement does not poison the current contract gate');

const reportMd = markdown(driftReport);
check(/Contract Integrity Report/.test(reportMd) && /STALE_SPEC/.test(reportMd) && /min\(completeness, protection\)/.test(reportMd), 'Markdown report exposes drift and score formula');
check(Object.keys(driftReport.driftCounts).every(status => DRIFT.has(status)), 'machine report uses only the declared drift vocabulary');
check(driftReport.graph.nodes.some(node => node.kind === 'REQUIREMENT') && driftReport.graph.links.some(link => link.relation === 'protected-by'), 'machine report publishes a traceable contract graph');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-contract-integrity-'));
try {
  const tracePath = path.join(tmp, 'trace.json');
  const tddPath = path.join(tmp, 'tdd.json');
  const jsonPath = path.join(tmp, 'report.json');
  const mdPath = path.join(tmp, 'report.md');
  fs.writeFileSync(tracePath, JSON.stringify(baseline), 'utf8');
  fs.writeFileSync(tddPath, JSON.stringify(baselineTdd), 'utf8');
  const cli = spawnSync(process.execPath, [
    path.join(ROOT, 'contract-integrity/scripts/audit.js'),
    tracePath,
    '--tdd-evidence', tddPath,
    '--output', jsonPath,
    '--markdown', mdPath,
  ], { encoding: 'utf8' });
  check(cli.status === 0 && fs.existsSync(jsonPath) && fs.existsSync(mdPath), 'strict CLI writes both machine-readable JSON and concise Markdown reports');
  const cliReport = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
  check(cliReport.result === 'PASS' && /Contract Integrity Report/.test(fs.readFileSync(mdPath, 'utf8')), 'CLI reports retain deterministic PASS evidence');

  const auditPath = path.join(tmp, 'audit.json');
  fs.writeFileSync(auditPath, JSON.stringify(auditOnly), 'utf8');
  const auditCli = spawnSync(process.execPath, [path.join(ROOT, 'contract-integrity/scripts/audit.js'), auditPath], { encoding: 'utf8' });
  check(auditCli.status === 0 && /Contract Integrity: AUDIT/.test(auditCli.stdout), 'audit mode exits zero for migration/debt inventory without pretending to pass');

  const strictMissing = clone(notEvaluated);
  fs.writeFileSync(tracePath, JSON.stringify(strictMissing), 'utf8');
  const strictCli = spawnSync(process.execPath, [
    path.join(ROOT, 'contract-integrity/scripts/audit.js'), tracePath, '--tdd-evidence', tddPath,
  ], { encoding: 'utf8' });
  check(strictCli.status === 1 && /Gate: NOT_EVALUATED/.test(strictCli.stdout), 'strict CLI returns failure for valid-but-incomplete protection evidence');

  fs.writeFileSync(tracePath, '{', 'utf8');
  const malformedCli = spawnSync(process.execPath, [path.join(ROOT, 'contract-integrity/scripts/audit.js'), tracePath], { encoding: 'utf8' });
  check(malformedCli.status === 2, 'malformed trace returns infrastructure/schema exit 2');
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}

const unknownField = clone(baseline);
unknownField.artifacts[0].agentScore = 100;
check(validateTrace(unknownField).some(error => /unknown field: agentScore/.test(error)), 'runtime rejects fields that the JSON schema does not permit');

const absolutePath = clone(baseline);
absolutePath.artifacts[0].path = path.resolve(ROOT, 'docs/adr/0001-api-contract.md');
check(validateTrace(absolutePath).some(error => /repo-relative/.test(error)), 'trace report rejects machine-specific absolute artifact paths');

const schema = JSON.parse(fs.readFileSync(path.join(ROOT, 'contract-integrity/schemas/trace.schema.json'), 'utf8'));
check(schema.properties?.probes?.items?.properties?.status?.enum?.includes('SURVIVED'), 'versioned trace schema includes probe disposition vocabulary');
check(schema.properties?.requirements?.items?.properties?.requiredProbeIds?.uniqueItems === true, 'schema prevents duplicate required-probe padding');

// Phase 2: existing documentation workflows carry the Phase-1 trace vocabulary
// end-to-end instead of introducing another directly routed skill.
const doc = relative => fs.readFileSync(path.join(ROOT, relative), 'utf8');
const adrFormat = doc('grill-with-docs/ADR-FORMAT.md');
check(/Once an ADR is \*\*accepted\*\*/.test(adrFormat) && /superseded by ADR-NNNN/.test(adrFormat) &&
  /Affected requirements: REQ-001/.test(adrFormat),
  'ADR guidance preserves accepted history and requires supersession/requirement lineage');

for (const template of [
  'to-spec/templates/feature-spec.md',
  'to-spec/templates/cli-reference.md',
  'to-spec/templates/schema-doc.md',
  'to-spec/templates/dev-doc.md',
]) {
  const text = doc(template);
  check(/REQ-001/.test(text) && /\*\*Status:\*\* CURRENT/.test(text) &&
    /\*\*Revision:\*\* 1/.test(text) && /\*\*Decision lineage:\*\*/.test(text),
    template + ' carries stable requirement id/status/revision/decision lineage');
}

const specProcess = doc('to-spec/references/process.md');
check(/Never recycle a `REQ-\*` ID/.test(specProcess) &&
  /Behavior changes increment the requirement revision/.test(specProcess) &&
  /changeImpact: architecture/.test(specProcess),
  'to-spec process reconciles behavior/architecture changes back to current contract sources');

const ticketProcess = doc('to-tickets/references/publishing-and-templates.md');
check(/\*\*Source requirements:\*\* `REQ-001@rev1`/.test(ticketProcess) &&
  /\*\*Change impact:\*\*/.test(ticketProcess) &&
  /\*\*behavior\*\*/.test(ticketProcess) && /\*\*architecture\*\*/.test(ticketProcess),
  'ticket templates require source requirement revision and change-impact classification');
check(/living spec requirement and revision first/.test(ticketProcess) &&
  /new\/superseding ADR/.test(ticketProcess),
  'behavior/architecture ticket drift is routed back to living spec/ADR before completion');

const verifySkill = doc('verification-loop/SKILL.md');
const verifyPhases = doc('verification-loop/references/verification-phases.md');
const verifyReport = doc('verification-loop/templates/verification-report.template.md');
check(/scripts\/contract-integrity-audit\.js/.test(verifySkill) &&
  /strict \*\*PASS\*\*/.test(verifyPhases) &&
  /`AUDIT`/.test(verifyPhases) && /`NOT_EVALUATED`/.test(verifyPhases),
  'verification-loop makes current contract reconciliation a non-compensating delivery gate');
check(/Contract:\s+\[PASS\/FAIL\/NOT_APPLICABLE\]/.test(verifyReport) &&
  /AUDIT or NOT_EVALUATED is NOT READY/.test(verifyReport),
  'verification report cannot hide unresolved contract state behind green build/tests');

check(!fs.existsSync(path.join(ROOT, 'contract-integrity', 'SKILL.md')),
  'Phase 2 integrates existing routed skills instead of adding a colliding contract-integrity routing surface');

for (const relative of [
  'grill-with-docs/ADR-FORMAT.md',
  'to-spec/references/process.md',
  'to-spec/templates/feature-spec.md',
  'to-spec/templates/cli-reference.md',
  'to-spec/templates/schema-doc.md',
  'to-spec/templates/dev-doc.md',
  'to-tickets/references/publishing-and-templates.md',
  'verification-loop/SKILL.md',
  'verification-loop/references/verification-phases.md',
  'verification-loop/templates/verification-report.template.md',
]) {
  const mirror = path.join(ROOT, 'plugins/harness-everything/skills', relative);
  check(fs.existsSync(mirror) && doc(relative) === fs.readFileSync(mirror, 'utf8'),
    'Phase 2 OpenAI package mirror matches canonical: ' + relative);
}

// Phase 4: reports carry actionable requirement-scoped repair guidance and
// content fingerprints so stale completion evidence cannot be reused.
check(driftReport.repairGuidance.some(item =>
  item.requirementId === 'REQ-001' && item.code === 'update-living-spec' &&
  item.sourceRef === 'docs/specs/api.md#REQ-001'),
  'stale-spec drift emits requirement-scoped living-spec repair guidance');
check(paddedReport.repairGuidance.some(item =>
  item.requirementId === 'REQ-001' && item.code === 'strengthen-weak-oracle' && item.priority === 'BLOCKER'),
  'surviving required probe emits BLOCKER weak-oracle guidance');
check(/Repair Guidance/.test(markdown(driftReport)) && /REQ-001/.test(markdown(driftReport)),
  'Markdown keeps repair guidance concise and tied to requirement identity');

const freshRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-contract-freshness-'));
try {
  const workspace = path.join(freshRoot, 'workspace');
  fs.mkdirSync(workspace, { recursive: true });
  for (const artifact of baseline.artifacts) {
    const file = path.join(workspace, artifact.path);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, artifact.id + ': fixture content\n', 'utf8');
  }
  const tracePath = path.join(freshRoot, 'trace.json');
  const tddPath = path.join(freshRoot, 'tdd.json');
  const reportPath = path.join(freshRoot, 'report.json');
  fs.writeFileSync(tracePath, JSON.stringify(baseline), 'utf8');
  fs.writeFileSync(tddPath, JSON.stringify(baselineTdd), 'utf8');

  const audit = spawnSync(process.execPath, [
    path.join(ROOT, 'contract-integrity/scripts/audit.js'),
    tracePath,
    '--tdd-evidence', tddPath,
    '--workspace', workspace,
    '--output', reportPath,
  ], { encoding: 'utf8' });
  check(audit.status === 0, 'strict audit with existing workspace artifacts produces fresh PASS report', audit.stderr);
  const freshReport = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
  check(freshReport.provenance?.inputs?.trace?.sha256 &&
    freshReport.provenance?.inputs?.tddEvidence?.sha256 &&
    freshReport.provenance?.artifacts?.length === baseline.artifacts.length &&
    freshReport.provenance.artifacts.every(item => item.sha256 && item.missing === false),
    'report provenance records trace/TDD hashes plus current artifact hashes');

  const verifyFresh = () => spawnSync(process.execPath, [
    path.join(ROOT, 'contract-integrity/scripts/audit.js'),
    tracePath,
    '--tdd-evidence', tddPath,
    '--workspace', workspace,
    '--verify-fresh', reportPath,
  ], { encoding: 'utf8' });

  const current = verifyFresh();
  check(current.status === 0 && /Freshness: PASS/.test(current.stdout),
    'unchanged PASS report can authorize completion');

  const testArtifact = path.join(workspace, 'tests/api.test.js');
  fs.appendFileSync(testArtifact, 'changed after audit\n', 'utf8');
  const staleTestReport = verifyFresh();
  check(staleTestReport.status === 1 &&
    /artifact-changed-since-audit:TEST-001/.test(staleTestReport.stderr),
    'test artifact change invalidates previously passing report');
  fs.writeFileSync(testArtifact, 'TEST-001: fixture content\n', 'utf8');

  fs.writeFileSync(tddPath, JSON.stringify({ ...baselineTdd, changedAfterAudit: true }), 'utf8');
  const staleEvidence = verifyFresh();
  check(staleEvidence.status === 1 &&
    /tdd-evidence-changed-since-audit/.test(staleEvidence.stderr),
    '#58 evidence change invalidates previously passing report');

  fs.writeFileSync(tddPath, JSON.stringify(baselineTdd), 'utf8');
  fs.rmSync(path.join(workspace, 'src/api.js'));
  const missingArtifactAudit = spawnSync(process.execPath, [
    path.join(ROOT, 'contract-integrity/scripts/audit.js'),
    tracePath,
    '--tdd-evidence', tddPath,
    '--workspace', workspace,
  ], { encoding: 'utf8' });
  check(missingArtifactAudit.status === 2 &&
    /provenance artifact missing from workspace: IMPL-001/.test(missingArtifactAudit.stderr),
    'strict workspace-aware audit fails closed when traced implementation evidence is missing');
} finally {
  fs.rmSync(freshRoot, { recursive: true, force: true });
}

console.log(`\n${failed === 0 ? 'PASS' : 'FAIL'}: #84 contract integrity phase 1-4 mechanism (${failed} failure${failed === 1 ? '' : 's'})`);
process.exit(failed === 0 ? 0 : 1);
