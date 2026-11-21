#!/usr/bin/env node
'use strict';

const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const REPORT_WRITER = path.join(__dirname, 'report-writer.js');
const USAGE = 'Usage: dispatch --runner <codex|opencode> --model <id> --packet <path> --worktree <path> --scratch <absolute-path> --report <path> [--dry-run] [--json] [--help]';
const VALUE_OPTIONS = new Set(['--runner', '--model', '--packet', '--worktree', '--scratch', '--report']);
let evidencePaths = {};

class DispatchFailure extends Error {
  constructor(exitCode, code, phase, message) {
    super(message);
    this.exitCode = exitCode;
    this.code = code;
    this.phase = phase;
  }
}

function fail(exitCode, code, phase, message) {
  throw new DispatchFailure(exitCode, code, phase, message);
}

function parseArgs(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    if (flag === '--json' || flag === '--dry-run' || flag === '--help') {
      if (options[flag]) fail(10, 'INVALID_INPUT', 'input', `duplicate option: ${flag}`);
      options[flag] = true;
    } else if (VALUE_OPTIONS.has(flag)) {
      if (options[flag] !== undefined) fail(10, 'INVALID_INPUT', 'input', `duplicate option: ${flag}`);
      const value = argv[index + 1];
      if (!value || value.startsWith('--')) fail(10, 'INVALID_INPUT', 'input', `missing value for ${flag}`);
      options[flag] = value;
      index += 1;
    } else {
      fail(10, 'INVALID_INPUT', 'input', `unknown option: ${flag}`);
    }
  }
  return options;
}

function realPath(file) {
  try { return fs.realpathSync.native(file); } catch { return null; }
}

function hasGitMetadata(directory) {
  try {
    return fs.statSync(path.join(directory, 'HEAD')).isFile()
      && fs.statSync(path.join(directory, 'objects')).isDirectory()
      && fs.statSync(path.join(directory, 'refs')).isDirectory()
      && fs.statSync(path.join(directory, 'config')).isFile();
  } catch { return false; }
}

function isGitRoot(directory) {
  const marker = path.join(directory, '.git');
  try {
    const stat = fs.statSync(marker);
    if (stat.isDirectory()) return hasGitMetadata(marker);
    if (stat.isFile()) {
      const match = /^gitdir:\s*(.+)\s*$/i.exec(fs.readFileSync(marker, 'utf8'));
      if (!match) return false;
      const gitdir = path.resolve(directory, match[1]);
      const commonFile = path.join(gitdir, 'commondir');
      const commonDir = fs.existsSync(commonFile) ? path.resolve(gitdir, fs.readFileSync(commonFile, 'utf8').trim()) : gitdir;
      return hasGitMetadata(commonDir);
    }
  } catch {}
  return hasGitMetadata(directory);
}

function canonicalFuturePath(file) {
  let ancestor = path.resolve(file);
  const suffix = [];
  while (!fs.existsSync(ancestor)) {
    const parent = path.dirname(ancestor);
    if (parent === ancestor) break;
    suffix.unshift(path.basename(ancestor));
    ancestor = parent;
  }
  const canonicalAncestor = realPath(ancestor);
  return canonicalAncestor ? path.resolve(canonicalAncestor, ...suffix) : path.resolve(file);
}

function gitAncestor(directory) {
  let current = directory;
  while (true) {
    if (isGitRoot(current)) return current;
    const parent = path.dirname(current);
    if (parent === current) return null;
    current = parent;
  }
}

function validateScratch(value) {
  if (!path.isAbsolute(value)) fail(11, 'UNSAFE_SCRATCH', 'validation', 'scratch must be an absolute path outside every Git repository or worktree');
  const scratch = canonicalFuturePath(value);
  if (fs.existsSync(value) && !fs.statSync(value).isDirectory()) {
    fail(11, 'UNSAFE_SCRATCH', 'validation', 'scratch must be a directory outside every Git repository or worktree');
  }
  const repository = gitAncestor(scratch);
  if (repository) fail(11, 'UNSAFE_SCRATCH', 'validation', `scratch is inside a Git repository or worktree: ${repository}`);
  return path.resolve(value);
}

