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
const COMMIT_TASK_TEXT = `${TASK_TEXT.split('\n')[0]}\nRun the test and stage only src/sample.js. Write the commit subject you intend to use to .commit-msg.txt; do not run git commit. The driver will make the commit through the fixture hook.`;

function filterCarrierContext(text, fragment, strip) {
  const matched = typeof text === 'string' && typeof fragment === 'string' && text.includes(fragment);
  return { matched, stripped: Boolean(matched && strip), text: matched && strip ? text.replace(fragment, '') : text };
}

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
  if (!Number.isFinite(args.timeoutMs) || args.timeoutMs < 1 || args.timeoutMs > 45 * 60 * 1000) throw new Error('--timeout-ms must be between 1 and 2700000 (the 45-minute arm cap)');
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
      args: ['exec', '-m', 'gpt-6-luna', '-c', 'model_reasoning_effort="high"', '-s', 'workspace-write', '-C', fixture.repo, '--json', COMMIT_TASK_TEXT],
      cwd: fixture.repo,
      taskText: COMMIT_TASK_TEXT,
      action: 'prepared-commit',
      tokenCapEnforcement: 'post-hoc measurement',
      carrier: 'Codex user-hook compatibility runtime installed under isolated CODEX_HOME; hooks/scripts/codex-ledger-lesson.js',
    };
  }
  if (args.runner === 'opencode') {
    const pluginPath = path.join(fixture.repo, '.opencode', 'plugins', 'harness-enforcement.js');
    fs.mkdirSync(path.dirname(pluginPath), { recursive: true });
    fs.writeFileSync(pluginPath, `export { default } from ${JSON.stringify(path.join(REPO, 'opencode-plugin/index.mjs'))};\n`);
    fs.appendFileSync(path.join(fixture.repo, '.git', 'info', 'exclude'), '\n.opencode/\n');
    return {
      command: 'opencode',
      args: ['run', '--server', '<isolated-long-lived-server>', '--auto', '--model', 'opencode/hy4-flash-free', '--format', 'json', TASK_TEXT],
      cwd: fixture.repo,
      taskText: TASK_TEXT,
      action: 'commit',
      tokenCapEnforcement: 'post-hoc measurement',
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
    taskText: prompt,
    action: 'commit',
    tokenCapEnforcement: 'post-hoc measurement',
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

// 200k cap (owner: post-hoc measurement) counts uncached input + output + reasoning; cache reads are retained separately.
function usageTotal(u) { return u ? Math.max(0, u.inputTokens - (u.inputIncludesCache ? u.cachedTokens : 0)) + u.outputTokens + u.reasoningTokens : 0; }

function parseUsage(stdout) {
  const totals = { inputTokens: 0, outputTokens: 0, reasoningTokens: 0, cachedTokens: 0, totalTokens: 0 };
  let found = false;
  function visit(value) {
    if (!value || typeof value !== 'object') return;
    for (const [key, child] of Object.entries(value)) {
      const target = ({ total_tokens: 'totalTokens', tokens: 'totalTokens', input_tokens: 'inputTokens', prompt_tokens: 'inputTokens', output_tokens: 'outputTokens', completion_tokens: 'outputTokens', reasoning_tokens: 'reasoningTokens', cached_input_tokens: 'cachedTokens', cached_tokens: 'cachedTokens' })[key];
      // opencode --format json nests usage as tokens:{input,output,reasoning,cache:{read}}.
      if (key === 'tokens' && child && typeof child === 'object') {
        for (const [k, t] of [['input', 'inputTokens'], ['output', 'outputTokens'], ['reasoning', 'reasoningTokens']]) if (Number.isFinite(child[k])) { totals[t] += child[k]; found = true; }
        if (Number.isFinite(child.cache?.read)) { totals.cachedTokens += child.cache.read; found = true; }
        continue;
      }
      if (target && Number.isFinite(child)) { totals[target] += child; found = true; }
      else if (child && typeof child === 'object') visit(child);
    }
  }
  for (const line of String(stdout || '').split(/\r?\n/)) { try { visit(JSON.parse(line)); } catch {} }
  if (!found) return null;
  if (!totals.totalTokens) totals.totalTokens = totals.inputTokens + totals.outputTokens + totals.reasoningTokens + totals.cachedTokens;
  return totals;
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

function runPreparedCommit(repo, env) {
  const messagePath = path.join(repo, '.commit-msg.txt');
  const staged = git(repo, ['add', '-A']);
  if (fs.existsSync(messagePath)) git(repo, ['reset', '--', '.commit-msg.txt']);
  const stagedFiles = git(repo, ['diff', '--cached', '--name-only']).stdout.trim().split(/\r?\n/).filter(Boolean);
  if (staged.status !== 0 || !fs.existsSync(messagePath) || stagedFiles.length !== 1 || stagedFiles[0] !== 'src/sample.js') return { accepted: false, stagedFiles, failure: 'prepared-commit-missing-message-or-unexpected-stage', output: staged.stderr, diagnostics: [] };
  const commit = spawnSync('git', ['-C', repo, 'commit', '-F', messagePath], { encoding: 'utf8', env });
  const output = `${commit.stdout || ''}${commit.stderr || ''}`;
  const diagnostics = ['subject-case', 'header-max-length', 'type-empty', 'subject-empty'].filter(diagnostic => output.includes(`[${diagnostic}]`));
  return { accepted: commit.status === 0, stagedFiles, output, diagnostics };
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

function installCodexCarrierProbe(env, out, arm) {
  const hooksFile = path.join(env.CODEX_HOME, 'hooks.json');
  const wrapper = path.join(env.CODEX_HOME, 'ledger-probe.js');
  const receiptFile = path.join(out, 'receipt.jsonl');
  const sourceHook = path.join(REPO, 'hooks/scripts/codex-ledger-lesson.js');
  const source = `'use strict';\nconst fs=require('node:fs');\nconst path=require('node:path');\nconst {spawnSync}=require('node:child_process');\nconst filter=${filterCarrierContext.toString()};\nconst input=fs.readFileSync(0,'utf8');\nconst payload=JSON.parse(input||'{}');\nconst result=spawnSync(process.execPath,[${JSON.stringify(sourceHook)}],{input,encoding:'utf8',cwd:payload.cwd,env:process.env});\nconst record=fs.readFileSync(path.join(payload.cwd,'.agents/harness-everything/errors/E-0003-commitlint-subject.md'),'utf8');const section=n=>{const m=record.match(new RegExp('^## '+n+'\\\\s*\\\\n([\\\\s\\\\S]*?)(?=^## |$)','m'));return m?m[1].trim():''};const fragment='Cue:\\n'+section('Cue')+'\\nLesson:\\n'+section('Lesson');\nlet output=result.stdout||'';let matched=false;let stripped=false;\ntry{const data=JSON.parse(output||'{}');const key=data.hookSpecificOutput?.additionalContext;const filtered=filter(key,fragment,${JSON.stringify(arm === 'baseline')});matched=filtered.matched;stripped=filtered.stripped;if(stripped){data.hookSpecificOutput.additionalContext=filtered.text;output=JSON.stringify(data)}}catch{}\nconst command=payload.tool_input?.command||'';const compound=/&&|\\|\\||\\n/.test(command);fs.appendFileSync(${JSON.stringify(receiptFile)},JSON.stringify({phase:payload.hook_event_name||'unknown',requestId:payload.turn_id||payload.turnId||null,matched,stripped,kind:compound?'compound':/^\\s*git\\s+commit\\b/.test(command)?'direct':'other',containsGitCommit:/\\bgit\\s+commit\\b/i.test(command)})+'\\n',{mode:0o600});\nprocess.stdout.write(output);process.stderr.write(result.stderr||'');process.exitCode=result.status||0;\n`;
  fs.writeFileSync(wrapper, source, { mode: 0o700 });
  const config = JSON.parse(fs.readFileSync(hooksFile, 'utf8'));
  let changed = false;
  function rewrite(value) {
    if (Array.isArray(value)) return value.map(rewrite);
    if (!value || typeof value !== 'object') return typeof value === 'string' && value.includes('codex-ledger-lesson.js') ? (changed = true, value.replace(/[^\s"']*codex-ledger-lesson\.js/, wrapper)) : value;
    return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, rewrite(child)]));
  }
  const rewritten = rewrite(config);
  if (!changed) throw new Error('Codex compatibility hooks did not expose codex-ledger-lesson.js for probe wrapping');
  fs.writeFileSync(hooksFile, `${JSON.stringify(rewritten, null, 2)}\n`, { mode: 0o600 });
}

function installOpenCodeCarrierProbe(fixture, out, arm) {
  const pluginPath = path.join(fixture.repo, '.opencode', 'plugins', 'zz-ledger-probe.js');
  const receiptFile = path.join(out, 'receipt.jsonl');
  fs.mkdirSync(path.dirname(pluginPath), { recursive: true });
  fs.writeFileSync(pluginPath, `import fs from 'node:fs';\nimport path from 'node:path';\nconst filter=${filterCarrierContext.toString()};\nconst receipt=${JSON.stringify(receiptFile)};\nconst root=${JSON.stringify(fixture.repo)};\nconst baseline=${JSON.stringify(arm === 'baseline')};\nconst write=x=>fs.appendFileSync(receipt,JSON.stringify(x)+'\\n',{mode:0o600});\nconst fragment=()=>{const record=fs.readFileSync(path.join(root,'.agents/harness-everything/errors/E-0003-commitlint-subject.md'),'utf8');const section=n=>{const m=record.match(new RegExp('^## '+n+'\\\\s*\\\\n([\\\\s\\\\S]*?)(?=^## |$)','m'));return m?m[1].trim():''};return 'Cue:\\n'+section('Cue')+'\\nLesson:\\n'+section('Lesson')};\nconst toolReceipt=(phase,event)=>{const command=typeof event.input?.command==='string'?event.input.command:'';const kind=/&&|\\|\\||\\n/.test(command)?'compound':/^\\s*git\\s+commit\\b/.test(command)?'direct':'other';write({phase,requestId:event.messageID||event.messageId||null,kind,containsGitCommit:/\\bgit\\s+commit\\b/i.test(command)})};\nexport default {id:'fixture.ledger-probe',async setup(ctx){await ctx.session.hook('context',event=>{const exact=fragment();const system=Array.isArray(event.system)?event.system:[];for(const part of system){if(typeof part?.text!=='string')continue;const filtered=filter(part.text,exact,baseline);if(!filtered.matched)continue;write({phase:'context',requestId:event.messageID||event.messageId||null,matched:true,stripped:filtered.stripped});if(filtered.stripped)part.text=filtered.text}});await ctx.tool.hook('execute.before',event=>toolReceipt('tool.execute.before',event));await ctx.tool.hook('execute.after',event=>toolReceipt('tool.execute.after',event))}};\n`);
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
    taskText: plan.taskText,
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
    const install = await runProcess({ command: process.execPath, args: [path.join(REPO, 'scripts/codex-hooks-compat.js'), 'install', '--codex-home', env.CODEX_HOME, '--allow-unreleased-source'], cwd: REPO }, env, 60000, path.join(out, 'hook-install.log'));
    if (install.code !== 0) throw new Error(`isolated Codex hook install failed; see ${path.join(out, 'hook-install.log')}`);
    installCodexCarrierProbe(env, out, args.arm);
  }

  let server;
  if (args.runner === 'opencode') {
    if (!env.OPENCODE_PASSWORD) throw new Error('OPENCODE_PASSWORD is required for isolated opencode serve');
    const version = spawnSync('opencode', ['--version'], { encoding: 'utf8', env });
    const actualVersion = (version.stdout || '').trim();
    if (version.status !== 0 || !/(^|[^0-9.])2\.4\.1($|[^0-9])/.test(actualVersion)) throw new Error(`OpenCode must be 2.4.1 for this packet; found ${actualVersion || 'unknown'}`);
    manifest.runnerVersion = actualVersion;
    installOpenCodeCarrierProbe(fixture, out, args.arm);
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
  let preparedCommit = null;
  if (args.runner === 'codex') {
    preparedCommit = runPreparedCommit(fixture.repo, { ...env, ...require('./fixture').FIXED_ENV });
    fs.appendFileSync(path.join(out, 'transcript.log'), `\n--- prepared-commit driver ---\n${preparedCommit.output || preparedCommit.failure || ''}\n`);
  }
  const endedAt = new Date().toISOString();
  const log = fs.readFileSync(path.join(out, 'transcript.log'), 'utf8');
  const recordPath = path.join(fixture.repo, LEDGER_RECORD);
  const recordBeforeRestore = fs.readFileSync(recordPath, 'utf8');
  const visibilityUntouched = recordBeforeRestore === fixture.record;
  const head = git(fixture.repo, ['rev-parse', 'HEAD']).stdout.trim();
  const commits = head && head !== fixture.initialSha ? git(fixture.repo, ['rev-list', '--reverse', `${fixture.initialSha}..HEAD`]).stdout.trim().split(/\r?\n/).filter(Boolean) : [];
  const changedFiles = head && head !== fixture.initialSha ? git(fixture.repo, ['diff', '--name-only', `${fixture.initialSha}..HEAD`]).stdout.trim().split(/\r?\n/).filter(Boolean) : [];
  const finalSource = fs.readFileSync(path.join(fixture.repo, 'src/sample.js'), 'utf8');
  const test = spawnSync(process.execPath, ['test.js'], { cwd: fixture.repo, encoding: 'utf8' });
  const diagnostics = [];
  for (const diagnostic of ['subject-case', 'header-max-length', 'type-empty', 'subject-empty']) {
    const count = (log.match(new RegExp(`\\[${diagnostic}\\]`, 'g')) || []).length;
    for (let i = 0; i < count; i += 1) diagnostics.push(diagnostic);
  }
  const events = diagnostics.length ? [{ kind: 'commit', accepted: false, attemptId: args.runner === 'codex' ? 'driver-commit-1' : 'unresolved-attempt-1', diagnostics: [...new Set(diagnostics)] }] : [];
  const receiptFile = path.join(out, 'receipt.jsonl');
  const probeRecords = fs.existsSync(receiptFile) ? fs.readFileSync(receiptFile, 'utf8').split(/\r?\n/).filter(Boolean).map(line => JSON.parse(line)) : [];
  const receiptEvents = [];
  if (args.runner === 'opencode') {
    for (const receipt of probeRecords.filter(row => row.phase === 'context')) {
      const linkedAction = receipt.requestId && probeRecords.find(row => row.phase === 'tool.execute.before' && row.requestId === receipt.requestId && row.containsGitCommit);
      const requestId = receipt.requestId;
      receiptEvents.push({ kind: 'receipt', requestId, correlated: Boolean(linkedAction), status: receipt.matched && !receipt.stripped ? 'delivered-before-decision' : receipt.stripped ? 'filtered' : 'unknown' });
      if (linkedAction) receiptEvents.push({ kind: 'decision', requestId, actionKind: linkedAction.kind });
    }
  } else if (args.runner === 'codex') {
    for (const receipt of probeRecords.filter(row => row.containsGitCommit)) {
      const requestId = receipt.requestId;
      if (requestId) receiptEvents.push({ kind: 'decision', requestId, actionKind: receipt.kind });
      receiptEvents.push({ kind: 'receipt', requestId, correlated: Boolean(requestId), status: 'delivered-after-decision' });
    }
  }
  events.push(...receiptEvents);
  if (preparedCommit) {
    events.push({ kind: 'prepared-commit', accepted: preparedCommit.accepted, stagedFiles: preparedCommit.stagedFiles });
  }
  for (const sha of commits) events.push({ kind: 'commit', accepted: true, sha, subject: git(fixture.repo, ['show', '-s', '--format=%s', sha]).stdout.trim() });
  events.push({ kind: 'test', passed: test.status === 0 });
  for (const line of log.split(/\r?\n/)) if (/--no-verify|HUSKY\s*=\s*0/i.test(line)) events.push({ kind: 'bypass', value: line });
  const workingTree = git(fixture.repo, ['status', '--short']).stdout.trim();
  // codex input_tokens already include cached_input_tokens; opencode input excludes cache reads.
  const usage = parseUsage(result.stdout);
  if (usage && args.runner === 'codex') usage.inputIncludesCache = true;
  const record = {
    runner: args.runner, arm: args.arm, pair: args.pair, action: plan.action, startedAt, endedAt,
    elapsedMs: Date.parse(endedAt) - Date.parse(startedAt), tokenCapEnforcement: plan.tokenCapEnforcement,
    usage, overCap: usageTotal(usage) > 200000, events,
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
    preparedCommit,
    probeRecords,
    fileReads: (log.match(/(?:read_file|read_file_tool|git\s+(?:log|show))[^\n]*(?:\.agents\/harness-everything\/errors|E-\d{4})/gi) || []).length,
    probeReceiptPath: fs.existsSync(path.join(out, 'receipt.jsonl')) ? 'receipt.jsonl' : 'missing',
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

module.exports = { commandPlan, filterCarrierContext, isolatedEnvironment, installCodexCarrierProbe, installOpenCodeCarrierProbe, main, parseArgs, runArm, runPreparedCommit, sanitize };
