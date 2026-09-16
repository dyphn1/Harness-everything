import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { analyzeCommits } from '@semantic-release/commit-analyzer';

const ROOT = path.resolve(import.meta.dirname, '..');
const config = JSON.parse(fs.readFileSync(path.join(ROOT, '.releaserc.json'), 'utf8'));
const analyzer = config.plugins.find(plugin => Array.isArray(plugin) && plugin[0] === '@semantic-release/commit-analyzer');
assert.ok(analyzer, 'commit analyzer configuration missing');

function git(root, args) {
  return execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

function history(messages) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-semantic-history-'));
  try {
    git(root, ['init']);
    git(root, ['config', 'user.email', 'release-test@example.com']);
    git(root, ['config', 'user.name', 'Release Test']);
    git(root, ['commit', '--allow-empty', '-m', 'chore: baseline']);
    git(root, ['tag', 'v1.0.0']);

    for (const message of messages) {
      git(root, ['commit', '--allow-empty', '-m', message]);
    }

    const log = execFileSync(
      'git',
      ['log', '--reverse', '--format=%B%x00', 'v1.0.0..HEAD'],
      { cwd: root, encoding: 'utf8' }
    );
    return log.split('\0').map(message => message.trim()).filter(Boolean);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

async function releaseType(messages) {
  const commits = history(messages).map((message, index) => ({
    hash: `fixture-${index}`,
    message
  }));
  return analyzeCommits(analyzer[1], {
    commits,
    logger: { log() {} }
  });
}

assert.equal(await releaseType(['fix(cache): repair invalidation']), 'patch', 'fix-only history must release patch');
assert.equal(
  await releaseType(['fix(cache): repair invalidation', 'feat(router): add route']),
  'minor',
  'feat must dominate patch commits'
);
assert.equal(
  await releaseType(['fix(cache): repair invalidation', 'feat(api)!: replace runtime contract']),
  'major',
  'breaking ! must dominate lower release types'
);
assert.equal(
  await releaseType(['feat(api): replace shape\n\nBREAKING CHANGE: remove legacy shape']),
  'major',
  'BREAKING CHANGE footer must produce major'
);
assert.equal(
  (await releaseType(['docs: update guide', 'test: cover retry', 'ci: tune matrix'])) ?? null,
  null,
  'docs/test/ci-only history must not release'
);
assert.equal(
  (await releaseType(['chore(release): 1.0.1 [skip ci]'])) ?? null,
  null,
  'generated release commit must not recurse into another release'
);

console.log('Semantic-release analyzer verified against real temporary Git histories: patch, minor, major, no-release, and recursion guard.');
