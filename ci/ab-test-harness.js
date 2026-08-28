#!/usr/bin/env node
/**
 * A/B Test Harness — Method Effectiveness Evaluation
 *
 * Proves whether skills actually change agent behavior by comparing
 * baseline (no skill) vs treatment (skill loaded) outputs.
 *
 *   node eval-framework/ab-test-harness.js validate          # structural check (free)
 *   node eval-framework/ab-test-harness.js run               # run all cases (costs tokens)
 *   node eval-framework/ab-test-harness.js run --case <id>   # run one case
 *
 * Verdict logic:
 *   baseline FAIL + treatment PASS => EFFECTIVE (skill changed behavior)
 *   baseline FAIL + treatment FAIL => INEFFECTIVE (skill didn't help)
 *   baseline PASS + treatment PASS => INCONCLUSIVE (baseline already does it)
 *   baseline PASS + treatment FAIL => HARMFUL (skill made behavior worse)
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const CASES_DIR = path.join(__dirname, 'ab-test-cases');
const RESULTS_DIR = path.join(ROOT, 'benchmarks');
const SKILLS_DIR = path.join(ROOT);

// ---------------------------------------------------------------------------
// YAML parser (reuse pattern from behavioral-evals/run.js)
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
    return parseBlock(ind);
  }
  function scalar(v) {
    const t = v.trim();
    if (t === 'true') return true;
    if (t === 'false') return false;
    if (/^-?\d+$/.test(t)) return parseInt(t, 10);
    if ((t.startsWith('"') && t.endsWith('"')) || (t.startsWith("'") && t.endsWith("'"))) return t.slice(1, -1);
    return t;
  }
  return parseBlock(0) || {};
}

// ---------------------------------------------------------------------------
// Discover and validate cases
function discoverCases() {
  if (!fs.existsSync(CASES_DIR)) return [];
  return fs.readdirSync(CASES_DIR)
    .filter((f) => f.endsWith('.yaml'))
    .map((f) => ({ file: path.join(CASES_DIR, f), ...parseSimpleYaml(fs.readFileSync(path.join(CASES_DIR, f), 'utf8')) }));
}

function validateCase(c) {
  const errors = [];
  if (!c.id) errors.push('missing id');
  if (!c.skill) errors.push('missing skill');
  if (!c.name) errors.push('missing name');
  if (!c.prompt) errors.push('missing prompt');
  if (!c.baseline_rubric || !Array.isArray(c.baseline_rubric) || c.baseline_rubric.length === 0)
    errors.push('missing or empty baseline_rubric');
  if (!c.treatment_rubric || !Array.isArray(c.treatment_rubric) || c.treatment_rubric.length === 0)
    errors.push('missing or empty treatment_rubric');
  if (!c.verdict_rule) errors.push('missing verdict_rule');
  // Check skill file exists
  const skillPath = path.join(SKILLS_DIR, c.skill, 'SKILL.md');
  if (!fs.existsSync(skillPath)) errors.push(`skill file not found: ${skillPath}`);
  return errors;
}

// ---------------------------------------------------------------------------
// Run a headless agent session
function runHeadless(prompt, cwd, engine) {
  const model = process.env.AB_TEST_MODEL || 'openai/gpt-5-mini';
  const outPath = path.join(os.tmpdir(), `ab-test-${Date.now()}-${Math.random().toString(36).slice(2)}.json`);
  try {
    execFileSync('opencode', ['run', '-m', model, prompt, '--format', 'json', '--auto', '--dir', cwd],
      { cwd, stdio: ['ignore', fs.openSync(outPath, 'w'), 'inherit'], timeout: 10 * 60 * 1000 });
  } catch (err) {
    // Timeout or crash — return empty trace
    return '';
  }
  return extractTrace(outPath);
}

function extractTrace(transcriptPath) {
  try {
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
  } catch {
    return '';
  }
}

// ---------------------------------------------------------------------------
// Grade a trace against a rubric
function grade(trace, rubric) {
  const results = [];
  for (const r of rubric) {
    let pass = false;
    try {
      if (r.type === 'trace_contains') pass = trace.includes(r.value);
      else if (r.type === 'trace_not_contains') pass = !trace.includes(r.value);
      else if (r.type === 'trace_matches') pass = new RegExp(r.value, 'i').test(trace);
    } catch {
      pass = false;
    }
    results.push({ type: r.type, value: r.value, description: r.description || '', pass });
  }
  return results;
}

// ---------------------------------------------------------------------------
// Compute verdict
function computeVerdict(baselineResults, treatmentResults) {
  const baselinePass = baselineResults.every((r) => r.pass);
  const treatmentPass = treatmentResults.every((r) => r.pass);

  if (!baselinePass && treatmentPass) return 'EFFECTIVE';
  if (!baselinePass && !treatmentPass) return 'INEFFECTIVE';
  if (baselinePass && treatmentPass) return 'INCONCLUSIVE';
  if (baselinePass && !treatmentPass) return 'HARMFUL';
  return 'UNKNOWN';
}

// ---------------------------------------------------------------------------
// Build a temp workspace for the test
function buildWorkspace() {
  const ws = fs.mkdtempSync(path.join(os.tmpdir(), 'ab-test-ws-'));
  // Minimal workspace — just git init for opencode to work
  try {
    execFileSync('git', ['init', '-q'], { cwd: ws });
    execFileSync('git', ['config', 'user.email', 'eval@harness.local'], { cwd: ws });
    execFileSync('git', ['config', 'user.name', 'Harness Eval'], { cwd: ws });
  } catch { /* ok */ }
  return ws;
}

