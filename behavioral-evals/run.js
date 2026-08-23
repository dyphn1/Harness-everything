#!/usr/bin/env node
/**
 * Behavioral Eval Runner
 *
 * Runs discipline cases against a real headless Claude session and grades the
 * transcript + resulting workspace. Token-costing, on-demand only — never CI.
 *
 *   node behavioral-evals/run.js validate          # structural check of case files (free)
 *   node behavioral-evals/run.js run               # run all cases (costs tokens)
 *   node behavioral-evals/run.js run --case <id>   # run one case
 *
 * How a live run works:
 *  1. Build the case fixture in an OS temp workspace (git init if requested).
 *  2. Install Harness into it: copy skill dirs, hooks, and runtime scripts,
 *     rewrite hook commands to absolute paths, merge .claude/settings.json.
 *  3. Run: claude -p "<prompt>" --output-format json --max-turns N
 *  4. Grade expectations[] against transcript text and workspace state.
 *  5. Write results/<date>-<case>.json with the full trace reference so any
 *     grader verdict can be audited by a human.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const CASES_DIR = path.join(__dirname, 'cases');
const RESULTS_DIR = path.join(__dirname, 'results');

// ---------------------------------------------------------------------------
// Minimal YAML subset parser for our case files (flat maps, lists of maps,
// block scalars via |). Avoids adding dependencies to this package.
function parseSimpleYaml(text) {
  const lines = text.split('\n');
  let i = 0;
  function parseBlock(indent) {
    const obj = {};
    const arr = [];
    let isArray = null;
    while (i < lines.length) {
      const line = lines[i];
      if (!line.trim() || line.trim().startsWith('#')) { i++; continue; }
      const currentIndent = line.match(/^ */)[0].length;
      if (currentIndent < indent) break;
      if (currentIndent > indent) { i++; continue; }
      const listItem = line.trim().startsWith('- ');
      if (isArray === null) isArray = listItem;
      else if (isArray !== listItem) throw new Error('Mixed list/map at same indent near: ' + line);
      if (listItem) {
        const content = line.trim().slice(2);
        const kv = content.match(/^([^:]+):\s*(.*)$/);
        if (kv && !content.startsWith('"') && !content.startsWith("'")) {
          // inline object item spanning following indented lines
          const item = { [kv[1].trim()]: scalar(kv[2]) };
          i++;
          Object.assign(item, parseNested(currentIndent + 2));
          arr.push(item);
        } else {
          arr.push(scalar(content));
          i++;
        }
      } else {
        const kv = line.match(/^([^:#]+):\s*(.*)$/);
        if (!kv) { i++; continue; }
        const key = kv[1].trim();
        const rawVal = kv[2];
        if (rawVal === '|' || rawVal === '>') {
          i++;
          let block = [];
          while (i < lines.length) {
            const l = lines[i];
            const ind = l.match(/^ */)[0].length;
            if (!l.trim()) { block.push(''); i++; continue; }
            if (ind <= indent) break;
            block.push(l.slice(indent + 2));
            i++;
          }
          obj[key] = block.join('\n');
        } else if (rawVal === '') {
          i++;
          obj[key] = parseNested(indent + 2);
        } else {
          obj[key] = scalar(rawVal);
          i++;
        }
      }
    }
    return isArray ? arr : obj;
  }
  function parseNested(minIndent) {
    // Peek: is the next meaningful line a list or map?
    let j = i;
    while (j < lines.length && (!lines[j].trim() || lines[j].trim().startsWith('#'))) j++;
    if (j >= lines.length) return null;
    const ind = lines[j].match(/^ */)[0].length;
    const block = parseBlock(ind);
    return block;
  }
  function scalar(v) {
    const t = v.trim();
    if (t === 'true') return true;
    if (t === 'false') return false;
    if (/^-?\d+$/.test(t)) return parseInt(t, 10);
    if ((t.startsWith('"') && t.endsWith('"')) || (t.startsWith("'") && t.endsWith("'"))) return t.slice(1, -1);
    return t;
  }
  const result = parseBlock(0);
  return result || {};
}

