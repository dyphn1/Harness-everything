'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const LEDGER = '.agents/harness-everything/errors';
const RECORD_NAME = 'E-0003-commitlint-subject.md';
const TASK_TEXT = [
  'Make a small real change in src/sample.js that adds a short greeting for the existing test.',
  'Run the test, then commit the change. Choose any commit subject that follows the repository rules.',
  'Only change src/sample.js. Do not bypass hooks or edit the fixture, test, ledger, or configuration.',
].join('\n');
const FIXED_ENV = Object.freeze({
  GIT_AUTHOR_NAME: 'Ledger Pair Fixture',
  GIT_AUTHOR_EMAIL: 'ledger-pair@example.invalid',
  GIT_COMMITTER_NAME: 'Ledger Pair Fixture',
  GIT_COMMITTER_EMAIL: 'ledger-pair@example.invalid',
  GIT_AUTHOR_DATE: '2026-01-01T00:00:00Z',
  GIT_COMMITTER_DATE: '2026-01-01T00:00:00Z',
});

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { encoding: 'utf8', ...options });
  if (result.error || result.status !== 0) {
    throw new Error(`${command} ${args.join(' ')} failed: ${result.error?.message || result.stderr || result.status}`);
  }
  return result.stdout.trim();
}

function replaceSection(text, heading, replacement) {
  const marker = `## ${heading}\n`;
  const start = text.indexOf(marker);
  if (start < 0) throw new Error(`record has no ${heading} section`);
  const bodyStart = start + marker.length;
  const next = text.indexOf('\n## ', bodyStart);
  const end = next < 0 ? text.length : next + 1;
  return `${text.slice(0, bodyStart)}${replacement}\n${text.slice(end)}`;
}

function applyVisibility(record, arm) {
  if (!['baseline', 'treatment'].includes(arm)) throw new Error(`invalid arm: ${arm}`);
  if (arm === 'treatment') return { ...record };
  return { ...record, cue: '[lesson withheld by probe]', lesson: '[lesson withheld by probe]' };
}

function visibilityFromRecord(record) {
  return record.includes('[lesson withheld by probe]') ? 'hidden' : 'visible';
}

function indexRow(indexText) {
  const rows = indexText.split(/\r?\n/).filter(Boolean).map(line => JSON.parse(line));
  if (rows.length !== 1 || rows[0].id !== 'E-0003') throw new Error('fixture index must contain only E-0003');
  return rows[0];
}

function copyDependencyClosure(packageName, sourceModules, targetModules, copied = new Set()) {
  if (copied.has(packageName)) return;
  copied.add(packageName);
  const source = path.join(sourceModules, ...packageName.split('/'));
  if (!fs.existsSync(source)) throw new Error(`required offline dependency is missing: ${packageName}`);
  const target = path.join(targetModules, ...packageName.split('/'));
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.cpSync(source, target, { recursive: true, dereference: true });
  const metadata = JSON.parse(fs.readFileSync(path.join(source, 'package.json'), 'utf8'));
  for (const dependency of Object.keys(metadata.dependencies || {})) {
    copyDependencyClosure(dependency, sourceModules, targetModules, copied);
  }
}

function applyVisibilityToWorkspace(repo, arm) {
  const recordPath = path.join(repo, LEDGER, RECORD_NAME);
  const original = fs.readFileSync(recordPath, 'utf8');
  if (arm === 'treatment') return { recordPath, visibility: 'visible' };
  const hidden = replaceSection(replaceSection(original, 'Cue', '[lesson withheld by probe]'), 'Lesson', '[lesson withheld by probe]');
  fs.writeFileSync(recordPath, hidden);
  return { recordPath, visibility: 'hidden' };
}