function cleanWorkspace(ws) {
  try { fs.rmSync(ws, { recursive: true, force: true }); } catch { /* best-effort */ }
}

// ---------------------------------------------------------------------------
// Run a single A/B test case
function runCase(c, engine) {
  console.log(`\n=== ${c.id}: ${c.name} ===`);
  console.log(`Skill: ${c.skill}`);

  // Load skill content for treatment
  const skillPath = path.join(SKILLS_DIR, c.skill, 'SKILL.md');
  const skillContent = fs.readFileSync(skillPath, 'utf8');

  // Treatment prompt: skill content + original prompt
  const treatmentPrompt = `You are following the ${c.skill} discipline. Here is your skill:\n\n${skillContent}\n\n---\n\n${c.prompt}`;

  // Run baseline (no skill)
  console.log('  Running baseline...');
  const baselineWs = buildWorkspace();
  let baselineTrace = '';
  try {
    baselineTrace = runHeadless(c.prompt, baselineWs, engine);
  } catch (err) {
    console.error(`  Baseline failed: ${err.message}`);
  }
  cleanWorkspace(baselineWs);

  // Run treatment (with skill)
  console.log('  Running treatment...');
  const treatmentWs = buildWorkspace();
  let treatmentTrace = '';
  try {
    treatmentTrace = runHeadless(treatmentPrompt, treatmentWs, engine);
  } catch (err) {
    console.error(`  Treatment failed: ${err.message}`);
  }
  cleanWorkspace(treatmentWs);

  // Grade
  const baselineResults = grade(baselineTrace, c.baseline_rubric);
  const treatmentResults = grade(treatmentTrace, c.treatment_rubric);
  const verdict = computeVerdict(baselineResults, treatmentResults);

  // Report
  const bPass = baselineResults.every((r) => r.pass);
  const tPass = treatmentResults.every((r) => r.pass);
  console.log(`  Baseline: ${bPass ? 'PASS' : 'FAIL'} (${baselineResults.filter((r) => r.pass).length}/${baselineResults.length})`);
  console.log(`  Treatment: ${tPass ? 'PASS' : 'FAIL'} (${treatmentResults.filter((r) => r.pass).length}/${treatmentResults.length})`);
  console.log(`  Verdict: ${verdict}`);

  return {
    id: c.id,
    skill: c.skill,
    name: c.name,
    date: new Date().toISOString(),
    engine,
    model: process.env.AB_TEST_MODEL || 'openai/gpt-5-mini',
    baseline: { results: baselineResults.map((r) => ({ description: r.description, pass: r.pass })), pass: bPass },
    treatment: { results: treatmentResults.map((r) => ({ description: r.description, pass: r.pass })), pass: tPass },
    verdict,
    baseline_trace_preview: baselineTrace.slice(0, 500),
    treatment_trace_preview: treatmentTrace.slice(0, 500),
  };
}

