'use strict';

// Codex PostToolUse runs for both zero and nonzero exits. A string response
// can contain arbitrary command output and is never evidence of an exit code.
function readCodexToolOutcome(payload) {
  const raw = payload?.tool_response ?? payload?.toolResponse;
  const response = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  const codes = [response.exitCode, response.exit_code, payload?.exitCode, payload?.exit_code]
    .filter(Number.isInteger);
  const exitCode = codes.find(code => code !== 0) ?? codes[0];
  const stdout = typeof raw === 'string' ? raw : response.stdout ?? payload?.stdout;
  const stderr = response.stderr ?? payload?.stderr;
  const shell = ['Bash', 'PowerShell', 'exec_command'].includes(payload?.tool_name);
  const failed = exitCode !== undefined && exitCode !== 0 ||
    response.isError === true || response.is_error === true ||
    response.success === false || response.ok === false;
  const succeeded = exitCode === 0 || (!shell &&
    (response.isError === false || response.is_error === false ||
     response.success === true || response.ok === true));
  return {
    outcome: failed ? 'failure' : succeeded ? 'success' : 'unknown',
    exitCode,
    stdout: typeof stdout === 'string' ? stdout : '',
    stderr: typeof stderr === 'string' ? stderr : '',
  };
}

module.exports = { readCodexToolOutcome };
