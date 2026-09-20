#!/usr/bin/env node
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
let failed = 0;

function check(condition, message) {
  if (condition) {
    console.log(`PASS ${message}`);
  } else {
    failed += 1;
    console.error(`FAIL ${message}`);
  }
}

const dockerVerify = fs.readFileSync(path.join(ROOT, 'docker-verify.sh'), 'utf8');
const legacyStatePath = '.claude/harness-everything/state/sessions/default';
check(/STATE_DIR=\$\(node -e[\s\S]*getSessionDir\(null, 'default'\)/.test(dockerVerify),
  '#205 docker verifier resolves one canonical session state directory');
check(!dockerVerify.includes(legacyStatePath),
  '#205 docker verifier does not seed or read the legacy repo-relative state directory');
check((dockerVerify.match(/\$STATE_DIR\//g) || []).length >= 10,
  '#205 docker verifier routes all state checks through STATE_DIR');

const architecture = fs.readFileSync(path.join(ROOT, 'docs/architecture.md'), 'utf8');
check(architecture.includes('advisory loop-awareness reminders'),
  '#206 architecture names loop-awareness as advisory');
check(!/\bloop budgets\b/.test(architecture),
  '#206 architecture does not describe retired loop budgets as enforcement');

const commitlintConfig = require(path.join(ROOT, 'commitlint.config.js'));
check(JSON.stringify(commitlintConfig.rules['subject-case']) === JSON.stringify([2, 'always', 'lower-case']),
  '#207 commitlint aligns subject-case with repository Conventional Commit history');

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-issue-207-'));
const messageFile = path.join(tempDir, 'commit-message.txt');
fs.writeFileSync(messageFile, 'fix(runtime): align post-190 advisory contracts\n', 'utf8');
const commitlintPackage = require.resolve('@commitlint/cli/package.json');
const commitlintMeta = JSON.parse(fs.readFileSync(commitlintPackage, 'utf8'));
const commitlintBin = typeof commitlintMeta.bin === 'string'
  ? commitlintMeta.bin
  : commitlintMeta.bin.commitlint;
const commitlintCli = path.resolve(path.dirname(commitlintPackage), commitlintBin);
const result = spawnSync(process.execPath, [commitlintCli, '--edit', messageFile], {
  cwd: ROOT,
  encoding: 'utf8',
});
check(result.status === 0,
  '#207 representative lowercase repository subject passes commitlint');

fs.rmSync(tempDir, { recursive: true, force: true });

console.log(`\n${failed === 0 ? 'PASS' : 'FAIL'}: issues #205-#207 regression mechanism (${failed} failure${failed === 1 ? '' : 's'})`);
process.exit(failed === 0 ? 0 : 1);
