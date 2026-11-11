'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');
const yaml = require('js-yaml');
const { test } = require('node:test');
const { classifyPaths, classifyChangeSet } = require('../scripts/ci-change-scope');

const ROOT = path.resolve(__dirname, '..');
const SCRIPT = path.join(ROOT, 'scripts', 'ci-change-scope.js');
const BASELINE_SHA = '71a8706061f2fdec657b1c2b348571aa6c40e877';
const CHANGE_SCOPE_JOB = 'ci-change-scope';
const SELF_REGRESSION_IF = "${{ !cancelled() && (needs.ci-change-scope.result != 'success' || needs.ci-change-scope.outputs.scope != 'docs-only') }}";

function nulPaths(paths) {
  return paths.length ? Buffer.from(`${paths.join('\0')}\0`) : Buffer.alloc(0);
}

function runGit(cwd, args) {
  return execFileSync('git', ['-C', cwd, ...args], {
    env: { ...process.env, GIT_CONFIG_NOSYSTEM: '1', GIT_TERMINAL_PROMPT: '0' },
  });
}

function gitText(cwd, ...args) {
  return runGit(cwd, args).toString('utf8').trim();
}

function gitDiffPaths(cwd, base, head) {
  const mergeBase = gitText(cwd, 'merge-base', base, head);
  const bytes = runGit(cwd, ['diff', '--no-renames', '--name-only', '-z', mergeBase, head]);
  return bytes.toString('utf8').slice(0, -1).split('\0');
}

