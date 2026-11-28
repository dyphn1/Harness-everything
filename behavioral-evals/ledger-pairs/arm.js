'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn, spawnSync } = require('node:child_process');
const net = require('node:net');
const { buildFixture, TASK_TEXT } = require('./fixture');

const REPO = path.resolve(__dirname, '../..');
const LEDGER_RECORD = '.agents/harness-everything/errors/E-0003-commitlint-subject.md';
const RUNNERS = ['codex', 'opencode', 'agy'];
const ARMS = ['baseline', 'treatment'];

function parseArgs(argv) {
  const args = { dryRun: false, timeoutMs: 45 * 60 * 1000 };
  for (let i = 0; i < argv.length; i += 1) {
    const key = argv[i];
    if (key === '--dry-run') args.dryRun = true;
    else if (['--runner', '--arm', '--pair', '--out', '--auth-dir', '--timeout-ms'].includes(key)) args[key.slice(2).replace(/-([a-z])/g, (_, c) => c.toUpperCase())] = argv[++i];
    else throw new Error(`unknown argument: ${key}`);
  }
  if (!RUNNERS.includes(args.runner)) throw new Error('--runner must be codex|opencode|agy');
  if (!ARMS.includes(args.arm)) throw new Error('--arm must be baseline|treatment');
  if (!Number.isInteger(Number(args.pair)) || Number(args.pair) < 1 || Number(args.pair) > 4) throw new Error('--pair must be 1..4');
  if (!args.out) throw new Error('--out is required');
  args.pair = Number(args.pair);
  args.timeoutMs = Number(args.timeoutMs);
  return args;
}

function isolatedEnvironment(root, authDir, runner) {
  const home = path.join(root, 'home');
  const xdg = path.join(root, 'xdg');
  const tmp = path.join(root, 'tmp');
  const codexHome = path.join(root, 'codex-home');
  for (const dir of [home, xdg, tmp, codexHome]) fs.mkdirSync(dir, { recursive: true });
  // Minimal env: never inherit the coordinator's CLAUDE*/CODEX*/HARNESS_* session variables.
  const base = {};
  for (const k of ['PATH', 'LANG', 'TERM', 'SHELL', 'OPENCODE_PASSWORD']) if (process.env[k]) base[k] = process.env[k];
  base.PONYTAIL_DEFAULT_MODE = 'off';
  // agy keeps its login under ~/.gemini; isolating HOME logs it out, so agy keeps the real HOME (recorded in arm-plan).
  if (runner === 'agy') return { ...base, HOME: process.env.HOME, TMPDIR: tmp };
  const env = { ...base, HOME: home, USERPROFILE: home, XDG_CONFIG_HOME: path.join(xdg, 'config'), XDG_DATA_HOME: path.join(xdg, 'data'), XDG_STATE_HOME: path.join(xdg, 'state'), XDG_CACHE_HOME: path.join(xdg, 'cache'), TMPDIR: tmp, CODEX_HOME: codexHome };
  for (const dir of [env.XDG_CONFIG_HOME, env.XDG_DATA_HOME, env.XDG_STATE_HOME, env.XDG_CACHE_HOME]) fs.mkdirSync(dir, { recursive: true });
  if (authDir) copyAuth(path.resolve(authDir), { home, xdg, codexHome }, runner);
  return env;
}

function copyAuth(source, destinations, runner) {
  if (!fs.existsSync(source)) throw new Error(`auth directory not found: ${source}`);
  const files = ['auth.json', 'credentials.json'];
  for (const name of files) {
    const from = path.join(source, name);
    if (!fs.existsSync(from) || !fs.statSync(from).isFile()) continue;
    // opencode reads auth from XDG_DATA_HOME/opencode; codex from CODEX_HOME.
    const targets = runner === 'opencode' ? [path.join(destinations.xdg, 'data', 'opencode', name)] : [path.join(destinations.codexHome, name)];
    for (const to of targets) {
      fs.mkdirSync(path.dirname(to), { recursive: true });
      fs.copyFileSync(from, to); fs.chmodSync(to, 0o600);
    }
  }
}

function quoteShell(value) {
  return `'${String(value).replace(/'/g, "'\\''")}'`;
}

