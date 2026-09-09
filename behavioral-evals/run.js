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
 *  1. Build identical case fixtures in OS temp workspaces.
 *  2. Run a control with no Harness files and a treatment with only the
 *     case's named skill loaded; `--arm both` randomizes this order.
 *  3. Run: claude -p "<prompt>" --output-format json --max-turns N
 *  4. Grade expectations[] against transcript text and workspace state.
 *  5. Write paired results with fixture/prompt hashes and attribution so any
 *     grader verdict can be audited by a human.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
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

const PRESSURE_RULES = {
  budget: ['trace_contains'],
  authority: ['trace_contains'],
  complexity: ['command_exit_0', 'trace_contains'],
  expert: ['trace_contains', 'command_exit_0'],
  fatigue: ['command_exit_0', 'trace_contains'],
  management: ['command_exit_0', 'trace_contains'],
  documentation: ['file_contains'],
  'error-handling': ['file_contains'],
  security: ['file_contains', 'trace_contains'],
  tests: ['trace_contains', 'file_contains'],
  verification: ['command_exit_0', 'trace_contains'],
  social: ['trace_contains'],
  'sunk-cost': ['file_contains'],
  'scope-bypass': ['command_exit_0', 'file_contains'],
};

// --- validate mode ----------------------------------------------------------
function validate(cases) {
  let failures = 0;
  const EXPECT_TYPES = new Set([
    'trace_contains', 'trace_not_contains', 'file_contains', 'file_not_exists',
    'command_exit_0', 'tool_attempted', 'tool_executed', 'tool_completed',
    'tool_denied', 'execution_evidence',
  ]);
  for (const c of cases) {
    const problems = [];
    if (!c.id) problems.push('missing id');
    if (!c.prompt) problems.push('missing prompt');
    if (!c.max_turns) problems.push('missing max_turns');
    if (!c.fixture || !Array.isArray(c.fixture.files)) problems.push('fixture.files missing');
    if (!Array.isArray(c.expectations) || c.expectations.length === 0) problems.push('expectations missing');
    if (c.loaded_skills !== undefined && (!Array.isArray(c.loaded_skills) || c.loaded_skills.some(skill => !fs.existsSync(path.join(ROOT, skill, 'SKILL.md'))))) {
      problems.push('loaded_skills must name existing skills');
    }
    if (!resolveTreatmentSkills(c).length) problems.push('treatment must load at least one named Harness skill');
    for (const e of c.expectations || []) {
      if (!EXPECT_TYPES.has(e.type)) problems.push(`unknown expectation type "${e.type}"`);
      if (e.value === undefined && e.command === undefined && e.tool === undefined && e.name === undefined) {
        problems.push(`expectation ${e.type} needs value, command, or tool`);
      }
      if (e.type === 'command_exit_0' && (typeof e.command !== 'string' || !e.command.trim())) {
        problems.push('command_exit_0 requires a non-empty command');
      }
    }
    if (c.pressure && !/skip|don't|not|quick|minutes/i.test(c.prompt)) {
      problems.push('pressure case prompt does not read as pressure');
    }
    if (c.pressure) {
      const allowed = PRESSURE_RULES[c.pressure_category];
      if (!allowed) problems.push(`pressure_category must be one of: ${Object.keys(PRESSURE_RULES).join(', ')}`);
      else if (!(c.expectations || []).some(e => allowed.includes(e.type))) {
        problems.push(`pressure category ${c.pressure_category} has no minimum expectation (${allowed.join(' or ')})`);
      }
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

// Capture the requested fixture baseline after treatment installation so the
// installer's own artifacts (.claude/, .harness-src/, opencode.json) show up
// in neither arm's post-run scope check.
function gitSnapshot(ws) {
  execFileSync('git', ['init', '-q'], { cwd: ws });
  execFileSync('git', ['config', 'user.email', 'eval@harness.local'], { cwd: ws });
  execFileSync('git', ['config', 'user.name', 'Harness Eval'], { cwd: ws });
  execFileSync('git', ['add', '.'], { cwd: ws });
  execFileSync('git', ['commit', '-qm', 'fixture'], { cwd: ws });
}

function resolveTreatmentSkills(c) {
  if (Array.isArray(c.loaded_skills)) return c.loaded_skills;
  if (c.discipline && fs.existsSync(path.join(ROOT, c.discipline, 'SKILL.md'))) return [c.discipline];
  return [];
}

function installHarness(ws, loadedSkills) {
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
    if (!loadedSkills.includes(entry.name)) continue;
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

function buildEngineInvocation(engine, prompt, ws, maxTurns, arm = 'treatment') {
  if (engine === 'opencode') {
    const args = ['run', '--format', 'json', '--auto', '--dir', ws];
    const model = process.env.BEHAVIORAL_MODEL;
    if (model) args.push('-m', model);
    args.push(prompt);
    return { command: 'opencode', args };
  }
  // acceptEdits only auto-approves file edits, not Bash/PowerShell tool calls -
  // a headless -p session has no human to answer those prompts, so any case
  // needing a shell command (git, npm, node scripts) stalled with every tool
  // call denied and the model just describing what it would do. This harness
  // needs the same full autonomy opencode's --auto gives it, in the same kind
  // of disposable os.tmpdir() fixture workspace.
  const args = ['-p', prompt, '--output-format', 'json', '--max-turns', String(maxTurns), '--dangerously-skip-permissions', '--setting-sources', 'project,local'];
  const model = process.env.BEHAVIORAL_MODEL;
  if (model) args.push('--model', model);
  if (arm === 'baseline') args.push('--safe-mode');
  return { command: 'claude', args };
}

function runHeadless(prompt, ws, maxTurns, engine, arm) {
  // Keep the transcript OUTSIDE the workspace: grader artifacts must never
  // show up in git-status-based scope checks.
  const outPath = path.join(path.dirname(ws), path.basename(ws) + '.transcript.json');
  const invocation = buildEngineInvocation(engine, prompt, ws, maxTurns, arm);
  const outputFd = fs.openSync(outPath, 'w');
  try {
    // Pass the prompt as one argv element. A shell wrapper on Windows can
    // reinterpret spaces and punctuation, truncating prompts to `Add.`.
    execFileSync(invocation.command, invocation.args, {
      cwd: ws,
      stdio: ['ignore', outputFd, 'inherit'],
      timeout: engine === 'opencode' ? 20 * 60 * 1000 : 15 * 60 * 1000,
      windowsHide: true,
    });
  } finally {
    fs.closeSync(outputFd);
  }
  return outPath;
}

// The grader must judge what the AGENT said and did — never what it read.
// Tool outputs embed installed skill text, so keyword graders over raw
// transcripts produce false positives (a read of zoom-out/SKILL.md counts as
// "invoked zoom-out"). Trace = assistant text + tool inputs only.
const COMPLETED_TOOL_STATUSES = new Set(['completed', 'complete', 'success', 'succeeded', 'done', 'finished']);
const DENIED_TOOL_STATUSES = new Set(['denied', 'rejected', 'blocked', 'cancelled', 'canceled', 'error', 'failed']);

function firstDefined(...values) {
  return values.find(value => value !== undefined && value !== null);
}

function eventPart(event) {
  return event && event.part && typeof event.part === 'object' ? event.part : event;
}

function eventType(event) {
  return String(event && event.type || '').toLowerCase();
}

function eventStatus(event, part) {
  const state = part && part.state && typeof part.state === 'object' ? part.state : {};
  return String(firstDefined(state.status, part && part.status, event && event.status, '')).toLowerCase();
}

function eventToolName(event, part) {
  const state = part && part.state && typeof part.state === 'object' ? part.state : {};
  return String(firstDefined(part && part.tool, part && part.name, state.tool, event && event.tool, event && event.name, 'tool'));
}

function eventInput(event, part) {
  const state = part && part.state && typeof part.state === 'object' ? part.state : {};
  return firstDefined(state.input, part && part.input, part && part.arguments, event && event.input, event && event.arguments);
}

function eventId(event, part) {
  const state = part && part.state && typeof part.state === 'object' ? part.state : {};
  return firstDefined(part && (part.callID || part.callId || part.id || part.tool_use_id), state.callID, state.callId, event && (event.callID || event.callId || event.id || event.tool_use_id));
}

function isToolEvent(event, part) {
  const type = eventType(event);
  const partType = String(part && part.type || '').toLowerCase();
  return type.includes('tool') || partType === 'tool' || partType === 'tool_use' ||
    eventToolName(event, part) !== 'tool' || eventInput(event, part) !== undefined;
}

function isEditOperation(tool, input) {
  const name = String(tool || '').toLowerCase();
  if (/(^|[-_])(edit|write|patch|create|delete|move|rename)([-_]|$)/.test(name) ||
      /^(edit|write|apply_patch|create_file|delete_file|move_file|rename_file)$/.test(name)) return true;
  const command = input && typeof input === 'object' ? firstDefined(input.command, input.cmd, input.script) : input;
  return typeof command === 'string' &&
    /(?:>>?|\btee\b|\bset-content\b|\bout-file\b|\bwritefile\b|\brename(?:-item)?\b|\bremove(?:-item)?\b|\b(?:sed|perl)\b[^\r\n]*\s-i\b)/i.test(command);
}

function executionState(status, type) {
  const normalizedType = String(type || '').toLowerCase();
  if (DENIED_TOOL_STATUSES.has(status) || normalizedType.includes('denied') || normalizedType.includes('rejected')) return 'denied';
  if (status && !COMPLETED_TOOL_STATUSES.has(status)) return 'attempted';
  if (COMPLETED_TOOL_STATUSES.has(status) || (!status && (normalizedType.includes('result') || normalizedType.includes('completed')))) return 'executed';
  return 'attempted';
}

function parseTranscriptEvents(transcriptPath) {
  const raw = fs.readFileSync(transcriptPath, 'utf8');
  const events = [];
  const pendingById = new Map();
  let sequence = 0;
  const addText = text => {
    if (typeof text === 'string' && text) events.push({ kind: 'text', text, sequence: sequence++ });
  };
  const addTool = (event, part) => {
    const type = eventType(event);
    const input = eventInput(event, part) ?? {};
    const tool = eventToolName(event, part);
    const id = eventId(event, part);
    const state = executionState(eventStatus(event, part), type);
    const existing = id && pendingById.get(String(id));
    if (existing) {
      if (input && Object.keys(input).length) existing.input = input;
      existing.tool = tool !== 'tool' ? tool : existing.tool;
      if (state === 'executed' || state === 'denied') existing.state = state;
      existing.executed = existing.state === 'executed';
      existing.denied = existing.state === 'denied';
      return;
    }
    const item = {
      kind: 'tool', tool, input, id: id === undefined ? null : String(id), state,
      attempted: true, executed: state === 'executed', denied: state === 'denied',
      edit: isEditOperation(tool, input), sequence: sequence++, raw_type: type,
    };
    events.push(item);
    if (id !== undefined) pendingById.set(String(id), item);
  };
  const visit = value => {
    if (!value || typeof value !== 'object') return;
    if (Array.isArray(value)) { value.forEach(visit); return; }
    const part = eventPart(value);
    const type = eventType(value);
    if (type === 'text' || String(part && part.type || '').toLowerCase() === 'text') {
      addText(part && part.text !== undefined ? part.text : value.text);
      if (value.part || !value.message) return;
    }
    if (value.part || isToolEvent(value, part)) {
      if (isToolEvent(value, part)) addTool(value, part);
      if (value.part) return;
    }
    if (value.message && value.message.content) visit(value.message.content);
    if (value.content && value.content !== value.message) visit(value.content);
    if (!value.part && typeof value.result === 'string') addText(value.result);
  };
  let structured = false;
  for (const line of raw.split('\n')) {
    if (!line.trim()) continue;
    try {
      const value = JSON.parse(line);
      const before = events.length;
      visit(value);
      if (events.length > before) structured = true;
    } catch { /* malformed/non-JSON lines are retained only by the raw fallback */ }
  }
  if (!structured) {
    try {
      const value = JSON.parse(raw);
      if (value && typeof value.result === 'string') addText(value.result);
      else visit(value);
    } catch { /* raw fallback handled by renderAgentTrace */ }
  }
  return { raw, structured: events.length > 0, events };
}

function renderAgentTrace(parsed) {
  if (!parsed.structured) return parsed.raw;
  return parsed.events.map(event => event.kind === 'text'
    ? event.text
    : `[${event.tool}] ${JSON.stringify(event.input ?? {})}`).join('\n');
}

function extractAgentEvents(transcriptPath) {
  return parseTranscriptEvents(transcriptPath).events;
}

function extractAgentTrace(transcriptPath) {
  return renderAgentTrace(parseTranscriptEvents(transcriptPath));
}

function extractSessionMetadata(transcriptPath) {
  try {
    const raw = fs.readFileSync(transcriptPath, 'utf8');
    const obj = JSON.parse(raw);
    const cost = [obj.total_cost_usd, obj.cost_usd, obj.cost].find(value => typeof value === 'number');
    return {
      cost: cost === undefined ? null : cost,
      usage: obj.usage || null,
      duration_ms: typeof obj.duration_ms === 'number' ? obj.duration_ms : null,
      num_turns: typeof obj.num_turns === 'number' ? obj.num_turns : null,
    };
  } catch {
    return { cost: null, usage: null, duration_ms: null, num_turns: null };
  }
}

function runShellCommand(command, cwd) {
  if (typeof command !== 'string' || !command.trim()) throw new Error('command must be non-empty');
  if (process.platform === 'win32') {
    const scriptDir = fs.mkdtempSync(path.join(os.tmpdir(), 'behavioral-shell-'));
    const scriptPath = path.join(scriptDir, 'command.cmd');
    try {
      fs.writeFileSync(scriptPath, `@echo off\r\n${command}\r\n`, 'utf8');
      return execFileSync(process.env.ComSpec || 'cmd.exe', ['/d', '/c', scriptPath], { cwd, stdio: 'ignore' });
    } finally {
      fs.rmSync(scriptDir, { recursive: true, force: true });
    }
  }
  return execFileSync('/bin/sh', ['-c', command], { cwd, stdio: 'ignore' });
}

function normalizeCommand(command) {
  return String(command || '').replace(/\s+/g, ' ').trim();
}

function toolTarget(expectation) {
  if (expectation.value && typeof expectation.value === 'object') return expectation.value;
  if (expectation.command !== undefined) return { command: expectation.command };
  if (expectation.tool !== undefined) return { tool: expectation.tool };
  if (expectation.name !== undefined) return { tool: expectation.name };
  if (typeof expectation.value === 'string') return { command: expectation.value };
  if (typeof expectation.value === 'number') return { tool: String(expectation.value) };
  return {};
}

function toolMatches(event, target) {
  if (!event || event.kind !== 'tool') return false;
  const expectedTool = target.tool || target.name;
  if (expectedTool && String(event.tool).toLowerCase() !== String(expectedTool).toLowerCase()) return false;
  if (target.command !== undefined) {
    const actual = event.input && typeof event.input === 'object'
      ? firstDefined(event.input.command, event.input.cmd, event.input.script)
      : event.input;
    const expected = normalizeCommand(target.command);
    const normalizedActual = normalizeCommand(actual);
    if (!normalizedActual || !expected ||
        !(normalizedActual === expected || normalizedActual.startsWith(`${expected} `) || normalizedActual.includes(` ${expected} `))) return false;
  }
  return true;
}

function gradeToolExpectation(events, expectation) {
  const target = toolTarget(expectation);
  const type = expectation.type === 'execution_evidence' ? 'tool_executed' : expectation.type;
  return events.some(event => {
    if (!toolMatches(event, target)) return false;
    if (type === 'tool_executed' || type === 'tool_completed') {
      if (!event.executed) return false;
      if (expectation.after_edit && !events.some(previous => previous.kind === 'tool' && previous.edit && previous.executed && previous.sequence < event.sequence)) return false;
    } else if (type === 'tool_denied') {
      if (!event.denied) return false;
    } else if (type === 'tool_attempted') {
      if (!event.attempted) return false;
    }
    return true;
  });
}

function grade(c, ws, transcriptPath) {
  const parsed = parseTranscriptEvents(transcriptPath);
  const trace = renderAgentTrace(parsed);
  const events = parsed.events;
  const results = [];
  for (const e of c.expectations) {
    let pass = false;
    try {
      if (e.type === 'trace_contains') pass = trace.includes(e.value);
      else if (e.type === 'trace_not_contains') pass = !trace.includes(e.value);
      else if (e.type === 'file_contains') pass = fs.readFileSync(path.join(ws, e.path), 'utf8').includes(e.value);
      else if (e.type === 'file_not_exists') pass = !fs.existsSync(path.join(ws, e.path));
      else if (e.type === 'command_exit_0') {
        runShellCommand(e.command, ws);
        pass = true;
      } else if (['tool_attempted', 'tool_executed', 'tool_completed', 'tool_denied', 'execution_evidence'].includes(e.type)) {
        pass = gradeToolExpectation(events, e);
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
  const has = (cmd) => { 
    try { 
      // Try direct path first
      execFileSync(cmd, ['--version'], { stdio: 'pipe' }); 
      return true; 
    } catch {
      return false;
    }
  };
  if (requested) {
    if (!has(requested === 'claude' ? 'claude' : 'opencode')) fail(`engine "${requested}" not found on PATH.`);
    return requested;
  }
  if (has('claude')) return 'claude';
  if (has('opencode')) return 'opencode';
  fail('Neither `claude` nor `opencode` CLI found. Behavioral evals need a real model session.');
}

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function countToolCalls(trace) {
  return (trace.match(/^\[[^\]]+\]/gm) || []).length;
}

function treatmentSkills(c) {
  return resolveTreatmentSkills(c);
}

function runArm(c, engine, arm, pairId) {
  const loadedSkills = arm === 'treatment' ? treatmentSkills(c) : [];
  const attributionRequired = arm === 'treatment';
  const ws = buildWorkspace(c);
  if (arm === 'treatment') installHarness(ws, loadedSkills);
  if (c.fixture.git) gitSnapshot(ws);

  const record = {
    arm,
    pair_id: pairId,
    harness_loaded: arm === 'treatment',
    loaded_skills: loadedSkills,
    attribution_required: attributionRequired,
    workspace: ws,
    fixture_sha256: sha256(JSON.stringify(c.fixture)),
    prompt_sha256: sha256(c.prompt),
    cost: null,
  };
  try {
    const transcriptPath = runHeadless(c.prompt, ws, c.max_turns, engine, arm);
    const { results, passed } = grade(c, ws, transcriptPath);
    const trace = extractAgentTrace(transcriptPath);
    const metadata = extractSessionMetadata(transcriptPath);
    if (attributionRequired && loadedSkills.length === 0) {
      throw new Error('treatment attribution is required but no skill was loaded');
    }
    return {
      ...record,
      transcript: transcriptPath,
      cost: metadata.cost,
      usage: metadata.usage,
      duration_ms: metadata.duration_ms,
      num_turns: metadata.num_turns,
      expectations: results.map(({ type, value, command, after_edit, description, pass }) => ({
        type, value, command, after_edit, description, pass,
      })),
      outcome: passed ? 'pass' : 'fail',
      tool_call_count: countToolCalls(trace),
      trace_preview: trace.slice(0, 500),
    };
  } catch (err) {
    return {
      ...record,
      outcome: 'session-error',
      error: err.message.slice(0, 500),
      tool_call_count: 0,
    };
  }
}

function pairVerdict(baseline, treatment) {
  if (baseline.outcome === 'pass' && treatment.outcome === 'pass') return 'INCONCLUSIVE';
  if (baseline.outcome !== 'pass' && treatment.outcome === 'pass') return 'EFFECTIVE';
  if (baseline.outcome === 'pass' && treatment.outcome !== 'pass') return 'HARMFUL';
  return 'INEFFECTIVE';
}

function wilsonInterval(successes, total) {
  if (!total) return null;
  const z = 1.96;
  const p = successes / total;
  const denominator = 1 + (z * z) / total;
  const centre = (p + (z * z) / (2 * total)) / denominator;
  const spread = (z / denominator) * Math.sqrt((p * (1 - p) / total) + (z * z) / (4 * total * total));
  return [Math.max(0, centre - spread), Math.min(1, centre + spread)].map(v => Number(v.toFixed(4)));
}

function runLive(filter, engineArg, armArg = 'treatment') {
  const validArms = new Set(['baseline', 'treatment', 'both']);
  if (!validArms.has(armArg)) fail(`arm must be baseline, treatment, or both (got ${armArg})`);
  const engine = resolveEngine(engineArg);
  console.log(`Engine: ${engine}`);
  console.log(`Arm mode: ${armArg}`);
  const cases = discoverCases().filter((c) => !filter || c.id === filter);
  if (filter && cases.length === 0) fail(`no case with id "${filter}"`);
  fs.mkdirSync(RESULTS_DIR, { recursive: true });

  const pairResults = [];
  let sessionFailures = 0;
  for (const c of cases) {
    const pairId = `${c.id}-${Date.now()}-${crypto.randomBytes(3).toString('hex')}`;
    const order = armArg === 'both'
      ? (crypto.randomInt(0, 2) === 0 ? ['baseline', 'treatment'] : ['treatment', 'baseline'])
      : [armArg];
    console.log(`\n=== ${c.id}${c.pressure ? ' [PRESSURE]' : ''} | order: ${order.join(' -> ')} ===`);
    const arms = {};
    for (const arm of order) arms[arm] = runArm(c, engine, arm, pairId);

    const record = {
      id: c.id,
      pair_id: pairId,
      engine,
      model: engine === 'opencode' ? (process.env.BEHAVIORAL_MODEL || 'openai/gpt-5-mini') : (process.env.BEHAVIORAL_MODEL || 'claude-default'),
      pressure: !!c.pressure,
      pressure_category: c.pressure_category || null,
      sample_unit: 'paired case',
      arm_order: order,
      fixture_sha256: sha256(JSON.stringify(c.fixture)),
      prompt_sha256: sha256(c.prompt),
      arms,
      verdict: armArg === 'both' ? pairVerdict(arms.baseline, arms.treatment) : null,
      date: new Date().toISOString(),
    };
    pairResults.push(record);
    if (Object.values(arms).some(arm => arm.outcome === 'session-error')) sessionFailures++;
    for (const arm of Object.values(arms)) {
      console.log(`  ${arm.arm}: ${arm.outcome} (${arm.loaded_skills.length ? arm.loaded_skills.join(', ') : 'no Harness skills'})`);
    }
    if (armArg === 'both') console.log(`  Verdict: ${record.verdict}`);
    const suffix = armArg === 'both' ? 'pair' : armArg;
    fs.writeFileSync(path.join(RESULTS_DIR, `${record.date.slice(0, 10)}-${c.id}-${suffix}.json`), JSON.stringify(record, null, 2));
  }

  if (armArg === 'both') {
    const completed = pairResults.filter(r => !Object.values(r.arms).some(a => a.outcome === 'session-error'));
    const effective = completed.filter(r => r.verdict === 'EFFECTIVE').length;
    const categorySummary = {};
    for (const record of pairResults) {
      const category = record.pressure_category || 'unclassified';
      if (!categorySummary[category]) categorySummary[category] = { requested: 0, completed: 0, pass: 0, fail: 0 };
      categorySummary[category].requested++;
    }
    for (const record of completed) {
      const category = record.pressure_category || 'unclassified';
      const bucket = categorySummary[category];
      bucket.completed++;
      if (record.arms.treatment.outcome === 'pass') bucket.pass++;
      else bucket.fail++;
    }
    for (const bucket of Object.values(categorySummary)) {
      bucket.pass_rate = Number((bucket.pass / bucket.completed).toFixed(4));
      bucket.pass_rate_ci95 = wilsonInterval(bucket.pass, bucket.completed);
    }
    const costs = completed.flatMap(record => Object.values(record.arms).map(arm => arm.cost));
    const cost = costs.length === completed.length * 2 && costs.every(value => typeof value === 'number')
      ? Number(costs.reduce((sum, value) => sum + value, 0).toFixed(6))
      : null;
    const summary = {
      date: new Date().toISOString(),
      protocol: 'paired-randomized-v1',
      requested_sample_size: cases.length,
      completed_pairs: completed.length,
      session_failures: pairResults.length - completed.length,
      boundary_compliance: completed.length === cases.length ? 'complete' : 'incomplete',
      cost,
      tool_call_delta: completed.map(r => ({
        id: r.id,
        baseline: r.arms.baseline.tool_call_count,
        treatment: r.arms.treatment.tool_call_count,
        treatment_minus_baseline: r.arms.treatment.tool_call_count - r.arms.baseline.tool_call_count,
      })),
      verdicts: Object.fromEntries(['EFFECTIVE', 'INEFFECTIVE', 'INCONCLUSIVE', 'HARMFUL'].map(v => [v, completed.filter(r => r.verdict === v).length])),
      effective_rate_ci95: wilsonInterval(effective, completed.length),
      pressure_categories: categorySummary,
      interpretation: completed.length < 2
        ? 'insufficient paired samples for an effectiveness claim'
        : 'report paired outcomes; do not treat INCONCLUSIVE pairs as skill lift',
    };
    const summaryPath = path.join(RESULTS_DIR, `${new Date().toISOString().slice(0, 10)}-summary-both.json`);
    fs.writeFileSync(summaryPath, JSON.stringify(summary, null, 2));
    console.log(`\nPaired summary: ${summaryPath}`);
    console.log(`Completed pairs: ${summary.completed_pairs}/${summary.requested_sample_size}`);
  }
  process.exit(sessionFailures ? 1 : 0);
}

// ----------------------------------------------------------------------------
function main() {
  const args = process.argv.slice(2);
  function flag(name) {
    const i = args.indexOf(name);
    return i >= 0 ? args[i + 1] : undefined;
  }
  if (args[0] === 'validate') validate(discoverCases());
  else if (args[0] === 'run') {
    const filter = args.includes('--case') ? flag('--case') : undefined;
    runLive(filter, args.includes('--engine') ? flag('--engine') : undefined, args.includes('--arm') ? flag('--arm') : undefined);
  } else {
    console.log('Usage:\n  node behavioral-evals/run.js validate\n  node behavioral-evals/run.js run [--case <id>] [--arm baseline|treatment|both] [--engine claude|opencode]');
    process.exit(args.length ? 1 : 0);
  }
}

if (require.main === module) main();

module.exports = {
  buildEngineInvocation,
  extractAgentEvents,
  extractAgentTrace,
  extractSessionMetadata,
  grade,
  parseSimpleYaml,
  parseTranscriptEvents,
  validate,
};
