const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const helper = require('./test-helper');
const { isHarnessRepo } = require('../scripts/lib/workspace');

console.log('\n[2m] Self-repo guard identifies the harness repo by identity, not path...');

const root = helper.root;
const bootstrap = path.join(root, 'harness-everything', 'scripts', 'bootstrap.js');
const selfHeal = path.join(root, 'harness-everything', 'scripts', 'self-heal.js');
const sandbox = helper.tempDir('.mechanism-test-self-repo-guard');

// Two fixture checkouts, both OUTSIDE the scripts' own directory tree. This is
// the npx/global-install shape: harnessSourceDir !== workspaceRoot, so a
// path-comparison guard fails open on both (issue #40).
function fixture(name, pkgName) {
  const dir = path.join(sandbox, name);
  fs.mkdirSync(path.join(dir, '.git'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name: pkgName, version: '0.0.0' }), 'utf8');
  // AGENTS.md exists but carries no Harness advisory marker — exactly the
  // state the real repo is in.
  fs.writeFileSync(path.join(dir, 'AGENTS.md'), '---\ndescription: hand written\n---\n\n# AGENTS.md\n', 'utf8');
  return dir;
}

const selfRepo = fixture('harness-checkout', 'harness-everything');
const otherRepo = fixture('unrelated-project', 'some-consumer-app');

helper.check('2m. isHarnessRepo() recognises a harness checkout', isHarnessRepo(selfRepo) === true);
helper.check('2m. isHarnessRepo() rejects an unrelated project', isHarnessRepo(otherRepo) === false);
helper.check('2m. isHarnessRepo() is false when package.json is absent', isHarnessRepo(path.join(sandbox, 'nope')) === false);

function run(script, cwd, args) {
  try {
    return execFileSync(process.execPath, [script, ...(args || [])], { cwd, encoding: 'utf8' });
  } catch (err) {
    return (err.stdout || '') + (err.stderr || '');
  }
}

const ADVICE = '[Self-Heal] Missing integration touchpoints';

const selfOut = run(bootstrap, selfRepo);
helper.check(
  '2m. bootstrap run out-of-tree against a harness checkout advises no repair',
  !selfOut.includes(ADVICE),
  selfOut
);

const otherOut = run(bootstrap, otherRepo);
helper.check(
  '2m. bootstrap still advises repair for an unrelated project (guard is not blanket suppression)',
  otherOut.includes(ADVICE),
  otherOut
);

const healOut = run(selfHeal, selfRepo, ['--check']);
helper.check(
  '2m. self-heal reports an unmarked AGENTS.md as present-without-block, not missing',
  healOut.includes('present, no Harness advisory block') && !healOut.includes('AGENTS.md) - not created'),
  healOut
);

helper.finish();
