#!/usr/bin/env node
/**
 * Contract Test (PostToolUse: Bash|PowerShell)
 *
 * Phase 3 resolves Fable stage checks against run-scoped contracts under the
 * workspace-keyed global state root:
 *   state/fable-runs/<runId>/contracts/<stageId>.json
 *
 * A check is updated only when the command can be correlated to exactly one
 * run/stage (session/worker metadata narrows the match when the host exposes
 * it). Ambiguous matches are surfaced instead of mutating multiple runs.
 * Verification evidence is written beside the run so planId/runId/stageId
 * remain auditable without moving Fable's audit/model-selection ownership.
 */
const fs = require('fs');
const path = require('path');
const { getSessionId, getWorkspaceRoot, getStateRoot } = require('./lib/harness-state');
const {
  atomicWriteJson,
  chooseCorrelatedContract,
  commandMatches,
  listRunContracts,
  getWorkerId,
} = require('./lib/fable-contracts');
const { loadWorkflow, matchingRun, recordBudgetEvent } = require('./lib/workflow-runtime');
const { createLearningOpportunity } = require('./lib/learning-opportunity');

function resultState(payload) {
  const toolResponse = payload.tool_response || payload.tool_result || {};
  const stdout = toolResponse.stdout ?? payload.stdout ?? '';
  const stderr = toolResponse.stderr ?? payload.stderr ?? '';
  const rawExitCode = toolResponse.exitCode ?? toolResponse.exit_code ?? toolResponse.code ?? payload.exitCode;
  const exitCode = typeof rawExitCode === 'number' ? rawExitCode : undefined;
  const stderrSignal = typeof stderr === 'string' && stderr.trim().length > 0;
  const failed = toolResponse.is_error === true || Boolean(toolResponse.error) ||
    (exitCode !== undefined && exitCode !== 0) ||
    (exitCode === undefined && stderrSignal);
  const evidence = ((stderrSignal ? stderr : stdout) || '').slice(-1000).trim();
  return { failed, exitCode, evidence };
}

function updateRunContract(entry, payload, command, sessionId) {
  const { failed, exitCode, evidence } = resultState(payload);
  const observedAt = new Date().toISOString();
  const contract = {
    ...entry.contract,
    workerId: entry.contract.workerId || getWorkerId(payload),
    status: failed ? 'fail' : 'pass',
    lastObservedCommand: command,
    lastObservedExitCode: exitCode ?? null,
    evidence,
    verifiedAt: observedAt,
    updatedAt: observedAt,
  };
  const evidenceRelative = path.posix.join('evidence', `${contract.stageId}.json`);
  contract.verificationEvidence = evidenceRelative;

  atomicWriteJson(path.join(entry.runRoot, evidenceRelative), {
    schemaVersion: 1,
    planId: contract.planId,
    runId: contract.runId,
    stageId: contract.stageId,
    sessionId: sessionId || contract.sessionId || null,
    workerId: contract.workerId || null,
    checkCommand: command,
    status: failed ? 'fail' : 'pass',
    exitCode: exitCode ?? null,
    evidence,
    observedAt,
  });
  atomicWriteJson(entry.filePath, contract);
  return contract;
}

function resolveLegacyContract(stateRoot, command, payload) {
  const contractsDir = path.join(stateRoot, 'contracts');
  let files = [];
  try { files = fs.readdirSync(contractsDir).filter(file => file.endsWith('.json')); } catch (_) { return null; }
  const matches = [];
  for (const file of files) {
    const filePath = path.join(contractsDir, file);
    let manifest;
    try { manifest = JSON.parse(fs.readFileSync(filePath, 'utf8')); } catch (_) { continue; }
    if (manifest.status !== 'pending' || !manifest.checkCommand || manifest.checkCommand.trim() !== command) continue;
    matches.push({ manifest, filePath });
  }
  if (matches.length !== 1) return matches.length > 1 ? { ambiguous: true } : null;
  const { failed, evidence } = resultState(payload);
  const match = matches[0];
  match.manifest.status = failed ? 'fail' : 'pass';
  match.manifest.evidence = evidence;
  match.manifest.verifiedAt = new Date().toISOString();
  atomicWriteJson(match.filePath, match.manifest);
  return { legacy: true, failed, contract: match.manifest };
}

