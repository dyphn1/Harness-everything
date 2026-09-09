'use strict';

/**
 * Evidence archiver for behavioral runs.
 *
 * Historical result files are immutable inputs. This tool writes a sanitized,
 * replayable copy with fixture/rubric/code/CLI/model provenance and never
 * edits the original result or transcript path.
 *
 *   node behavioral-evals/evidence-tool.js archive --result <result.json> --out <dir>
 *   node behavioral-evals/evidence-tool.js triage --out behavioral-evals/evidence/2026-09-07
 */

const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { parseSimpleYaml } = require('./run');

const ROOT = path.resolve(__dirname, '..');
const CASES_DIR = path.join(__dirname, 'cases');
const RESULTS_DIR = path.join(__dirname, 'results');
const HISTORICAL_FAILED = [
  'baseline-debugging',
  'baseline-performance',
  'baseline-security-review',
  'baseline-simple-bugfix',
  'pressure-skip-docs',
  'pressure-skip-error-handling',
  'pressure-skip-verification',
  'pressure-sunk-cost-retry',
  'verify-before-done',
];
const NEVER_RUN = [
  'grill-me-adversarial',
  'tdd-test-first',
  'verify-before-claim-cites',
  'pressure-scope-bypass',
];
const TRIAGE = {
  'verify-before-done': 'rubric defect corrected: command_exit_0 alone could not prove agent execution; current status remains pending live paired rerun',
  'pressure-sunk-cost-retry': 'rubric defect corrected: i = 1 with a strict bound is a valid insertion-sort repair; current status remains pending live paired rerun',
  'pressure-scope-bypass': 'never run: runtime output and complete tracked/untracked scope checks added; current status remains pending live paired rerun',
};

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function sha256File(filePath) {
  return sha256(fs.readFileSync(filePath));
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function casePath(id) {
  const behavioral = path.join(CASES_DIR, `${id}.yaml`);
  if (fs.existsSync(behavioral)) return behavioral;
  const ab = path.join(ROOT, 'ci', 'ab-test-cases', `${id}.yaml`);
  return ab;
}

function findResult(id) {
  const files = fs.readdirSync(RESULTS_DIR)
    .filter(name => name.endsWith('.json') && name.includes(`-${id}`))
    .filter(name => !name.includes('summary'))
    .sort();
  return files.length ? path.join(RESULTS_DIR, files[files.length - 1]) : null;
}

function gitFileAtHead(relativePath) {
  try {
    return execFileSync('git', ['show', `HEAD:${relativePath}`], { cwd: ROOT, encoding: 'utf8' });
  } catch {
    return null;
  }
}

function codeHashes() {
  const current = fs.readFileSync(path.join(__dirname, 'run.js'));
  const historical = gitFileAtHead('behavioral-evals/run.js');
  return {
    historical: historical ? sha256(historical) : null,
    current: sha256(current),
  };
}

function sanitizeString(value) {
  return value
    .replace(/[A-Za-z]:[\\/][^\s"']*?(?:Temp|tmp|harness-behavioral|ab-test)[^\s"']*/gi, '<temp-path>')
    .replace(/(?:[\\/]var[\\/]folders[\\/]|[\\/]tmp[\\/]|[\\/]Users[\\/][^\\/]+[\\/]AppData[\\/]Local[\\/]Temp[\\/])[^\s"']+/gi, '<temp-path>');
}

function archiveText(value) {
  return value.split(/\r?\n/).map(line => line.replace(/[ \t]+$/g, '')).join('\n');
}

function sanitize(value, key = '') {
  if (typeof value === 'string') return sanitizeString(value);
  if (Array.isArray(value)) return value.map(item => sanitize(item, key));
  if (!value || typeof value !== 'object') return value;
  const result = {};
  for (const [name, item] of Object.entries(value)) {
    if (name === 'workspace' || name === 'transcript') {
      result[name] = null;
      continue;
    }
    result[name] = sanitize(item, name);
  }
  return result;
}

function cliVersion(command) {
  try {
    return execFileSync(command, ['--version'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim().slice(0, 200);
  } catch {
    return null;
  }
}

function rubricForCase(caseData) {
  if (Array.isArray(caseData.expectations)) return caseData.expectations;
  if (Array.isArray(caseData.success_rubric)) return caseData.success_rubric;
  if (Array.isArray(caseData.treatment_rubric)) return caseData.treatment_rubric;
  if (Array.isArray(caseData.baseline_rubric)) return caseData.baseline_rubric;
  return [];
}

function archiveResult(resultPath, outDir, caseFile = null) {
  const record = readJson(resultPath);
  const id = record.id;
  if (!id) throw new Error(`result has no id: ${resultPath}`);
  const selectedCase = caseFile || casePath(id);
  if (!fs.existsSync(selectedCase)) throw new Error(`case file not found: ${selectedCase}`);
  const caseText = fs.readFileSync(selectedCase, 'utf8');
  const caseData = parseSimpleYaml(caseText);
  const destination = path.join(outDir, id);
  fs.mkdirSync(destination, { recursive: true });
  fs.writeFileSync(path.join(destination, 'case.yaml'), archiveText(caseText));
  const historicalCase = historicalCaseText(id);
  if (historicalCase) fs.writeFileSync(path.join(destination, 'historical-case.yaml'), archiveText(historicalCase));
  fs.writeFileSync(path.join(destination, 'result.sanitized.json'), JSON.stringify(sanitize(record), null, 2) + '\n');
  const transcriptPaths = [];
  for (const arm of Object.values(record.arms || {})) if (arm && arm.transcript) transcriptPaths.push(arm.transcript);
  if (record.transcript) transcriptPaths.push(record.transcript);
  let transcriptAvailable = false;
  for (const transcriptPath of transcriptPaths) {
    if (!fs.existsSync(transcriptPath)) continue;
    const raw = fs.readFileSync(transcriptPath, 'utf8').split(/\r?\n/).filter(Boolean).map(line => sanitizeString(line)).join('\n') + '\n';
    fs.writeFileSync(path.join(destination, 'transcript.sanitized.jsonl'), raw);
    transcriptAvailable = true;
    break;
  }
  const engine = record.engine || 'claude';
  const model = record.model || 'unknown';
  const code = codeHashes();
  const historicalRubricSha = historicalRubricHash(id);
  const provenance = {
    schema: 'behavioral-evidence-v1',
    archive_generated_at: new Date().toISOString(),
    case_id: id,
    status: 'historical-rubric-unverified',
    source_result: path.relative(ROOT, resultPath).replace(/\\/g, '/'),
    source_result_sha256: sha256File(resultPath),
    historical: {
      date: record.date || null,
      outcome: record.outcome || record.verdict || null,
      engine,
      model,
      model_sha256: sha256(model),
      cli_version_sha256: record.cli_version ? sha256(record.cli_version) : null,
      case_sha256: historicalCase ? sha256(historicalCase) : null,
      rubric_sha256: historicalRubricSha,
      code_sha256: code.historical,
    },
    replay_snapshot: {
      case_sha256: sha256(caseText),
      fixture_sha256: sha256(JSON.stringify(caseData.fixture || {})),
      prompt_sha256: sha256(caseData.prompt || ''),
      rubric_sha256: sha256(JSON.stringify(rubricForCase(caseData))),
      code_sha256: code.current,
    },
    code_sha256: code.current,
    cli: { engine, version: record.cli_version || cliVersion(engine) },
    model,
    model_sha256: sha256(model),
    transcript: { available: transcriptAvailable, sanitized: true, raw_path_archived: false },
    replay: {
      command: `node behavioral-evals/run.js run --case ${id} --arm both --engine ${engine}`,
      status: 'pending-live-rerun',
    },
  };
  fs.writeFileSync(path.join(destination, 'provenance.json'), JSON.stringify(provenance, null, 2) + '\n');
  return { id, destination, provenance };
}

function historicalRubricHash(id) {
  const oldCase = historicalCaseText(id);
  if (!oldCase) return null;
  const parsed = parseSimpleYaml(oldCase);
  return sha256(JSON.stringify(rubricForCase(parsed)));
}

function historicalCaseText(id) {
  const relative = fs.existsSync(path.join(CASES_DIR, `${id}.yaml`))
    ? `behavioral-evals/cases/${id}.yaml`
    : `ci/ab-test-cases/${id}.yaml`;
  return gitFileAtHead(relative);
}

function resultSummary(id) {
  const file = findResult(id);
  if (!file) return { result_file: null, historical_outcome: 'never-run', engine: null, model: null, historical_result_sha256: null, failed_expectations: [] };
  const record = readJson(file);
  const outcome = record.outcome || record.verdict || (record.arms ? 'paired-record' : 'unknown');
  const failedExpectations = Array.isArray(record.expectations)
    ? record.expectations.filter(expectation => expectation.pass === false).map(expectation => expectation.description || 'unnamed expectation')
    : [];
  return {
    result_file: path.relative(ROOT, file).replace(/\\/g, '/'),
    historical_outcome: outcome,
    engine: record.engine || null,
    model: record.model || null,
    historical_result_sha256: sha256File(file),
    failed_expectations: failedExpectations,
  };
}

function markdownMatrix(rows) {
  const lines = [
    '# Historical behavioral-eval triage (2026-09-07)',
    '',
    'This matrix preserves prior result files. It records why each item must be replayed and does not convert a single historical run into a causal claim.',
    '',
    '| Case | Historical outcome | Failed expectation(s) | Engine/model | Classification | Result hash | Historical rubric hash | Current rubric hash |',
    '| --- | --- | --- | --- | --- | --- | --- | --- |',
  ];
  for (const row of rows) {
    const result = row.result || {};
    const failed = (result.failed_expectations || []).join('; ').replace(/\|/g, '\\|') || '—';
    lines.push(`| ${row.id} | ${result.historical_outcome} | ${failed} | ${result.engine || '—'} / ${result.model || '—'} | ${row.classification} | ${(result.historical_result_sha256 || '—').slice(0, 12)} | ${(row.historical_rubric_sha256 || '—').slice(0, 12)} | ${row.current_rubric_sha256.slice(0, 12)} |`);
  }
  lines.push('', 'Replay command for every row:', '', '```bash', 'node behavioral-evals/run.js run --case <id> --arm both --engine claude', '```', '', 'Historical transcripts were temp paths and are unavailable; sanitized result metadata and case fixtures are archived beside this matrix.');
  return lines.join('\n') + '\n';
}

function triage(outDir) {
  fs.mkdirSync(outDir, { recursive: true });
  const ids = [...HISTORICAL_FAILED, ...NEVER_RUN.filter(id => !HISTORICAL_FAILED.includes(id))];
  const rows = [];
  for (const id of ids) {
    const caseFile = casePath(id);
    if (!fs.existsSync(caseFile)) throw new Error(`case file not found: ${caseFile}`);
    const caseText = fs.readFileSync(caseFile, 'utf8');
    const caseData = parseSimpleYaml(caseText);
    const summary = resultSummary(id);
    const code = codeHashes();
    const classification = TRIAGE[id] || (summary.historical_outcome === 'never-run' ? 'never run: schedule one paired baseline/treatment replay' : 'historical single-arm failure: replay with paired controls before attributing to a skill');
    const row = {
      id,
      status: HISTORICAL_FAILED.includes(id) ? 'historical-failed' : 'never-run',
      classification,
      current_case_sha256: sha256(caseText),
      historical_rubric_sha256: historicalRubricHash(id),
      current_rubric_sha256: sha256(JSON.stringify(rubricForCase(caseData))),
      historical_code_sha256: code.historical,
      current_code_sha256: code.current,
      result: summary,
    };
    rows.push(row);
    if (summary.result_file) archiveResult(path.join(ROOT, summary.result_file), outDir, caseFile);
    else {
      const destination = path.join(outDir, id);
      fs.mkdirSync(destination, { recursive: true });
      fs.writeFileSync(path.join(destination, 'case.yaml'), archiveText(caseText));
      const historicalCase = historicalCaseText(id);
      if (historicalCase) fs.writeFileSync(path.join(destination, 'historical-case.yaml'), archiveText(historicalCase));
      fs.writeFileSync(path.join(destination, 'provenance.json'), JSON.stringify({
        schema: 'behavioral-evidence-v1', archive_generated_at: new Date().toISOString(), case_id: id, status: 'never-run',
        replay_snapshot: {
          case_sha256: sha256(caseText), fixture_sha256: sha256(JSON.stringify(caseData.fixture || {})), prompt_sha256: sha256(caseData.prompt || ''),
          rubric_sha256: sha256(JSON.stringify(rubricForCase(caseData))),
          code_sha256: code.current,
        },
        historical_case_sha256: historicalCase ? sha256(historicalCase) : null,
        historical_code_sha256: code.historical,
        current_code_sha256: code.current,
        cli: { engine: null, version: null }, cli_version_sha256: null,
        model: null, model_sha256: null, transcript: { available: false },
        replay: { command: `node behavioral-evals/run.js run --case ${id} --arm both --engine claude`, status: 'pending-live-rerun' },
      }, null, 2) + '\n');
    }
  }
  fs.writeFileSync(path.join(outDir, 'triage-matrix.json'), JSON.stringify({ schema: 'behavioral-triage-v1', generated_at: new Date().toISOString(), rows }, null, 2) + '\n');
  fs.writeFileSync(path.join(outDir, 'triage-matrix.md'), markdownMatrix(rows));
  fs.writeFileSync(path.join(outDir, 'manifest.json'), JSON.stringify({
    schema: 'behavioral-evidence-manifest-v1', generated_at: new Date().toISOString(),
    historical_failed: HISTORICAL_FAILED, never_run: NEVER_RUN, entries: rows.map(row => ({ id: row.id, status: row.status, classification: row.classification })),
  }, null, 2) + '\n');
  return rows;
}

function parseArgs(argv) {
  const result = {};
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index].startsWith('--')) result[argv[index].slice(2)] = argv[index + 1] && !argv[index + 1].startsWith('--') ? argv[++index] : true;
  }
  return result;
}

function main() {
  const [command, ...rest] = process.argv.slice(2);
  const args = parseArgs(rest);
  if (command === 'archive') {
    if (!args.result || !args.out) throw new Error('archive requires --result and --out');
    console.log(JSON.stringify(archiveResult(path.resolve(args.result), path.resolve(args.out), args.case ? path.resolve(args.case) : null), null, 2));
    return;
  }
  if (command === 'triage') {
    const rows = triage(path.resolve(args.out || path.join(__dirname, 'evidence', new Date().toISOString().slice(0, 10))));
    console.log(`Archived ${rows.length} triage entries.`);
    return;
  }
  throw new Error('Usage: evidence-tool.js archive --result <result.json> --out <dir> | triage --out <dir>');
}

if (require.main === module) {
  try { main(); }
  catch (error) { console.error(`Evidence tool failed: ${error.message}`); process.exit(1); }
}

module.exports = { archiveResult, triage, sanitize, sanitizeString, sha256 };
