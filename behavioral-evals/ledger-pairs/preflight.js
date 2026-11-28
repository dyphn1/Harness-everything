'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { buildFixture } = require('./fixture');
const REPO = path.resolve(__dirname, '../..');

function parseArgs(argv) {
  const result = { noModel: false };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--no-model') result.noModel = true;
    else if (argv[i] === '--out') result.out = argv[++i];
    else throw new Error(`unknown argument: ${argv[i]}`);
  }
  if (!result.out) throw new Error('--out is required');
  if (!result.noModel) throw new Error('live preflight is coordinator-only; pass --no-model here to keep model quota untouched');
  return result;
}

function checkCommit(repo, subject, env) {
  const result = spawnSync('git', ['-C', repo, 'commit', '--allow-empty', '-m', subject], { encoding: 'utf8', env });
  return { accepted: result.status === 0, status: result.status, output: `${result.stdout || ''}${result.stderr || ''}` };
}

async function runPreflight({ out }) {
  const target = path.resolve(out);
  const fixture = await buildFixture({ out: target, arm: 'treatment' });
  const env = {
    ...process.env,
    HOME: path.join(target, 'home'),
    CODEX_HOME: path.join(target, 'codex-home'),
    TMPDIR: path.join(target, 'tmp'),
  };
  for (const key of ['HOME', 'CODEX_HOME', 'TMPDIR']) fs.mkdirSync(env[key], { recursive: true });
  const negative = checkCommit(fixture.repo, 'fix: Uppercase subject control', env);
  const positive = checkCommit(fixture.repo, 'fix: lowercase subject control', env);
  const hookPayload = JSON.stringify({
    hook_event_name: 'PreToolUse', tool_name: 'Bash',
    tool_input: { command: 'git commit -m "fix: uppercase subject control"' },
    cwd: fixture.repo, session_id: 'ledger-pairs-preflight',
  });
  const carrier = spawnSync(process.execPath, [path.join(REPO, 'hooks/scripts/codex-ledger-lesson.js')], {
    input: hookPayload, encoding: 'utf8', cwd: fixture.repo, env,
  });
  const matcher = require(path.join(REPO, 'hooks/scripts/lib/ledger-match.js'));
  const matcherReceipt = matcher.peekRepoMatches({ workspaceRoot: fixture.repo, event: {
    phase: 'action', tool: 'shell', command: 'git commit -m "fix: uppercase subject control"', outcome: { failed: 'unknown' },
  } });
  const codexCarrierOutputHasE3 = carrier.status === 0 && matcherReceipt.includes('E-0003')
    && carrier.stdout.includes('Check the subject line against both rules');
  const report = {
    schemaVersion: 1,
    mode: 'no-model',
    fixture: { initialSha: fixture.initialSha, repo: 'repo', commitlintResolution: fixture.commitlintResolution },
    positiveControls: {
      uppercaseSubjectRejected: !negative.accepted && /subject-case/.test(negative.output),
      lowercaseSubjectAccepted: positive.accepted,
      raw: { negative: negative.output.trim(), positive: positive.output.trim() },
    },
    carrierChecks: {
      codex: codexCarrierOutputHasE3 ? 'PASS: actual hook script emitted E-0003 for a git commit action; model-request receipt remains a live-host check' : 'FAIL: hook did not emit E-0003 for the fixture git commit action',
      codexCarrierOutput: carrier.stdout.trim(),
      matcherReceipt,
      opencode: 'V2 matcher path is mechanism-tested; real carrier delivery requires execute.before/after then the next context request',
      nextModelRequest: 'UNCHECKED: --no-model deliberately sends no request',
    },
    evidenceToRetain: {
      codex: 'hook stdin/action, hookSpecificOutput.additionalContext with E-0003 receipt, and the following codex exec --json request input (or retained host capture that associates it before the next commit decision)',
      opencode: 'server plugin-load lines for this checkout, execute.before/after events, next V2 context hook input/output, and the associated next model request; OpenCode delivers after the triggering action',
    },
    liveEvidence: 'UNCHECKED',
  };
  report.passed = report.positiveControls.uppercaseSubjectRejected && report.positiveControls.lowercaseSubjectAccepted && codexCarrierOutputHasE3;
  fs.writeFileSync(path.join(target, 'preflight.json'), `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
  return report;
}

async function main(argv) {
  const report = await runPreflight(parseArgs(argv));
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  if (!report.passed) process.exitCode = 1;
}

if (require.main === module) main(process.argv.slice(2)).catch(error => { console.error(error.message); process.exitCode = 2; });

module.exports = { checkCommit, main, parseArgs, runPreflight };
