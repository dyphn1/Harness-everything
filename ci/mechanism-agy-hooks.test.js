'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const SCRIPTS_DIR = path.join(ROOT, 'hooks', 'scripts');
const HOOKS_JSON = path.join(ROOT, 'plugins', 'harness-everything', 'hooks.json');

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-agy-hooks-test-'));
const tempStateHome = path.join(tempRoot, 'state-home');
fs.mkdirSync(tempStateHome, { recursive: true });

const originalStateHome = process.env.HARNESS_STATE_HOME;
process.env.HARNESS_STATE_HOME = tempStateHome;

const { getSessionDir, getWorkspaceRoot } = require(path.join(SCRIPTS_DIR, 'lib', 'harness-state'));

function runHook(scriptName, inputPayload, env = {}) {
  const scriptPath = path.join(SCRIPTS_DIR, scriptName);
  assert.ok(fs.existsSync(scriptPath), `Hook script ${scriptName} must exist`);

  const run = spawnSync(process.execPath, [scriptPath], {
    input: JSON.stringify(inputPayload),
    encoding: 'utf8',
    env: { ...process.env, HARNESS_STATE_HOME: tempStateHome, ...env },
    timeout: 20000
  });

  assert.strictEqual(run.status, 0, `Script ${scriptName} exited non-zero: ${run.stderr}`);
  let parsed;
  try {
    parsed = JSON.parse(run.stdout.trim());
  } catch (err) {
    assert.fail(`Script ${scriptName} stdout is not valid JSON: "${run.stdout}"`);
  }
  return parsed;
}

