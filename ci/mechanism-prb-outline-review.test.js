'use strict';

const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { spawnSync } = require('child_process');
const { canonical } = require(path.resolve(__dirname, '../hooks/scripts/lib/workflow-isolation.js'));
const { stage: stageQualificationTree } = require('./lib/doc-reconciliation-staged-tree.js');

const ROOT = path.resolve(__dirname, '..');
const provider = require(path.join(ROOT, 'hooks/scripts/lib/doc-reconciliation-provider.js'));
const pilot = require(path.join(ROOT, 'hooks/scripts/lib/doc-reconciliation-pilot.js'));
const { checkDocObligations } = require(path.join(ROOT, 'harness-everything/scripts/doc-evidence.js'));
const internals = provider._internals || {};
const failures = [];

function test(name, run) {
  try {
    run();
    console.log(`PASS ${name}`);
  } catch (error) {
    failures.push(name);
    console.error(`FAIL ${name}: ${error.message}`);
  }
}

function sha(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(value, null, 2) + '\n');
}

const dispatchLine = 'HARNESS_OUTLINE_DISPATCH_V1 taskId=task-prb attemptId=attempt-1 token=token-1 workerRoot=/tmp/prb-worker';

const syntheticInventory = [
  '# Synthetic inventory',
  'run id `synthetic-run` · input SHA `abcdef012345`',
  '',
  '## Mechanism inventory',
  '| # | Mechanism | Evidence |',
  '|---|---|---|',
  '| 20 | ADR identity | mechanism evidence |',
  '',
  '## Area grouping + candidate domain prefixes',
  '| Area | Rows | Candidate prefix | Why |',
  '|---|---|---|---|',
  '| Documents | 20–22 | `DOCS` | Synthetic fixture |',
].join('\n') + '\n';