function pathFrom(base, value) {
  return path.resolve(base, value);
}

function validateInput(options) {
  const runner = options['--runner'];
  const model = options['--model'];
  if (!['codex', 'opencode'].includes(runner)) fail(10, 'INVALID_INPUT', 'input', '--runner must be codex or opencode');
  if (!model || !model.trim()) fail(10, 'INVALID_INPUT', 'input', '--model must be a nonempty id');
  for (const flag of ['--packet', '--worktree', '--scratch', '--report']) {
    if (!options[flag]) fail(10, 'INVALID_INPUT', 'input', `missing required option: ${flag}`);
  }

  const requestedWorktree = path.resolve(options['--worktree']);
  const worktree = realPath(requestedWorktree);
  if (!worktree || !fs.statSync(worktree).isDirectory() || !isGitRoot(worktree)) {
    fail(10, 'INVALID_INPUT', 'input', '--worktree must name an existing Git repository or worktree root');
  }
  const packet = pathFrom(worktree, options['--packet']);
  if (!fs.existsSync(packet) || !fs.statSync(packet).isFile()) fail(10, 'INVALID_INPUT', 'input', '--packet must name an existing file');
  const report = pathFrom(worktree, options['--report']);
  if (!fs.existsSync(path.dirname(report)) || !fs.statSync(path.dirname(report)).isDirectory()) {
    fail(10, 'INVALID_INPUT', 'input', '--report parent directory must already exist');
  }
  if (fs.existsSync(report)) fail(10, 'INVALID_INPUT', 'input', '--report already exists; choose a fresh report path');
  const scratch = validateScratch(options['--scratch']);
  return { runner, model: model.trim(), packet, worktree, scratch, report };
}

function response(options, outcome, evidence = evidencePaths, input) {
  const message = String(outcome.message || '').slice(0, 1000);
  const result = {
    ok: outcome.exitCode === 0,
    code: outcome.code,
    phase: outcome.phase,
    message,
  };
  const runner = input?.runner ?? options['--runner'];
  const model = input?.model ?? options['--model'];
  if (runner === 'codex' || runner === 'opencode') result.runner = runner;
  if (model) result.model = model;
  if (outcome.argv) result.argv = outcome.argv;
  if (outcome.cwd) result.cwd = outcome.cwd;
  const paths = Object.fromEntries(Object.entries(evidence).filter(([, value]) => value && fs.existsSync(value)));
  if (Object.keys(paths).length) result.evidence = paths;
  if (options['--json']) process.stdout.write(`${JSON.stringify(result)}\n`);
  else if (outcome.exitCode === 0) process.stdout.write(`${message}\n`);
  else process.stderr.write(`dispatch: ${message}\n`);
  process.exitCode = outcome.exitCode;
}

function childTimeout(timeout) {
  // Keep fixture timeout cases bounded while production retains its fixed limits.
  const testTimeout = Number(process.env.DISPATCH_TEST_TIMEOUT_MS);
  return process.env.NODE_ENV === 'test' && Number.isSafeInteger(testTimeout) && testTimeout > 0
    ? Math.min(timeout, testTimeout)
    : timeout;
}

function runChild(command, args, worktree, scratch, logPath, timeout, appendLog = false) {
  const result = spawnSync(command, args, {
    cwd: worktree,
    env: { ...process.env, TMPDIR: scratch },
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: childTimeout(timeout),
    maxBuffer: 16 * 1024 * 1024,
  });
  const stdout = result.stdout || '';
  const stderr = result.stderr || '';
  const log = `${stdout}${stderr ? `${stdout ? '\n' : ''}[stderr]\n${stderr}` : ''}`;
  if (appendLog) fs.appendFileSync(logPath, log);
  else fs.writeFileSync(logPath, log);
  return { ...result, stdout, stderr };
}

function runnerArgs(input, prompt, outputPath) {
  if (input.runner === 'codex') {
    return ['exec', '-m', input.model, '-s', 'workspace-write', '-C', input.worktree, '-o', outputPath, prompt];
  }
  return ['run', '--auto', '-m', input.model, prompt];
}

