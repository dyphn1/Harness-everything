'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const HOOK_REL = path.join('hooks', 'scripts', 'agy-post-tool.js');
const PACKAGED_POST_TOOL_REL = path.join('plugins', 'harness-everything', 'hooks', 'scripts', 'agy-post-tool.js');
const PACKAGED_STOP_REL = path.join('plugins', 'harness-everything', 'hooks', 'scripts', 'agy-stop.js');
const { getSessionDir } = require(path.join('..', 'hooks', 'scripts', 'lib', 'harness-state'));
const { mapAgyPayloadToStatePersist } = require(path.join('..', 'hooks', 'scripts', 'agy-post-tool'));

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-516-agy-post-tool-'));
const tempStateHome = path.join(tempRoot, 'state-home');
fs.mkdirSync(tempStateHome, { recursive: true });

const originalStateHome = process.env.HARNESS_STATE_HOME;
process.env.HARNESS_STATE_HOME = tempStateHome;

function runHookRel(scriptRel, payload, expectedShape = {}) {
  const childEnv = { ...process.env, HARNESS_STATE_HOME: tempStateHome };
  delete childEnv.HARNESS_REQUIRE_VERIFICATION;
  const run = spawnSync(process.execPath, [scriptRel], {
    input: JSON.stringify(payload),
    encoding: 'utf8',
    env: childEnv,
    timeout: 20000
  });
  assert.strictEqual(run.status, 0, `${scriptRel} exited non-zero: ${run.stderr}`);
  let parsed;
  try {
    parsed = JSON.parse(run.stdout.trim());
  } catch (_) {
    assert.fail(`${scriptRel} stdout is not valid JSON: "${run.stdout}"`);
  }
  if (expectedShape.emptyObject) {
    assert.deepStrictEqual(parsed, {}, `${scriptRel} must always emit {}`);
  }
  return parsed;
}

function runPostTool(payload) {
  return runHookRel(HOOK_REL, payload, { emptyObject: true });
}

function runPackagedPostTool(payload) {
  return runHookRel(PACKAGED_POST_TOOL_REL, payload, { emptyObject: true });
}

function runPackagedStop(payload) {
  const parsed = runHookRel(PACKAGED_STOP_REL, payload);
  assert.ok(parsed && (parsed.decision === 'allow' || parsed.decision === 'continue'), `unexpected Stop output: ${JSON.stringify(parsed)}`);
  return parsed;
}

function readHandoff(ws, convId) {
  const handoffFile = path.join(getSessionDir(ws, convId), 'handoff-state.json');
  assert.ok(fs.existsSync(handoffFile), `handoff-state.json must exist for ${convId}`);
  return JSON.parse(fs.readFileSync(handoffFile, 'utf8'));
}

function makeWs(name) {
  const ws = path.join(tempRoot, name);
  fs.mkdirSync(ws, { recursive: true });
  return ws;
}

