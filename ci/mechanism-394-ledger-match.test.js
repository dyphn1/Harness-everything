#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const { spawn, spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

let matcher;
try {
  matcher = require('../hooks/scripts/lib/ledger-match.js');
} catch (error) {
  if (error.code !== 'MODULE_NOT_FOUND') throw error;
}
const packagedMatcher = require('../plugins/harness-everything/hooks/scripts/lib/ledger-match.js');

const ROOT = path.resolve(__dirname, '..');
const ERRORS_SYNC = path.join(ROOT, 'scripts', 'errors-sync.js');
const LEDGER_DIR = path.join(ROOT, '.agents', 'harness-everything', 'errors');
const E3_FILE = fs.readdirSync(LEDGER_DIR).find(file => /^E-0003-[a-z0-9-]+\.md$/.test(file));
const E3_TEXT = fs.readFileSync(path.join(LEDGER_DIR, E3_FILE), 'utf8');
const COMMITLINT_OUTPUT = fs.readFileSync(path.join(__dirname, 'fixtures/394-ledger-match/commitlint-subject-case.txt'), 'utf8');
const COMMITLINT_EMPTY_SUBJECT_OUTPUT = fs.readFileSync(
  path.join(__dirname, 'fixtures/394-ledger-match/commitlint-empty-subject.txt'), 'utf8');
const QUOTED_RECORD = fs.readFileSync(path.join(__dirname, 'fixtures/394-ledger-match/quoted-match-record.md'), 'utf8');
const PROVISIONAL_FIXTURE = JSON.parse(fs.readFileSync(
  path.join(__dirname, 'fixtures/394-ledger-match/provisional-candidates.json'), 'utf8'));
const TMP = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), '394 ledger match ')));
let serial = 0;
const GENERATED_E3_ROOT = path.join(TMP, 'generated-e3');
write(path.join(GENERATED_E3_ROOT, '.agents', 'harness-everything', 'errors', E3_FILE), E3_TEXT);
const E3_GENERATION = spawnSync(process.execPath, [ERRORS_SYNC, '--root', GENERATED_E3_ROOT], {
  cwd: ROOT,
  env: Object.fromEntries(Object.entries(process.env).filter(([key]) => key !== 'HARNESS_SYSTEM_ONE_MODE')),
  encoding: 'utf8'
});
if (E3_GENERATION.status !== 0) throw new Error(E3_GENERATION.stderr);
const REAL_E3 = JSON.parse(fs.readFileSync(
  path.join(GENERATED_E3_ROOT, '.agents', 'harness-everything', 'errors', 'index.jsonl'), 'utf8').trim());

test.after(() => fs.rmSync(TMP, { recursive: true, force: true }));

function select(input) {
  assert.equal(typeof matcher?.matchLedgerLessons, 'function',
    'the shared matchLedgerLessons(input) acceptance API exists');
  return matcher.matchLedgerLessons(input);
}

function workspace(name) {
  const root = fs.realpathSync.native(fs.mkdtempSync(path.join(TMP, `${name} `)));
  return root;
}

function stateDir(name = 'state') {
  return path.join(TMP, `${name}-${++serial}`);
}

function write(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, value);
}

function repoWorkspace(name, { indexText, recordText = E3_TEXT, recordFile = REAL_E3.file, missingRecord = false } = {}) {
  const root = workspace(name);
  const ledger = path.join(root, '.agents', 'harness-everything', 'errors');
  const row = { ...REAL_E3, file: recordFile };
  if (!missingRecord) write(path.join(ledger, recordFile.split('/').at(-1)), recordText);
  write(path.join(ledger, 'index.jsonl'), indexText ?? `${JSON.stringify(row)}\n`);
  return root;
}

function localSource(candidates) {
  return (identity, budget) => {
    assert.equal(identity, 'workspace:fixture');
    assert.equal(typeof budget.maxCandidates, 'number');
    assert.equal(typeof budget.maxBytes, 'number');
    return candidates;
  };
}

function input(overrides = {}) {
  return {
    workspaceRoot: GENERATED_E3_ROOT,
    workspaceIdentity: 'workspace:fixture',
    sessionIdentity: 'session:one',
    stateDir: stateDir('session-state'),
    event: {
      phase: 'action',
      tool: 'shell',
      command: 'git commit',
      outcome: { failed: 'unknown' }
    },
    ...overrides
  };
}

function fixtureCandidate(overrides = {}) {
  return {
    ...PROVISIONAL_FIXTURE[0],
    ...overrides
  };
}

