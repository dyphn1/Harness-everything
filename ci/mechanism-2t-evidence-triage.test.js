'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const {
  archiveResult,
  sha256,
  triage,
} = require('../behavioral-evals/evidence-tool');
const {
  grade,
  parseSimpleYaml,
} = require('../behavioral-evals/run');
const {
  validateCase,
} = require('../behavioral-evals/case-validator');

function write(filePath, content) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content, 'utf8');
}

function git(cwd, args) {
  return execFileSync('git', args, { cwd, stdio: 'ignore' });
}

function makeGitWorkspace(greeting) {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'evidence-triage-shell-'));
  write(path.join(workspace, 'package.json'), '{"name":"evidence-triage-shell"}\n');
  write(path.join(workspace, 'src', 'greet.js'), `module.exports = name => '${greeting}, ' + name + '!';\n`);
  write(path.join(workspace, 'src', 'format.js'), 'module.exports = value => value;\n');
  write(path.join(workspace, 'README.md'), '# evidence triage\n');
  git(workspace, ['init', '-q']);
  git(workspace, ['config', 'user.email', 'evidence-triage@example.test']);
  git(workspace, ['config', 'user.name', 'Evidence triage test']);
  git(workspace, ['add', '.']);
  git(workspace, ['commit', '-qm', 'fixture']);
  return workspace;
}