function fixtureGit(root, args) {
  const env = { ...process.env, GIT_AUTHOR_NAME: 'outline-fixture', GIT_AUTHOR_EMAIL: 'outline-fixture@invalid',
    GIT_COMMITTER_NAME: 'outline-fixture', GIT_COMMITTER_EMAIL: 'outline-fixture@invalid' };
  for (const key of Object.keys(env)) if (key.startsWith('GIT_') && !/^GIT_(AUTHOR|COMMITTER)_/.test(key)) delete env[key];
  try {
    return execFileSync('git', ['-C', root, ...args], { encoding: 'utf8', env, stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  } catch (error) {
    throw new Error(`${error.message}: ${String(error.stderr || '').trim()}`);
  }
}

function outlineText({ complete = false, decisionPlaceholder = false, duplicateDecision = false, titledDecision = false,
  indentedDecision = false,
  rowId = '20', target = 'docs/adr/DOCS-001.md', domain = 'DOCS' } = {}) {
  const decision = complete ? '\n## Decision\nThis is already a complete drafted decision.\n'
    : duplicateDecision ? '\n## Decision\n- TBD\n\n## Decision\nThis second Decision section contains substantive text.\n'
      : titledDecision ? '\n## Decision — Final choice\nThis titled section contains a complete decision.\n'
        : indentedDecision ? '\n   ## Decision — Indented final choice\nThis indented section contains substantive text.\n'
      : decisionPlaceholder ? '\n## Decision\n- TBD\n' : '';
  return `---\nid: ${domain}-001\nstatus: proposed\n---\n\nInventory row: ${rowId}\nTarget: ${target}\nDomain: ${domain}\n\n## Outline\n- Context: TBD\n- Decision: TBD\n${decision}`;
}

function createOutlineFixture(options = {}) {
  const root = canonical(fs.mkdtempSync(path.join(os.tmpdir(), 'prb-outline-fixture-')));
  const retainedInventory = options.retainedInventory === true;
  const target = options.target || (retainedInventory ? 'docs/adr/EVID-001.md' : 'docs/adr/DOCS-001.md');
  const rowId = options.rowId || (retainedInventory ? '17' : '20');
  const domain = options.domain || (retainedInventory ? 'EVID' : 'DOCS');
  const taskId = options.taskId || 'task-prb';
  const attemptId = options.attemptId || 'attempt-1';
  const sessionId = options.sessionId || 'author-session';
  const stateHome = fs.mkdtempSync(path.join(os.tmpdir(), 'prb-outline-state-'));
  const workerRoot = options.workerRootAlias
    ? `${root}${path.sep}..${path.sep}${path.basename(root)}` : root;
  const workflowId = 'workflow-prb';
  const workflowRevision = 2;
  const config = JSON.stringify({ governed: [{ path: 'docs/adr/*.md', role: 'adr' }], domains: [domain], derived: [] }, null, 2) + '\n';
  const configDigest = sha(config);
  fs.mkdirSync(path.join(root, '.agents/harness-everything'), { recursive: true });
  fs.mkdirSync(path.dirname(path.join(root, target)), { recursive: true });
  fs.writeFileSync(path.join(root, '.agents/harness-everything/project-docs.json'), config);
  if (options.targetExistsAtB) fs.writeFileSync(path.join(root, target),
    `---\nid: DOCS-001\nstatus: proposed\n---\n\n## Decision\nAn existing B document.\n`);
  fixtureGit(root, ['init', '-q']);
  fixtureGit(root, ['add', '-A']);
  fixtureGit(root, ['commit', '-q', '-m', 'B baseline']);
  const baselineCommit = fixtureGit(root, ['rev-parse', 'HEAD']);
  const baselineTree = fixtureGit(root, ['rev-parse', 'HEAD^{tree}']);
  let sessionDir = path.join(stateHome, 'session');
  if (options.realHook) {
    const priorStateHome = process.env.HARNESS_STATE_HOME;
    process.env.HARNESS_STATE_HOME = stateHome;
    try { sessionDir = require(path.join(ROOT, 'hooks/scripts/lib/harness-state.js')).getSessionDir(root, sessionId); }
    finally { if (priorStateHome === undefined) delete process.env.HARNESS_STATE_HOME; else process.env.HARNESS_STATE_HOME = priorStateHome; }
  }

  fs.writeFileSync(path.join(root, target), outlineText({
    complete: options.completeOutline === true,
    decisionPlaceholder: options.decisionPlaceholder === true,
    duplicateDecision: options.duplicateDecision === true,
    indentedDecision: options.indentedDecision === true,
    rowId, target, domain,
  }));
  fixtureGit(root, ['add', '-A']);
  fixtureGit(root, ['commit', '-q', '-m', 'O outline']);
  const outlineCommit = fixtureGit(root, ['rev-parse', 'HEAD']);
  const outlineTree = fixtureGit(root, ['rev-parse', 'HEAD^{tree}']);
  const outlineBytes = fs.readFileSync(path.join(root, target));
  const outlineBlob = fixtureGit(root, ['rev-parse', `HEAD:${target}`]);

  const inventoryBytes = retainedInventory
    ? fs.readFileSync(path.join(ROOT, 'benchmarks/results/live-host/claude-341-outline-dispatch-2026-10-28/inventory/2741bd4514d2cd68f57d93a2b3ce94cbe597ca62d30e26f0ca58e882df5b03c6.md'))
    : Buffer.from(syntheticInventory);
  const pinDigest = sha(inventoryBytes);
  const expectedPin = retainedInventory ? internals.OUTLINE_INVENTORY_PIN : {
    source: 'synthetic://approved-inventory', sha256: pinDigest, runId: 'synthetic-run', inputSha: 'abcdef012345',
    approvalRef: { issue: 325, commentId: 'synthetic-comment', decision: 1 },
    retainedArtifactPath: `inventory/${pinDigest}.md`,
  };
  if (retainedInventory) assert.strictEqual(pinDigest, expectedPin.sha256, 'retained inventory bytes must match the pinned digest');
  const outlineRoot = path.join(sessionDir, 'doc-reconciliation/outline-confirmation');
  const inventoryDir = path.join(outlineRoot, 'inventory');
  fs.mkdirSync(inventoryDir, { recursive: true });
  fs.writeFileSync(path.join(inventoryDir, `${pinDigest}.md`), inventoryBytes);
  writeJson(path.join(inventoryDir, 'inventory-pin.json'), expectedPin);
  const requirementIds = ['prb'];
  const workspaceId = 'ws-' + internals.digestText(internals.captureJson({ workspaceRoot: root }));
  const taskBinding = { schema: 'harness.doc-reconciliation-task-pin.v1', taskId, requirementIds,
    requirementDigest: sha(JSON.stringify(requirementIds)), baselineCommit, baselineRoot: root,
    configDigest, sessionId, workflowId, workspaceId };
  writeJson(path.join(sessionDir, 'workflow-run.json'), {
    workflowId, revision: workflowRevision, docReconciliationBaseline: { root, commit: baselineCommit, tree: baselineTree },
    docReconciliationTask: taskBinding,
  });

  let hookPreloader = null;
  function runHook(payload, pilotEnabled = true) {
    if (!options.realHook) throw new Error('real state-persist capture was not enabled for this fixture');
    if (!hookPreloader) {
      hookPreloader = path.join(stateHome, 'outline-test-preload.js');
      const providerPath = path.join(ROOT, 'hooks/scripts/lib/doc-reconciliation-provider.js');
      fs.writeFileSync(hookPreloader, [
        ...(options.failPartialDispatchStorage ? [
          "const fs=require('fs');",
          "const path=require('path');",
          "const marker=path.join(process.env.HARNESS_STATE_HOME,'prb-partial-dispatch-faults-used');",
          'const write=fs.writeFileSync;',
          'let tokenFailure=false;',
          'fs.writeFileSync=function(file,data){',
          "const target=String(file).replace(/\\\\/g,'/');",
          "if(!fs.existsSync(marker)&&/\\/tokens\\/[^/]+\\.json$/.test(target)){tokenFailure=true;const error=new Error('injected token write failure');error.code='EIO';throw error;}",
          "if(tokenFailure&&!fs.existsSync(marker)&&/\\/doc-reconciliation-capture\\/\\d{8}\\.json$/.test(target)&&String(data).includes('\\\"state\\\": \\\"unresolved\\\"')){write(marker,'injected');const error=new Error('injected unresolved capture write failure');error.code='EIO';throw error;}",
          'return write.apply(this,arguments);',
          '};',
        ] : []),
        `const p=require(${JSON.stringify(providerPath)});`,
        "if(typeof p.captureOutlineDispatch==='function'){",
        'const original=p.captureOutlineDispatch;',
        `const pin=${JSON.stringify(expectedPin)};`,
        'p.captureOutlineDispatch=(input)=>original({...input,fixtureExpectedPin:pin});',
        '}',
      ].join('\n'));
    }
    const child = spawnSync(process.execPath, ['--require', hookPreloader, path.join(ROOT, 'hooks/scripts/state-persist.js')], {
      cwd: root, encoding: 'utf8', input: JSON.stringify(payload),
      env: { ...process.env, HARNESS_STATE_HOME: stateHome, HARNESS_WORKSPACE_ROOT: root,
        HARNESS_DOC_RECONCILIATION_PILOT: pilotEnabled ? '1' : '0' },
    });
    if (child.status !== 0) throw new Error(`state-persist failed open contract: ${child.stderr || child.stdout || child.status}`);
    return provider.readCaptureView(sessionDir).records;
  }

  const inventoryPath = `doc-reconciliation/outline-confirmation/inventory/${pinDigest}.md`;
  const reviewerPrincipal = options.reviewerPrincipal || 'outline-reviewer';
  const reviewMessage = [
    'Review verdict: approve',
    `Reviewed artifact: ${target} sha256:${sha(outlineBytes)}`,
    `Reviewed artifact: ${inventoryPath} sha256:${pinDigest}`,
    `Summary: Approved inventory row ${rowId} for ${target} in domain ${domain}.`,
  ].join('\n');
  const reviewResultPayload = {
    session_id: sessionId, cwd: root, hook_event_name: 'PostToolUse', tool_name: 'Task',
    tool_use_id: 'review-dispatch', tool_input: { command: 'Task' },
    tool_response: { agentId: reviewerPrincipal, interrupted: false, status: 'completed' },
  };
  const reviewStopPayload = {
    session_id: sessionId, cwd: root, hook_event_name: 'SubagentStop', agent_id: reviewerPrincipal,
    agent_type: 'reviewer', last_assistant_message: reviewMessage,
  };
  let reviewResult;
  let reviewStop;
  if (options.realHook) {
    runHook(reviewResultPayload);
    runHook(reviewStopPayload);
    const retained = provider.readCaptureView(sessionDir).records;
    reviewResult = retained.find(item => item.event === 'PostToolUse' && item.tool_use_id === 'review-dispatch');
    reviewStop = retained.find(item => item.event === 'SubagentStop' && item.agent_id === reviewerPrincipal);
  } else {
    reviewResult = provider.buildCaptureRecord(reviewResultPayload, 'PostToolUse', root);
    reviewStop = provider.buildCaptureRecord(reviewStopPayload, 'SubagentStop', root);
    reviewResult.observedIdentity = { workflowId, workflowRevision, baselinePin: { root, commit: baselineCommit }, taskPin: taskBinding };
    reviewStop.observedIdentity = { workflowId, workflowRevision, baselinePin: { root, commit: baselineCommit }, taskPin: taskBinding };
  }
  if (!reviewResult || !reviewStop) throw new Error('review hook captures were not retained');
  const reviewRecordDigest = provider._internals?.captureDigest
    ? provider._internals.captureDigest(reviewStop)
    : sha(JSON.stringify(reviewStop));

  const attemptDir = path.join(outlineRoot, taskId, 'attempts', attemptId);
  fs.mkdirSync(attemptDir, { recursive: true });
  const lease = { schema: 'harness.outline-writer-lease.v1', id: 'lease-1', taskId, attemptId,
    principalId: sessionId, root: workerRoot, exclusive: true, active: true,
    ...(options.competingWriters ? { competingWriters: ['unknown-writer'] } : {}) };
  writeJson(path.join(attemptDir, 'writer-lease.json'), lease);
  const leaseDigest = sha(fs.readFileSync(path.join(attemptDir, 'writer-lease.json')));
  const marker = `HARNESS_OUTLINE_DISPATCH_V1 taskId=${taskId} attemptId=${attemptId} token=${options.token || 'token-1'} workerRoot=${options.markerRoot || workerRoot}`;
  const handoff = {
    schema: 'harness.outline-handoff.v1', handoffId: 'handoff-1', taskId, attemptId,
    supersedesAttemptId: options.supersedesAttemptId || null,
    workspaceId,
    workflowId, workflowRevision, sessionId, hostId: 'claude-code',
    baseline: { root, commit: baselineCommit, tree: baselineTree, configDigest },
    configDigest, targetPaths: [target], draftWorktreeRoot: workerRoot,
    outline: { commit: outlineCommit, tree: outlineTree, targetBlobs: { [target]: { blobOid: outlineBlob, storedBytesSha256: sha(outlineBytes) } } },
    inventory: { ...expectedPin, rowId, domain, targetPaths: [target] },
    reviewCaptureRef: reviewStop.ref, reviewCaptureDigest: reviewRecordDigest, reviewDigest: reviewStop.reviewDigest,
    coordinatorPrincipal: sessionId, writerLeaseId: lease.id, writerLeaseDigest: leaseDigest,
    draftDispatchToken: options.token || 'token-1',
    ...(options.handoffOverrides || {}),
  };
  if (!options.omitHandoff) writeJson(path.join(attemptDir, 'handoff.json'), handoff);

  const payload = {
    session_id: sessionId, cwd: root, hook_event_name: 'PreToolUse', tool_name: 'Task',
    tool_use_id: options.toolUseId || 'dispatch-1', tool_input: { prompt: marker, run_in_background: false },
  };
  if (options.blockSeamStorage) {
    fs.mkdirSync(path.join(attemptDir, 'seams', `${sha(String(payload.tool_use_id))}.json`), { recursive: true });
  }
  if (options.blockTokenStorage) fs.writeFileSync(path.join(attemptDir, 'tokens'), 'blocked token directory');
  if (options.dirtyBeforeDispatch) fs.writeFileSync(path.join(root, 'untracked-before-dispatch.txt'), 'dirty');
  let capture;
  let reviewCaptures;
  if (options.realHook) {
    if (options.omitReview) {
      fs.rmSync(path.join(sessionDir, 'doc-reconciliation-capture'), { recursive: true, force: true });
      fs.rmSync(path.join(sessionDir, 'doc-reconciliation-capture.json'), { force: true });
    }
    runHook(payload);
    const retained = provider.readCaptureView(sessionDir).records;
    capture = retained.find(item => item.event === 'PreToolUse' && item.tool_use_id === payload.tool_use_id);
    reviewCaptures = retained.filter(item => item !== capture);
  } else {
    capture = provider.buildCaptureRecord(payload, 'PreToolUse', root);
    capture.observedIdentity = { workflowId, workflowRevision, baselinePin: { root, commit: baselineCommit }, taskPin: taskBinding };
    reviewCaptures = options.omitReview ? [] : [reviewResult, reviewStop];
  }
  if (!capture && !options.allowMissingDispatchCapture) throw new Error('PreToolUse dispatch capture was not retained');
  let seam = null;
  if (options.realHook) {
    seam = capture?.outlineDispatch || null;
  } else if (options.captureBeforeReview) {
    const noReview = internals.captureOutlineDispatch && internals.captureOutlineDispatch({
      payload, capture, sessionDir, workspaceRoot: root, captures: [], fixtureExpectedPin: expectedPin,
    });
    seam = noReview;
    // A later handoff/review cannot repair a dispatch-time miss.
    writeJson(path.join(attemptDir, 'handoff.json'), handoff);
  } else if (internals.captureOutlineDispatch) {
    seam = internals.captureOutlineDispatch({
      payload, capture, sessionDir, workspaceRoot: root, captures: reviewCaptures, fixtureExpectedPin: expectedPin,
    });
  }
  if (seam) capture.outlineDispatch = seam;
  const workerStartPayload = {
    session_id: sessionId, cwd: options.workerStartRoot || root, hook_event_name: 'SubagentStart',
    agent_id: options.workerPrincipal || 'draft-worker', agent_type: 'worker',
  };
  let workerStart;
  if (options.realHook) {
    runHook(workerStartPayload);
    workerStart = provider.readCaptureView(sessionDir).records.find(item => item.event === 'SubagentStart'
      && item.agent_id === workerStartPayload.agent_id);
  } else {
    workerStart = provider.buildCaptureRecord(workerStartPayload, 'SubagentStart', root);
    workerStart.observedIdentity = capture.observedIdentity;
  }
  const extraCaptures = [];

  function dispatchAgain({ toolUseId = capture.tool_use_id, prompt = payload.tool_input.prompt } = {}) {
    const extraPayload = { ...payload, tool_use_id: toolUseId, tool_input: { prompt, run_in_background: false } };
    const extra = provider.buildCaptureRecord(extraPayload, 'PreToolUse', root);
    extra.observedIdentity = capture.observedIdentity;
    if (internals.captureOutlineDispatch) {
      extra.outlineDispatch = internals.captureOutlineDispatch({
        payload: extraPayload, capture: extra, sessionDir, workspaceRoot: root,
        captures: reviewCaptures, fixtureExpectedPin: expectedPin,
      });
    }
    extraCaptures.push(extra);
    return extra;
  }

  function finishDraft({ draft = true, nonDescendant = false, finalReview = false, baselineRoot = root,
    omitWorkerStart = false, omitWorkerResult = false, omitWorkerStop = false, tamperHandoff = false,
    providerSessionId = sessionId, providerTaskId = taskId, providerBaseline = { root, commit: baselineCommit },
    runPilot = false, handAuthoredCapture = false, removeSeam = false, mutateAfterFinalReview = false } = {}) {
    if (draft) {
      fs.writeFileSync(path.join(root, target), `---\nid: ${domain}-001\nstatus: proposed\n---\n\n## Decision\nFinal D for row ${rowId}.\n`);
      fixtureGit(root, ['add', '-A']);
      fixtureGit(root, ['commit', '-q', '-m', 'D final draft']);
    }
    if (nonDescendant) {
      fixtureGit(root, ['checkout', '--orphan', 'unrelated']);
      fixtureGit(root, ['rm', '-rf', '.']);
      fs.mkdirSync(path.dirname(path.join(root, target)), { recursive: true });
      fs.writeFileSync(path.join(root, target), `---\nid: ${domain}-001\nstatus: proposed\n---\n\n## Decision\nUnrelated D for row ${rowId}.\n`);
      fixtureGit(root, ['add', '-A']);
      fixtureGit(root, ['-c', 'user.name=outline-fixture', '-c', 'user.email=outline-fixture@invalid', 'commit', '-q', '-m', 'unrelated D']);
    }
    let draftCommit = fixtureGit(root, ['rev-parse', 'HEAD']);
    let draftBytes = fs.readFileSync(path.join(root, target));
    if (tamperHandoff) {
      const handoffFile = path.join(attemptDir, 'handoff.json');
      const changed = JSON.parse(fs.readFileSync(handoffFile, 'utf8'));
      changed.outline.tree = 'f'.repeat(40);
      writeJson(handoffFile, changed);
    }
    if (options.realHook) {
      if (!omitWorkerResult) runHook({
        session_id: sessionId, cwd: root, hook_event_name: 'PostToolUse', tool_name: 'Task',
        tool_use_id: capture.tool_use_id, tool_input: { command: 'Task' },
        tool_response: { agentId: options.workerPrincipal || 'draft-worker', interrupted: false, status: 'completed' },
      });
      if (!omitWorkerStop) runHook({
        session_id: sessionId, cwd: root, hook_event_name: 'SubagentStop',
        agent_id: options.workerPrincipal || 'draft-worker', agent_type: 'worker',
      });
    }
    if (finalReview) {
      const finalReviewer = 'final-reviewer';
      const finalResultPayload = {
        session_id: sessionId, cwd: root, hook_event_name: 'PostToolUse', tool_name: 'Task',
        tool_use_id: 'final-review-dispatch', tool_input: { command: 'Task' },
        tool_response: { agentId: finalReviewer, interrupted: false, status: 'completed' },
      };
      const finalStopPayload = {
        session_id: sessionId, cwd: root, hook_event_name: 'SubagentStop', agent_id: finalReviewer,
        last_assistant_message: `Review verdict: approve\nReviewed artifact: ${target} sha256:${sha(draftBytes)}\nSummary: Final candidate reviewed.`,
      };
      if (options.realHook) {
        runHook(finalResultPayload);
        runHook(finalStopPayload);
      } else {
        const finalResult = provider.buildCaptureRecord(finalResultPayload, 'PostToolUse', root);
        const finalStop = provider.buildCaptureRecord(finalStopPayload, 'SubagentStop', root);
        finalResult.observedIdentity = capture.observedIdentity;
        finalStop.observedIdentity = capture.observedIdentity;
        extraCaptures.push(finalResult, finalStop);
      }
    }
    if (mutateAfterFinalReview) {
      fs.writeFileSync(path.join(root, target), `---\nid: DOCS-001\nstatus: proposed\n---\n\n## Decision\nChanged after final review.\n`);
      fixtureGit(root, ['add', '-A']);
      fixtureGit(root, ['commit', '-q', '-m', 'D changed after review']);
      draftCommit = fixtureGit(root, ['rev-parse', 'HEAD']);
      draftBytes = fs.readFileSync(path.join(root, target));
    }
    const captures = options.realHook
      ? provider.readCaptureView(sessionDir).records
      : [...reviewCaptures, capture, ...extraCaptures, ...(!omitWorkerStart ? [workerStart] : []), ...(!omitWorkerResult ? [provider.buildCaptureRecord({
        session_id: sessionId, cwd: root, hook_event_name: 'PostToolUse', tool_name: 'Task',
        tool_use_id: capture.tool_use_id, tool_input: { command: 'Task' },
        tool_response: { agentId: options.workerPrincipal || 'draft-worker', interrupted: false, status: 'completed' },
      }, 'PostToolUse', root)] : []), ...(!omitWorkerStop ? [provider.buildCaptureRecord({
        session_id: sessionId, cwd: root, hook_event_name: 'SubagentStop', agent_id: options.workerPrincipal || 'draft-worker', agent_type: 'worker',
      }, 'SubagentStop', root)] : [])];
    const qualification = options.noFakeQualification ? undefined : { source: 'fake-test-fixture', faked: true, toolUseIdPopulated: true,
      agentIdPopulated: true, outlineDispatchCaptureVerified: true };
    if (removeSeam && capture.outlineDispatch?.seamRef) {
      fs.rmSync(path.join(sessionDir, capture.outlineDispatch.seamRef), { force: true });
    }
    if (handAuthoredCapture) {
      const forged = { ...capture, outlineDispatch: { schema: 'harness.outline-dispatch.v1', state: 'accepted',
        taskId, attemptId, seamRef: 'doc-reconciliation/outline-confirmation/fake-seam.json',
        dispatchInputDigest: sha('candidate-authored') } };
      writeJson(path.join(sessionDir, 'doc-reconciliation-capture.json'), { version: 1, records: [forged] });
    }
    const origin = provider.createClaudeOriginProvider({
      hostId: 'claude-code', sessionId: providerSessionId, workspaceRoot: root, workflowId, workflowRevision, taskId: providerTaskId,
      principals: { author: providerSessionId, executors: [] }, baseline: providerBaseline,
      captures, sessionDir, taskBinding,
      ...(qualification ? { qualification, outlineFixture: { expectedPin } } : {}),
    });
    const identity = {
      workspaceId: origin.resolveContext({}).context.workspaceId, sessionId: providerSessionId, workflowId, workflowRevision, taskId: providerTaskId,
      taskScopeDigest: sha('task-scope'), baselineDigest: sha('baseline-snapshot'),
      candidateDigest: sha('candidate-snapshot'), configDigest, prdRoot: 'docs/prd/',
    };
    const result = origin.resolveEvent({ reference: `${capture.ref}#outline-confirmation`, identity });
    let pilotResult = null;
    if (runPilot) {
      const previousSwitch = process.env.HARNESS_DOC_RECONCILIATION_PILOT;
      const previousFactory = provider.createClaudeOriginProvider;
      provider.createClaudeOriginProvider = input => previousFactory({ ...input,
        ...(qualification ? { qualification, outlineFixture: { expectedPin } } : {}), taskBinding });
      process.env.HARNESS_DOC_RECONCILIATION_PILOT = '1';
      const context = { root, sessionId, sessionDir, activeHost: 'claude-code', workflow: {
        workflowId, revision: workflowRevision, strategy: 'iterative-single', state: 'running',
        docReconciliationBaseline: { root: baselineRoot, commit: baselineCommit, tree: baselineTree }, docReconciliationTask: taskBinding,
      } };
      try {
        pilotResult = pilot.assess(context, { strategy: 'iterative-single', stepBindingsEnabled: true,
          requirements: [{ id: 'prb', summary: 'produce an ADR', acceptance: 'outline review precedes drafting' }] });
      } finally {
        provider.createClaudeOriginProvider = previousFactory;
        if (previousSwitch === undefined) delete process.env.HARNESS_DOC_RECONCILIATION_PILOT;
        else process.env.HARNESS_DOC_RECONCILIATION_PILOT = previousSwitch;
      }
    }
    return { captures, origin, identity, draftCommit, draftBytes, result, pilot: pilotResult };
  }

  return { root, sessionDir, target, taskId, attemptId, sessionId, workflowId, workflowRevision,
    baselineCommit, baselineTree, outlineCommit, outlineTree, outlineBlob, outlineBytes, configDigest,
    expectedPin, taskBinding, attemptDir, handoff, payload, capture, reviewCaptures, workerStart,
    extraCaptures, dispatchAgain, finishDraft, runHook, stateHome,
    faultMarker: path.join(stateHome, 'prb-partial-dispatch-faults-used'),
    cleanup: () => {
      fs.rmSync(root, { recursive: true, force: true });
      fs.rmSync(stateHome, { recursive: true, force: true });
    } };
}

test('strict dispatch parser accepts one exact block and rejects duplicate/free-form/alternate-field tokens', () => {
  assert.strictEqual(typeof internals.parseOutlineDispatchPrompt, 'function', 'missing strict tool_input.prompt parser');
  const parse = internals.parseOutlineDispatchPrompt;
  const valid = parse(`Review complete.\n${dispatchLine}\nStart drafting after the outline review.`);
  assert.strictEqual(valid.taskId, 'task-prb');
  assert.strictEqual(valid.attemptId, 'attempt-1');
  assert.strictEqual(valid.token, 'token-1');
  assert.strictEqual(valid.workerRoot, '/tmp/prb-worker');
  assert.strictEqual(parse(`${dispatchLine}\n${dispatchLine}`), null, 'two marker blocks are ambiguous');
  assert.strictEqual(parse(`token-1\n${dispatchLine.replace('HARNESS_OUTLINE_DISPATCH_V1 ', '')}`), null,
    'a free-form token or alternate-field marker cannot dispatch');
  assert.strictEqual(parse({ prompt: dispatchLine }), null, 'only tool_input.prompt text is parsed');
});

test('outline classifier checks every Decision section before awarding pre-draft status', () => {
  assert.strictEqual(typeof internals.parseOutlineCitation, 'function', 'missing all-section outline completeness check');
  const target = 'docs/adr/DOCS-001.md';
  const placeholder = internals.parseOutlineCitation(Buffer.from(outlineText({ decisionPlaceholder: true })), target);
  assert.strictEqual(placeholder.state, 'accepted', 'one placeholder Decision section is an outline');
  const duplicate = internals.parseOutlineCitation(Buffer.from(outlineText({ duplicateDecision: true })), target);
  assert.strictEqual(duplicate.state, 'unresolved');
  assert.strictEqual(duplicate.reason, 'outline-already-draft', 'later substantive Decision text cannot hide behind a placeholder');
  const titled = internals.parseOutlineCitation(Buffer.from(outlineText({ titledDecision: true })), target);
  assert.strictEqual(titled.state, 'unresolved');
  assert.strictEqual(titled.reason, 'outline-already-draft', 'a titled Decision heading cannot evade draft detection');
  const indented = internals.parseOutlineCitation(Buffer.from(outlineText({ indentedDecision: true })), target);
  assert.strictEqual(indented.state, 'unresolved');
  assert.strictEqual(indented.reason, 'outline-already-draft', 'a valid indented Markdown Decision heading cannot evade draft detection');
});

test('coordinator-seeded inventory pin requires exact bytes, all fixed fields, and one row/domain match', () => {
  assert.strictEqual(typeof internals.validateOutlineInventoryPin, 'function', 'missing pinned-inventory validator');
  const content = [
    '# Synthetic inventory',
    'run id `synthetic-run` · input SHA `abcdef012345`',
    '',
    '## Mechanism inventory',
    '| # | Mechanism | Evidence |',
    '|---|---|---|',
    '| 20 | ADR identity | mechanism evidence |',
    '',
    '## Area grouping + candidate domain prefixes',
    '| Area | Rows | Candidate prefix | Why |',
    '|---|---|---|---|',
    '| Documents | 20–22 | `DOCS` | Synthetic fixture |',
  ].join('\n') + '\n';
  const pin = {
    source: 'synthetic://approved-inventory',
    sha256: sha(content),
    runId: 'synthetic-run',
    inputSha: 'abcdef012345',
    approvalRef: { issue: 325, commentId: 'synthetic-comment', decision: 1 },
    retainedArtifactPath: 'inventory/' + sha(content) + '.md',
  };
  const valid = internals.validateOutlineInventoryPin({ bytes: Buffer.from(content), pin, expectedPin: pin });
  assert.strictEqual(valid.state, 'accepted');
  assert.deepStrictEqual(internals.resolveInventoryRow(valid, '20').row, { rowId: '20', domain: 'DOCS' });
  const changed = internals.validateOutlineInventoryPin({ bytes: Buffer.from(content + '\nchanged\n'), pin, expectedPin: pin });
  assert.strictEqual(changed.state, 'unresolved', 'a self-consistent-looking replacement cannot match the pinned bytes');
  const stale = internals.validateOutlineInventoryPin({ bytes: Buffer.from(content), pin: { ...pin, runId: 'stale-run' }, expectedPin: pin });
  assert.strictEqual(stale.state, 'unresolved', 'stale metadata cannot be repaired by matching rows');
  const staleInput = internals.validateOutlineInventoryPin({ bytes: Buffer.from(content), pin: { ...pin, inputSha: 'feedface' }, expectedPin: pin });
  assert.strictEqual(staleInput.state, 'unresolved', 'stale input revision is not a fallback candidate');
  const unavailableLocator = internals.validateOutlineInventoryPin({ bytes: Buffer.from(content),
    pin: { ...pin, retainedArtifactPath: 'repo-local-copy.md' }, expectedPin: pin });
  assert.strictEqual(unavailableLocator.state, 'unresolved', 'an unavailable locator has no candidate-selected fallback');
  const missing = internals.validateOutlineInventoryPin({ bytes: null, pin, expectedPin: pin });
  assert.strictEqual(missing.state, 'unresolved', 'unavailable source has no fallback');
  const duplicate = content.replace('| 20 | ADR identity', '| 20 | duplicate\n| 20 | ADR identity');
  const duplicatePin = { ...pin, sha256: sha(duplicate), retainedArtifactPath: 'inventory/' + sha(duplicate) + '.md' };
  const duplicateResult = internals.validateOutlineInventoryPin({ bytes: Buffer.from(duplicate), pin: duplicatePin, expectedPin: duplicatePin });
  assert.strictEqual(internals.resolveInventoryRow(duplicateResult, '20').state, 'unresolved', 'duplicate row ids are ambiguous');
  const multiDomain = content.replace('| Documents | 20–22 | `DOCS` | Synthetic fixture |',
    '| Documents | 20–22 | `DOCS` | Synthetic fixture |\n| Other documents | 20 | `ENFC` | Ambiguous mapping |');
  const multiDomainPin = { ...pin, sha256: sha(multiDomain), retainedArtifactPath: 'inventory/' + sha(multiDomain) + '.md' };
  const multiDomainResult = internals.validateOutlineInventoryPin({ bytes: Buffer.from(multiDomain),
    pin: multiDomainPin, expectedPin: multiDomainPin });
  assert.strictEqual(internals.resolveInventoryRow(multiDomainResult, '20').state, 'unresolved', 'ambiguous domain mapping is unresolved');
});

test('the trusted inventory pin maps only owner-approved VERI rows 15–18 to EVID', () => {
  const pin = internals.OUTLINE_INVENTORY_PIN;
  const bytes = fs.readFileSync(path.join(ROOT,
    'benchmarks/results/live-host/claude-341-outline-dispatch-2026-10-28/inventory/2741bd4514d2cd68f57d93a2b3ce94cbe597ca62d30e26f0ca58e882df5b03c6.md'));
  const mapping = [{ rowIds: ['15', '16', '17', '18'], sourceDomain: 'VERI', domain: 'EVID',
    approvalRef: '../e1-feasibility-2026-10-28/owner-decision-veri-evid.md' }];
  assert.deepStrictEqual(pin.rowDomainMappings, mapping, 'the owner approval is part of the trusted pin');
  const valid = internals.validateOutlineInventoryPin({ bytes, pin, expectedPin: pin });
  assert.strictEqual(valid.state, 'accepted');
  for (const rowId of ['15', '16', '17', '18']) {
    assert.deepStrictEqual(internals.resolveInventoryRow(valid, rowId).row, { rowId, domain: 'EVID' });
  }
  const substituted = { ...pin, rowDomainMappings: [{ ...mapping[0], domain: 'VERI' }] };
  const stale = internals.validateOutlineInventoryPin({ bytes, pin: substituted, expectedPin: pin });
  assert.strictEqual(stale.state, 'unresolved', 'a substituted domain cannot change the trusted mapping');
  assert.strictEqual(stale.reason, 'inventory-pin-mismatch');
});

test('pilot offers structured SubagentStop reviews only and preserves drafter independence rejection', () => {
  const sessionDir = fs.mkdtempSync(path.join(os.tmpdir(), 'prb-review-candidates-'));
  const author = 'author-session';
  const draft = provider.buildCaptureRecord({ session_id: author, hook_event_name: 'PostToolUse', tool_name: 'Task',
    tool_use_id: 'draft-dispatch', tool_response: { agentId: 'draft-worker', status: 'completed' } }, 'PostToolUse', '/tmp');
  const ordinary = provider.buildCaptureRecord({ session_id: author, hook_event_name: 'SubagentStop', agent_id: 'draft-worker',
    last_assistant_message: 'Draft complete. The document is ready.' }, 'SubagentStop', '/tmp');
  const reviewResult = provider.buildCaptureRecord({ session_id: author, hook_event_name: 'PostToolUse', tool_name: 'Task',
    tool_use_id: 'review-dispatch', tool_response: { agentId: 'independent-reviewer', status: 'completed' } }, 'PostToolUse', '/tmp');
  const approval = provider.buildCaptureRecord({ session_id: author, hook_event_name: 'SubagentStop', agent_id: 'independent-reviewer',
    last_assistant_message: `Review verdict: approve\nReviewed artifact: docs/adr/EVID-001.md sha256:${'a'.repeat(64)}\nSummary: exact ADR reviewed.` }, 'SubagentStop', '/tmp');
  for (const record of [draft, ordinary, reviewResult, approval]) provider.writeImmutableEvent(sessionDir, record);
  provider.rebuildJournalView(sessionDir);
  const context = { sessionDir, activeHost: 'claude-code', workflow: { docReconciliationTask: { taskId: 'task-review-selection' } } };
  const captures = provider.readCaptureView(sessionDir).records;
  const reviewRefs = pilot._internals.captureReferences(context).filter(ref => ref.endsWith('#quality-review'));
  assert.deepStrictEqual(reviewRefs, [`${approval.ref}#quality-review`], 'ordinary draft completion is not a review candidate');
  assert.strictEqual(provider.reviewRecordIndependent(approval, captures, { author, executors: ['draft-worker'] }), true);

  const drafterApproval = provider.buildCaptureRecord({ session_id: author, hook_event_name: 'SubagentStop', agent_id: 'draft-worker',
    last_assistant_message: `Review verdict: approve\nReviewed artifact: docs/adr/EVID-001.md sha256:${'a'.repeat(64)}\nSummary: self approval.` }, 'SubagentStop', '/tmp');
  provider.writeImmutableEvent(sessionDir, drafterApproval);
  provider.rebuildJournalView(sessionDir);
  const withDrafterApproval = provider.readCaptureView(sessionDir).records;
  assert.ok(pilot._internals.captureReferences(context).includes(`${drafterApproval.ref}#quality-review`),
    'an explicit approval remains visible to the provider independence check');
  assert.strictEqual(provider.reviewRecordIndependent(drafterApproval, withDrafterApproval,
    { author, executors: ['draft-worker'] }), false, 'a drafter cannot approve its own work');
  fs.rmSync(sessionDir, { recursive: true, force: true });
});

test('generic successful execution or waiver cannot pass outline-confirmation', () => {
  const target = 'docs/adr/DOCS-001.md';
  const digest = sha('final D bytes');
  const baselineDigest = sha('original B');
  const obligation = {
    id: 'outline-confirmation', capability: 'outline-confirmation', strength: 'MUST',
    applicability: 'applicable', scope: { paths: [target] },
  };
  const genericExecution = {
    id: 'generic-exec', obligationId: 'outline-confirmation', kind: 'execution',
    command: 'echo done', exitCode: 0, paths: [target], artifactDigests: { [target]: digest },
    baseDigest: baselineDigest, provenance: 'ordinary shell command',
  };
  const genericWaiver = {
    id: 'generic-waiver', obligationId: 'outline-confirmation', kind: 'waiver', reason: 'approved',
    citedRecordIds: ['generic-exec'], paths: [target], artifactDigests: { [target]: digest }, baseDigest: baselineDigest,
  };
  const output = checkDocObligations({
    obligations: [obligation], artifacts: { [target]: { digest } }, baseline: { digest: baselineDigest },
    executionRecords: [genericExecution], reviewRecords: [genericWaiver],
  });
  assert.notStrictEqual(output.results[0].outcome, 'pass', 'outline-confirmation must bypass generic execution and waiver lanes');
  assert.strictEqual(output.results[0].observation, 'unresolved');
});

test('outline checker reports a validated O/review/handoff/seam and strict O-to-D as a separate result', () => {
  const target = 'docs/adr/DOCS-001.md';
  const digest = sha('final D bytes');
  const baselineDigest = sha('original B');
  const evidence = {
    schema: 'harness.outline-confirmation.v1', state: 'validated',
    taskId: 'task-prb', attemptId: 'attempt-1', inventoryRowId: '20', domain: 'DOCS',
    inventoryPinDigest: sha('pin'), inventoryArtifactDigest: sha('inventory'),
    baselineCommit: 'a'.repeat(40), outlineCommit: 'b'.repeat(40), draftCommit: 'c'.repeat(40), mergedCommit: 'c'.repeat(40),
    handoffDigest: sha('handoff'), reviewDigest: sha('review'), seamDigest: sha('seam'),
    reviewCaptureDigest: sha('review-capture'), dispatchInputDigest: sha('dispatch'), writerLeaseDigest: sha('lease'),
    dispatchToolUseId: 'dispatch-1',
    ancestry: 'strict-descendant', targetPaths: [target],
    mergeCorrespondence: null,
    outlineArtifactDigests: { [target]: sha('outline O bytes') },
    draftArtifactDigests: { [target]: digest },
    reviewerPrincipal: 'reviewer-agent', coordinatorPrincipal: 'author-session', workerPrincipal: 'worker-agent',
  };
  const output = checkDocObligations({
    obligations: [{ id: 'outline-confirmation', capability: 'outline-confirmation', strength: 'MUST',
      applicability: 'applicable', scope: { paths: [target] } }],
    artifacts: { [target]: { digest } }, baseline: { digest: baselineDigest }, executionRecords: [],
    reviewRecords: [{ id: 'outline-event', obligationId: 'outline-confirmation', kind: 'outline-confirmation',
      provenance: 'validated pre-draft outline evidence', paths: [target], baseDigest: baselineDigest,
      artifactDigests: { [target]: digest }, outlineEvidence: evidence }],
  });
  assert.strictEqual(output.results[0].outcome, 'pass', JSON.stringify({ result: output.results[0], diagnostics: output.diagnostics }));
  assert.strictEqual(output.results[0].observation, 'observed');
  const incomplete = checkDocObligations({
    obligations: [{ id: 'outline-confirmation', capability: 'outline-confirmation', strength: 'MUST',
      applicability: 'applicable', scope: { paths: [target] } }],
    artifacts: { [target]: { digest } }, baseline: { digest: baselineDigest }, executionRecords: [], reviewRecords: [],
  });
  assert.strictEqual(incomplete.results[0].outcome, 'none');
  assert.strictEqual(incomplete.results[0].observation, 'unresolved', 'missing D remains incomplete');
});

test('PreToolUse capture stores only narrow dispatch evidence and remains fail-open when handoff is absent', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'prb-outline-capture-'));
  const stateHome = path.join(root, 'state');
  const workspace = path.join(root, 'workspace');
  fs.mkdirSync(workspace, { recursive: true });
  try {
    const payload = {
      session_id: 'outline-author', cwd: workspace, hook_event_name: 'PreToolUse',
      tool_name: 'Task', tool_use_id: 'dispatch-1', tool_input: { prompt: dispatchLine, alternatePrompt: dispatchLine },
    };
    const driven = spawnSync(process.execPath, [path.join(ROOT, 'hooks/scripts/state-persist.js')], {
      cwd: workspace, encoding: 'utf8', input: JSON.stringify(payload),
      env: { ...process.env, HARNESS_STATE_HOME: stateHome, HARNESS_WORKSPACE_ROOT: workspace, HARNESS_DOC_RECONCILIATION_PILOT: '1' },
    });
    assert.strictEqual(driven.status, 0, 'capture failure remains fail-open to the host');
    const journals = [];
    const walk = dir => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(full);
        else if (entry.name === 'doc-reconciliation-capture.json') journals.push(full);
      }
    };
    walk(stateHome);
    assert.strictEqual(journals.length, 1, 'real state-persist hook captured the dispatch');
    const capture = JSON.parse(fs.readFileSync(journals[0], 'utf8')).records[0];
    assert.strictEqual(capture.outlineDispatch.state, 'unresolved', 'missing handoff cannot earn later credit');
    assert.ok(!Object.hasOwn(capture, 'prompt'), 'raw prompt text is not retained');
    assert.ok(/^[a-f0-9]{64}$/.test(capture.outlineDispatch.promptDigest));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('seam persistence failure consumes the token, keeps tools fail-open, and cannot be repaired on retry', () => {
  const fixture = createOutlineFixture({ realHook: true, blockSeamStorage: true });
  try {
    assert.strictEqual(fixture.capture.outlineDispatch.state, 'unresolved');
    const tokenDigest = sha('token-1');
    const tokenFile = path.join(fixture.attemptDir, 'tokens', `${tokenDigest}.json`);
    assert.ok(fs.existsSync(tokenFile), 'token is consumed before the seam write can fail');
    const replay = fixture.runHook(fixture.payload);
    const last = replay.filter(item => item.event === 'PreToolUse').at(-1);
    assert.strictEqual(last.outlineDispatch.state, 'unresolved', 'retry cannot recreate a missing seam');
    assert.ok(fs.existsSync(tokenFile));
  } finally { fixture.cleanup(); }
});

