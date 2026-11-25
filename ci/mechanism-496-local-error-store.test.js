#!/usr/bin/env node
'use strict';

const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync, execFileSync } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..');
const EXPORTER = path.join(ROOT, 'scripts', 'system-one-observations-export.js');
const observations = require(path.join(ROOT, 'hooks', 'scripts', 'lib', 'observations.js'));
const { matchLedgerLessons, validateMatch } = require(path.join(ROOT, 'hooks', 'scripts', 'lib', 'ledger-match.js'));
const localErrors = require(path.join(ROOT, 'hooks', 'scripts', 'lib', 'local-errors.js'));

let failures = 0;
function test(name, fn) {
  try {
    fn();
    console.log(`  PASS ${name}`);
  } catch (error) {
    failures += 1;
    console.error(`  FAIL ${name}\n    ${error.stack.split('\n').slice(0, 4).join('\n    ')}`);
  }
}

function canonicalDir(dir) {
  return fs.realpathSync.native ? fs.realpathSync.native(dir) : fs.realpathSync(dir);
}

function makeSandbox() {
  const dir = canonicalDir(fs.mkdtempSync(path.join(os.tmpdir(), 'local-err-')));
  const home = path.join(dir, 'home');
  const store = path.join(dir, 'observations');
  const stateHome = path.join(dir, 'state-home');
  const repoA = path.join(dir, 'repo-a');
  const repoB = path.join(dir, 'repo-b');
  fs.mkdirSync(home, { recursive: true });
  fs.mkdirSync(store, { recursive: true });
  fs.mkdirSync(stateHome, { recursive: true });
  fs.mkdirSync(repoA, { recursive: true });
  fs.mkdirSync(repoB, { recursive: true });
  execFileSync('git', ['init', '-q', repoA]);
  execFileSync('git', ['init', '-q', repoB]);
  const env = {
    ...process.env,
    HOME: home,
    USERPROFILE: home,
    HARNESS_OBSERVATIONS_DIR: store,
    HARNESS_STATE_HOME: stateHome,
  };
  delete env.HARNESS_OBSERVATIONS;
  delete env.HARNESS_SYSTEM_ONE_MODE;
  delete env.HARNESS_WORKSPACE_ROOT;
  delete env.CLAUDE_PROJECT_DIR;
  delete env.CODEX_PROJECT_DIR;
  return { dir, home, store, stateHome, repoA, repoB, env };
}

test('observations.js exposes shared lock and atomic write primitives', () => {
  assert.strictEqual(typeof observations.withLock, 'function');
  assert.strictEqual(typeof observations.writeJsonAtomic, 'function');
});

test('append occurrence and read back with full schema fields', () => {
  const s = makeSandbox();
  const res = localErrors.appendOccurrence({
    workspaceRoot: s.repoA,
    host: 'claude',
    sessionKey: 'sess-raw-1',
    toolUseId: 'tool-use-1',
    command: 'git commit -m "feat: Bad Subject"',
    exitCode: 1,
    output: '⧗   input: feat: Bad Subject\n✖   subject must be lower-case [subject-case]\n✖   found 1 problems, 0 warnings',
    matchedLedgerIds: ['E-0003', 'E-0003'],
  }, { env: s.env });

  assert.strictEqual(res.status, 'appended');
  assert.ok(res.record);
  assert.strictEqual(res.record.schemaVersion, 1);
  assert.strictEqual(res.record.kind, 'occurrence');
  assert.strictEqual(res.record.source, 'tool-failure');
  assert.strictEqual(res.record.host, 'claude');
  assert.strictEqual(res.record.destination, 'unknown');
  assert.strictEqual(res.record.commandClass, 'git');
  assert.strictEqual(res.record.exitCode, 1);
  assert.deepStrictEqual(res.record.matchedLedgerIds, ['E-0003']);
  assert.strictEqual(res.record.signature, 'v1-git-commitlint-subject-case');
  assert.ok(!/^E-/i.test(res.record.provisionalId), 'provisionalId must stay outside E- namespace');
  assert.ok(/^[a-z0-9][a-z0-9_-]{0,63}$/.test(res.record.provisionalId), 'provisionalId must satisfy matcher identifier');
  assert.notStrictEqual(res.record.sessionKey, 'sess-raw-1', 'sessionKey must be opaque');
  assert.notStrictEqual(res.record.toolUseId, 'tool-use-1', 'toolUseId must be opaque');

  const listed = localErrors.listRecords({ env: s.env, workspaceRoot: s.repoA, kind: 'occurrence' });
  assert.strictEqual(listed.length, 1);
  assert.deepStrictEqual(listed[0], res.record);
  assert.strictEqual(localErrors.listRecords({ env: s.env, workspaceRoot: s.repoB }).length, 0,
    'records are partitioned by canonical workspaceKey');
});