try {
  // 1. Verify plugins/harness-everything/hooks.json structure & matcher regexes
  assert.ok(fs.existsSync(HOOKS_JSON), 'plugins/harness-everything/hooks.json must exist at plugin root');
  const hooksConfig = JSON.parse(fs.readFileSync(HOOKS_JSON, 'utf8'));
  assert.ok(hooksConfig['harness-everything'], 'Top-level hook name must be harness-everything');

  const agyHooks = hooksConfig['harness-everything'];
  assert.ok(Array.isArray(agyHooks.SessionStart), 'SessionStart hook must be defined');
  assert.ok(Array.isArray(agyHooks.PreInvocation), 'PreInvocation hook must be defined');
  assert.ok(Array.isArray(agyHooks.PreToolUse), 'PreToolUse hook must be defined');
  assert.ok(Array.isArray(agyHooks.PostToolUse), 'PostToolUse hook must be defined');
  assert.ok(Array.isArray(agyHooks.Stop), 'Stop hook must be defined');

  const expectedTools = [
    'run_command',
    'write_file',
    'edit_file',
    'write_to_file',
    'replace_file_content',
    'multi_replace_file_content'
  ];
  const expectedMatcher = expectedTools.join('|');
  for (const eventName of ['PreToolUse', 'PostToolUse']) {
    const matcher = agyHooks[eventName][0].matcher;
    assert.strictEqual(
      matcher,
      expectedMatcher,
      `${eventName} matcher must cover all documented AGY command and file-modification tools`
    );
    const regex = new RegExp(`^(?:${matcher})$`);
    for (const toolName of expectedTools) {
      assert.ok(regex.test(toolName), `${eventName} matcher regex must match ${toolName}`);
    }
    for (const nonMatched of ['view_file', 'grep_search', 'read_file']) {
      assert.ok(!regex.test(nonMatched), `${eventName} matcher regex must not match read-only tool ${nonMatched}`);
    }
  }

  // 2. SessionStart Hook: bootstrap message + workspace binding on workspacePaths-only payload
  {
    const sessionWs = path.join(tempRoot, 'session-start-ws');
    fs.mkdirSync(sessionWs, { recursive: true });
    const convId = 'test-session-start-001';
    const start = runHook('agy-session-start.js', {
      conversationId: convId,
      workspacePaths: [sessionWs]
    });
    assert.ok(Array.isArray(start.injectSteps), 'SessionStart must emit injectSteps');
    assert.ok(
      start.injectSteps.some(s => s.systemMessage && s.systemMessage.systemMessage.includes('Harness Skills OS')),
      'Must include Harness bootstrap message'
    );
    const boundRoot = getWorkspaceRoot({ session_id: convId });
    assert.strictEqual(
      fs.realpathSync(boundRoot),
      fs.realpathSync(sessionWs),
      'SessionStart must bind workspace identity from workspacePaths'
    );
  }

  // 3. PreInvocation Hook: router context, workflow persistence, and per-turn deduplication
  {
    const preWs = path.join(tempRoot, 'pre-inv-ws');
    fs.mkdirSync(preWs, { recursive: true });

    // 3a. 0-based host (AGY 2.34.0 protojson omits invocationNum=0 on first call)
    const convZeroBased = 'test-conv-dedup-0based-' + Date.now();
    const turn1Call0 = runHook('agy-pre-invocation.js', {
      hookEventName: 'PreInvocation',
      conversationId: convZeroBased,
      initialNumSteps: 1,
      lastUserInput: 'Please implement new auth feature and write tests',
      workspacePaths: [preWs]
    });
    assert.ok(Array.isArray(turn1Call0.injectSteps) && turn1Call0.injectSteps.length === 1, 'First call of turn 1 must inject routing');

    const sessionDir = getSessionDir(preWs, convZeroBased);
    const workflowFile = path.join(sessionDir, 'workflow-run.json');
    assert.ok(fs.existsSync(workflowFile), 'Workflow must be persisted in session dir for conversationId');
    const workflow = JSON.parse(fs.readFileSync(workflowFile, 'utf8'));
    assert.strictEqual(workflow.sessionId, convZeroBased, 'Persisted workflow must match conversationId');

    // Second model call within the same turn -> must skip injection
    const turn1Call1 = runHook('agy-pre-invocation.js', {
      hookEventName: 'PreInvocation',
      conversationId: convZeroBased,
      initialNumSteps: 1,
      invocationNum: 1,
      lastUserInput: 'Please implement new auth feature and write tests',
      workspacePaths: [preWs]
    });
    assert.deepStrictEqual(turn1Call1.injectSteps, [], 'Second call in same turn must not double-inject');

    // Third model call within the same turn -> must skip injection
    const turn1Call2 = runHook('agy-pre-invocation.js', {
      hookEventName: 'PreInvocation',
      conversationId: convZeroBased,
      initialNumSteps: 1,
      invocationNum: 2,
      lastUserInput: 'Please implement new auth feature and write tests',
      workspacePaths: [preWs]
    });
    assert.deepStrictEqual(turn1Call2.injectSteps, [], 'Third call in same turn must not double-inject');

    // New user turn (initialNumSteps advanced) -> must inject fresh routing
    const turn2Call0 = runHook('agy-pre-invocation.js', {
      hookEventName: 'PreInvocation',
      conversationId: convZeroBased,
      initialNumSteps: 9,
      lastUserInput: 'Now review the security edge cases',
      workspacePaths: [preWs]
    });
    assert.strictEqual(turn2Call0.injectSteps.length, 1, 'New user turn must inject fresh routing');

    // New user turn with identical prompt text but higher initialNumSteps -> must inject fresh routing
    const turn3Call0 = runHook('agy-pre-invocation.js', {
      hookEventName: 'PreInvocation',
      conversationId: convZeroBased,
      initialNumSteps: 15,
      lastUserInput: 'Now review the security edge cases',
      workspacePaths: [preWs]
    });
    assert.strictEqual(turn3Call0.injectSteps.length, 1, 'Repeated prompt on a new turn (new initialNumSteps) must inject fresh routing');

    // 3b. 1-based invocationNum host -> injects on call 1, skips call 2, injects on new turn call 1
    const convOneBased = 'test-conv-dedup-1based-' + Date.now();
    const oneBasedCall1 = runHook('agy-pre-invocation.js', {
      hookEventName: 'PreInvocation',
      conversationId: convOneBased,
      initialNumSteps: 1,
      invocationNum: 1,
      lastUserInput: 'Add pagination to list API',
      workspacePaths: [preWs]
    });
    assert.strictEqual(oneBasedCall1.injectSteps.length, 1, '1-based host first call must inject');

    const oneBasedCall2 = runHook('agy-pre-invocation.js', {
      hookEventName: 'PreInvocation',
      conversationId: convOneBased,
      initialNumSteps: 1,
      invocationNum: 2,
      lastUserInput: 'Add pagination to list API',
      workspacePaths: [preWs]
    });
    assert.deepStrictEqual(oneBasedCall2.injectSteps, [], '1-based host second call in same turn must skip');

    const oneBasedTurn2 = runHook('agy-pre-invocation.js', {
      hookEventName: 'PreInvocation',
      conversationId: convOneBased,
      initialNumSteps: 7,
      invocationNum: 1,
      lastUserInput: 'Add tests for pagination',
      workspacePaths: [preWs]
    });
    assert.strictEqual(oneBasedTurn2.injectSteps.length, 1, '1-based host new turn first call must inject');

    // 3c. Stateless invocationNum > 0 guard without initialNumSteps
    const statelessMidTurn = runHook('agy-pre-invocation.js', {
      hookEventName: 'PreInvocation',
      conversationId: 'test-conv-stateless-' + Date.now(),
      invocationNum: 1,
      lastUserInput: 'Fix failing test',
      workspacePaths: [preWs]
    });
    assert.deepStrictEqual(statelessMidTurn.injectSteps, [], 'Mid-turn invocationNum > 0 without initialNumSteps must skip');

    // 3d. Without initialNumSteps: single-call turn followed by explicit invocationNum: 0 with identical prompt must inject fresh
    const convExplicitZero = 'test-conv-explicit-zero-' + Date.now();
    const zeroTurn1 = runHook('agy-pre-invocation.js', {
      hookEventName: 'PreInvocation',
      conversationId: convExplicitZero,
      invocationNum: 0,
      lastUserInput: 'continue',
      workspacePaths: [preWs]
    });
    assert.strictEqual(zeroTurn1.injectSteps.length, 1, 'First turn with explicit invocationNum: 0 must inject');

    const zeroTurn2 = runHook('agy-pre-invocation.js', {
      hookEventName: 'PreInvocation',
      conversationId: convExplicitZero,
      invocationNum: 0,
      lastUserInput: 'continue',
      workspacePaths: [preWs]
    });
    assert.strictEqual(zeroTurn2.injectSteps.length, 1, 'New turn with explicit invocationNum: 0 and identical prompt must inject fresh');
  }

  // 4. PreToolUse Hook (Canonical Action Gate, Cwd parity, Filesystem Boundary, Artifacts, Symlinks)
  {
    const wsA = path.join(tempRoot, 'ws-a');
    const wsB = path.join(tempRoot, 'ws-b');
    const artifactDir = path.join(tempRoot, 'brain', 'conv-123');
    const outsideDir = path.join(tempRoot, 'outside-dir');
    fs.mkdirSync(wsA, { recursive: true });
    fs.mkdirSync(wsB, { recursive: true });
    fs.mkdirSync(artifactDir, { recursive: true });
    fs.mkdirSync(outsideDir, { recursive: true });

    // Happy path command
    const allowCmd = runHook('agy-pre-tool.js', {
      toolCall: { id: 'toolu_safe_1', name: 'run_command', args: { CommandLine: 'npm test', Cwd: wsA } },
      workspacePaths: [wsA]
    });
    assert.strictEqual(allowCmd.decision, 'allow', 'npm test should be allowed');

    // Canonical Action Gate: Destructive rm -rf outside scratch
    const denyRm = runHook('agy-pre-tool.js', {
      toolCall: { id: 'toolu_rm_1', name: 'run_command', args: { CommandLine: 'rm -rf /' } },
      cwd: wsA
    });
    assert.strictEqual(denyRm.decision, 'deny', 'rm -rf / must be denied');
    assert.ok(denyRm.reason.includes('destructive') || denyRm.reason.includes('actionGate:recursive-delete'), 'Must provide actionable reason');

    // Canonical Action Gate: args.Cwd parity for outside-scratch relative delete
    const scratchSubdir = path.join(tempRoot, 'scratch-run');
    fs.mkdirSync(scratchSubdir, { recursive: true });
    const allowScratchRm = runHook('agy-pre-tool.js', {
      conversationId: 'conv-cwd-parity',
      toolCall: { id: 'toolu_scratch_rm', name: 'run_command', args: { CommandLine: 'rm -rf build-cache', Cwd: scratchSubdir } },
      cwd: ROOT
    });
    assert.strictEqual(allowScratchRm.decision, 'allow', 'rm -rf relative inside args.Cwd scratch dir must be allowed');

    const denyNonScratchRm = runHook('agy-pre-tool.js', {
      conversationId: 'conv-cwd-parity',
      toolCall: { id: 'toolu_repo_rm', name: 'run_command', args: { CommandLine: 'rm -rf build-cache', Cwd: ROOT } },
      cwd: scratchSubdir
    });
    assert.strictEqual(denyNonScratchRm.decision, 'deny', 'rm -rf relative inside args.Cwd repo root must be denied even if top-level cwd is tmp');
    assert.ok(denyNonScratchRm.reason.includes('actionGate:recursive-delete'), 'Must report recursive-delete rule');

    // Audit record should be keyed by toolCall.id
    const paritySessionDir = getSessionDir(ROOT, 'conv-cwd-parity');
    assert.ok(
      fs.existsSync(path.join(paritySessionDir, 'action-gate', 'toolu_repo_rm.json')),
      'Action Gate audit record must use forwarded toolCall.id'
    );

    // Canonical Action Gate: Force-push variants
    for (const pushCmd of [
      'git push --force origin main',
      'git push -f origin main',
      'git -C . push -f origin main'
    ]) {
      const denyPush = runHook('agy-pre-tool.js', {
        toolCall: { name: 'run_command', args: { CommandLine: pushCmd, Cwd: wsA } },
        workspacePaths: [wsA]
      });
      assert.strictEqual(denyPush.decision, 'deny', `${pushCmd} must be denied by canonical action gate`);
      assert.ok(denyPush.reason.includes('Force-pushing') || denyPush.reason.includes('actionGate:git-force-push'), 'Action gate reason required');
    }

    // Canonical Action Gate: git reset --hard
    const denyReset = runHook('agy-pre-tool.js', {
      toolCall: { name: 'run_command', args: { CommandLine: 'git reset --hard HEAD~1' } },
      cwd: wsA
    });
    assert.strictEqual(denyReset.decision, 'deny', 'git reset --hard must be denied');
    assert.ok(denyReset.reason.includes('reset') || denyReset.reason.includes('actionGate:git-reset-hard'), 'Action gate reason required');

    // Canonical Action Gate: npm publish
    const denyPublish = runHook('agy-pre-tool.js', {
      toolCall: { name: 'run_command', args: { CommandLine: 'npm publish' } },
      cwd: wsA
    });
    assert.strictEqual(denyPublish.decision, 'deny', 'npm publish must be denied');

    // Fallback payload shape: tool_name + tool_input
    const denyFallbackCmd = runHook('agy-pre-tool.js', {
      tool_name: 'run_command',
      tool_input: { command: 'git push --force origin main' },
      cwd: wsA
    });
    assert.strictEqual(denyFallbackCmd.decision, 'deny', 'tool_name/tool_input fallback must enforce Action Gate');

    // Filesystem boundary checks across all documented AGY file mutation tools
    const fileTools = [
      { name: 'write_file', argKey: 'Path' },
      { name: 'edit_file', argKey: 'path' },
      { name: 'write_to_file', argKey: 'TargetFile' },
      { name: 'replace_file_content', argKey: 'TargetFile' },
      { name: 'multi_replace_file_content', argKey: 'TargetFile' }
    ];

    for (const { name, argKey } of fileTools) {
      // Missing/empty target file path -> must deny (no silent allow)
      const denyMissing = runHook('agy-pre-tool.js', {
        toolCall: { name, args: { Content: 'bad' } },
        workspacePaths: [wsA],
        artifactDirectoryPath: artifactDir
      });
      assert.strictEqual(denyMissing.decision, 'deny', `${name} with missing path must be denied`);
      assert.ok(denyMissing.reason.includes('missing target file path'), 'Missing path reason required');

      const denyEmpty = runHook('agy-pre-tool.js', {
        toolCall: { name, args: { [argKey]: '   ' } },
        workspacePaths: [wsA],
        artifactDirectoryPath: artifactDir
      });
      assert.strictEqual(denyEmpty.decision, 'deny', `${name} with empty path must be denied`);

      // Outside all allowed roots -> must deny
      for (const badPath of ['/etc/shadow', path.join(outsideDir, 'outside.txt')]) {
        const denyOob = runHook('agy-pre-tool.js', {
          toolCall: { name, args: { [argKey]: badPath, Content: 'bad' } },
          workspacePaths: [wsA, wsB],
          artifactDirectoryPath: artifactDir
        });
        assert.strictEqual(denyOob.decision, 'deny', `${name} to ${badPath} must be denied`);
        assert.ok(denyOob.reason.includes('outside workspace root'), 'Boundary violation reason required');
      }

      // Inside primary workspacePaths[0] -> must allow
      const allowWsA = runHook('agy-pre-tool.js', {
        toolCall: { name, args: { [argKey]: path.join(wsA, 'src', 'file.js'), Content: '{}' } },
        workspacePaths: [wsA, wsB],
        artifactDirectoryPath: artifactDir
      });
      assert.strictEqual(allowWsA.decision, 'allow', `${name} inside workspacePaths[0] must be allowed`);

      // Inside secondary multi-root workspacePaths[1] -> must allow
      const allowWsB = runHook('agy-pre-tool.js', {
        toolCall: { name, args: { [argKey]: path.join(wsB, 'nested', 'new.js'), Content: '{}' } },
        workspacePaths: [wsA, wsB],
        artifactDirectoryPath: artifactDir
      });
      assert.strictEqual(allowWsB.decision, 'allow', `${name} inside workspacePaths[1] must be allowed`);

      // Inside artifactDirectoryPath (outside workspace) -> must allow
      const allowArtifact = runHook('agy-pre-tool.js', {
        toolCall: { name, args: { [argKey]: path.join(artifactDir, 'implementation_plan.md'), Content: '# Plan' } },
        workspacePaths: [wsA],
        artifactDirectoryPath: artifactDir
      });
      assert.strictEqual(allowArtifact.decision, 'allow', `${name} inside artifactDirectoryPath must be allowed`);
    }

    // Fallback payload shape for write tool
    const denyFallbackWrite = runHook('agy-pre-tool.js', {
      tool_name: 'write_file',
      tool_input: { Path: '/etc/shadow' },
      cwd: wsA
    });
    assert.strictEqual(denyFallbackWrite.decision, 'deny', 'tool_name/tool_input fallback must enforce write boundary');

    // Symlinked workspace & symlink escape checks (including dangling file/dir symlinks and symlink loops)
    const symlinkWs = path.join(tempRoot, 'ws-a-link');
    const escapeLink = path.join(wsA, 'escape-link');
    const danglingFileLink = path.join(wsA, 'dangling-file.txt');
    const danglingDirLink = path.join(wsA, 'dangling-dir');
    const loopA = path.join(wsA, 'loop-a');
    const loopB = path.join(wsA, 'loop-b');
    let symlinksSupported = true;
    try {
      fs.symlinkSync(wsA, symlinkWs, 'dir');
      fs.symlinkSync(outsideDir, escapeLink, 'dir');
      fs.symlinkSync(path.join(outsideDir, 'nonexistent-secret.txt'), danglingFileLink);
      fs.symlinkSync(path.join(outsideDir, 'nonexistent-dir'), danglingDirLink, 'dir');
      fs.symlinkSync(loopB, loopA);
      fs.symlinkSync(loopA, loopB);
    } catch (_) {
      symlinksSupported = false;
    }
    if (symlinksSupported) {
      const allowSymlinkNewFile = runHook('agy-pre-tool.js', {
        toolCall: { name: 'write_file', args: { Path: path.join(symlinkWs, 'new-subdir', 'hello.js') } },
        cwd: fs.realpathSync(wsA)
      });
      assert.strictEqual(allowSymlinkNewFile.decision, 'allow', 'Write via symlinked alias of workspace root must be allowed');

      const denySymlinkEscape = runHook('agy-pre-tool.js', {
        toolCall: { name: 'write_file', args: { Path: path.join(escapeLink, 'pwn.txt') } },
        cwd: wsA
      });
      assert.strictEqual(denySymlinkEscape.decision, 'deny', 'Write through symlink escaping outside workspace must be denied');

      const denyDanglingFile = runHook('agy-pre-tool.js', {
        toolCall: { name: 'write_file', args: { Path: danglingFileLink } },
        cwd: wsA
      });
      assert.strictEqual(denyDanglingFile.decision, 'deny', 'Write through dangling file symlink pointing outside workspace must be denied');

      const denyDanglingDir = runHook('agy-pre-tool.js', {
        toolCall: { name: 'write_file', args: { Path: path.join(danglingDirLink, 'pwn.txt') } },
        cwd: wsA
      });
      assert.strictEqual(denyDanglingDir.decision, 'deny', 'Write through dangling directory symlink pointing outside workspace must be denied');

      const denySymlinkLoop = runHook('agy-pre-tool.js', {
        toolCall: { name: 'write_file', args: { Path: loopA } },
        cwd: wsA
      });
      assert.strictEqual(denySymlinkLoop.decision, 'deny', 'Write to cyclic symlink loop must fail closed (deny)');
    }
  }

  // 5. End-to-end PostToolUse -> Stop with workspacePaths-only (NO cwd) & session isolation
  {
    const e2eWs = path.join(tempRoot, 'e2e-workspace');
    fs.mkdirSync(e2eWs, { recursive: true });
    const convA = 'test-conv-e2e-a-' + Date.now();
    const convB = 'test-conv-e2e-b-' + Date.now();

    // Step 1: PostToolUse records a write_to_file inside workspacePaths[0] (NO cwd field!)
    const editRes = runHook('agy-post-tool.js', {
      conversationId: convA,
      workspacePaths: [e2eWs],
      toolCall: { name: 'write_to_file', args: { TargetFile: path.join(e2eWs, 'feature.js') } },
      stepIdx: 2
    });
    assert.deepStrictEqual(editRes, {}, 'PostToolUse must output empty object');

    // Step 2: Stop on convA with workspacePaths-only (NO cwd!) -> MUST continue (unverified edit)
    const stopUnverified = runHook('agy-stop.js', {
      conversationId: convA,
      workspacePaths: [e2eWs],
      continuationActive: false,
      terminationReason: 'NO_TOOL_CALL'
    });
    assert.strictEqual(stopUnverified.decision, 'continue', 'Stop must continue when unverified edits exist (workspacePaths-only)');
    assert.ok(stopUnverified.reason.includes('Verify-Before-Claim'), 'Reason must mention Verify-Before-Claim');

    // Session isolation: convB on the same workspace has no edits -> Stop allows ({})
    const stopConvB = runHook('agy-stop.js', {
      conversationId: convB,
      workspacePaths: [e2eWs],
      continuationActive: false,
      terminationReason: 'NO_TOOL_CALL'
    });
    assert.deepStrictEqual(stopConvB, {}, 'Independent conversationId must not inherit convA unverified state');

    // Step 3: Non-NO_TOOL_CALL terminationReason allows stop even with unverified edits
    for (const reason of ['USER_CANCELED', 'ERROR', 'MAX_INVOCATIONS', 'MAX_TOKEN_BUDGET_EXCEEDED', 'TERMINAL_CUSTOM_HOOK']) {
      const stopTerminated = runHook('agy-stop.js', {
        conversationId: convA,
        workspacePaths: [e2eWs],
        continuationActive: false,
        terminationReason: reason
      });
      assert.deepStrictEqual(stopTerminated, {}, `Stop must allow stop on terminationReason=${reason}`);
    }

    // Step 4: continuationActive / stop_hook_active allows stop to prevent loops
    assert.deepStrictEqual(
      runHook('agy-stop.js', { conversationId: convA, workspacePaths: [e2eWs], continuationActive: true }),
      {},
      'Must allow stop when continuationActive is true'
    );
    assert.deepStrictEqual(
      runHook('agy-stop.js', { conversationId: convA, workspacePaths: [e2eWs], stop_hook_active: true }),
      {},
      'Must allow stop when stop_hook_active is true'
    );

    // Step 5: PostToolUse observes failing run_command via AGY protojson `error` string (no exitCode)
    const failRes = runHook('agy-post-tool.js', {
      conversationId: convA,
      workspacePaths: [e2eWs],
      toolCall: { name: 'run_command', args: { CommandLine: 'npm test', Cwd: e2eWs } },
      error: 'exit status 1',
      stepIdx: 3
    });
    assert.deepStrictEqual(failRes, {}, 'PostToolUse must output empty object on failure');

    const handoffFile = path.join(getSessionDir(e2eWs, convA), 'handoff-state.json');
    assert.ok(fs.existsSync(handoffFile), 'handoff-state.json must be written in e2eWs session dir');
    const failHandoff = JSON.parse(fs.readFileSync(handoffFile, 'utf8'));
    assert.strictEqual(failHandoff.status, 'failed', 'Status must be failed when AGY error string is present');
    assert.ok(failHandoff.errorSummary.includes('exit status 1'), 'Error summary must capture AGY error string');

    const stopFailed = runHook('agy-stop.js', {
      conversationId: convA,
      workspacePaths: [e2eWs],
      continuationActive: false,
      terminationReason: 'NO_TOOL_CALL'
    });
    assert.strictEqual(stopFailed.decision, 'continue', 'Stop must continue when tool failure is unresolved');
    assert.ok(stopFailed.reason.includes('pending tool failure'), 'Reason must mention pending tool failure');

    // Step 6: PostToolUse observes passing verification run_command -> Stop now allows ({})
    const passRes = runHook('agy-post-tool.js', {
      conversationId: convA,
      workspacePaths: [e2eWs],
      toolCall: { name: 'run_command', args: { CommandLine: 'npm test', Cwd: e2eWs } },
      stepIdx: 4
    });
    assert.deepStrictEqual(passRes, {}, 'PostToolUse must output empty object on success');

    const resolvedHandoff = JSON.parse(fs.readFileSync(handoffFile, 'utf8'));
    assert.strictEqual(resolvedHandoff.status, 'idle', 'Status must recover to idle after successful verification');
    assert.ok(resolvedHandoff.lastResolved, 'lastResolved record must be retained');
    assert.ok(resolvedHandoff.lastVerifyAt >= resolvedHandoff.lastEditAt, 'lastVerifyAt must be >= lastEditAt');

    const stopVerified = runHook('agy-stop.js', {
      conversationId: convA,
      workspacePaths: [e2eWs],
      continuationActive: false,
      terminationReason: 'NO_TOOL_CALL'
    });
    assert.deepStrictEqual(stopVerified, {}, 'Stop must allow completion after verification passes');

    const stopStrictVerified = runHook('agy-stop.js', {
      conversationId: convA,
      workspacePaths: [e2eWs],
      continuationActive: false,
      terminationReason: 'NO_TOOL_CALL'
    }, { HARNESS_REQUIRE_VERIFICATION: '1' });
    assert.deepStrictEqual(stopStrictVerified, {}, 'Strict verification must allow verified work');
  }

  console.log('Antigravity (AGY) lifecycle hook adapters verified: SessionStart, PreInvocation, PreToolUse, PostToolUse, and Stop all conform to protocol.');
} finally {
  if (originalStateHome === undefined) delete process.env.HARNESS_STATE_HOME;
  else process.env.HARNESS_STATE_HOME = originalStateHome;
  fs.rmSync(tempRoot, { recursive: true, force: true });
}