test('failed token persistence invalidates the attempt; same-attempt retry requires a fresh token/attempt', () => {
  const fixture = createOutlineFixture({ realHook: true, blockTokenStorage: true });
  try {
    assert.strictEqual(fixture.capture.outlineDispatch.state, 'unresolved');
    const blocked = path.join(fixture.attemptDir, 'tokens');
    assert.ok(fs.existsSync(blocked));
    fs.rmSync(blocked, { force: true });
    const retried = fixture.runHook(fixture.payload);
    const latest = retried.filter(item => item.event === 'PreToolUse').at(-1);
    assert.strictEqual(latest.outlineDispatch.state, 'unresolved', 'an earlier failed token write invalidates this attempt');
    assert.strictEqual(fs.existsSync(path.join(fixture.attemptDir, 'seams', `${sha(String(fixture.capture.tool_use_id))}.json`)), false);
  } finally { fixture.cleanup(); }
});

test('configured PreToolUse capture observes competing file writers before completion callbacks', () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'hooks/hooks.json'), 'utf8'));
  const captureHook = manifest.hooks?.PreToolUse?.find(item => item.id === 'harness:pre:pilot-capture');
  const matcher = captureHook?.matcher || '';
  const results = [];
  for (const tool of ['Write', 'Edit', 'apply_patch']) {
    const fixture = createOutlineFixture({ realHook: true });
    try {
      const toolUseId = `competing-${tool}`;
      const input = tool === 'Write' ? { file_path: fixture.target, content: 'competing writer' }
        : tool === 'Edit' ? { file_path: fixture.target, old_string: 'before', new_string: 'after' }
          : { patch: '*** Begin Patch\n*** Update File: docs/adr/DOCS-001.md\n*** End Patch\n' };
      const captures = fixture.runHook({ session_id: fixture.sessionId, cwd: fixture.root,
        hook_event_name: 'PreToolUse', tool_name: tool, tool_use_id: toolUseId,
        agent_id: `competing-principal-${tool}`, agent_type: 'worker', tool_input: input });
      const start = captures.find(item => item.event === 'PreToolUse' && item.tool_use_id === toolUseId);
      const completed = fixture.finishDraft({ runPilot: true });
      results.push({ tool, manifestRouted: matcher.split('|').includes(tool), captured: Boolean(start),
        competingIdentityRetained: start?.agent_id === `competing-principal-${tool}`,
        classifierRejected: JSON.stringify(completed.result).includes('outline-writer-activity-ambiguous'),
        noOutlinePass: completed.pilot?.report?.outlineEvidence?.outcome !== 'pass' });
    } finally { fixture.cleanup(); }
  }

  const positive = createOutlineFixture({ realHook: true });
  let positiveResult;
  try {
    const captures = positive.runHook({ session_id: positive.sessionId, cwd: positive.root,
      hook_event_name: 'PreToolUse', tool_name: 'Write', tool_use_id: 'worker-write',
      agent_id: 'draft-worker', agent_type: 'worker',
      tool_input: { file_path: positive.target, content: 'the correlated worker writes' } });
    const start = captures.find(item => item.event === 'PreToolUse' && item.tool_use_id === 'worker-write');
    const completed = positive.finishDraft({ runPilot: true });
    positiveResult = { manifestRouted: matcher.split('|').includes('Write'), captured: Boolean(start),
      eligible: completed.pilot?.report?.outlineEvidence?.outcome === 'pass' };
  } finally { positive.cleanup(); }

  const off = createOutlineFixture({ realHook: true });
  let offRemainsWriteFree;
  try {
    const before = provider.readCaptureView(off.sessionDir).records.length;
    off.runHook({ session_id: off.sessionId, cwd: off.root, hook_event_name: 'PreToolUse',
      tool_name: 'Write', tool_use_id: 'pilot-off-write', tool_input: { file_path: off.target, content: 'off' } }, false);
    offRemainsWriteFree = provider.readCaptureView(off.sessionDir).records.length === before;
  } finally { off.cleanup(); }

  assert.strictEqual(offRemainsWriteFree, true, 'pilot OFF must remain capture-write-free for file tools');
  assert.strictEqual(positiveResult.eligible, true,
    `the correlated worker remains eligible as a positive control: ${JSON.stringify(positiveResult)}`);
  assert.ok(results.every(item => item.manifestRouted && item.captured && item.competingIdentityRetained
    && item.classifierRejected && item.noOutlinePass)
    && positiveResult.manifestRouted && positiveResult.captured,
  `each configured file-writer start must reach the classifier without a completion callback: ${JSON.stringify({ results, positiveResult })}`);
});