test('idempotent retry with same host/workspace/session/toolUseId vs distinct failures', () => {
  const s = makeSandbox();
  const base = {
    workspaceRoot: s.repoA,
    host: 'codex',
    sessionKey: 'sess-idem',
    toolUseId: 'tu-1',
    command: 'npm test',
    exitCode: 1,
    output: 'npm ERR! Test failed. See above for more details.\nnpm ERR! code 1',
  };
  const first = localErrors.appendOccurrence(base, { env: s.env });
  const retry = localErrors.appendOccurrence(base, { env: s.env });
  assert.strictEqual(first.status, 'appended');
  assert.strictEqual(retry.status, 'duplicate');
  assert.strictEqual(retry.record.provisionalId, first.record.provisionalId);

  const distinct = localErrors.appendOccurrence({ ...base, toolUseId: 'tu-2' }, { env: s.env });
  assert.strictEqual(distinct.status, 'appended');
  assert.strictEqual(distinct.record.signature, first.record.signature);
  assert.notStrictEqual(distinct.record.provisionalId, first.record.provisionalId);

  const noToolUse1 = localErrors.appendOccurrence({ ...base, toolUseId: null }, { env: s.env });
  const noToolUse2 = localErrors.appendOccurrence({ ...base, toolUseId: null }, { env: s.env });
  assert.strictEqual(noToolUse1.status, 'appended');
  assert.strictEqual(noToolUse2.status, 'appended');
  assert.notStrictEqual(noToolUse1.record.provisionalId, noToolUse2.record.provisionalId);

  const listed = localErrors.listRecords({ env: s.env, workspaceRoot: s.repoA });
  assert.strictEqual(listed.length, 4);
});

test('redacts email, home paths, and token-like strings before persistence and before signature', () => {
  const s = makeSandbox();
  const secretA = 'ghp_1234567890abcdefghijklmnopqrstuv';
  const secretB = 'ghp_zyxwvutsrqponmlkjihgfedcba987654';
  const bearerA = 'Bearer sk-proj-aaaaaaaaaaaaaaaaaaaaaaaaaaaa';
  const bearerB = 'Bearer sk-proj-bbbbbbbbbbbbbbbbbbbbbbbbbbbb';
  const outputA = `Fatal custom crash for alice@example.com at /Users/alice/work/app.js with ${secretA} and ${bearerA} and api_key=topsecret123`;
  const outputB = `Fatal custom crash for bob@other.org at /home/bob/work/app.js with ${secretB} and ${bearerB} and api_key=different999`;

  const sigA = localErrors.normalizeSignature({ command: 'node run.js', output: outputA });
  const sigB = localErrors.normalizeSignature({ command: 'node run.js', output: outputB });
  assert.strictEqual(sigA, sigB, 'redaction must happen before signature derivation');

  const res = localErrors.appendOccurrence({
    workspaceRoot: s.repoA,
    host: 'claude',
    command: 'node run.js --token super-secret-arg',
    exitCode: 1,
    output: outputA,
  }, { env: s.env });
  assert.strictEqual(res.status, 'appended');

  const rawIndex = fs.readFileSync(path.join(s.store, 'errors-index.json'), 'utf8');
  for (const leaked of ['alice@example.com', '/Users/alice', secretA, 'sk-proj-aaaa', 'topsecret123', 'super-secret-arg']) {
    assert.ok(!rawIndex.includes(leaked), `persisted store must not retain ${leaked}`);
  }
  assert.ok(res.record.outputExcerpt.includes('<email>'));
  assert.ok(res.record.outputExcerpt.includes('<home>'));
  assert.ok(res.record.outputExcerpt.includes('<redacted>'));
});