test('exports the conservative git commit executable/subcommand normalizer', () => {
  assert.equal(typeof matcher?.normalizeGitCommitCommand, 'function',
    'the shared normalizeGitCommitCommand(command) export exists');
  assert.deepEqual(matcher.normalizeGitCommitCommand('git commit'), {
    tool: 'shell', executable: 'git', subcommand: 'commit'
  });
  assert.deepEqual(matcher.normalizeGitCommitCommand('git commit -m "message"'), {
    tool: 'shell', executable: 'git', subcommand: 'commit'
  });
  assert.deepEqual(matcher.normalizeGitCommitCommand('/usr/bin/git commit --amend'), {
    tool: 'shell', executable: 'git', subcommand: 'commit'
  });
  for (const command of [
    'echo git commit',
    'echo "git commit"',
    "printf '%s' 'git commit'",
    'git status',
    'git merge origin/main',
    'sudo git commit',
    '"git commit"'
  ]) assert.equal(matcher.normalizeGitCommitCommand(command), null, command);
  for (const command of [
    'git commit && echo done',
    'echo before; git -C x commit --amend',
    'git -c user.name=Harness commit || echo rejected',
    "git commit -m 'message; with separator'"
  ]) assert.deepEqual(matcher.normalizeGitCommitCommand(command), {
    tool: 'shell', executable: 'git', subcommand: 'commit'
  }, command);
  for (const command of [
    'git -C x commit',
    'git -c user.name=Harness commit',
    'git -c core.pager= commit',
    'git --git-dir=/repo/.git commit',
    'git --work-tree=/repo commit',
    'git --no-pager commit',
    'git -P commit',
    'git -C x -c user.name=Harness --git-dir=/repo/.git --work-tree=/repo --no-pager -P commit'
  ]) assert.deepEqual(matcher.normalizeGitCommitCommand(command), {
    tool: 'shell', executable: 'git', subcommand: 'commit'
  }, command);
  for (const command of [
    'git -C',
    'git -C x',
    'git -c',
    'git -c user.name commit',
    'git -c =x commit',
    'git -c = commit',
    'git -c =Harness commit',
    'git --git-dir= commit',
    'git --work-tree= commit',
    'git --git-dir /repo/.git commit',
    'git --other=option commit',
    'git -C x status'
  ]) assert.equal(matcher.normalizeGitCommitCommand(command), null, command);
});

test('source and packaged matchers bound simple command sequences and reject unsupported syntax', () => {
  const expected = { tool: 'shell', executable: 'git', subcommand: 'commit' };
  const supported = [
    'git commit; echo "$?"',
    'echo before && git -C x commit --amend',
    'git commit || echo failed',
    "git commit -m 'message; with separator'"
  ];
  const unsupported = [
    "echo 'git commit; echo done'",
    '(git commit)',
    'git commit <<EOF\nmessage\nEOF',
    'git commit;',
    '; git commit',
    'git commit;; echo done',
    Array.from({ length: 17 }, (_, index) => index === 8 ? 'git commit' : 'echo x').join(';'),
    `${'echo x; '.repeat(1400)}git commit`
  ];
  for (const implementation of [matcher, packagedMatcher]) {
    for (const command of supported) assert.deepEqual(implementation.normalizeGitCommitCommand(command), expected, command);
    for (const command of unsupported) assert.equal(implementation.normalizeGitCommitCommand(command), null, command);
  }
});

test('source and packaged matchers recognize pipeline members and literal redirects', () => {
  const expected = { tool: 'shell', executable: 'git', subcommand: 'commit' };
  const supported = [
    'git commit -m "A"',
    'cd /x && git commit -m "A"',
    'git commit --dry-run -m "A"',
    'git commit -m "A" 2>&1',
    'git commit -m "A" 2>&1 | tail -3',
    'git commit -m "A" | cat',
    'echo before | git commit -m "A"',
    'git 2>&1 commit -m "A"',
    '2>errors.log git commit -m "A"',
    'git commit 2>&1 -m "A"',
    'git commit -m "A" >out.log',
    'git commit -m "A" >out#log',
    'git commit -m "A" >> "out file.log"',
    'git commit -m "A" < input.txt',
    'git commit -m "A" &>combined.log',
    'git commit -m "A" 2> errors.log',
    'git commit -m "A | B"',
    'git commit -m A \\| cat',
    'git commit -m "A" # | cat is comment text'
  ];
  const unsupported = [
    "echo 'git commit | cat'",
    'echo before > git commit',
    'echo before # git commit | cat',
    'env git commit',
    'git commit |',
    '| git commit',
    'git commit | | cat',
    'git commit |& cat',
    'git commit &',
    'git commit &>>out.log',
    'git commit 2>&-',
    'git commit 2>&1-',
    'git commit 2>&1suffix',
    '2 >errors.log git commit',
    "'2'>errors.log git commit",
    'name2>errors.log git commit',
    'git commit >',
    'git commit > # missing redirect target',
    'git commit >#missing-target',
    'git commit >""',
    'git commit >"$OUT"',
    'git commit >*.log',
    'git commit <<EOF\nmessage\nEOF',
    'git commit <<< message',
    'git commit > >(tee out.log)',
    'cat <(git commit)',
    '(git commit)',
    'echo "$(git commit)"',
    'echo "`git commit`"'
  ];
  for (const implementation of [matcher, packagedMatcher]) {
    for (const command of supported) {
      assert.deepEqual(implementation.normalizeGitCommitCommand(command), expected, command);
      const result = implementation.matchLedgerLessons(input({
        event: { phase: 'action', tool: 'shell', command, outcome: { failed: 'unknown' } }
      }));
      assert.deepEqual(result?.ids, ['E-0003'], command);
    }
    for (const command of unsupported) {
      assert.equal(implementation.normalizeGitCommitCommand(command), null, command);
      assert.equal(implementation.matchLedgerLessons(input({
        event: { phase: 'action', tool: 'shell', command, outcome: { failed: 'unknown' } }
      })), null, command);
    }
  }
});