let inputData = '';
process.stdin.on('data', chunk => { inputData += chunk; });
process.stdin.on('end', () => {
  try {
    const payload = JSON.parse(inputData);
    if (payload.tool_name !== 'Bash' && payload.tool_name !== 'PowerShell') process.exit(0);

    const command = ((payload.tool_input && payload.tool_input.command) || '').trim();
    if (!command) process.exit(0);

    const root = getWorkspaceRoot(payload);
    const stateRoot = getStateRoot(root, payload);
    const sessionId = getSessionId(payload);
    const workflowContext = loadWorkflow(payload);
    const activeRun = workflowContext.workflow?.workflowId ? matchingRun(workflowContext) : null;
    const runMatches = listRunContracts(stateRoot).filter(({ contract }) =>
      (contract.workflowId ? ['pending', 'planned', 'running', 'fail', 'pass'] : ['pending', 'planned', 'running']).includes(contract.status) && commandMatches(contract, command) &&
      (!workflowContext.workflow?.workflowId || (activeRun && contract.runId === activeRun.run.runId && contract.sessionId === sessionId))
    );

    if (runMatches.length > 0) {
      const resolution = chooseCorrelatedContract(runMatches, payload, sessionId);
      if (resolution.ambiguous || !resolution.match) {
        console.error(`[Contract Test] Ambiguous Fable check command matched ${runMatches.length} active run contract(s): ${command}`);
        console.error('No contract was mutated. Correlate the worker/session to one run before accepting this check.');
        process.exit(2);
      }

      const entry = resolution.match;
      if (entry.contract.workflowId) {
        const worker = getWorkerId(payload);
        if (!worker || (entry.contract.workerId && worker !== entry.contract.workerId)) {
          console.error('[Contract Test] Active workflow check lacks a matching observed worker identity.');
          process.exit(2);
        }
        for (const id of entry.contract.dependsOn || []) {
          const dependency = JSON.parse(fs.readFileSync(path.join(entry.runRoot, 'contracts', `${id}.json`), 'utf8'));
          const escaped = workflowContext.workflow.escapes?.some(item => item.stageId === id && item.runId === entry.contract.runId);
          if (dependency.status !== 'pass' && !escaped) {
            console.error('[Contract Test] Dependency has not passed: ' + id);
            process.exit(2);
          }
        }
      }
      const previousStatus = entry.contract.status;
      const previousVerifiedAt = entry.contract.verifiedAt || entry.contract.updatedAt || null;
      const contract = updateRunContract(entry, payload, command, sessionId);
      if (previousStatus === 'fail' && contract.status === 'pass') {
        try {
          createLearningOpportunity(payload, {
            triggerType: 'verifier-fail-pass',
            sourceEventIds: [
              `verifier-fail:${contract.runId}:${contract.stageId}:${previousVerifiedAt || 'unknown'}`,
              `verifier-pass:${contract.runId}:${contract.stageId}:${contract.verifiedAt}`,
            ],
            evidence: {
              planId: contract.planId,
              runId: contract.runId,
              stageId: contract.stageId,
              previousStatus: 'fail',
              currentStatus: 'pass',
              verificationEvidenceRef: contract.verificationEvidence,
            },
          });
        } catch (_) {
          // Learning capture is additive; verification disposition stays authoritative.
        }
      }
      console.log(`[Contract Test] ${contract.planId}/${contract.runId}/${contract.stageId}: ${contract.status.toUpperCase()} ${contract.checkCommand}`);
      if (contract.status === 'fail') {
        if (workflowContext.workflow?.workflowId) {
          recordBudgetEvent(workflowContext, 'revision', { evidence: `${contract.stageId}:${contract.evidence || 'verification-failed'}` });
        }
        console.error(`Evidence: ${contract.evidence || '(no output captured)'}`);
        console.error(`Do not build on this stage's output until it passes. Artifact: ${contract.outputPath || '(no path recorded)'}`);
        process.exit(2);
      }
      process.exit(0);
    }

    // Temporary compatibility with pre-Phase-3 manifests. New orchestration
    // must use run-scoped contracts; legacy manifests have no plan/run link.
    const legacy = resolveLegacyContract(stateRoot, command, payload);
    if (legacy && legacy.ambiguous) {
      console.error(`[Contract Test] Ambiguous legacy stage contracts matched: ${command}`);
      process.exit(2);
    }
    if (legacy && legacy.failed) {
      console.error(`[Contract Test] Legacy stage "${legacy.contract.stageId}" FAILED its named check: ${legacy.contract.checkCommand}`);
      console.error(`Evidence: ${legacy.contract.evidence || '(no output captured)'}`);
      process.exit(2);
    }
    process.exit(0);
  } catch (_) {
    // Hook lookup/parsing remains best-effort. A resolved failed check above
    // never passes through this path because it exits explicitly.
    process.exit(0);
  }
});
