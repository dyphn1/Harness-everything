#!/usr/bin/env node
/**
 * A/B Test Harness — Method Effectiveness Evaluation
 *
 * Proves whether skills actually change agent behavior by comparing
 * baseline (no skill) vs treatment (skill loaded) outputs.
 *
 *   node ci/ab-test-harness.js validate          # structural check (free)
 *   node ci/ab-test-harness.js run               # run all cases (costs tokens)
 *   node ci/ab-test-harness.js run --case <id>   # run one case
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
const crypto = require('crypto');
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
  const outputFd = fs.openSync(outPath, 'w');
  try {
    execFileSync('opencode', ['run', '-m', model, prompt, '--format', 'json', '--auto', '--dir', cwd],
      { cwd, stdio: ['ignore', outputFd, 'inherit'], timeout: 10 * 60 * 1000, windowsHide: true });
  } catch (err) {
    // Timeout or crash — return empty trace
    fs.rmSync(outPath, { force: true });
    return '';
  } finally {
    fs.closeSync(outputFd);
  }
  try {
    return extractTrace(outPath);
  } finally {
    fs.rmSync(outPath, { force: true });
  }
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
function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function countToolCalls(trace) {
  return (trace.match(/^\[[^\]]+\]/gm) || []).length;
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

// Every run is a paired experiment. The order is randomized to avoid making
// the second arm systematically benefit from cache/session warm-up.
function runCase(c, engine) {
  console.log(`\n=== ${c.id}: ${c.name} ===`);
  console.log(`Skill: ${c.skill}`);
  const skillContent = fs.readFileSync(path.join(SKILLS_DIR, c.skill, 'SKILL.md'), 'utf8');
  const treatmentPrompt = `You are following the ${c.skill} discipline. Here is your skill:\n\n${skillContent}\n\n---\n\n${c.prompt}`;
  const pairId = `${c.id}-${Date.now()}-${crypto.randomBytes(3).toString('hex')}`;
  const order = crypto.randomInt(0, 2) === 0 ? ['baseline', 'treatment'] : ['treatment', 'baseline'];
  const arms = {};
  for (const arm of order) {
    const ws = buildWorkspace();
    let trace = '';
    try {
      trace = runHeadless(arm === 'treatment' ? treatmentPrompt : c.prompt, ws, engine);
    } catch (err) {
      console.error(`  ${arm} failed: ${err.message}`);
    }
    const results = grade(trace, arm === 'treatment' ? c.treatment_rubric : c.baseline_rubric);
    const pass = results.every(r => r.pass);
    arms[arm] = {
      pass,
      loaded_skills: arm === 'treatment' ? [c.skill] : [],
      attribution_required: arm === 'treatment',
      results: results.map(r => ({ description: r.description, pass: r.pass })),
      trace_preview: trace.slice(0, 500),
      tool_call_count: countToolCalls(trace),
    };
    cleanWorkspace(ws);
  }
  if (!arms.treatment.loaded_skills.length) throw new Error('treatment attribution is empty');
  const verdict = computeVerdict(
    arms.baseline.results.map(r => ({ pass: r.pass })),
    arms.treatment.results.map(r => ({ pass: r.pass }))
  );
  console.log(`  Order: ${order.join(' -> ')}`);
  console.log(`  Baseline: ${arms.baseline.pass ? 'PASS' : 'FAIL'}`);
  console.log(`  Treatment: ${arms.treatment.pass ? 'PASS' : 'FAIL'} [${c.skill}]`);
  console.log(`  Verdict: ${verdict}`);
  return {
    id: c.id,
    skill: c.skill,
    name: c.name,
    date: new Date().toISOString(),
    engine,
    model: process.env.AB_TEST_MODEL || 'openai/gpt-5-mini',
    protocol: 'paired-randomized-v1',
    pair_id: pairId,
    arm_order: order,
    fixture_defined: false,
    fixture_sha256: sha256('no fixture declared'),
    prompt_sha256: sha256(c.prompt),
    sample_unit: 'one paired prompt-only case',
    cost: null,
    baseline: arms.baseline,
    treatment: arms.treatment,
    tool_call_delta: arms.treatment.tool_call_count - arms.baseline.tool_call_count,
    verdict,
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
    const completed = results.length;
    const toolCallDeltas = results.map(r => r.tool_call_delta);
    const summary = {
      effective,
      ineffective,
      inconclusive,
      harmful,
      requested_sample_size: cases.length,
      completed_pairs: completed,
      boundary_compliance: completed === cases.length ? 'complete' : 'incomplete',
      cost: null,
      tool_call_delta: toolCallDeltas,
      effective_rate_ci95: wilsonInterval(effective, completed),
      interpretation: 'Prompt-only cases have no workspace boundary; use behavioral-evals/run.js --arm both for fixture-bound evidence.',
    };
    fs.writeFileSync(resultFile, JSON.stringify({ date, engine, model: process.env.AB_TEST_MODEL || 'openai/gpt-5-mini', protocol: 'paired-randomized-v1', summary, results }, null, 2));
    console.log(`\nResults written to: ${resultFile}`);

    // Exit non-zero if any EFFECTIVE or HARMFUL (these are signal, not noise)
    if (effective > 0 || harmful > 0) process.exit(0);
    return;
  }

  console.error(`Unknown command: ${command}. Use "validate" or "run".`);
  process.exit(1);
}

main();
