#!/usr/bin/env node
/**
 * Subagent Scope Guard (PreToolUse + PostToolUse: Task/Agent and
 * SubagentStart/SubagentStop)
 *
 * Phase 3 snapshots both `git status --porcelain` and any active Fable stage
 * write sets at the beginning of a subagent burst. At the end it classifies
 * newly changed paths as declared, ambiguous, or out-of-scope. Machine-
 * readable write sets may therefore clear expected changes without weakening
 * the conservative legacy path: when no stage contract exists, any new
 * change still emits a reminder and requires explicit review.
 *
 * `writeSet: []` means read-only. Worker attribution is used when the host
 * exposes a worker/subagent id and the stage contract records the same id;
 * otherwise the audit remains stage-level. The hook never infers scope from
 * a natural-language task brief.
 */
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const {
  getSessionDir,
  getSessionId,
  getStateRoot,
  getWorkspaceRoot,
} = require('./lib/harness-state');
const {
  atomicWriteJson,
  getActiveRunContracts,
  getWorkerId,
  stagesForChangedPath,
} = require('./lib/fable-contracts');
const { loadWorkflow, recordBudgetEvent } = require('./lib/workflow-runtime');

function accountWorker(payload, event) {
  const context = loadWorkflow(payload);
  const workflow = context.workflow;
  if (!workflow || workflow.state !== 'running' || !String(workflow.strategy || '').startsWith('fable-')) return;
  const workerId = getWorkerId(payload);
  if (!workerId) return;
  const type = event === 'PreToolUse' || event === 'SubagentStart' ? 'worker-acquire' : 'worker-release';
  recordBudgetEvent(context, type, { workerId, evidence: event });
}