function commandPlan(args, fixture, env) {
  if (args.runner === 'codex') {
    return {
      command: 'codex',
      args: ['exec', '-m', 'gpt-6-luna', '-c', 'model_reasoning_effort="high"', '-s', 'workspace-write', '-C', fixture.repo, '--json', TASK_TEXT],
      cwd: fixture.repo,
      tokenCapEnforcement: 'post-hoc only',
      carrier: 'Codex user-hook compatibility runtime installed under isolated CODEX_HOME; hooks/scripts/codex-ledger-lesson.js',
    };
  }
  if (args.runner === 'opencode') {
    const pluginPath = path.join(fixture.repo, '.opencode', 'plugins', 'harness-enforcement.mjs');
    fs.mkdirSync(path.dirname(pluginPath), { recursive: true });
    fs.writeFileSync(pluginPath, `export { default } from ${JSON.stringify(path.join(REPO, 'opencode-plugin/index.mjs'))};\n`);
    fs.appendFileSync(path.join(fixture.repo, '.git', 'info', 'exclude'), '\n.opencode/\n');
    return {
      command: 'opencode',
      args: ['run', '--server', '<isolated-long-lived-server>', '--auto', '--model', 'opencode/hy4-flash-free', TASK_TEXT],
      cwd: fixture.repo,
      tokenCapEnforcement: 'post-hoc only',
      carrier: 'OpenCode V2 checkout plugin, one-line re-export, tool before/after to next context hook',
      server: { command: 'opencode', args: ['serve', '--hostname', '127.0.0.1', '--port', '<ephemeral>'], requiredVersion: '2.4.1', env: 'OPENCODE_PASSWORD' },
    };
  }
  const prompt = args.arm === 'treatment'
    ? `${TASK_TEXT}\n\nPacket-context intervention (agy-injection; not a repository-ledger carrier):\n${fs.readFileSync(path.join(fixture.repo, LEDGER_RECORD), 'utf8').split('## Lesson')[1]?.split(/^## /m)[0] || ''}`
    : TASK_TEXT;
  return {
    command: 'agy',
    args: ['-p', prompt, '--model', 'gemini-4-hydrogen-high', '--mode', 'accept-edits', '--sandbox', '--settings', '{"permissions":{"allow":["command(*)","read_file(*)"]}}'],
    cwd: fixture.repo,
    tokenCapEnforcement: 'post-hoc only',
    carrier: 'none; packet-context injection, reported as agy-injection only',
    isolation: 'real HOME (agy login lives in ~/.gemini); TMPDIR isolated; global agy plugins load equally in both arms',
  };
}