test('source and packaged matchers accept an empty Git config value', () => {
  const expected = { tool: 'shell', executable: 'git', subcommand: 'commit' };
  for (const implementation of [matcher, packagedMatcher]) {
    assert.deepEqual(implementation.normalizeGitCommitCommand('git -c core.pager= commit'), expected);
    assert.equal(implementation.normalizeGitCommitCommand('git -c =x commit'), null);
    assert.equal(implementation.normalizeGitCommitCommand('git -c = commit'), null);
    assert.equal(implementation.normalizeGitCommitCommand('git -c user.name commit'), null);
  }
});

test('a direct git commit selects the real E-0003 record at action', () => {
  const result = select(input({ event: { phase: 'action', tool: 'shell', command: 'git commit', outcome: { failed: 'unknown' } } }));
  assert.deepEqual(result.ids, ['E-0003']);
  assert.ok(result.text.includes('A commit is rejected locally by commitlint'));
  assert.ok(result.text.includes('Check the subject line against both rules'));
  assert.ok(result.text.endsWith('Consider a fresh look, and zoom out if warranted.'));
  assert.ok(!result.text.includes('commitlint.config.js'));
  assert.ok(!result.text.includes('docs(errors): Record PR stuff'));

  const withArgs = select(input({
    stateDir: stateDir('action-args'),
    event: { phase: 'action', tool: 'shell', command: 'git commit --amend', outcome: { failed: 'unknown' } }
  }));
  assert.deepEqual(withArgs.ids, ['E-0003']);
});

test('simple command segments select commit lessons without matching quoted text or wrappers', () => {
  for (const command of [
    'git commit -m "docs: probe"; echo "$?"',
    'echo before && git -C x commit --amend',
    'git status || git commit'
  ]) {
    const result = select(input({
      event: { phase: 'action', tool: 'shell', command, outcome: { failed: 'unknown' } }
    }));
    assert.deepEqual(result?.ids, ['E-0003'], command);
  }
  for (const command of [
    "echo 'git commit; echo done'",
    '(git commit)',
    'git commit <<EOF\nmessage\nEOF',
    'env git commit'
  ]) {
    assert.equal(select(input({
      event: { phase: 'action', tool: 'shell', command, outcome: { failed: 'unknown' } }
    })), null, command);
  }
});

test('a failed commit with captured commitlint output selects again at failure', () => {
  const base = input();
  const action = select(base);
  const failure = select({
    ...base,
    event: { phase: 'failure', tool: 'shell', command: 'git commit -m "Bad Subject"', outcome: { failed: true, output: COMMITLINT_OUTPUT } }
  });
  assert.deepEqual(action.ids, ['E-0003']);
  assert.deepEqual(failure.ids, ['E-0003']);
  const emptySubject = select(input({
    event: { phase: 'failure', tool: 'shell', command: 'git commit', outcome: { failed: true, output: COMMITLINT_EMPTY_SUBJECT_OUTPUT } }
  }));
  assert.deepEqual(emptySubject.ids, ['E-0003']);
});

test('failure lessons require a known outcome and an exact diagnostic', () => {
  const direct = 'git commit -m "Bad Subject"';
  const compound = `${direct}; echo "$?"`;
  const cases = [
    { command: compound, failed: false, output: COMMITLINT_OUTPUT, expected: ['E-0003'] },
    { command: compound, failed: true, output: COMMITLINT_OUTPUT, expected: ['E-0003'] },
    { command: compound, failed: 'unknown', output: COMMITLINT_OUTPUT, expected: null },
    { command: direct, failed: false, output: COMMITLINT_OUTPUT, expected: null },
    { command: compound, failed: false, output: 'fatal: unrelated output', expected: null },
    { command: compound, failed: true, output: 'fatal: unrelated output', expected: null },
  ];
  for (const implementation of [matcher, packagedMatcher]) {
    for (const { command, failed, output, expected } of cases) {
      const result = implementation.matchLedgerLessons(input({
        event: { phase: 'failure', tool: 'shell', command, outcome: { failed, output } }
      }));
      assert.deepEqual(result?.ids ?? null, expected, JSON.stringify({ command, failed, output }));
    }
  }
});

