'use strict';

const fs = require('node:fs');
const path = require('node:path');

const scriptName = path.basename(process.argv[1]);
const runner = scriptName === 'exec' ? 'codex' : 'opencode';
const args = [scriptName, ...process.argv.slice(2)];
const outputFlag = args.indexOf('-o');
const outputPath = outputFlag >= 0 ? args[outputFlag + 1] : null;
const prompt = args.at(-1) || '';
const phase = prompt === 'Reply exactly with READY.' ? 'readiness' : 'execution';
const scenario = process.env[`DISPATCH_FIXTURE_${phase.toUpperCase()}`] || 'ready';
const input = fs.readFileSync(0, 'utf8');

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
  if (scenario === 'no-ready' || scenario === 'quota' || scenario === 'stdout-quota' || scenario === 'quoted-quota' || scenario === 'bare-429' || scenario === 'timeout') return;
  if (runner === 'codex') {
    if (outputPath) fs.writeFileSync(outputPath, 'READY\n');
  } else process.stdout.write('READY\n');
}

function codexOutput() {
  if (scenario === 'missing-raw') return null;
  if (scenario === 'no-status') return 'Fixture output without a terminal status.\n';
  if (scenario === 'multiple-status') return 'Fixture output.\nSTATUS: DONE\nSTATUS: BLOCKED: missing evidence\n';
  if (scenario === 'bad-label') return 'Fixture completed the packet.\nSTATUS: DONE\n<!-- harness-label {"bad":true} -->\n';
  if (scenario === 'blocked') return 'Fixture could not verify the packet.\nSTATUS: BLOCKED: missing evidence\n';
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
  if (scenario === 'timeout') hang();
  readyOutput();
  if (scenario === 'quota') {
    process.stderr.write(runner === 'codex'
      ? '\u001b[31mERROR: provider returned HTTP 429 quota exhausted\u001b[0m\n'
      : '\u001b[31mError: provider returned HTTP 429 usage limit reached\u001b[0m\n');
    process.exitCode = 7;
  } else if (scenario === 'stdout-quota') {
    process.stdout.write(runner === 'codex' ? 'ERROR: HTTP 429 quota exhausted\n' : 'Error: HTTP 429 quota exhausted\n');
    process.exitCode = 7;
  } else if (scenario === 'unrelated-quota') {
    process.stderr.write(runner === 'codex'
      ? 'ERROR: invalid --quota value; expected a positive integer\n'
      : 'Error: invalid --quota value; expected a positive integer\n');
    process.exitCode = 7;
  } else if (scenario === 'bare-429') {
    process.stderr.write(runner === 'codex'
      ? 'ERROR: unrelated operation failed with code 429\n'
      : 'Error: unrelated operation failed with code 429\n');
    process.exitCode = 7;
  } else if (scenario === 'quoted-quota') {
    process.stderr.write(runner === 'codex'
      ? 'Quoted text: "ERROR: provider returned HTTP 429 quota exhausted"\n'
      : 'Quoted text: "Error: provider returned HTTP 429 quota exhausted"\n');
    process.exitCode = 7;
  } else if (scenario === 'ready-failed') {
    process.exitCode = 7;
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