// ---------------------------------------------------------------------------
function discoverCases() {
  return fs.readdirSync(CASES_DIR)
    .filter((f) => f.endsWith('.yaml'))
    .map((f) => ({ file: path.join(CASES_DIR, f), ...parseSimpleYaml(fs.readFileSync(path.join(CASES_DIR, f), 'utf8')) }));
}

function fail(msg) {
  console.error(`❌ ${msg}`);
  process.exit(1);
}

// --- validate mode ----------------------------------------------------------
function validate(cases) {
  let failures = 0;
  const EXPECT_TYPES = new Set(['trace_contains', 'trace_not_contains', 'file_contains', 'file_not_exists', 'command_exit_0']);
  for (const c of cases) {
    const problems = [];
    if (!c.id) problems.push('missing id');
    if (!c.prompt) problems.push('missing prompt');
    if (!c.max_turns) problems.push('missing max_turns');
    if (!c.fixture || !Array.isArray(c.fixture.files)) problems.push('fixture.files missing');
    if (!Array.isArray(c.expectations) || c.expectations.length === 0) problems.push('expectations missing');
    for (const e of c.expectations || []) {
      if (!EXPECT_TYPES.has(e.type)) problems.push(`unknown expectation type "${e.type}"`);
      if (e.value === undefined && e.command === undefined) problems.push(`expectation ${e.type} needs value or command`);
    }
    if (c.pressure && !/skip|don't|not|quick|minutes/i.test(c.prompt)) {
      problems.push('pressure case prompt does not read as pressure');
    }
    if (problems.length) {
      console.error(`❌ ${c.file}: ${problems.join('; ')}`);
      failures++;
    } else {
      console.log(`✅ ${c.id} (${c.pressure ? 'pressure' : 'baseline'})`);
    }
  }
  if (failures) { console.error(`\n${failures} invalid case file(s).`); process.exit(1); }
  console.log(`\n🎉 All ${cases.length} case files are structurally valid.`);
}

// --- live run mode -----------------------------------------------------------
function buildWorkspace(c) {
  const ws = fs.mkdtempSync(path.join(os.tmpdir(), `harness-behavioral-${c.id}-`));
  for (const f of c.fixture.files) {
    const target = path.join(ws, f.path);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, typeof f.content === 'string' ? f.content.replace(/\n$/, '') + '\n' : String(f.content));
  }
  return ws;
}

// Git baseline MUST be captured after Harness installation: otherwise the
// installer's own artifacts (.claude/, .harness-src/, opencode.json) show up
// as workspace changes and every scope-discipline check false-fails.
function gitSnapshot(ws) {
  execFileSync('git', ['init', '-q'], { cwd: ws });
  execFileSync('git', ['config', 'user.email', 'eval@harness.local'], { cwd: ws });
  execFileSync('git', ['config', 'user.name', 'Harness Eval'], { cwd: ws });
  execFileSync('git', ['add', '.'], { cwd: ws });
  execFileSync('git', ['commit', '-qm', 'fixture'], { cwd: ws });
}