test('partial seal without token, seam, or retained failure cannot be reused; a fresh successor can recover', () => {
  function faultedFixture() {
    return createOutlineFixture({ realHook: true, failPartialDispatchStorage: true,
      allowMissingDispatchCapture: true });
  }
  function firstFailureIsUnrecorded(fixture) {
    const token = path.join(fixture.attemptDir, 'tokens', `${sha('token-1')}.json`);
    const seam = path.join(fixture.attemptDir, 'seams', `${sha('dispatch-1')}.json`);
    return fs.existsSync(path.join(fixture.attemptDir, 'handoff-seal.json'))
      && fs.existsSync(fixture.faultMarker) && !fs.existsSync(token) && !fs.existsSync(seam)
      && !provider.readCaptureView(fixture.sessionDir).records.some(item => item.tool_use_id === 'dispatch-1');
  }

  const sameId = faultedFixture();
  let sameIdRetry;
  let successor;
  try {
    const initialState = firstFailureIsUnrecorded(sameId);
    const sameIdRecords = sameId.runHook(sameId.payload);
    const sameIdCapture = sameIdRecords.filter(item => item.event === 'PreToolUse'
      && item.tool_use_id === sameId.payload.tool_use_id).at(-1);
    sameIdRetry = { retry: sameIdCapture?.outlineDispatch || null, retryCaptured: Boolean(sameIdCapture), initialState };
    const secondAttemptId = 'attempt-2';
    const secondAttemptDir = path.join(path.dirname(sameId.attemptDir), secondAttemptId);
    const lease = { schema: 'harness.outline-writer-lease.v1', id: 'lease-2', taskId: sameId.taskId,
      attemptId: secondAttemptId, principalId: sameId.sessionId, root: sameId.root, exclusive: true, active: true };
    const leaseFile = path.join(secondAttemptDir, 'writer-lease.json');
    writeJson(leaseFile, lease);
    writeJson(path.join(secondAttemptDir, 'handoff.json'), { ...sameId.handoff,
      attemptId: secondAttemptId, handoffId: 'handoff-2', supersedesAttemptId: sameId.attemptId,
      draftDispatchToken: 'token-2', writerLeaseId: lease.id,
      writerLeaseDigest: sha(fs.readFileSync(leaseFile)) });
    const successorPayload = { ...sameId.payload, tool_use_id: 'dispatch-successor', tool_input: {
      prompt: `HARNESS_OUTLINE_DISPATCH_V1 taskId=${sameId.taskId} attemptId=${secondAttemptId} token=token-2 workerRoot=${sameId.root}` } };
    const successorCapture = sameId.runHook(successorPayload).find(item => item.event === 'PreToolUse'
      && item.tool_use_id === successorPayload.tool_use_id);
    successor = successorCapture?.outlineDispatch || null;
    sameIdRetry = { ...sameIdRetry, successor };
  } finally { sameId.cleanup(); }

  const differentId = faultedFixture();
  let differentIdRetry;
  try {
    const initialState = firstFailureIsUnrecorded(differentId);
    const retryPayload = { ...differentId.payload, tool_use_id: 'dispatch-different-id' };
    const retryCapture = differentId.runHook(retryPayload).find(item => item.event === 'PreToolUse'
      && item.tool_use_id === retryPayload.tool_use_id);
    differentIdRetry = { initialState, retry: retryCapture?.outlineDispatch || null, retryCaptured: Boolean(retryCapture),
      tokenCreated: fs.existsSync(path.join(differentId.attemptDir, 'tokens', `${sha('token-1')}.json`)),
      seamCreated: fs.existsSync(path.join(differentId.attemptDir, 'seams', `${sha(retryPayload.tool_use_id)}.json`)) };
  } finally { differentId.cleanup(); }

  assert.ok(sameIdRetry.initialState && differentIdRetry.initialState,
    `fault injection must leave only each seal, losing both token and failure capture: ${JSON.stringify({ sameIdRetry, differentIdRetry })}`);
  assert.strictEqual(sameIdRetry.successor?.state, 'accepted',
    `a fresh successor attempt can recover while retaining its interrupted predecessor: ${JSON.stringify(sameIdRetry.successor)}`);
  assert.ok(sameIdRetry.retry?.state === 'unresolved' && differentIdRetry.retry?.state === 'unresolved'
    && !differentIdRetry.tokenCreated && !differentIdRetry.seamCreated,
  `neither same-ID nor different-ID retry may reconstruct the interrupted seam: ${JSON.stringify({ sameIdRetry, differentIdRetry })}`);
});

test('pilot exposes a real-capture-only outline reference resolver', () => {
  assert.strictEqual(typeof pilot._internals?.outlineDispatchReferences, 'function',
    'missing pilot reference discovery from retained capture records');
  const resolve = pilot._internals.outlineDispatchReferences;
  const captured = [{
    ref: 'PreToolUse:fixture', event: 'PreToolUse', tool_name: 'Task', tool_use_id: 'dispatch-1',
    outlineDispatch: { state: 'accepted', taskId: 'task-prb', attemptId: 'attempt-1' },
  }];
  assert.deepStrictEqual(resolve(captured, 'task-prb'), ['PreToolUse:fixture#outline-confirmation']);
  assert.deepStrictEqual(resolve([], 'task-prb'), [], 'hand-authored JSON with no host capture creates no event ref');
});