// ---------------------------------------------------------------------------
// Main
function main() {
  const args = process.argv.slice(2);
  const command = args[0] || 'validate';
  const filter = args.includes('--case') ? args[args.indexOf('--case') + 1] : null;

  if (command === 'validate') {
    const cases = discoverCases();
    console.log(`Found ${cases.length} A/B test cases.`);
    let failed = 0;
    for (const c of cases) {
      const errors = validateCase(c);
      if (errors.length > 0) {
        console.error(`❌ ${c.id || c.file}: ${errors.join('; ')}`);
        failed++;
      } else {
        console.log(`✅ ${c.id}`);
      }
    }
    if (failed > 0) process.exit(1);
    console.log(`\nAll ${cases.length} cases valid.`);
    return;
  }

  if (command === 'run') {
    const cases = discoverCases().filter((c) => !filter || c.id === filter);
    if (filter && cases.length === 0) { console.error(`no case with id "${filter}"`); process.exit(1); }
    if (cases.length === 0) { console.error('no cases found'); process.exit(1); }

    // Resolve engine
    let engine = 'opencode';
    try { execFileSync('opencode', ['--version'], { stdio: 'pipe' }); } catch {
      console.error('opencode not found on PATH'); process.exit(1);
    }

    console.log(`Running ${cases.length} A/B test case(s) with engine: ${engine}`);
    console.log(`Model: ${process.env.AB_TEST_MODEL || 'openai/gpt-5-mini'}`);

    const results = [];
    let effective = 0, ineffective = 0, inconclusive = 0, harmful = 0;

    for (const c of cases) {
      const result = runCase(c, engine);
      results.push(result);
      if (result.verdict === 'EFFECTIVE') effective++;
      else if (result.verdict === 'INEFFECTIVE') ineffective++;
      else if (result.verdict === 'INCONCLUSIVE') inconclusive++;
      else if (result.verdict === 'HARMFUL') harmful++;
    }

    // Summary
    console.log('\n========================================');
    console.log('A/B Test Summary');
    console.log('========================================');
    for (const r of results) {
      const icon = r.verdict === 'EFFECTIVE' ? '✅' : r.verdict === 'HARMFUL' ? '🔴' : r.verdict === 'INCONCLUSIVE' ? '⚠️' : '❌';
      console.log(`${icon} ${r.id}: ${r.verdict}`);
    }
    console.log(`\nTotal: ${results.length} | Effective: ${effective} | Ineffective: ${ineffective} | Inconclusive: ${inconclusive} | Harmful: ${harmful}`);

    // Write results
    const date = new Date().toISOString().split('T')[0];
    const resultDir = path.join(RESULTS_DIR, `ab-test-${date}`);
    fs.mkdirSync(resultDir, { recursive: true });
    const resultFile = path.join(resultDir, 'results.json');
    fs.writeFileSync(resultFile, JSON.stringify({ date, engine, model: process.env.AB_TEST_MODEL || 'openai/gpt-5-mini', summary: { effective, ineffective, inconclusive, harmful, total: results.length }, results }, null, 2));
    console.log(`\nResults written to: ${resultFile}`);

    // Exit non-zero if any EFFECTIVE or HARMFUL (these are signal, not noise)
    if (effective > 0 || harmful > 0) process.exit(0);
    return;
  }

  console.error(`Unknown command: ${command}. Use "validate" or "run".`);
  process.exit(1);
}

main();