async function ephemeralPort() {
  const server = net.createServer();
  await new Promise((resolve, reject) => server.once('error', reject).listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  await new Promise(resolve => server.close(resolve));
  return port;
}

function parseUsage(stdout) {
  const totals = { inputTokens: 0, outputTokens: 0, reasoningTokens: 0, cachedTokens: 0 };
  let found = false;
  function visit(value) {
    if (!value || typeof value !== 'object') return;
    for (const [key, child] of Object.entries(value)) {
      const target = ({ total_tokens: 'totalTokens', tokens: 'totalTokens', input_tokens: 'inputTokens', prompt_tokens: 'inputTokens', output_tokens: 'outputTokens', completion_tokens: 'outputTokens', reasoning_tokens: 'reasoningTokens', cached_input_tokens: 'cachedTokens' })[key];
      if (target && Number.isFinite(child)) { totals[target] += child; found = true; }
      else if (child && typeof child === 'object') visit(child);
    }
  }
  for (const line of String(stdout || '').split(/\r?\n/)) { try { visit(JSON.parse(line)); } catch {} }
  return found ? totals : null;
}

function git(repo, args) {
  return spawnSync('git', ['-C', repo, ...args], { encoding: 'utf8' });
}

function sanitize(text, env) {
  let result = String(text || '');
  for (const key of ['GEMINI_API_KEY', 'OPENCODE_PASSWORD']) {
    if (env[key]) result = result.split(env[key]).join('[REDACTED]');
  }
  return result.replace(/(sk-[A-Za-z0-9_-]{16,}|AIza[A-Za-z0-9_-]{20,})/g, '[REDACTED]');
}

function runProcess(plan, env, timeoutMs, logFile) {
  return new Promise(resolve => {
    const child = spawn(plan.command, plan.args, { cwd: plan.cwd, env, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    const timeout = setTimeout(() => { timedOut = true; child.kill('SIGTERM'); }, timeoutMs);
    child.stdout.on('data', chunk => { stdout += chunk; });
    child.stderr.on('data', chunk => { stderr += chunk; });
    child.on('error', error => { stderr += `${error.message}\n`; });
    child.on('close', code => {
      clearTimeout(timeout);
      const body = `EXIT_CODE=${code}\nTIMED_OUT=${timedOut}\n--- stdout ---\n${sanitize(stdout, env)}\n--- stderr ---\n${sanitize(stderr, env)}\n`;
      fs.writeFileSync(logFile, body, { mode: 0o600 });
      resolve({ code, timedOut, stdout: sanitize(stdout, env), stderr: sanitize(stderr, env) });
    });
  });
}

async function runArm(args) {
  const out = path.resolve(args.out, args.runner, `pair-${args.pair}-${args.arm}`);
  fs.mkdirSync(out, { recursive: true });
  const fixture = await buildFixture({ out: path.join(out, 'fixture'), arm: args.arm, sourceRoot: REPO });
  const env = isolatedEnvironment(out, args.authDir, args.runner);
  const plan = commandPlan(args, fixture, env);
  const manifest = {
    schemaVersion: 1,
    runner: args.runner,
    arm: args.arm,
    pair: args.pair,
    intervention: args.runner === 'agy' ? 'agy-injection' : 'repo-ledger-context-visibility',
    visibility: fixture.visibility,
    initialSha: fixture.initialSha,
    taskText: TASK_TEXT,
    carrier: plan.carrier,
    tokenLimit: { max: 200000, enforcement: plan.tokenCapEnforcement },
    timeoutMs: args.timeoutMs,
    commitlintResolution: fixture.commitlintResolution,
    command: plan,
    liveHostEvidence: 'UNCHECKED until retained matcher receipt and next-request capture are reviewed',
  };
  fs.writeFileSync(path.join(out, 'arm-plan.json'), `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o600 });
  if (args.dryRun) return { out, manifest };

  if (args.runner === 'codex') {
    const install = await runProcess({ command: process.execPath, args: [path.join(REPO, 'scripts/codex-hooks-compat.js'), 'install', '--codex-home', env.CODEX_HOME], cwd: REPO }, env, 60000, path.join(out, 'hook-install.log'));
    if (install.code !== 0) throw new Error(`isolated Codex hook install failed; see ${path.join(out, 'hook-install.log')}`);
  }

  let server;
  if (args.runner === 'opencode') {
    if (!env.OPENCODE_PASSWORD) throw new Error('OPENCODE_PASSWORD is required for isolated opencode serve');
    const version = spawnSync('opencode', ['--version'], { encoding: 'utf8', env });
    const actualVersion = (version.stdout || '').trim();
    if (version.status !== 0 || !/(^|[^0-9.])2\.4\.1($|[^0-9])/.test(actualVersion)) throw new Error(`OpenCode must be 2.4.1 for this packet; found ${actualVersion || 'unknown'}`);
    manifest.runnerVersion = actualVersion;
    const port = await ephemeralPort();
    server = spawn('opencode', ['serve', '--hostname', '127.0.0.1', '--port', String(port)], { cwd: fixture.repo, env, stdio: ['ignore', 'pipe', 'pipe'] });
    fs.writeFileSync(path.join(out, 'server.pid'), `${server.pid}\n`, { mode: 0o600 });
    const serverLog = fs.createWriteStream(path.join(out, 'server.log'), { mode: 0o600 });
    server.stdout.pipe(serverLog);
    server.stderr.pipe(serverLog);
    await new Promise(resolve => setTimeout(resolve, 1500));
    plan.args[2] = `http://127.0.0.1:${port}`;
    fs.writeFileSync(path.join(out, 'arm-plan.json'), `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o600 });
  }
  const startedAt = new Date().toISOString();
  const result = await runProcess(plan, env, args.timeoutMs, path.join(out, 'transcript.log'));
  if (server) server.kill('SIGTERM');
  const endedAt = new Date().toISOString();
  const log = fs.readFileSync(path.join(out, 'transcript.log'), 'utf8');
  const recordPath = path.join(fixture.repo, LEDGER_RECORD);
  const recordBeforeRestore = fs.readFileSync(recordPath, 'utf8');
  const visibilityUntouched = args.arm === 'treatment' || recordBeforeRestore === fixture.record;
  fs.writeFileSync(recordPath, git(fixture.repo, ['show', `HEAD:${LEDGER_RECORD}`]).stdout);
  const head = git(fixture.repo, ['rev-parse', 'HEAD']).stdout.trim();
  const commits = head && head !== fixture.initialSha ? git(fixture.repo, ['rev-list', '--reverse', `${fixture.initialSha}..HEAD`]).stdout.trim().split(/\r?\n/).filter(Boolean) : [];
  const changedFiles = head && head !== fixture.initialSha ? git(fixture.repo, ['diff', '--name-only', `${fixture.initialSha}..HEAD`]).stdout.trim().split(/\r?\n/).filter(Boolean) : [];
  const finalSource = fs.readFileSync(path.join(fixture.repo, 'src/sample.js'), 'utf8');
  const test = spawnSync(process.execPath, ['test.js'], { cwd: fixture.repo, encoding: 'utf8' });
  const diagnostics = [];
  for (const diagnostic of ['subject-case', 'header-max-length']) {
    const count = (log.match(new RegExp(`\\[${diagnostic}\\]`, 'g')) || []).length;
    for (let i = 0; i < count; i += 1) diagnostics.push(diagnostic);
  }
  const events = diagnostics.map(diagnostic => ({ kind: 'commit', accepted: false, diagnostics: [diagnostic] }));
  for (const sha of commits) events.push({ kind: 'commit', accepted: true, sha, subject: git(fixture.repo, ['show', '-s', '--format=%s', sha]).stdout.trim() });
  events.push({ kind: 'test', passed: test.status === 0 });
  for (const line of log.split(/\r?\n/)) if (/--no-verify|HUSKY\s*=\s*0/i.test(line)) events.push({ kind: 'bypass', value: line });
  const workingTree = git(fixture.repo, ['status', '--short']).stdout.trim();
  const record = {
    runner: args.runner, arm: args.arm, pair: args.pair, startedAt, endedAt,
    elapsedMs: Date.parse(endedAt) - Date.parse(startedAt), tokenCapEnforcement: plan.tokenCapEnforcement,
    usage: parseUsage(result.stdout), events,
    initialFiles: { 'src/sample.js': "'use strict';\n\nmodule.exports = () => '';\n" },
    finalFiles: { 'src/sample.js': finalSource },
    manualIntervention: 0,
    failures: [...(result.code === 0 ? [] : [`runner-exit-${result.code}`]), ...(!visibilityUntouched ? ['agent-modified-visibility-intervention'] : [])],
    unknowns: ['matcher receipt and model-request delivery require coordinator review', 'manual intervention is zero only while the arm remains unattended'],
    transcriptPath: 'transcript.log', transcriptSha256: require('node:crypto').createHash('sha256').update(log).digest('hex'),
    gitLog: git(fixture.repo, ['log', '--format=%H%x09%s']).stdout.trim().split(/\r?\n/),
    changedFiles,
    correctDiff: visibilityUntouched && changedFiles.length === 1 && changedFiles[0] === 'src/sample.js' && finalSource.includes("module.exports = () => 'hello';"),
    testPassed: test.status === 0,
    hookRejections: diagnostics,
    matcherReceipt: 'unknown; review sanitized host trace',
    contextDelivery: 'unknown; review actual next-request capture',
    workingTree,
    treeClean: workingTree === '',
  };
  fs.writeFileSync(path.join(out, 'arm-result.json'), `${JSON.stringify(record, null, 2)}\n`, { mode: 0o600 });
  return { out, manifest, result: { code: result.code, timedOut: result.timedOut } };
}

async function main(argv) {
  const args = parseArgs(argv);
  const result = await runArm(args);
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

if (require.main === module) main(process.argv.slice(2)).catch(error => { console.error(error.message); process.exitCode = 2; });

module.exports = { commandPlan, isolatedEnvironment, main, parseArgs, runArm, sanitize };