function runClassifier(event, base, head, cwd = ROOT) {
  const result = spawnSync(process.execPath, [SCRIPT, event, base, head], { cwd, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stderr, '');
  return result.stdout.trim();
}

function baselineFile(file) {
  // Pin the pre-change tree; GitHub's pull_request HEAD is the candidate merge ref.
  return execFileSync('git', ['show', `${BASELINE_SHA}:${file}`], { cwd: ROOT, encoding: 'utf8' });
}

// This models the condition's truth table, not GitHub's scheduler.
function shouldRunSelfRegression(workflowCancelled, result, scope) {
  return !workflowCancelled && (result !== 'success' || scope !== 'docs-only');
}

test('each owner-approved path class and their combination classify as docs-only', () => {
  for (const file of [
    'docs/guide.md',
    'benchmarks/results/run/README.md',
    '.agents/harness-everything/errors/E-0001-example.md',
    'CHANGELOG.md',
  ]) {
    assert.equal(classifyPaths(nulPaths([file])), 'docs-only', file);
  }
  assert.equal(classifyPaths(nulPaths([
    'docs/guide.md',
    'benchmarks/results/run/README.md',
    '.agents/harness-everything/errors/E-0001-example.md',
    'CHANGELOG.md',
  ])), 'docs-only', 'all four approved classes remain eligible together');
  assert.equal(classifyPaths(nulPaths(['docs/space and\nnewline.md'])), 'docs-only', 'NUL framing preserves spaces and newlines');
});

test('empty, mixed, look-alike, malformed, and non-allowlisted paths run full regression', () => {
  for (const paths of [
    [],
    ['src/change.js'],
    ['docs/guide.md', 'src/change.js'],
    ['docs-extra/guide.md'],
    ['docs/../hooks/change.js'],
    ['CHANGELOG.md.js'],
    ['docs\\guide.md'],
    ['.github/workflows/ci.yml'],
    ['scripts/ci-change-scope.js'],
    ['docs//guide.md'],
    ['/docs/guide.md'],
    ['docs/./guide.md'],
  ]) {
    assert.equal(classifyPaths(nulPaths(paths)), 'full', JSON.stringify(paths));
  }

  for (const malformed of [
    Buffer.from('docs/guide.md'),
    Buffer.from('docs/guide.md\0\0'),
    Buffer.from('docs/../hooks/change.js\0'),
    Buffer.from([0x64, 0x6f, 0x63, 0x73, 0x2f, 0xff, 0x00]),
  ]) {
    assert.equal(classifyPaths(malformed), 'full', 'uncertain path records fail toward regression');
  }
});

test('non-PR events and Git failures, including partial diff output, classify as full', () => {
  let gitCalls = 0;
  const unusedGit = () => { gitCalls += 1; throw new Error('must not inspect a non-PR diff'); };
  assert.equal(classifyChangeSet('push', 'a'.repeat(40), 'b'.repeat(40), { runGit: unusedGit }), 'full');
  assert.equal(classifyChangeSet('workflow_dispatch', 'a'.repeat(40), 'b'.repeat(40), { runGit: unusedGit }), 'full');
  assert.equal(gitCalls, 0);

  const fakeGit = bytes => (_args, _options) => {
    if (_args[0] === 'merge-base') return Buffer.from(`${'a'.repeat(40)}\n`);
    return bytes;
  };
  assert.equal(classifyChangeSet('pull_request', 'b'.repeat(40), 'c'.repeat(40), {
    runGit: fakeGit(nulPaths(['docs/guide.md'])),
  }), 'docs-only');

  const partialError = new Error('git diff failed after writing bytes');
  partialError.stdout = nulPaths(['docs/guide.md']);
  const partialGit = (_args) => {
    if (_args[0] === 'merge-base') return Buffer.from(`${'a'.repeat(40)}\n`);
    throw partialError;
  };
  assert.equal(classifyChangeSet('pull_request', 'b'.repeat(40), 'c'.repeat(40), { runGit: partialGit }), 'full');
  assert.equal(classifyChangeSet('pull_request', '', 'c'.repeat(40), { runGit: unusedGit }), 'full');
  assert.equal(classifyChangeSet('pull_request', 'b'.repeat(40), 'c'.repeat(40), {
    runGit: fakeGit(Buffer.from('docs/guide.md')),
  }), 'full', 'a diff without its final NUL is malformed');
});

test('real Git merge-base diff includes earlier code, deletions, both rename endpoints, and unusual filenames', () => {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'ci-change-scope-'));
  const write = (relative, content) => {
    const file = path.join(repo, relative);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, content);
  };
  const commit = message => {
    runGit(repo, ['add', '--all']);
    runGit(repo, ['commit', '-m', message]);
    return gitText(repo, 'rev-parse', 'HEAD');
  };

  try {
    runGit(repo, ['init', '-q']);
    runGit(repo, ['config', 'user.name', 'CI Scope Test']);
    runGit(repo, ['config', 'user.email', 'ci-scope@example.invalid']);
    write('docs/delete.md', 'remove me');
    write('docs/move-to-code.md', 'move');
    write('src/move-to-docs.js', 'move');
    write('src/stable.js', 'stable');
    const base = commit('base');

    fs.rmSync(path.join(repo, 'docs/delete.md'));
    const deleted = commit('delete approved documentation');
    assert.deepEqual(gitDiffPaths(repo, base, deleted), ['docs/delete.md']);
    assert.equal(runClassifier('pull_request', base, deleted, repo), 'docs-only');

    write('src/earlier-code.js', 'code');
    commit('add code first');
    write('docs/final-doc.md', 'docs after code');
    const docsAfterCode = commit('add docs later');
    assert.ok(gitDiffPaths(repo, base, docsAfterCode).includes('src/earlier-code.js'));
    assert.equal(runClassifier('pull_request', base, docsAfterCode, repo), 'full', 'base…head includes code from an earlier commit');

    runGit(repo, ['mv', 'docs/move-to-code.md', 'src/moved-from-docs.md']);
    runGit(repo, ['mv', 'src/move-to-docs.js', 'docs/moved-from-code.js']);
    const renamed = commit('rename across the allowlist boundary both ways');
    const renamePaths = gitDiffPaths(repo, base, renamed);
    for (const file of [
      'docs/move-to-code.md', 'src/moved-from-docs.md',
      'src/move-to-docs.js', 'docs/moved-from-code.js',
    ]) assert.ok(renamePaths.includes(file), `--no-renames reports ${file}`);
    assert.equal(runClassifier('pull_request', base, renamed, repo), 'full');

    const unusual = process.platform === 'win32' ? 'docs/space and name.md' : 'docs/space and\nnewline.md';
    write(unusual, 'valid Git filename');
    const unusualHead = commit('add unusual documentation filename');
    assert.deepEqual(gitDiffPaths(repo, renamed, unusualHead), [unusual]);
    assert.equal(runClassifier('pull_request', renamed, unusualHead, repo), 'docs-only');
    assert.equal(runClassifier('push', renamed, unusualHead, repo), 'full');
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test('the workflow gates only self-regression and fails open on every uncertain dependency/output state', () => {
  const workflowFile = '.github/workflows/ci.yml';
  const workflowText = fs.readFileSync(path.join(ROOT, workflowFile), 'utf8');
  const beforeText = baselineFile(workflowFile);
  const workflow = yaml.load(workflowText);
  const before = yaml.load(beforeText);

  assert.equal(workflow.name, before.name);
  assert.deepEqual(workflow.on, before.on, 'push, pull_request, and reusable-workflow triggers stay unchanged');
  assert.deepEqual(workflow.permissions, before.permissions);
  assert.deepEqual(workflow.concurrency, before.concurrency);
  assert.deepEqual(
    Object.keys(workflow.jobs).sort(),
    [...Object.keys(before.jobs), CHANGE_SCOPE_JOB].sort(),
    'only the classifier job is added; existing job ids remain present',
  );
  for (const [jobId, original] of Object.entries(before.jobs)) {
    const current = workflow.jobs[jobId];
    if (jobId === 'self-regression') {
      const { if: _condition, needs: _needs, ...unchanged } = current;
      assert.deepEqual(unchanged, original, 'self-regression name, matrix, steps, and runtime stay unchanged');
    } else {
      assert.deepEqual(current, original, `${jobId} stays unchanged`);
    }
  }

  const classifier = workflow.jobs[CHANGE_SCOPE_JOB];
  assert.equal(classifier.if, "${{ github.event_name == 'pull_request' }}");
  assert.deepEqual(classifier.outputs, { scope: '${{ steps.scope.outputs.scope }}' });
  const checkout = classifier.steps.find(step => step.uses === 'actions/checkout@v7');
  assert.equal(checkout.with['fetch-depth'], 0, 'the classifier has complete Git history');
  const node = classifier.steps.find(step => step.uses === 'actions/setup-node@v7');
  assert.equal(node.with['node-version'], 24);
  const scope = classifier.steps.find(step => step.id === 'scope');
  assert.equal(scope.env.GITHUB_EVENT_NAME, undefined, 'the runner-provided GITHUB_EVENT_NAME is not overwritten');
  assert.equal(scope.env.PR_BASE_SHA, '${{ github.event.pull_request.base.sha }}');
  assert.equal(scope.env.PR_HEAD_SHA, '${{ github.event.pull_request.head.sha }}');
  assert.match(scope.run, /node scripts\/ci-change-scope\.js "\$GITHUB_EVENT_NAME" "\$PR_BASE_SHA" "\$PR_HEAD_SHA"/);
  assert.match(scope.run, /printf 'scope=%s\\n' "\$scope" >> "\$GITHUB_OUTPUT"/);
  const selfRegressionIf = workflow.jobs['self-regression'].if;
  assert.ok(selfRegressionIf.includes('!cancelled()'), 'workflow cancellation must disable self-regression');
  assert.ok(!selfRegressionIf.includes('always()'), 'always() keeps self-regression eligible during cancellation');
  assert.equal(selfRegressionIf, SELF_REGRESSION_IF, 'the full fallback predicate stays exact');
  assert.deepEqual(workflow.jobs['self-regression'].needs, [CHANGE_SCOPE_JOB]);

  const gateCases = [
    ['successful docs-only classifier', false, 'success', 'docs-only', false],
    ['successful full classifier', false, 'success', 'full', true],
    ['partial producer output then failure', false, 'failure', 'docs-only', true],
    ['missing job output', false, 'success', undefined, true],
    ['malformed job output', false, 'success', 'docs_only', true],
    ['failed classifier dependency', false, 'failure', undefined, true],
    ['failed classifier with full output', false, 'failure', 'full', true],
    ['skipped classifier dependency', false, 'skipped', undefined, true],
    ['cancelled classifier dependency while workflow continues', false, 'cancelled', 'docs-only', true],
    ['cancelled workflow with successful docs-only classifier', true, 'success', 'docs-only', false],
    ['cancelled workflow with failed classifier', true, 'failure', 'full', false],
  ];
  for (const [label, workflowCancelled, result, output, expected] of gateCases) {
    assert.equal(shouldRunSelfRegression(workflowCancelled, result, output), expected, label);
  }

  const releaseFile = '.github/workflows/release.yml';
  const governanceFile = '.github/workflows/doc-governance.yml';
  assert.equal(fs.readFileSync(path.join(ROOT, releaseFile), 'utf8'), baselineFile(releaseFile));
  assert.equal(fs.readFileSync(path.join(ROOT, governanceFile), 'utf8'), baselineFile(governanceFile));
  const release = yaml.load(fs.readFileSync(path.join(ROOT, releaseFile), 'utf8'));
  assert.deepEqual(release.on.push.branches, ['main']);
  assert.ok(Object.hasOwn(release.on, 'workflow_dispatch'));
  assert.equal(release.jobs.gate.uses, './.github/workflows/ci.yml');
  assert.equal(classifyChangeSet('push', 'a'.repeat(40), 'b'.repeat(40), { runGit: unusedGitForWorkflow }), 'full');
});

function unusedGitForWorkflow() {
  throw new Error('the release caller is a push/dispatch, so no PR diff may authorize a skip');
}