function installHarness(ws) {
  const src = path.join(ws, '.harness-src');
  fs.mkdirSync(src, { recursive: true });
  for (const entry of fs.readdirSync(ROOT, { withFileTypes: true })) {
    if (entry.name.startsWith('.') || entry.name === 'node_modules' || entry.name === 'benchmarks' || entry.name === 'behavioral-evals') continue;
    if (!entry.isDirectory()) continue;
    fs.cpSync(path.join(ROOT, entry.name), path.join(src, entry.name), { recursive: true });
  }
  // Skills where Claude Code can see them
  const skillsDir = path.join(ws, '.claude', 'skills');
  fs.mkdirSync(skillsDir, { recursive: true });
  const skillNames = [];
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    if (!fs.existsSync(path.join(src, entry.name, 'SKILL.md'))) continue;
    fs.cpSync(path.join(src, entry.name), path.join(skillsDir, entry.name), { recursive: true });
    skillNames.push(entry.name);
  }
  // Hooks: rewrite relative commands to the copied source tree
  const hooks = JSON.parse(fs.readFileSync(path.join(src, 'hooks', 'hooks.json'), 'utf8'));
  const hooksCfg = hooks.hooks || {};
  for (const events of Object.values(hooksCfg)) {
    for (const entry of events) {
      for (const h of entry.hooks || []) {
        // `node hooks/scripts/x.js` -> `node "<abs src copy>/hooks/scripts/x.js"`
        h.command = h.command.replace(/^node /, `node "${src}/`) + '"';
      }
    }
  }
  const settingsPath = path.join(ws, '.claude', 'settings.json');
  const settings = fs.existsSync(settingsPath) ? JSON.parse(fs.readFileSync(settingsPath, 'utf8')) : {};
  settings.hooks = { ...(settings.hooks || {}), ...hooksCfg };
  fs.mkdirSync(path.dirname(settingsPath), { recursive: true });
  fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2));
  // opencode has no lifecycle-hook system wired here: load skills as
  // instructions instead (advisory strength, not hard enforcement).
  fs.writeFileSync(
    path.join(ws, 'opencode.json'),
    JSON.stringify({
      $schema: 'https://opencode.ai/config.json',
      instructions: skillNames.map((n) => `.claude/skills/${n}/SKILL.md`),
    }, null, 2)
  );
}

function runHeadless(prompt, ws, maxTurns, engine) {
  // Keep the transcript OUTSIDE the workspace: grader artifacts must never
  // show up in git-status-based scope checks.
  const outPath = path.join(path.dirname(ws), path.basename(ws) + '.transcript.json');
  if (engine === 'opencode') {
    // Free-tier opencode models flap network errors; gpt-5-mini via OPENAI_API_KEY is the stable default.
    const model = process.env.BEHAVIORAL_MODEL || 'openai/gpt-5-mini';
    execFileSync('opencode', ['run', '-m', model, prompt, '--format', 'json', '--auto', '--dir', ws],
      { cwd: ws, stdio: ['ignore', fs.openSync(outPath, 'w'), 'inherit'], timeout: 20 * 60 * 1000 });
  } else {
    execFileSync('claude', ['-p', prompt, '--output-format', 'json', '--max-turns', String(maxTurns)],
      { cwd: ws, stdio: ['ignore', fs.openSync(outPath, 'w'), 'inherit'], timeout: 15 * 60 * 1000 });
  }
  return outPath;
}

// The grader must judge what the AGENT said and did — never what it read.
// Tool outputs embed installed skill text, so keyword graders over raw
// transcripts produce false positives (a read of zoom-out/SKILL.md counts as
// "invoked zoom-out"). Trace = assistant text + tool inputs only.
function extractAgentTrace(transcriptPath) {
  const raw = fs.readFileSync(transcriptPath, 'utf8');
  const chunks = [];
  let structured = false;
  for (const line of raw.split('\n')) {
    if (!line.trim()) continue;
    let e;
    try { e = JSON.parse(line); } catch { continue; }
    const p = e && e.part;
    if (!p) continue;
    if (e.type === 'text' && typeof p.text === 'string') {
      chunks.push(p.text);
      structured = true;
    } else if (String(e.type).includes('tool')) {
      const input = p.state && p.state.input !== undefined ? p.state.input : p.input;
      chunks.push(`[${p.tool || 'tool'}] ` + JSON.stringify(input ?? {}));
      structured = true;
    }
  }
  // claude -p --output-format json emits one object; grade its result text.
  if (!structured) {
    try {
      const obj = JSON.parse(raw);
      if (obj && typeof obj.result === 'string') return obj.result;
    } catch { /* fall through */ }
    return raw;
  }
  return chunks.join('\n');
}

