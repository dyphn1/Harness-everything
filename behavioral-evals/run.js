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
  if (c.fixture.git) {
    execFileSync('git', ['init', '-q'], { cwd: ws });
    execFileSync('git', ['config', 'user.email', 'eval@harness.local'], { cwd: ws });
    execFileSync('git', ['config', 'user.name', 'Harness Eval'], { cwd: ws });
    execFileSync('git', ['add', '.'], { cwd: ws });
    execFileSync('git', ['commit', '-qm', 'fixture'], { cwd: ws });
  }
  return ws;
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
  fs.mkdirSync(path.join(ws, '.claude', 'skills'), { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    if (!fs.existsSync(path.join(src, entry.name, 'SKILL.md'))) continue;
    fs.cpSync(path.join(src, entry.name), path.join(ws, '.claude', 'skills', entry.name), { recursive: true });
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
}

function runHeadless(prompt, ws, maxTurns) {
  const outPath = path.join(ws, '.transcript.json');
  execFileSync('claude', ['-p', prompt, '--output-format', 'json', '--max-turns', String(maxTurns)],
    { cwd: ws, stdio: ['ignore', fs.openSync(outPath, 'w'), 'inherit'], timeout: 15 * 60 * 1000 });
  return outPath;
}

function grade(c, ws, transcriptPath) {
  const trace = fs.existsSync(transcriptPath) ? fs.readFileSync(transcriptPath, 'utf8') : '';
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
  return results;
}

function runLive(filter) {
  if (!process.env.CI) { /* headless runs are local-only by design */ }
  try {
    execFileSync('claude', ['--version'], { stdio: 'pipe' });
  } catch {
    fail('`claude` CLI not found. Install from https://github.com/anthropics/claude-code — behavioral evals need a real model session.');
  }
  const cases = discoverCases().filter((c) => !filter || c.id === filter);
  if (filter && cases.length === 0) fail(`no case with id "${filter}"`);
  fs.mkdirSync(RESULTS_DIR, { recursive: true });

  let failed = 0;
  for (const c of cases) {
    console.log(`\n=== ${c.id}${c.pressure ? ' [PRESSURE]' : ''} ===`);
    const ws = buildWorkspace(c);
    installHarness(ws);
    let transcriptPath;
    try {
      transcriptPath = runHeadless(c.prompt, ws, c.max_turns);
    } catch (err) {
      console.error(`❌ session failed: ${err.message.slice(0, 300)}`);
      failed++;
      continue;
    }
    const graded = grade(c, ws, transcriptPath);
    const passed = graded.every((g) => g.pass);
    const record = {
      id: c.id,
      pressure: !!c.pressure,
      date: new Date().toISOString(),
      workspace: ws,
      transcript: transcriptPath,
      expectations: graded.map(({ description, pass }) => ({ description, pass })),
      outcome: passed ? 'pass' : 'fail',
    };
    const outFile = path.join(RESULTS_DIR, `${record.date.slice(0, 10)}-${c.id}.json`);
    fs.writeFileSync(outFile, JSON.stringify(record, null, 2));
    for (const g of graded) console.log(`  ${g.pass ? '✅' : '❌'} ${g.description}`);
    console.log(`${passed ? '✅ PASS' : '❌ FAIL'} -> ${outFile}`);
    if (!passed) failed++;
  }
  console.log(failed ? `\n❌ ${failed} case(s) failed.` : '\n🎉 all cases passed.');
  process.exit(failed ? 1 : 0);
}

// ----------------------------------------------------------------------------
const args = process.argv.slice(2);
if (args[0] === 'validate') validate(discoverCases());
else if (args[0] === 'run') runLive(args[0] === 'run' && args[1] === '--case' ? args[2] : undefined);
else {
  console.log('Usage:\n  node behavioral-evals/run.js validate\n  node behavioral-evals/run.js run [--case <id>]');
  process.exit(args.length ? 1 : 0);
}
