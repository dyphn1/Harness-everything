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
    const result = run();
    if (result && typeof result.unchecked === 'string') {
      console.log(`UNCHECKED ${name}: ${result.unchecked}`);
      return;
    }
    console.log(`PASS ${name}`);
  } catch (error) {
    failures.push(name);
    console.error(`FAIL ${name}: ${error.message}`);
  }
}

function symlinkUnavailable(type) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'prb-symlink-probe-'));
  try {
    const target = path.join(directory, 'target');
    if (type === 'dir') fs.mkdirSync(target);
    else fs.writeFileSync(target, '');
    fs.symlinkSync(target, path.join(directory, 'link'), type);
    return null;
  } catch (error) {
    if (['EPERM', 'EACCES', 'ENOSYS', 'ENOTSUP', 'EOPNOTSUPP'].includes(error.code)) return error.code;
    throw error;
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
}

function symlinkCitationPrecondition(linkText, expectedText, target, parse = internals.parseOutlineCitation) {
  if (linkText !== expectedText) {
    return { unchecked: `symlink text differs from fixture citation bytes: expected ${JSON.stringify(expectedText)}, actual ${JSON.stringify(linkText)}` };
  }
  assert.strictEqual(parse(Buffer.from(linkText), target).state, 'accepted',
    'citation-looking symlink link text must remain a positive control');
  return null;
}

test('explicitly unchecked controls do not also report PASS', () => {
  const output = [];
  const log = console.log;
  try {
    console.log = message => output.push(message);
    test('fixture precondition', () => ({ unchecked: 'EPERM' }));
  } finally { console.log = log; }
  assert.deepStrictEqual(output, ['UNCHECKED fixture precondition: EPERM']);
});

test('matching symlink citation bytes fail closed when the parser rejects them', () => {
  const expectedText = outlineText();
  assert.throws(() => symlinkCitationPrecondition(expectedText, expectedText, 'docs/adr/DOCS-001.md', () => ({ state: 'unresolved' })),
    /citation-looking symlink link text must remain a positive control/);
});

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

function outlineText({ id = null, complete = false, decisionPlaceholder = false, duplicateDecision = false, titledDecision = false,
  indentedDecision = false,
  rowId = '20', target = 'docs/adr/DOCS-001.md', domain = 'DOCS' } = {}) {
  const decision = complete ? '\n## Decision\nThis is already a complete drafted decision.\n'
    : duplicateDecision ? '\n## Decision\n- TBD\n\n## Decision\nThis second Decision section contains substantive text.\n'
      : titledDecision ? '\n## Decision — Final choice\nThis titled section contains a complete decision.\n'
        : indentedDecision ? '\n   ## Decision — Indented final choice\nThis indented section contains substantive text.\n'
      : decisionPlaceholder ? '\n## Decision\n- TBD\n' : '';
  return `---\nid: ${id || `${domain}-001`}\nstatus: proposed\n---\n\nInventory row: ${rowId}\nTarget: ${target}\nDomain: ${domain}\n\n## Outline\n- Context: TBD\n- Decision: TBD\n${decision}`;
}