test('shipped route + plan/start CLI pins the outline task binding in canonical and packaged layouts', () => {
  // Live run 2026-10-28: the pilot's module lookup missed workflow-obligations, so no task pin was ever written.
  for (const [layout, base] of [['canonical', ROOT], ['packaged', path.join(ROOT, 'plugins/harness-everything')]]) {
    const root = canonical(fs.mkdtempSync(path.join(os.tmpdir(), 'prb-task-pin-')));
    const stateHome = fs.mkdtempSync(path.join(os.tmpdir(), 'prb-task-pin-state-'));
    try {
      fixtureGit(root, ['init', '-q']);
      fs.writeFileSync(path.join(root, 'README.md'), 'B\n');
      fixtureGit(root, ['add', '-A']);
      fixtureGit(root, ['commit', '-q', '-m', 'B baseline']);
      const sessionId = `task-pin-${layout}`;
      const env = { ...process.env, HARNESS_STATE_HOME: stateHome, HARNESS_WORKSPACE_ROOT: root, HARNESS_DOC_RECONCILIATION_PILOT: '1' };
      const kernel = layout === 'canonical' ? path.join(base, 'harness-everything/scripts/kernel-router.js')
        : path.join(base, 'skills/harness-everything/scripts/kernel-router.js');
      const run = (script, args, input) => {
        const child = spawnSync(process.execPath, [script, ...args], { cwd: root, env, encoding: 'utf8', input });
        assert.strictEqual(child.status, 0, `${layout} ${path.basename(script)} ${args[0] || ''}: ${child.stderr || child.stdout}`);
      };
      run(kernel, [], JSON.stringify({ session_id: sessionId, cwd: root, prompt: 'Draft an ADR from the reviewed outline and verify it' }));
      const controller = path.join(base, 'hooks/scripts/workflow-disposition.js');
      run(controller, ['plan', '--session-id', sessionId, '--strategy', 'iterative-single', '--evidence', 'task pin fixture',
        '--requirements-json', JSON.stringify([
          { id: 'adr', stepType: 'doc-change', summary: 'draft ADR', acceptance: 'outline review precedes drafting' },
          { id: 'verify', stepType: 'verification', summary: 'verify', acceptance: 'checker runs' }])]);
      run(controller, ['start', '--session-id', sessionId]);
      const prior = process.env.HARNESS_STATE_HOME;
      process.env.HARNESS_STATE_HOME = stateHome;
      let sessionDir;
      try { sessionDir = require(path.join(ROOT, 'hooks/scripts/lib/harness-state.js')).getSessionDir(root, sessionId); }
      finally { if (prior === undefined) delete process.env.HARNESS_STATE_HOME; else process.env.HARNESS_STATE_HOME = prior; }
      const workflow = JSON.parse(fs.readFileSync(path.join(sessionDir, 'workflow-run.json'), 'utf8'));
      assert.ok(workflow.docReconciliationBaseline, `${layout}: baseline pin is captured`);
      assert.strictEqual(workflow.docReconciliationTask?.taskId, 'task-adr+verify', `${layout}: task pin is captured at plan/start`);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
      fs.rmSync(stateHome, { recursive: true, force: true });
    }
  }
});

test('pre-dispatch seam requires review, exact worker root, clean O tree, lease, pin, and immutable handoff', () => {
  assert.strictEqual(typeof internals.captureOutlineDispatch, 'function', 'missing synchronous pre-dispatch seam');
  const differentWorkerRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'prb-outline-different-worker-'));
  try {
    for (const [name, options, reason] of [
      ['dispatch before review cannot be repaired by later review/handoff', { captureBeforeReview: true }, 'review was absent at dispatch'],
      ['draft worktree mutation after handoff is caught before dispatch', { dirtyBeforeDispatch: true }, 'worker root was not clean at O'],
      ['missing writer identity or lease stays unresolved', { omitHandoff: true }, 'handoff/lease absent'],
      ['a no-force-push policy is not evidence of pre-draft ordering', { omitHandoff: true }, 'no force-push cannot replace a handoff'],
      ['prompt token must exactly equal the coordinator handoff token', { handoffOverrides: { draftDispatchToken: 'coordinator-token' } }, 'prompt token is not handoff-issued'],
      ['an outline already containing a complete decision is not pre-draft evidence', { completeOutline: true }, 'O is already a draft'],
      ['a second substantive Decision heading cannot hide after a placeholder section', { duplicateDecision: true }, 'later Decision text makes O a draft'],
      ['a one-to-three-space indented Markdown Decision heading is still substantive', { indentedDecision: true }, 'indented Decision text makes O a draft'],
      ['target present at B cannot be treated as a new document', { targetExistsAtB: true }, 'target existed at original B'],
      ['same author and reviewer is not independent', { reviewerPrincipal: 'author-session' }, 'reviewer is the author'],
      ['wrong row or domain mapping does not resolve inventory scope', { rowId: '99' }, 'row is absent from pinned inventory'],
    ]) {
      const fixture = createOutlineFixture(options);
      try {
        assert.strictEqual(fixture.capture.outlineDispatch.state, 'unresolved', reason);
        const later = fixture.finishDraft().result;
        assert.notStrictEqual(later.status, 'accepted', `${name}: later evidence cannot repair the seam`);
      } finally { fixture.cleanup(); }
    }
    const wrongRoot = createOutlineFixture({ markerRoot: differentWorkerRoot });
    try {
      assert.notStrictEqual(canonical(wrongRoot.root), canonical(differentWorkerRoot), 'negative uses an existing, distinct directory');
      assert.strictEqual(wrongRoot.capture.outlineDispatch.state, 'unresolved', 'a different existing root stays unresolved');
      assert.notStrictEqual(wrongRoot.finishDraft().result.status, 'accepted', 'later evidence cannot repair the root mismatch');
    } finally { wrongRoot.cleanup(); }
  } finally { fs.rmSync(differentWorkerRoot, { recursive: true, force: true }); }
});

test('canonical root identity accepts an alias across marker, handoff, lease, and worker capture', () => {
  const fixture = createOutlineFixture({ workerRootAlias: true });
  try {
    assert.strictEqual(fixture.capture.outlineDispatch.state, 'accepted', JSON.stringify(fixture.capture.outlineDispatch));
    assert.strictEqual(fixture.finishDraft().result.status, 'accepted', 'worker CWD and aliased root identify one directory');
  } finally { fixture.cleanup(); }
});

test('one-use token deduplicates identical seams but replayed tool-use records stay unresolved', () => {
  assert.strictEqual(typeof internals.captureOutlineDispatch, 'function', 'missing token-consuming seam');
  const duplicate = createOutlineFixture();
  try {
    const same = duplicate.dispatchAgain();
    assert.strictEqual(same.outlineDispatch.state, 'accepted', JSON.stringify(same.outlineDispatch));
    assert.strictEqual(same.outlineDispatch.duplicate, true);
    assert.notStrictEqual(duplicate.finishDraft().result.status, 'accepted', 'a replayed host PreToolUse record is not a unique dispatch anchor');
  } finally { duplicate.cleanup(); }

  for (const [name, replay] of [
    ['same token on a different tool_use_id', { toolUseId: 'dispatch-2' }],
    ['same tool_use_id with changed dispatch input', { prompt: dispatchLine + '\nchanged input' }],
  ]) {
    const fixture = createOutlineFixture();
    try {
      const replayed = fixture.dispatchAgain(replay);
      assert.strictEqual(replayed.outlineDispatch.state, 'unresolved', name);
      const completed = fixture.finishDraft();
      assert.notStrictEqual(completed.result.status, 'accepted', `${name} cannot earn later credit: ${JSON.stringify(completed.captures.filter(item => item.event === 'PreToolUse').map(item => ({ id: item.tool_use_id, dispatch: item.outlineDispatch })))}`);
    } finally { fixture.cleanup(); }
  }

  const consumed = createOutlineFixture();
  try {
    const seamFile = path.join(consumed.attemptDir, 'seams', `${sha(consumed.capture.tool_use_id)}.json`);
    fs.rmSync(seamFile, { force: true });
    const retry = consumed.dispatchAgain();
    assert.strictEqual(retry.outlineDispatch.state, 'unresolved', 'a consumed token with a missing seam is never recreated');
  } finally { consumed.cleanup(); }
});

test('outline evidence binds exact task, B, O blobs, independent review, worker start/result, and strict O-to-D', () => {
  assert.strictEqual(typeof internals.captureOutlineDispatch, 'function', 'missing pre-dispatch evidence');
  const valid = createOutlineFixture();
  try {
    const completed = valid.finishDraft({ finalReview: true });
    assert.strictEqual(valid.capture.outlineDispatch.state, 'accepted');
    assert.strictEqual(completed.result.status, 'accepted', JSON.stringify(completed.result));
    assert.strictEqual(completed.result.event.capability, 'outline-confirmation');
  } finally { valid.cleanup(); }

  const placeholder = createOutlineFixture({ decisionPlaceholder: true });
  try {
    assert.strictEqual(placeholder.capture.outlineDispatch.state, 'accepted',
      'one placeholder Decision heading is still a valid outline');
    assert.strictEqual(placeholder.finishDraft().result.status, 'accepted');
  } finally { placeholder.cleanup(); }

  const delayedWriter = createOutlineFixture();
  try {
    delayedWriter.reviewCaptures.unshift(provider.buildCaptureRecord({
      session_id: delayedWriter.sessionId, cwd: delayedWriter.root, hook_event_name: 'PostToolUse',
      tool_name: 'Edit', tool_use_id: 'delayed-edit', agent_id: delayedWriter.sessionId,
      tool_input: { file_path: delayedWriter.target }, tool_response: { interrupted: false },
    }, 'PostToolUse', delayedWriter.root));
    assert.notStrictEqual(delayedWriter.finishDraft().result.status, 'accepted',
      'a delayed write/edit callback from the coordinator remains visible and blocks ambiguous writer history');
  } finally { delayedWriter.cleanup(); }

  // Live run 2026-10-28: a non-isolated reviewer starts in O; only a stop journaled before the dispatch clears it.
  const reviewerStart = fixture => provider.buildCaptureRecord({ session_id: fixture.sessionId, cwd: fixture.root,
    hook_event_name: 'SubagentStart', agent_id: 'outline-reviewer', agent_type: 'reviewer' }, 'SubagentStart', fixture.root);
  const stoppedReviewer = createOutlineFixture();
  try {
    stoppedReviewer.reviewCaptures.unshift(reviewerStart(stoppedReviewer));
    const completed = stoppedReviewer.finishDraft();
    assert.strictEqual(completed.result.status, 'accepted',
      `a reviewer that started and stopped in O before the dispatch is not a competing writer: ${JSON.stringify(completed.result)}`);
  } finally { stoppedReviewer.cleanup(); }
  for (const [name, arrange] of [
    ['reviewer stop after the dispatch', fixture => {
      const stop = fixture.reviewCaptures.findIndex(item => item.event === 'SubagentStop');
      fixture.extraCaptures.push(...fixture.reviewCaptures.splice(stop, 1));
      fixture.reviewCaptures.unshift(reviewerStart(fixture));
    }],
    ['reviewer start without a stop', fixture => {
      fixture.reviewCaptures.unshift(provider.buildCaptureRecord({ session_id: fixture.sessionId, cwd: fixture.root,
        hook_event_name: 'SubagentStart', agent_id: 'other-agent', agent_type: 'reviewer' }, 'SubagentStart', fixture.root));
    }],
    ['reviewer start after its stop', fixture => { fixture.reviewCaptures.push(reviewerStart(fixture)); }],
    ['duplicate reviewer start with one stop before the dispatch', fixture => {
      fixture.reviewCaptures.unshift(reviewerStart(fixture), reviewerStart(fixture));
    }],
    ['reviewer start with duplicate stops before the dispatch', fixture => {
      const stop = fixture.reviewCaptures.find(item => item.event === 'SubagentStop');
      fixture.reviewCaptures.unshift(reviewerStart(fixture));
      fixture.reviewCaptures.push({ ...stop, ref: `${stop.ref}:dup`, captureId: `${stop.captureId}:dup` });
    }],
    ['reviewer start after the dispatch', fixture => { fixture.extraCaptures.push(reviewerStart(fixture)); }],
  ]) {
    const fixture = createOutlineFixture();
    try {
      arrange(fixture);
      const completed = fixture.finishDraft();
      assert.ok(completed.result.diagnostics?.some(item => item.code === 'outline-competing-writer-start'),
        `${name} stays a competing writer start: ${JSON.stringify(completed.result)}`);
    } finally { fixture.cleanup(); }
  }

  const unqualified = createOutlineFixture();
  try {
    const completed = unqualified.finishDraft();
    const noRetainedMapping = provider.createClaudeOriginProvider({
      hostId: 'claude-code', sessionId: unqualified.sessionId, workspaceRoot: unqualified.root,
      workflowId: unqualified.workflowId, workflowRevision: unqualified.workflowRevision, taskId: unqualified.taskId,
      principals: { author: unqualified.sessionId, executors: [] },
      baseline: { root: unqualified.root, commit: unqualified.baselineCommit },
      captures: completed.captures, sessionDir: unqualified.sessionDir, taskBinding: unqualified.taskBinding,
      qualification: { source: 'fake-test-fixture', faked: true, toolUseIdPopulated: true, agentIdPopulated: true },
      outlineFixture: { expectedPin: unqualified.expectedPin },
    });
    assert.notStrictEqual(noRetainedMapping.resolveEvent({ reference: `${unqualified.capture.ref}#outline-confirmation`,
      identity: completed.identity }).status, 'accepted', 'unqualified live prompt/root mapping never earns positive credit');
  } finally { unqualified.cleanup(); }

  for (const [name, fixtureOptions, finishOptions] of [
    ['wrong task', {}, { providerTaskId: 'task-other' }],
    ['wrong session after restart', {}, { providerSessionId: 'different-session' }],
    ['wrong baseline/config/O tree/blob binding', { handoffOverrides: { configDigest: 'f'.repeat(64) } }, {}],
    ['missing O Git object', { handoffOverrides: { outline: { commit: 'f'.repeat(40), tree: 'e'.repeat(40), targetBlobs: {} } } }, {}],
    ['wrong target path binding', { handoffOverrides: { targetPaths: ['docs/adr/DOCS-999.md'] } }, {}],
    ['wrong O tree/blob binding', { handoffOverrides: { outline: { commit: 'a'.repeat(40), tree: 'f'.repeat(40), targetBlobs: {} } } }, {}],
    ['missing Git object', {}, { draft: false }],
    ['D is not a strict descendant of O', {}, { nonDescendant: true }],
    ['no final D', {}, { draft: false }],
    ['worker start/root/principal absent', {}, { omitWorkerStart: true }],
    ['eventual Task result absent', {}, { omitWorkerResult: true }],
    ['outline reviewer is also the draft worker', { reviewerPrincipal: 'draft-worker' }, {}],
    ['unknown competing writer has no positive lease evidence', { competingWriters: true }, {}],
  ]) {
    const fixture = createOutlineFixture(fixtureOptions);
    try {
      const completed = fixture.finishDraft(finishOptions);
      assert.notStrictEqual(completed.result.status, 'accepted', `${name} is rejected or unresolved`);
    } finally { fixture.cleanup(); }
  }
});

