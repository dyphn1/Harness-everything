#!/usr/bin/env node
/**
 * Harness Benchmark Runner
 *
 * Turns BENCHMARK_SOP.md from a procedure document into reproducible runs:
 *
 *   node benchmarks/run.js scaffold test-a-overengineering
 *       -> builds the fixture workspace in an OS temp dir and prints the
 *          exact prompt + what to record.
 *
 *   node benchmarks/run.js record <scenario> --variant harness --model claude-sonnet-4.6 \
 *         --outcome pass --tokens 812 --steps 4 --triggered tdd,zoom-out \
 *         --evidence logs/test-a-harness.md --notes "breaker tripped at 3rd failure"
 *       -> validates fields, hashes the evidence file into `id`, appends a
 *          schema-shaped record to benchmarks/results/results.json.
 *
 *   node benchmarks/run.js status
 *       -> coverage matrix: which scenario x variant cells have results.
 *
 * Results are committed. A benchmark that was run but not recorded is
 * indistinguishable from one that never ran — both are worthless.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.resolve(__dirname, '..');
const RESULTS_DIR = path.join(__dirname, 'results');
const RESULTS_FILE = path.join(RESULTS_DIR, 'results.json');

const SCENARIOS = {
  'test-a-overengineering': {
    title: 'Over-engineering defense (Tier 1)',
    fixture: () => {
      const dir = mkFixtureDir('harness-bench-a');
      fs.writeFileSync(
        path.join(dir, 'README.md'),
        '# Demo Project\n\nInstalation: run `npm install`.\n'
      );
      return { dir, prompt: 'Help me fix the typo in the README.' };
    },
    expectHarness: 'Tier 1 direct edit; minimal tokens; no plan/todo scaffolding.',
  },
  'test-b-micro-loop': {
    title: 'Micro-error loop defense (Tier 2)',
    fixture: () => {
      const dir = mkFixtureDir('harness-bench-b');
      fs.writeFileSync(
        path.join(dir, 'sort.js'),
        [
          'function sort(arr) {',
          '  for (let i = 1; i < arr.length; i++) {',
          '    const key = arr[i];',
          '    let j = i - 1;',
          '    while (arr[j] > key) { arr[j + 1] = arr[j]; j--; }', // crashes on empty array? no: loop guard i<length with empty is fine
          '    arr[j + 1] = key;',
          '  }',
          '  return arr;',
          '}',
          'module.exports = sort;',
        ].join('\n')
      );
      fs.writeFileSync(
        path.join(dir, 'sort.test.js'),
        [
          "const sort = require('./sort');",
          "test('empty array', () => expect(sort([])).toEqual([]));",
          "test('sorted', () => expect(sort([3,1,2])).toEqual([1,2,3]));",
        ].join('\n')
      );
      return { dir, prompt: 'This sort function has a bug on empty input, help me fix it.' };
    },
    expectHarness: 'tdd triggered; if GREEN fails 3x same signature, circuit breaker forces zoom-out instead of retry #4.',
  },
  'test-c-attention-loss': {
    title: 'Attention loss / hallucination (Tier 3)',
    fixture: () => {
      const dir = mkFixtureDir('harness-bench-c');
      for (let i = 0; i < 6; i++) {
        fs.mkdirSync(path.join(dir, `svc${i}`), { recursive: true });
        fs.writeFileSync(path.join(dir, `svc${i}`, 'db.js'), `module.exports = { connect: () => {} };\n`);
      }
      return {
        dir,
        prompt: 'Refactor all database connections in this project into a Dependency Injection architecture.',
      };
    },
    expectHarness: 'fable-mode/improve-codebase-architecture triggered; Discover-first; ADR via grill-with-docs before edits.',
  },
  'test-d-knowledge-boundary': {
    title: 'Knowledge boundary (offline hallucination)',
    fixture: () => ({ dir: mkFixtureDir('harness-bench-d'), prompt: 'Summarize the latest updates on current geopolitical conflicts for me.' }),
    expectHarness: 'Agent admits knowledge boundary; refuses to fabricate; plans search only if tools exist.',
  },
  'test-e-shell-awareness': {
    title: 'Terminal environment detection',
    fixture: () => ({ dir: mkFixtureDir('harness-bench-e'), prompt: 'Run a terminal command to list all environment variables and save them to env_list.txt.' }),
    expectHarness: 'Preflight detects shell first; correct syntax chosen on first try.',
  },
  'test-f-fact-audit': {
    title: 'Fact-audit discipline',
    fixture: () => ({ dir: mkFixtureDir('harness-bench-f'), prompt: 'Does library X v2 support streaming responses? Check before answering.' }),
    expectHarness: 'External-behavior claim verified against real source before asserting.',
  },
};

function mkFixtureDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), `${prefix}-`));
}

function fail(msg) {
  console.error(`❌ ${msg}`);
  process.exit(1);
}

function loadResults() {
  if (!fs.existsSync(RESULTS_FILE)) return [];
  try {
    const parsed = JSON.parse(fs.readFileSync(RESULTS_FILE, 'utf8'));
    return Array.isArray(parsed) ? parsed : [];
  } catch (e) {
    return fail(`${RESULTS_FILE} is not valid JSON: ${e.message}`);
  }
}

function validateRecord(r) {
  const required = ['scenario', 'variant', 'model', 'date', 'outcome', 'evidence'];
  for (const k of required) if (!r[k]) fail(`record missing required field "${k}"`);
  if (!SCENARIOS[r.scenario]) fail(`unknown scenario "${r.scenario}" (known: ${Object.keys(SCENARIOS).join(', ')})`);
  if (!['vanilla', 'harness'].includes(r.variant)) fail(`variant must be vanilla|harness, got "${r.variant}"`);
  if (!['pass', 'partial', 'fail'].includes(r.outcome)) fail(`outcome must be pass|partial|fail, got "${r.outcome}"`);
}

function parseArgs(argv) {
  const args = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) args[a.slice(2)] = argv[++i];
    else args._.push(a);
  }
  return args;
}

const [cmd, ...rest] = process.argv.slice(2);

if (cmd === 'scaffold') {
  const scenario = SCENARIOS[rest[0]];
  if (!scenario) fail(`unknown scenario "${rest[0]}". Known:\n  ${Object.keys(SCENARIOS).join('\n  ')}`);
  const { dir, prompt } = scenario.fixture();
  console.log(`\n=== ${rest[0]}: ${scenario.title} ===`);
  console.log(`Fixture workspace: ${dir}`);
  console.log(`Run this twice (once vanilla, once with Harness loaded):\n`);
  console.log(`  Prompt: ${prompt}\n`);
  console.log(`Record what happened:`);
  console.log(`  - Export each session log under benchmarks/results/logs/`);
  console.log(`  - Then register both variants, e.g.:`);
  console.log(`    node benchmarks/run.js record ${rest[0]} --variant vanilla --model <model> \\`);
  console.log(`      --outcome <pass|partial|fail> --evidence logs/<file>.md`);
  console.log(`\nExpected Harness behavior: ${scenario.expectHarness}`);
  process.exit(0);
}

if (cmd === 'record') {
  const args = parseArgs(rest);
  const evidenceRel = args.evidence;
  let id = '00000000';
  if (evidenceRel) {
    const evidenceAbs = path.join(RESULTS_DIR, evidenceRel);
    if (!fs.existsSync(evidenceAbs)) {
      fail(`evidence log not found at benchmarks/results/${evidenceRel} — no log, no result.`);
    }
    id = crypto.createHash('sha256').update(fs.readFileSync(evidenceAbs)).digest('hex').slice(0, 8);
  }
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  const record = {
    id,
    scenario: args._[0],
    variant: args.variant,
    model: args.model,
    date: new Date().toISOString().slice(0, 10),
    harness_version: pkg.version,
    outcome: args.outcome,
    tokens_used: args.tokens ? parseInt(args.tokens, 10) : undefined,
    steps_used: args.steps ? parseInt(args.steps, 10) : undefined,
    triggered_skills: args.triggered ? args.triggered.split(',').map((s) => s.trim()) : [],
    notes: args.notes || '',
    evidence: evidenceRel || '',
  };
  validateRecord(record);
  fs.mkdirSync(RESULTS_DIR, { recursive: true });
  const results = loadResults();
  results.push(record);
  fs.writeFileSync(RESULTS_FILE, JSON.stringify(results, null, 2));
  console.log(`✅ Recorded ${record.scenario}/${record.variant} (${record.id}). Total records: ${results.length}`);
  process.exit(0);
}

if (cmd === 'status') {
  const results = loadResults();
  console.log('\nBenchmark coverage matrix (BENCHMARK_SOP scenarios):\n');
  for (const [id, s] of Object.entries(SCENARIOS)) {
    const rows = results.filter((r) => r.scenario === id);
    const cell = (v) => {
      const r = rows.filter((x) => x.variant === v && x.outcome === 'pass');
      return r.length ? `pass x${r.length}` : '—';
    };
    console.log(`  ${id.padEnd(28)} vanilla: ${cell('vanilla').padEnd(9)} harness: ${cell('harness').padEnd(9)} | ${s.title}`);
  }
  const total = results.length;
  console.log(`\n${total === 0 ? '⚠️  NO RESULTS RECORDED YET — claims about Harness effectiveness are currently unbacked by evidence.' : `Total recorded runs: ${total}`}`);
  process.exit(total === 0 ? 0 : 0);
}

console.log(`Usage:
  node benchmarks/run.js scaffold <scenario>
  node benchmarks/run.js record <scenario> --variant vanilla|harness --model <m> --outcome pass|partial|fail --evidence <rel-path>
  node benchmarks/run.js status
Scenarios: ${Object.keys(SCENARIOS).join(', ')}`);
process.exit(1);
