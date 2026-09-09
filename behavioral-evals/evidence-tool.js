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
const CI_AB_CASES_DIR = path.join(ROOT, 'ci', 'ab-test-cases');
const RESULTS_DIR = path.join(__dirname, 'results');
const HISTORICAL_BASE_REF = process.env.EVIDENCE_BASE_REF || 'origin/main';
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

function isSafeCaseId(id) {
  return typeof id === 'string' && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(id);
}

function assertSafeCaseId(id) {
  if (!isSafeCaseId(id)) throw new Error(`result id is not a safe case id: ${id}`);
}

function isSafeArchiveSegment(segment) {
  return typeof segment === 'string' && /^[a-z0-9][a-z0-9._-]*$/.test(segment);
}

function findResults(id) {
  return fs.readdirSync(RESULTS_DIR)
    .filter(name => name.endsWith('.json') && !name.includes('summary'))
    .sort()
    .map(name => path.join(RESULTS_DIR, name))
    .filter(file => {
      try {
        const record = readJson(file);
        return record.id === id && !record.pair_id;
      }
      catch { return false; }
    });
}

function findResult(id) {
  const files = findResults(id);
  return files.length ? files[files.length - 1] : null;
}

function gitFileAtRef(relativePath, ref = HISTORICAL_BASE_REF) {
  try {
    return execFileSync('git', ['show', `${ref}:${relativePath}`], {
      cwd: ROOT,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
  } catch {
    return null;
  }
}

function codeHashes() {
  const current = fs.readFileSync(path.join(__dirname, 'run.js'));
  const historical = gitFileAtRef('behavioral-evals/run.js');
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

function archiveResult(resultPath, outDir, caseFile = null, archiveName = null) {
  const record = readJson(resultPath);
  const id = record.id;
  if (!id) throw new Error(`result has no id: ${resultPath}`);
  assertSafeCaseId(id);
  const selectedCase = caseFile || casePath(id);
  if (!fs.existsSync(selectedCase)) throw new Error(`case file not found: ${selectedCase}`);
  const caseText = fs.readFileSync(selectedCase, 'utf8');
  const caseData = parseSimpleYaml(caseText);
  const destinationName = archiveName || id;
  if (!isSafeArchiveSegment(destinationName)) throw new Error(`archive destination is not a safe name: ${destinationName}`);
  const archiveRoot = path.resolve(outDir);
  const destination = path.resolve(archiveRoot, destinationName);
  const relativeDestination = path.relative(archiveRoot, destination);
  if (relativeDestination.startsWith('..') || path.isAbsolute(relativeDestination)) throw new Error(`archive destination escapes output directory: ${destinationName}`);
  fs.mkdirSync(destination, { recursive: true });
  const archivedCaseText = archiveText(caseText);
  fs.writeFileSync(path.join(destination, 'case.yaml'), archivedCaseText);
  const historicalCase = historicalCaseText(id);
  const archivedHistoricalCase = historicalCase ? archiveText(historicalCase) : null;
  if (archivedHistoricalCase) fs.writeFileSync(path.join(destination, 'historical-case.yaml'), archivedHistoricalCase);
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
      case_sha256: archivedHistoricalCase ? sha256(archivedHistoricalCase) : null,
      rubric_sha256: historicalRubricSha,
      code_sha256: code.historical,
    },
    replay_snapshot: {
      case_sha256: sha256(archivedCaseText),
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
      command: replayCommand(id, engine, selectedCase),
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
  return gitFileAtRef(relative);
}

function replayCommand(id, engine, selectedCase) {
  const expectedAbCase = path.resolve(CI_AB_CASES_DIR, `${id}.yaml`);
  if (path.resolve(selectedCase) === expectedAbCase) return `node ci/ab-test-harness.js run --case ${id}`;
  return `node behavioral-evals/run.js run --case ${id} --arm both --engine ${engine || 'claude'}`;
}

function summarizeResultFile(file) {
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

function resultSummary(id) {
  const files = findResults(id);
  if (!files.length) return {
    result_file: null,
    result_files: [],
    historical_outcome: 'never-run',
    historical_outcomes: [],
    engine: null,
    model: null,
    historical_result_sha256: null,
    failed_expectations: [],
  };
  const summaries = files.map(summarizeResultFile);
  const latest = summaries[summaries.length - 1];
  return {
    ...latest,
    result_files: summaries.map(summary => summary.result_file),
    historical_outcomes: summaries.map(summary => ({
      result_file: summary.result_file,
      outcome: summary.historical_outcome,
      engine: summary.engine,
      model: summary.model,
      failed_expectations: summary.failed_expectations,
    })),
    failed_expectations: [...new Set(summaries.flatMap(summary => summary.failed_expectations))],
  };
}

function markdownMatrix(rows) {
  const lines = [
    '# Historical behavioral-eval triage (2026-09-07)',
    '',
    'This matrix preserves prior result files. It records why each item must be replayed and does not convert a single historical run into a causal claim.',
    'If live execution was unavailable for this archive, the explicit environment exemption is recorded in live-run-blocker.md.',
    '',
    '| Case | Historical result(s) | Failed expectation(s) | Engine/model | Classification | Result hash | Historical rubric hash | Current rubric hash |',
    '| --- | --- | --- | --- | --- | --- | --- | --- |',
  ];
  for (const row of rows) {
    const result = row.result || {};
    const failed = (result.failed_expectations || []).join('; ').replace(/\|/g, '\\|') || '—';
    const historical = result.historical_outcomes && result.historical_outcomes.length
      ? result.historical_outcomes.map(run => `${run.result_file}: ${run.outcome}`).join('<br>')
      : result.historical_outcome;
    lines.push(`| ${row.id} | ${historical} | ${failed} | ${result.engine || '—'} / ${result.model || '—'} | ${row.classification} | ${(result.historical_result_sha256 || '—').slice(0, 12)} | ${(row.historical_rubric_sha256 || '—').slice(0, 12)} | ${row.current_rubric_sha256.slice(0, 12)} |`);
  }
  lines.push('', 'Replay commands are stored in each entry\'s provenance.json: fixture cases use behavioral-evals/run.js; CI A/B cases use ci/ab-test-harness.js.', '', 'Historical transcripts were temp paths and are unavailable; sanitized result metadata and case fixtures are archived beside this matrix.');
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
    const archivedCaseText = archiveText(caseText);
    const summary = resultSummary(id);
    const code = codeHashes();
    const classification = TRIAGE[id] || (summary.historical_outcome === 'never-run' ? 'never run: schedule one paired baseline/treatment replay' : 'historical single-arm failure: replay with paired controls before attributing to a skill');
    const row = {
      id,
      status: HISTORICAL_FAILED.includes(id) ? 'historical-failed' : 'never-run',
      classification,
      current_case_sha256: sha256(archivedCaseText),
      historical_rubric_sha256: historicalRubricHash(id),
      current_rubric_sha256: sha256(JSON.stringify(rubricForCase(caseData))),
      historical_code_sha256: code.historical,
      current_code_sha256: code.current,
      result: summary,
    };
    rows.push(row);
    const resultFiles = findResults(id);
    if (resultFiles.length) {
      resultFiles.forEach(resultPath => {
        const resultName = resultFiles.length === 1
          ? id
          : `${id}--${path.basename(resultPath, '.json')}`;
        archiveResult(resultPath, outDir, caseFile, resultName);
      });
    } else {
      assertSafeCaseId(id);
      const destination = path.resolve(outDir, id);
      fs.mkdirSync(destination, { recursive: true });
      fs.writeFileSync(path.join(destination, 'case.yaml'), archivedCaseText);
      const historicalCase = historicalCaseText(id);
      const archivedHistoricalCase = historicalCase ? archiveText(historicalCase) : null;
      if (archivedHistoricalCase) fs.writeFileSync(path.join(destination, 'historical-case.yaml'), archivedHistoricalCase);
      fs.writeFileSync(path.join(destination, 'provenance.json'), JSON.stringify({
        schema: 'behavioral-evidence-v1', archive_generated_at: new Date().toISOString(), case_id: id, status: 'never-run',
        replay_snapshot: {
          case_sha256: sha256(archivedCaseText), fixture_sha256: sha256(JSON.stringify(caseData.fixture || {})), prompt_sha256: sha256(caseData.prompt || ''),
          rubric_sha256: sha256(JSON.stringify(rubricForCase(caseData))),
          code_sha256: code.current,
        },
        historical_case_sha256: archivedHistoricalCase ? sha256(archivedHistoricalCase) : null,
        historical_code_sha256: code.historical,
        current_code_sha256: code.current,
        cli: { engine: null, version: null }, cli_version_sha256: null,
        model: null, model_sha256: null, transcript: { available: false },
        replay: { command: replayCommand(id, 'claude', caseFile), status: 'pending-live-rerun' },
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