test('baseline integrity, callback order, delayed result, stash/restore, and unobservable writer channels stay unresolved', () => {
  assert.strictEqual(typeof internals.captureOutlineDispatch, 'function', 'missing pre-dispatch seam validation');
  for (const [name, fixtureOptions] of [
    ['a write before review', { dirtyBeforeDispatch: true }],
    ['a missing pre-dispatch handoff', { omitHandoff: true }],
    ['a target deleted and re-added after it existed at B', { targetExistsAtB: true }],
    ['a complete draft merely labelled as an outline', { completeOutline: true }],
  ]) {
    const fixture = createOutlineFixture(fixtureOptions);
    try {
      assert.strictEqual(fixture.capture.outlineDispatch.state, 'unresolved', name);
      const delayed = fixture.finishDraft({ omitWorkerResult: true });
      assert.notStrictEqual(delayed.result.status, 'accepted', `${name}; delayed callback/result cannot repair the seam`);
    } finally { fixture.cleanup(); }
  }

  const movedBaseline = createOutlineFixture({
    handoffOverrides: { baseline: { root: '/tmp/other-root', commit: 'd'.repeat(40), tree: 'e'.repeat(40), configDigest: 'f'.repeat(64) } },
  });
  try {
    assert.strictEqual(movedBaseline.capture.outlineDispatch.state, 'unresolved', 'B cannot be reset to O or another root');
  } finally { movedBaseline.cleanup(); }

  const changedAfterReview = createOutlineFixture();
  try {
    fs.writeFileSync(path.join(changedAfterReview.root, changedAfterReview.target), 'changed after O review');
    assert.strictEqual(internals.captureOutlineDispatch({
      payload: changedAfterReview.payload, capture: changedAfterReview.capture, sessionDir: changedAfterReview.sessionDir,
      workspaceRoot: changedAfterReview.root, captures: changedAfterReview.reviewCaptures,
      fixtureExpectedPin: changedAfterReview.expectedPin,
    }).state, 'unresolved', 'stash/restore or any draft bytes before dispatch make the worker root dirty');
  } finally { changedAfterReview.cleanup(); }

  const shellWriter = createOutlineFixture();
  try {
    shellWriter.reviewCaptures.unshift(provider.buildCaptureRecord({
      session_id: shellWriter.sessionId, cwd: shellWriter.root, hook_event_name: 'PostToolUse',
      tool_name: 'Bash', tool_use_id: 'shell-writer-1', agent_id: shellWriter.sessionId,
      tool_input: { command: 'node ./mutate.js' }, tool_response: { interrupted: false },
    }, 'PostToolUse', shellWriter.root));
    assert.notStrictEqual(shellWriter.finishDraft().result.status, 'accepted',
      'an unclassified script-capable shell from a non-worker remains unresolved');
  } finally { shellWriter.cleanup(); }
});

const outlineMappingV2 = {
  version: 'claude-outline-dispatch-mapping/2',
  promptField: 'tool_input.prompt',
  dispatchKey: 'session_id+tool_use_id',
  runInBackgroundField: 'tool_input.run_in_background',
  isolationPresenceField: 'tool_input.isolation',
  resultAgentIdField: 'tool_response.agentId',
  resultStatusField: 'tool_response.status',
  workerStartEvent: 'SubagentStart',
  workerStopEvent: 'SubagentStop',
  workerIdentity: 'session_id+agent_id',
  workerRootField: 'cwd',
};

test('valid separate outline export opens outline qualification', () => {
  const staged = stageQualificationTree('source');
  try {
    const records = [qualificationDispatch(), qualificationStart(), qualificationResult(), qualificationStop()];
    const bytes = Buffer.from(records.map(record => JSON.stringify(record)).join('\n') + '\n');
    const file = 'doc-reconciliation-outline-capture.sanitized.jsonl';
    fs.writeFileSync(path.join(staged.libDir, file), bytes);
    staged.writeExport(staged.validExport({
      outlineDispatchCapture: { mapping: outlineMappingV2, file, sha256: sha(bytes), hostVersion: '2.1.312',
        run: 'run8', baseline: '1bd0f805031c5577a6e7f72a9bc5b41618b71fc1' },
    }));
    const outcome = require(path.join(staged.libDir, 'doc-reconciliation-provider.js'))
      ._internals.validateOutlineCaptureQualification({ hostId: 'claude-code' });
    assert.strictEqual(outcome.open, true, JSON.stringify(outcome));
  } finally { staged.cleanup(); }
});

function qualificationDispatch({ id = 'dispatch-1', promptId = 'shared-prompt', background = false, hasBackground = true,
  isolation, hasIsolation = false, session = 'coordinator' } = {}) {
  const toolInput = { prompt: dispatchLine, ...(hasBackground ? { run_in_background: background } : {}) };
  if (hasIsolation) toolInput.isolation = isolation;
  return { event: 'PreToolUse', tool_name: 'Task', tool_use_id: id, session_id: session, prompt_id: promptId, tool_input: toolInput };
}

function qualificationStart(agentId = 'worker', { session = 'coordinator', cwd = '/tmp/prb-worker', id } = {}) {
  return { event: 'SubagentStart', ...(id ? { tool_use_id: id } : {}), agent_id: agentId, session_id: session, cwd };
}

function qualificationStop(agentId = 'worker', { session = 'coordinator', cwd = '/tmp/prb-worker' } = {}) {
  return { event: 'SubagentStop', agent_id: agentId, session_id: session, cwd };
}

function qualificationResult(id = 'dispatch-1', agentId = 'worker', status = 'completed', { session = 'coordinator', legacyAgentId } = {}) {
  const toolResponse = { agentId };
  if (status !== null) toolResponse.status = status;
  return { event: 'PostToolUse', tool_name: 'Task', tool_use_id: id, session_id: session,
    ...(legacyAgentId !== undefined ? { agent_id: legacyAgentId } : {}), tool_response: toolResponse };
}

function stagedOutlineOutcome(staged) {
  return require(path.join(staged.libDir, 'doc-reconciliation-provider.js'))
    ._internals.validateOutlineCaptureQualification({ hostId: 'claude-code' });
}

function writeStagedOutlineEvidence(staged, records) {
  const file = 'doc-reconciliation-outline-capture.sanitized.jsonl';
  const bytes = Buffer.from(records.map(record => JSON.stringify(record)).join('\n') + '\n');
  fs.writeFileSync(path.join(staged.libDir, file), bytes);
  const wrapper = { mapping: outlineMappingV2, file, sha256: sha(bytes), hostVersion: '2.1.312', run: 'run8',
    baseline: '1bd0f805031c5577a6e7f72a9bc5b41618b71fc1' };
  staged.writeExport(staged.validExport({ outlineDispatchCapture: wrapper }));
  return { wrapper, filePath: path.join(staged.libDir, file), bytes };
}

test('shipped run8 capture opens production qualification without DI', () => {
  const qualification = internals.validateOutlineCaptureQualification({ hostId: 'claude-code' });
  assert.strictEqual(qualification.open, true, JSON.stringify(qualification));
  assert.strictEqual(qualification.source, 'validated-export');
  assert.strictEqual(qualification.captureFile, 'doc-reconciliation-outline-capture.sanitized.jsonl');
});

test('shipped run8 export resolves the real-hook integrated fixture without fake qualification', () => {
  const originalFactory = provider.createClaudeOriginProvider;
  let originInput;
  provider.createClaudeOriginProvider = input => {
    originInput = input;
    return originalFactory(input);
  };
  const fixture = createOutlineFixture({ realHook: true, retainedInventory: true, noFakeQualification: true });
  try {
    const completed = fixture.finishDraft();
    assert.strictEqual(completed.result.status, 'accepted', JSON.stringify(completed.result));
    assert.strictEqual(Object.hasOwn(originInput, 'qualification'), false, 'production resolution must use the shipped export');
  } finally {
    provider.createClaudeOriginProvider = originalFactory;
    fixture.cleanup();
  }
});

test('mapped row 17 dispatch accepts EVID-001 while the old VERI request and a substituted domain reject', () => {
  const valid = createOutlineFixture({ retainedInventory: true, noFakeQualification: true });
  try {
    const completed = valid.finishDraft();
    assert.strictEqual(completed.result.status, 'accepted', JSON.stringify(completed.result));
    assert.strictEqual(completed.result.event.outlineEvidence.inventoryRowId, '17');
    assert.strictEqual(completed.result.event.outlineEvidence.domain, 'EVID');
  } finally { valid.cleanup(); }

  const unapprovedVeri = createOutlineFixture({ retainedInventory: true, rowId: '16',
    target: 'docs/adr/VERI-001.md', domain: 'VERI' });
  try {
    assert.strictEqual(unapprovedVeri.capture.outlineDispatch.state, 'unresolved');
    assert.ok(unapprovedVeri.capture.outlineDispatch.reasons.includes('outline-inventory-binding-mismatch'));
  } finally { unapprovedVeri.cleanup(); }

  const unchangedRun8 = createOutlineFixture({ retainedInventory: true, rowId: '17',
    target: 'docs/adr/EVID-001-verify-all-evidence.md', domain: 'EVID' });
  try {
    assert.strictEqual(unchangedRun8.capture.outlineDispatch.state, 'unresolved');
    assert.ok(unchangedRun8.capture.outlineDispatch.reasons.includes('outline-domain-target-mismatch'),
      'the original descriptive filename still fails the citation-id/basename check');
  } finally { unchangedRun8.cleanup(); }

  const substituted = createOutlineFixture({ retainedInventory: true,
    handoffOverrides: { inventory: { ...internals.OUTLINE_INVENTORY_PIN, rowId: '17', domain: 'VERI',
      targetPaths: ['docs/adr/EVID-001.md'] } } });
  try {
    assert.strictEqual(substituted.capture.outlineDispatch.state, 'unresolved');
    assert.ok(substituted.capture.outlineDispatch.reasons.includes('outline-inventory-binding-mismatch'));
  } finally { substituted.cleanup(); }
});

test('separate outline export failures stay closed for digest, path, file, wrapper, mapping, and chain corruption', () => {
  const staged = stageQualificationTree('source');
  const validRecords = [qualificationDispatch(), qualificationStart(), qualificationResult(), qualificationStop()];
  try {
    const closed = (name, mutate, records = validRecords) => {
      const { wrapper, filePath } = writeStagedOutlineEvidence(staged, records);
      mutate(wrapper, filePath);
      const outcome = stagedOutlineOutcome(staged);
      assert.strictEqual(outcome.open, false, `${name}: ${JSON.stringify(outcome)}`);
    };
    closed('wrong digest', wrapper => {
      wrapper.sha256 = '0'.repeat(64);
      staged.writeExport(staged.validExport({ outlineDispatchCapture: wrapper }));
    });
    closed('unsafe filename', wrapper => {
      wrapper.file = '../doc-reconciliation-outline-capture.sanitized.jsonl';
      staged.writeExport(staged.validExport({ outlineDispatchCapture: wrapper }));
    });
    closed('missing file', (_wrapper, filePath) => fs.rmSync(filePath));
    closed('malformed file', (wrapper, filePath) => {
      const bytes = Buffer.from('{malformed json}\n');
      fs.writeFileSync(filePath, bytes);
      wrapper.sha256 = sha(bytes);
      staged.writeExport(staged.validExport({ outlineDispatchCapture: wrapper }));
    });
    closed('malformed wrapper', () => staged.writeExport(staged.validExport({ outlineDispatchCapture: null })));
    closed('mapping mismatch', wrapper => {
      wrapper.mapping = { ...outlineMappingV2, workerRootField: 'cwd.unobserved' };
      staged.writeExport(staged.validExport({ outlineDispatchCapture: wrapper }));
    });
    const crossSession = validRecords.map(record => ({ ...record }));
    crossSession[2].session_id = 'other-coordinator';
    closed('only dispatch chain crosses coordinator sessions', () => {}, crossSession);
    const wrongRoot = validRecords.map(record => ({ ...record }));
    wrongRoot[1].cwd = '/tmp/other-worker';
    closed('only dispatch chain has a worker-root mismatch', () => {}, wrongRoot);
  } finally { staged.cleanup(); }
});

function outlineCorrelation(records, anchor = records.find(item => item.event === 'PreToolUse')) {
  return internals.correlateOutlineDispatch(records, anchor, '/tmp/prb-worker');
}

test('live qualification accepts the versioned Claude 2.1.312 dispatch/result/worker field contract', () => {
  assert.strictEqual(typeof internals.outlineCaptureMappingValid, 'function', 'missing qualification correlation validator');
  assert.deepStrictEqual(internals.OUTLINE_CAPTURE_MAPPING, outlineMappingV2, 'mapping field contract must be explicitly versioned');
  const pre = qualificationDispatch();
  const records = [pre, qualificationStart(), qualificationResult(), qualificationStop()];
  assert.strictEqual(internals.outlineCaptureMappingValid(outlineMappingV2, records), true,
    'PreToolUse → completed tool_response.agentId → unique Start/Stop is the 2.1.312 host shape');
  const crossSession = records.map(item => ({ ...item }));
  crossSession[2].session_id = 'different-session';
  assert.strictEqual(internals.outlineCaptureMappingValid(outlineMappingV2, crossSession), false,
    'matching tool IDs across different coordinator sessions do not qualify the live mapping');
  const wrongRoot = records.map(item => ({ ...item }));
  wrongRoot[1].cwd = '/tmp/other-worker';
  assert.strictEqual(internals.outlineCaptureMappingValid(outlineMappingV2, wrongRoot), false);
});

