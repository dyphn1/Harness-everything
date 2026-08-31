#!/usr/bin/env node
/**
 * Behavioral Eval Runner with opencode plugin
 * 
 * Runs discipline cases with opencode plugin hooks enabled.
 * Usage: node behavioral-evals/run-with-plugin.js run [--case <id>]
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const CASES_DIR = path.join(__dirname, 'cases');
const RESULTS_DIR = path.join(__dirname, 'results');
const PLUGIN_DIR = path.join(ROOT, 'opencode-plugin');

// Minimal YAML subset parser (copied from run.js)
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

function discoverCases() {
  return fs.readdirSync(CASES_DIR)
    .filter((f) => f.endsWith('.yaml'))
    .map((f) => ({ file: path.join(CASES_DIR, f), ...parseSimpleYaml(fs.readFileSync(path.join(CASES_DIR, f), 'utf8')) }));
}

function fail(msg) {
  console.error(`❌ ${msg}`);
  process.exit(1);
}

function buildWorkspace(c) {
  const ws = fs.mkdtempSync(path.join(os.tmpdir(), `harness-behavioral-plugin-${c.id}-`));
  for (const f of c.fixture.files) {
    const target = path.join(ws, f.path);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, typeof f.content === 'string' ? f.content.replace(/\n$/, '') + '\n' : String(f.content));
  }
  return ws;
}

function gitSnapshot(ws) {
  execFileSync('git', ['init', '-q'], { cwd: ws });
  execFileSync('git', ['config', 'user.email', 'eval@harness.local'], { cwd: ws });
  execFileSync('git', ['config', 'user.name', 'Harness Eval'], { cwd: ws });
  execFileSync('git', ['add', '.'], { cwd: ws });
  execFileSync('git', ['commit', '-qm', 'fixture'], { cwd: ws });
}

function installHarnessWithPlugin(ws) {
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
        h.command = h.command.replace(/^node /, `node "${src}/`) + '"';
      }
    }
  }
  const settingsPath = path.join(ws, '.claude', 'settings.json');
  const settings = fs.existsSync(settingsPath) ? JSON.parse(fs.readFileSync(settingsPath, 'utf8')) : {};
  settings.hooks = { ...(settings.hooks || {}), ...hooksCfg };
  fs.mkdirSync(path.dirname(settingsPath), { recursive: true });
  fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2));
  
  // opencode config with skills AND plugin hooks
  const pluginHooks = {};
  const pluginJson = JSON.parse(fs.readFileSync(path.join(PLUGIN_DIR, 'plugin.json'), 'utf8'));
  
  // Map plugin hooks to opencode hook events
  if (pluginJson.hooks) {
    for (const [event, hookFile] of Object.entries(pluginJson.hooks)) {
      const hookPath = path.join(PLUGIN_DIR, hookFile);
      if (fs.existsSync(hookPath)) {
        pluginHooks[event] = [{ type: 'command', command: `node "${hookPath}"` }];
      }
    }
  }
  
  fs.writeFileSync(
    path.join(ws, 'opencode.json'),
    JSON.stringify({
      $schema: 'https://opencode.ai/config.json',
      instructions: skillNames.map((n) => `.claude/skills/${n}/SKILL.md`),
      hooks: pluginHooks
    }, null, 2)
  );
  
  // Also copy plugin hooks to workspace for reference
  fs.cpSync(PLUGIN_DIR, path.join(src, 'opencode-plugin'), { recursive: true });
}

function runHeadless(prompt, ws, maxTurns) {
  const outPath = path.join(path.dirname(ws), path.basename(ws) + '.transcript.json');
  const model = process.env.BEHAVIORAL_MODEL;
  const args = ['run', '--format', 'json', '--auto', '--dir', ws];
  if (model) args.push('-m', model);
  // Pass the prompt as one argv element; shell quoting corrupts prompts on
  // Windows and previously reduced full requests to fragments such as `Add.`.
  args.push(prompt);
  const outputFd = fs.openSync(outPath, 'w');
  try {
    execFileSync('opencode', args,
      { cwd: ws, stdio: ['ignore', outputFd, 'inherit'], timeout: 20 * 60 * 1000, windowsHide: true });
  } finally {
    fs.closeSync(outputFd);
  }
  return outPath;
}

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
        if (process.platform === 'win32') {
          execFileSync(process.env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', e.command], { cwd: ws, stdio: 'ignore' });
        } else {
          execFileSync('/bin/sh', ['-c', e.command], { cwd: ws, stdio: 'ignore' });
        }
        pass = true;
      }
    } catch (err) {
      pass = false;
    }
    results.push({ ...e, pass });
  }
  const gating = results.filter((r) => !r.informational);
  return { results, passed: gating.length > 0 && gating.every((g) => g.pass) };
}

function runLive(filter) {
  console.log('Engine: opencode (with plugin hooks)');
  const cases = discoverCases().filter((c) => !filter || c.id === filter);
  if (filter && cases.length === 0) fail(`no case with id "${filter}"`);
  fs.mkdirSync(RESULTS_DIR, { recursive: true });

  let failed = 0;
  for (const c of cases) {
    console.log(`\n=== ${c.id}${c.pressure ? ' [PRESSURE]' : ''} ===`);
    const ws = buildWorkspace(c);
    installHarnessWithPlugin(ws);
    if (c.fixture.git) gitSnapshot(ws);
    let transcriptPath;
    try {
      transcriptPath = runHeadless(c.prompt, ws, c.max_turns);
    } catch (err) {
      console.error(`❌ session failed: ${err.message.slice(0, 300)}`);
      failed++;
      continue;
    }
    const { results: graded, passed } = grade(c, ws, transcriptPath);
    const record = {
      id: c.id,
      engine: 'opencode-with-plugin',
      model: process.env.BEHAVIORAL_MODEL || 'openai/gpt-5-mini',
      pressure: !!c.pressure,
      date: new Date().toISOString(),
      workspace: ws,
      transcript: transcriptPath,
      expectations: graded.map(({ description, pass }) => ({ description, pass })),
      outcome: passed ? 'pass' : 'fail',
    };
    const outFile = path.join(RESULTS_DIR, `plugin-${record.date.slice(0, 10)}-${c.id}.json`);
    fs.writeFileSync(outFile, JSON.stringify(record, null, 2));
    for (const g of graded) console.log(`  ${g.pass ? '✅' : '❌'}${g.informational ? ' (info)' : ''} ${g.description}`);
    console.log(`${passed ? '✅ PASS' : '❌ FAIL'} -> ${outFile}`);
    if (!passed) failed++;
  }
  console.log(failed ? `\n❌ ${failed} case(s) failed.` : '\n🎉 all cases passed.');
  process.exit(failed ? 1 : 0);
}

const args = process.argv.slice(2);
function flag(name) {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
}
if (args[0] === 'validate') validate(discoverCases());
else if (args[0] === 'run') {
  const filter = args.includes('--case') ? flag('--case') : undefined;
  runLive(filter);
} else {
  console.log('Usage:\n  node behavioral-evals/run-with-plugin.js run [--case <id>]');
  process.exit(args.length ? 1 : 0);
}