function createOutlineFixture(options = {}) {
  const generatedRoot = fs.mkdtempSync(path.join(options.rootDirectory || os.tmpdir(), 'prb-outline-fixture-'));
  const root = options.preserveRootSpelling ? generatedRoot : canonical(generatedRoot);
  const runtimeBase = options.runtimeLayout === 'packaged' ? path.join(ROOT, 'plugins/harness-everything') : ROOT;
  const runtimeProvider = require(path.join(runtimeBase, 'hooks/scripts/lib/doc-reconciliation-provider.js'));
  const runtimePilot = require(path.join(runtimeBase, 'hooks/scripts/lib/doc-reconciliation-pilot.js'));
  const workspaceRoot = canonical(root);
  const retainedInventory = options.retainedInventory === true;
  const target = options.target || (retainedInventory ? 'docs/adr/EVID-001.md' : 'docs/adr/DOCS-001.md');
  const rowId = options.rowId || (retainedInventory ? '17' : '20');
  const domain = options.domain || (retainedInventory ? 'EVID' : 'DOCS');
  let taskId = options.taskId || 'task-prb';
  let attemptId = options.attemptId || 'attempt-1';
  const sessionId = options.sessionId || 'author-session';
  const stateHome = fs.mkdtempSync(path.join(os.tmpdir(), 'prb-outline-state-'));
  const workerRoot = options.workerRootAlias
    ? `${root}${path.sep}..${path.sep}${path.basename(root)}` : root;
  let workflowId = 'workflow-prb';
  let workflowRevision = 2;
  const configValue = options.w6Producer
    ? { governed: [{ path: 'docs/adr/*.md', role: 'adr' }], domains: ['EVID'],
      derived: [{ path: 'docs/governed-index.md', generator: 'node harness-everything/scripts/doc-lifecycle.js index --workspace . --config .agents/harness-everything/project-docs.json --all' }] }
    : { governed: [{ path: options.governedPattern || 'docs/adr/*.md', role: 'adr' }], domains: [domain], derived: [] };
  const config = JSON.stringify(configValue, null, 2) + '\n';
  let configDigest = sha(config);
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
  fs.mkdirSync(path.join(root, '.agents/harness-everything'), { recursive: true });
  fs.mkdirSync(path.dirname(path.join(root, target)), { recursive: true });
  fs.writeFileSync(path.join(root, '.agents/harness-everything/project-docs.json'), config);
  if (options.w6Producer) {
    const taskScripts = path.join(root, 'harness-everything/scripts');
    fs.mkdirSync(taskScripts, { recursive: true });
    for (const name of ['doc-lifecycle.js', 'project-docs-resolver.js']) {
      fs.copyFileSync(path.join(ROOT, 'harness-everything/scripts', name), path.join(taskScripts, name));
    }
    const generated = spawnSync(process.execPath, [path.join(taskScripts, 'doc-lifecycle.js'), 'index', '--workspace', root,
      '--config', '.agents/harness-everything/project-docs.json', '--all'], { cwd: root, encoding: 'utf8' });
    assert.strictEqual(generated.status, 0, `row-17 baseline index generation: ${generated.stderr || generated.stdout}`);
    fs.writeFileSync(path.join(root, 'docs/governed-index.md'), generated.stdout);
  }
  if (options.targetExistsAtB) fs.writeFileSync(path.join(root, target),
    `---\nid: DOCS-001\nstatus: proposed\n---\n\n## Decision\nAn existing B document.\n`);
  if (options.unrelatedFileAtB) fs.writeFileSync(path.join(root, options.unrelatedFileAtB), 'unmodified at B\n');
  fixtureGit(root, ['init', '-q']);
  fixtureGit(root, ['add', '-A']);
  fixtureGit(root, ['commit', '-q', '-m', 'B baseline']);
  const baselineCommit = fixtureGit(root, ['rev-parse', 'HEAD']);
  const baselineTree = fixtureGit(root, ['rev-parse', 'HEAD^{tree}']);
  if (options.unrelatedFileAtB) fs.writeFileSync(path.join(root, options.unrelatedFileAtB), 'modified after B\n');
  let sessionDir = path.join(stateHome, 'session');
  if (options.realHook) {
    const priorStateHome = process.env.HARNESS_STATE_HOME;
    process.env.HARNESS_STATE_HOME = stateHome;
    try {
      // Model SessionStart: hook state follows the established root while later payload cwd may keep its alias spelling.
      const workspace = require(path.join(ROOT, 'scripts/lib/workspace.js'));
      writeJson(path.join(stateHome, 'session-workspaces', `${sha(sessionId)}.json`), {
        version: 1, sessionId, workspaceRoot, workspaceKey: workspace.getWorkspaceKey(workspaceRoot),
      });
      sessionDir = require(path.join(ROOT, 'hooks/scripts/lib/harness-state.js')).getSessionDir(workspaceRoot, sessionId);
    }
    finally { if (priorStateHome === undefined) delete process.env.HARNESS_STATE_HOME; else process.env.HARNESS_STATE_HOME = priorStateHome; }
  }

  const workspaceId = 'ws-' + internals.digestText(internals.captureJson({ workspaceRoot: canonical(root) }));
  let taskBinding = null;
  const workflowOperationWitnesses = [];
  if (options.workflowCli) {
    const env = { ...process.env, HARNESS_STATE_HOME: stateHome, HARNESS_WORKSPACE_ROOT: root,
      HARNESS_DOC_RECONCILIATION_PILOT: '1' };
    const kernelRelative = runtimeBase === ROOT ? 'harness-everything/scripts/kernel-router.js' : 'skills/harness-everything/scripts/kernel-router.js';
    const kernel = spawnSync(process.execPath, [path.join(runtimeBase, kernelRelative)], {
      cwd: root, env, encoding: 'utf8', input: JSON.stringify({ session_id: sessionId, cwd: root,
        prompt: 'Draft the row-17 EVID-001 verification-evidence ADR from an outline, generate the governed index, and verify both.' }),
    });
    assert.strictEqual(kernel.status, 0, `row-17 plan fixture route: ${kernel.stderr || kernel.stdout}`);
  } else {
    const requirementIds = ['prb'];
    taskBinding = { schema: 'harness.doc-reconciliation-task-pin.v1', taskId, requirementIds,
      requirementDigest: sha(JSON.stringify(requirementIds)), baselineCommit, baselineRoot: root,
      configDigest, sessionId, workflowId, workspaceId };
    writeJson(path.join(sessionDir, 'workflow-run.json'), {
      workflowId, revision: workflowRevision, docReconciliationBaseline: { root, commit: baselineCommit, tree: baselineTree },
      docReconciliationTask: taskBinding,
    });
  }

  let hookPreloader = null;
  const hookDiagnostics = [];
  function actualCaptureSessionDirs() {
    const workspacesDir = path.join(stateHome, 'workspaces');
    try {
      return fs.readdirSync(workspacesDir).flatMap(workspaceKey => {
        const sessionsDir = path.join(workspacesDir, workspaceKey, 'state', 'sessions');
        try {
          return fs.readdirSync(sessionsDir).map(session => path.join(sessionsDir, session))
            .filter(dir => fs.readdirSync(path.join(dir, 'doc-reconciliation-capture'))
              .some(name => /^\d{8}\.json$/.test(name)));
        } catch { return []; }
      });
    } catch { return []; }
  }
  function capturedRecordsAcrossSessions() {
    return actualCaptureSessionDirs().flatMap(dir => runtimeProvider.readCaptureView(dir).records);
  }
  function logReviewHookDiagnostics() {
    console.error('REVIEW-HOOK-CAPTURE-DIAGNOSTICS ' + JSON.stringify({
      expectedSessionDir: sessionDir,
      writtenSessionDirs: actualCaptureSessionDirs(),
      hooks: hookDiagnostics.filter(item => item.agentType === 'reviewer' || item.toolUseId === 'review-dispatch'),
    }));
  }
  function runHook(payload, pilotEnabled = true, usePreload = true) {
    if (!options.realHook) throw new Error('real state-persist capture was not enabled for this fixture');
    if (usePreload && !hookPreloader) {
      hookPreloader = path.join(stateHome, 'outline-test-preload.js');
      const providerPath = path.join(runtimeBase, 'hooks/scripts/lib/doc-reconciliation-provider.js');
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
    const child = spawnSync(process.execPath, [...(usePreload ? ['--require', hookPreloader] : []), path.join(runtimeBase, 'hooks/scripts/state-persist.js')], {
      cwd: root, encoding: 'utf8', input: JSON.stringify(payload),
      env: { ...process.env, HARNESS_STATE_HOME: stateHome, HARNESS_WORKSPACE_ROOT: root,
        HARNESS_DOC_RECONCILIATION_PILOT: pilotEnabled ? '1' : '0' },
    });
    hookDiagnostics.push({
      event: payload.hook_event_name,
      toolUseId: payload.tool_use_id || null,
      agentId: payload.agent_id || null,
      agentType: payload.agent_type || null,
      exitCode: child.status,
      stderr: child.stderr || '',
    });
    if (child.status !== 0) {
      if (payload.agent_type === 'reviewer' || payload.tool_use_id === 'review-dispatch') logReviewHookDiagnostics();
      throw new Error(`state-persist failed open contract: ${child.stderr || child.stdout || child.status}`);
    }
    return runtimeProvider.readCaptureView(sessionDir).records;
  }

  function runWorkflowOperation(name, args, allowFailure = false) {
    const controller = path.join(runtimeBase, 'hooks/scripts/workflow-disposition.js');
    const handoffStateFile = path.join(sessionDir, 'handoff-state.json');
    const beforeHandoffState = fs.existsSync(handoffStateFile) ? JSON.parse(fs.readFileSync(handoffStateFile, 'utf8')) : null;
    const toolUseId = `w6-${name}-${sessionId}`;
    const command = `node "${controller}" ${args.map(value => /[\s'"\\]/.test(value)
      ? `'${value.replace(/'/g, "'\\''")}'` : value).join(' ')}`;
    const payload = { session_id: sessionId, cwd: root, hook_event_name: 'PreToolUse', tool_name: 'Bash',
      tool_use_id: toolUseId, tool_input: { command } };
    runHook(payload);
    const child = spawnSync(process.execPath, [controller, ...args], { cwd: root,
      env: { ...process.env, HARNESS_STATE_HOME: stateHome, HARNESS_WORKSPACE_ROOT: root,
        HARNESS_DOC_RECONCILIATION_PILOT: '1' }, encoding: 'utf8' });
    if (child.status !== 0 && allowFailure && name === 'step-verify') {
      runHook({ ...payload, hook_event_name: 'PostToolUseFailure', is_interrupt: false,
        error: child.stderr || child.stdout || `exit ${child.status}`, tool_response: { exitCode: child.status } });
      const afterHandoffState = fs.existsSync(handoffStateFile) ? JSON.parse(fs.readFileSync(handoffStateFile, 'utf8')) : null;
      workflowOperationWitnesses.push({ name, before: beforeHandoffState, after: afterHandoffState, exitCode: child.status });
      return child.stdout;
    }
    assert.strictEqual(child.status, 0, `row-17 ${name}: ${child.stderr || child.stdout}`);
    runHook({ ...payload, hook_event_name: 'PostToolUse',
      tool_response: { exitCode: child.status, stdout: child.stdout, stderr: child.stderr, interrupted: false, status: 'completed' } });
    const afterHandoffState = fs.existsSync(handoffStateFile) ? JSON.parse(fs.readFileSync(handoffStateFile, 'utf8')) : null;
    workflowOperationWitnesses.push({ name, before: beforeHandoffState, after: afterHandoffState });
    return child.stdout;
  }

  if (options.workflowCli) {
    const requirements = [
      { id: 'adr-evid', stepType: 'doc-change', summary: 'Draft the row-17 EVID-001 verification-evidence ADR.',
        acceptance: 'A real proposed O is independently reviewed before the draft D; D is a strict descendant of O and changes only the ADR.' },
      { id: 'verify-row17', stepType: 'verification',
        summary: 'Generate the governed index and verify the final ADR through one combined registered check and independent review.',
        acceptance: 'All four combined-check capabilities and the ADR-only final review are captured before normal Stop reconciliation.' },
    ];
    const operations = [
      ['plan', ['plan', '--session-id', sessionId, '--strategy', 'iterative-single', '--requirements-json', JSON.stringify(requirements),
        '--evidence', 'row17 baseline witness']],
      ['start', ['start', '--session-id', sessionId]],
    ];
    for (const [name, args] of operations) {
      runWorkflowOperation(name, args);
    }
    const workflow = JSON.parse(fs.readFileSync(path.join(sessionDir, 'workflow-run.json'), 'utf8'));
    workflowId = workflow.workflowId;
    workflowRevision = workflow.revision;
    taskBinding = workflow.docReconciliationTask;
    taskId = taskBinding.taskId;
    configDigest = taskBinding.configDigest;
    assert.deepStrictEqual(taskBinding.requirementIds, ['adr-evid', 'verify-row17'], 'plan/start must create the declared row-17 task pin');
  }

  function runW6Producer(operation) {
    const producer = path.join(runtimeBase, 'hooks/scripts/w6-state-operations.js');
    const toolUseId = `w6-${operation}-${sessionId}`;
    const command = `node "${producer}" ${operation} --session-id "${sessionId}"`;
    const payload = { session_id: sessionId, cwd: root, hook_event_name: 'PreToolUse', tool_name: 'Bash',
      tool_use_id: toolUseId, tool_input: { command } };
    runHook(payload);
    const child = spawnSync(process.execPath, [producer, operation, '--session-id', sessionId], { cwd: root,
      env: { ...process.env, HARNESS_STATE_HOME: stateHome, HARNESS_WORKSPACE_ROOT: root,
        HARNESS_DOC_RECONCILIATION_PILOT: '1' }, encoding: 'utf8' });
    if (child.status !== 0) {
      runHook({ ...payload, hook_event_name: 'PostToolUseFailure', is_interrupt: false,
        error: child.stderr || child.stdout || `exit ${child.status}`, tool_response: { exitCode: child.status } });
      if (options.w6ExpectedProducerFailure) return { error: child.stderr || child.stdout || `exit ${child.status}`, exitCode: child.status };
      throw new Error(`row-17 ${operation} producer: ${child.stderr || child.stdout}`);
    }
    if (operation === 'inventory' && options.w6ProducerFault === 'extra-state-destination') {
      writeJson(path.join(sessionDir, 'unauthorized-state-change.json'), { operation: 'inventory' });
    }
    const post = { ...payload, hook_event_name: 'PostToolUse',
      tool_response: { exitCode: child.status, stdout: child.stdout, stderr: child.stderr, interrupted: false, status: 'completed' } };
    if (!(operation === 'inventory' && options.w6ProducerFault === 'missing-post')) runHook(post);
    if (operation === 'inventory' && options.w6ProducerFault === 'duplicate-post') runHook(post);
    return JSON.parse(child.stdout);
  }

  function runWorkerCommand(toolName, toolUseId, toolInput, command, execute) {
    const payload = { session_id: sessionId, cwd: root, hook_event_name: 'PreToolUse', tool_name: toolName,
      tool_use_id: toolUseId, agent_id: 'draft-worker', agent_type: 'worker', tool_input: toolInput };
    runHook(payload);
    const result = execute();
    runHook({ ...payload, hook_event_name: 'PostToolUse', tool_response: {
      exitCode: result.exitCode ?? 0, stdout: result.stdout || '', stderr: result.stderr || '', interrupted: false, status: 'completed',
    } });
    return result;
  }

  function runReviewCapture(payload) {
    runHook(payload);
  }
  let inventoryOperation = null;
  let outsideInventoryPath = null;
  if (options.w6ProducerFault === 'inventory-symlink') {
    const inventoryParent = path.join(sessionDir, 'doc-reconciliation/outline-confirmation');
    fs.mkdirSync(inventoryParent, { recursive: true });
    outsideInventoryPath = path.join(stateHome, 'outside-inventory', 'unexpected.md');
    fs.mkdirSync(path.dirname(outsideInventoryPath), { recursive: true });
    fs.symlinkSync(path.dirname(outsideInventoryPath), path.join(inventoryParent, 'inventory'), 'dir');
  }
  if (options.w6Producer) inventoryOperation = runW6Producer('inventory');

  const outlineBytes = Buffer.from(outlineText({
    id: options.targetId,
    complete: options.completeOutline === true,
    decisionPlaceholder: options.decisionPlaceholder === true,
    duplicateDecision: options.duplicateDecision === true,
    indentedDecision: options.indentedDecision === true,
    rowId, target, domain,
  }));
  let preOutlineOperation = null;
  if (options.preOutlineOperation) {
    if (!options.realHook) throw new Error('pre-outline operation requires the real state-persist hook');
    const operation = options.preOutlineOperation;
    const toolUseId = 'pre-outline-' + operation + '-' + sessionId;
    const payload = operation === 'write'
      ? { session_id: sessionId, cwd: root, hook_event_name: 'PreToolUse', tool_name: 'Write', tool_use_id: toolUseId,
        tool_input: { file_path: path.join(root, target), content: outlineBytes.toString('utf8') } }
      : { session_id: sessionId, cwd: root, hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_use_id: toolUseId,
        tool_input: { command: 'git status --porcelain' } };
    const preRecords = runHook(payload, true, false);
    let output = '';
    if (operation === 'write') fs.writeFileSync(path.join(root, target), outlineBytes);
    else output = execFileSync('git', ['status', '--porcelain'], { cwd: root, encoding: 'utf8' });
    const postPayload = { ...payload, hook_event_name: 'PostToolUse', tool_response: { exitCode: 0, stdout: output } };
    runHook(postPayload, true, false);
    const records = runtimeProvider.readCaptureView(sessionDir).records;
    const pre = preRecords.find(item => item.event === 'PreToolUse' && item.tool_use_id === toolUseId);
    const post = records.find(item => item.event === 'PostToolUse' && item.tool_use_id === toolUseId);
    assert.ok(pre && post, operation + ' operation has real PreToolUse and successful PostToolUse captures');
    preOutlineOperation = { operation, toolUseId, command: operation === 'status' ? 'git status --porcelain' : null,
      output, preRef: pre.ref, postRef: post.ref };
  }

  if (!preOutlineOperation || preOutlineOperation.operation !== 'write') fs.writeFileSync(path.join(root, target), outlineBytes);
  if (options.symlinkOutlineObject) {
    fs.rmSync(path.join(root, target), { force: true });
    fs.symlinkSync(outlineBytes.toString('utf8'), path.join(root, target));
  }
  let capturedCommit = false;
  let indexAfterCapturedAdd = null;
  let indexAfterOutlineCommit = null;
  if (options.capturedOutlineCommit) {
    // The coordinator's own git add/commit run through the real hook, so the B→O commit is captured Bash evidence.
    if (!options.realHook || !preOutlineOperation || preOutlineOperation.operation !== 'write') {
      throw new Error('captured O commit requires the real hook and a captured pre-O write');
    }
    // extraOutlineFile is an uncaptured write staged into O: only the O commit scope check can reject it.
    if (options.extraOutlineFile) fs.writeFileSync(path.join(root, options.extraOutlineFile), 'uncaptured extra\n');
    const addArgs = options.capturedOutlineAddArgs || ['add', '--', target];
    const commitArgs = options.capturedOutlineCommitArgs || ['commit', '-m', 'O outline'];
    const addCommand = typeof options.capturedOutlineAddCommand === 'function'
      ? options.capturedOutlineAddCommand({ root, target }) : options.capturedOutlineAddCommand;
    const gitOperations = [
      ['add', addArgs, addCommand || `git add -- ${target}`],
      ['commit', commitArgs, options.capturedOutlineCommitCommand || 'git commit -m "O outline"'],
    ];
    for (const [name, args, command] of gitOperations) {
      const payload = { session_id: sessionId, cwd: root, hook_event_name: 'PreToolUse', tool_name: 'Bash',
        tool_use_id: `pre-outline-${name}-${sessionId}`, tool_input: { command } };
      runHook(payload, true, false);
      if (name === 'add' && options.extraOutlineFile) fixtureGit(root, ['add', '--', options.extraOutlineFile]);
      if (name === 'commit' && options.stagedUnrelatedWitness) fixtureGit(root, ['reset', '--', options.unrelatedFileAtB]);
      fixtureGit(root, args);
      if (name === 'add' && options.stagedUnrelatedWitness) {
        indexAfterCapturedAdd = fixtureGit(root, ['diff', '--cached', '--name-only']).split('\n').filter(Boolean).sort();
      }
      if (name === 'commit' && options.stagedUnrelatedWitness) {
        fixtureGit(root, ['add', '--', options.unrelatedFileAtB]);
        indexAfterOutlineCommit = fixtureGit(root, ['diff', '--cached', '--name-only']).split('\n').filter(Boolean).sort();
      }
      runHook({ ...payload, hook_event_name: 'PostToolUse', tool_response: { exitCode: 0, stdout: '' } }, true, false);
    }
    capturedCommit = true;
  }
  if (options.stagedUnrelatedWitness) fixtureGit(root, ['reset', '--hard', 'HEAD']);
  if (!capturedCommit) {
    // revertedExtraOutlineCommit: a non-target file committed inside B..O and removed before O. Only per-commit scope sees it.
    if (options.revertedExtraOutlineCommit) {
      const extra = options.revertedExtraOutlineCommit;
      fs.mkdirSync(path.dirname(path.join(root, extra)), { recursive: true });
      fs.writeFileSync(path.join(root, extra), 'scratch content\n');
      fixtureGit(root, ['add', '--', extra]);
      fixtureGit(root, ['commit', '-q', '-m', 'scratch in O range']);
      fs.rmSync(path.join(root, extra));
    }
    fixtureGit(root, ['add', '-A']);
    fixtureGit(root, ['commit', '-q', '-m', 'O outline']);
  }
  let outlineCommit = fixtureGit(root, ['rev-parse', 'HEAD']);
  let outlineTree = fixtureGit(root, ['rev-parse', 'HEAD^{tree}']);
  let outlineBlob = fixtureGit(root, ['rev-parse', `HEAD:${target}`]);

  const outlineRoot = path.join(sessionDir, 'doc-reconciliation/outline-confirmation');
  const inventoryDir = path.join(outlineRoot, 'inventory');
  if (!options.w6Producer || !inventoryOperation?.operation) {
    fs.rmSync(inventoryDir, { recursive: true, force: true });
    fs.mkdirSync(inventoryDir, { recursive: true });
    fs.writeFileSync(path.join(inventoryDir, `${pinDigest}.md`), inventoryBytes);
    writeJson(path.join(inventoryDir, 'inventory-pin.json'), expectedPin);
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
  // Negative-control injection points: each entry is a payload factory run through the real hook at that journal position.
  const interleave = options.interleave || {};
  const runInterleaved = list => { for (const make of list || []) runHook(make({ root, sessionId, target })); };
  const reviewerStartPayload = { session_id: sessionId, cwd: root, hook_event_name: 'SubagentStart',
    agent_id: reviewerPrincipal, agent_type: 'reviewer' };
  let reviewerStartRecord = null;
  if (options.realHook) {
    const restoreBeforeReview = options.beforeReviewSetup?.({ root, target });
    try { runInterleaved(interleave.beforeReview); }
    finally { if (typeof restoreBeforeReview === 'function') restoreBeforeReview(); }
    // The live host journals the reviewer's SubagentStart before its launch result (run8 sanitized capture).
    if (!options.omitReviewerStart) runHook(reviewerStartPayload);
    if (!options.omitReviewResult) runHook(reviewResultPayload);
    runInterleaved(interleave.duringReview);
    if (options.gitAfterReview) {
      // Uncaptured Git rewrite of O inside the review window (not journaled by the hook). The coordinator then
      // records the rewritten O in the handoff, so only the identity taken at reviewer start can reject it.
      if (options.gitAfterReview === 'amend') fixtureGit(root, ['commit', '--amend', '-q', '-m', 'O outline amended']);
      else if (options.gitAfterReview === 'addPath') {
        fs.writeFileSync(path.join(root, 'docs/adr/DOCS-002.md'), `---\nid: DOCS-002\nstatus: proposed\n---\n\n## Outline\n- Context: TBD\n`);
        fixtureGit(root, ['add', '--', 'docs/adr/DOCS-002.md']);
        fixtureGit(root, ['commit', '--amend', '-q', '-m', 'O outline with second target']);
      } else {
        fixtureGit(root, ['reset', '-q', '--soft', baselineCommit]);
        fixtureGit(root, ['commit', '-q', '-m', 'O outline replaced']);
      }
      outlineCommit = fixtureGit(root, ['rev-parse', 'HEAD']);
      outlineTree = fixtureGit(root, ['rev-parse', 'HEAD^{tree}']);
      outlineBlob = fixtureGit(root, ['rev-parse', `HEAD:${target}`]);
    }
    runHook(reviewStopPayload);
    const retained = runtimeProvider.readCaptureView(sessionDir).records;
    reviewResult = retained.find(item => item.event === 'PostToolUse' && item.tool_use_id === 'review-dispatch');
    reviewStop = retained.find(item => item.event === 'SubagentStop' && item.agent_id === reviewerPrincipal);
  } else {
    reviewResult = runtimeProvider.buildCaptureRecord(reviewResultPayload, 'PostToolUse', root);
    reviewStop = runtimeProvider.buildCaptureRecord(reviewStopPayload, 'SubagentStop', root);
    reviewResult.observedIdentity = { workflowId, workflowRevision, baselinePin: { root, commit: baselineCommit }, taskPin: taskBinding };
    reviewStop.observedIdentity = { workflowId, workflowRevision, baselinePin: { root, commit: baselineCommit }, taskPin: taskBinding };
    if (!options.omitReviewerStart) {
      reviewerStartRecord = runtimeProvider.buildCaptureRecord(reviewerStartPayload, 'SubagentStart', root);
      reviewerStartRecord.observedIdentity = reviewStop.observedIdentity;
      // Same identity capture the hook applies at SubagentStart (state-persist persistPilotCapture).
      reviewerStartRecord.outlineIdentity = runtimeProvider.captureOutlineStartIdentity({ sessionDir });
    }
  }
  if (!reviewStop || (!reviewResult && !options.omitReviewResult)) {
    if (options.realHook) logReviewHookDiagnostics();
    throw new Error('review hook captures were not retained');
  }
  const reviewRecordDigest = runtimeProvider._internals?.captureDigest
    ? runtimeProvider._internals.captureDigest(reviewStop)
    : sha(JSON.stringify(reviewStop));

  let attemptDir = path.join(outlineRoot, taskId, 'attempts', attemptId);
  let lease;
  let handoff;
  if (options.w6Producer) {
    const sealed = runW6Producer('seal');
    attemptId = sealed.attemptId;
    attemptDir = path.join(outlineRoot, taskId, 'attempts', attemptId);
    lease = JSON.parse(fs.readFileSync(path.join(attemptDir, 'writer-lease.json'), 'utf8'));
    handoff = JSON.parse(fs.readFileSync(path.join(attemptDir, 'handoff.json'), 'utf8'));
  } else {
    fs.mkdirSync(attemptDir, { recursive: true });
    lease = { schema: 'harness.outline-writer-lease.v1', id: 'lease-1', taskId, attemptId,
      principalId: sessionId, root: workerRoot, exclusive: true, active: true,
      ...(options.competingWriters ? { competingWriters: ['unknown-writer'] } : {}) };
    writeJson(path.join(attemptDir, 'writer-lease.json'), lease);
    const leaseDigest = sha(fs.readFileSync(path.join(attemptDir, 'writer-lease.json')));
    handoff = {
      schema: 'harness.outline-handoff.v1', handoffId: 'handoff-1', taskId, attemptId,
      supersedesAttemptId: options.supersedesAttemptId || null,
      workspaceId,
      workflowId, workflowRevision, sessionId, hostId: 'claude-code',
      baseline: { root, commit: baselineCommit, tree: baselineTree, configDigest },
      configDigest, targetPaths: [target], draftWorktreeRoot: workerRoot,
      outline: { commit: outlineCommit, tree: options.handoffTreeOverride ? 'f'.repeat(40) : outlineTree,
        targetBlobs: { [target]: { blobOid: outlineBlob, storedBytesSha256: sha(outlineBytes) } } },
      inventory: { ...expectedPin, rowId, domain, targetPaths: [target] },
      reviewCaptureRef: reviewStop.ref, reviewCaptureDigest: reviewRecordDigest, reviewDigest: reviewStop.reviewDigest,
      coordinatorPrincipal: sessionId, writerLeaseId: lease.id, writerLeaseDigest: leaseDigest,
      draftDispatchToken: options.token || 'token-1',
      ...(options.handoffOverrides || {}),
    };
    if (!options.omitHandoff) writeJson(path.join(attemptDir, 'handoff.json'), handoff);
  }
  const dispatchToken = options.token || (options.w6Producer ? handoff.draftDispatchToken : 'token-1');
  const marker = `HARNESS_OUTLINE_DISPATCH_V1 taskId=${taskId} attemptId=${attemptId} token=${dispatchToken} workerRoot=${options.markerRoot || workerRoot}`;

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
    runInterleaved(interleave.beforeDispatch);
    runHook(payload);
    const retained = runtimeProvider.readCaptureView(sessionDir).records;
    capture = retained.find(item => item.event === 'PreToolUse' && item.tool_use_id === payload.tool_use_id);
    reviewCaptures = retained.filter(item => item !== capture);
  } else {
    capture = runtimeProvider.buildCaptureRecord(payload, 'PreToolUse', root);
    capture.observedIdentity = { workflowId, workflowRevision, baselinePin: { root, commit: baselineCommit }, taskPin: taskBinding };
    reviewCaptures = options.omitReview ? [] : [...(reviewerStartRecord ? [reviewerStartRecord] : []), reviewResult, reviewStop];
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
    workerStart = runtimeProvider.readCaptureView(sessionDir).records.find(item => item.event === 'SubagentStart'
      && item.agent_id === workerStartPayload.agent_id);
  } else {
    workerStart = runtimeProvider.buildCaptureRecord(workerStartPayload, 'SubagentStart', root);
    workerStart.observedIdentity = capture.observedIdentity;
  }
  const extraCaptures = [];

  function dispatchAgain({ toolUseId = capture.tool_use_id, prompt = payload.tool_input.prompt } = {}) {
    const extraPayload = { ...payload, tool_use_id: toolUseId, tool_input: { prompt, run_in_background: false } };
    const extra = runtimeProvider.buildCaptureRecord(extraPayload, 'PreToolUse', root);
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

  function finishDraft({ draft = true, nonDescendant = false, finalReview = false, completeWorkflow = false,
    allowDispositionFailure = false, baselineRoot = root,
    omitWorkerStart = false, omitWorkerResult = false, omitWorkerStop = false, tamperHandoff = false,
    providerSessionId = sessionId, providerTaskId = taskId, providerBaseline = { root, commit: baselineCommit },
    runPilot = false, handAuthoredCapture = false, removeSeam = false, mutateAfterFinalReview = false,
    workerCompletionOrder = 'result-stop', workerResultAfterFinalReview = false, workerStopAfterFinalReview = false,
    finalReviewCompletionOrder = 'result-stop', finalReviewFailure = null, reviewLaunchBeforeWorkerClosure = false,
    postWorkerCaptures = [], afterWorkerStop = [] } = {}) {
    if (draft) {
      if (options.w6Producer) {
        const finalAdr = `---\nid: ${domain}-001\nstatus: proposed\n---\n\n# ${domain}-001\n\n## Decision\nFinal evidence decision for row ${rowId}.\n`;
        runWorkerCommand('Write', 'w6-draft-write', { file_path: path.join(root, target), content: finalAdr }, null, () => {
          fs.writeFileSync(path.join(root, target), finalAdr);
          return { exitCode: 0 };
        });
        const indexCommand = 'node harness-everything/scripts/doc-lifecycle.js index --workspace . --config .agents/harness-everything/project-docs.json --all > docs/governed-index.md';
        runWorkerCommand('Bash', 'w6-index-generate', { command: indexCommand }, indexCommand, () => {
          const generated = spawnSync(process.execPath, [path.join(root, 'harness-everything/scripts/doc-lifecycle.js'), 'index',
            '--workspace', root, '--config', '.agents/harness-everything/project-docs.json', '--all'], { cwd: root, encoding: 'utf8' });
          assert.strictEqual(generated.status, 0, `row-17 D index generation: ${generated.stderr || generated.stdout}`);
          fs.writeFileSync(path.join(root, 'docs/governed-index.md'), generated.stdout);
          return { exitCode: generated.status, stdout: '' };
        });
        const addCommand = `git add -- ${target} docs/governed-index.md`;
        runWorkerCommand('Bash', 'w6-index-stage', { command: addCommand }, addCommand, () => {
          fixtureGit(root, ['add', '--', target, 'docs/governed-index.md']);
          return { exitCode: 0 };
        });
        const commitCommand = 'git commit -m "draft EVID ADR and index"';
        runWorkerCommand('Bash', 'w6-index-commit', { command: commitCommand }, commitCommand, () => {
          fixtureGit(root, ['commit', '-q', '-m', 'draft EVID ADR and index']);
          return { exitCode: 0 };
        });
        const check = runtimeBase === ROOT ? path.join(runtimeBase, 'harness-everything/scripts/doc-check.js')
          : path.join(runtimeBase, 'skills/harness-everything/scripts/doc-check.js');
        const checkArgs = ['check', '--workspace', root, '--config', '.agents/harness-everything/project-docs.json',
          '--changed-path', target, '--base', baselineCommit, '--derived-view', 'docs/governed-index.md', '--conflict-assessment'];
        const checkCommand = `node ${shellWord(check)} ${checkArgs.map(value => shellWord(value)).join(' ')}`;
        const resolvedCheck = runtimeProvider.resolveDocCheckInvocation(checkCommand, root);
        assert.strictEqual(resolvedCheck.kind, 'accepted', `installed combined-check resolution: ${JSON.stringify({ checkCommand, resolvedCheck })}`);
        const checked = runWorkerCommand('Bash', 'w6-combined-check', { command: checkCommand }, checkCommand, () => {
          const result = spawnSync(process.execPath, [check, ...checkArgs], { cwd: root, encoding: 'utf8' });
          assert.strictEqual(result.status, 0, `row-17 combined check: ${result.stderr || result.stdout}`);
          const report = JSON.parse(result.stdout);
          for (const capability of ['doc-lint', 'link-check', 'derived-regenerate', 'conflict-check']) {
            assert.strictEqual(report.capabilities?.[capability]?.state, 'pass', `combined check ${capability} must pass`);
          }
          return { exitCode: result.status, stdout: result.stdout, stderr: result.stderr };
        });
        assert.ok(checked.stdout, 'combined check host result retains its real report');
      } else {
        if (fs.lstatSync(path.join(root, target)).isSymbolicLink()) fs.unlinkSync(path.join(root, target));
        fs.writeFileSync(path.join(root, target), `---\nid: ${domain}-001\nstatus: proposed\n---\n\n## Decision\nFinal D for row ${rowId}.\n`);
        fixtureGit(root, ['add', '-A']);
        fixtureGit(root, ['commit', '-q', '-m', 'D final draft']);
      }
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
    const workerResultPayload = {
      session_id: sessionId, cwd: root, hook_event_name: 'PostToolUse', tool_name: 'Task',
      tool_use_id: capture.tool_use_id, tool_input: { command: 'Task' },
      tool_response: { agentId: options.workerPrincipal || 'draft-worker', interrupted: false, status: 'completed' },
    };
    const workerStopPayload = {
      session_id: sessionId, cwd: root, hook_event_name: 'SubagentStop',
      agent_id: options.workerPrincipal || 'draft-worker', agent_type: 'worker',
    };
    const finalReviewer = 'final-reviewer';
    const finalReviewPrePayload = {
      session_id: sessionId, cwd: root, hook_event_name: 'PreToolUse', tool_name: 'Task',
      tool_use_id: 'final-review-dispatch', tool_input: { prompt: 'Review the final ADR.' },
    };
    const finalReviewStartPayload = { session_id: sessionId, cwd: root, hook_event_name: 'SubagentStart',
      agent_id: finalReviewer, agent_type: 'reviewer' };
    const finalResultPayload = {
      session_id: sessionId, cwd: root, hook_event_name: 'PostToolUse', tool_name: 'Task',
      tool_use_id: 'final-review-dispatch', tool_input: { command: 'Task' },
      tool_response: { agentId: finalReviewer, interrupted: false, status: 'completed' },
    };
    const finalStopPayload = {
      session_id: sessionId, cwd: root, hook_event_name: 'SubagentStop', agent_id: finalReviewer,
      agent_type: 'reviewer',
      last_assistant_message: `Review verdict: approve\nReviewed artifact: ${target} sha256:${sha(draftBytes)}\nSummary: Final candidate reviewed.`,
    };
    const finalFailurePayload = finalReviewFailure && {
      session_id: finalReviewFailure.sessionId || sessionId, cwd: root, hook_event_name: 'PostToolUseFailure', tool_name: 'Task',
      tool_use_id: finalReviewFailure.toolUseId || 'final-review-dispatch', tool_input: { command: 'Task' },
      is_interrupt: false, error: 'injected final-review failure', tool_response: { exitCode: 1, interrupted: false, status: 'failed' },
    };
    if (finalReviewFailure) assert.ok(['before-success', 'after-success'].includes(finalReviewFailure.order),
      'final-review failure fixture must declare its order relative to success');
    const emitFinalReviewFailure = () => { if (finalFailurePayload) runHook(finalFailurePayload); };
    let finalReviewPreCaptured = false;
    if (options.realHook) {
      if (finalReview && reviewLaunchBeforeWorkerClosure) {
        runHook(finalReviewPrePayload);
        finalReviewPreCaptured = true;
      }
      if (workerResultAfterFinalReview) {
        if (!omitWorkerStop) runHook(workerStopPayload);
      } else if (workerStopAfterFinalReview) {
        if (!omitWorkerResult) runHook(workerResultPayload);
      } else if (workerCompletionOrder === 'stop-result') {
        if (!omitWorkerStop) runHook(workerStopPayload);
        if (!omitWorkerResult) runHook(workerResultPayload);
      } else {
        if (!omitWorkerResult) runHook(workerResultPayload);
        if (!omitWorkerStop) runHook(workerStopPayload);
      }
      for (const make of afterWorkerStop) runHook(make({ root, sessionId, target }));
    }
    if (finalReview) {
      if (options.realHook) {
        if (!finalReviewPreCaptured) runHook(finalReviewPrePayload);
        runReviewCapture(finalReviewStartPayload);
        if (finalReviewFailure?.order === 'before-success') emitFinalReviewFailure();
        if (finalReviewCompletionOrder === 'stop-result') {
          runHook(finalStopPayload);
          runHook(finalResultPayload);
        } else {
          runHook(finalResultPayload);
          runHook(finalStopPayload);
        }
        if (finalReviewFailure?.order === 'after-success') emitFinalReviewFailure();
      } else {
        const finalResult = runtimeProvider.buildCaptureRecord(finalResultPayload, 'PostToolUse', root);
        const finalStop = runtimeProvider.buildCaptureRecord(finalStopPayload, 'SubagentStop', root);
        finalResult.observedIdentity = capture.observedIdentity;
        finalStop.observedIdentity = capture.observedIdentity;
        extraCaptures.push(finalResult, finalStop);
      }
    }
    if (options.realHook && workerResultAfterFinalReview && !omitWorkerResult) runHook(workerResultPayload);
    if (options.realHook && workerStopAfterFinalReview && !omitWorkerStop) runHook(workerStopPayload);
    if (completeWorkflow) {
      runWorkflowOperation('step-adr', ['step', '--session-id', sessionId, '--step-id', 'adr-evid',
        '--disposition', 'pass', '--evidence', 'Independent final ADR review completed']);
      runWorkflowOperation('binding-verify', ['binding', '--session-id', sessionId, '--step-id', 'verify-row17',
        '--binding-id', 'verification-loop', '--disposition', 'loaded', '--evidence', 'Read the verification-loop skill and ran the combined checker']);
      runWorkflowOperation('step-verify', ['step', '--session-id', sessionId, '--step-id', 'verify-row17',
        '--disposition', 'pass', '--evidence', 'Combined checker and independent final review completed'], allowDispositionFailure);
    }
    if (mutateAfterFinalReview) {
      fs.writeFileSync(path.join(root, target), `---\nid: DOCS-001\nstatus: proposed\n---\n\n## Decision\nChanged after final review.\n`);
      fixtureGit(root, ['add', '-A']);
      fixtureGit(root, ['commit', '-q', '-m', 'D changed after review']);
      draftCommit = fixtureGit(root, ['rev-parse', 'HEAD']);
      draftBytes = fs.readFileSync(path.join(root, target));
    }
    const captures = options.realHook
      ? runtimeProvider.readCaptureView(sessionDir).records
      : [...reviewCaptures, capture, ...extraCaptures, ...(!omitWorkerStart ? [workerStart] : []), ...(!omitWorkerResult ? [runtimeProvider.buildCaptureRecord({
        session_id: sessionId, cwd: root, hook_event_name: 'PostToolUse', tool_name: 'Task',
        tool_use_id: capture.tool_use_id, tool_input: { command: 'Task' },
        tool_response: { agentId: options.workerPrincipal || 'draft-worker', interrupted: false, status: 'completed' },
      }, 'PostToolUse', root)] : []), ...(!omitWorkerStop ? [runtimeProvider.buildCaptureRecord({
        session_id: sessionId, cwd: root, hook_event_name: 'SubagentStop', agent_id: options.workerPrincipal || 'draft-worker', agent_type: 'worker',
      }, 'SubagentStop', root)] : []), ...postWorkerCaptures];
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
    const origin = runtimeProvider.createClaudeOriginProvider({
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
      const previousFactory = runtimeProvider.createClaudeOriginProvider;
      runtimeProvider.createClaudeOriginProvider = input => previousFactory({ ...input,
        ...(qualification ? { qualification, outlineFixture: { expectedPin } } : {}), taskBinding });
      process.env.HARNESS_DOC_RECONCILIATION_PILOT = '1';
      const actualWorkflow = options.workflowCli ? JSON.parse(fs.readFileSync(path.join(sessionDir, 'workflow-run.json'), 'utf8')) : null;
      const actualSet = options.workflowCli ? JSON.parse(fs.readFileSync(path.join(sessionDir, 'workflow-obligations.json'), 'utf8')) : null;
      const context = { root, sessionId, sessionDir, activeHost: 'claude-code', workflow: actualWorkflow || {
        workflowId, revision: workflowRevision, strategy: 'iterative-single', state: 'running',
        docReconciliationBaseline: { root: baselineRoot, commit: baselineCommit, tree: baselineTree }, docReconciliationTask: taskBinding,
      } };
      try {
        pilotResult = runtimePilot.assess(context, actualSet || { strategy: 'iterative-single', stepBindingsEnabled: true,
          requirements: [{ id: 'prb', summary: 'produce an ADR', acceptance: 'outline review precedes drafting' }] });
      } finally {
        runtimeProvider.createClaudeOriginProvider = previousFactory;
        if (previousSwitch === undefined) delete process.env.HARNESS_DOC_RECONCILIATION_PILOT;
        else process.env.HARNESS_DOC_RECONCILIATION_PILOT = previousSwitch;
      }
    }
    return { captures, origin, identity, draftCommit, draftBytes, result, pilot: pilotResult };
  }

  return { root, sessionDir, target, taskId, attemptId, sessionId, workflowId, workflowRevision, preOutlineOperation,
    baselineCommit, baselineTree, outlineCommit, outlineTree, outlineBlob, outlineBytes, configDigest,
    indexAfterCapturedAdd, indexAfterOutlineCommit,
    expectedPin, taskBinding, attemptDir, handoff, payload, capture, reviewCaptures, workerStart,
    extraCaptures, dispatchAgain, finishDraft, runHook, capturedRecordsAcrossSessions, stateHome, inventoryOperation, workflowOperationWitnesses,
    runtimeProvider, runtimePilot, outsideInventoryPath,
    faultMarker: path.join(stateHome, 'prb-partial-dispatch-faults-used'),
    cleanup: () => {
      fs.rmSync(root, { recursive: true, force: true });
      fs.rmSync(stateHome, { recursive: true, force: true });
    } };
}

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

test('legacy session-dir keying stays aligned through an aliased workspace root', () => {
  const unavailable = symlinkUnavailable('dir');
  if (unavailable) return { unchecked: `directory symlink creation is unavailable (${unavailable})` };
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
      PRB_TEST_ALIAS_ROOT: aliasRoot,
    };
    const runHook = (relative, payload) => spawnSync(process.execPath,
      ['--require', preload, path.join(ROOT, relative)], {
        cwd: aliasRoot,
        input: JSON.stringify(payload),
        encoding: 'utf8',
        env,
      });

    try {
      const legacy = runHook('hooks/scripts/state-persist.js', {
        hook_event_name: 'PostToolUse', session_id: sessionId, cwd: aliasRoot,
        tool_name: 'Bash', tool_input: { command: 'echo legacy-state-probe' },
        tool_response: { exitCode: 0, stdout: '', stderr: '' },
      });
      assert.strictEqual(legacy.status, 0, `generic PostToolUse state-persist remains fail-open: ${legacy.stderr}`);
      return {
        legacyExit: legacy.status,
        handoffInAliasSession: fs.existsSync(path.join(aliasSessionDir, 'handoff-state.json')),
        handoffInCanonicalSession: fs.existsSync(path.join(canonicalSessionDir, 'handoff-state.json')),
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
  assert.strictEqual(first.legacyExit, 0, 'generic PostToolUse remains fail-open');
  assert.deepStrictEqual({
    handoffInAliasSession: first.handoffInAliasSession,
    handoffInCanonicalSession: first.handoffInCanonicalSession,
  }, {
    handoffInAliasSession: true,
    handoffInCanonicalSession: false,
  }, `generic handoff must stay in the bound alias session directory: ${JSON.stringify(first)}`);
});

if (failures.length) {
  console.error(`\n${failures.length} PR-B RED assertion(s) failed.`);
  process.exitCode = 1;
} else {
  console.log('\nAll PR-B outline mechanism checks passed.');
}
