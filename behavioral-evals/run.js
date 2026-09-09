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
 *  3. Run: claude -p "<prompt>" --output-format stream-json --verbose --max-turns N
 *  4. Grade expectations[] against transcript text and workspace state.
 *  5. Write paired results with fixture/prompt hashes and attribution so any
 *     grader verdict can be audited by a human.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { execFileSync } = require('child_process');
const {
  gradeExecutionEvidence,
  parseTranscriptFile,
} = require('./transcript-parser');

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
    'trace_contains', 'trace_not_contains', 'file_contains', 'file_not_exists', 'command_exit_0',
    'tool_call', 'tool_attempted', 'tool_completed', 'tool_executed', 'tool_denied', 'execution_evidence',
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
      if (e.value === undefined && e.command === undefined && e.tool === undefined && e.name === undefined && e.count === undefined) {
        problems.push(`expectation ${e.type} needs value, tool, name, count, or command`);
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
  const args = ['-p', prompt, '--output-format', 'stream-json', '--verbose', '--max-turns', String(maxTurns), '--dangerously-skip-permissions', '--setting-sources', 'project,local'];
  const model = process.env.BEHAVIORAL_MODEL;
  if (model) args.push('--model', model);
  if (arm === 'baseline') args.push('--safe-mode');
  return { command: 'claude', args };
}

function expandWindowsBatchPath(value, batchPath) {
  const base = path.dirname(batchPath) + path.sep;
  return value
    .replace(/%~dp0/gi, base)
    .replace(/%dp0%/gi, base)
    .replace(/^"|"$/g, '')
    .trim();
}

function windowsCommandCandidates(command) {
  try {
    return execFileSync('where.exe', [command], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })
      .split(/\r?\n/)
      .map(line => line.trim())
      .filter(line => line && !/^INFO:/i.test(line));
  } catch {
    return [];
  }
}

function resolveCliInvocation(invocation) {
  if (process.platform !== 'win32') return invocation;
  const candidates = windowsCommandCandidates(invocation.command);
  const native = candidates.find(candidate => /\.exe$/i.test(candidate));
  if (native) return { command: native, args: invocation.args.slice() };
  const shim = candidates.find(candidate => /\.(?:cmd|bat)$/i.test(candidate));
  if (shim) {
    let source = '';
    try { source = fs.readFileSync(shim, 'utf8'); } catch { source = ''; }
    const nodeEntry = source.match(/(?:^|\s)(?:node(?:\.exe)?)(?:\s+)(?:"([^"]+\.js)"|([^\s]+\.js))/im);
    if (nodeEntry) {
      const entry = expandWindowsBatchPath(nodeEntry[1] || nodeEntry[2], shim);
      return { command: process.execPath, args: [entry, ...invocation.args] };
    }
    const binaryEntry = source.match(/"?([^"\r\n]+\.exe)"?\s+%\*/i);
    if (binaryEntry) {
      const entry = expandWindowsBatchPath(binaryEntry[1], shim);
      return { command: entry, args: invocation.args.slice() };
    }
  }
  const direct = candidates.find(candidate => !/\.(?:cmd|bat|ps1)$/i.test(candidate));
  return direct ? { command: direct, args: invocation.args.slice() } : invocation;
}