const READINESS_DIAGNOSTICS = {
  codex: [
    { line: 'ERROR: Provider request failed with HTTP 429: {"status":429,"title":"Too Many Requests"}', code: 'RUNNER_RATE_LIMITED', message: 'Reduce concurrency on the affected key or retry later.' },
    { line: 'ERROR: Free usage limit reached. Free models work in OpenCode (https://opencode.ai); subscribe to OpenCode Go to keep going: https://opencode.ai/go', code: 'RUNNER_QUOTA', message: 'Select an authorized runner or model with available quota.' },
  ],
  opencode: [
    { line: 'Error: Provider request failed with HTTP 429: {"status":429,"title":"Too Many Requests"}', code: 'RUNNER_RATE_LIMITED', message: 'Reduce concurrency on the affected key or retry later.' },
    { line: 'Error: Free usage limit reached. Free models work in OpenCode (https://opencode.ai); subscribe to OpenCode Go to keep going: https://opencode.ai/go', code: 'RUNNER_QUOTA', message: 'Select an authorized runner or model with available quota.' },
  ],
};

function readinessDiagnostic(runner, stderr) {
  const output = stderr.replace(/\u001b\[[0-?]*[ -/]*[@-~]/g, '');
  const lines = output.split(/\r?\n/);
  const matches = READINESS_DIAGNOSTICS[runner].filter(diagnostic => lines.includes(diagnostic.line));
  return matches.length === 1 ? matches[0] : null;
}

function readiness(input, paths) {
  const outputPath = input.runner === 'codex' ? paths.readinessOutput : null;
  const prompt = 'Reply exactly with READY.';
  const result = runChild(input.runner, runnerArgs(input, prompt, outputPath), input.worktree, input.scratch, paths.readinessLog, 120000);
  if (result.status !== 0) {
    const diagnostic = Number.isInteger(result.status) && result.status !== 0 && !result.signal && !result.error
      ? readinessDiagnostic(input.runner, result.stderr)
      : null;
    if (diagnostic) fail(13, diagnostic.code, 'readiness', diagnostic.message);
    fail(12, 'NOT_READY', 'readiness', 'Readiness failed. Keep the available child evidence.');
  }
  const answer = input.runner === 'codex'
    ? (fs.existsSync(outputPath) ? fs.readFileSync(outputPath, 'utf8').trim() : '')
    : result.stdout.trim();
  if (answer !== 'READY') fail(12, 'NOT_READY', 'readiness', 'Readiness failed. Keep the available child evidence.');
}

function reportedStatus(raw) {
  const lines = raw.split(/\r?\n/);
  if (lines.at(-1) === '') lines.pop();
  if (lines.at(-1)?.startsWith('<!-- harness-label ')) lines.pop();
  const line = lines.at(-1) || '';
  if (line === 'STATUS: DONE') return { status: 'DONE' };
  const blocked = /^STATUS: BLOCKED: (.+)$/.exec(line);
  if (blocked && blocked[1].trim()) return { status: 'BLOCKED', reason: blocked[1].trim() };
  fail(16, 'REPORT_INVALID', 'report', 'Codex output must end with STATUS: DONE or STATUS: BLOCKED: <reason>');
}

function reportWriter(input, paths, command, args) {
  const result = runChild(process.execPath, [REPORT_WRITER, ...args], input.worktree, input.scratch, paths.writerLog, 120000, true);
  if (result.status !== 0) fail(16, 'REPORT_INVALID', 'report', result.stderr.trim() || `${command} rejected the report`);
  return result;
}

function executionPrompt(input) {
  return input.runner === 'codex'
    ? `Execute the packet at ${input.packet} and return the complete report body.`
    : `Execute the packet at ${input.packet} and write the complete report to ${input.report}.`;
}

function execute(input, options) {
  fs.mkdirSync(input.scratch, { recursive: true });
  const runId = `${process.pid}-${Date.now()}`;
  const paths = {
    readinessOutput: path.join(input.scratch, `${runId}.readiness.txt`),
    readinessLog: path.join(input.scratch, `${runId}.readiness.log`),
    rawOutput: path.join(input.scratch, `${runId}.raw.txt`),
    runLog: path.join(input.scratch, `${runId}.run.log`),
    writerLog: path.join(input.scratch, `${runId}.report-writer.log`),
  };
  evidencePaths = {
    readinessOutput: input.runner === 'codex' ? paths.readinessOutput : null,
    readinessLog: paths.readinessLog,
    rawOutput: input.runner === 'codex' ? paths.rawOutput : null,
    runLog: paths.runLog,
    reportWriterLog: paths.writerLog,
    report: input.report,
  };

  readiness(input, paths);
  if (fs.existsSync(input.report)) fail(16, 'REPORT_INVALID', 'report', 'report path was populated before execution; refusing stale delivery');
  const prompt = executionPrompt(input);
  const outputPath = input.runner === 'codex' ? paths.rawOutput : null;
  const run = runChild(input.runner, runnerArgs(input, prompt, outputPath), input.worktree, input.scratch, paths.runLog, 2700000);
  if (run.status !== 0) {
    const timedOut = run.error?.code === 'ETIMEDOUT';
    fail(15, timedOut ? 'RUN_TIMEOUT' : 'RUN_FAILED', 'execution', timedOut ? 'runner execution timed out' : `runner execution failed${run.error ? `: ${run.error.message}` : ''}`);
  }

  if (input.runner === 'codex') {
    if (!fs.existsSync(paths.rawOutput) || fs.existsSync(input.report)) fail(16, 'REPORT_INVALID', 'report', 'fresh Codex output or report path is missing');
    const status = reportedStatus(fs.readFileSync(paths.rawOutput, 'utf8'));
    const writeArgs = ['write', '--from-codex-output', paths.rawOutput, '--output', input.report, '--status', status.status];
    if (status.reason) writeArgs.push('--reason', status.reason);
    reportWriter(input, paths, 'write', writeArgs);
  } else if (!fs.existsSync(input.report)) {
    fail(16, 'REPORT_INVALID', 'report', 'runner did not create a fresh report');
  }

  const checked = reportWriter(input, paths, 'check', ['check', '--file', input.report]);
  if (/valid \(STATUS: BLOCKED: (.+)\)/.test(checked.stdout)) {
    const reason = /valid \(STATUS: BLOCKED: (.+)\)/.exec(checked.stdout)[1];
    fail(17, 'WORKER_BLOCKED', 'report', `worker delivered a valid BLOCKED report: ${reason}`);
  }
  response(options, {
    exitCode: 0,
    code: 'DONE',
    phase: 'report',
    message: `Dispatch completed and the report is valid: ${input.report}`,
  }, evidencePaths, input);
}

function main() {
  const argv = process.argv.slice(2);
  const jsonRequested = argv.includes('--json');
  let options = { '--json': jsonRequested };
  let input;
  evidencePaths = {};
  try {
    if (argv.includes('--help')) {
      if (argv.some(arg => !['--help', '--json'].includes(arg))) fail(10, 'INVALID_INPUT', 'input', 'help cannot be combined with dispatch options');
      options = { '--json': jsonRequested };
      response(options, { exitCode: 0, code: 'HELP', phase: 'help', message: USAGE });
      return;
    }
    options = parseArgs(argv);
    input = validateInput(options);
    if (options['--dry-run']) {
      const outputPath = input.runner === 'codex' ? path.join(input.scratch, '<run-id>.raw.txt') : null;
      response(options, {
        exitCode: 0,
        code: 'DRY_RUN_OK',
        phase: 'dry-run',
        message: `Validated ${input.runner} model ${input.model} for packet ${input.packet} in ${input.worktree}; scratch ${input.scratch}; report ${input.report}`,
        argv: [input.runner, ...runnerArgs(input, executionPrompt(input), outputPath)],
        cwd: input.worktree,
      }, evidencePaths, input);
      return;
    }
    execute(input, options);
  } catch (cause) {
    if (cause instanceof DispatchFailure) {
      response(options, cause, evidencePaths, input);
      return;
    }
    response(options, new DispatchFailure(1, 'INTERNAL_ERROR', 'application', cause.message || 'unexpected dispatch error'), evidencePaths, input);
  }
}

main();