function grade(c, ws, transcriptPath) {
  const trace = extractAgentTrace(transcriptPath);
  const results = [];
  for (const e of c.expectations) {
    let pass = false;
    try {
      if (e.type === 'trace_contains') pass = trace.includes(e.value);
      else if (e.type === 'trace_not_contains') pass = !trace.includes(e.value);
      else if (e.type === 'file_contains') pass = fs.readFileSync(path.join(ws, e.path), 'utf8').includes(e.value);
      else if (e.type === 'file_not_exists') pass = !fs.existsSync(path.join(ws, e.path));
      else if (e.type === 'command_exit_0') {
        execFileSync('bash', ['-c', e.command], { cwd: ws, stdio: 'ignore' });
        pass = true;
      }
    } catch (err) {
      pass = false;
    }
    results.push({ ...e, pass });
  }
  // Informational expectations are reported but never gate the outcome:
  // they capture context-dependent behavior (e.g. zoom-out only becomes
  // obligatory once the breaker actually trips) that would otherwise
  // produce meaningless failures.
  const gating = results.filter((r) => !r.informational);
  return { results, passed: gating.length > 0 && gating.every((g) => g.pass) };
}

function resolveEngine(requested) {
  const has = (cmd) => { try { execFileSync(cmd, ['--version'], { stdio: 'pipe' }); return true; } catch { return false; } };
  if (requested) {
    if (!has(requested === 'claude' ? 'claude' : 'opencode')) fail(`engine "${requested}" not found on PATH.`);
    return requested;
  }
  if (has('claude')) return 'claude';
  if (has('opencode')) return 'opencode';
  fail('Neither `claude` nor `opencode` CLI found. Behavioral evals need a real model session.');
}

function runLive(filter, engineArg) {
  const engine = resolveEngine(engineArg);
  console.log(`Engine: ${engine}`);
  if (!process.env.CI) { /* headless runs are local-only by design */ }
  const cases = discoverCases().filter((c) => !filter || c.id === filter);
  if (filter && cases.length === 0) fail(`no case with id "${filter}"`);
  fs.mkdirSync(RESULTS_DIR, { recursive: true });

  let failed = 0;
  for (const c of cases) {
    console.log(`\n=== ${c.id}${c.pressure ? ' [PRESSURE]' : ''} ===`);
    const ws = buildWorkspace(c);
    installHarness(ws);
    if (c.fixture.git) gitSnapshot(ws);
    let transcriptPath;
    try {
      transcriptPath = runHeadless(c.prompt, ws, c.max_turns, engine);
    } catch (err) {
      console.error(`❌ session failed: ${err.message.slice(0, 300)}`);
      failed++;
      continue;
    }
    const { results: graded, passed } = grade(c, ws, transcriptPath);
    const record = {
      id: c.id,
      engine,
      model: engine === 'opencode' ? (process.env.BEHAVIORAL_MODEL || 'openai/gpt-5-mini') : 'claude-default',
      pressure: !!c.pressure,
      date: new Date().toISOString(),
      workspace: ws,
      transcript: transcriptPath,
      expectations: graded.map(({ description, pass }) => ({ description, pass })),
      outcome: passed ? 'pass' : 'fail',
    };
    const outFile = path.join(RESULTS_DIR, `${record.date.slice(0, 10)}-${c.id}.json`);
    fs.writeFileSync(outFile, JSON.stringify(record, null, 2));
    for (const g of graded) console.log(`  ${g.pass ? '✅' : '❌'}${g.informational ? ' (info)' : ''} ${g.description}`);
    console.log(`${passed ? '✅ PASS' : '❌ FAIL'} -> ${outFile}`);
    if (!passed) failed++;
  }
  console.log(failed ? `\n❌ ${failed} case(s) failed.` : '\n🎉 all cases passed.');
  process.exit(failed ? 1 : 0);
}

// ----------------------------------------------------------------------------
const args = process.argv.slice(2);
function flag(name) {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
}
if (args[0] === 'validate') validate(discoverCases());
else if (args[0] === 'run') {
  const filter = args.includes('--case') ? flag('--case') : undefined;
  runLive(filter, args.includes('--engine') ? flag('--engine') : undefined);
} else {
  console.log('Usage:\n  node behavioral-evals/run.js validate\n  node behavioral-evals/run.js run [--case <id>] [--engine claude|opencode]');
  process.exit(args.length ? 1 : 0);
}