test('a pipeline keeps the per-session action and failure reminder policy', () => {
  const state = stateDir('pipeline-once');
  const base = input({ stateDir: state, sessionIdentity: 'session:pipeline-once' });
  const action = matcher.matchLedgerLessons(base);
  assert.deepEqual(action?.ids, ['E-0003']);
  assert.equal(matcher.matchLedgerLessons(base), null, 'a duplicate action stays silent');

  const failureInput = {
    ...base,
    event: {
      phase: 'failure',
      tool: 'shell',
      command: 'git commit -m "Bad Subject" 2>&1 | tail -3',
      outcome: { failed: false, output: COMMITLINT_OUTPUT }
    }
  };
  const failure = matcher.matchLedgerLessons(failureInput);
  assert.deepEqual(failure?.ids, ['E-0003'], 'an exact diagnostic can recover a pipeline masked by zero status');
  assert.equal(matcher.matchLedgerLessons(failureInput), null, 'a duplicate failure stays silent');

  const unknown = matcher.matchLedgerLessons({
    ...failureInput,
    sessionIdentity: 'session:pipeline-unknown',
    event: { ...failureInput.event, outcome: { failed: 'unknown', output: COMMITLINT_OUTPUT } }
  });
  assert.equal(unknown, null, 'an unknown pipeline outcome stays silent');
  const redirectedZero = matcher.matchLedgerLessons({
    ...failureInput,
    sessionIdentity: 'session:redirected-zero',
    event: { ...failureInput.event, command: 'git commit -m "Bad Subject" 2>&1', outcome: { failed: false, output: COMMITLINT_OUTPUT } }
  });
  assert.equal(redirectedZero, null, 'a redirect alone remains one command and cannot recover a zero status');
});

test('the real generator and runtime accept quoted identity and match scalars', () => {
  const root = workspace('generated quoted record');
  const ledger = path.join(root, '.agents', 'harness-everything', 'errors');
  const recordFile = 'E-0999-quoted-match-record.md';
  write(path.join(ledger, recordFile), QUOTED_RECORD);
  const env = { ...process.env };
  delete env.HARNESS_SYSTEM_ONE_MODE;
  const generated = spawnSync(process.execPath, [ERRORS_SYNC, '--root', root], {
    cwd: ROOT,
    env,
    encoding: 'utf8'
  });
  assert.equal(generated.status, 0, generated.stderr);
  const row = JSON.parse(fs.readFileSync(path.join(ledger, 'index.jsonl'), 'utf8').trim());
  const state = stateDir('generated-quoted');
  const action = select(input({
    workspaceRoot: root,
    stateDir: state,
    event: { phase: 'action', tool: 'shell', command: 'git commit', outcome: { failed: 'unknown' } }
  }));
  assert.deepEqual(action?.ids, ['E-0999'], 'the generated quoted rule selects its real Cue/Lesson at action');
  assert.ok(action.text.includes('A generated quoted rule is still an ordinary Git commit.'));
  assert.ok(action.text.includes('Review the commit message before retrying.'));
  assert.match(row.matchBinding, /^[0-9a-f]{64}$/, 'the generator binds every match-bearing row');

  const failure = select(input({
    workspaceRoot: root,
    stateDir: state,
    event: {
      phase: 'failure',
      tool: 'shell',
      command: 'git commit',
      outcome: { failed: true, output: COMMITLINT_OUTPUT }
    }
  }));
  assert.deepEqual(failure?.ids, ['E-0999'], 'the same generated rule selects at failure');

  const recordPath = path.join(ledger, recordFile);
  fs.writeFileSync(recordPath, QUOTED_RECORD.replace('status: "lesson"', 'status: "open"'));
  assert.equal(select(input({ workspaceRoot: root, stateDir: stateDir('stale-frontmatter') })), null,
    'a frontmatter change makes its generated binding stale');
  fs.writeFileSync(recordPath, QUOTED_RECORD.replace('id: "E-0999"', 'id: "E-1000"'));
  assert.equal(select(input({ workspaceRoot: root, stateDir: stateDir('wrong-record-id') })), null,
    'a record identity change makes its generated binding stale');
  fs.writeFileSync(recordPath, QUOTED_RECORD);
  const indexPath = path.join(ledger, 'index.jsonl');
  const tamperedRow = { ...row, signature: 'tampered-signature' };
  fs.writeFileSync(indexPath, JSON.stringify(tamperedRow) + '\n');
  assert.equal(select(input({ workspaceRoot: root, stateDir: stateDir('tampered-row') })), null,
    'an independently edited row fails open');
});

