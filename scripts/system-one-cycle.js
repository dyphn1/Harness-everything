#!/usr/bin/env node
'use strict';

const path = require('node:path');
const fs = require('node:fs');
const {
  REPO, STEPS, parseFlags, flag, required, markStep, stepComplete, resultSummary,
} = require('./system-one-cycle/common');
const { collect } = require('./system-one-cycle/collect');
const { labelData } = require('./system-one-cycle/label');
const { judgeRows } = require('./system-one-cycle/judge');
const { buildDataset } = require('./system-one-cycle/build');
const { trainCycle } = require('./system-one-cycle/train');
const { evaluateCycle } = require('./system-one-cycle/evaluate');
const { buildVersion, validateVersion } = require('./system-one-cycle/package');

const USAGE = `Usage:
  node scripts/system-one-cycle.js <collect|label|judge|build|train|evaluate|package> --data-dir <private cycle directory> [options]
  node scripts/system-one-cycle.js all --until <step> --data-dir <private cycle directory> [options]

Steps: ${STEPS.join(', ')}
Options: --since YYYY-MM-DD --sessions <Codex sessions dir> --version <id> --threads 4 --max-rss-mb 6144 --holdout <file> (repeatable)`;

function values(flags, name) {
  const value = flags[name];
  return value === undefined ? [] : Array.isArray(value) ? value : [value];
}

function integerFlag(flags, name, fallback) {
  const value = Number(flag(flags, name, fallback));
  if (!Number.isInteger(value) || value < 1) throw new Error(`--${name} must be a positive integer`);
  return value;
}

function numberFlag(flags, name, fallback) {
  const value = Number(flag(flags, name, fallback));
  if (!Number.isFinite(value) || value <= 0) throw new Error(`--${name} must be positive`);
  return value;
}

function outputsFor(step, dataDir, version, versionDir, result) {
  switch (step) {
    case 'collect': return ['training/observed/prompts-observed.jsonl', 'training/observed/labels-observed.jsonl'];
    case 'label': return ['training/relabel-luna/labels.jsonl', 'training/relabel-luna/labels-intent.jsonl'];
    case 'judge': return ['training/adjudication/input.jsonl', 'training/adjudication/consensus.jsonl'];
    case 'build': return ['training/v1/prompts.jsonl', 'training/v1/labels.jsonl', 'training/v1/labels-intent.jsonl',
      'training/v1-validity/prompts.jsonl', 'training/v1-validity/labels.jsonl'];
    case 'train': return result.outputs;
    case 'evaluate': return [`training/candidates/${version}/evaluation/curves.json`, `training/candidates/${version}/evaluation/trend.json`];
    case 'package': {
      const target = versionDir || path.join(dataDir, 'training', 'versions', version);
      const relative = path.relative(dataDir, target);
      return path.isAbsolute(relative) || relative.startsWith('..') ? [] : [path.join(relative, 'manifest.json')];
    }
    default: return [];
  }
}

function assertSyntheticBuildRoot(dataDir) {
  const relative = path.relative(REPO, dataDir);
  if (relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative))) {
    if (!relative.startsWith(`.s1-work${path.sep}`)) throw new Error('repository-local build data is allowed only under .s1-work synthetic fixtures');
    const prompts = path.join(dataDir, 'training', 'observed', 'prompts-observed.jsonl');
    const rows = fs.readFileSync(prompts, 'utf8').split(/\r?\n/).filter(Boolean).map(line => JSON.parse(line));
    if (!rows.length || rows.some(row => typeof row.text !== 'string' || !row.text.toLowerCase().includes('synthetic'))) {
      throw new Error('repository-local build input must contain only synthetic fixture rows');
    }
  }
}

async function runStep(step, flags, dataDir) {
  if (!STEPS.includes(step)) throw new Error(`unknown cycle step: ${step}`);
  if (['collect', 'label', 'judge'].includes(step) && stepComplete(dataDir, step)) return resultSummary(step, { skipped: true });

  let result;
  let version;
  let versionDir;
  switch (step) {
    case 'collect':
      result = collect({ dataDir, since: flag(flags, 'since'), sessionsDir: flag(flags, 'sessions') });
      break;
    case 'label':
      result = await labelData({ dataDir, batchSize: integerFlag(flags, 'batch', 20), concurrency: integerFlag(flags, 'concurrency', 4) });
      break;
    case 'judge':
      result = await judgeRows({ dataDir, batchSize: integerFlag(flags, 'batch', 20) });
      break;
    case 'build':
      assertSyntheticBuildRoot(dataDir);
      result = buildDataset({ dataDir, holdoutFiles: values(flags, 'holdout').length ? values(flags, 'holdout') : undefined });
      break;
    case 'train':
      version = validateVersion(required(flags, 'version'));
      result = await trainCycle({ dataDir, version, threads: integerFlag(flags, 'threads', 4), maxRssMb: numberFlag(flags, 'max-rss-mb', 6144) });
      break;
    case 'evaluate':
      version = validateVersion(required(flags, 'version'));
      result = evaluateCycle({ dataDir, version });
      break;
    case 'package':
      version = validateVersion(required(flags, 'version'));
      versionDir = flag(flags, 'version-dir');
      result = buildVersion({ dataDir, version, versionDir, sourceDir: path.join(dataDir, 'training', 'candidates', version) });
      result = { version, evaluation: result.evaluation };
      break;
  }
  const completed = step === 'label'
    ? Object.values(result).every(stage => stage.failed === 0)
    : step === 'judge' ? result.failed === 0 : true;
  if (completed) markStep(dataDir, step, outputsFor(step, dataDir, version, versionDir, result));
  return resultSummary(step, { ...result, completed });
}

async function main(argv) {
  const [command, ...rawFlags] = argv;
  if (command === '--help' || command === 'help' || !command) { process.stdout.write(`${USAGE}\n`); return; }
  const flags = parseFlags(rawFlags);
  if (flag(flags, 'help') === true) { process.stdout.write(`${USAGE}\n`); return; }
  const dataDir = path.resolve(required(flags, 'data-dir'));
  let results;
  if (command === 'all') {
    const until = required(flags, 'until');
    const end = STEPS.indexOf(until);
    if (end < 0) throw new Error('--until must name a cycle step');
    results = [];
    for (const step of STEPS.slice(0, end + 1)) {
      const result = await runStep(step, flags, dataDir);
      results.push(result);
      if (result.completed === false) break;
    }
  } else {
    results = [await runStep(command, flags, dataDir)];
  }
  process.stdout.write(`${JSON.stringify({ steps: results })}\n`);
}

main(process.argv.slice(2)).catch(error => {
  process.stderr.write(`system-one-cycle: ${error.message}\n`);
  process.exitCode = 1;
});
