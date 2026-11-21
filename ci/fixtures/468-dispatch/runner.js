'use strict';

const fs = require('node:fs');
const path = require('node:path');

const scriptName = path.basename(process.argv[1]);
const runner = scriptName === 'exec' ? 'codex' : 'opencode';
const args = [scriptName, ...process.argv.slice(2)];
const outputFlag = args.indexOf('-o');
const outputPath = outputFlag >= 0 ? args[outputFlag + 1] : null;
const prompt = args.at(-1) || '';
const phase = prompt === 'Reply with the single word READY' ? 'readiness' : 'execution';
const scenario = process.env[`DISPATCH_FIXTURE_${phase.toUpperCase()}`] || 'ready';
const input = fs.readFileSync(0, 'utf8');
const providerRateLimit = 'Provider request failed with HTTP 429: {"status":429,"title":"Too Many Requests"}';
const providerQuota = 'Free usage limit reached. Free models work in OpenCode (https://opencode.ai); subscribe to OpenCode Go to keep going: https://opencode.ai/go';
const providerTimeout = 'Timed out waiting for response headers';

fs.appendFileSync(process.env.DISPATCH_FIXTURE_LOG, `${JSON.stringify({
  runner,
  phase,
  scenario,
  args,
  cwd: process.cwd(),
  tmpdir: process.env.TMPDIR,
  stdin: input,
  stdinIsCharacterDevice: fs.fstatSync(0).isCharacterDevice(),
  pid: process.pid,
})}\n`);

function hang() {
  setInterval(() => {}, 1000);
}

function readyOutput() {
  if (['no-ready', 'rate-limited', 'quota-exhausted', 'rate-limit-and-quota', 'quota-and-rate-limit', 'stdout-provider-rate', 'wrong-envelope', 'quoted-provider-rate', 'local-http-429', 'invalid-quota', 'bare-429', 'provider-rate-with-extra-text', 'provider-timeout', 'timeout', 'signal-provider-rate'].includes(scenario)) return;
  const answer = {
    'ready-period': 'READY.\n',
    'ready-padded-period': ' \tREADY. \n',
    'ready-now': 'READY now\n',
    'not-ready': 'NOT READY\n',
    'ready-two-dots': 'READY ..\n',
    'ready-lowercase': 'ready\n',
    'ready-commentary': 'READY\nAdditional commentary.\n',
    'ready-period-failed': 'READY.\n',
    'ready-period-timeout': 'READY.\n',
    'ready-period-signal': 'READY.\n',
    // Live OpenCode reply 2026-11-21: the Harness turn-label rule appends a label line.
    'ready-host-label': 'READY\n<!-- harness-label {"v":1,"validity":"actionable","tier":"tier1","intents":[],"workflow":"deferred","skills":[]} -->\n',
    'ready-bad-label': 'READY\n<!-- harness-label not json -->\n',
    'ready-bad-schema-label': 'READY\n<!-- harness-label {"bad":true} -->\n',
    'ready-label-then-text': 'READY\n<!-- harness-label {"v":1,"validity":"actionable","tier":"tier1","intents":[],"workflow":"deferred","skills":[]} -->\nmore\n',
  }[scenario] || 'READY\n';
  if (runner === 'codex') {
    if (outputPath) fs.writeFileSync(outputPath, answer);
  } else process.stdout.write(answer);
}

function diagnosticLine(message) {
  const prefix = runner === 'codex' ? 'ERROR: ' : 'Error: ';
  return `\u001b[91m\u001b[1m${prefix}\u001b[0m${message}\n`;
}

function codexOutput() {
  if (scenario === 'missing-raw') return null;
  if (scenario === 'no-status') return 'Fixture output without a terminal status.\n';
  if (scenario === 'multiple-status') return 'Fixture output.\nSTATUS: DONE\nSTATUS: BLOCKED: missing evidence\n';
  if (scenario === 'bad-label') return 'Fixture completed the packet.\nSTATUS: DONE\n<!-- harness-label {"bad":true} -->\n';
  if (scenario === 'blocked') return 'Fixture could not verify the packet.\nSTATUS: BLOCKED: missing evidence\n';
  if (scenario === 'raw-label-blank') {
    // Live codex -o shape 2026-11-21: one blank line between STATUS and the label.
    return 'Fixture completed the packet.\nSTATUS: DONE\n\n<!-- harness-label {"v":1,"validity":"actionable","tier":"tier1","intents":["edit"],"workflow":null,"skills":[]} -->';
  }
  if (scenario === 'raw-label') {
    return 'Fixture completed the packet.\nSTATUS: DONE\n<!-- harness-label {"v":1,"validity":"actionable","tier":"tier2","intents":["test"],"workflow":"iterative-single","skills":["test-driven-development"]} -->\n';
  }
  return 'Fixture completed the packet.\nSTATUS: DONE\n';
}