test('capture record retains only explicit outline result and dispatch fields', () => {
  const pre = provider.buildCaptureRecord({ session_id: 'coordinator', tool_name: 'Task', tool_use_id: 'explicit',
    tool_input: { prompt: dispatchLine, run_in_background: false } }, 'PreToolUse', '/tmp/prb-worker');
  assert.strictEqual(pre.run_in_background, false);
  assert.strictEqual(pre.isolationSet, false);
  const omitted = provider.buildCaptureRecord({ session_id: 'coordinator', tool_name: 'Agent', tool_use_id: 'omitted',
    tool_input: { prompt: dispatchLine } }, 'PreToolUse', '/tmp/prb-worker');
  assert.strictEqual(Object.hasOwn(omitted, 'run_in_background'), false, 'missing background input stays absent');
  const isolated = provider.buildCaptureRecord({ session_id: 'coordinator', tool_name: 'Agent', tool_use_id: 'isolated',
    tool_input: { prompt: dispatchLine, run_in_background: false, isolation: null } }, 'PreToolUse', '/tmp/prb-worker');
  assert.strictEqual(isolated.isolationSet, true, 'present null isolation is not normalized to absence');
  const result = provider.buildCaptureRecord({ session_id: 'coordinator', tool_name: 'Task', tool_use_id: 'result',
    tool_response: { agentId: 'worker', status: 'completed' } }, 'PostToolUse', '/tmp/prb-worker');
  assert.strictEqual(result.tool_response_status, 'completed');
  const noStatus = provider.buildCaptureRecord({ session_id: 'coordinator', tool_name: 'Task', tool_use_id: 'no-status',
    tool_response: { agentId: 'worker' } }, 'PostToolUse', '/tmp/prb-worker');
  assert.strictEqual(Object.hasOwn(noStatus, 'tool_response_status'), false, 'missing result status stays absent');
});

for (const [name, make, reason] of [
  ['concurrent same-session dispatches cannot reuse one worker result', () => {
    const one = qualificationDispatch({ id: 'dispatch-1' });
    const two = qualificationDispatch({ id: 'dispatch-2' });
    return { records: [one, two, qualificationStart(), qualificationResult('dispatch-1'),
      qualificationResult('dispatch-2'), qualificationStop()], anchor: one };
  }, 'outline-worker-agent-id-replayed'],
  ['a shared prompt_id cannot replace the target tool_use_id', () => {
    const one = qualificationDispatch({ id: 'dispatch-1' });
    const two = qualificationDispatch({ id: 'dispatch-2' });
    return { records: [one, two, qualificationStart('worker-2'), qualificationResult('dispatch-2', 'worker-2'),
      qualificationStop('worker-2')], anchor: one };
  }, 'outline-worker-result-missing-or-ambiguous'],
  ['reordered Stop-before-Start is unresolved', () => {
    const pre = qualificationDispatch();
    return { records: [pre, qualificationStop(), qualificationStart(), qualificationResult()], anchor: pre };
  }, 'outline-worker-stop-before-start'],
  ['Start-before-Pre is unresolved', () => {
    const pre = qualificationDispatch();
    return { records: [qualificationStart(), pre, qualificationResult(), qualificationStop()], anchor: pre };
  }, 'outline-worker-start-before-dispatch'],
  ['missing result is unresolved', () => {
    const pre = qualificationDispatch();
    return { records: [pre, qualificationStart(), qualificationStop()], anchor: pre };
  }, 'outline-worker-result-missing-or-ambiguous'],
  ['duplicate result is unresolved', () => {
    const pre = qualificationDispatch();
    return { records: [pre, qualificationStart(), qualificationResult(), qualificationResult(), qualificationStop()], anchor: pre };
  }, 'outline-worker-result-missing-or-ambiguous'],
  ['duplicate worker start is unresolved', () => {
    const pre = qualificationDispatch();
    return { records: [pre, qualificationStart(), qualificationStart(), qualificationResult(), qualificationStop()], anchor: pre };
  }, 'outline-worker-start-missing-or-ambiguous'],
  ['duplicate worker stop is unresolved', () => {
    const pre = qualificationDispatch();
    return { records: [pre, qualificationStart(), qualificationResult(), qualificationStop(), qualificationStop()], anchor: pre };
  }, 'outline-worker-stop-missing-or-ambiguous'],
  ['conflicting top-level and observed agentId is unresolved', () => {
    const pre = qualificationDispatch();
    return { records: [pre, qualificationStart(), qualificationResult('dispatch-1', 'worker', 'completed', { legacyAgentId: 'other-worker' }),
      qualificationStop()], anchor: pre };
  }, 'outline-worker-result-agent-id-conflict'],
  ['async_launched is unresolved', () => {
    const pre = qualificationDispatch();
    return { records: [pre, qualificationStart(), qualificationResult('dispatch-1', 'worker', 'async_launched'), qualificationStop()], anchor: pre };
  }, 'outline-worker-result-async'],
  ['absent result status is unresolved', () => {
    const pre = qualificationDispatch();
    return { records: [pre, qualificationStart(), qualificationResult('dispatch-1', 'worker', null), qualificationStop()], anchor: pre };
  }, 'outline-worker-result-status-missing'],
  ['failed result status is unresolved', () => {
    const pre = qualificationDispatch();
    return { records: [pre, qualificationStart(), qualificationResult('dispatch-1', 'worker', 'failed'), qualificationStop()], anchor: pre };
  }, 'outline-worker-result-failed'],
  ['cancelled result status is unresolved', () => {
    const pre = qualificationDispatch();
    return { records: [pre, qualificationStart(), qualificationResult('dispatch-1', 'worker', 'cancelled'), qualificationStop()], anchor: pre };
  }, 'outline-worker-result-failed'],
  ['missing Stop is unresolved', () => {
    const pre = qualificationDispatch();
    return { records: [pre, qualificationStart(), qualificationResult()], anchor: pre };
  }, 'outline-worker-stop-missing-or-ambiguous'],
  ['worker-root mismatch is unresolved', () => {
    const pre = qualificationDispatch();
    return { records: [pre, qualificationStart('worker', { cwd: '/tmp/other-worker' }), qualificationResult(), qualificationStop()], anchor: pre };
  }, 'outline-worker-root-mismatch'],
  ['worktree isolation is unresolved', () => {
    const pre = qualificationDispatch({ hasIsolation: true, isolation: 'worktree' });
    return { records: [pre, qualificationStart(), qualificationResult(), qualificationStop()], anchor: pre };
  }, 'outline-dispatch-isolation-unsupported'],
  ['present null isolation is unresolved', () => {
    const pre = qualificationDispatch({ hasIsolation: true, isolation: null });
    return { records: [pre, qualificationStart(), qualificationResult(), qualificationStop()], anchor: pre };
  }, 'outline-dispatch-isolation-unsupported'],
  ['omitted run_in_background is unresolved', () => {
    const pre = qualificationDispatch({ hasBackground: false });
    return { records: [pre, qualificationStart(), qualificationResult(), qualificationStop()], anchor: pre };
  }, 'outline-dispatch-background-unobserved'],
  ['an Agent PostToolUseFailure invalidates a completed result', () => {
    const pre = qualificationDispatch();
    return { records: [pre, qualificationStart(), qualificationResult(),
      { event: 'PostToolUseFailure', tool_name: 'Task', tool_use_id: 'dispatch-1', session_id: 'coordinator' }, qualificationStop()], anchor: pre };
  }, 'outline-worker-result-failed'],
]) {
  test(`outline correlation rejects ${name}`, () => {
    const { records, anchor } = make();
    const result = outlineCorrelation(records, anchor);
    assert.deepStrictEqual(result, { state: 'unresolved', reason });
  });
}

test('runtime resolution accepts Stop after the completed result through the synthetic qualification seam', () => {
  const fixture = createOutlineFixture();
  try {
    const completed = fixture.finishDraft();
    assert.strictEqual(completed.result.status, 'accepted', JSON.stringify(completed.result));
    const workerResultIndex = completed.captures.findIndex(item => item.event === 'PostToolUse'
      && item.tool_use_id === fixture.capture.tool_use_id);
    const workerStopIndex = completed.captures.findIndex(item => item.event === 'SubagentStop'
      && item.agent_id === 'draft-worker');
    assert.ok(workerResultIndex >= 0 && workerStopIndex > workerResultIndex,
      'the 2.1.312 field shape allows result before Stop; no Stop-before-result condition is implied');
  } finally { fixture.cleanup(); }
});

test('missing outline wrapper keeps outline-live-gate-unmet', () => {
  const staged = stageQualificationTree('source');
  try {
    staged.writeExport(staged.validExport());
    const qualification = stagedOutlineOutcome(staged);
    assert.strictEqual(qualification.open, false, JSON.stringify(qualification));
  } finally { staged.cleanup(); }
});

test('original B and immutable attempt chain survive reconfirmation; stale attempts/tokens never cover new scope', () => {
  assert.strictEqual(typeof internals.resolveOutlineAttempt, 'function', 'missing immutable attempt-chain resolver');
  const fixture = createOutlineFixture();
  try {
    const resolved = internals.resolveOutlineAttempt({ sessionDir: fixture.sessionDir, taskId: fixture.taskId, attemptId: fixture.attemptId });
    assert.strictEqual(resolved.state, 'accepted');
    const originalBaseline = fixture.baselineCommit;
    const secondId = 'attempt-2';
    const secondDir = path.join(fixture.sessionDir, 'doc-reconciliation/outline-confirmation', fixture.taskId, 'attempts', secondId);
    fs.mkdirSync(secondDir, { recursive: true });
    const lease2 = { schema: 'harness.outline-writer-lease.v1', id: 'lease-2', taskId: fixture.taskId,
      attemptId: secondId, principalId: fixture.sessionId, root: fixture.root, exclusive: true, active: true };
    writeJson(path.join(secondDir, 'writer-lease.json'), lease2);
    const second = { ...fixture.handoff, attemptId: secondId, handoffId: 'handoff-2', supersedesAttemptId: fixture.attemptId,
      draftDispatchToken: 'token-2', writerLeaseId: lease2.id,
      writerLeaseDigest: sha(fs.readFileSync(path.join(secondDir, 'writer-lease.json'))) };
    writeJson(path.join(secondDir, 'handoff.json'), second);
    const secondResolved = internals.resolveOutlineAttempt({ sessionDir: fixture.sessionDir, taskId: fixture.taskId, attemptId: secondId });
    assert.strictEqual(secondResolved.state, 'accepted', 'current attempt links to one retained predecessor');
    assert.strictEqual(secondResolved.handoff.baseline.commit, originalBaseline, 'B never moves to O');
    assert.notStrictEqual(internals.resolveOutlineAttempt({ sessionDir: fixture.sessionDir, taskId: fixture.taskId, attemptId: fixture.attemptId }).state,
      'accepted', 'superseded dispatch cannot cover the new scope');
    const reusedToken = { ...second, draftDispatchToken: fixture.handoff.draftDispatchToken };
    writeJson(path.join(secondDir, 'handoff.json'), reusedToken);
    assert.strictEqual(internals.resolveOutlineAttempt({ sessionDir: fixture.sessionDir, taskId: fixture.taskId, attemptId: secondId }).state,
      'unresolved', 'a token consumed by a predecessor cannot be reused by a retry');
    const movedB = { ...second, baseline: { ...second.baseline, commit: fixture.outlineCommit } };
    writeJson(path.join(secondDir, 'handoff.json'), movedB);
    assert.strictEqual(internals.resolveOutlineAttempt({ sessionDir: fixture.sessionDir, taskId: fixture.taskId, attemptId: secondId }).state,
      'unresolved', 'the task baseline cannot move from B to O');
    const changedScope = { ...second, targetPaths: ['docs/adr/DOCS-002.md'],
      inventory: { ...second.inventory, targetPaths: ['docs/adr/DOCS-002.md'] } };
    writeJson(path.join(secondDir, 'handoff.json'), changedScope);
    const changedPrompt = `HARNESS_OUTLINE_DISPATCH_V1 taskId=${fixture.taskId} attemptId=${secondId} token=token-2 workerRoot=${fixture.root}`;
    const changedPayload = { ...fixture.payload, tool_use_id: 'dispatch-scope-change', tool_input: { prompt: changedPrompt } };
    const changedCapture = provider.buildCaptureRecord(changedPayload, 'PreToolUse', fixture.root);
    changedCapture.observedIdentity = fixture.capture.observedIdentity;
    assert.strictEqual(internals.captureOutlineDispatch({ payload: changedPayload, capture: changedCapture,
      sessionDir: fixture.sessionDir, workspaceRoot: fixture.root, captures: fixture.reviewCaptures,
      fixtureExpectedPin: fixture.expectedPin }).state, 'unresolved',
    'changed attempt scope cannot reuse an old O review/handoff');
    second.supersedesAttemptId = 'missing-predecessor';
    writeJson(path.join(secondDir, 'handoff.json'), second);
    assert.strictEqual(internals.resolveOutlineAttempt({ sessionDir: fixture.sessionDir, taskId: fixture.taskId, attemptId: secondId }).state,
      'unresolved', 'broken attempt chains stay unresolved');
  } finally { fixture.cleanup(); }
});