test('excerpt cap is 2 KiB with short positive control preserved', () => {
  const s = makeSandbox();
  const shortOut = 'short error line';
  const shortRes = localErrors.appendOccurrence({
    workspaceRoot: s.repoA,
    host: 'claude',
    command: 'ls /nope',
    exitCode: 2,
    output: shortOut,
  }, { env: s.env });
  assert.strictEqual(shortRes.record.outputExcerpt, shortOut);

  const bigOut = 'x'.repeat(5000) + 'TAIL_MARKER';
  const bigRes = localErrors.appendOccurrence({
    workspaceRoot: s.repoA,
    host: 'claude',
    command: 'ls /nope',
    exitCode: 2,
    output: bigOut,
  }, { env: s.env });
  assert.ok(Buffer.byteLength(bigRes.record.outputExcerpt, 'utf8') <= 2048, 'excerpt must not exceed 2 KiB');
  assert.ok(bigRes.record.outputExcerpt.endsWith('TAIL_MARKER'), 'tailBytes preserves the tail of the failure output');
});

test('per-workspace and total retention/size bounds are enforced', () => {
  const s = makeSandbox();
  const limits = { maxRecordsPerWorkspace: 2, maxTotalRecords: 3 };

  for (let i = 1; i <= 3; i += 1) {
    const r = localErrors.appendOccurrence({
      workspaceRoot: s.repoA,
      host: 'claude',
      command: 'npm test',
      exitCode: 1,
      output: `npm ERR! code 1 failure ${i}`,
    }, { env: s.env, limits });
    assert.strictEqual(r.status, 'appended');
  }
  const inA = localErrors.listRecords({ env: s.env, workspaceRoot: s.repoA });
  assert.strictEqual(inA.length, 2, 'per-workspace cap keeps at most 2 records');
  assert.ok(inA[0].outputExcerpt.includes('failure 2') && inA[1].outputExcerpt.includes('failure 3'),
    'oldest occurrence evicted first');

  for (let i = 1; i <= 2; i += 1) {
    const r = localErrors.appendOccurrence({
      workspaceRoot: s.repoB,
      host: 'claude',
      command: 'npm test',
      exitCode: 1,
      output: `npm ERR! code 1 repoB ${i}`,
    }, { env: s.env, limits });
    assert.strictEqual(r.status, 'appended');
  }
  const all = localErrors.listRecords({ env: s.env });
  assert.strictEqual(all.length, 3, 'total cap keeps at most 3 records across workspaces');
});

test('lock contention returns fail-open without throwing and leaves index untouched', () => {
  const s = makeSandbox();
  const lockFile = path.join(s.store, '.index.lock');
  fs.writeFileSync(lockFile, 'held-by-test');

  const blocked = localErrors.appendOccurrence({
    workspaceRoot: s.repoA,
    host: 'claude',
    command: 'npm test',
    exitCode: 1,
    output: 'npm ERR! code 1',
  }, { env: s.env, lockTimeoutMs: 25 });
  assert.strictEqual(blocked.status, 'lock-timeout');
  assert.strictEqual(fs.existsSync(path.join(s.store, 'errors-index.json')), false,
    'timed out write must not create or mutate errors-index.json');

  fs.unlinkSync(lockFile);
  const unblocked = localErrors.appendOccurrence({
    workspaceRoot: s.repoA,
    host: 'claude',
    command: 'npm test',
    exitCode: 1,
    output: 'npm ERR! code 1',
  }, { env: s.env, lockTimeoutMs: 50 });
  assert.strictEqual(unblocked.status, 'appended');
});

