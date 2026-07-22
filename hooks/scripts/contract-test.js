#!/usr/bin/env node
/**
 * Contract Test (PostToolUse: Bash|PowerShell)
 * Resolves fable-mode stage contracts. fable-orchestrator's discipline says
 * every stage check must be "re-run or spot-checked... before building on
 * its output" - but a verbal claim of "I re-ran it" isn't auditable. So the
 * orchestrator now writes .claude/harness-state/contracts/<stageId>.json with
 * status:"pending" and the exact checkCommand BEFORE running it. This hook
 * watches every shell call; when the command matches a pending contract's
 * checkCommand verbatim, it records pass/fail into that manifest using the
 * same exitCode-or-stderr heuristic as rule-of-3-tracker.js.
 * Contracts are shared across sessions, not scoped to one - the orchestrator
 * writes them proactively (not in response to a hook message) and has no
 * clean way to learn its own session_id, so a collision only matters if two
 * fable-mode orchestrations run in the same repo at once.
 * Contracts are audit trail, not synchronous enforcement - EXCEPT when a
 * check this hook just resolved comes back FAILED, it surfaces that loudly
 * (exit 2) so silently building on a failed stage doesn't slip through.
 * Fails open on any parse/lookup error.
 */
const fs = require('fs');
const path = require('path');
const { getWorkspaceRoot, getStateRoot } = require('./lib/harness-state');

let inputData = '';
process.stdin.on('data', chunk => { inputData += chunk; });
process.stdin.on('end', () => {
  try {
    const payload = JSON.parse(inputData);
    if (payload.tool_name !== 'Bash' && payload.tool_name !== 'PowerShell') process.exit(0);

    const command = ((payload.tool_input && payload.tool_input.command) || '').trim();
    if (!command) process.exit(0);

    const contractsDir = path.join(getStateRoot(getWorkspaceRoot()), 'contracts');
    if (!fs.existsSync(contractsDir)) process.exit(0);

    const toolResponse = payload.tool_response || {};
    const stdout = toolResponse.stdout ?? payload.stdout ?? '';
    const stderr = toolResponse.stderr ?? payload.stderr ?? '';
    const rawExitCode = toolResponse.exitCode ?? toolResponse.exit_code ?? payload.exitCode;
    const exitCode = typeof rawExitCode === 'number' ? rawExitCode : undefined;
    const stderrSignal = typeof stderr === 'string' && stderr.trim().length > 0;
    const failed = (exitCode !== undefined && exitCode !== 0) || (exitCode === undefined && stderrSignal);

    const files = fs.readdirSync(contractsDir).filter(f => f.endsWith('.json'));
    let firstFailure = null;

    for (const file of files) {
      const manifestPath = path.join(contractsDir, file);
      let manifest;
      try {
        manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
      } catch (e) {
        continue;
      }
      if (manifest.status !== 'pending') continue;
      if (!manifest.checkCommand || manifest.checkCommand.trim() !== command) continue;

      manifest.status = failed ? 'fail' : 'pass';
      manifest.evidence = ((stderrSignal ? stderr : stdout) || '').slice(-500).trim();
      manifest.verifiedAt = new Date().toISOString();
      fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), 'utf8');

      if (failed && !firstFailure) firstFailure = manifest;
    }

    if (firstFailure) {
      console.error(`[Contract Test] Stage "${firstFailure.stageId}" FAILED its named check: ${firstFailure.checkCommand}`);
      console.error(`Evidence: ${firstFailure.evidence || '(no output captured)'}`);
      console.error(`Do not build on this stage's output until it passes. Artifact: ${firstFailure.outputPath || '(no path recorded)'}`);
      process.exit(2);
    }

    process.exit(0);
  } catch (err) {
    process.exit(0);
  }
});