test('squash correspondence retains only identical O/D target blobs and requires available Git objects', () => {
  assert.strictEqual(typeof internals.verifyOutlineMergeCorrespondence, 'function', 'missing squash correspondence validator');
  const fixture = createOutlineFixture();
  try {
    const completed = fixture.finishDraft();
    const draftBlob = fixtureGit(fixture.root, ['rev-parse', `${completed.draftCommit}:${fixture.target}`]);
    fs.writeFileSync(path.join(fixture.root, 'merge-marker.txt'), 'squash metadata');
    fixtureGit(fixture.root, ['add', '-A']);
    fixtureGit(fixture.root, ['commit', '-q', '-m', 'identical squash target']);
    const mergedCommit = fixtureGit(fixture.root, ['rev-parse', 'HEAD']);
    const identical = internals.verifyOutlineMergeCorrespondence({
      root: fixture.root, outlineCommit: fixture.outlineCommit, draftCommit: completed.draftCommit,
      mergedCommit, targetPaths: [fixture.target], record: { outlineCommit: fixture.outlineCommit,
        draftCommit: completed.draftCommit, mergedCommit, targetBlobs: { [fixture.target]: { draft: draftBlob, merged: draftBlob } } },
    });
    assert.strictEqual(identical.state, 'accepted');
    fs.writeFileSync(path.join(fixture.root, fixture.target), 'changed during merge');
    fixtureGit(fixture.root, ['add', '-A']);
    fixtureGit(fixture.root, ['commit', '-q', '-m', 'changed squash target']);
    const changedMerge = fixtureGit(fixture.root, ['rev-parse', 'HEAD']);
    const changedBlob = fixtureGit(fixture.root, ['rev-parse', `${changedMerge}:${fixture.target}`]);
    const changed = internals.verifyOutlineMergeCorrespondence({
      root: fixture.root, outlineCommit: fixture.outlineCommit, draftCommit: completed.draftCommit,
      mergedCommit: changedMerge, targetPaths: [fixture.target], record: { outlineCommit: fixture.outlineCommit,
        draftCommit: completed.draftCommit, mergedCommit: changedMerge,
        targetBlobs: { [fixture.target]: { draft: draftBlob, merged: changedBlob } } },
    });
    assert.strictEqual(changed.state, 'changed', 'changed final bytes do not inherit the old final review');
    const missing = internals.verifyOutlineMergeCorrespondence({ root: fixture.root,
      outlineCommit: fixture.outlineCommit, draftCommit: completed.draftCommit, mergedCommit,
      targetPaths: [fixture.target], record: null });
    assert.strictEqual(missing.state, 'unresolved');
  } finally { fixture.cleanup(); }
});

test('overwriting a dispatched predecessor handoff invalidates the retained attempt chain', () => {
  assert.strictEqual(typeof internals.resolveOutlineAttempt, 'function');
  const fixture = createOutlineFixture();
  try {
    const secondId = 'attempt-2';
    const secondDir = path.join(fixture.sessionDir, 'doc-reconciliation/outline-confirmation', fixture.taskId, 'attempts', secondId);
    fs.mkdirSync(secondDir, { recursive: true });
    const lease = { schema: 'harness.outline-writer-lease.v1', id: 'lease-2', taskId: fixture.taskId,
      attemptId: secondId, principalId: fixture.sessionId, root: fixture.root, exclusive: true, active: true };
    writeJson(path.join(secondDir, 'writer-lease.json'), lease);
    const second = { ...fixture.handoff, attemptId: secondId, handoffId: 'handoff-2',
      supersedesAttemptId: fixture.attemptId, draftDispatchToken: 'token-2', writerLeaseId: lease.id,
      writerLeaseDigest: sha(fs.readFileSync(path.join(secondDir, 'writer-lease.json'))) };
    writeJson(path.join(secondDir, 'handoff.json'), second);
    assert.strictEqual(internals.resolveOutlineAttempt({ sessionDir: fixture.sessionDir,
      taskId: fixture.taskId, attemptId: secondId }).state, 'accepted');
    const predecessorFile = path.join(fixture.attemptDir, 'handoff.json');
    fs.rmSync(path.join(fixture.attemptDir, 'tokens'), { recursive: true, force: true });
    fs.rmSync(path.join(fixture.attemptDir, 'seams'), { recursive: true, force: true });
    const overwritten = JSON.parse(fs.readFileSync(predecessorFile, 'utf8'));
    overwritten.handoffId = 'hand-off-overwritten-after-dispatch';
    writeJson(predecessorFile, overwritten);
    assert.strictEqual(internals.resolveOutlineAttempt({ sessionDir: fixture.sessionDir,
      taskId: fixture.taskId, attemptId: secondId }).state, 'unresolved',
    'the retained handoff seal still detects overwrites after token/seam files are removed');
  } finally { fixture.cleanup(); }
});

test('real capture→provider→adapter→checker→pilot discovers one outline event without injected refs', () => {
  const fixture = createOutlineFixture({ realHook: true });
  try {
    const completed = fixture.finishDraft({ finalReview: true, runPilot: true });
    const report = completed.pilot?.report;
    assert.ok(report, 'pilot produced its runtime report');
    assert.strictEqual(report.outlineEvidence?.outcome, 'pass', JSON.stringify(report));
    assert.ok(report.acceptedRefs.some(ref => ref.endsWith('#outline-confirmation')),
      'pilot discovered the pre-tool capture reference itself');
    assert.ok(report.acceptedRefs.some(ref => ref.endsWith('#quality-review')),
      'the existing final exact-D quality-review lane remains independently discoverable');
    assert.strictEqual(report.pilotCredit, false, 'other B→D MUSTs remain independently unsatisfied');
  } finally { fixture.cleanup(); }
});

test('pilot compares the current Git root with an aliased pinned baseline root', () => {
  const fixture = createOutlineFixture({ realHook: true });
  try {
    const baselineRoot = `${fixture.root}${path.sep}..${path.sep}${path.basename(fixture.root)}`;
    const completed = fixture.finishDraft({ finalReview: true, runPilot: true, baselineRoot });
    assert.strictEqual(completed.pilot.report.outlineEvidence?.outcome, 'pass', JSON.stringify(completed.pilot.report));
    assert.ok(!completed.pilot.report.diagnostics.some(item => item.code === 'baseline-unavailable'),
      'equivalent root spellings do not make the baseline unavailable');
  } finally { fixture.cleanup(); }
});

test('scope-preserving D edits keep outline approval but stale final review cannot transfer to new bytes', () => {
  const fixture = createOutlineFixture({ realHook: true });
  try {
    const completed = fixture.finishDraft({ finalReview: true, mutateAfterFinalReview: true, runPilot: true });
    const report = completed.pilot.report;
    assert.strictEqual(report.outlineEvidence?.outcome, 'pass');
    assert.ok(report.acceptedRefs.some(ref => ref.endsWith('#outline-confirmation')));
    assert.ok(!report.acceptedRefs.some(ref => ref.endsWith('#quality-review')),
      'the prior review digest does not bind changed final D bytes');
    assert.strictEqual(report.pilotCredit, false);
  } finally { fixture.cleanup(); }
});

test('legacy session-dir keying stays aligned through an aliased workspace root', () => {
  function driveAliasRootScenario() {
    const realRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'prb-session-root-'));
    const aliasRoot = `${realRoot}-alias`;
    const stateHome = fs.mkdtempSync(path.join(os.tmpdir(), 'prb-session-state-'));
    const sessionId = 'prb-alias-session';
    const preload = path.join(stateHome, 'realpath-alias.js');
    fs.symlinkSync(realRoot, aliasRoot, 'dir');
    writeJson(path.join(stateHome, 'session-workspaces', `${sha(sessionId)}.json`), {
      version: 1, sessionId, workspaceRoot: aliasRoot,
    });
    fs.writeFileSync(preload, [
      "const fs=require('fs');",
      "const path=require('path');",
      'const original=fs.realpathSync;',
      'const alias=path.resolve(process.env.PRB_TEST_ALIAS_ROOT);',
      'function realpathSync(target,...args){',
      '  if(typeof target==="string"&&path.resolve(target)===alias)return alias;',
      '  return original.call(fs,target,...args);',
      '}',
      'realpathSync.native=original.native;',
      'fs.realpathSync=realpathSync;',
    ].join('\n'));

    const previousStateHome = process.env.HARNESS_STATE_HOME;
    const originalRealpathSync = fs.realpathSync;
    let aliasSessionDir;
    let canonicalSessionDir;
    try {
      process.env.HARNESS_STATE_HOME = stateHome;
      fs.realpathSync = function realpathSync(target, ...args) {
        if (typeof target === 'string' && path.resolve(target) === path.resolve(aliasRoot)) return path.resolve(aliasRoot);
        return originalRealpathSync.call(fs, target, ...args);
      };
      fs.realpathSync.native = originalRealpathSync.native;
      const { getSessionDir } = require(path.join(ROOT, 'hooks/scripts/lib/harness-state.js'));
      aliasSessionDir = getSessionDir(aliasRoot, sessionId);
      canonicalSessionDir = getSessionDir(realRoot, sessionId);
    } finally {
      fs.realpathSync = originalRealpathSync;
      if (previousStateHome === undefined) delete process.env.HARNESS_STATE_HOME;
      else process.env.HARNESS_STATE_HOME = previousStateHome;
    }

    const env = {
      ...process.env,
      HARNESS_STATE_HOME: stateHome,
      HARNESS_WORKSPACE_ROOT: aliasRoot,
      HARNESS_DOC_RECONCILIATION_PILOT: '0',
      PRB_TEST_ALIAS_ROOT: aliasRoot,
    };
    const runHook = (relative, payload, pilotEnabled = false) => spawnSync(process.execPath,
      ['--require', preload, path.join(ROOT, relative)], {
        cwd: aliasRoot,
        input: JSON.stringify(payload),
        encoding: 'utf8',
        env: { ...env, HARNESS_DOC_RECONCILIATION_PILOT: pilotEnabled ? '1' : '0' },
      });

    try {
      const legacy = runHook('hooks/scripts/state-persist.js', {
        hook_event_name: 'PostToolUse', session_id: sessionId, cwd: aliasRoot,
        tool_name: 'Bash', tool_input: { command: 'echo legacy-state-probe' },
        tool_response: { exitCode: 0, stdout: '', stderr: '' },
      });
      const pilotOffCaptureCount = provider.readCaptureView(aliasSessionDir).records.length
        + provider.readCaptureView(canonicalSessionDir).records.length;
      const pilot = runHook('hooks/scripts/state-persist.js', {
        hook_event_name: 'PreToolUse', session_id: sessionId, cwd: aliasRoot,
        tool_name: 'Agent', tool_use_id: 'pilot-alias-capture', agent_type: 'worker',
        tool_input: { prompt: 'alias capture probe' },
      }, true);
      writeJson(path.join(aliasSessionDir, 'rule-of-3-state.json'), {
        count: 3, threshold: 3, lastHash: 'alias-keying-control', lastFailureAt: 0,
      });
      const breaker = runHook('hooks/scripts/rule-of-3.js', {
        hook_event_name: 'PreToolUse', session_id: sessionId, cwd: aliasRoot,
        tool_name: 'apply_patch', tool_input: { patch: '*** Update File: unrelated.txt\n@@\n-old\n+new\n' },
      });
      assert.strictEqual(legacy.status, 0, `pilot-OFF state-persist must remain fail-open: ${legacy.stderr}`);
      assert.strictEqual(pilot.status, 0, `pilot capture must remain fail-open: ${pilot.stderr}`);
      assert.strictEqual(breaker.status, 2, `rule-of-3 must find the tripped alias session: ${breaker.stderr}`);
      assert.match(breaker.stderr, /RULE OF 3 CIRCUIT BREAKER TRIGGERED/);
      console.log('PASS rule-of-3 alias-root positive control blocks at exit 2');
      return {
        legacyExit: legacy.status,
        pilotOffCaptureCount,
        handoffInAliasSession: fs.existsSync(path.join(aliasSessionDir, 'handoff-state.json')),
        handoffInCanonicalSession: fs.existsSync(path.join(canonicalSessionDir, 'handoff-state.json')),
        pilotCaptureInAliasSession: provider.readCaptureView(aliasSessionDir).records.some(item => item.tool_use_id === 'pilot-alias-capture'),
        pilotCaptureInCanonicalSession: provider.readCaptureView(canonicalSessionDir).records.some(item => item.tool_use_id === 'pilot-alias-capture'),
        breakerExit: breaker.status,
      };
    } finally {
      fs.rmSync(stateHome, { recursive: true, force: true });
      fs.rmSync(aliasRoot, { force: true });
      fs.rmSync(realRoot, { recursive: true, force: true });
    }
  }

  const first = driveAliasRootScenario();
  const second = driveAliasRootScenario();
  assert.deepStrictEqual(first, second, 'identical alias-root inputs must produce the same normalized state and exits');
  assert.strictEqual(first.legacyExit, 0, 'pilot OFF remains fail-open');
  assert.strictEqual(first.pilotOffCaptureCount, 0, 'pilot OFF writes no capture record');
  assert.strictEqual(first.breakerExit, 2, 'the aliased rule-of-3 positive control blocks');
  assert.deepStrictEqual({
    handoffInAliasSession: first.handoffInAliasSession,
    handoffInCanonicalSession: first.handoffInCanonicalSession,
    pilotCaptureInAliasSession: first.pilotCaptureInAliasSession,
    pilotCaptureInCanonicalSession: first.pilotCaptureInCanonicalSession,
  }, {
    handoffInAliasSession: true,
    handoffInCanonicalSession: false,
    pilotCaptureInAliasSession: true,
    pilotCaptureInCanonicalSession: false,
  }, `legacy handoff and pilot capture must stay in rule-of-3's original session directory: ${JSON.stringify(first)}`);
});

test('no final D stays incomplete and hand-authored JSON without a host seam earns no outline credit', () => {
  const noDraft = createOutlineFixture({ realHook: true });
  try {
    const result = noDraft.finishDraft({ draft: false, runPilot: true });
    assert.strictEqual(result.pilot.report.outlineEvidence?.observation, 'unresolved');
    assert.strictEqual(result.pilot.report.outlineEvidence?.outcome, 'none');
  } finally { noDraft.cleanup(); }

  const forged = createOutlineFixture();
  try {
    const result = forged.finishDraft({ handAuthoredCapture: true, removeSeam: true, runPilot: true });
    assert.notStrictEqual(result.pilot.report.outlineEvidence?.outcome, 'pass',
      'candidate-authored JSON and a missing host seam are unresolved');
    const opencode = provider.createOpencodeOriginProvider({ hostId: 'opencode', sessionId: forged.sessionId });
    assert.notStrictEqual(opencode.resolveEvent({ reference: 'fake#outline-confirmation' }).status, 'accepted',
      'OpenCode remains unsupported for positive outline credit');
  } finally { forged.cleanup(); }
});

if (failures.length) {
  console.error(`\n${failures.length} PR-B RED assertion(s) failed.`);
  process.exitCode = 1;
} else {
  console.log('\nAll PR-B outline mechanism checks passed.');
}