test('local error records stay absent from turn index and System One export path', () => {
  const s = makeSandbox();
  // Seed one valid turn observation in observations-index.json.
  const turnText = { prompt: 'fix a unit test', previous: '' };
  const contentSha256 = observations.sha(JSON.stringify(turnText));
  const turnRecord = {
    id: 'turn-obs-1',
    source: 'observation',
    status: 'active',
    observedAt: new Date().toISOString(),
    validUntil: new Date(Date.now() + 86400000).toISOString(),
    contentSha256,
    host: 'claude',
    turn: 1,
    writer: { sessionId: 'sess-turn-1' },
    scope: { taskTerms: ['fix'], requirementTerms: [], roles: [] },
    promptBytes: 15,
    router: null,
    behavior: observations.emptyBehavior(),
    selfReport: { v: 1, validity: 'actionable', tier: 'tier2', intents: ['fix'], workflow: 'iterative-single', skills: [] },
    selfReportReason: null,
  };
  assert.strictEqual(observations.appendRecord(s.store, turnRecord, turnText), true);

  // Append local error occurrence and provisional lesson into the same store root.
  const errRes = localErrors.appendOccurrence({
    workspaceRoot: s.repoA,
    host: 'claude',
    command: 'git commit -m "feat: Bad"',
    exitCode: 1,
    output: '✖   subject must be lower-case [subject-case]',
  }, { env: s.env });
  assert.strictEqual(errRes.status, 'appended');

  const turnIndex = observations.readJson(path.join(s.store, 'observations-index.json'), null);
  assert.strictEqual(turnIndex.records.length, 1);
  assert.strictEqual(turnIndex.records[0].id, 'turn-obs-1');

  const outDir = path.join(s.dir, 'export-out');
  const exported = spawnSync(process.execPath, [EXPORTER, '--store', s.store, '--out', outDir, '--self-report-only'], {
    env: s.env, encoding: 'utf8', timeout: 10000,
  });
  assert.strictEqual(exported.status, 0, `exporter failed: ${exported.stderr}`);
  const report = JSON.parse(fs.readFileSync(path.join(outDir, 'export-report.json'), 'utf8'));
  assert.strictEqual(report.records, 1);
  assert.strictEqual(report.exported, 1);
  const prompts = fs.readFileSync(path.join(outDir, 'prompts-observed.jsonl'), 'utf8');
  assert.ok(!prompts.includes(errRes.record.provisionalId));
  assert.ok(!prompts.includes('subject-case'));
});

test('provisional lesson validates match, rejects invalid match and E- namespace, and projects into ledger-match', () => {
  assert.strictEqual(typeof validateMatch, 'function', 'ledger-match.js must export validateMatch');
  assert.strictEqual(localErrors.validateMatch, validateMatch,
    'local-errors.js must import validateMatch from ledger-match.js rather than copying it');
  const s = makeSandbox();
  const validMatch = {
    actions: [{ tool: 'shell', executable: 'git', subcommand: 'commit' }],
    failures: [{ tool: 'shell', executable: 'git', subcommand: 'commit', diagnostics: ['subject-case'] }],
  };

  assert.throws(() => localErrors.addProvisionalLesson({
    workspaceRoot: s.repoA,
    signature: 'v1-git-commitlint-subject-case',
    match: { invalidKey: [] },
    lesson: 'Keep commit subjects lower-case.',
  }, { env: s.env }), /invalid match/i);

  assert.throws(() => localErrors.addProvisionalLesson({
    workspaceRoot: s.repoA,
    signature: 'v1-git-commitlint-subject-case',
    match: { failures: [{ tool: 'shell', executable: 'git', subcommand: 'commit', diagnostics: ['dup', 'dup'] }] },
    lesson: 'Keep commit subjects lower-case.',
  }, { env: s.env }), /invalid diagnostics/i);

  assert.throws(() => localErrors.addProvisionalLesson({
    workspaceRoot: s.repoA,
    provisionalId: 'E-0099',
    signature: 'v1-git-commitlint-subject-case',
    match: validMatch,
    lesson: 'Keep commit subjects lower-case.',
  }, { env: s.env }), /provisionalId/i);

  assert.throws(() => localErrors.addProvisionalLesson({
    workspaceRoot: s.repoA,
    signature: 'v1-git-commitlint-subject-case',
    match: validMatch,
    lesson: 'Keep commit subjects lower-case.',
    issueUrl: 'http://insecure.example.com/1',
  }, { env: s.env }), /issueUrl/i);

  const added = localErrors.addProvisionalLesson({
    workspaceRoot: s.repoA,
    destination: 'project',
    signature: 'v1-git-commitlint-subject-case',
    match: validMatch,
    cue: 'Commit rejected by commitlint.',
    lesson: 'Use lowercase subjects; contact alice@example.com with ghp_1234567890abcdefghijklmnopqrstuv.',
    issueUrl: 'https://github.com/dyphn1/Harness-everything/issues/496',
    promotionId: 'E-0003',
  }, { env: s.env });
  assert.strictEqual(added.status, 'appended');
  assert.strictEqual(added.record.kind, 'provisional-lesson');
  assert.strictEqual(added.record.destination, 'project');
  assert.strictEqual(added.record.promotionId, 'E-0003');
  assert.ok(!/^E-/i.test(added.record.provisionalId));
  assert.ok(!added.record.lesson.includes('alice@example.com'));
  assert.ok(!added.record.lesson.includes('ghp_1234567890'));

  const lessons = localErrors.listRecords({ env: s.env, workspaceRoot: s.repoA, kind: 'provisional-lesson' });
  assert.strictEqual(lessons.length, 1);

  // Verify C2-style projection is accepted end-to-end by ledger-match.js.
  const stateDir = path.join(s.dir, 'match-state');
  const matched = matchLedgerLessons({
    workspaceRoot: s.repoA,
    workspaceIdentity: lessons[0].workspaceKey,
    sessionIdentity: 'sess-proj-1',
    stateDir,
    event: {
      phase: 'action',
      tool: 'shell',
      command: 'git commit -m "chore: test"',
      outcome: { failed: 'unknown' },
    },
    provisionalSource: () => lessons.map(item => ({
      identity: item.provisionalId,
      signature: item.signature,
      promotionId: item.promotionId,
      match: item.match,
      cue: item.cue,
      lesson: item.lesson,
    })),
  });
  assert.ok(matched && matched.ids.includes(lessons[0].provisionalId),
    'projected provisional lesson must be accepted and matched by ledger-match.js');
});