try {
  // 1. Existing numeric exitCode 0 / nonzero & conflicting numeric codes
  {
    const ws = makeWs('ws-numeric');
    const conv = 'conv-516-numeric';

    runPostTool({
      conversationId: conv,
      workspacePaths: [ws],
      toolCall: { name: 'write_file', args: { Path: path.join(ws, 'a.js'), Content: '1' } }
    });
    const afterEdit = readHandoff(ws, conv);
    assert.ok(afterEdit.lastEditAt > 0, 'write_file must set lastEditAt');

    // Numeric nonzero in toolResponse.exit_code -> failed
    runPostTool({
      conversationId: conv,
      workspacePaths: [ws],
      toolCall: { name: 'run_command', args: { CommandLine: 'npm test', Cwd: ws } },
      toolResponse: { exit_code: 2 }
    });
    const afterFail = readHandoff(ws, conv);
    assert.strictEqual(afterFail.status, 'failed');
    assert.strictEqual(afterFail.exitCode, 2);
    assert.ok(!afterFail.lastVerifyAt, 'nonzero exit_code must not grant lastVerifyAt');

    // Conflicting numeric codes (0 + 1) -> nonzero wins, stays failed
    runPostTool({
      conversationId: conv,
      workspacePaths: [ws],
      toolCall: { name: 'run_command', args: { CommandLine: 'npm test', Cwd: ws } },
      exitCode: 0,
      toolResponse: { exit_code: 1 }
    });
    const afterConflictNum = readHandoff(ws, conv);
    assert.strictEqual(afterConflictNum.status, 'failed');
    assert.strictEqual(afterConflictNum.exitCode, 1);
    assert.ok(!afterConflictNum.lastVerifyAt, 'conflicting numeric 0 and 1 must not grant lastVerifyAt');

    // Unrecognized command + numeric exitCode: 0 -> no verification credit
    runPostTool({
      conversationId: conv,
      workspacePaths: [ws],
      toolCall: { name: 'run_command', args: { CommandLine: 'node -e "console.log(1)"', Cwd: ws } },
      exitCode: 0
    });
    const afterUnrecognized = readHandoff(ws, conv);
    assert.ok(!afterUnrecognized.lastVerifyAt, 'unrecognized command with exitCode: 0 must not grant lastVerifyAt');

    // Recognized check + numeric exitCode: 0 -> advances lastVerifyAt & clears failed
    runPostTool({
      conversationId: conv,
      workspacePaths: [ws],
      toolCall: { name: 'run_command', args: { CommandLine: 'npm test', Cwd: ws } },
      exitCode: 0
    });
    const afterPass = readHandoff(ws, conv);
    assert.strictEqual(afterPass.status, 'idle');
    assert.strictEqual(afterPass.lastVerifyExitCode, 0);
    assert.ok(afterPass.lastVerifyAt >= afterEdit.lastEditAt, 'recognized check with exitCode: 0 must advance lastVerifyAt');
  }

  // 2. Structured status / error flags & string toolResponse normalization
  {
    const ws = makeWs('ws-structured');

    const failurePayloads = [
      { label: 'toolResponse.isError', extra: { toolResponse: { isError: true } } },
      { label: 'toolResponse.is_error', extra: { toolResponse: { is_error: true, exitCode: 0 } } },
      { label: 'toolResponse.success=false', extra: { toolResponse: { success: false } } },
      { label: 'toolResponse.ok=false', extra: { toolResponse: { ok: false, exitCode: 0 } } },
      { label: 'toolResponse.status=failed', extra: { toolResponse: { status: 'failed', exitCode: 0 } } },
      { label: 'payload.status=error', extra: { status: 'error' } },
      { label: 'payload.interrupted=true', extra: { interrupted: true } }
    ];

    for (const item of failurePayloads) {
      const conv = `conv-516-${item.label}`;
      runPostTool({
        conversationId: conv,
        workspacePaths: [ws],
        toolCall: { name: 'run_command', args: { CommandLine: 'npm test', Cwd: ws } },
        ...item.extra
      });
      const state = readHandoff(ws, conv);
      assert.strictEqual(state.status, 'failed', `${item.label} must record status: failed`);
      assert.ok(!state.lastVerifyAt, `${item.label} must not grant lastVerifyAt`);
    }

    // Positive control: isError: false WITH numeric exitCode: 0 advances lastVerifyAt
    const convPos = 'conv-516-isError-false-pos';
    runPostTool({
      conversationId: convPos,
      workspacePaths: [ws],
      toolCall: { name: 'run_command', args: { CommandLine: 'npm test', Cwd: ws } },
      toolResponse: { isError: false, exitCode: 0 }
    });
    const posState = readHandoff(ws, convPos);
    assert.strictEqual(posState.status, 'idle');
    assert.strictEqual(posState.lastVerifyExitCode, 0);
    assert.ok(posState.lastVerifyAt > 0, 'isError: false with exitCode: 0 must grant lastVerifyAt');

    // Negative control: success/completed flags WITHOUT numeric exitCode: 0 must NOT credit shell verification
    for (const [idx, extra] of [
      { toolResponse: { isError: false } },
      { toolResponse: { success: true } },
      { toolResponse: { ok: true } },
      { toolResponse: { status: 'completed' } }
    ].entries()) {
      const convNeg = `conv-516-no-exitcode-${idx}`;
      runPostTool({
        conversationId: convNeg,
        workspacePaths: [ws],
        toolCall: { name: 'run_command', args: { CommandLine: 'npm test', Cwd: ws } },
        ...extra
      });
      const negState = readHandoff(ws, convNeg);
      assert.strictEqual(negState.status, 'idle');
      assert.ok(!negState.lastVerifyAt, 'structured success without exitCode: 0 must not credit shell verification');
      assert.ok(!negState.lastEditAt, 'recognized shell verification without exitCode must not bump lastEditAt');
    }

    // String toolResponse/result preserves stdout without trusting text as exit code
    const mappedStr = mapAgyPayloadToStatePersist({
      conversationId: 'conv-516-str',
      workspacePaths: [ws],
      toolCall: { name: 'run_command', args: { CommandLine: 'npm test', Cwd: ws } },
      toolResponse: 'Command exited with code 0.'
    });
    assert.ok(mappedStr, 'string toolResponse must map to a state-persist payload');
    assert.strictEqual(mappedStr.tool_response.stdout, 'Command exited with code 0.', 'string toolResponse must be preserved as stdout');
    assert.strictEqual(mappedStr.exitCode, undefined, 'string toolResponse must not be trusted as exitCode');
  }

  // 3. Unidentified text markers in stdout / output / string toolResponse stay unknown; explicit host error + marker 0 stays failed
  {
    const ws = makeWs('ws-text-markers');
    const conv = 'conv-516-text';

    // Seed an edit and a pending failure to verify nothing is cleared or credited by text-only markers
    runPostTool({
      conversationId: conv,
      workspacePaths: [ws],
      toolCall: { name: 'write_file', args: { Path: path.join(ws, 'app.js'), Content: '1' } }
    });
    runPostTool({
      conversationId: conv,
      workspacePaths: [ws],
      toolCall: { name: 'run_command', args: { CommandLine: 'npm test', Cwd: ws } },
      error: 'prior failure'
    });
    const baseline = readHandoff(ws, conv);
    assert.strictEqual(baseline.status, 'failed');

    const unknownMarkerPayloads = [
      { toolResponse: { stdout: 'Command exited with code 0.' } },
      { output: 'Command exited with code 0.' },
      { toolResponse: 'Command exited with code 0.' },
      { result: 'Command exited with code 0.' },
      { toolResponse: { stdout: 'Command exited with code 0.\nCommand exited with code 1.' } },
      { output: 'Command exited with code 0.\nCommand exited with code 1.' }
    ];

    for (const extra of unknownMarkerPayloads) {
      runPostTool({
        conversationId: conv,
        workspacePaths: [ws],
        toolCall: { name: 'run_command', args: { CommandLine: 'npm test', Cwd: ws } },
        ...extra
      });
      const after = readHandoff(ws, conv);
      assert.strictEqual(after.status, 'failed', 'unknown/stdout text markers must preserve existing failed state');
      assert.strictEqual(after.lastEditAt, baseline.lastEditAt, 'recognized check with unknown text marker must not bump lastEditAt');
      assert.ok(!after.lastVerifyAt, 'unknown/stdout text markers must not grant lastVerifyAt');
    }

    // Explicit host error + marker 0 (or exitCode 0) stays failed
    for (const [idx, extra] of [
      { error: 'explicit host error', exitCode: 0 },
      { error: 'Command exited with code 0.' },
      { error: 'explicit host error', output: 'Command exited with code 0.' }
    ].entries()) {
      const convErr = `conv-516-explicit-err-${idx}`;
      runPostTool({
        conversationId: convErr,
        workspacePaths: [ws],
        toolCall: { name: 'run_command', args: { CommandLine: 'npm test', Cwd: ws } },
        ...extra
      });
      const errState = readHandoff(ws, convErr);
      assert.strictEqual(errState.status, 'failed', `explicit host error case ${idx} must fail`);
      assert.ok(!errState.lastVerifyAt, `explicit host error case ${idx} must not grant lastVerifyAt`);
    }
  }

  // 4. P516-B2 repair rows: error normalization precedence, no generic pending/background bypass, text-only lookalikes, and packaged PostToolUse -> handoff -> Stop positive control
  {
    const ws = makeWs('ws-b2-repair');

    // Row 1: blank top-level error + nonblank nested error + exitCode 0 -> failed, verification stale, packaged Stop continue
    for (const [idx, variant] of [
      { error: '   ', toolResponse: { error: 'explicit host error' }, exitCode: 0 },
      { error: '\t\n ', tool_response: { error: 'nested tool_response error', exitCode: 0 } },
      { error: '   ', result: { error: { message: 'nested result error' } }, exitCode: 0 }
    ].entries()) {
      const conv = `conv-516-b2-nested-err-${idx}`;
      runPackagedPostTool({
        conversationId: conv,
        workspacePaths: [ws],
        toolCall: { name: 'write_file', args: { Path: path.join(ws, `edit-${idx}.js`), Content: '1' } }
      });
      const afterEdit = readHandoff(ws, conv);
      assert.ok(afterEdit.lastEditAt > 0, `row 1.${idx}: write_file must set lastEditAt`);

      const mapped = mapAgyPayloadToStatePersist({
        conversationId: conv,
        workspacePaths: [ws],
        toolCall: { name: 'run_command', args: { CommandLine: 'npm test', Cwd: ws } },
        ...variant
      });
      assert.strictEqual(mapped.hook_event_name, 'PostToolUseFailure', `row 1.${idx}: blank top-level error must fall back to nested error`);
      assert.strictEqual(mapped.exitCode, undefined, `row 1.${idx}: exitCode 0 must be withheld on explicit nested error`);

      runPackagedPostTool({
        conversationId: conv,
        workspacePaths: [ws],
        toolCall: { name: 'run_command', args: { CommandLine: 'npm test', Cwd: ws } },
        ...variant
      });
      const state = readHandoff(ws, conv);
      assert.strictEqual(state.status, 'failed', `row 1.${idx}: blank top-level error + nonblank nested error + exitCode 0 must stay failed`);
      assert.ok(!state.lastVerifyAt, `row 1.${idx}: must leave lastVerifyAt unset (verification stale)`);

      const stopRes = runPackagedStop({
        conversationId: conv,
        workspacePaths: [ws],
        continuationActive: false,
        terminationReason: 'NO_TOOL_CALL'
      });
      assert.strictEqual(stopRes.decision, 'continue', `row 1.${idx}: packaged Stop must return continue`);
      assert.ok(stopRes.reason.includes('pending tool failure'), `row 1.${idx}: Stop reason must cite pending tool failure`);
    }

    // Row 2: status: "queued" (and background: true) + recognized check + numeric zero -> normal credit (no bypass)
    for (const [idx, extra] of [
      { status: 'queued', exitCode: 0 },
      { background: true, exitCode: 0 },
      { toolResponse: { status: 'queued', exit_code: 0 } },
      { toolResponse: { background: true, exitCode: 0 } },
      { isBackground: true, exitCode: 0 }
    ].entries()) {
      const conv = `conv-516-b2-queued-verify-${idx}`;
      runPackagedPostTool({
        conversationId: conv,
        workspacePaths: [ws],
        toolCall: { name: 'write_file', args: { Path: path.join(ws, `q-${idx}.js`), Content: '1' } }
      });
      const afterEdit = readHandoff(ws, conv);
      assert.ok(afterEdit.lastEditAt > 0);

      const checkPayload = {
        conversationId: conv,
        workspacePaths: [ws],
        toolCall: { name: 'run_command', args: { CommandLine: 'npm test', Cwd: ws } },
        ...extra
      };
      const mapped = mapAgyPayloadToStatePersist(checkPayload);
      assert.ok(mapped !== null, `row 2.${idx}: generic queued/background metadata must not bypass state-persist`);

      runPackagedPostTool(checkPayload);
      const afterVerify = readHandoff(ws, conv);
      assert.strictEqual(afterVerify.status, 'idle', `row 2.${idx}: recognized check with exitCode 0 must stay idle`);
      assert.strictEqual(afterVerify.lastVerifyExitCode, 0, `row 2.${idx}: must record lastVerifyExitCode 0`);
      assert.ok(afterVerify.lastVerifyAt >= afterEdit.lastEditAt, `row 2.${idx}: must advance lastVerifyAt normally`);

      const stopRes = runPackagedStop({
        conversationId: conv,
        workspacePaths: [ws],
        continuationActive: false,
        terminationReason: 'NO_TOOL_CALL'
      });
      assert.deepStrictEqual(stopRes, { decision: 'allow' }, `row 2.${idx}: packaged Stop must allow after credited zero`);
    }

    // Row 3: status: "queued" (and background: true) on an in-workspace write_file -> edit persisted (no bypass)
    for (const [idx, extra] of [
      { status: 'queued' },
      { background: true },
      { toolResponse: { status: 'queued' } }
    ].entries()) {
      const conv = `conv-516-b2-queued-write-${idx}`;
      const writePayload = {
        conversationId: conv,
        workspacePaths: [ws],
        toolCall: { name: 'write_file', args: { Path: path.join(ws, `write-${idx}.js`), Content: 'export const x = 1;' } },
        ...extra
      };
      const mapped = mapAgyPayloadToStatePersist(writePayload);
      assert.ok(mapped !== null, `row 3.${idx}: write_file with generic metadata must not bypass state-persist`);

      runPackagedPostTool(writePayload);
      const afterWrite = readHandoff(ws, conv);
      assert.ok(afterWrite.lastEditAt > 0, `row 3.${idx}: in-workspace write_file with ${JSON.stringify(extra)} must persist lastEditAt`);

      const stopRes = runPackagedStop({
        conversationId: conv,
        workspacePaths: [ws],
        continuationActive: false,
        terminationReason: 'model_stop'
      });
      assert.strictEqual(stopRes.decision, 'continue', `row 3.${idx}: unverified persisted edit must make packaged Stop continue`);
    }

    // Row 4: text-only "Command exited with code 0." / "Tool is running as a background task" in stdout -> no credit, no bypass
    for (const [idx, caseDef] of [
      { cmd: 'npm test', extra: { toolResponse: { stdout: 'Command exited with code 0.' } } },
      { cmd: 'npm test', extra: { output: 'Command exited with code 0.' } },
      { cmd: 'npm test', extra: { toolResponse: { stdout: 'Tool is running as a background task' } } },
      { cmd: 'npm test', extra: { output: 'Tool is running as a background task' } },
      { cmd: 'node dev-server.js', extra: { toolResponse: { stdout: 'Tool is running as a background task' } } },
      { cmd: 'node dev-server.js', extra: { output: 'Tool is running as a background task' } }
    ].entries()) {
      const conv = `conv-516-b2-text-only-${idx}`;
      runPackagedPostTool({
        conversationId: conv,
        workspacePaths: [ws],
        toolCall: { name: 'write_file', args: { Path: path.join(ws, `t-${idx}.js`), Content: '1' } }
      });
      const before = readHandoff(ws, conv);

      const textPayload = {
        conversationId: conv,
        workspacePaths: [ws],
        toolCall: { name: 'run_command', args: { CommandLine: caseDef.cmd, Cwd: ws } },
        ...caseDef.extra
      };
      const mapped = mapAgyPayloadToStatePersist(textPayload);
      assert.ok(mapped !== null, `row 4.${idx}: text-only lookalike must not bypass state-persist`);
      assert.strictEqual(mapped.exitCode, undefined, `row 4.${idx}: text-only lookalike must not synthesize exitCode`);

      runPackagedPostTool(textPayload);
      const after = readHandoff(ws, conv);
      assert.ok(!after.lastVerifyAt, `row 4.${idx}: text-only lookalike must not grant verification credit`);
      if (caseDef.cmd === 'npm test') {
        assert.strictEqual(after.lastEditAt, before.lastEditAt, `row 4.${idx}: recognized check with unknown text must preserve lastEditAt`);
      }

      const stopRes = runPackagedStop({
        conversationId: conv,
        workspacePaths: [ws],
        continuationActive: false,
        terminationReason: 'NO_TOOL_CALL'
      });
      assert.strictEqual(stopRes.decision, 'continue', `row 4.${idx}: packaged Stop must continue when no verification credit was earned`);
    }

    // Row 5: positive control - clean numeric zero on a recognized check -> credit + packaged Stop allow
    {
      const conv = 'conv-516-b2-positive-control';
      runPackagedPostTool({
        conversationId: conv,
        workspacePaths: [ws],
        toolCall: { name: 'write_file', args: { Path: path.join(ws, 'pos.js'), Content: '1' } }
      });
      const afterEdit = readHandoff(ws, conv);
      assert.strictEqual(
        runPackagedStop({
          conversationId: conv,
          workspacePaths: [ws],
          continuationActive: false,
          terminationReason: 'NO_TOOL_CALL'
        }).decision,
        'continue',
        'row 5: packaged Stop must continue before verification'
      );

      runPackagedPostTool({
        conversationId: conv,
        workspacePaths: [ws],
        toolCall: { name: 'run_command', args: { CommandLine: 'npm test', Cwd: ws } },
        exitCode: 0
      });
      const afterVerify = readHandoff(ws, conv);
      assert.strictEqual(afterVerify.status, 'idle');
      assert.strictEqual(afterVerify.lastVerifyExitCode, 0);
      assert.ok(afterVerify.lastVerifyAt >= afterEdit.lastEditAt, 'row 5: clean numeric zero must advance lastVerifyAt');

      const stopAllow = runPackagedStop({
        conversationId: conv,
        workspacePaths: [ws],
        continuationActive: false,
        terminationReason: 'NO_TOOL_CALL'
      });
      assert.deepStrictEqual(stopAllow, { decision: 'allow' }, 'row 5: packaged Stop must allow after clean numeric zero');
    }
  }

  console.log('AGY PostToolUse completion normalization (P516-B) verified.');
} finally {
  if (originalStateHome === undefined) delete process.env.HARNESS_STATE_HOME;
  else process.env.HARNESS_STATE_HOME = originalStateHome;
  fs.rmSync(tempRoot, { recursive: true, force: true });
}