function openCodeReport() {
  if (scenario === 'missing-report' || scenario === 'timeout') return null;
  if (scenario === 'malformed-report' || scenario === 'no-status') return 'Fixture report with no terminal status.\n';
  if (scenario === 'multiple-status') return 'Fixture report.\nSTATUS: DONE\nSTATUS: BLOCKED: missing evidence\n';
  if (scenario === 'blocked') return 'Fixture could not verify the packet.\nSTATUS: BLOCKED: missing evidence\n';
  return 'Fixture completed the packet.\nSTATUS: DONE\n';
}

function executionOutput() {
  if (runner === 'codex') {
    const raw = codexOutput();
    if (raw !== null && outputPath) fs.writeFileSync(outputPath, raw);
  } else {
    const report = openCodeReport();
    if (report !== null) fs.writeFileSync(process.env.DISPATCH_FIXTURE_REPORT_PATH, report);
  }
  process.stdout.write('fixture child output\n');
}

if (phase === 'readiness') {
  if (scenario === 'timeout' || scenario === 'ready-period-timeout') {
    process.stderr.write(diagnosticLine(providerRateLimit));
    hang();
  }
  readyOutput();
  if (scenario === 'rate-limited') {
    process.stderr.write(diagnosticLine(providerRateLimit));
    process.exitCode = 7;
  } else if (scenario === 'quota-exhausted') {
    process.stderr.write(diagnosticLine(providerQuota));
    process.exitCode = 7;
  } else if (scenario === 'rate-limit-and-quota' || scenario === 'quota-and-rate-limit') {
    const diagnostics = [providerRateLimit, providerQuota];
    if (scenario === 'quota-and-rate-limit') diagnostics.reverse();
    process.stderr.write(diagnostics.map(diagnosticLine).join(''));
    process.exitCode = 7;
  } else if (scenario === 'stdout-provider-rate') {
    process.stdout.write(diagnosticLine(providerRateLimit));
    process.exitCode = 7;
  } else if (scenario === 'wrong-envelope') {
    process.stderr.write(`Warning: ${diagnosticLine(providerRateLimit)}`);
    process.exitCode = 7;
  } else if (scenario === 'quoted-provider-rate') {
    process.stderr.write(`Quoted text: ${diagnosticLine(providerRateLimit)}`);
    process.exitCode = 7;
  } else if (scenario === 'local-http-429') {
    process.stderr.write(diagnosticLine('local cache lookup failed with HTTP 429'));
    process.exitCode = 7;
  } else if (scenario === 'invalid-quota') {
    process.stderr.write(diagnosticLine('invalid --quota value; expected a positive integer'));
    process.exitCode = 7;
  } else if (scenario === 'bare-429') {
    process.stderr.write('429 Too Many Requests\n');
    process.exitCode = 7;
  } else if (scenario === 'provider-rate-with-extra-text') {
    process.stderr.write(diagnosticLine(`${providerRateLimit} retry later`));
    process.exitCode = 7;
  } else if (scenario === 'provider-timeout') {
    process.stderr.write(diagnosticLine(providerTimeout));
    process.exitCode = 7;
  } else if (scenario === 'signal-provider-rate') {
    process.stderr.write(diagnosticLine(providerRateLimit));
    process.kill(process.pid, 'SIGTERM');
  } else if (scenario === 'ready-with-provider-rate') {
    process.stderr.write(diagnosticLine(providerRateLimit));
  } else if (scenario === 'ready-failed') {
    process.exitCode = 7;
  } else if (scenario === 'ready-period-failed') {
    process.exitCode = 7;
  } else if (scenario === 'ready-period-signal') {
    process.stderr.write(diagnosticLine(providerRateLimit));
    process.kill(process.pid, 'SIGTERM');
  } else if (scenario === 'ready-with-quota-prose') {
    process.stderr.write(runner === 'codex'
      ? 'Quoted policy: ERROR: HTTP 429 quota is not a readiness failure on exit zero.\n'
      : 'Quoted policy: Error: HTTP 429 quota is not a readiness failure on exit zero.\n');
  } else if (scenario === 'create-stale-report') {
    fs.writeFileSync(process.env.DISPATCH_FIXTURE_REPORT_PATH, 'Stale report.\nSTATUS: DONE\n');
  } else if (scenario === 'remove-scratch') {
    fs.rmSync(process.env.TMPDIR, { recursive: true, force: true });
  }
} else {
  if (scenario === 'timeout') hang();
  executionOutput();
  if (scenario === 'exit-failure') process.exitCode = 7;
  if (scenario === 'done-with-quota-prose') {
    process.stderr.write(runner === 'codex'
      ? 'Quoted worker text: ERROR: HTTP 429 quota is not a runner failure.\n'
      : 'Quoted worker text: Error: HTTP 429 quota is not a runner failure.\n');
  }
}