test('real failure signature fixtures are stable across volatile details and divergent classes differ', () => {
  const commitlint1 = localErrors.normalizeSignature({
    command: 'git commit -m "feat: Add Store"',
    output: '⧗   input: feat: Add Store\n✖   subject must be lower-case [subject-case]\n✖   found 1 problems, 0 warnings',
  });
  const commitlint2 = localErrors.normalizeSignature({
    command: 'git commit -m "fix: Another Uppercase Header"',
    output: '⧗   input: fix: Another Uppercase Header\n✖   subject must be lower-case [subject-case]\n✖   found 2 problems, 1 warnings',
  });
  assert.strictEqual(commitlint1, commitlint2);

  const npm1 = localErrors.normalizeSignature({
    command: 'npm test',
    output: 'npm ERR! Test failed.  See above for more details.\nnpm ERR! code 1\nnpm ERR! path /Users/alice/repo-1\nnpm ERR! A complete log of this run can be found in: /Users/alice/.npm/_logs/2026-11-24T01_00_00_000Z-debug-0.log',
  });
  const npm2 = localErrors.normalizeSignature({
    command: 'npm run test:consistency',
    output: 'npm ERR! code 1\nnpm ERR! path /home/bob/repo-2\nnpm ERR! command failed\nnpm ERR! A complete log of this run can be found in: /home/bob/.npm/_logs/2026-11-25T23_59_59_999Z-debug-0.log',
  });
  assert.strictEqual(npm1, npm2);

  const eperm1 = localErrors.normalizeSignature({
    command: 'node scripts/workflow.js',
    output: "Error: EPERM: operation not permitted, open '/Users/alice/.agents/harness-everything/workspaces/a-111/state/file.json'\n    at Object.openSync (node:fs:561:18)",
  });
  const eperm2 = localErrors.normalizeSignature({
    command: 'node scripts/other.js',
    output: "Error: EPERM: operation not permitted, mkdir '/home/bob/.agents/harness-everything/workspaces/b-222/state'\n    at Object.mkdirSync (node:fs:1009:26)",
  });
  assert.strictEqual(eperm1, eperm2);

  const gitNff1 = localErrors.normalizeSignature({
    command: 'git push origin main',
    output: "To github.com:org/repo-a.git\n ! [rejected]        main -> main (non-fast-forward)\nerror: failed to push some refs to 'github.com:org/repo-a.git'\nhint: Updates were rejected because the tip of your current branch is behind",
  });
  const gitNff2 = localErrors.normalizeSignature({
    command: 'git push upstream feat/abc',
    output: "To github.com:other/repo-b.git\n ! [rejected]        feat/abc -> feat/abc (non-fast-forward)\nerror: failed to push some refs to 'github.com:other/repo-b.git'",
  });
  assert.strictEqual(gitNff1, gitNff2);

  const unique = new Set([commitlint1, npm1, eperm1, gitNff1]);
  assert.strictEqual(unique.size, 4, 'divergent failure classes must produce distinct signatures');
  for (const sig of unique) {
    assert.ok(/^v1-[a-z0-9][a-z0-9_-]{0,60}$/.test(sig), `signature ${sig} must be versioned and matcher-safe`);
  }

  // E-0027 control: multi-family output produces an order-independent composite signature distinct from single-family.
  const multiA = localErrors.normalizeSignature({
    command: 'npm test',
    output: 'npm ERR! code 1\nError: EPERM: operation not permitted, open /tmp/a',
  });
  const multiB = localErrors.normalizeSignature({
    command: 'npm test',
    output: 'Error: EPERM: operation not permitted, open /tmp/b\nnpm ERR! code 1',
  });
  assert.strictEqual(multiA, multiB, 'multi-family signature must be order-independent');
  assert.notStrictEqual(multiA, npm1, 'multi-family output must not collapse to first single-family match');
});