function gitStatus(root) {
  try {
    return execSync('git status --porcelain', {
      cwd: root,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
  } catch (_) {
    return null;
  }
}

function snapshotContracts(stateRoot, sessionId) {
  return getActiveRunContracts(stateRoot, sessionId).map(({ contract }) => ({
    planId: contract.planId,
    runId: contract.runId,
    stageId: contract.stageId,
    sessionId: contract.sessionId || null,
    workerId: contract.workerId || null,
    writeSet: Array.isArray(contract.writeSet) ? contract.writeSet : [],
  }));
}

function classifyChanges(newlyChanged, declaredContracts, payload) {
  const workerId = getWorkerId(payload);
  let scopedContracts = declaredContracts;
  if (workerId) {
    const attributable = declaredContracts.filter(contract => contract.workerId === workerId);
    if (attributable.length > 0) scopedContracts = attributable;
  }
  const entries = scopedContracts.map(contract => ({ contract }));
  const expected = [];
  const ambiguous = [];
  const outOfScope = [];

  for (const statusLine of newlyChanged) {
    const matches = stagesForChangedPath(statusLine, entries);
    if (matches.length === 1) {
      const contract = matches[0].contract;
      expected.push({
        statusLine,
        planId: contract.planId,
        runId: contract.runId,
        stageId: contract.stageId,
        workerId: contract.workerId || workerId || null,
      });
    } else if (matches.length > 1) {
      ambiguous.push({
        statusLine,
        stages: matches.map(({ contract }) => ({
          planId: contract.planId,
          runId: contract.runId,
          stageId: contract.stageId,
          workerId: contract.workerId || null,
        })),
      });
    } else {
      outOfScope.push({ statusLine, workerId: workerId || null });
    }
  }

  return { workerId: workerId || null, expected, ambiguous, outOfScope };
}

function inspectScope(inputData, { info, warn }) {
  try {
    const payload = JSON.parse(inputData);
    const event = payload.hook_event_name;
    const toolName = payload.tool_name || payload.tool;
    const isSubagentEvent = event === 'SubagentStart' || event === 'SubagentStop';
    if (!isSubagentEvent && toolName !== 'Task' && toolName !== 'Agent') return;

    const root = getWorkspaceRoot(payload);
    const sessionId = getSessionId(payload);
    const sessionDir = getSessionDir(root, sessionId, payload);
    const stateRoot = getStateRoot(root, payload);
    const stateFile = path.join(sessionDir, 'subagent-scope-state.json');

    if (event === 'PreToolUse' || event === 'SubagentStart') {
      accountWorker(payload, event);
      if (!fs.existsSync(stateFile)) {
        const status = gitStatus(root);
        if (status !== null) {
          atomicWriteJson(stateFile, {
            startedAt: new Date().toISOString(),
            baseline: status,
            contracts: snapshotContracts(stateRoot, sessionId),
          });
        }
      }
      return;
    }

    if (event === 'PostToolUse' || event === 'SubagentStop') {
      accountWorker(payload, event);
      if (!fs.existsSync(stateFile)) return;

      let state;
      try { state = JSON.parse(fs.readFileSync(stateFile, 'utf8')); } catch (_) { return; }
      const current = gitStatus(root);
      if (current === null) return;

      const baselineLines = new Set(String(state.baseline || '').split('\n').filter(Boolean));
      const currentLines = current.split('\n').filter(Boolean);
      const newlyChanged = currentLines.filter(line => !baselineLines.has(line));
      const declaredContracts = Array.isArray(state.contracts) ? state.contracts : [];
      const classified = classifyChanges(newlyChanged, declaredContracts, payload);
      const audit = {
        schemaVersion: 1,
        sessionId: sessionId || null,
        observedAt: new Date().toISOString(),
        declaredContractCount: declaredContracts.length,
        ...classified,
      };
      atomicWriteJson(path.join(sessionDir, 'subagent-scope-last.json'), audit);

      if (newlyChanged.length === 0) {
        info('[Subagent Scope Reminder] No new changed files detected during the subagent burst.');
      } else if (declaredContracts.length === 0) {
        warn(`[Subagent Scope Reminder] ${newlyChanged.length} file(s) changed with no machine-readable writeSet contract:`);
        newlyChanged.forEach(line => warn(`  ${line}`));
        warn('Semantic MUST: reconcile every changed path against the declared scope before trusting or committing this output.');
      } else {
        for (const entry of classified.expected) {
          info(`[Subagent Scope Reminder] in-scope ${entry.statusLine} -> ${entry.planId}/${entry.runId}/${entry.stageId}${entry.workerId ? ` worker=${entry.workerId}` : ''}`);
        }
        for (const entry of classified.ambiguous) {
          warn(`[Subagent Scope Reminder] ambiguous scope ${entry.statusLine}; matches ${entry.stages.map(stage => `${stage.runId}/${stage.stageId}`).join(', ')}`);
        }
        for (const entry of classified.outOfScope) {
          warn(`[Subagent Scope Reminder] OUT-OF-SCOPE ${entry.statusLine}${entry.workerId ? ` worker=${entry.workerId}` : ''}; MUST reconcile/revert or explicitly re-authorize scope before accepting the result.`);
        }
      }

      atomicWriteJson(stateFile, {
        startedAt: new Date().toISOString(),
        baseline: current,
        contracts: snapshotContracts(stateRoot, sessionId),
      });

      const violated = declaredContracts.length === 0
        ? newlyChanged.length > 0
        : classified.ambiguous.length > 0 || classified.outOfScope.length > 0;
      if (violated) {
        warn('Do not "git add -A"; stage files explicitly so unexpected paths stay visible.');
      }
    }
  } catch (error) {
    if (error && error.code === 'HARNESS_WORKFLOW_BUDGET') {
      warn(`[Subagent Scope Reminder] ${error.message}`);
      return;
    }
    // This is otherwise a post-execution visibility gate. Runtime errors fail open;
    // actionGate has a stricter fail-ask policy for side effects.
    return;
  }
}

function run({ info = console.log, warn = console.error, complete = () => {} } = {}) {
  let inputData = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', chunk => { inputData += chunk; });
  process.stdin.on('end', () => {
    inspectScope(inputData, { info, warn });
    complete();
  });
}

if (require.main === module) run();

module.exports = {
  classifyChanges,
  run,
};