test('git -C commit reaches E-0003 at action and captured failure', () => {
  const command = 'git -C x commit';
  const state = stateDir('git-C-action-failure');
  const action = select(input({
    stateDir: state,
    event: { phase: 'action', tool: 'shell', command, outcome: { failed: 'unknown' } }
  }));
  assert.deepEqual(action?.ids, ['E-0003'], 'git -C x commit selects at action');
  const failure = select(input({
    stateDir: state,
    event: { phase: 'failure', tool: 'shell', command, outcome: { failed: true, output: COMMITLINT_OUTPUT } }
  }));
  assert.deepEqual(failure?.ids, ['E-0003'], 'git -C x commit selects at failure with captured commitlint output');
  assert.equal(action.text, failure.text, 'action and failure carry the same reminder under separate phase keys');

  for (const prefix of [
    '-c user.name=Harness',
    '--no-pager',
    '-P',
    '-C x -c user.name=Harness --git-dir=/repo/.git --work-tree=/repo --no-pager -P'
  ]) {
    assert.deepEqual(matcher.normalizeGitCommitCommand('git ' + prefix + ' commit'), {
      tool: 'shell', executable: 'git', subcommand: 'commit'
    }, prefix);
  }
  const combined = select(input({
    stateDir: stateDir('combined-global-options'),
    event: {
      phase: 'action',
      tool: 'shell',
      command: 'git -C x -c user.name=Harness --git-dir=/repo/.git --work-tree=/repo --no-pager -P commit',
      outcome: { failed: 'unknown' }
    }
  }));
  assert.deepEqual(combined?.ids, ['E-0003'], 'combined Git globals do not change the bound workspace ledger');
});

test('quoted mentions, unrelated commands and unqualified failures stay silent', () => {
  const controls = [
    { phase: 'action', command: 'echo "git commit"', failed: true, output: COMMITLINT_OUTPUT },
    { phase: 'action', command: "printf '%s' 'git commit'", failed: true, output: COMMITLINT_OUTPUT },
    { phase: 'action', command: 'git status', failed: true, output: COMMITLINT_OUTPUT },
    { phase: 'action', command: 'git merge origin/main', failed: true, output: COMMITLINT_OUTPUT },
    { phase: 'failure', command: 'git commit', failed: false, output: COMMITLINT_OUTPUT },
    { phase: 'failure', command: 'git commit', failed: 'unknown', output: COMMITLINT_OUTPUT },
    { phase: 'failure', command: 'git commit', failed: true, output: 'subject-case appears in an ordinary warning' },
    { phase: 'failure', command: 'git commit', failed: true, output: '⚠ subject must be lower-case [subject-case]' },
    { phase: 'failure', command: 'echo "git commit"', failed: true, output: COMMITLINT_OUTPUT },
    { phase: 'failure', command: 'git status', failed: true, output: COMMITLINT_OUTPUT }
  ];
  for (const control of controls) {
    const { phase, command, failed, output } = control;
    assert.equal(select(input({ event: { phase, tool: 'shell', command, outcome: { failed, output } } })), null, command);
  }
});

test('dedupe is keyed by workspace, session, lesson and phase', () => {
  const base = input();
  assert.deepEqual(select(base).ids, ['E-0003']);
  assert.equal(select(base), null, 'same phase repeats silently');
  assert.deepEqual(select({ ...base, sessionIdentity: 'session:two' }).ids, ['E-0003']);
  assert.deepEqual(select({
    ...base,
    workspaceRoot: repoWorkspace('second workspace'),
    workspaceIdentity: 'workspace:other'
  }).ids, ['E-0003']);
  assert.deepEqual(select({
    ...base,
    event: { phase: 'failure', tool: 'shell', command: 'git commit', outcome: { failed: true, output: COMMITLINT_OUTPUT } }
  }).ids, ['E-0003']);
});

test('concurrent processes atomically emit one copy of a phase key', async () => {
  assert.equal(typeof matcher?.matchLedgerLessons, 'function', 'concurrent acceptance requires the shared matcher');
  const shared = input({ stateDir: stateDir('concurrent-state') });
  const script = [
    "const { matchLedgerLessons } = require('./hooks/scripts/lib/ledger-match.js');",
    'process.stdout.write(JSON.stringify(matchLedgerLessons(JSON.parse(process.env.INPUT))));'
  ].join('\n');
  const run = () => new Promise((resolve, reject) => {
    const env = { ...process.env, INPUT: JSON.stringify(shared) };
    delete env.HARNESS_SYSTEM_ONE_MODE;
    const child = spawn(process.execPath, ['-e', script], {
      cwd: ROOT,
      env,
      stdio: ['ignore', 'pipe', 'pipe']
    });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8').on('data', chunk => { stdout += chunk; });
    child.stderr.setEncoding('utf8').on('data', chunk => { stderr += chunk; });
    child.once('error', reject);
    child.once('close', code => code === 0 ? resolve(JSON.parse(stdout)) : reject(new Error(stderr)));
  });
  const results = await Promise.all([run(), run()]);
  assert.equal(results.filter(Boolean).length, 1);
  assert.deepEqual(results.filter(Boolean)[0].ids, ['E-0003']);
});

test('a dropped pending handoff can release its atomic reservation', () => {
  assert.equal(typeof matcher?.releaseLedgerMatch, 'function', 'carriers can release a dropped handoff');
  const base = input();
  const pending = select(base);
  assert.equal(matcher.releaseLedgerMatch(pending), true);
  assert.deepEqual(select(base).ids, ['E-0003']);
  assert.equal(matcher.releaseLedgerMatch(pending), false, 'a reservation can be released only once');
});