test('D1b row 1: issueUrl with userinfo is rejected and leaves index bytes unchanged', () => {
  const s = makeSandbox();
  const validMatch = {
    actions: [{ tool: 'shell', executable: 'git', subcommand: 'commit' }],
  };
  const seed = localErrors.addProvisionalLesson({
    workspaceRoot: s.repoA,
    destination: 'project',
    signature: 'v1-git-seed-row1',
    match: validMatch,
    lesson: 'Seed lesson before negative check.',
    issueUrl: 'https://github.com/o/r/issues/1',
  }, { env: s.env });
  assert.strictEqual(seed.status, 'appended');

  const indexPath = path.join(s.store, 'errors-index.json');
  const before = fs.readFileSync(indexPath);

  for (const badUrl of [
    'https://user:pass@github.com/o/r/issues/1',
    'https://tokenonly@github.com/o/r/issues/1',
    'https://:secret@github.com/o/r/issues/1',
  ]) {
    assert.throws(() => localErrors.addProvisionalLesson({
      workspaceRoot: s.repoA,
      destination: 'project',
      signature: 'v1-git-userinfo-bad',
      match: validMatch,
      lesson: 'Should not persist.',
      issueUrl: badUrl,
    }, { env: s.env }), /issueUrl/i, `expected rejection for ${badUrl}`);
  }

  const after = fs.readFileSync(indexPath);
  assert.strictEqual(Buffer.compare(before, after), 0, 'index bytes must be unchanged after userinfo rejection');
});

test('D1b row 2: issueUrl with secret-like query param or token-shaped value is rejected and leaves index unchanged', () => {
  const s = makeSandbox();
  const validMatch = {
    actions: [{ tool: 'shell', executable: 'git', subcommand: 'commit' }],
  };
  const seed = localErrors.addProvisionalLesson({
    workspaceRoot: s.repoA,
    destination: 'project',
    signature: 'v1-git-seed-row2',
    match: validMatch,
    lesson: 'Seed lesson before query check.',
    issueUrl: 'https://github.com/o/r/issues/1',
  }, { env: s.env });
  assert.strictEqual(seed.status, 'appended');

  const indexPath = path.join(s.store, 'errors-index.json');
  const before = fs.readFileSync(indexPath);

  for (const badUrl of [
    'https://github.com/o/r/issues/1?token=secret123',
    'https://github.com/o/r/issues/1?api_key=abc123',
    'https://github.com/o/r/issues/1?secret=xyz789',
    'https://github.com/o/r/issues/1?password=hunter2',
    'https://github.com/o/r/issues/1?sig=deadbeef01',
    'https://github.com/o/r/issues/1?ref=ghp_1234567890abcdefghijklmnopqrstuv',
    'https://github.com/o/r/issues/1?v=eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.abc1234567890',
  ]) {
    assert.throws(() => localErrors.addProvisionalLesson({
      workspaceRoot: s.repoA,
      destination: 'project',
      signature: 'v1-git-query-bad',
      match: validMatch,
      lesson: 'Should not persist.',
      issueUrl: badUrl,
    }, { env: s.env }), /issueUrl/i, `expected rejection for ${badUrl}`);
  }

  const after = fs.readFileSync(indexPath);
  assert.strictEqual(Buffer.compare(before, after), 0, 'index bytes must be unchanged after secret query rejection');
});