function runHeadless(prompt, ws, maxTurns, engine, arm) {
  // Keep the transcript OUTSIDE the workspace: grader artifacts must never
  // show up in git-status-based scope checks.
  const outPath = path.join(path.dirname(ws), path.basename(ws) + '.transcript.jsonl');
  const invocation = buildEngineInvocation(engine, prompt, ws, maxTurns, arm);
  const executable = resolveCliInvocation(invocation);
  const outputFd = fs.openSync(outPath, 'w');
  try {
    // Pass the prompt as one argv element. A shell wrapper on Windows can
    // reinterpret spaces and punctuation, truncating prompts to `Add.`.
    execFileSync(executable.command, executable.args, {
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
function extractAgentTrace(transcriptPath, engine = 'auto') {
  return parseTranscriptFile(transcriptPath, engine).trace;
}

function extractSessionMetadata(transcriptPath, engine = 'auto') {
  const parsed = parseTranscriptFile(transcriptPath, engine);
  return {
    ...parsed.metadata,
    parse_status: parsed.parseStatus,
    parse_error: parsed.parseError,
    format: parsed.format,
  };
}

function runShellCommand(command, cwd) {
  if (process.platform === 'win32') {
    return execFileSync(process.env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', command], { cwd, stdio: 'ignore' });
  }
  return execFileSync('/bin/sh', ['-c', command], { cwd, stdio: 'ignore' });
}

const EXECUTION_COMMAND_RE = /^(?:npm|npx|node|git|pnpm|yarn|bun|cargo|python(?:3)?|pytest|go|ruby|java|make|rm|mv|cp|mkdir|chmod|powershell|pwsh|bash|sh|cmd)(?:\s|$)/i;

function isExecutionLikeTraceValue(value) {
  if (typeof value !== 'string') return false;
  const text = value.trim();
  return (EXECUTION_COMMAND_RE.test(text) && /\s+\S/.test(text))
    || /(?:^|[/\\])[\w.-]+\.(?:c?js|mjs|py|sh|ps1|bat|cmd)\b/i.test(text);
}

function grade(c, ws, transcriptPath, engine = 'auto') {
  const parsed = parseTranscriptFile(transcriptPath, engine);
  const trace = parsed.trace;
  const results = [];
  for (const e of c.expectations) {
    let pass = false;
    let status = 'fail';
    let reason = null;
    try {
      if (['tool_call', 'tool_attempted', 'tool_completed', 'tool_executed', 'tool_denied', 'execution_evidence'].includes(e.type)) {
        const evidenceResult = gradeExecutionEvidence(e, parsed);
        pass = evidenceResult.pass;
        status = evidenceResult.status;
        reason = evidenceResult.reason;
      } else if (e.type === 'trace_contains' || e.type === 'trace_not_contains') {
        if (e.type === 'trace_contains' && isExecutionLikeTraceValue(e.value)) {
          status = 'inconclusive';
          reason = 'execution-like trace assertions require structured tool evidence';
        } else if (parsed.parseStatus !== 'parsed') {
          status = 'inconclusive';
          reason = parsed.parseError || 'transcript parser did not produce a complete structured trace';
        } else {
          pass = e.type === 'trace_contains' ? trace.includes(e.value) : !trace.includes(e.value);
          status = pass ? 'pass' : 'fail';
        }
      } else if (e.type === 'file_contains') {
        pass = fs.readFileSync(path.join(ws, e.path), 'utf8').includes(e.value);
        status = pass ? 'pass' : 'fail';
      } else if (e.type === 'file_not_exists') {
        pass = !fs.existsSync(path.join(ws, e.path));
        status = pass ? 'pass' : 'fail';
      } else if (e.type === 'command_exit_0') {
        runShellCommand(e.command, ws);
        pass = true;
        status = 'pass';
      }
    } catch (err) {
      pass = false;
      status = status === 'inconclusive' ? status : 'fail';
      reason = err.message;
    }
    results.push({ ...e, pass, status, reason });
  }
  // Informational expectations are reported but never gate the outcome:
  // they capture context-dependent behavior (e.g. zoom-out only becomes
  // obligatory once the breaker actually trips) that would otherwise
  // produce meaningless failures.
  const gating = results.filter((r) => !r.informational);
  const inconclusive = parsed.parseStatus !== 'parsed' || gating.some(result => result.status === 'inconclusive');
  const passed = gating.length > 0 && !inconclusive && gating.every((g) => g.pass);
  return {
    results,
    passed,
    status: inconclusive ? 'inconclusive' : passed ? 'pass' : 'fail',
    parsed,
    trace,
    executionEvidence: parsed.executionEvidence,
  };
}

function resolveEngine(requested) {
  const has = (cmd) => {
    try {
      const invocation = resolveCliInvocation({ command: cmd, args: [] });
      execFileSync(invocation.command, [...invocation.args, '--version'], { stdio: 'pipe' });
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
  const evidence = trace && (trace.executionEvidence || (trace.parsed && trace.parsed.executionEvidence));
  if (evidence) return evidence.counts.attempted;
  const text = typeof trace === 'string' ? trace : trace && trace.trace;
  return typeof text === 'string' ? (text.match(/^\[[^\]]+\]/gm) || []).length : null;
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
    const graded = grade(c, ws, transcriptPath, engine);
    const { results, passed } = graded;
    const trace = graded.trace;
    const metadata = graded.parsed.metadata;
    const evidence = graded.executionEvidence;
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
      model_name: metadata.model,
      expectations: results.map(({ description, pass, status, reason }) => ({ description, pass, status, reason })),
      outcome: graded.status,
      parse_status: graded.parsed.parseStatus,
      parse_error: graded.parsed.parseError,
      transcript_format: graded.parsed.format,
      cli_version: metadata.cli_version,
      tool_call_count: countToolCalls(graded),
      tool_call_counts: evidence.counts,
      execution_evidence: evidence,
      trace_preview: trace.slice(0, 500),
    };
  } catch (err) {
    return {
      ...record,
      outcome: 'session-error',
      error: err.message.slice(0, 500),
      parse_status: 'unavailable',
      tool_call_count: null,
      tool_call_counts: { attempted: null, completed: null, denied: null, unresolved: null },
    };
  }
}

function isDefinitiveArm(arm) {
  return !!arm && (arm.outcome === 'pass' || arm.outcome === 'fail');
}

function isCompletedPair(record) {
  return !!record && isDefinitiveArm(record.arms && record.arms.baseline)
    && isDefinitiveArm(record.arms && record.arms.treatment);
}

function pairVerdict(baseline, treatment) {
  if (!isDefinitiveArm(baseline) || !isDefinitiveArm(treatment)) return 'INCONCLUSIVE';
  if (baseline.outcome === 'pass' && treatment.outcome === 'pass') return 'INCONCLUSIVE';
  if (baseline.outcome !== 'pass' && treatment.outcome === 'pass') return 'EFFECTIVE';
  if (baseline.outcome === 'pass' && treatment.outcome !== 'pass') return 'HARMFUL';
  return 'INEFFECTIVE';
}

function summarizePairResults(pairResults) {
  const completed = pairResults.filter(isCompletedPair);
  const sessionFailures = pairResults.filter(record => Object.values(record.arms || {})
    .some(arm => arm.outcome === 'session-error')).length;
  const effective = completed.filter(record => record.verdict === 'EFFECTIVE').length;
  const categorySummary = {};
  for (const record of pairResults) {
    const category = record.pressure_category || 'unclassified';
    if (!categorySummary[category]) {
      categorySummary[category] = { requested: 0, completed: 0, pass: 0, fail: 0 };
    }
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
    bucket.pass_rate = bucket.completed
      ? Number((bucket.pass / bucket.completed).toFixed(4))
      : null;
    bucket.pass_rate_ci95 = wilsonInterval(bucket.pass, bucket.completed);
  }
  const costs = completed.flatMap(record => Object.values(record.arms || {}).map(arm => arm.cost));
  const cost = costs.length === completed.length * 2 && costs.every(value => typeof value === 'number')
    ? Number(costs.reduce((sum, value) => sum + value, 0).toFixed(6))
    : null;
  const toolCallDelta = completed.map(record => {
    const baseline = record.arms.baseline.tool_call_count;
    const treatment = record.arms.treatment.tool_call_count;
    return {
      id: record.id,
      baseline,
      treatment,
      treatment_minus_baseline: typeof baseline === 'number' && typeof treatment === 'number'
        ? treatment - baseline
        : null,
    };
  });
  return {
    cost,
    completed_pairs: completed.length,
    session_failures: sessionFailures,
    tool_call_delta: toolCallDelta,
    verdicts: Object.fromEntries(['EFFECTIVE', 'INEFFECTIVE', 'INCONCLUSIVE', 'HARMFUL']
      .map(verdict => [verdict, completed.filter(record => record.verdict === verdict).length])),
    effective_rate_ci95: wilsonInterval(effective, completed.length),
    pressure_categories: categorySummary,
  };
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
    for (const arm of Object.values(arms)) {
      console.log(`  ${arm.arm}: ${arm.outcome} (${arm.loaded_skills.length ? arm.loaded_skills.join(', ') : 'no Harness skills'})`);
    }
    if (Object.values(arms).some(arm => arm.outcome === 'session-error')) sessionFailures++;
    if (armArg === 'both') console.log(`  Verdict: ${record.verdict}`);
    const suffix = armArg === 'both' ? 'pair' : armArg;
    fs.writeFileSync(path.join(RESULTS_DIR, `${record.date.slice(0, 10)}-${c.id}-${suffix}.json`), JSON.stringify(record, null, 2));
  }

  let exitCode = sessionFailures ? 1 : 0;
  if (armArg === 'both') {
    const aggregate = summarizePairResults(pairResults);
    const summary = {
      date: new Date().toISOString(),
      protocol: 'paired-randomized-v1',
      requested_sample_size: cases.length,
      ...aggregate,
      boundary_compliance: aggregate.completed_pairs === cases.length ? 'complete' : 'incomplete',
      cost: aggregate.cost,
      interpretation: aggregate.completed_pairs < 2
        ? 'insufficient paired samples for an effectiveness claim'
        : 'report paired outcomes; do not treat INCONCLUSIVE pairs as skill lift',
    };
    const summaryPath = path.join(RESULTS_DIR, `${new Date().toISOString().slice(0, 10)}-summary-both.json`);
    fs.writeFileSync(summaryPath, JSON.stringify(summary, null, 2));
    console.log(`\nPaired summary: ${summaryPath}`);
    console.log(`Completed pairs: ${summary.completed_pairs}/${summary.requested_sample_size}`);
    exitCode = aggregate.session_failures ? 1 : 0;
  }
  process.exit(exitCode);
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
  countToolCalls,
  extractAgentTrace,
  extractSessionMetadata,
  grade,
  pairVerdict,
  parseSimpleYaml,
  summarizePairResults,
  validate,
};