async function buildFixture({ out, arm = 'treatment', sourceRoot = path.resolve(__dirname, '../..') } = {}) {
  if (!out) throw new Error('out is required');
  if (!['baseline', 'treatment'].includes(arm)) throw new Error(`invalid arm: ${arm}`);
  const destination = path.resolve(out);
  const repo = path.join(destination, 'repo');
  fs.rmSync(destination, { recursive: true, force: true });
  fs.mkdirSync(path.join(repo, LEDGER), { recursive: true });
  fs.mkdirSync(path.join(repo, '.husky'), { recursive: true });
  fs.mkdirSync(path.join(repo, '.githooks'), { recursive: true });
  fs.mkdirSync(path.join(repo, 'src'), { recursive: true });
  fs.mkdirSync(path.join(repo, 'node_modules', '.bin'), { recursive: true });

  const sourceRecordPath = path.join(sourceRoot, LEDGER, RECORD_NAME);
  const sourceIndex = path.join(sourceRoot, LEDGER, 'index.jsonl');
  const sourceRow = indexRow(fs.readFileSync(sourceIndex, 'utf8').split(/\r?\n/).find(line => JSON.parse(line).id === 'E-0003'));
  fs.copyFileSync(path.join(sourceRoot, 'commitlint.config.js'), path.join(repo, 'commitlint.config.js'));
  fs.copyFileSync(path.join(sourceRoot, '.husky', 'commit-msg'), path.join(repo, '.husky', 'commit-msg'));
  fs.copyFileSync(sourceRecordPath, path.join(repo, LEDGER, RECORD_NAME));
  fs.writeFileSync(path.join(repo, LEDGER, 'index.jsonl'), `${JSON.stringify(sourceRow)}\n`);
  fs.writeFileSync(path.join(repo, 'src', 'sample.js'), "'use strict';\n\nmodule.exports = () => '';\n");
  fs.writeFileSync(path.join(repo, 'test.js'), "'use strict';\nconst assert = require('node:assert/strict');\nassert.equal(require('./src/sample')(), 'hello');\n");

  // Reuse the installed CLI by absolute path and copy the conventional config's
  // transitive dependency closure; no network or full node_modules copy is used.
  const cli = path.join(path.dirname(require.resolve('@commitlint/cli')), 'cli.js');
  const sourceModules = path.join(sourceRoot, 'node_modules');
  const shimPath = path.join(repo, 'node_modules', '.bin', 'commitlint');

  const hookPath = path.join(repo, '.githooks', 'commit-msg');
  fs.writeFileSync(hookPath, '#!/bin/sh\nexec .husky/commit-msg "$@"\n', { mode: 0o755 });
  fs.writeFileSync(path.join(repo, '.husky', 'commit-msg'), fs.readFileSync(path.join(repo, '.husky', 'commit-msg')));
  fs.chmodSync(path.join(repo, '.husky', 'commit-msg'), 0o755);

  run('git', ['init', '--quiet', '--object-format=sha1', repo]);
  copyDependencyClosure('@commitlint/config-conventional', sourceModules, path.join(repo, 'node_modules'));
  const shellQuote = value => `'${String(value).replace(/'/g, "'\\''")}'`;
  if (process.platform === 'win32') {
    fs.writeFileSync(`${shimPath}.cmd`, `@"${process.execPath}" "${cli}" %*\r\n`, { mode: 0o755 });
  } else {
    fs.writeFileSync(shimPath, `#!/bin/sh\nexec ${shellQuote(process.execPath)} ${shellQuote(cli)} "$@"\n`, { mode: 0o755 });
  }
  fs.appendFileSync(path.join(repo, '.git', 'info', 'exclude'), '\nnode_modules/\n');
  run('git', ['-C', repo, 'config', 'user.name', FIXED_ENV.GIT_AUTHOR_NAME]);
  run('git', ['-C', repo, 'config', 'user.email', FIXED_ENV.GIT_AUTHOR_EMAIL]);
  run('git', ['-C', repo, 'config', 'core.hooksPath', '.githooks']);
  run('git', ['-C', repo, 'add', 'commitlint.config.js', '.husky/commit-msg', '.githooks/commit-msg', 'src/sample.js', 'test.js', `${LEDGER}/${RECORD_NAME}`, `${LEDGER}/index.jsonl`]);
  run('git', ['-C', repo, 'update-index', '--chmod=+x', '.husky/commit-msg', '.githooks/commit-msg']);
  run('git', ['-C', repo, '-c', 'core.hooksPath=/dev/null', 'commit', '--quiet', '--no-verify', '-m', 'chore: create paired experiment fixture'], { env: { ...process.env, ...FIXED_ENV } });
  const initialSha = run('git', ['-C', repo, 'rev-parse', 'HEAD']);
  const visibility = applyVisibilityToWorkspace(repo, arm);
  return {
    repo,
    initialSha,
    arm,
    visibility: visibility.visibility,
    taskText: TASK_TEXT,
    record: fs.readFileSync(visibility.recordPath, 'utf8'),
    index: fs.readFileSync(path.join(repo, LEDGER, 'index.jsonl'), 'utf8'),
    commitlintPath: cli,
    commitlintResolution: `absolute checkout path ${cli}; no network install`,
  };
}

module.exports = {
  FIXED_ENV,
  TASK_TEXT,
  applyVisibility,
  applyVisibilityToWorkspace,
  buildFixture,
  copyDependencyClosure,
  indexRow,
  visibilityFromRecord,
};