test('D1b row 3: plain HTTPS issue and issue comment links are accepted and read back', () => {
  const s = makeSandbox();
  const validMatch = {
    actions: [{ tool: 'shell', executable: 'git', subcommand: 'commit' }],
  };
  const plainUrl = 'https://github.com/o/r/issues/1';
  const commentUrl = 'https://github.com/o/r/issues/1#issuecomment-123';

  const r1 = localErrors.addProvisionalLesson({
    workspaceRoot: s.repoA,
    destination: 'project',
    signature: 'v1-git-plain-issue',
    match: validMatch,
    lesson: 'Plain issue link lesson.',
    issueUrl: plainUrl,
  }, { env: s.env });
  const r2 = localErrors.addProvisionalLesson({
    workspaceRoot: s.repoA,
    destination: 'project',
    signature: 'v1-git-comment-issue',
    match: validMatch,
    lesson: 'Comment link lesson.',
    issueUrl: commentUrl,
  }, { env: s.env });

  assert.strictEqual(r1.status, 'appended');
  assert.strictEqual(r2.status, 'appended');

  const listed = localErrors.listRecords({ env: s.env, workspaceRoot: s.repoA, kind: 'provisional-lesson' });
  const urls = listed.map(r => r.issueUrl);
  assert.ok(urls.includes(plainUrl), 'plain issue URL must be read back');
  assert.ok(urls.includes(commentUrl), 'issue comment URL must be read back');
});

test('D1b row 4: writers reject supplied workspaceKey without resolvable workspace context and do not write', () => {
  const s = makeSandbox();
  const validMatch = {
    actions: [{ tool: 'shell', executable: 'git', subcommand: 'commit' }],
  };
  const indexPath = path.join(s.store, 'errors-index.json');

  for (const suppliedKey of ['/Users/alice/secret-repo', 'repo-a-1234567890ab']) {
    const occ = localErrors.appendOccurrence({
      workspaceKey: suppliedKey,
      host: 'claude',
      command: 'npm test',
      exitCode: 1,
      output: 'npm ERR! code 1',
    }, { env: s.env });
    assert.strictEqual(occ.status, 'invalid', `appendOccurrence must fail-open reject unbound key ${suppliedKey}`);
    assert.strictEqual(occ.record, null);

    assert.throws(() => localErrors.addProvisionalLesson({
      workspaceKey: suppliedKey,
      destination: 'project',
      signature: 'v1-git-unbound-key',
      match: validMatch,
      lesson: 'Should not persist without workspace context.',
    }, { env: s.env }), /workspace/i, `addProvisionalLesson must reject unbound key ${suppliedKey}`);
  }

  assert.strictEqual(fs.existsSync(indexPath), false, 'no index file may be written on unbound workspaceKey');
});

test('D1b row 5: writers reject disagreeing workspaceKey and accept matching canonical key', () => {
  const s = makeSandbox();
  const validMatch = {
    actions: [{ tool: 'shell', executable: 'git', subcommand: 'commit' }],
  };
  const canonicalA = localErrors.resolveWorkspaceKey({ workspaceRoot: s.repoA }, { env: s.env });
  const canonicalB = localErrors.resolveWorkspaceKey({ workspaceRoot: s.repoB }, { env: s.env });
  assert.notStrictEqual(canonicalA, canonicalB);

  // Matching canonical key is accepted for both writers.
  const okOcc = localErrors.appendOccurrence({
    workspaceRoot: s.repoA,
    workspaceKey: canonicalA,
    host: 'claude',
    command: 'npm test',
    exitCode: 1,
    output: 'npm ERR! code 1',
  }, { env: s.env });
  assert.strictEqual(okOcc.status, 'appended');
  assert.strictEqual(okOcc.record.workspaceKey, canonicalA);

  const okLesson = localErrors.addProvisionalLesson({
    workspaceRoot: s.repoA,
    workspaceKey: canonicalA,
    destination: 'project',
    signature: 'v1-git-match-key',
    match: validMatch,
    lesson: 'Matching canonical key accepted.',
  }, { env: s.env });
  assert.strictEqual(okLesson.status, 'appended');
  assert.strictEqual(okLesson.record.workspaceKey, canonicalA);

  const indexPath = path.join(s.store, 'errors-index.json');
  const before = fs.readFileSync(indexPath);

  // Disagreeing key is rejected for both writers, index bytes unchanged.
  for (const wrongKey of [canonicalB, '/Users/alice/forged-path']) {
    const badOcc = localErrors.appendOccurrence({
      workspaceRoot: s.repoA,
      workspaceKey: wrongKey,
      host: 'claude',
      command: 'npm test',
      exitCode: 1,
      output: 'npm ERR! code 1',
    }, { env: s.env });
    assert.strictEqual(badOcc.status, 'invalid');
    assert.strictEqual(badOcc.record, null);

    assert.throws(() => localErrors.addProvisionalLesson({
      workspaceRoot: s.repoA,
      workspaceKey: wrongKey,
      destination: 'project',
      signature: 'v1-git-mismatch-key',
      match: validMatch,
      lesson: 'Should not persist.',
    }, { env: s.env }), /workspace/i);
  }

  const after = fs.readFileSync(indexPath);
  assert.strictEqual(Buffer.compare(before, after), 0, 'index bytes must be unchanged after disagreeing workspaceKey');
});