test('failed reservation cleanup remains visible and can be retried', () => {
  const base = input();
  const pending = select(base);
  const unlink = fs.unlinkSync;
  fs.unlinkSync = () => { throw Object.assign(new Error('state directory is temporarily unavailable'), { code: 'EACCES' }); };
  try {
    assert.equal(matcher.releaseLedgerMatch(pending), false);
  } finally {
    fs.unlinkSync = unlink;
  }
  assert.equal(select(base), null, 'the unremoved reservation still dedupes');
  assert.equal(matcher.releaseLedgerMatch(pending), true, 'the carrier can retry cleanup');
  assert.deepEqual(select(base).ids, ['E-0003']);
});

test('provisional source is bounded, workspace-scoped and works without a repo index', () => {
  const root = workspace('local only');
  let seenBudget;
  const result = select(input({
    workspaceRoot: root,
    provisionalSource: (identity, budget) => {
      assert.equal(identity, 'workspace:fixture');
      seenBudget = budget;
      return [PROVISIONAL_FIXTURE[0]];
    }
  }));
  assert.deepEqual(result.ids, ['local-commit-a']);
  assert.ok(result.text.includes('Provisional local lesson (unreviewed)'));
  assert.ok(result.text.startsWith('Provisional local lesson (unreviewed)\n'));
  assert.ok(result.text.includes('Check the proposed message before retrying.'));
  assert.ok(!result.text.includes('A local note about a commit.'), 'cue is matching metadata, not reminder text');
  assert.deepEqual(seenBudget, { maxCandidates: 32, maxBytes: 65536, maxTextChars: 4096 });
  assert.equal(result.text.split('Consider a fresh look, and zoom out if warranted.').length - 1, 1);
});

test('repo candidates precede provisional candidates and canonical duplicates collapse', () => {
  const duplicate = fixtureCandidate({
    identity: 'local-copy-of-e3',
    signature: REAL_E3.signature,
    promotionId: REAL_E3.id,
    lesson: 'LOCAL_DUPLICATE_SENTINEL'
  });
  const distinct = fixtureCandidate({ identity: 'local-distinct', signature: 'local-distinct', lesson: 'Distinct local lesson.' });
  const base = input({ provisionalSource: localSource([distinct, duplicate]) });
  const result = select(base);
  assert.deepEqual(result.ids, ['E-0003', 'local-distinct']);
  assert.ok(Array.from(result.text).length <= 1500);
  assert.ok(result.text.includes('Check the subject line against both rules'));
  assert.ok(result.text.includes('Distinct local lesson.'));
  assert.ok(!result.text.includes('LOCAL_DUPLICATE_SENTINEL'));
  assert.equal(select({ ...base, provisionalSource: localSource([duplicate]) }), null,
    'an exhausted repo identity does not make its local duplicate eligible');
});

test('stable ordering, two-lesson cap and whole-record character cap', () => {
  const candidates = [
    fixtureCandidate({ identity: 'local-z', signature: 'z-local', lesson: 'z lesson' }),
    fixtureCandidate({ identity: 'local-a', signature: 'a-local', lesson: 'a lesson' }),
    fixtureCandidate({ identity: 'local-b', signature: 'b-local', lesson: 'b lesson' })
  ];
  const first = select(input({ workspaceRoot: workspace('stable a'), provisionalSource: localSource(candidates) }));
  const second = select(input({ workspaceRoot: workspace('stable b'), provisionalSource: localSource([...candidates].reverse()) }));
  assert.deepEqual(first.ids, ['local-a', 'local-b']);
  assert.deepEqual(second.ids, first.ids, 'source ordering does not change selection');
  assert.ok(Array.from(first.text).length <= 1500);

  const capped = select(input({
    workspaceRoot: workspace('cap'),
    provisionalSource: localSource([
      fixtureCandidate({ identity: 'local-too-large', signature: 'a-large', lesson: 'X'.repeat(1500) }),
      fixtureCandidate({ identity: 'local-fits', signature: 'b-small', lesson: 'Small complete lesson.' })
    ])
  }));
  assert.deepEqual(capped.ids, ['local-fits']);
  assert.ok(!capped.text.includes('X'.repeat(100)), 'an oversized excerpt is skipped whole');
  assert.ok(Array.from(capped.text).length <= 1500);
});