function runChecks() {
  const failures = [];
  const check = (name, condition, detail = '') => {
    if (!condition) failures.push(`${name}${detail ? `: ${detail}` : ''}`);
  };
  const tempPaths = [];
  const remove = filePath => {
    try { fs.rmSync(filePath, { recursive: true, force: true }); } catch { /* best effort */ }
  };

  try {
    for (const caseId of ['scope-discipline', 'pressure-scope-bypass']) {
      const caseData = parseSimpleYaml(fs.readFileSync(path.join(__dirname, '..', 'behavioral-evals', 'cases', `${caseId}.yaml`), 'utf8'));
      const workspace = makeGitWorkspace('Hello');
      tempPaths.push(workspace);
      if (caseId === 'pressure-scope-bypass') write(path.join(workspace, 'src', 'greet.js'), "module.exports = name => 'Hi, ' + name + '!';\n");
      const transcriptDir = fs.mkdtempSync(path.join(os.tmpdir(), 'evidence-triage-shell-trace-'));
      tempPaths.push(transcriptDir);
      const transcript = path.join(transcriptDir, 'empty.jsonl');
      write(transcript, '');
      check(`Windows shell executes ${caseId} assertions`, grade(caseData, workspace, transcript).passed);
    }

    const emptyCommandCase = {
      id: 'empty-command',
      prompt: 'run the check',
      max_turns: 1,
      fixture: { files: [{ path: 'index.js', content: '' }] },
      expectations: [{ type: 'command_exit_0', command: '   ' }],
    };
    check('empty command_exit_0 is rejected', validateCase(emptyCommandCase).some(error => /non-empty/.test(error)));

    const crlfCase = parseSimpleYaml([
      'id: crlf-fixture',
      'prompt: |',
      '  preserve',
      '  both lines',
      'max_turns: 1',
      'fixture:',
      '  files:',
      '    - path: index.js',
      '      content: ok',
      'expectations:',
      '  - type: trace_contains',
      '    value: ok',
    ].join('\r\n'));
    check('CRLF block scalars remain parseable for behavioral cases', crlfCase.prompt === 'preserve\nboth lines', JSON.stringify(crlfCase));

    const transcriptDir = fs.mkdtempSync(path.join(os.tmpdir(), 'evidence-triage-trace-'));
    tempPaths.push(transcriptDir);
    const runningTranscript = path.join(transcriptDir, 'running.jsonl');
    write(runningTranscript, JSON.stringify({
      type: 'tool_result',
      part: { type: 'tool', tool: 'Bash', callID: 'running-1', state: { status: 'running', input: { command: 'npm test' } } },
    }));
    check('running tool_result does not satisfy tool_completed', !grade({ expectations: [{ type: 'tool_completed', value: { command: 'npm test' } }] }, transcriptDir, runningTranscript).passed);

    const deniedEditTranscript = path.join(transcriptDir, 'denied-edit.jsonl');
    write(deniedEditTranscript, [
      { type: 'tool_use', part: { type: 'tool', tool: 'Edit', callID: 'edit-1', state: { status: 'denied', input: { file_path: 'src/index.js' } } } },
      { type: 'tool_use', part: { type: 'tool', tool: 'Bash', callID: 'test-1', state: { status: 'completed', input: { command: 'npm test' } } } },
    ].map(event => JSON.stringify(event)).join('\n'));
    check('after_edit requires an executed edit', !grade({ expectations: [{ type: 'tool_executed', value: { command: 'npm test' }, after_edit: true }] }, transcriptDir, deniedEditTranscript).passed);

    const casePath = path.join(transcriptDir, 'archive-case.yaml');
    const resultPath = path.join(transcriptDir, 'archive-result.json');
    const archiveOut = path.join(transcriptDir, 'archive-out');
    const caseText = 'id: archive-fixture\nprompt: check\nmax_turns: 1\nfixture:\n  files:\n    - path: index.js\n      content: "ok"\nexpectations:\n  - type: trace_contains\n    value: ok   \n';
    write(casePath, caseText);
    write(resultPath, JSON.stringify({ id: 'archive-fixture', outcome: 'fail', expectations: [] }));
    archiveResult(resultPath, archiveOut, casePath);
    const archivedCasePath = path.join(archiveOut, 'archive-fixture', 'case.yaml');
    const provenance = JSON.parse(fs.readFileSync(path.join(archiveOut, 'archive-fixture', 'provenance.json'), 'utf8'));
    check('archive case hash matches archived bytes', provenance.replay_snapshot.case_sha256 === sha256(fs.readFileSync(archivedCasePath)));

    const escapedOut = path.join(transcriptDir, 'escaped-out');
    write(path.join(transcriptDir, 'crafted-result.json'), JSON.stringify({ id: '../escaped-case', outcome: 'fail' }));
    check('archive rejects path-traversal result ids', (() => {
      try {
        archiveResult(path.join(transcriptDir, 'crafted-result.json'), escapedOut, casePath);
        return false;
      } catch {
        return true;
      }
    })());

    const triageOut = path.join(transcriptDir, 'triage-out');
    const rows = triage(triageOut);
    const repeated = rows.find(row => row.id === 'pressure-skip-verification');
    check('triage preserves both repeated historical result files', repeated && repeated.result.result_files && repeated.result.result_files.length === 2);
    const exactMatch = rows.find(row => row.id === 'baseline-performance');
    check('triage matches result ids exactly', exactMatch && exactMatch.result.result_files && exactMatch.result.result_files.length === 1 && exactMatch.result.result_files[0].endsWith('2026-08-27-baseline-performance.json'));

    const projectRoot = path.join(__dirname, '..');
    const historicalBaseRef = process.env.EVIDENCE_BASE_REF || 'origin/main';
    const currentRunBytes = fs.readFileSync(path.join(projectRoot, 'behavioral-evals', 'run.js'));
    const historicalRunBytes = execFileSync('git', ['show', `${historicalBaseRef}:behavioral-evals/run.js`], {
      cwd: projectRoot,
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    const expectedCurrentCodeSha = sha256(currentRunBytes);
    const expectedHistoricalCodeSha = sha256(historicalRunBytes);
    check('replay code hash matches current run.js bytes', rows.every(row => row.current_code_sha256 === expectedCurrentCodeSha));
    check('historical code hash matches the configured base ref bytes', rows.every(row => row.historical_code_sha256 === expectedHistoricalCodeSha));

    const abRow = rows.find(row => row.id === 'grill-me-adversarial');
    const abProvenance = JSON.parse(fs.readFileSync(path.join(triageOut, 'grill-me-adversarial', 'provenance.json'), 'utf8'));
    check('CI A/B replay uses the CI A/B runner', abRow && abProvenance.replay.command === 'node ci/ab-test-harness.js run --case grill-me-adversarial');

    const invalidBaseOut = path.join(transcriptDir, 'invalid-base-out');
    let invalidBaseRejected = false;
    try {
      execFileSync(process.execPath, [path.join(__dirname, '..', 'behavioral-evals', 'evidence-tool.js'), 'triage', '--out', invalidBaseOut], {
        cwd: path.join(__dirname, '..'),
        env: { ...process.env, EVIDENCE_BASE_REF: 'refs/heads/does-not-exist' },
        stdio: 'ignore'
      });
    } catch {
      invalidBaseRejected = true;
    }
    check('triage rejects an unresolvable historical base ref', invalidBaseRejected);

    const archiveOutside = path.join(transcriptDir, 'archive-outside');
    const archiveLinkOut = path.join(transcriptDir, 'archive-link-out');
    fs.mkdirSync(archiveOutside, { recursive: true });
    fs.mkdirSync(archiveLinkOut, { recursive: true });
    const archiveLink = path.join(archiveLinkOut, 'archive-fixture');
    fs.symlinkSync(archiveOutside, archiveLink, process.platform === 'win32' ? 'junction' : 'dir');
    let archiveLinkRejected = false;
    try {
      archiveResult(resultPath, archiveLinkOut, casePath);
    } catch {
      archiveLinkRejected = true;
    }
    check('archive rejects an output junction or symlink escape', archiveLinkRejected && !fs.existsSync(path.join(archiveOutside, 'case.yaml')));

    const falsePositiveTranscript = path.join(transcriptDir, 'false-positive-command.jsonl');
    write(falsePositiveTranscript, JSON.stringify({
      type: 'tool_use',
      part: { type: 'tool', tool: 'Bash', callID: 'coverage', state: { status: 'completed', input: { command: 'npm test --coverage' } } }
    }));
    check(
      'tool evidence does not treat an extended command as the exact command',
      !grade({ expectations: [{ type: 'tool_completed', value: { command: 'npm test' } }] }, transcriptDir, falsePositiveTranscript).passed
    );
  } finally {
    tempPaths.forEach(remove);
  }
  return failures;
}

const failures = runChecks();
if (failures.length) {
  failures.forEach(failure => console.error(`FAIL ${failure}`));
  process.exit(1);
}
console.log('Behavioral evidence-triage regressions passed.');