test('D1b row 6: workspace-scoped reads and matcher-supplied bounded reader lookup work without granting write identity', () => {
  const s = makeSandbox();
  const validMatch = {
    actions: [{ tool: 'shell', executable: 'git', subcommand: 'commit' }],
  };
  const addedA = localErrors.addProvisionalLesson({
    workspaceRoot: s.repoA,
    destination: 'project',
    signature: 'v1-git-read-a',
    match: validMatch,
    lesson: 'Lesson for repo A.',
  }, { env: s.env });
  const addedB = localErrors.addProvisionalLesson({
    workspaceRoot: s.repoB,
    destination: 'project',
    signature: 'v1-git-read-b',
    match: validMatch,
    lesson: 'Lesson for repo B.',
  }, { env: s.env });
  assert.strictEqual(addedA.status, 'appended');
  assert.strictEqual(addedB.status, 'appended');

  const keyA = addedA.record.workspaceKey;
  const keyB = addedB.record.workspaceKey;

  // Normal workspace-scoped read works.
  const byRoot = localErrors.listRecords({ env: s.env, workspaceRoot: s.repoA });
  assert.strictEqual(byRoot.length, 1);
  assert.strictEqual(byRoot[0].signature, 'v1-git-read-a');

  // Matcher-supplied key works for bounded read lookup.
  const byKey = localErrors.listRecords({ env: s.env, workspaceKey: keyA });
  assert.strictEqual(byKey.length, 1);
  assert.strictEqual(byKey[0].signature, 'v1-git-read-a');

  // Disagreeing root + key on read returns empty.
  assert.deepStrictEqual(localErrors.listRecords({ env: s.env, workspaceRoot: s.repoA, workspaceKey: keyB }), []);

  // Oversized or control-char key on read is rejected (returns empty).
  assert.deepStrictEqual(localErrors.listRecords({ env: s.env, workspaceKey: 'a'.repeat(300) }), []);
  assert.deepStrictEqual(localErrors.listRecords({ env: s.env, workspaceKey: `${keyA}\n` }), []);

  // End-to-end matcher callback uses workspaceIdentity for read lookup only.
  const stateDir = path.join(s.dir, 'match-state-row6');
  const matched = matchLedgerLessons({
    workspaceRoot: s.repoA,
    workspaceIdentity: keyA,
    sessionIdentity: 'sess-row6',
    stateDir,
    event: {
      phase: 'action',
      tool: 'shell',
      command: 'git commit -m "chore: test"',
      outcome: { failed: 'unknown' },
    },
    provisionalSource: (wsIdentity) => localErrors.listRecords({
      env: s.env,
      workspaceKey: wsIdentity,
      kind: 'provisional-lesson',
    }).map(item => ({
      identity: item.provisionalId,
      signature: item.signature,
      match: item.match,
      lesson: item.lesson,
    })),
  });
  assert.ok(matched && matched.ids.includes(addedA.record.provisionalId));

  // Same matcher-supplied key cannot establish write identity on its own.
  const rejectedWrite = localErrors.appendOccurrence({
    workspaceKey: keyA,
    host: 'claude',
    command: 'npm test',
    exitCode: 1,
    output: 'npm ERR! code 1',
  }, { env: s.env });
  assert.strictEqual(rejectedWrite.status, 'invalid');
  assert.strictEqual(localErrors.listRecords({ env: s.env, workspaceKey: keyA }).length, 1);
});

console.log(failures ? `\n${failures} failure(s)` : '\nAll local-error-store checks passed.');
process.exit(failures ? 1 : 0);