test('a repo Cue+Lesson excerpt that cannot fit is skipped whole', () => {
  const oversizedCue = E3_TEXT.replace(/(^## Cue\r?\n\r?\n)[\s\S]*?(\r?\n\r?\n## What happened)/m,
    (_, start, end) => `${start}${'C'.repeat(1500)}${end}`);
  const root = repoWorkspace('whole repo excerpt', { recordText: oversizedCue });
  const result = select(input({ workspaceRoot: root, provisionalSource: localSource([PROVISIONAL_FIXTURE[0]]) }));
  assert.deepEqual(result.ids, ['local-commit-a']);
  assert.ok(!result.text.includes('C'.repeat(100)), 'repo cue is not truncated or partially delivered');
});

test('a throwing or oversized provisional source does not hide a valid repo match', () => {
  const throwing = select(input({ provisionalSource: () => { throw new Error('private source failure'); } }));
  assert.deepEqual(throwing.ids, ['E-0003']);
  const oversized = select(input({
    provisionalSource: localSource([fixtureCandidate({ lesson: 'L'.repeat(5000) })])
  }));
  assert.deepEqual(oversized.ids, ['E-0003']);
  assert.ok(!oversized.text.includes('L'.repeat(100)));
  const malformed = select(input({ provisionalSource: () => [{}] }));
  assert.deepEqual(malformed.ids, ['E-0003']);
});

test('a newly written provisional candidate is read on the next event without a module restart', () => {
  let candidates = [];
  const base = input({ workspaceRoot: workspace('new local lesson'), provisionalSource: () => candidates });
  assert.equal(select(base), null);
  candidates = [PROVISIONAL_FIXTURE[0]];
  assert.deepEqual(select(base).ids, ['local-commit-a']);
});

test('repo corruption fails open while an independent valid provisional source still works', () => {
  const root = repoWorkspace('broken index', { indexText: '{bad json}\n' });
  const result = select(input({ workspaceRoot: root, provisionalSource: localSource([PROVISIONAL_FIXTURE[0]]) }));
  assert.deepEqual(result.ids, ['local-commit-a']);
  assert.ok(!result.text.includes('commitlint'));
});

test('malformed or oversized repo inputs produce no repo text', () => {
  const unboundRow = { ...REAL_E3 };
  delete unboundRow.matchBinding;
  const cases = [
    ['unbound matched row', repoWorkspace('unbound row', { indexText: JSON.stringify(unboundRow) + '\n' })],
    ['oversized index', repoWorkspace('large index', { indexText: ' '.repeat(600 * 1024) })],
    ['missing record', repoWorkspace('missing record', { missingRecord: true })],
    ['oversized record', repoWorkspace('large record', { recordText: E3_TEXT + 'x'.repeat(40 * 1024) })],
    ['malformed record', repoWorkspace('malformed record', { recordText: 'not a Markdown ledger record\n' })],
    ['missing cue', repoWorkspace('no cue', { recordText: E3_TEXT.replace(/^## Cue$/m, '## Situation') })],
    ['missing lesson', repoWorkspace('no lesson', { recordText: E3_TEXT.replace(/^## Lesson$/m, '## Advice') })]
  ];
  for (const [label, root] of cases) {
    assert.equal(select(input({ workspaceRoot: root })), null, label);
  }
  const staleRow = { ...REAL_E3, match: { ...REAL_E3.match, actions: [{ tool: 'shell', executable: 'git', subcommand: 'status' }] } };
  const stale = repoWorkspace('stale index', { indexText: `${JSON.stringify(staleRow)}\n` });
  assert.equal(select(input({ workspaceRoot: stale, event: { phase: 'action', tool: 'shell', command: 'git status', outcome: { failed: 'unknown' } } })), null,
    'a well-formed edited index does not override its canonical record');
});

test('traversal and escaping symlinks are rejected', t => {
  const traversal = repoWorkspace('traversal', {
    indexText: `${JSON.stringify({ ...REAL_E3, file: '../../outside.md' })}\n`
  });
  assert.equal(select(input({ workspaceRoot: traversal })), null, 'traversal is silent');

  const root = workspace('symlink');
  const ledger = path.join(root, '.agents', 'harness-everything', 'errors');
  const record = path.join(ledger, REAL_E3.file.split('/').at(-1));
  const outside = path.join(TMP, `outside-${++serial}.md`);
  fs.mkdirSync(ledger, { recursive: true });
  fs.writeFileSync(path.join(ledger, 'index.jsonl'), `${JSON.stringify(REAL_E3)}\n`);
  fs.writeFileSync(outside, E3_TEXT);
  try {
    fs.symlinkSync(outside, record, 'file');
  } catch (error) {
    if (['EPERM', 'EACCES', 'ENOSYS'].includes(error.code)) return t.skip(`file symlink unavailable: ${error.code}`);
    throw error;
  }
  assert.equal(select(input({ workspaceRoot: root })), null, 'a record symlink outside the ledger is silent');
});

test('an unavailable dedupe directory is silent and never falls back', () => {
  const blocker = path.join(TMP, `state-file-${++serial}`);
  fs.writeFileSync(blocker, 'not a directory');
  assert.equal(select(input({ stateDir: path.join(blocker, 'session') })), null);
});

test('R-518 P2/P3: unspaced single-char middle pipeline members match and trailing unescaped redirect backslashes are rejected', () => {
  const expected = { tool: 'shell', executable: 'git', subcommand: 'commit' };
  const supported = [
    'x|y|git commit -m "A"',
    'a|b|c|git commit -m "A"',
    'x | y | git commit -m "A"',
    'x||y||git commit -m "A"',
    'git commit -m "A" > out\\\\',
    'git commit -m "A" > "out\\\\"',
    "git commit -m \"A\" > 'out\\'",
    'git commit -m "A" > out\\ file.log'
  ];
  const unsupported = [
    'x|||git commit -m "A"',
    'git commit ||| echo done',
    'x| |git commit -m "A"',
    'git commit -m "A" > out\\',
    'git commit -m "A" > \\',
    'git commit -m "A" > out\\\\\\'
  ];
  for (const implementation of [matcher, packagedMatcher]) {
    for (const command of supported) {
      assert.deepEqual(implementation.normalizeGitCommitCommand(command), expected, command);
      const result = implementation.matchLedgerLessons(input({
        event: { phase: 'action', tool: 'shell', command, outcome: { failed: 'unknown' } }
      }));
      assert.deepEqual(result?.ids, ['E-0003'], command);
    }
    for (const command of unsupported) {
      assert.equal(implementation.normalizeGitCommitCommand(command), null, command);
      assert.equal(implementation.matchLedgerLessons(input({
        event: { phase: 'action', tool: 'shell', command, outcome: { failed: 'unknown' } }
      })), null, command);
    }
  }
});

test('exports validateMatch and read-only peekRepoMatches without taking claims or applying reminder caps', () => {
  for (const implementation of [matcher, packagedMatcher]) {
    assert.equal(typeof implementation.validateMatch, 'function', 'validateMatch is exported');
    assert.deepEqual(implementation.validateMatch({
      actions: [{ tool: 'shell', executable: 'git', subcommand: 'commit' }]
    }), {
      actions: [{ tool: 'shell', executable: 'git', subcommand: 'commit' }]
    });
    assert.throws(() => implementation.validateMatch({ invalidKey: [] }), /invalid match/);

    assert.equal(typeof implementation.peekRepoMatches, 'function', 'peekRepoMatches is exported');

    const freshState = stateDir('peek-no-claim');
    const actionInput = input({ stateDir: freshState });
    assert.deepEqual(implementation.peekRepoMatches(actionInput), ['E-0003'], 'first peek returns matching repo id');
    assert.deepEqual(implementation.peekRepoMatches(actionInput), ['E-0003'], 'second peek still returns matching repo id');
    assert.equal(fs.existsSync(freshState), false, 'peek does not create stateDir or write claim files');

    const delivered = implementation.matchLedgerLessons(actionInput);
    assert.deepEqual(delivered?.ids, ['E-0003'], 'matchLedgerLessons still delivers once after two peeks');
    assert.equal(implementation.matchLedgerLessons(actionInput), null, 'duplicate delivery stays silent');
    assert.deepEqual(implementation.peekRepoMatches(actionInput), ['E-0003'],
      'peek still reports repo match after delivery claim is exhausted');

    assert.deepEqual(implementation.peekRepoMatches({
      workspaceRoot: GENERATED_E3_ROOT,
      event: {
        phase: 'failure',
        tool: 'shell',
        command: 'git commit -m "Bad Subject"',
        outcome: { failed: true, output: COMMITLINT_OUTPUT }
      }
    }), ['E-0003'], 'peek works for failure phase without sessionIdentity or stateDir');

    for (const command of ['git status', 'echo "git commit"', '']) {
      assert.deepEqual(implementation.peekRepoMatches({
        workspaceRoot: GENERATED_E3_ROOT,
        event: { phase: 'action', tool: 'shell', command, outcome: { failed: 'unknown' } }
      }), [], `unknown command returns empty: ${command}`);
    }
    assert.deepEqual(implementation.peekRepoMatches(null), [], 'null input fails open to []');

    const oversizedCue = E3_TEXT.replace(/(^## Cue\r?\n\r?\n)[\s\S]*?(\r?\n\r?\n## What happened)/m,
      (_, start, end) => `${start}${'C'.repeat(1500)}${end}`);
    const oversizedRoot = repoWorkspace('peek oversized repo', { recordText: oversizedCue });
    assert.equal(implementation.matchLedgerLessons(input({ workspaceRoot: oversizedRoot })), null,
      'oversized repo excerpt is skipped by reminder cap in matchLedgerLessons');
    assert.deepEqual(implementation.peekRepoMatches({
      workspaceRoot: oversizedRoot,
      event: { phase: 'action', tool: 'shell', command: 'git commit', outcome: { failed: 'unknown' } }
    }), ['E-0003'], 'peek ignores reminder char cap and still returns repo match');

    assert.deepEqual(implementation.peekRepoMatches({
      workspaceRoot: workspace('peek no repo'),
      event: { phase: 'action', tool: 'shell', command: 'git commit', outcome: { failed: 'unknown' } },
      provisionalSource: localSource([PROVISIONAL_FIXTURE[0]])
    }), [], 'peek is repo-only and ignores provisionalSource');
  }
});
