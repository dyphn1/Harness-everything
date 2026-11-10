'use strict';

// S2b Claude origin provider (docs/doc-workflow-reconciliation.md § S2b, "Claude
// capture and origin-provider contract" and "Retained live-capture gate";
// owner decision rows 1 and 2 are reproduced verbatim there as the binding
// trust-contract). Implements the existing S2a resolveContext/resolveEvent seam
// consumed by doc-reconciliation-producer.js / doc-reconciliation-events.js.
//
// Binding properties:
// - Positive credit is disabled until qualification resolves. The production
//   path validates the qualification export next to this file and the sanitized
//   capture it names (no directory search, no size-based acceptance).
//   A process environment toggle or a self-declared capture flag can never
//   substitute for that evidence. Dependency injection of an explicitly fake
//   qualification object ({ source: 'fake-test-fixture', faked: true }) is a
//   test-only construct for mechanism tests; production passes no
//   qualification and stays gated.
// - The Claude provider accepts only Claude. OpenCode has a separate
//   fail-closed mapping and never borrows Claude's exit or reviewer rules.
// - Exit mapping (owner decision row 1): for a given `tool_use_id`, a captured
//   `PostToolUse` with `interrupted === false` and no `PostToolUseFailure`
//   arrival maps to exit 0. This is a named mapping of the host's own
//   success/failure classification, not a null→0 conversion. A
//   `PostToolUseFailure` is never credited; failure for the same invocation
//   voids the success mapping; interrupted or ambiguous outcomes are not
//   credited; missing `tool_use_id` is not credited.
// - Reviewer principal (owner decision row 2): the reviewer is the host-issued
//   `agent_id`, must differ from the author session and every executor
//   principal, must be correlated consistently with the Agent/Task result
//   surface, and a copied/replayed record cannot become a new accepted event
//   by changing its reference. Local journal forgery is not defended against;
//   host payload fields are re-validated at assessment time.

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { canonical, key, classifyShell } = require('./workflow-isolation');

const HOST_ID = 'claude-code';
const CAPTURE_RECORD_VERSION = 'claude-capture-record/1';
const OPENCODE_HOST_ID = 'opencode';
const OPENCODE_CAPTURE_RECORD_VERSION = 'opencode-capture-record/1';
const OPENCODE_CAPTURE_FILE = 'opencode-captures.jsonl';
const OPENCODE_CAPTURE_LIMIT_BYTES = 4 * 1024 * 1024;
const QUALIFICATION_EXPORT_SCHEMA = 'harness.doc-reconciliation.qualification.v1';
const HEX64 = /^[0-9a-f]{64}$/;
const PRE_CAPTURE_TOOLS = ['Bash', 'PowerShell', 'Task', 'Agent', 'Write', 'Edit', 'apply_patch'];
const STDOUT_CAP_BYTES = 1024 * 1024;
const DOC_CHECK_FLAGS = new Set(['--workspace', '--config', '--changed-path', '--base', '--derived-view']);
const DOC_CHECK_BOOLEAN_FLAGS = new Set(['--conflict-assessment']);
const DOC_CHECK_SCHEMA = 'harness.doc-check.check.v1';
const DOC_CHECK_CONFLICT_SCHEMA = 'harness.doc-check.conflict-assessment.v1';
const OUTLINE_DISPATCH_SCHEMA = 'harness.outline-dispatch.v1';
const OUTLINE_CAPTURE_MAPPING = Object.freeze({
  version: 'claude-outline-dispatch-mapping/2',
  promptField: 'tool_input.prompt',
  dispatchKey: 'session_id+tool_use_id',
  runInBackgroundField: 'tool_input.run_in_background',
  isolationPresenceField: 'tool_input.isolation',
  resultAgentIdField: 'tool_response.agentId',
  resultStatusField: 'tool_response.status',
  workerStartEvent: 'SubagentStart',
  workerStopEvent: 'SubagentStop',
  workerIdentity: 'session_id+agent_id',
  workerRootField: 'cwd',
});
const OUTLINE_SEAM_SCHEMA = 'harness.outline-dispatch-seam.v1';
const OUTLINE_HANDOFF_SCHEMA = 'harness.outline-handoff.v1';
const OUTLINE_LEASE_SCHEMA = 'harness.outline-writer-lease.v1';
const W6_STATE_OPERATION_SCHEMA = 'harness.w6-state-operation.v1';
const OUTLINE_WRITE_TOOLS = ['Write', 'Edit', 'apply_patch'];
const OUTLINE_INVENTORY_SOURCE = '/Users/daniel.chang/Desktop/Skills/Harness-everything/.worktrees/packets/adr-e1-2026-10-27/report-inv.md';
const OUTLINE_INVENTORY_SHA256 = '2741bd4514d2cd68f57d93a2b3ce94cbe597ca62d30e26f0ca58e882df5b03c6';
const OUTLINE_INVENTORY_PIN = Object.freeze({
  source: OUTLINE_INVENTORY_SOURCE,
  sha256: OUTLINE_INVENTORY_SHA256,
  runId: 'e1-inv-1',
  inputSha: '0ef0541c6cae550e8269ba712e03797e0e987dfb',
  approvalRef: { issue: 325, commentId: '6436207729', decision: 1 },
  rowDomainMappings: Object.freeze([Object.freeze({ rowIds: Object.freeze(['15', '16', '17', '18']),
    sourceDomain: 'VERI', domain: 'EVID', approvalRef: 'https://github.com/dyphn1/Harness-everything/issues/325#issuecomment-6706805112' })]),
  retainedArtifactPath: `inventory/${OUTLINE_INVENTORY_SHA256}.md`,
});
const W6_ROW17_REQUIREMENTS = Object.freeze([
  Object.freeze({ id: 'adr-evid', stepType: 'doc-change',
    summary: 'Draft the row-17 EVID-001 verification-evidence ADR.',
    acceptance: 'A real proposed O is independently reviewed before the draft D; D is a strict descendant of O and changes only the ADR.' }),
  Object.freeze({ id: 'verify-row17', stepType: 'verification',
    summary: 'Generate the governed index and verify the final ADR through one combined registered check and independent review.',
    acceptance: 'All four combined-check capabilities and the ADR-only final review are captured before normal Stop reconciliation.' }),
]);
const OUTLINE_MARKER = 'HARNESS_OUTLINE_DISPATCH_V1';
const OUTLINE_TASK_ID = /^task-[A-Za-z0-9][A-Za-z0-9+._-]{0,127}$/;
const OUTLINE_ATTEMPT_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const DOC_CHECK_SHELLS = new Set(['sh', 'bash', 'dash', 'zsh', 'ksh', 'fish']);
const DOC_CHECK_LAUNCHERS = new Set(['node', 'nodejs', 'bun', 'deno', 'tsx', 'ts-node']);
const DOC_CHECK_LAUNCHER_VALUE_FLAGS = new Set(['-r', '--require', '--import', '--loader', '--experimental-loader', '--inspect-port', '--input-type', '--conditions', '--env-file']);
const DOC_CHECK_WRAPPERS = new Set(['env', 'npx']);
const DOC_CHECK_ENV_VALUE_FLAGS = new Set(['-u', '--unset', '-C', '--chdir']);
const DOC_CHECK_NPX_VALUE_FLAGS = new Set(['-p', '--package', '--prefix', '--cache', '--userconfig', '--registry', '--workspace', '-w']);
// Backslashes are shell escapes except when a rooted Windows path token makes them separators.
function isWindowsPathToken(token) {
  return token.startsWith('\\\\') || /^[A-Za-z]:$/.test(token) || /^[A-Za-z]:\\/.test(token)
    || (process.platform === 'win32' && !token.includes('/'));
}
function isDoubleQuotedEscapeTarget(value) {
  return value === '"' || value === '\\' || value === '$' || value === '\x60';
}
function isUncPathPrefix(token, command, index) {
  return token === '' && command[index] === '\\' && command[index + 1] === '\\';
}
// Canonical SHA-256 of harness-everything/scripts/doc-check.js (CRLF normalised to LF). Re-pin deliberately when that script changes.
const SHIPPED_DOC_CHECK_DIGEST = '0e93f252b2350b145c34dcb5354aa3b4246f3c59e948a62c3a912305b355a475';
// This install's own doc-check runtime, relative to hooks/scripts/lib: the source checkout or the packaged plugin.
const DOC_CHECK_INSTALL_LAYOUTS = [
  ['..', '..', '..', 'harness-everything', 'scripts', 'doc-check.js'],
  ['..', '..', '..', 'skills', 'harness-everything', 'scripts', 'doc-check.js'],
];

// The resolved path of this install's own doc-check.js, or null when neither layout exists.
function canonicalPath(value) { return fs.realpathSync.native(path.resolve(value)); }
function installedDocCheck() {
  for (const layout of DOC_CHECK_INSTALL_LAYOUTS) {
    try { return canonicalPath(path.resolve(__dirname, ...layout)); } catch { /* try the next layout */ }
  }
  return null;
}
// Canonical doc-check digest (UTF-8, CRLF normalised to LF): capture and assessment compare the same value.
function fileDigest(file) { return crypto.createHash('sha256').update(fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n')).digest('hex'); }

// Tokenize only the shell-word subset needed for a direct node invocation. Expansion and shell control syntax are refused.
function safeTokenize(command) {
  if (typeof command !== 'string') return { ok: false, reason: 'invalid-command' };
  const tokens = [];
  let token = '';
  let active = false;
  let quote = null;
  const push = () => {
    if (active) tokens.push(token);
    token = '';
    active = false;
  };

  for (let index = 0; index < command.length; index += 1) {
    const ch = command[index];
    if (ch === '%' && /^%[^%\s]+%/.test(command.slice(index))) return { ok: false, reason: 'shell-expansion' };
    if (ch === '\\' && isUncPathPrefix(token, command, index)) {
      token += '\\\\';
      index += 1;
      active = true;
      continue;
    }
    if (quote === "'") {
      if (ch === "'") quote = null;
      else token += ch;
      continue;
    }
    if (quote === '"') {
      if (ch === '"') { quote = null; continue; }
      if (ch === '\\') {
        const next = command[index + 1];
        if (next === undefined || next === '\n' || next === '\r') return { ok: false, reason: 'shell-continuation' };
        if ([ '"', '\\', '$', '`' ].includes(next)) token += next;
        else token += `\\${next}`;
        index += 1;
        active = true;
        continue;
      }
      if (ch === '$' || ch === '`') return { ok: false, reason: 'shell-expansion' };
      token += ch;
      active = true;
      continue;
    }

    if (ch === '\n' || ch === '\r') return { ok: false, reason: 'shell-operator' };
    if (/\s/.test(ch)) { push(); continue; }
    if (ch === "'" || ch === '"') { quote = ch; active = true; continue; }
    if (ch === '\\') {
      const next = command[index + 1];
      if (next === undefined || next === '\n' || next === '\r') return { ok: false, reason: 'shell-continuation' };
      if (isWindowsPathToken(token)) token += '\\';
      else {
        token += next;
        index += 1;
      }
      active = true;
      continue;
    }
    if (';&|<>()'.includes(ch)) return { ok: false, reason: 'shell-operator' };
    if ('*?[]{}'.includes(ch) || (ch === '~' && !active) || ch === '$' || ch === '`') return { ok: false, reason: 'shell-expansion' };
    if (ch === '#' && !active) return { ok: false, reason: 'shell-comment' };
    token += ch;
    active = true;
  }
  if (quote) return { ok: false, reason: 'unclosed-quote' };
  push();
  return { ok: true, tokens };
}

function stateSnapshot(sessionDir) {
  const files = {};
  const ignored = new Set(['doc-reconciliation-capture', 'doc-reconciliation-capture.json', 'handoff-state.json']);
  function visit(directory, relative = '') {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true }).sort((a, b) => compareKeys(a.name, b.name))) {
      const rel = relative ? `${relative}/${entry.name}` : entry.name;
      if (!relative && ignored.has(entry.name)) continue;
      const full = path.join(directory, entry.name);
      const stat = fs.lstatSync(full);
      if (stat.isSymbolicLink()) files[rel] = { kind: 'symlink', digest: digestText(fs.readlinkSync(full)) };
      else if (stat.isDirectory()) { files[rel] = { kind: 'directory' }; visit(full, rel); }
      else if (stat.isFile()) {
        const bytes = fs.readFileSync(full);
        const item = { kind: 'file', digest: crypto.createHash('sha256').update(bytes).digest('hex') };
        if (['workflow-run.json', 'workflow-obligations.json', 'doc-reconciliation-pilot.json',
          'inventory-pin.json', 'handoff.json', 'writer-lease.json'].includes(path.posix.basename(rel))
          && bytes.length <= 1024 * 1024) {
          try { item.json = JSON.parse(bytes.toString('utf8')); } catch { item.jsonInvalid = true; }
        }
        if (rel.startsWith('doc-reconciliation/outline-confirmation/inventory/') && rel.endsWith('.md')) {
          item.content = bytes.toString('base64');
        }
        files[rel] = item;
      } else files[rel] = { kind: 'other' };
    }
  }
  try { visit(sessionDir); } catch { return null; }
  return files;
}

function stateGitSnapshot(root) {
  try {
    const run = args => execFileSync('git', ['-C', root, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    const head = run(['rev-parse', '--verify', 'HEAD^{commit}']).trim();
    const tree = run(['rev-parse', '--verify', 'HEAD^{tree}']).trim();
    const status = execFileSync('git', ['-C', root, 'status', '--porcelain=v1', '-z', '--untracked-files=all'], {
      encoding: null, stdio: ['ignore', 'pipe', 'pipe'],
    });
    const indexPath = run(['rev-parse', '--git-path', 'index']).trim();
    const resolvedIndex = path.resolve(root, indexPath);
    const indexDigest = fs.existsSync(resolvedIndex) ? crypto.createHash('sha256').update(fs.readFileSync(resolvedIndex)).digest('hex') : null;
    return { head, tree, statusDigest: crypto.createHash('sha256').update(status).digest('hex'), indexDigest };
  } catch { return null; }
}

function w6AttemptId(reviewRef) { return 'attempt-' + digestText(reviewRef).slice(0, 16); }

function outlineReviewCandidates(captures, inventoryPath) {
  return (Array.isArray(captures) ? captures : []).filter(item => recordOf(item) && item.event === 'SubagentStop'
    && item.agent_type === 'reviewer' && item.reviewVerdict === 'approve' && textOf(item.ref)
    && Object.prototype.hasOwnProperty.call(item.reviewedArtifactDigests || {}, inventoryPath)
    && Object.keys(item.reviewedArtifactDigests || {}).filter(relative => relative !== inventoryPath).length === 1);
}

function parseW6StateCommand(item, root, captures = []) {
  const { getSessionDir } = require('./harness-state');
  if (!recordOf(item) || !['Bash', 'PowerShell'].includes(item.tool_name) || !textOf(item.session_id)
    || textOf(item.agent_id) || !textOf(item.cwd)) return null;
  let cwd;
  try { cwd = canonicalPath(item.cwd); } catch { return null; }
  if (cwd !== canonicalPath(root)) return null;
  const parsed = safeTokenize(item.command);
  if (!parsed.ok || parsed.tokens.length < 3 || parsed.tokens[0] !== 'node') return null;
  let script;
  try { script = canonicalPath(path.resolve(cwd, parsed.tokens[1])); } catch { return null; }
  const controller = canonicalPath(path.resolve(__dirname, '..', 'workflow-disposition.js'));
  const producer = canonicalPath(path.resolve(__dirname, '..', 'w6-state-operations.js'));
  const tokens = parsed.tokens;
  let operation;
  let arguments_ = {};
  let destinations = [];
  if (script === controller && tokens[2] === 'plan' && tokens.length === 11
      && tokens[3] === '--session-id' && tokens[5] === '--strategy' && tokens[6] === 'iterative-single'
      && tokens[7] === '--requirements-json' && tokens[9] === '--evidence' && textOf(tokens[10])) {
    let requirements;
    try { requirements = JSON.parse(tokens[8]); } catch { return null; }
    if (captureJson(requirements) !== captureJson(W6_ROW17_REQUIREMENTS)) return null;
    operation = 'plan'; arguments_ = { sessionId: tokens[4], evidence: tokens[10] };
    destinations = ['workflow-run.json', 'workflow-obligations.json'];
  } else if (script === controller && tokens[2] === 'start' && tokens.length === 5
      && tokens[3] === '--session-id') {
    operation = 'start'; arguments_ = { sessionId: tokens[4] };
    destinations = ['workflow-run.json', 'workflow-obligations.json'];
  } else if (script === controller && tokens[2] === 'binding' && tokens.length === 13
      && tokens[3] === '--session-id' && tokens[5] === '--step-id' && tokens[6] === 'verify-row17'
      && tokens[7] === '--binding-id' && tokens[8] === 'verification-loop'
      && tokens[9] === '--disposition' && tokens[10] === 'loaded'
      && tokens[11] === '--evidence' && textOf(tokens[12])) {
    operation = 'binding-verify'; arguments_ = { sessionId: tokens[4], evidence: tokens[12] };
    destinations = ['workflow-obligations.json'];
  } else if (script === controller && tokens[2] === 'step' && tokens.length === 11
      && tokens[3] === '--session-id' && tokens[5] === '--step-id'
      && ['adr-evid', 'verify-row17'].includes(tokens[6])
      && tokens[7] === '--disposition' && tokens[8] === 'pass'
      && tokens[9] === '--evidence' && textOf(tokens[10])) {
    operation = tokens[6] === 'adr-evid' ? 'step-adr' : 'step-verify';
    arguments_ = { sessionId: tokens[4], stepId: tokens[6], evidence: tokens[10] };
    destinations = ['workflow-obligations.json', ...(operation === 'step-verify' ? ['doc-reconciliation-pilot.json'] : [])];
  } else if (script === producer && ['inventory', 'seal'].includes(tokens[2]) && tokens.length === 5
      && tokens[3] === '--session-id') {
    operation = tokens[2]; arguments_ = { sessionId: tokens[4] };
    if (operation === 'inventory') {
      destinations = [
        `doc-reconciliation/outline-confirmation/inventory/${path.posix.basename(OUTLINE_INVENTORY_PIN.retainedArtifactPath)}`,
        'doc-reconciliation/outline-confirmation/inventory/inventory-pin.json',
      ];
    } else {
      const inventoryPath = `doc-reconciliation/outline-confirmation/inventory/${path.posix.basename(OUTLINE_INVENTORY_PIN.retainedArtifactPath)}`;
      const reviews = outlineReviewCandidates(captures, inventoryPath);
      if (reviews.length === 1) {
        const taskId = (() => {
          try { return JSON.parse(fs.readFileSync(path.join(getSessionDir(cwd, item.session_id), 'workflow-run.json'), 'utf8')).docReconciliationTask?.taskId; }
          catch { return null; }
        })();
        if (taskId) {
          const attemptId = w6AttemptId(reviews[0].ref);
          const attemptRoot = `doc-reconciliation/outline-confirmation/${taskId}/attempts/${attemptId}`;
          destinations = [`${attemptRoot}/writer-lease.json`, `${attemptRoot}/handoff.json`];
        }
      }
    }
  } else return null;
  if (arguments_.sessionId !== item.session_id) return null;
  const sessionDir = getSessionDir(cwd, item.session_id);
  let workflow = null;
  try { workflow = JSON.parse(fs.readFileSync(path.join(sessionDir, 'workflow-run.json'), 'utf8')); } catch { /* identity stays absent */ }
  return {
    schema: W6_STATE_OPERATION_SCHEMA, operation, invocationId: item.tool_use_id || '', commandDigest: digestText(item.command),
    sessionId: item.session_id, principalId: item.session_id, workspaceRoot: cwd, cwd,
    workflowId: workflow?.workflowId || null, workflowRevision: Number.isInteger(workflow?.revision) ? workflow.revision : null,
    taskId: workflow?.docReconciliationTask?.taskId || null,
    phase: ['plan', 'start', 'inventory'].includes(operation) ? 'before-o'
      : operation === 'seal' ? 'review-to-dispatch' : 'post-final-review',
    destinations, arguments: arguments_,
  };
}

function isW6StateCommand(command, cwd, root, context = {}) {
  if (typeof cwd !== 'string' || !cwd || !textOf(context.sessionId)) return false;
  return Boolean(parseW6StateCommand({ tool_name: context.toolName || 'Bash', session_id: context.sessionId,
    agent_id: context.agentId, cwd, command }, root, []));
}

function captureW6StateOperation(payload, eventName, record, sessionDir, workspaceRoot) {
  if (!sessionDir || !workspaceRoot || !payload || !payload.tool_use_id || !payload.session_id
    || typeof payload.cwd !== 'string' || !payload.cwd) return null;
  const candidate = parseW6StateCommand({ ...record, event: eventName }, workspaceRoot, readCaptureView(sessionDir).records);
  if (!candidate) return null;
  const snapshot = stateSnapshot(sessionDir);
  const git = stateGitSnapshot(workspaceRoot);
  if (eventName === 'PreToolUse') return { ...candidate, state: 'pre', ref: record.ref, snapshot, git };
  const records = readCaptureView(sessionDir).records;
  const pres = records.filter(item => item && item.event === 'PreToolUse' && item.tool_use_id === record.tool_use_id
    && item.session_id === record.session_id && item.command === record.command && item.cwd === record.cwd
    && item.stateOperation?.schema === W6_STATE_OPERATION_SCHEMA);
  if (pres.length !== 1) return { ...candidate, state: 'unresolved', preRef: null, snapshotAfter: snapshot, gitAfter: git };
  const pre = pres[0];
  return { ...pre.stateOperation, state: 'post', preRef: pre.ref, postRef: record.ref,
    snapshotAfter: snapshot, gitAfter: git,
    hostResult: { event: eventName, interrupted: record.interrupted, exitCode: record.exitCode,
      failureDisposition: record.failureDisposition || null } };
}

function skipHereDocBodies(command, newlineIndex, hereDocs) {
  const afterLineBreak = index => command[index] === '\r' && command[index + 1] === '\n' ? index + 2 : index + 1;
  let index = afterLineBreak(newlineIndex);
  for (const { delimiter, stripTabs } of hereDocs) {
    let found = false;
    while (index <= command.length) {
      let end = index;
      while (end < command.length && command[end] !== '\n' && command[end] !== '\r') end += 1;
      let line = command.slice(index, end);
      if (stripTabs) line = line.replace(/^\t+/, '');
      if (line === delimiter) {
        index = end < command.length ? afterLineBreak(end) : end;
        found = true;
        break;
      }
      if (end === command.length) return end;
      index = afterLineBreak(end);
    }
    if (!found) return command.length;
  }
  return index;
}

function commandSegments(command) {
  const segments = [];
  let words = [];
  let token = '';
  let active = false;
  let quote = null;
  let awaitingHereDocDelimiter = null;
  const hereDocs = [];
  const pushWord = () => {
    if (active) {
      if (awaitingHereDocDelimiter) {
        hereDocs.push({ delimiter: token, stripTabs: awaitingHereDocDelimiter.stripTabs });
        awaitingHereDocDelimiter = null;
      } else words.push(token);
    }
    token = '';
    active = false;
  };
  const pushSegment = () => {
    pushWord();
    if (words.length) segments.push(words);
    words = [];
  };

  for (let index = 0; index < command.length; index += 1) {
    const ch = command[index];
    if (ch === '\\' && isUncPathPrefix(token, command, index)) {
      token += '\\\\';
      index += 1;
      active = true;
      continue;
    }
    if (quote === "'") {
      if (ch === "'") quote = null;
      else token += ch;
      continue;
    }
    if (quote === '"') {
      if (ch === '"') { quote = null; continue; }
      if (ch === '\\' && command[index + 1] !== undefined) {
        const next = command[index + 1];
        if (isDoubleQuotedEscapeTarget(next)) token += command[++index];
        else token += '\\';
        active = true;
        continue;
      }
      token += ch;
      active = true;
      continue;
    }
    if (ch === "'" || ch === '"') { quote = ch; active = true; continue; }
    if (ch === '\\' && command[index + 1] !== undefined) {
      const next = command[index + 1];
      if (next === '\r' && command[index + 2] === '\n') index += 2;
      else if (next === '\n') index += 1;
      else if (isWindowsPathToken(token)) token += '\\';
      else {
        token += next;
        index += 1;
      }
      active = true;
      continue;
    }
    // shortcut: comments are word-initial unquoted # only, no heredoc or $(...) awareness, upgrade with a real shell parser
    if (ch === '#' && !active) {
      while (index + 1 < command.length && command[index + 1] !== '\n' && command[index + 1] !== '\r') index += 1;
      continue;
    }
    if (ch === '<' && command[index + 1] === '<' && command[index + 2] !== '<') {
      pushWord();
      awaitingHereDocDelimiter = { stripTabs: command[index + 2] === '-' };
      index += awaitingHereDocDelimiter.stripTabs ? 2 : 1;
      continue;
    }
    if (ch === '\n' || ch === '\r') {
      pushWord();
      awaitingHereDocDelimiter = null;
      pushSegment();
      if (hereDocs.length) {
        index = skipHereDocBodies(command, index, hereDocs) - 1;
        hereDocs.length = 0;
      } else if (ch === '\r' && command[index + 1] === '\n') index += 1;
      continue;
    }
    if (/\s/.test(ch)) { pushWord(); continue; }
    if (';&|<>()'.includes(ch)) {
      pushWord();
      awaitingHereDocDelimiter = null;
      pushSegment();
      continue;
    }
    token += ch;
    active = true;
  }
  pushSegment();
  return segments;
}

function isDocCheckTarget(token) {
  const basename = String(token || '').split(/[\\/]/).pop().toLowerCase();
  return basename === 'doc-check' || basename === 'doc-check.js';
}

function commandAfterWrapper(words, wrapper, depth) {
  for (let index = 1; index < words.length; index += 1) {
    const word = words[index];
    if (word === '--') return { words: words.slice(index + 1) };
    if (wrapper === 'env') {
      if (DOC_CHECK_ENV_VALUE_FLAGS.has(word)) { index += 1; continue; }
      if (/^--(?:unset|chdir)=/.test(word) || /^[A-Za-z_][A-Za-z0-9_]*=/.test(word)) continue;
      if (word.startsWith('-')) continue;
      return { words: words.slice(index) };
    }
    if (DOC_CHECK_NPX_VALUE_FLAGS.has(word)) { index += 1; continue; }
    if (word === '-c' || word === '--call') return { command: words[index + 1], depth: depth + 1 };
    if (/^--(?:package|prefix|cache|userconfig|registry|workspace)=/.test(word)) continue;
    if (word.startsWith('-')) continue;
    return { words: words.slice(index) };
  }
  return null;
}

// Classify explicit command/script targets; argument data that merely mentions the checker is not a candidate.
function hasDocCheckCommandTarget(command, depth = 0) {
  if (typeof command !== 'string' || depth > 4) return false;
  function wordsTarget(words, level) {
    if (level > 4) return false;
    const executable = String(words[0] || '').split(/[\\/]/).pop().toLowerCase();
    if (isDocCheckTarget(words[0])) return true;
    if (DOC_CHECK_SHELLS.has(executable)) {
      if (isDocCheckTarget(words[1])) return true;
      const commandFlag = words.findIndex((word, index) => index > 0 && /^-[a-z]*c[a-z]*$/i.test(word));
      return commandFlag >= 0 && words[commandFlag + 1] !== undefined
        && hasDocCheckCommandTarget(words[commandFlag + 1], level + 1);
    }
    if (DOC_CHECK_WRAPPERS.has(executable)) {
      const nested = commandAfterWrapper(words, executable, level);
      if (!nested) return false;
      return nested.command !== undefined
        ? hasDocCheckCommandTarget(nested.command, nested.depth)
        : wordsTarget(nested.words, level + 1);
    }
    if (!DOC_CHECK_LAUNCHERS.has(executable)) return false;
    for (let index = 1; index < words.length; index += 1) {
      const word = words[index];
      if (word === '--') return isDocCheckTarget(words[index + 1]);
      if (DOC_CHECK_LAUNCHER_VALUE_FLAGS.has(word)) { index += 1; continue; }
      if (word.startsWith('-')) continue;
      return isDocCheckTarget(word);
    }
    return false;
  }
  return commandSegments(command).some(words => wordsTarget(words, depth));
}

// Internal realpath check; the public decision and reason tuple come only from resolveDocCheckInvocation.
function matchInstalledRuntime(tokens, cwd, installed) {
  let argv;
  try { argv = canonicalPath(path.resolve(textOf(cwd) ? cwd : process.cwd(), tokens[1])); } catch { return null; }
  return argv === installed ? { tokens, installed } : null;
}

function resolveDocCheckInvocation(command, cwd) {
  let installed = null;
  let digest = null;
  let argv = null;
  function rejected(reason) { return { kind: 'rejected', reason, installed, digest, argv }; }

  if (!hasDocCheckCommandTarget(command)) {
    return { kind: 'not-candidate', reason: 'not-doc-check', installed: null, digest: null, argv: null };
  }
  const parsed = safeTokenize(command);
  if (!parsed.ok) return rejected(parsed.reason);
  const tokens = parsed.tokens;
  argv = tokens.slice(1);
  if (tokens[0] !== 'node') return rejected('direct-launcher-required');
  if (tokens.length < 4 || path.basename(tokens[1]).toLowerCase() !== 'doc-check.js' || tokens[2] !== 'check') {
    return rejected('invocation-grammar');
  }

  const values = new Map();
  const changedPaths = [];
  let conflictAssessment = false;
  for (let index = 3; index < tokens.length;) {
    const flag = tokens[index++];
    if (DOC_CHECK_BOOLEAN_FLAGS.has(flag)) {
      if (conflictAssessment) return rejected('duplicate-flag');
      conflictAssessment = true;
      continue;
    }
    if (!DOC_CHECK_FLAGS.has(flag)) return rejected('unknown-flag');
    const value = tokens[index++];
    if (value === undefined || !value || value.startsWith('--')) return rejected('flag-value-missing');
    if (flag === '--changed-path') changedPaths.push(value);
    else {
      if (values.has(flag)) return rejected('duplicate-flag');
      if (flag === '--derived-view' && (path.isAbsolute(value) || /^[A-Za-z]:[\\/]/.test(value)
        || value.split(/[\\/]/).includes('..') || /[*?\[\]{}]/.test(value))) return rejected('derived-view-invalid');
      values.set(flag, value);
    }
  }
  if (!values.has('--workspace') || !values.has('--config') || !changedPaths.length) {
    return rejected('required-flag-missing');
  }
  if (conflictAssessment && !values.has('--base')) return rejected('conflict-assessment-base-required');
  if (conflictAssessment && !/^[0-9a-f]{40,64}$/.test(values.get('--base'))) return rejected('conflict-assessment-base-unpinned');

  installed = installedDocCheck();
  if (!installed) return rejected('implementation-not-installed');
  const registered = matchInstalledRuntime(tokens, cwd, installed);
  if (!registered) return rejected('implementation-not-installed');
  digest = fileDigest(registered.installed);
  if (registered) {
    if (registered.installed) {
      if (fileDigest(registered.installed) !== SHIPPED_DOC_CHECK_DIGEST) return rejected('implementation-pin-mismatch', 'the installed doc-check is not the shipped script (canonical digest differs from SHIPPED_DOC_CHECK_DIGEST); no credit');
    }
  }
  return { kind: 'accepted', reason: null, installed: registered.installed, digest, argv,
    conflictAssessment, base: values.get('--base') || null, config: values.get('--config'),
    derivedView: values.get('--derived-view') || null, changedPaths };
}

// Observation-time digests of the checked paths, read from the workspace when the check ran. Absent paths are omitted.
function observedDigestsFor(root, paths) {
  const digests = {};
  for (const relative of paths) {
    if (typeof relative !== 'string' || path.isAbsolute(relative) || relative.split(/[\\/]/).includes('..')) continue;
    try { digests[relative] = crypto.createHash('sha256').update(fs.readFileSync(path.join(root, relative))).digest('hex'); }
    catch { /* absent: the event will lack this digest and be rejected by the checker */ }
  }
  return digests;
}

function observedConfigSourcesFor(root, sources) {
  if (!Array.isArray(sources)) return [];
  return sources.map(source => {
    const relative = source && source.path;
    if (typeof relative !== 'string' || !relative || path.isAbsolute(relative) || relative.split(/[\\/]/).includes('..')) {
      return { path: String(relative || ''), presence: 'unsupported' };
    }
    const file = path.resolve(root, relative);
    const within = path.relative(path.resolve(root), file);
    if (!within || within === '..' || within.startsWith(`..${path.sep}`) || path.isAbsolute(within)) {
      return { path: relative, presence: 'unsupported' };
    }
    try {
      if (!fs.lstatSync(file).isFile()) return { path: relative, presence: 'unsupported' };
      return { path: relative, presence: 'present', digest: crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex') };
    } catch (error) {
      return error.code === 'ENOENT' || error.code === 'ENOTDIR'
        ? { path: relative, presence: 'missing' }
        : { path: relative, presence: 'unreadable' };
    }
  });
}

function textOf(value) { return typeof value === 'string' && value.trim().length > 0; }
function recordOf(value) { return value !== null && typeof value === 'object' && !Array.isArray(value); }
function compareKeys(a, b) { return a < b ? -1 : a > b ? 1 : 0; }
// Canonical capture serialization (sorted keys recursively, array order kept,
// missing/undefined values serialized as the literal `undefined` token). The
// capture journal and this provider must agree on this exact form so recorded
// digests bind the same bytes on both sides.
function canonicalCapture(value) {
  if (Array.isArray(value)) return value.map(canonicalCapture);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort(compareKeys).map(key => [key, canonicalCapture(value[key])]));
  }
  return value;
}
function captureJson(value) {
  const serialized = JSON.stringify(canonicalCapture(value));
  return serialized === undefined ? 'undefined' : serialized;
}
function captureDigest(value) {
  return crypto.createHash('sha256').update(captureJson(value)).digest('hex');
}
function digestText(value) { return crypto.createHash('sha256').update(String(value)).digest('hex'); }
function diagnostic(code, detail) {
  return { code, message: code.replace(/-/g, ' '), ...(recordOf(detail) ? detail : {}) };
}
function failDiagnostics(prefix, reason) {
  return [diagnostic(prefix, { reason: `${prefix}: ${reason}` })];
}

// ---- Retained live-capture gate -------------------------------------------------

// Canonical qualification export (A3 section 4): written by the live-capture packet, copied by plugin sync.
const EXPORT_FILE = 'doc-reconciliation-qualification.json';

// Structured verdict: a labelled line `Review verdict: approve|reject`, with the summary on that line or after it.
// Free text such as `REJECT: ...` carries no verdict, so it can never approve. The reviewed artifacts are named by
// `Reviewed artifact: <relative path> sha256:<64 hex>` lines; they bind the review to exact path digests (F6).
const REVIEWED_ARTIFACT_LINE = /^\s*-?\s*Reviewed artifact:\s*(\S+)\s+sha256:([0-9a-f]{64})\s*$/i;
function parseReviewVerdict(message) {
  if (typeof message !== 'string') return null;
  const match = /^\s*Review verdict:\s*(approve|reject)\b[.:]?\s*(.*)$/im.exec(message);
  if (!match) return null;
  const reviewedArtifactDigests = {};
  const summary = [match[2], message.slice(match.index + match[0].length)].join('\n').split(/\r?\n/)
    .filter(line => {
      const reviewed = REVIEWED_ARTIFACT_LINE.exec(line);
      if (reviewed) reviewedArtifactDigests[reviewed[1]] = reviewed[2].toLowerCase();
      return !reviewed;
    }).join('\n').trim();
  return { verdict: match[1].toLowerCase(), summary, reviewedArtifactDigests };
}

// Conservative trust gate (owner decision 3, A10 §1). The narrow candidate scanner only selects doc refs; trust asks more.
// A command is risky when strict safeTokenize refuses it (newline, heredoc, `$()`, operators, malformed quoting) or when it
// names the checker, raw or decoded. Risky commands get no generic verification and no reviewer independence. The check is
// conservative on purpose: it is not a shell parser, and non-string input is not shell text.
// shortcut: benign compounds such as `npm test && echo ok` lose generic credit, upgrade with a real shell parser.
function trustRisk(command) {
  const text = typeof command === 'string' ? command : '';
  if (/doc-check/i.test(text)) return true;
  if (commandSegments(text).some(words => words.some(word => /doc-check/i.test(word)))) return true;
  // A Windows relative path and a POSIX escape can look the same; fail closed on either command spelling.
  const posixDecoded = text.replace(/\\([^\r\n])/g, '$1');
  if (posixDecoded !== text && hasDocCheckCommandTarget(posixDecoded)) return true;
  const parsed = safeTokenize(text);
  return !parsed.ok || parsed.tokens.some(word => /doc-check/i.test(word));
}

// Executor principals of this task (owner #325, 2026-10-21: the reviewer "must differ from the author's `session_id` and
// from every executor principal"; an executor principal is the principal of execution evidence used in this assessment).
// The author session is always an executor. Other executors are the principals of a registered doc-check run, the only
// execution evidence a doc obligation uses, and of any risky shell command (trustRisk), which could have run the checker.
// Acceptance is not required, so the set over-approximates and fails closed: a reviewer whose registered run was refused
// still counts as an executor. Plain read-only tool use, such as `git status`, does not make a reviewer an executor.
// The Agent/Task launch surface is never execution evidence.
function journalExecutors(captures, author) {
  const executors = new Set(textOf(author) ? [author] : []);
  for (const item of Array.isArray(captures) ? captures : []) {
    if (!recordOf(item) || item.event !== 'PostToolUse') continue;
    if (item.tool_name === 'Agent' || item.tool_name === 'Task') continue;
    if (resolveDocCheckInvocation(item.command, item.cwd).kind === 'not-candidate' && !trustRisk(item.command)) continue;
    if (textOf(item.session_id)) executors.add(item.session_id);
    if (textOf(item.agent_id)) executors.add(item.agent_id);
  }
  return [...executors].sort(compareKeys);
}

// The Agent/Task result surface that names this reviewer: a PostToolUse of the launch tool whose agent_id is the reviewer.
function agentResultSurface(captures, reviewer) {
  return (Array.isArray(captures) ? captures : []).some(item => recordOf(item) && item.event === 'PostToolUse'
    && (item.tool_name === 'Agent' || item.tool_name === 'Task') && item.agent_id === reviewer);
}

// A reviewed path must be a relative governed path; its digest must be a sha256 of the observed bytes.
function reviewedDigestsValid(digests) {
  return recordOf(digests) && Object.keys(digests).length > 0
    && Object.entries(digests).every(([relative, digest]) => textOf(relative) && !path.isAbsolute(relative)
      && !relative.split(/[\\/]/).includes('..') && HEX64.test(String(digest)));
}

// What the sanitized capture proves: the payload kinds with their fields, and the correlation rules it demonstrates.
// The export must claim exactly these; a claim the capture does not support fails qualification.
const QUALIFICATION_FIELDS = ['tool_use_id', 'interrupted', 'agent_id', 'agent_type', 'session_id'];

function observedPayloadKinds(records) {
  const kinds = {};
  for (const record of records) {
    if (!recordOf(record) || !textOf(record.event)) continue;
    const fields = kinds[record.event] || (kinds[record.event] = new Set());
    for (const field of QUALIFICATION_FIELDS) if (record[field] !== undefined) fields.add(field);
  }
  return Object.fromEntries(Object.keys(kinds).sort(compareKeys).map(kind => [kind, [...kinds[kind]].sort(compareKeys)]));
}

function observedCorrelation(records) {
  const pre = new Set(records.filter(item => recordOf(item) && item.event === 'PreToolUse' && textOf(item.tool_use_id)).map(item => item.tool_use_id));
  const post = records.filter(item => recordOf(item) && item.event === 'PostToolUse' && textOf(item.tool_use_id));
  const starts = records.filter(item => recordOf(item) && item.event === 'SubagentStart');
  const stops = records.filter(item => recordOf(item) && item.event === 'SubagentStop');
  return {
    preToPostByToolUseId: post.some(item => pre.has(item.tool_use_id)),
    interruptedExplicit: post.some(item => typeof item.interrupted === 'boolean'),
    subagentStartStopSameAgent: stops.some(stop => starts.some(start => textOf(stop.agent_id) && start.agent_id === stop.agent_id)),
    agentResultAliasCorrelated: records.some(item => recordOf(item) && item.event === 'PostToolUse' && textOf(item.agent_id)
      && stops.some(stop => stop.agent_id === item.agent_id)),
  };
}

// Validates the qualification export against the sanitized capture it names: schema, host, capture-record version, the
// capture's digest, and every claimed kind, field and correlation. Returns null when valid, else the reason.
function validateQualificationExport(expectedHost = HOST_ID) {
  const exported = JSON.parse(fs.readFileSync(path.join(__dirname, EXPORT_FILE), 'utf8'));
  if (!recordOf(exported) || exported.schema !== QUALIFICATION_EXPORT_SCHEMA) return 'qualification export schema is not recognized';
  if (!textOf(exported.hostVersion)) return 'qualification export host or host version is missing';
  if (exported.host !== expectedHost) {
    if (expectedHost === HOST_ID) return 'qualification export host or host version is missing';
    return 'qualification export host does not match the selected provider';
  }
  if (exported.captureRecordVersion !== CAPTURE_RECORD_VERSION) return 'qualification export capture record version is not supported';
  const source = recordOf(exported.sanitizedCapture) ? exported.sanitizedCapture : {};
  // The sanitized capture is a sibling of the export, so source and packaged copies resolve it the same way.
  if (!textOf(source.file) || /[\\/]/.test(source.file) || source.file.includes('..')) {
    return 'qualification export names no valid capture file';
  }
  const bytes = fs.readFileSync(path.join(__dirname, source.file));
  if (crypto.createHash('sha256').update(bytes).digest('hex') !== source.sha256) {
    return 'sanitized capture digest does not match the qualification export';
  }
  const records = bytes.toString('utf8').split(/\r?\n/).filter(line => line.trim()).map(line => JSON.parse(line));
  if (!records.every(recordOf)) return 'sanitized capture contains a record that is not an object';
  if (captureJson(exported.payloadKinds) !== captureJson(observedPayloadKinds(records))) {
    return 'qualification export payload kinds do not match the sanitized capture';
  }
  const correlation = observedCorrelation(records);
  if (captureJson(exported.correlation) !== captureJson(correlation)) return 'qualification export correlation does not match the sanitized capture';
  if (!Object.values(correlation).every(Boolean)) return 'required correlation rules are not observed in the sanitized capture';
  return null;
}

function evaluateQualification(input, expectedHost = HOST_ID) {
  if (recordOf(input) && input.qualification !== undefined && input.qualification !== null) {
    const supplied = input.qualification;
    // Test-only DI path: an explicitly fake qualification object. Anything else
    // supplied is unrecognized qualification evidence and cannot open the gate.
    if (recordOf(supplied) && supplied.faked === true && supplied.source === 'fake-test-fixture'
      && supplied.toolUseIdPopulated === true && supplied.agentIdPopulated === true) {
      return { open: true, source: 'dependency-injection' };
    }
    return {
      open: false,
      fail: diagnostic('live-gate-unmet', {
        reason: 'live gate unmet: supplied qualification evidence is malformed or unrecognized; positive credit requires verified retained evidence or an explicitly fake test DI object',
      }),
    };
  }
  // Production path: no qualification is supplied, so the validated qualification export is the only source. It is checked
  // against the sanitized capture it names. Nothing is read from the environment, capture flags or ancestor directories.
  let reason = null;
  try {
    reason = validateQualificationExport(expectedHost);
  } catch (error) {
    reason = `qualification evidence could not be read (${error.code || 'error'})`;
  }
  if (reason) {
    return {
      open: false,
      fail: diagnostic('live-gate-unmet', { reason: `live gate unmet: ${reason}` }),
    };
  }
  return { open: true, source: 'validated-export' };
}

function outlineSha(value) { return crypto.createHash('sha256').update(value).digest('hex'); }

function parseOutlineDispatchPrompt(prompt) {
  if (typeof prompt !== 'string') return null;
  const occurrences = prompt.match(new RegExp(OUTLINE_MARKER, 'g')) || [];
  if (occurrences.length !== 1) return null;
  const line = prompt.split(/\r?\n/).find(item => item.includes(OUTLINE_MARKER));
  const match = /^(HARNESS_OUTLINE_DISPATCH_V1) taskId=([^\s]+) attemptId=([^\s]+) token=([^\s]+) workerRoot=(.+)$/.exec(line || '');
  if (!match || !OUTLINE_TASK_ID.test(match[2]) || !OUTLINE_ATTEMPT_ID.test(match[3])
    || !textOf(match[4]) || !path.isAbsolute(match[5]) || match[5].trim() !== match[5]) return null;
  const block = match[0];
  const tokenDigest = outlineSha(match[4]);
  const promptDigest = outlineSha(Buffer.from(prompt, 'utf8'));
  return {
    taskId: match[2], attemptId: match[3], token: match[4], tokenDigest,
    workerRoot: match[5], blockDigest: outlineSha(Buffer.from(block, 'utf8')),
    promptDigest,
    dispatchInputDigest: outlineSha(captureJson({ taskId: match[2], attemptId: match[3], tokenDigest,
      workerRoot: match[5], promptDigest })),
  };
}

function parseInventoryPinRows(bytes) {
  const text = Buffer.isBuffer(bytes) ? bytes.toString('utf8') : String(bytes || '');
  const identity = /run id `([^`]+)`[^\n]*input SHA `([a-f0-9]+)`/i.exec(text);
  if (!identity) return { state: 'unresolved', reason: 'inventory-identity-missing' };
  const lines = text.split(/\r?\n/);
  const mechanismIndex = lines.findIndex(line => /Mechanism inventory/i.test(line));
  const areaIndex = lines.findIndex(line => /Area grouping \+ candidate domain prefixes/i.test(line));
  if (mechanismIndex < 0 || areaIndex < 0 || areaIndex <= mechanismIndex) return { state: 'unresolved', reason: 'inventory-tables-missing' };
  const rows = new Map();
  for (const line of lines.slice(mechanismIndex, areaIndex)) {
    const match = /^\|\s*(\d{1,2})\s*\|/.exec(line);
    if (!match) continue;
    rows.set(match[1], (rows.get(match[1]) || 0) + 1);
  }
  const domains = new Map();
  for (const line of lines.slice(areaIndex)) {
    const cells = line.split('|').map(cell => cell.trim());
    if (cells.length < 5 || !cells[1] || !cells[2] || !cells[3]) continue;
    const prefix = /^`([A-Z][A-Z0-9]{1,9})`$/.exec(cells[3]);
    if (!prefix) continue;
    for (const item of cells[2].split(',')) {
      const range = /^(\d{1,2})\s*[–-]\s*(\d{1,2})$/.exec(item.trim());
      if (range) {
        for (let id = Number(range[1]); id <= Number(range[2]); id += 1) {
          const key = String(id).padStart(2, '0');
          const entries = domains.get(key) || [];
          entries.push(prefix[1]);
          domains.set(key, entries);
        }
      } else if (/^\d{1,2}$/.test(item.trim())) {
        const key = item.trim().padStart(2, '0');
        const entries = domains.get(key) || [];
        entries.push(prefix[1]);
        domains.set(key, entries);
      }
    }
  }
  return { state: 'parsed', runId: identity[1], inputSha: identity[2], rows, domains };
}

function validateOutlineInventoryPin({ bytes, pin, expectedPin = OUTLINE_INVENTORY_PIN } = {}) {
  if (!Buffer.isBuffer(bytes) || !recordOf(pin) || !recordOf(expectedPin)) return { state: 'unresolved', reason: 'inventory-unavailable' };
  const fields = ['source', 'sha256', 'runId', 'inputSha', 'approvalRef', 'rowDomainMappings', 'retainedArtifactPath'];
  const actualPin = Object.fromEntries(fields.map(field => [field, pin[field]]));
  const trustedPin = Object.fromEntries(fields.map(field => [field, expectedPin[field]]));
  if (captureJson(actualPin) !== captureJson(trustedPin)) return { state: 'unresolved', reason: 'inventory-pin-mismatch' };
  const digest = outlineSha(bytes);
  if (digest !== expectedPin.sha256 || expectedPin.retainedArtifactPath !== `inventory/${expectedPin.sha256}.md`) {
    return { state: 'unresolved', reason: 'inventory-digest-mismatch' };
  }
  const parsed = parseInventoryPinRows(bytes);
  if (parsed.state !== 'parsed' || parsed.runId !== expectedPin.runId || parsed.inputSha !== expectedPin.inputSha) {
    return { state: 'unresolved', reason: parsed.reason || 'inventory-revision-mismatch' };
  }
  return { state: 'accepted', pin: trustedPin, pinDigest: outlineSha(Buffer.from(captureJson(trustedPin))),
    artifactDigest: digest, parsed };
}

function resolveInventoryRow(inventory, rowId) {
  const parsed = inventory && inventory.parsed;
  if (!parsed || parsed.state !== 'parsed' || !textOf(rowId)) return { state: 'unresolved', reason: 'inventory-row-missing' };
  const matches = [...parsed.rows.entries()].filter(([id]) => id === rowId);
  const domains = parsed.domains.get(rowId) || [];
  if (matches.length !== 1 || matches[0][1] !== 1) {
    return { state: 'unresolved', reason: 'inventory-row-ambiguous' };
  }
  const mappings = (Array.isArray(inventory.pin?.rowDomainMappings) ? inventory.pin.rowDomainMappings : [])
    .filter(item => recordOf(item) && Array.isArray(item.rowIds) && item.rowIds.includes(rowId));
  if (mappings.length > 1) return { state: 'unresolved', reason: 'inventory-row-ambiguous' };
  const mapping = mappings[0];
  if (mapping && (!domains.includes(mapping.sourceDomain) || !textOf(mapping.domain) || !textOf(mapping.approvalRef))) {
    return { state: 'unresolved', reason: 'inventory-row-mapping-invalid' };
  }
  if (!mapping && domains.length !== 1) return { state: 'unresolved', reason: 'inventory-row-ambiguous' };
  return { state: 'accepted', row: { rowId, domain: mapping ? mapping.domain : domains[0] } };
}

function hasSubstantiveDecision(text) {
  const lines = String(text || '').split(/\r?\n/);
  let decisionLines = null;
  const substantive = linesToCheck => linesToCheck.some(line => {
    const value = line.trim().replace(/^[-*]\s*/, '');
    return value && !/^<!--|^-->$|^\[[^\]]*\]$|^<[^>]+>$|^TBD$|^TODO$/i.test(value);
  });
  for (const line of lines) {
    const heading = /^ {0,3}##\s+(.+?)\s*#*\s*$/.exec(line);
    const headingText = heading?.[1]?.trim() || '';
    if (/^Decision\b/i.test(headingText)) {
      if (decisionLines && substantive(decisionLines)) return true;
      decisionLines = [];
      continue;
    }
    if (decisionLines && heading) {
      if (substantive(decisionLines)) return true;
      decisionLines = null;
      continue;
    }
    if (decisionLines) decisionLines.push(line);
  }
  return Boolean(decisionLines && substantive(decisionLines));
}

function parseOutlineCitation(bytes, targetPath) {
  const text = Buffer.isBuffer(bytes) ? bytes.toString('utf8') : String(bytes || '');
  const frontmatter = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(text);
  if (!frontmatter) return { state: 'unresolved', reason: 'outline-frontmatter-missing' };
  const field = name => new RegExp(`^${name}:\\s*([^\\r\\n]+)\\s*$`, 'm').exec(frontmatter[1])?.[1]?.trim() || '';
  const id = field('id');
  const status = field('status');
  const rowMatches = [...text.matchAll(/^Inventory row:\s*([0-9]{1,2})\s*$/gmi)];
  const targetMatches = [...text.matchAll(/^Target:\s*(\S+)\s*$/gmi)];
  const domainMatches = [...text.matchAll(/^Domain:\s*([A-Z][A-Z0-9]{1,9})\s*$/gmi)];
  if (!/^([A-Z][A-Z0-9]{1,9})-\d{3,}$/.test(id) || status !== 'proposed'
    || rowMatches.length !== 1 || targetMatches.length !== 1 || domainMatches.length !== 1
    || targetMatches[0][1] !== targetPath) return { state: 'unresolved', reason: 'outline-citation-invalid' };
  if (hasSubstantiveDecision(text)) return { state: 'unresolved', reason: 'outline-already-draft' };
  return { state: 'accepted', id, status, rowId: rowMatches[0][1], targetPath,
    domain: domainMatches[0][1], bytesDigest: outlineSha(Buffer.from(text, 'utf8')) };
}

function outlineGit(root, args, binary = false) {
  try {
    const env = { ...process.env };
    for (const key of Object.keys(env)) if (key.startsWith('GIT_')) delete env[key];
    return execFileSync('git', ['-C', root, ...args], { env, encoding: binary ? null : 'utf8',
      timeout: 10000, maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] });
  } catch (error) {
    throw new Error('outline-git-unavailable', { cause: error });
  }
}

function canonicalOutlineRoot(value) {
  if (typeof value !== 'string' || !path.isAbsolute(value)) throw new Error('outline-root-invalid');
  try { fs.statSync(value); } catch { throw new Error('outline-root-not-canonical'); }
  return canonical(value);
}

function outlineWorkspaceId(root) { return 'ws-' + digestText(captureJson({ workspaceRoot: canonical(root) })); }

function readOutlineJson(file) {
  try {
    const bytes = fs.readFileSync(file);
    const value = JSON.parse(bytes.toString('utf8'));
    if (!recordOf(value)) return { state: 'unresolved', reason: 'outline-record-invalid' };
    return { state: 'accepted', value, bytes, digest: outlineSha(bytes) };
  } catch {
    return { state: 'unresolved', reason: 'outline-record-unavailable' };
  }
}

function outlineTaskState(sessionDir) {
  const workflowFile = path.join(sessionDir, 'workflow-run.json');
  const loaded = readOutlineJson(workflowFile);
  if (loaded.state !== 'accepted') return { state: 'unresolved', reason: 'workflow-pin-unavailable' };
  const workflow = loaded.value;
  const taskBinding = workflow.docReconciliationTask;
  const baseline = workflow.docReconciliationBaseline;
  if (!recordOf(taskBinding) || !OUTLINE_TASK_ID.test(String(taskBinding.taskId || ''))
    || !Array.isArray(taskBinding.requirementIds) || !taskBinding.requirementIds.length
    || !HEX64.test(String(taskBinding.requirementDigest || ''))
    || !recordOf(baseline) || !textOf(baseline.root) || !/^[0-9a-f]{40,64}$/.test(String(baseline.commit || ''))
    || outlineSha(Buffer.from(captureJson(taskBinding.requirementIds))) !== taskBinding.requirementDigest
    || taskBinding.taskId !== `task-${taskBinding.requirementIds.join('+')}`
    || taskBinding.baselineCommit !== baseline.commit || !sameCanonicalPath(taskBinding.baselineRoot, baseline.root)
    || taskBinding.workflowId !== workflow.workflowId || taskBinding.workspaceId !== outlineWorkspaceId(baseline.root)) {
    return { state: 'unresolved', reason: 'workflow-task-binding-invalid' };
  }
  return { state: 'accepted', workflow, taskBinding, baseline };
}

function resolveOutlineAttempt({ sessionDir, taskId, attemptId } = {}) {
  if (!textOf(sessionDir) || !OUTLINE_TASK_ID.test(String(taskId || '')) || !OUTLINE_ATTEMPT_ID.test(String(attemptId || ''))) {
    return { state: 'unresolved', reason: 'attempt-identity-invalid' };
  }
  const taskState = outlineTaskState(sessionDir);
  if (taskState.state !== 'accepted' || taskState.taskBinding.taskId !== taskId) {
    return { state: 'unresolved', reason: taskState.reason || 'task-binding-mismatch' };
  }
  const attemptsRoot = path.join(sessionDir, 'doc-reconciliation', 'outline-confirmation', taskId, 'attempts');
  let names;
  try { names = fs.readdirSync(attemptsRoot, { withFileTypes: true }).filter(item => item.isDirectory()).map(item => item.name).sort(compareKeys); }
  catch { return { state: 'unresolved', reason: 'attempt-chain-unavailable' }; }
  if (!names.length) return { state: 'unresolved', reason: 'attempt-chain-empty' };
  const attempts = new Map();
  for (const name of names) {
    if (!OUTLINE_ATTEMPT_ID.test(name)) return { state: 'unresolved', reason: 'attempt-id-invalid' };
    const loaded = readOutlineJson(path.join(attemptsRoot, name, 'handoff.json'));
    if (loaded.state !== 'accepted') return { state: 'unresolved', reason: 'handoff-unavailable' };
    const handoff = loaded.value;
    if (handoff.schema !== OUTLINE_HANDOFF_SCHEMA || handoff.taskId !== taskId || handoff.attemptId !== name
      || !textOf(handoff.handoffId) || !textOf(handoff.draftDispatchToken)
      || !recordOf(handoff.baseline) || handoff.baseline.commit !== taskState.baseline.commit
      || !sameCanonicalPath(handoff.baseline.root, taskState.baseline.root)
      || handoff.configDigest !== taskState.taskBinding.configDigest) {
      return { state: 'unresolved', reason: 'handoff-identity-or-baseline-mismatch' };
    }
    const attemptDir = path.join(attemptsRoot, name);
    const seamDir = path.join(attemptDir, 'seams');
    const tokenDir = path.join(attemptDir, 'tokens');
    const filesIn = dir => {
      try { return fs.readdirSync(dir, { withFileTypes: true })
        .filter(entry => entry.isFile() && entry.name.endsWith('.json')).map(entry => path.join(dir, entry.name)); }
      catch { return []; }
    };
    const seamFiles = filesIn(seamDir);
    const tokenFiles = filesIn(tokenDir);
    const evidenceFiles = [...seamFiles, ...tokenFiles];
    const sealLoaded = readOutlineJson(path.join(attemptDir, 'handoff-seal.json'));
    const sealExists = fs.existsSync(path.join(attemptDir, 'handoff-seal.json'));
    if (sealExists && (sealLoaded.state !== 'accepted' || sealLoaded.value.schema !== 'harness.outline-handoff-seal.v1'
      || sealLoaded.value.taskId !== taskId || sealLoaded.value.attemptId !== name
      || sealLoaded.value.handoffDigest !== loaded.digest)) {
      return { state: 'unresolved', reason: 'handoff-overwritten-after-dispatch' };
    }
    if (evidenceFiles.length && !sealExists) {
      return { state: 'unresolved', reason: 'handoff-overwritten-after-dispatch' };
    }
    for (const evidenceFile of evidenceFiles) {
      const evidenceLoaded = readOutlineJson(evidenceFile);
      if (evidenceLoaded.state !== 'accepted' || evidenceLoaded.value.taskId !== taskId
        || evidenceLoaded.value.attemptId !== name || evidenceLoaded.value.handoffDigest !== loaded.digest) {
        return { state: 'unresolved', reason: 'handoff-overwritten-after-dispatch' };
      }
    }
    let interrupted = false;
    if (sealExists && (tokenFiles.length !== 1 || seamFiles.length !== 1)) interrupted = true;
    if (sealExists && tokenFiles.length === 1 && seamFiles.length === 1) {
      const token = readOutlineJson(tokenFiles[0]).value;
      const seam = readOutlineJson(seamFiles[0]).value;
      if (token.schema !== 'harness.outline-token.v1' || seam.schema !== OUTLINE_SEAM_SCHEMA
        || token.tokenDigest !== seam.tokenDigest || token.toolUseId !== seam.toolUseId
        || token.dispatchInputDigest !== seam.dispatchInputDigest) {
        return { state: 'unresolved', reason: 'handoff-dispatch-evidence-mismatch' };
      }
    }
    attempts.set(name, { handoff, handoffDigest: loaded.digest, attemptDir, interrupted });
  }
  const parents = new Map();
  const children = new Map(names.map(name => [name, 0]));
  const tokens = new Set();
  for (const [name, item] of attempts) {
    const { handoff } = item;
    if (tokens.has(handoff.draftDispatchToken)) return { state: 'unresolved', reason: 'attempt-token-reused' };
    tokens.add(handoff.draftDispatchToken);
    const parent = handoff.supersedesAttemptId;
    if (parent === null || parent === undefined) { parents.set(name, null); continue; }
    if (!attempts.has(parent) || parent === name || children.get(parent) === undefined) {
      return { state: 'unresolved', reason: 'attempt-predecessor-missing' };
    }
    children.set(parent, children.get(parent) + 1);
    if (children.get(parent) > 1) return { state: 'unresolved', reason: 'attempt-chain-ambiguous' };
    parents.set(name, parent);
  }
  const roots = [...parents.values()].filter(parent => parent === null).length;
  if (roots !== 1) return { state: 'unresolved', reason: 'attempt-chain-ambiguous' };
  for (const name of names) {
    const seen = new Set();
    let current = name;
    while (current !== null) {
      if (seen.has(current)) return { state: 'unresolved', reason: 'attempt-chain-cyclic' };
      seen.add(current);
      current = parents.get(current);
      if (current === undefined) return { state: 'unresolved', reason: 'attempt-predecessor-missing' };
    }
  }
  const leaves = names.filter(name => children.get(name) === 0);
  if (leaves.length !== 1) return { state: 'unresolved', reason: 'attempt-chain-ambiguous' };
  if (leaves[0] !== attemptId) return { state: 'unresolved', reason: 'attempt-superseded' };
  const currentAttempt = attempts.get(attemptId);
  if (currentAttempt.interrupted) return { state: 'unresolved', reason: 'attempt-interrupted' };
  return { state: 'accepted', taskBinding: taskState.taskBinding, baseline: taskState.baseline,
    handoff: currentAttempt.handoff, handoffDigest: currentAttempt.handoffDigest,
    attemptDir: currentAttempt.attemptDir, predecessors: [...parents.keys()].filter(id => id !== attemptId) };
}

function outlineHandoffDirectory(sessionDir, taskId) {
  return path.join(sessionDir, 'doc-reconciliation', 'outline-confirmation', taskId);
}

// #341 step 1: Harness records O's identity at each SubagentStart inside an outline task. A reviewer's launch record predates
// its review, so the identity it carries is the O the reviewer evaluated; the record is not taken from the reviewer's prose.
function captureOutlineStartIdentity({ sessionDir } = {}) {
  const taskState = outlineTaskState(sessionDir);
  if (taskState.state !== 'accepted') return null;
  const root = taskState.baseline.root;
  try {
    const commit = outlineGit(root, ['rev-parse', '--verify', 'HEAD^{commit}']).trim();
    const tree = outlineGit(root, ['rev-parse', '--verify', 'HEAD^{tree}']).trim();
    const targetPaths = outlineGit(root, ['diff', '--name-only', '--no-renames', '-z', taskState.baseline.commit, commit])
      .split('\0').filter(Boolean).sort(compareKeys);
    const targetBlobs = {};
    for (const target of targetPaths) {
      targetBlobs[target] = { blobOid: outlineGit(root, ['rev-parse', `${commit}:${target}`]).trim(),
        storedBytesSha256: outlineSha(outlineGit(root, ['show', `${commit}:${target}`], true)) };
    }
    return { state: 'accepted', identity: { baselineCommit: taskState.baseline.commit, outlineCommit: commit,
      outlineTree: tree, targetPaths, targetBlobs } };
  } catch {
    return { state: 'unresolved', reason: 'outline-identity-unavailable' };
  }
}

// The reviewer has exactly one launch record, it precedes the review Stop, and its identity equals the handoff's O identity.
function validateOutlineIdentity({ handoff, captures } = {}) {
  const refs = (Array.isArray(captures) ? captures : []).filter(recordOf);
  const stop = refs.find(item => item.ref === handoff.reviewCaptureRef && item.event === 'SubagentStop');
  if (!stop || !textOf(stop.agent_id)) return { state: 'unresolved', reason: 'outline-review-capture-missing-or-ambiguous' };
  const starts = refs.filter(item => item.event === 'SubagentStart' && item.agent_id === stop.agent_id);
  if (starts.length !== 1) return { state: 'unresolved', reason: 'outline-review-result-missing-or-ambiguous' };
  if (refs.indexOf(starts[0]) > refs.indexOf(stop)) return { state: 'unresolved', reason: 'outline-identity-mismatch' };
  const recorded = starts[0].outlineIdentity;
  if (!recordOf(recorded) || recorded.state !== 'accepted' || !recordOf(recorded.identity)) {
    return { state: 'unresolved', reason: 'outline-identity-unavailable' };
  }
  const current = { baselineCommit: handoff.baseline?.commit, outlineCommit: handoff.outline?.commit,
    outlineTree: handoff.outline?.tree, targetPaths: handoff.targetPaths, targetBlobs: handoff.outline?.targetBlobs };
  if (captureJson(recorded.identity) !== captureJson(current)) return { state: 'unresolved', reason: 'outline-identity-mismatch' };
  return { state: 'accepted', identityDigest: outlineSha(Buffer.from(captureJson(recorded.identity))) };
}

function validateOutlineReview({ handoff, attemptDir, captures, targetPaths, outlineDigests, inventory, sessionId } = {}) {
  const refs = Array.isArray(captures) ? captures : [];
  const matches = refs.filter(item => recordOf(item) && item.ref === handoff.reviewCaptureRef && item.event === 'SubagentStop');
  if (matches.length !== 1) return { state: 'unresolved', reason: 'outline-review-capture-missing-or-ambiguous' };
  const review = matches[0];
  const reviewer = review.agent_id;
  if (!textOf(reviewer) || reviewer === sessionId || review.reviewVerdict !== 'approve'
    || !textOf(review.reviewSummary) || !HEX64.test(String(review.reviewDigest || ''))
    || review.reviewDigest !== handoff.reviewDigest) return { state: 'unresolved', reason: 'outline-review-invalid' };
  const capturedDigest = captureDigest(review);
  if (capturedDigest !== handoff.reviewCaptureDigest) return { state: 'unresolved', reason: 'outline-review-capture-digest-mismatch' };
  const principals = { author: sessionId, executors: journalExecutors(refs, sessionId) };
  if (!reviewRecordIndependent(review, refs, principals)) return { state: 'unresolved', reason: 'outline-review-not-independent' };
  const inventoryPath = path.posix.join('doc-reconciliation/outline-confirmation/inventory', path.posix.basename(inventory.pin.retainedArtifactPath));
  const expectedReviewed = { ...outlineDigests, [inventoryPath]: inventory.artifactDigest };
  if (captureJson(review.reviewedArtifactDigests) !== captureJson(expectedReviewed)) {
    return { state: 'unresolved', reason: 'outline-review-artifact-binding-mismatch' };
  }
  const summary = String(review.reviewSummary);
  if (!summary.includes(`inventory row ${handoff.inventory.rowId}`) || !summary.includes(targetPaths[0])
    || !summary.includes(handoff.inventory.domain)) return { state: 'unresolved', reason: 'outline-review-scope-mismatch' };
  const result = refs.filter(item => recordOf(item) && item.event === 'PostToolUse'
    && (item.tool_name === 'Agent' || item.tool_name === 'Task') && item.agent_id === reviewer);
  if (result.length !== 1) return { state: 'unresolved', reason: 'outline-review-result-missing-or-ambiguous' };
  return { state: 'accepted', review, reviewerPrincipal: reviewer, captureDigest: capturedDigest,
    reviewDigest: review.reviewDigest, inventoryPath };
}

function validateOutlineHandoffAtDispatch({ payload, parsed, sessionDir, workspaceRoot, captures, expectedPin } = {}) {
  const taskState = outlineTaskState(sessionDir);
  if (taskState.state !== 'accepted' || parsed.taskId !== taskState.taskBinding.taskId) {
    return { state: 'unresolved', reason: taskState.reason || 'task-binding-mismatch' };
  }
  const attempt = resolveOutlineAttempt({ sessionDir, taskId: parsed.taskId, attemptId: parsed.attemptId });
  if (attempt.state !== 'accepted') return attempt;
  const { handoff, handoffDigest, attemptDir, baseline, taskBinding } = attempt;
  const workflow = taskState.workflow;
  if (handoff.schema !== OUTLINE_HANDOFF_SCHEMA || handoff.workspaceId !== outlineWorkspaceId(baseline.root)
    || handoff.workflowId !== workflow.workflowId || handoff.workflowRevision !== workflow.revision
    || handoff.sessionId !== payload.session_id || handoff.hostId !== HOST_ID
    || handoff.coordinatorPrincipal !== payload.session_id
    || handoff.draftDispatchToken !== parsed.token
    || !sameCanonicalPath(handoff.baseline.root, baseline.root) || handoff.baseline.commit !== baseline.commit
    || handoff.baseline.tree !== baseline.tree || handoff.configDigest !== taskBinding.configDigest) {
    return { state: 'unresolved', reason: 'handoff-identity-mismatch' };
  }
  // O must change exactly the declared targets. Checked before the identity so an extra file reports its scope reason.
  const changedAtO = outlineGit(baseline.root, ['diff', '--name-only', '--no-renames', '-z', baseline.commit, handoff.outline.commit])
    .split('\0').filter(Boolean).sort(compareKeys);
  if (captureJson(changedAtO) !== captureJson(Array.isArray(handoff.targetPaths) ? [...handoff.targetPaths].sort(compareKeys) : null)) {
    return { state: 'unresolved', reason: 'outline-commit-scope-invalid' };
  }
  // Dispatch must still name the O the reviewer recorded: checked before the worktree, lease and review checks.
  const recordedIdentity = validateOutlineIdentity({ handoff, captures });
  if (recordedIdentity.state !== 'accepted') return recordedIdentity;
  const markerRoot = canonicalOutlineRoot(parsed.workerRoot);
  const declaredRoot = canonicalOutlineRoot(handoff.draftWorktreeRoot);
  if (!sameCanonicalPath(markerRoot, declaredRoot)) return { state: 'unresolved', reason: 'worker-root-mismatch' };
  const gitRoot = outlineGit(markerRoot, ['rev-parse', '--show-toplevel']).trim();
  if (!sameCanonicalPath(canonicalOutlineRoot(gitRoot), markerRoot)) return { state: 'unresolved', reason: 'worker-root-mismatch' };
  const head = outlineGit(markerRoot, ['rev-parse', '--verify', 'HEAD^{commit}']).trim();
  const tree = outlineGit(markerRoot, ['rev-parse', '--verify', 'HEAD^{tree}']).trim();
  const statusBytes = outlineGit(markerRoot, ['status', '--porcelain=v1', '-z', '--untracked-files=all'], true);
  const statusDigest = outlineSha(statusBytes);
  if (head !== handoff.outline.commit || tree !== handoff.outline.tree || statusBytes.length !== 0) {
    return { state: 'unresolved', reason: statusBytes.length ? 'worker-worktree-not-clean-at-O' : 'worker-worktree-not-at-O' };
  }
  if (outlineGit(markerRoot, ['rev-parse', '--verify', `${baseline.commit}^{commit}`]).trim() !== baseline.commit
    || outlineGit(markerRoot, ['rev-parse', '--verify', `${handoff.outline.commit}^{tree}`]).trim() !== handoff.outline.tree
    || outlineGit(markerRoot, ['merge-base', '--is-ancestor', baseline.commit, handoff.outline.commit]) !== '') {
    return { state: 'unresolved', reason: 'B-to-O-git-binding-invalid' };
  }
  const targetPaths = Array.isArray(handoff.targetPaths) ? [...handoff.targetPaths] : [];
  if (!targetPaths.length || targetPaths.some(item => typeof item !== 'string' || path.isAbsolute(item)
    || item.includes('\\') || item.split('/').some(part => !part || part === '.' || part === '..'))
    || captureJson([...new Set(targetPaths)].sort(compareKeys)) !== captureJson(targetPaths)) {
    return { state: 'unresolved', reason: 'outline-target-scope-invalid' };
  }
  const pinDir = path.join(sessionDir, 'doc-reconciliation', 'outline-confirmation', 'inventory');
  const trustedPin = expectedPin || OUTLINE_INVENTORY_PIN;
  const pinFile = path.join(pinDir, 'inventory-pin.json');
  const pinLoaded = readOutlineJson(pinFile);
  if (pinLoaded.state !== 'accepted') return { state: 'unresolved', reason: 'inventory-pin-unavailable' };
  const inventoryFile = path.join(pinDir, trustedPin.retainedArtifactPath.split('/').pop());
  let inventoryBytes;
  try { inventoryBytes = fs.readFileSync(inventoryFile); }
  catch { return { state: 'unresolved', reason: 'inventory-artifact-unavailable' }; }
  const inventory = validateOutlineInventoryPin({ bytes: inventoryBytes, pin: pinLoaded.value, expectedPin: trustedPin });
  if (inventory.state !== 'accepted') return inventory;
  if (outlineSha(pinLoaded.bytes) !== handoff.inventoryPinDigest && handoff.inventoryPinDigest !== undefined) {
    return { state: 'unresolved', reason: 'inventory-pin-digest-mismatch' };
  }
  const outlineBlobs = recordOf(handoff.outline?.targetBlobs) ? handoff.outline.targetBlobs : {};
  const outlineDigests = {};
  let citedRow = null;
  for (const target of targetPaths) {
    const atBaseline = outlineGit(baseline.root, ['ls-tree', '-r', '--name-only', baseline.commit, '--', target]).trim();
    if (atBaseline.split('\n').filter(Boolean).includes(target)) return { state: 'unresolved', reason: 'outline-target-existed-at-B' };
    if (!outlineGitTreeHasRegularBlob(markerRoot, handoff.outline.tree, target)) {
      return { state: 'unresolved', reason: 'outline-target-object-not-regular' };
    }
    const bytes = outlineGit(markerRoot, ['show', `${handoff.outline.commit}:${target}`], true);
    const blobOid = outlineGit(markerRoot, ['rev-parse', `${handoff.outline.commit}:${target}`]).trim();
    const expected = outlineBlobs[target];
    if (!recordOf(expected) || expected.blobOid !== blobOid || expected.storedBytesSha256 !== outlineSha(bytes)) {
      return { state: 'unresolved', reason: 'outline-object-binding-mismatch' };
    }
    const citation = parseOutlineCitation(bytes, target);
    if (citation.state !== 'accepted') return citation;
    const row = resolveInventoryRow(inventory, citation.rowId);
    if (row.state !== 'accepted' || citation.domain !== row.row.domain || citation.domain !== handoff.inventory.domain
      || handoff.inventory.rowId !== citation.rowId || !Array.isArray(handoff.inventory.targetPaths)
      || captureJson(handoff.inventory.targetPaths) !== captureJson(targetPaths)) {
      return { state: 'unresolved', reason: row.reason || 'outline-inventory-binding-mismatch' };
    }
    const expectedId = path.posix.basename(target, path.posix.extname(target));
    if (citation.id !== expectedId || !citation.id.startsWith(`${row.row.domain}-`)) {
      return { state: 'unresolved', reason: 'outline-domain-target-mismatch' };
    }
    if (citedRow && captureJson(citedRow) !== captureJson(row.row)) return { state: 'unresolved', reason: 'outline-row-ambiguous' };
    citedRow = row.row;
    outlineDigests[target] = outlineSha(bytes);
  }
  const leaseFile = path.join(attemptDir, 'writer-lease.json');
  const leaseLoaded = readOutlineJson(leaseFile);
  if (leaseLoaded.state !== 'accepted') return { state: 'unresolved', reason: 'writer-lease-unavailable' };
  const lease = leaseLoaded.value;
  if (lease.schema !== OUTLINE_LEASE_SCHEMA || lease.id !== handoff.writerLeaseId
    || lease.principalId !== payload.session_id || !sameCanonicalPath(lease.root, markerRoot) || lease.exclusive !== true
    || lease.active !== true || (Array.isArray(lease.competingWriters) && lease.competingWriters.length)
    || leaseLoaded.digest !== handoff.writerLeaseDigest) {
    return { state: 'unresolved', reason: 'writer-lease-invalid' };
  }
  const review = validateOutlineReview({ handoff, attemptDir, captures, targetPaths, outlineDigests, inventory,
    sessionId: payload.session_id });
  if (review.state !== 'accepted') return review;
  return { state: 'accepted', taskBinding, baseline, handoff, handoffDigest, attemptDir, markerRoot,
    worktree: { root: markerRoot, head, tree, statusDigest, clean: true },
    inventory, inventoryPinDigest: outlineSha(pinLoaded.bytes), row: citedRow, targetPaths, outlineDigests, review,
    leaseDigest: leaseLoaded.digest, leaseId: lease.id, identityDigest: recordedIdentity.identityDigest };
}

function outlineDispatchUnresolved(parsed, reason) {
  return { schema: OUTLINE_DISPATCH_SCHEMA, state: 'unresolved', reasons: [reason],
    ...(parsed ? { taskId: parsed.taskId, attemptId: parsed.attemptId, tokenDigest: parsed.tokenDigest,
      promptDigest: parsed.promptDigest, blockDigest: parsed.blockDigest, dispatchInputDigest: parsed.dispatchInputDigest,
      workerRoot: parsed.workerRoot } : {}) };
}

function captureOutlineDispatch(input = {}) {
  let parsed = null;
  try {
    const { payload, capture, sessionDir, workspaceRoot, captures = [], fixtureExpectedPin } = input;
    if (!recordOf(payload) || !recordOf(capture) || payload.hook_event_name !== 'PreToolUse'
      || !['Agent', 'Task'].includes(payload.tool_name) || !recordOf(payload.tool_input)) {
      return outlineDispatchUnresolved(null, 'dispatch-event-invalid');
    }
    parsed = parseOutlineDispatchPrompt(payload.tool_input.prompt);
    if (!parsed) return outlineDispatchUnresolved(null, 'dispatch-marker-invalid');
    if (capture.tool_use_id !== payload.tool_use_id || !textOf(payload.tool_use_id)
      || capture.session_id !== payload.session_id || !textOf(payload.session_id)) {
      return outlineDispatchUnresolved(parsed, 'dispatch-correlation-missing');
    }
    const failedPredecessor = (Array.isArray(captures) ? captures : []).some(item => recordOf(item)
      && item.event === 'PreToolUse' && item.session_id === payload.session_id
      && item.outlineDispatch?.state === 'unresolved'
      && (item.tool_use_id === payload.tool_use_id
        || (item.outlineDispatch.taskId === parsed.taskId && item.outlineDispatch.attemptId === parsed.attemptId
          && item.outlineDispatch.tokenDigest === parsed.tokenDigest)));
    if (failedPredecessor) return outlineDispatchUnresolved(parsed, 'attempt-already-unresolved');
    const validated = validateOutlineHandoffAtDispatch({ payload, parsed, sessionDir, workspaceRoot,
      captures, expectedPin: fixtureExpectedPin });
    if (validated.state !== 'accepted') return outlineDispatchUnresolved(parsed, validated.reason || 'dispatch-validation-unresolved');
    const seamDir = path.join(validated.attemptDir, 'seams');
    const tokenDir = path.join(validated.attemptDir, 'tokens');
    const seamName = `${outlineSha(String(payload.tool_use_id))}.json`;
    const seamFile = path.join(seamDir, seamName);
    const tokenFile = path.join(tokenDir, `${parsed.tokenDigest}.json`);
    const priorSeam = readOutlineJson(seamFile);
    if (priorSeam.state === 'accepted') {
      const prior = priorSeam.value;
      if (prior.toolUseId === payload.tool_use_id && prior.dispatchInputDigest === parsed.dispatchInputDigest
        && prior.taskId === parsed.taskId && prior.attemptId === parsed.attemptId) {
        return { ...prior, schema: OUTLINE_DISPATCH_SCHEMA, duplicate: true };
      }
      return outlineDispatchUnresolved(parsed, 'dispatch-input-changed');
    }
    const priorToken = readOutlineJson(tokenFile);
    if (priorToken.state === 'accepted') {
      const token = priorToken.value;
      if (token.toolUseId !== payload.tool_use_id) return outlineDispatchUnresolved(parsed, 'draft-token-reused');
      return outlineDispatchUnresolved(parsed, 'seam-missing-after-token-consumption');
    }
    const seam = {
      schema: OUTLINE_SEAM_SCHEMA, state: 'accepted', captureRef: capture.ref, toolUseId: payload.tool_use_id,
      taskId: parsed.taskId, attemptId: parsed.attemptId, workerRoot: validated.markerRoot,
      tokenDigest: parsed.tokenDigest, promptDigest: parsed.promptDigest, blockDigest: parsed.blockDigest,
      dispatchInputDigest: parsed.dispatchInputDigest, handoffDigest: validated.handoffDigest,
      reviewCaptureRef: validated.review.review.ref, reviewCaptureDigest: validated.review.captureDigest,
      reviewDigest: validated.review.reviewDigest, outlineIdentityDigest: validated.identityDigest,
      inventoryPinDigest: validated.inventoryPinDigest,
      writerLeaseDigest: validated.leaseDigest, writerLeaseId: validated.leaseId,
      coordinatorPrincipal: payload.session_id, reviewerPrincipal: validated.review.reviewerPrincipal,
      worktree: validated.worktree, validationReasons: [],
    };
    const sealFile = path.join(validated.attemptDir, 'handoff-seal.json');
    const existingSeal = readOutlineJson(sealFile);
    if (existingSeal.state === 'accepted') {
      if (existingSeal.value.taskId !== parsed.taskId || existingSeal.value.attemptId !== parsed.attemptId
        || existingSeal.value.handoffDigest !== validated.handoffDigest) {
        return outlineDispatchUnresolved(parsed, 'handoff-overwritten-after-dispatch');
      }
      return outlineDispatchUnresolved(parsed, 'handoff-seal-already-consumed');
    }
    const seal = { schema: 'harness.outline-handoff-seal.v1', taskId: parsed.taskId,
      attemptId: parsed.attemptId, handoffDigest: validated.handoffDigest };
    try { fs.writeFileSync(sealFile, JSON.stringify(seal, null, 2) + '\n', { encoding: 'utf8', flag: 'wx' }); }
    catch { return outlineDispatchUnresolved(parsed, 'handoff-seal-persistence-failed'); }
    fs.mkdirSync(tokenDir, { recursive: true });
    fs.mkdirSync(seamDir, { recursive: true });
    const token = { schema: 'harness.outline-token.v1', taskId: parsed.taskId, attemptId: parsed.attemptId,
      tokenDigest: parsed.tokenDigest, toolUseId: payload.tool_use_id, dispatchInputDigest: parsed.dispatchInputDigest,
      handoffDigest: validated.handoffDigest };
    try {
      fs.writeFileSync(tokenFile, JSON.stringify(token, null, 2) + '\n', { encoding: 'utf8', flag: 'wx' });
    } catch (error) {
      if (error.code === 'EEXIST') return outlineDispatchUnresolved(parsed, 'draft-token-reused');
      return outlineDispatchUnresolved(parsed, 'token-consumption-failed');
    }
    try {
      fs.writeFileSync(seamFile, JSON.stringify(seam, null, 2) + '\n', { encoding: 'utf8', flag: 'wx' });
    } catch {
      return outlineDispatchUnresolved(parsed, 'seam-persistence-failed');
    }
    return { ...seam, schema: OUTLINE_DISPATCH_SCHEMA,
      seamRef: path.relative(sessionDir, seamFile).split(path.sep).join('/') };
  } catch (error) {
    return outlineDispatchUnresolved(parsed, error.message === 'outline-git-unavailable' ? error.message : 'dispatch-validation-failed');
  }
}

function validateOutlineCaptureQualification(input, expectedHost = HOST_ID) {
  if (!recordOf(input) || input.hostId !== expectedHost || expectedHost !== HOST_ID) return { open: false, reason: 'unsupported-host' };
  const supplied = input.qualification;
  if (recordOf(supplied) && supplied.faked === true && supplied.source === 'fake-test-fixture'
    && supplied.toolUseIdPopulated === true && supplied.agentIdPopulated === true) {
    return supplied.outlineDispatchCaptureVerified === true
      ? { open: true, source: 'dependency-injection' }
      : { open: false, reason: 'outline-live-capture-unqualified' };
  }
  try {
    const qualificationError = validateQualificationExport(expectedHost);
    if (qualificationError) return { open: false, reason: qualificationError };
    const exported = JSON.parse(fs.readFileSync(path.join(__dirname, EXPORT_FILE), 'utf8'));
    const wrapper = exported.outlineDispatchCapture;
    if (!recordOf(wrapper) || !textOf(wrapper.hostVersion) || !textOf(wrapper.run) || !textOf(wrapper.baseline)
      || !textOf(wrapper.file) || /[\\/]/.test(wrapper.file) || wrapper.file.includes('..')) {
      return { open: false, reason: 'outline-live-capture-unqualified' };
    }
    const bytes = fs.readFileSync(path.join(__dirname, wrapper.file));
    if (crypto.createHash('sha256').update(bytes).digest('hex') !== wrapper.sha256) {
      return { open: false, reason: 'outline-live-capture-unqualified' };
    }
    const records = bytes.toString('utf8').split(/\r?\n/).filter(line => line.trim()).map(line => JSON.parse(line));
    if (!records.every(recordOf) || !outlineCaptureMappingValid(wrapper.mapping, records)) {
      return { open: false, reason: 'outline-live-capture-unqualified' };
    }
    return { open: true, source: 'validated-export', captureFile: wrapper.file };
  } catch (error) {
    return { open: false, reason: `outline-live-capture-unqualified:${error.code || 'invalid'}` };
  }
}

function outlineCaptureMappingValid(mapping, records) {
  if (!recordOf(mapping) || captureJson(mapping) !== captureJson(OUTLINE_CAPTURE_MAPPING) || !Array.isArray(records)) return false;
  const pres = records.filter(item => recordOf(item) && item.event === 'PreToolUse'
    && ['Task', 'Agent'].includes(item.tool_name) && recordOf(item.tool_input)
    && typeof item.tool_input.prompt === 'string' && textOf(item.session_id) && textOf(item.tool_use_id));
  return pres.some(pre => correlateOutlineDispatch(records, pre).state === 'accepted');
}

function outlineCorrelationFailure(reason) { return { state: 'unresolved', reason }; }

function outlineDispatchKeyMatches(item, pre) {
  return recordOf(item) && item.session_id === pre.session_id && item.tool_use_id === pre.tool_use_id;
}

function outlineResultAgentId(result) {
  if (recordOf(result.tool_response)) {
    const observed = result.tool_response.agentId;
    if (textOf(result.agent_id) && textOf(observed) && result.agent_id !== observed) {
      return { state: 'unresolved', reason: 'outline-worker-result-agent-id-conflict' };
    }
    return { state: textOf(observed) ? 'accepted' : 'unresolved', agentId: observed,
      ...(textOf(observed) ? {} : { reason: 'outline-worker-result-agent-id-missing' }) };
  }
  return textOf(result.agent_id)
    ? { state: 'accepted', agentId: result.agent_id }
    : { state: 'unresolved', reason: 'outline-worker-result-agent-id-missing' };
}

function outlineResultStatus(result) {
  if (recordOf(result.tool_response)) return Object.prototype.hasOwnProperty.call(result.tool_response, 'status')
    ? { present: true, value: result.tool_response.status } : { present: false };
  return Object.prototype.hasOwnProperty.call(result, 'tool_response_status')
    ? { present: true, value: result.tool_response_status } : { present: false };
}

function correlateOutlineDispatch(records, anchor, expectedWorkerRoot) {
  if (!Array.isArray(records)) return outlineCorrelationFailure('outline-capture-records-missing');
  if (!recordOf(anchor) || anchor.event !== 'PreToolUse' || !['Task', 'Agent'].includes(anchor.tool_name)) {
    return outlineCorrelationFailure('outline-dispatch-anchor-invalid');
  }
  if (!textOf(anchor.session_id) || !textOf(anchor.tool_use_id)) return outlineCorrelationFailure('outline-dispatch-key-missing');
  const pres = records.filter(item => recordOf(item) && item.event === 'PreToolUse'
    && ['Task', 'Agent'].includes(item.tool_name) && outlineDispatchKeyMatches(item, anchor));
  if (pres.length !== 1) return outlineCorrelationFailure('outline-dispatch-anchor-missing-or-ambiguous');
  const pre = pres[0];
  let workerRoot = expectedWorkerRoot;
  if (recordOf(pre.tool_input)) {
    const marker = parseOutlineDispatchPrompt(pre.tool_input.prompt);
    if (!marker) return outlineCorrelationFailure('outline-dispatch-marker-invalid');
    if (workerRoot !== undefined && !samePathKey(marker.workerRoot, workerRoot)) {
      return outlineCorrelationFailure('outline-dispatch-worker-root-mismatch');
    }
    workerRoot = marker.workerRoot;
    if (!Object.prototype.hasOwnProperty.call(pre.tool_input, 'run_in_background')) {
      return outlineCorrelationFailure('outline-dispatch-background-unobserved');
    }
    if (pre.tool_input.run_in_background !== false) {
      return outlineCorrelationFailure('outline-dispatch-background-enabled');
    }
    if (Object.prototype.hasOwnProperty.call(pre.tool_input, 'isolation')) {
      return outlineCorrelationFailure('outline-dispatch-isolation-unsupported');
    }
  } else {
    if (!recordOf(pre.outlineDispatch) || pre.outlineDispatch.state !== 'accepted' || !textOf(pre.outlineDispatch.workerRoot)) {
      return outlineCorrelationFailure('outline-dispatch-marker-unobserved');
    }
    if (workerRoot !== undefined && !samePathKey(pre.outlineDispatch.workerRoot, workerRoot)) {
      return outlineCorrelationFailure('outline-dispatch-worker-root-mismatch');
    }
    workerRoot = pre.outlineDispatch.workerRoot;
    if (!Object.prototype.hasOwnProperty.call(pre, 'run_in_background')) {
      return outlineCorrelationFailure('outline-dispatch-background-unobserved');
    }
    if (pre.run_in_background !== false) return outlineCorrelationFailure('outline-dispatch-background-enabled');
    if (!Object.prototype.hasOwnProperty.call(pre, 'isolationSet')) {
      return outlineCorrelationFailure('outline-dispatch-isolation-unobserved');
    }
    if (pre.isolationSet !== false) return outlineCorrelationFailure('outline-dispatch-isolation-unsupported');
  }
  if (!textOf(workerRoot) || !path.isAbsolute(workerRoot)) return outlineCorrelationFailure('outline-dispatch-worker-root-unobserved');

  const failures = records.filter(item => outlineDispatchKeyMatches(item, pre) && item.event === 'PostToolUseFailure');
  if (failures.length) return outlineCorrelationFailure('outline-worker-result-failed');
  const results = records.filter(item => outlineDispatchKeyMatches(item, pre) && item.event === 'PostToolUse'
    && ['Task', 'Agent'].includes(item.tool_name));
  if (results.length !== 1) return outlineCorrelationFailure('outline-worker-result-missing-or-ambiguous');
  const result = results[0];
  const status = outlineResultStatus(result);
  if (!status.present || status.value === undefined) return outlineCorrelationFailure('outline-worker-result-status-missing');
  if (status.value === 'async_launched') return outlineCorrelationFailure('outline-worker-result-async');
  if (status.value !== 'completed') return outlineCorrelationFailure('outline-worker-result-failed');
  const observedAgent = outlineResultAgentId(result);
  if (observedAgent.state !== 'accepted') return outlineCorrelationFailure(observedAgent.reason);
  const agentId = observedAgent.agentId;
  const sameAgentResults = records.filter(item => recordOf(item) && item.event === 'PostToolUse'
    && ['Task', 'Agent'].includes(item.tool_name) && item.session_id === pre.session_id
    && outlineResultAgentId(item).state === 'accepted' && outlineResultAgentId(item).agentId === agentId);
  if (sameAgentResults.length !== 1) return outlineCorrelationFailure('outline-worker-agent-id-replayed');

  const starts = records.filter(item => recordOf(item) && item.event === 'SubagentStart'
    && item.session_id === pre.session_id && item.agent_id === agentId);
  if (starts.length !== 1) return outlineCorrelationFailure('outline-worker-start-missing-or-ambiguous');
  const stops = records.filter(item => recordOf(item) && item.event === 'SubagentStop'
    && item.session_id === pre.session_id && item.agent_id === agentId);
  if (stops.length !== 1) return outlineCorrelationFailure('outline-worker-stop-missing-or-ambiguous');
  const start = starts[0];
  const stop = stops[0];
  const preIndex = records.indexOf(pre);
  const startIndex = records.indexOf(start);
  const stopIndex = records.indexOf(stop);
  if (preIndex < 0 || startIndex < 0 || stopIndex < 0) return outlineCorrelationFailure('outline-worker-journal-position-unavailable');
  if (startIndex <= preIndex) return outlineCorrelationFailure('outline-worker-start-before-dispatch');
  if (stopIndex <= startIndex) return outlineCorrelationFailure('outline-worker-stop-before-start');
  for (const workerEvent of [start, stop]) {
    if (!textOf(workerEvent.cwd) || !path.isAbsolute(workerEvent.cwd)) {
      return outlineCorrelationFailure('outline-worker-root-unobserved');
    }
    if (!samePathKey(workerEvent.cwd, workerRoot)) return outlineCorrelationFailure('outline-worker-root-mismatch');
  }
  return { state: 'accepted', pre, result, start, stop, workerRoot, agentId };
}

function verifyOutlineMergeCorrespondence({ root, outlineCommit, draftCommit, mergedCommit, targetPaths, record } = {}) {
  if (!recordOf(record) || !textOf(root) || !Array.isArray(targetPaths) || !targetPaths.length
    || record.outlineCommit !== outlineCommit || record.draftCommit !== draftCommit || record.mergedCommit !== mergedCommit) {
    return { state: 'unresolved', reason: 'merge-correspondence-missing-or-mismatched' };
  }
  try {
    for (const commit of [outlineCommit, draftCommit, mergedCommit]) {
      if (outlineGit(root, ['rev-parse', '--verify', `${commit}^{commit}`]).trim() !== commit) {
        return { state: 'unresolved', reason: 'merge-object-missing' };
      }
    }
    if (outlineCommit === draftCommit || outlineGit(root, ['merge-base', '--is-ancestor', outlineCommit, draftCommit]) !== '') {
      return { state: 'unresolved', reason: 'merge-pre-draft-ancestry-invalid' };
    }
    const recorded = record.targetBlobs;
    if (!recordOf(recorded) || captureJson(Object.keys(recorded).sort(compareKeys)) !== captureJson([...targetPaths].sort(compareKeys))) {
      return { state: 'unresolved', reason: 'merge-target-correspondence-invalid' };
    }
    let changed = false;
    for (const target of targetPaths) {
      const draft = outlineGit(root, ['rev-parse', `${draftCommit}:${target}`]).trim();
      const merged = outlineGit(root, ['rev-parse', `${mergedCommit}:${target}`]).trim();
      if (recorded[target]?.draft !== draft || recorded[target]?.merged !== merged) {
        return { state: 'unresolved', reason: 'merge-target-correspondence-invalid' };
      }
      changed ||= draft !== merged;
    }
    return { state: changed ? 'changed' : 'accepted', draftCommit, mergedCommit, targetPaths: [...targetPaths], targetBlobs: recorded };
  } catch (error) {
    return { state: 'unresolved', reason: error.message || 'merge-object-missing' };
  }
}

function outlineAncestry(root, ancestor, descendant) {
  try {
    outlineGit(root, ['merge-base', '--is-ancestor', ancestor, descendant]);
    return true;
  } catch { return false; }
}

function possibleWriterCapture(item) {
  if (!recordOf(item)) return false;
  if (OUTLINE_WRITE_TOOLS.includes(item.tool_name)) return true;
  if (!['Bash', 'PowerShell', 'exec_command'].includes(item.tool_name)) return false;
  return !['read-only', 'worktree-setup'].includes(classifyShell(item.command));
}

function stateJson(snapshot, relative) {
  const item = recordOf(snapshot) && snapshot[relative];
  return item?.kind === 'file' && recordOf(item.json) ? item.json : null;
}

function row17RequirementsValid(set) {
  if (!recordOf(set) || !Array.isArray(set.requirements) || set.requirements.length !== 2) return false;
  const [adr, verify] = set.requirements;
  return adr.id === 'adr-evid' && adr.stepType === 'doc-change' && adr.status === 'pending'
    && Array.isArray(adr.requiredBindings) && adr.requiredBindings.length === 0
    && verify.id === 'verify-row17' && verify.stepType === 'verification' && verify.status === 'pending'
    && Array.isArray(verify.requiredBindings) && verify.requiredBindings.length === 1
    && verify.requiredBindings[0].id === 'verification-loop' && verify.requiredBindings[0].required === true
    && verify.requiredBindings[0].path === 'verification-loop/SKILL.md';
}

function validRow17Task(workflow, root, expectedBaseline) {
  const task = workflow?.docReconciliationTask;
  const baseline = workflow?.docReconciliationBaseline;
  return recordOf(task) && task.schema === 'harness.doc-reconciliation-task-pin.v1'
    && captureJson(task.requirementIds) === captureJson(['adr-evid', 'verify-row17'])
    && task.taskId === 'task-adr-evid+verify-row17'
    && task.requirementDigest === digestText(JSON.stringify(['adr-evid', 'verify-row17']))
    && task.sessionId === workflow.sessionId && task.workflowId === workflow.workflowId
    && task.baselineCommit === baseline?.commit && samePathKey(task.baselineRoot, baseline?.root)
    && task.workflowId === workflow.workflowId && task.workspaceId === outlineWorkspaceId(root)
    && HEX64.test(String(task.configDigest || ''))
    && samePathKey(baseline?.root, root)
    && (!expectedBaseline || (baseline?.commit === expectedBaseline.head && baseline?.tree === expectedBaseline.tree));
}

function taskScopedFinalReviewBoundary(captures, review, taskId, dispositionPre = null) {
  const journal = Array.isArray(captures) ? captures : [];
  const fail = reason => ({ scoped: true, accepted: false, reason });
  if (!textOf(taskId)) return { scoped: false, accepted: true };
  const dispatches = journal.filter(item => recordOf(item) && item.event === 'PreToolUse'
    && ['Agent', 'Task'].includes(item.tool_name) && item.outlineDispatch?.state === 'accepted'
    && item.outlineDispatch.taskId === taskId);
  if (!dispatches.length) return { scoped: false, accepted: true };
  if (dispatches.length !== 1) return fail('outline-worker-dispatch-missing-or-ambiguous');
  const dispatchPre = dispatches[0];
  const dispatchIndex = journal.indexOf(dispatchPre);
  const reviewIndex = journal.indexOf(review);
  if (dispatchIndex < 0 || reviewIndex < 0) return fail('final-review-journal-position-unavailable');
  if (reviewIndex < dispatchIndex) return { scoped: false, accepted: true };
  const worker = correlateOutlineDispatch(journal, dispatchPre);
  if (worker.state !== 'accepted') return fail(worker.reason || 'outline-worker-completion-unresolved');
  const workerStopIndex = journal.indexOf(worker.stop);
  const workerResultIndex = journal.indexOf(worker.result);
  if (workerStopIndex < 0 || workerResultIndex < 0) return fail('outline-worker-journal-position-unavailable');
  // Stop and Agent result are independent host callbacks; require both before the next phase without ordering them.
  const workerClosed = Math.max(workerStopIndex, workerResultIndex);
  const reviewer = review?.agent_id;
  if (!textOf(reviewer) || review.event !== 'SubagentStop' || review.agent_type !== 'reviewer') {
    return fail('final-review-principal-missing-or-invalid');
  }
  const results = journal.filter(item => recordOf(item) && item.event === 'PostToolUse'
    && ['Agent', 'Task'].includes(item.tool_name) && item.session_id === dispatchPre.session_id && item.agent_id === reviewer);
  const starts = journal.filter(item => recordOf(item) && item.event === 'SubagentStart'
    && item.session_id === dispatchPre.session_id && item.agent_id === reviewer);
  const stops = journal.filter(item => recordOf(item) && item.event === 'SubagentStop'
    && item.session_id === dispatchPre.session_id && item.agent_id === reviewer);
  if (results.length !== 1 || starts.length !== 1 || stops.length !== 1 || stops[0] !== review
    || starts[0].agent_type !== 'reviewer' || results[0].interrupted !== false
    || outlineResultStatus(results[0]).value !== 'completed' || !textOf(results[0].tool_use_id)) {
    return fail('final-review-lifecycle-missing-or-ambiguous');
  }
  const result = results[0];
  const launchPres = journal.filter(item => recordOf(item) && item.event === 'PreToolUse'
    && ['Agent', 'Task'].includes(item.tool_name) && item.tool_use_id === result.tool_use_id);
  if (launchPres.length > 1 || (launchPres.length === 1 && launchPres[0].session_id !== dispatchPre.session_id)) {
    return fail('final-review-launch-missing-or-ambiguous');
  }
  const launchPre = launchPres[0] || null;
  const expectedIdentity = dispatchPre.observedIdentity;
  if (!recordOf(expectedIdentity) || !recordOf(expectedIdentity.taskPin)
    || expectedIdentity.taskPin.taskId !== taskId) return fail('final-review-task-identity-unavailable');
  const sameTask = item => item?.session_id === dispatchPre.session_id && recordOf(item.observedIdentity)
    && item.observedIdentity.workflowId === expectedIdentity.workflowId
    && item.observedIdentity.workflowRevision === expectedIdentity.workflowRevision
    && sameOutlineTaskBinding(item.observedIdentity.taskPin, expectedIdentity.taskPin)
    && item.observedIdentity.baselinePin?.commit === expectedIdentity.baselinePin?.commit
    && samePathKey(item.observedIdentity.baselinePin?.root, expectedIdentity.baselinePin?.root);
  if (![review, result, starts[0], ...(launchPre ? [launchPre] : [])].every(sameTask)) {
    return fail('final-review-task-correlation-mismatch');
  }
  const reviewRoot = launchPre?.cwd || starts[0].cwd;
  if (!textOf(reviewRoot) || !path.isAbsolute(reviewRoot)
    || !samePathKey(reviewRoot, dispatchPre.cwd)
    || ![review, result, starts[0], ...(launchPre ? [launchPre] : [])]
      .every(item => textOf(item.cwd) && path.isAbsolute(item.cwd) && samePathKey(item.cwd, reviewRoot))) {
    return fail('final-review-root-correlation-mismatch');
  }
  const startIndex = journal.indexOf(starts[0]);
  const resultIndex = journal.indexOf(result);
  if (startIndex <= workerClosed || resultIndex <= startIndex || reviewIndex <= startIndex) {
    return fail('final-review-before-worker-closure');
  }
  if (launchPre) {
    const launchPreIndex = journal.indexOf(launchPre);
    if (launchPre.tool_name !== result.tool_name || launchPreIndex < 0 || launchPreIndex >= startIndex
      || launchPreIndex <= workerClosed) return fail('final-review-before-worker-closure');
  }
  const reviewClosed = Math.max(resultIndex, reviewIndex);
  if (dispositionPre) {
    const dispositionIndex = journal.indexOf(dispositionPre);
    if (dispositionIndex <= reviewClosed || dispositionPre.session_id !== dispatchPre.session_id
      || !samePathKey(dispositionPre.cwd, dispatchPre.cwd)
      || dispositionPre.stateOperation?.taskId !== taskId) return fail('final-review-not-closed-before-disposition');
  }
  return { scoped: true, accepted: true, workerClosed, reviewClosed, dispatchPre, worker };
}

function validW6Phase(operation, captures, pre, requireCompletePath = false) {
  const index = captures.indexOf(pre);
  const outliner = captures.find(item => recordOf(item) && item.event === 'SubagentStop'
    && item.agent_type === 'reviewer' && item.reviewVerdict === 'approve'
    && Object.keys(item.reviewedArtifactDigests || {}).some(target => target !== `doc-reconciliation/outline-confirmation/inventory/${path.posix.basename(OUTLINE_INVENTORY_PIN.retainedArtifactPath)}`));
  const outlineStart = outliner && captures.find(item => item.event === 'SubagentStart' && item.agent_id === outliner.agent_id);
  const outlineIndex = outliner ? captures.indexOf(outliner) : -1;
  const outlineStartIndex = outlineStart ? captures.indexOf(outlineStart) : -1;
  const dispatchIndex = captures.findIndex(item => recordOf(item) && item.event === 'PreToolUse'
    && ['Agent', 'Task'].includes(item.tool_name) && item.outlineDispatch?.state === 'accepted');
  const taskId = pre?.stateOperation?.taskId;
  const finalReviewCandidates = captures.filter(item => recordOf(item) && item.event === 'SubagentStop' && item.agent_type === 'reviewer'
    && item.reviewVerdict === 'approve' && item.agent_id !== outliner?.agent_id);
  const taskReviews = finalReviewCandidates.map(review => ({ review,
    boundary: taskScopedFinalReviewBoundary(captures, review, taskId, pre) })).filter(item => item.boundary.scoped);
  const finalReview = taskReviews.length === 1 && taskReviews[0].boundary.accepted ? taskReviews[0].review : null;
  const finalReviewBoundary = taskReviews.length === 1 ? taskReviews[0].boundary : null;
  const finalReviewIndex = finalReview ? captures.indexOf(finalReview) : -1;
  const finalReviewPaths = finalReview ? Object.keys(finalReview.reviewedArtifactDigests || {}) : [];
  const finalReviewValid = Boolean(finalReview && finalReviewBoundary?.accepted && finalReviewPaths.length === 1
    && validOutlineTarget(finalReviewPaths[0])
    && (() => {
      try { return shaBytes(fs.readFileSync(path.join(pre.cwd, ...finalReviewPaths[0].split('/')))) === finalReview.reviewedArtifactDigests[finalReviewPaths[0]]
        && reviewRecordIndependent(finalReview, captures, { author: pre.session_id,
          executors: journalExecutors(captures, pre.session_id) }); }
      catch { return false; }
    })());
  if (['plan', 'start', 'inventory'].includes(operation)) {
    return index >= 0 && (requireCompletePath
      ? outlineStartIndex > index && dispatchIndex > outlineIndex
      : outlineStartIndex < 0 && dispatchIndex < 0);
  }
  if (operation === 'seal') return outlineIndex >= 0 && index > outlineIndex
    && (requireCompletePath ? index < dispatchIndex : dispatchIndex < 0);
  return finalReviewValid && finalReviewIndex >= 0 && index > finalReviewBoundary.reviewClosed;
}

function allowedW6SnapshotChanges(operation, destinations) {
  const allowed = new Set();
  for (const destination of destinations) {
    allowed.add(destination);
    const parts = destination.split('/');
    while (parts.length > 1) { parts.pop(); allowed.add(parts.join('/')); }
  }
  if (operation === 'step-verify') allowed.add('doc-reconciliation-pilot.json');
  return allowed;
}

function snapshotChanges(before, after) {
  if (!recordOf(before) || !recordOf(after)) return null;
  const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
  return [...keys].filter(relative => captureJson(before[relative] ?? null) !== captureJson(after[relative] ?? null)).sort(compareKeys);
}

function operationTransitionValid(operation, preOp, postOp, preCapture, sessionDir, root) {
  const before = preOp.snapshot;
  const after = postOp.snapshotAfter;
  const preWorkflow = stateJson(before, 'workflow-run.json');
  const postWorkflow = stateJson(after, 'workflow-run.json');
  const preSet = stateJson(before, 'workflow-obligations.json');
  const postSet = stateJson(after, 'workflow-obligations.json');
  const preTask = preWorkflow?.docReconciliationTask;
  const postTask = postWorkflow?.docReconciliationTask;
  const changed = snapshotChanges(before, after);
  if (!changed) return false;
  const allowed = allowedW6SnapshotChanges(operation, preOp.destinations);
  if (changed.some(relative => !allowed.has(relative)) || preOp.destinations.some(relative => !changed.includes(relative))) return false;
  if (operation !== 'plan' && !validRow17Task(preWorkflow, root)) return false;
  if (!postWorkflow || postWorkflow.sessionId !== preCapture.session_id
    || postWorkflow.workflowId !== preOp.workflowId) return false;

  if (operation === 'plan') {
    const expected = preOp.git;
    return ['pending', 'active'].includes(preWorkflow?.state)
      && !preTask
      && textOf(preWorkflow.workflowPlan?.strategy)
      && postWorkflow.pendingPlan?.strategy === 'iterative-single'
      && postWorkflow.sessionId === preCapture.session_id
      && postTask?.taskId === 'task-adr-evid+verify-row17'
      && validRow17Task(postWorkflow, root, expected)
      && row17RequirementsValid(postSet)
      && !postWorkflow.workflowStages?.length;
  }
  if (operation === 'start') {
    return preWorkflow?.state !== 'running' && postWorkflow.state === 'running'
      && postWorkflow.revision === preWorkflow.revision + 1
      && postWorkflow.workflowPlan?.strategy === 'iterative-single' && !postWorkflow.pendingPlan
      && validRow17Task(postWorkflow, root, preOp.git)
      && row17RequirementsValid({ ...postSet, requirements: postSet?.requirements?.map(item => ({ ...item, status: 'pending' })) });
  }
  if (operation === 'inventory') {
    const expectedPin = OUTLINE_INVENTORY_PIN;
    const pinRel = 'doc-reconciliation/outline-confirmation/inventory/inventory-pin.json';
    const artifactRel = `doc-reconciliation/outline-confirmation/inventory/${path.posix.basename(expectedPin.retainedArtifactPath)}`;
    const pin = stateJson(after, pinRel);
    const artifact = after[artifactRel];
    const bytes = artifact?.content ? Buffer.from(artifact.content, 'base64') : null;
    const validated = bytes && validateOutlineInventoryPin({ bytes, pin, expectedPin });
    return validRow17Task(preWorkflow, root) && preWorkflow.state === 'running'
      && preOp.git?.head === preTask?.baselineCommit && preOp.git?.tree === preWorkflow.docReconciliationBaseline?.tree
      && captureJson(pin) === captureJson(expectedPin) && validated?.state === 'accepted'
      && resolveInventoryRow(validated, '17').row?.domain === 'EVID';
  }
  if (operation === 'seal') {
    const handoffRel = preOp.destinations.find(relative => relative.endsWith('/handoff.json'));
    const leaseRel = preOp.destinations.find(relative => relative.endsWith('/writer-lease.json'));
    const handoff = stateJson(after, handoffRel);
    const lease = stateJson(after, leaseRel);
    const inventoryRel = `doc-reconciliation/outline-confirmation/inventory/${path.posix.basename(OUTLINE_INVENTORY_PIN.retainedArtifactPath)}`;
    const pinRel = 'doc-reconciliation/outline-confirmation/inventory/inventory-pin.json';
    const inventoryBytes = after[inventoryRel]?.content && Buffer.from(after[inventoryRel].content, 'base64');
    const inventory = inventoryBytes && validateOutlineInventoryPin({ bytes: inventoryBytes, pin: stateJson(after, pinRel), expectedPin: OUTLINE_INVENTORY_PIN });
    const attemptDir = handoffRel && path.posix.dirname(handoffRel);
    const expectedReview = outlineReviewCandidates(capturesFromSnapshotContext(preCapture, sessionDir), inventoryRel);
    const review = expectedReview.length === 1 ? expectedReview[0] : null;
    const target = handoff?.targetPaths?.[0];
    let targetBytes = null;
    try { if (target) targetBytes = outlineGit(root, ['show', `${handoff.outline.commit}:${target}`], true); } catch { /* fail closed below */ }
    return Boolean(handoff && lease && review && inventory?.state === 'accepted'
      && handoff.schema === OUTLINE_HANDOFF_SCHEMA && handoff.taskId === postTask?.taskId
      && handoff.attemptId === path.posix.basename(attemptDir) && handoff.workflowId === postWorkflow.workflowId
      && handoff.workflowRevision === postWorkflow.revision && handoff.sessionId === preCapture.session_id
      && handoff.baseline?.commit === preWorkflow.docReconciliationBaseline?.commit
      && handoff.baseline?.tree === preWorkflow.docReconciliationBaseline?.tree
      && handoff.outline?.commit === preOp.git?.head && handoff.outline?.tree === preOp.git?.tree
      && handoff.reviewCaptureRef === review.ref && handoff.reviewDigest === review.reviewDigest
      && handoff.reviewCaptureDigest === captureDigest(review) && lease.schema === OUTLINE_LEASE_SCHEMA
      && lease.taskId === handoff.taskId && lease.attemptId === handoff.attemptId && lease.principalId === preCapture.session_id
      && lease.exclusive === true && lease.active === true && sameCanonicalPath(lease.root, root)
      && targetBytes && shaBytes(targetBytes) === handoff.outline.targetBlobs?.[target]?.storedBytesSha256
      && captureJson(handoff.targetPaths) === captureJson([target]));
  }
  if (operation === 'binding-verify') {
    const beforeVerify = preSet?.requirements?.find(item => item.id === 'verify-row17');
    const afterVerify = postSet?.requirements?.find(item => item.id === 'verify-row17');
    return postWorkflow.state === 'running' && beforeVerify?.status === 'pending'
      && preSet?.requirements?.[0]?.status === 'pass'
      && afterVerify?.status === 'pending' && afterVerify.requiredBindings?.length === 1
      && afterVerify.requiredBindings[0].id === 'verification-loop'
      && afterVerify.requiredBindings[0].status === 'loaded'
      && afterVerify.requiredBindings[0].availability === 'available'
      && afterVerify.requiredBindings[0].path === 'verification-loop/SKILL.md';
  }
  if (operation === 'step-adr' || operation === 'step-verify') {
    const stepId = operation === 'step-adr' ? 'adr-evid' : 'verify-row17';
    const beforeStep = preSet?.requirements?.find(item => item.id === stepId);
    const afterStep = postSet?.requirements?.find(item => item.id === stepId);
    const report = operation === 'step-verify' ? stateJson(after, 'doc-reconciliation-pilot.json') : null;
    return postWorkflow.state === 'running' && beforeStep?.status === 'pending' && afterStep?.status === 'pass'
      && textOf(afterStep.evidence) && (operation === 'step-adr'
        ? postSet.requirements.find(item => item.id === 'verify-row17')?.status === 'pending'
        : preSet.requirements.find(item => item.id === 'adr-evid')?.status === 'pass'
          && preSet.requirements.find(item => item.id === 'verify-row17')?.requiredBindings?.[0]?.status === 'loaded'
          && report?.pilotCredit === false && report?.pilotStatus === 'pending');
  }
  return false;
}

function capturesFromSnapshotContext(preCapture, sessionDir) {
  return readCaptureView(sessionDir).records.filter(item => item.ref && item.ref !== preCapture.ref);
}

function shaBytes(bytes) { return crypto.createHash('sha256').update(bytes).digest('hex'); }

function validateW6StateOperationPair(captures, pre, sessionDir, options = {}) {
  const op = pre?.stateOperation;
  if (!recordOf(op) || op.schema !== W6_STATE_OPERATION_SCHEMA || op.state !== 'pre'
    || pre.event !== 'PreToolUse' || !pre.tool_use_id || op.invocationId !== pre.tool_use_id
    || pre.session_id !== op.sessionId || pre.session_id !== op.principalId || textOf(pre.agent_id)
    || !sameCanonicalPath(pre.cwd, op.workspaceRoot)
    || op.phase !== (['plan', 'start', 'inventory'].includes(op.operation) ? 'before-o'
      : op.operation === 'seal' ? 'review-to-dispatch' : 'post-final-review')) return { accepted: false };
  const pairPosts = captures.filter(item => recordOf(item) && item.event === 'PostToolUse'
    && item.session_id === pre.session_id && item.tool_use_id === pre.tool_use_id);
  const failures = captures.filter(item => recordOf(item) && item.event === 'PostToolUseFailure'
    && item.session_id === pre.session_id && item.tool_use_id === pre.tool_use_id);
  if (!pairPosts.length && !failures.length && options.allowInFlightToolUseId === pre.tool_use_id
    && op.operation === 'step-verify' && validW6Phase(op.operation, captures, pre)
    && stateJson(op.snapshot, 'workflow-obligations.json')?.requirements?.find(item => item.id === 'verify-row17')?.status === 'pending') {
    return { accepted: true, inFlight: true, operation: op.operation, pre, toolUseId: pre.tool_use_id };
  }
  if (pairPosts.length !== 1 || failures.length || pairPosts[0].stateOperation?.schema !== W6_STATE_OPERATION_SCHEMA
    || pairPosts[0].stateOperation.state !== 'post' || pairPosts[0].stateOperation.preRef !== pre.ref
    || pairPosts[0].stateOperation.operation !== op.operation || pairPosts[0].tool_name !== pre.tool_name
    || pairPosts[0].command !== pre.command || pairPosts[0].cwd !== pre.cwd
    || pairPosts[0].interrupted !== false || (pairPosts[0].exitCode !== undefined && pairPosts[0].exitCode !== 0)) {
    return { accepted: false, operation: op.operation, pre, reason: 'host-result-incomplete' };
  }
  const postOp = pairPosts[0].stateOperation;
  if (postOp.workflowId !== op.workflowId || postOp.workspaceRoot !== op.workspaceRoot
    || postOp.workflowRevision !== op.workflowRevision || postOp.taskId !== op.taskId
    || !Array.isArray(postOp.destinations) || captureJson(postOp.destinations) !== captureJson(op.destinations)
    || captureJson(postOp.arguments) !== captureJson(op.arguments)
    || !postOp.snapshotAfter || !postOp.gitAfter || captureJson(op.git) !== captureJson(postOp.gitAfter)
    || postOp.git?.head !== op.git?.head || postOp.git?.tree !== op.git?.tree
    || !validW6Phase(op.operation, captures, pre, options.requireCompletePath === true)
    || !operationTransitionValid(op.operation, op, postOp, pre, sessionDir, op.workspaceRoot)) {
    return { accepted: false, operation: op.operation, pre, post: pairPosts[0], reason: 'state-transition-invalid' };
  }
  return { accepted: true, operation: op.operation, pre, post: pairPosts[0], toolUseId: pre.tool_use_id };
}

function evaluateW6StateOperations(captures, sessionDir, options = {}) {
  const records = Array.isArray(captures) ? captures : [];
  const taskState = outlineTaskState(sessionDir);
  const required = taskState.state === 'accepted'
    && captureJson(taskState.taskBinding.requirementIds) === captureJson(['adr-evid', 'verify-row17']);
  if (!required) return { required: false, acceptedToolUseIds: new Set(), operations: [], complete: true };
  const candidates = records.filter(item => recordOf(item) && item.event === 'PreToolUse'
    && item.stateOperation?.schema === W6_STATE_OPERATION_SCHEMA);
  const results = candidates.map(pre => validateW6StateOperationPair(records, pre, sessionDir,
    { ...options, requireCompletePath: true }));
  const accepted = results.filter(item => item.accepted);
  const byOperation = operation => accepted.filter(item => item.operation === operation);
  const expected = ['plan', 'start', 'inventory', 'seal', 'step-adr', 'binding-verify', 'step-verify'];
  const countsValid = expected.every(operation => byOperation(operation).length === 1)
    && accepted.length === expected.length;
  const ordered = expected.map(operation => byOperation(operation)[0]).filter(Boolean);
  const orderValid = ordered.every((item, index) => index === 0 || records.indexOf(ordered[index - 1].pre) < records.indexOf(item.pre));
  const inFlightAllowed = options.allowInFlightToolUseId
    && results.some(item => item.accepted && item.inFlight && item.toolUseId === options.allowInFlightToolUseId);
  const complete = countsValid && orderValid && !accepted.some(item => item.inFlight);
  return { required: true, complete, inFlightAllowed: Boolean(inFlightAllowed),
    readyForAssessment: countsValid && orderValid && (complete || Boolean(inFlightAllowed)), operations: accepted,
    acceptedToolUseIds: new Set(accepted.map(item => item.toolUseId)), results };
}

function isVerifiedW6StateOperation(captures, sessionDir, toolUseId) {
  const records = Array.isArray(captures) ? captures : [];
  const pre = records.find(item => item?.event === 'PreToolUse' && item.tool_use_id === toolUseId
    && item.stateOperation?.schema === W6_STATE_OPERATION_SCHEMA);
  return Boolean(pre && validateW6StateOperationPair(records, pre, sessionDir).accepted);
}

function pendingW6VerificationInvocation(context) {
  const captures = readCaptureView(context.sessionDir);
  if (captures.tampered) return null;
  const records = captures.records;
  const pending = records.filter(item => item?.event === 'PreToolUse' && item.stateOperation?.schema === W6_STATE_OPERATION_SCHEMA
    && item.stateOperation.operation === 'step-verify' && item.stateOperation.state === 'pre');
  if (pending.length !== 1) return null;
  const checked = validateW6StateOperationPair(records, pending[0], context.sessionDir, {
    allowInFlightToolUseId: pending[0].tool_use_id,
  });
  return checked.accepted && checked.inFlight ? checked.toolUseId : null;
}

function writeTargetsOf(toolName, toolInput) {
  if (toolName === 'apply_patch') {
    const patch = typeof toolInput === 'string' ? toolInput : (recordOf(toolInput) ? String(toolInput.patch || toolInput.input || '') : '');
    const targets = [];
    for (const match of patch.matchAll(/^\*\*\* ([^\r\n]*)(?:\r?$)/gm)) {
      const header = match[1];
      if (['Begin Patch', 'End Patch', 'End of File'].includes(header)) continue;
      const fileHeader = /^(?:Add File|Update File|Delete File|Move to): (.*)$/.exec(header);
      if (!fileHeader) return null;
      targets.push(fileHeader[1]);
    }
    return targets;
  }
  const file = recordOf(toolInput) ? toolInput.file_path || toolInput.path : undefined;
  return typeof file === 'string' && file.length ? [file] : [];
}

function validOutlineTarget(target) {
  return typeof target === 'string' && target.length > 0 && !target.includes('\0') && !target.includes('\\')
    && !target.includes(':') && !path.posix.isAbsolute(target)
    && target.split('/').every(part => part && part !== '.' && part !== '..');
}

function outlineRootSpellings(root) {
  try {
    if (typeof root !== 'string' || !path.isAbsolute(root)) return [];
    return [...new Set([root, canonicalOutlineRoot(root)])];
  } catch { return []; }
}

function outlineCwdMatchesRoot(cwd, root, allowVerifiedAlias = false) {
  if (typeof cwd !== 'string' || !path.isAbsolute(cwd)) return false;
  if (outlineRootSpellings(root).includes(cwd)) return true;
  if (!allowVerifiedAlias) return false;
  try { return canonicalOutlineRoot(cwd) === canonicalOutlineRoot(root); }
  catch { return false; }
}

function outlineCaptureRootSpellings(root, cwd) {
  const roots = outlineRootSpellings(root);
  // Hook setup may retain the canonical root while the captured cwd keeps its original spelling; this affects topology only.
  if (outlineCwdMatchesRoot(cwd, root, true)) roots.push(cwd);
  return [...new Set(roots)];
}

function outlineRelativeSpellingKey(spelling, toolName) {
  if (validOutlineTarget(spelling)) return spelling;
  if (process.platform !== 'win32' || !OUTLINE_WRITE_TOOLS.includes(toolName)
    || !spelling.includes(path.sep) || spelling.includes('/')) return null;
  const candidate = spelling.split(path.sep).join('/');
  return validOutlineTarget(candidate) ? candidate : null;
}

function outlineSpellingKey(spelling, { root, cwd, toolName } = {}) {
  if (typeof spelling !== 'string' || !spelling.length || spelling.includes('\0')
    || !outlineCwdMatchesRoot(cwd, root, true)) return null;
  const relative = outlineRelativeSpellingKey(spelling, toolName);
  if (relative) return relative;
  for (const rootSpelling of outlineCaptureRootSpellings(root, cwd)) {
    const prefix = rootSpelling.endsWith(path.sep) ? rootSpelling : `${rootSpelling}${path.sep}`;
    if (!spelling.startsWith(prefix)) continue;
    return outlineRelativeSpellingKey(spelling.slice(prefix.length), toolName);
  }
  return null;
}

function outlineTargetSpellings(target, { root, toolName } = {}) {
  if (!validOutlineTarget(target)) return [];
  const targetSpellings = [target];
  if (process.platform === 'win32' && OUTLINE_WRITE_TOOLS.includes(toolName)) {
    targetSpellings.push(target.split('/').join(path.sep));
  }
  const spellings = [...targetSpellings];
  for (const rootSpelling of outlineRootSpellings(root)) {
    const prefix = rootSpelling.endsWith(path.sep) ? rootSpelling : `${rootSpelling}${path.sep}`;
    for (const renderedTarget of targetSpellings) spellings.push(prefix + renderedTarget);
  }
  return spellings;
}

// Capture can prove a lexical path/topology before the later handoff supplies the pin. Its candidate is non-authorizing;
// the assessment call below must match the same raw spelling against the validated pinned target set.
function recognizeOutlineTarget(spelling, { root, cwd, targets, toolName } = {}) {
  const hasPinnedTargets = Array.isArray(targets);
  if (typeof spelling !== 'string' || !spelling.length || spelling.includes('\0')
    || !outlineCwdMatchesRoot(cwd, root, !hasPinnedTargets)) return null;
  if (Array.isArray(targets)) {
    const target = targets.find(item => outlineTargetSpellings(item, { root, toolName }).includes(spelling));
    return target ? { candidate: target, target } : null;
  }
  const candidate = outlineSpellingKey(spelling, { root, cwd, toolName });
  if (!candidate) return null;
  return { candidate, target: null };
}

function outlineBToOGitAllowed(command, { cwd, root, targets, topology }) {
  const parsed = safeTokenize(String(command || '').trim());
  if (!parsed.ok || parsed.tokens[0] !== 'git' || parsed.tokens.length < 2) return false;
  const [operation, ...args] = parsed.tokens.slice(1);
  if (operation === 'add') {
    const hasOperandMarker = args[0] === '--';
    const operands = hasOperandMarker ? args.slice(1) : args;
    if (!operands.length || !Array.isArray(topology) || topology.length !== operands.length) return false;
    if (!hasOperandMarker && operands.some(operand => operand.startsWith('-'))) return false;
    return operands.every((operand, index) => {
      if (!operand || operand.startsWith(':') || /[*?\[\]{}]/.test(operand) || /[\\/]$/.test(operand)) return false;
      const target = recognizeOutlineTarget(operand, { root, cwd, targets, toolName: 'Bash' })?.target;
      const proof = topology[index];
      return Boolean(target && proof?.path === target && proof.state === 'regular'
        && outlineFilesystemProof(root, root, target, false).state === 'regular');
    });
  }
  return operation === 'commit' && args.length === 2 && args[0] === '-m' && args[1] !== '';
}

function outlineFilesystemProof(root, cwd, target, allowMissing) {
  let relativePath;
  try {
    const canonicalRoot = canonicalOutlineRoot(root);
    const base = canonicalOutlineRoot(cwd || root);
    if (base !== canonicalRoot) return { path: null, state: 'unresolved' };
    const relative = path.relative(canonicalRoot, path.resolve(canonicalRoot, target));
    if (!relative || path.isAbsolute(relative) || relative === '..' || relative.startsWith(`..${path.sep}`)) {
      return { path: null, state: 'unresolved' };
    }
    const absolute = path.resolve(canonicalRoot, relative);
    relativePath = path.relative(canonicalRoot, absolute);
    if (!relativePath || path.isAbsolute(relativePath) || relativePath === '..' || relativePath.startsWith(`..${path.sep}`)) {
      return { path: null, state: 'unresolved' };
    }
    const relativeKey = relativePath.split(path.sep).join('/');
    let current = canonicalRoot;
    const parts = relativePath.split(path.sep);
    for (let index = 0; index < parts.length; index++) {
      current = path.join(current, parts[index]);
      let stat;
      try { stat = fs.lstatSync(current); }
      catch (error) {
        return error.code === 'ENOENT' && allowMissing
          ? { path: relativeKey, state: 'absent' } : { path: relativeKey, state: 'unresolved' };
      }
      if (stat.isSymbolicLink() || (index < parts.length - 1 && !stat.isDirectory())) {
        return { path: relativeKey, state: 'unresolved' };
      }
      if (index === parts.length - 1) return { path: relativeKey, state: stat.isFile() ? 'regular' : 'unresolved' };
    }
  } catch { /* filesystem state is evidence only when every component can be checked */ }
  return { path: relativePath ? relativePath.split(path.sep).join('/') : null, state: 'unresolved' };
}

function outlineGitTreeHasRegularBlob(root, tree, target) {
  try {
    const entries = outlineGit(root, ['--literal-pathspecs', 'ls-tree', '-z', tree, '--', target], true)
      .toString('utf8').split('\0').filter(Boolean);
    if (entries.length !== 1) return false;
    const tab = entries[0].indexOf('\t');
    if (tab < 0 || entries[0].slice(tab + 1) !== target) return false;
    const [mode, type, oid] = entries[0].slice(0, tab).split(/\s+/);
    return type === 'blob' && ['100644', '100755'].includes(mode) && /^[0-9a-f]+$/i.test(oid);
  } catch { return false; }
}

// Phase-aware writer decision (W1–W3). Principal, phase and operation-time path topology come from captured records.
// Allowed: coordinator Write/Edit/apply_patch of exactly a pinned target before the reviewer lifecycle starts; coordinator
// target-bound git add or simple git commit before review; the correlated draft worker
// between dispatch and its Stop. Everything else, including any coordinator state write after review, stays ambiguous.
function outlineWriterAllowed(item, { index, sessionId, root, targets, worker, workerRoot, reviewStartIndex, reviewStopIndex,
  dispatchIndex, workerStopIndex, captures, stateOperationToolUseIds = new Set() }) {
  if (item?.stateOperation?.schema === W6_STATE_OPERATION_SCHEMA
    && stateOperationToolUseIds.has(item.tool_use_id) && item.session_id === sessionId && !textOf(item.agent_id)
    && ['PreToolUse', 'PostToolUse'].includes(item.event) && sameCanonicalPath(item.cwd, root)) return true;
  const phase = index < reviewStartIndex ? 'b-to-o' : index <= reviewStopIndex ? 'review'
    : index < dispatchIndex ? 'review-to-dispatch' : index <= workerStopIndex ? 'dispatch-to-draft' : 'after-draft';
  if (phase === 'dispatch-to-draft') return item.agent_id === worker.agent_id && sameCanonicalPath(item.cwd, workerRoot);
  if (phase !== 'b-to-o' || textOf(item.agent_id) || item.session_id !== sessionId) return false;
  if (item.event !== 'PreToolUse') {
    const pre = (Array.isArray(captures) ? captures : []).find(record => record.event === 'PreToolUse'
      && record.session_id === item.session_id && record.tool_use_id === item.tool_use_id
      && record.tool_name === item.tool_name && record.command === item.command
      && captureJson(record.writeTargets || null) === captureJson(item.writeTargets || null)
      && samePathKey(record.cwd || root, item.cwd || root));
    return Boolean(pre && outlineWriterAllowed(pre, { index: captures.indexOf(pre), sessionId, root, targets, worker, workerRoot,
      reviewStartIndex, reviewStopIndex, dispatchIndex, workerStopIndex, captures }));
  }
  if (OUTLINE_WRITE_TOOLS.includes(item.tool_name)) {
    const topology = item.outlineWriteTopology;
    return Array.isArray(item.writeTargets) && item.writeTargets.length > 0
      && Array.isArray(topology) && topology.length === item.writeTargets.length
      && item.writeTargets.every((file, index) => {
        const target = recognizeOutlineTarget(file, { root, cwd: item.cwd, targets, toolName: item.tool_name })?.target;
        const proof = topology[index];
        return Boolean(target && proof?.path === target && ['absent', 'regular'].includes(proof.state)
          && outlineFilesystemProof(root, root, target, false).state === 'regular');
      });
  }
  const cwd = item.cwd;
  return item.tool_name === 'Bash' && outlineCwdMatchesRoot(cwd, root)
    && outlineBToOGitAllowed(item.command, { cwd, root, targets, topology: item.outlineWriteTopology });
}

function sameCanonicalPath(left, right) {
  try {
    fs.statSync(left);
    fs.statSync(right);
    return key(left) === key(right);
  }
  catch { return false; }
}

function samePathKey(left, right) {
  try { return key(left) === key(right); }
  catch { return false; }
}

function sameOutlineTaskBinding(left, right) {
  if (!recordOf(left) || !recordOf(right)) return false;
  const { baselineRoot: leftRoot, ...leftIdentity } = left;
  const { baselineRoot: rightRoot, ...rightIdentity } = right;
  return captureJson(leftIdentity) === captureJson(rightIdentity) && sameCanonicalPath(leftRoot, rightRoot);
}

function resolveOutlineEvidence({ safeInput, capture, captures, request, originRef } = {}) {
  const fail = (reason, status = 'rejected') => ({ status, diagnostics: [diagnostic(reason, { reason })] });
  try {
    const cap = capture;
    const sessionDir = safeInput.sessionDir;
    const dispatch = cap?.outlineDispatch;
    if (!recordOf(dispatch) || dispatch.schema !== OUTLINE_DISPATCH_SCHEMA || dispatch.state !== 'accepted'
      || !textOf(dispatch.seamRef) || dispatch.captureRef !== cap.ref || dispatch.toolUseId !== cap.tool_use_id) {
      // The dispatch-time reason (for example outline-identity-mismatch) is kept beside the wrapper code, so the rejection names its cause.
      const reasons = recordOf(dispatch) && Array.isArray(dispatch.reasons) ? dispatch.reasons.filter(reason => /^[a-z0-9-]+$/.test(String(reason))) : [];
      return { status: 'rejected', diagnostics: [diagnostic('outline-pre-dispatch-seam-unresolved', { reason: 'outline-pre-dispatch-seam-unresolved' }),
        ...reasons.map(reason => diagnostic(reason, { reason }))] };
    }
    if (cap.event !== 'PreToolUse' || !['Task', 'Agent'].includes(cap.tool_name)
      || cap.session_id !== safeInput.sessionId || cap.observedIdentity?.taskPin?.taskId !== safeInput.taskId) {
      return fail('outline-dispatch-identity-mismatch');
    }
    const taskState = outlineTaskState(sessionDir);
    if (taskState.state !== 'accepted' || taskState.taskBinding.taskId !== safeInput.taskId
      || (recordOf(safeInput.taskBinding) && !sameOutlineTaskBinding(taskState.taskBinding, safeInput.taskBinding))
      || !sameOutlineTaskBinding(cap.observedIdentity.taskPin, taskState.taskBinding)
      || cap.observedIdentity.baselinePin?.commit !== taskState.baseline.commit
      || !sameCanonicalPath(cap.observedIdentity.baselinePin?.root, taskState.baseline.root)) {
      return fail('outline-task-binding-mismatch');
    }
    const attempt = resolveOutlineAttempt({ sessionDir, taskId: dispatch.taskId, attemptId: dispatch.attemptId });
    if (attempt.state !== 'accepted') return fail(attempt.reason || 'outline-attempt-unresolved');
    if (attempt.handoffDigest !== dispatch.handoffDigest) return fail('outline-handoff-changed-after-dispatch');
    const seamRef = String(dispatch.seamRef).replace(/\\/g, '/');
    if (path.isAbsolute(seamRef) || seamRef.split('/').some(part => !part || part === '.' || part === '..')) {
      return fail('outline-seam-reference-invalid');
    }
    const seamFile = path.join(sessionDir, ...seamRef.split('/'));
    const seamLoaded = readOutlineJson(seamFile);
    if (seamLoaded.state !== 'accepted') return fail('outline-seam-missing');
    const seam = seamLoaded.value;
    if (seam.schema !== OUTLINE_SEAM_SCHEMA || seam.state !== 'accepted' || seam.captureRef !== cap.ref
      || seam.toolUseId !== cap.tool_use_id || seam.taskId !== dispatch.taskId || seam.attemptId !== dispatch.attemptId
      || seam.dispatchInputDigest !== dispatch.dispatchInputDigest || seam.handoffDigest !== attempt.handoffDigest
      || seam.tokenDigest !== dispatch.tokenDigest) return fail('outline-seam-mismatch');
    const sameAttempt = (Array.isArray(captures) ? captures : []).filter(item => recordOf(item)
      && item.event === 'PreToolUse' && item.outlineDispatch?.taskId === dispatch.taskId
      && item.outlineDispatch?.attemptId === dispatch.attemptId && item.outlineDispatch?.tokenDigest === dispatch.tokenDigest);
    for (const other of sameAttempt) {
      const evidence = other.outlineDispatch;
      if (evidence.state !== 'accepted' || evidence.dispatchInputDigest !== dispatch.dispatchInputDigest
        || other.tool_use_id !== cap.tool_use_id) return fail('outline-dispatch-replay-or-conflict');
    }
    const sameToolUse = (Array.isArray(captures) ? captures : []).filter(item => recordOf(item)
      && item.event === 'PreToolUse' && item.tool_use_id === cap.tool_use_id);
    if (sameToolUse.some(item => item.ref !== cap.ref && (item.outlineDispatch?.state !== 'accepted'
      || item.outlineDispatch.dispatchInputDigest !== dispatch.dispatchInputDigest))) return fail('outline-tool-use-id-replayed');
    const handoff = attempt.handoff;
    const targetPaths = Array.isArray(handoff.targetPaths) ? handoff.targetPaths : [];
    const expectedPin = recordOf(safeInput.qualification) && safeInput.qualification.faked === true
      && recordOf(safeInput.outlineFixture?.expectedPin) ? safeInput.outlineFixture.expectedPin : OUTLINE_INVENTORY_PIN;
    const inventoryRoot = path.join(sessionDir, 'doc-reconciliation', 'outline-confirmation', 'inventory');
    const pinFile = path.join(inventoryRoot, 'inventory-pin.json');
    const pinLoaded = readOutlineJson(pinFile);
    if (pinLoaded.state !== 'accepted' || outlineSha(pinLoaded.bytes) !== seam.inventoryPinDigest) return fail('outline-inventory-pin-changed');
    let inventoryBytes;
    try { inventoryBytes = fs.readFileSync(path.join(inventoryRoot, expectedPin.retainedArtifactPath.split('/').pop())); }
    catch { return fail('outline-inventory-bytes-missing'); }
    const inventory = validateOutlineInventoryPin({ bytes: inventoryBytes, pin: pinLoaded.value, expectedPin });
    if (inventory.state !== 'accepted') return fail(inventory.reason || 'outline-inventory-unresolved');
    const outlineDigests = {};
    const reviewRows = {};
    for (const target of targetPaths) {
      if (!outlineGitTreeHasRegularBlob(seam.worktree.root, handoff.outline.tree, target)) {
        return fail('outline-target-object-not-regular');
      }
      const bytes = outlineGit(seam.worktree.root, ['show', `${handoff.outline.commit}:${target}`], true);
      outlineDigests[target] = outlineSha(bytes);
      const citation = parseOutlineCitation(bytes, target);
      if (citation.state !== 'accepted') return fail(citation.reason || 'outline-citation-invalid');
      const row = resolveInventoryRow(inventory, citation.rowId);
      if (row.state !== 'accepted' || row.row.domain !== citation.domain || citation.domain !== handoff.inventory?.domain
        || citation.rowId !== handoff.inventory?.rowId) return fail(row.reason || 'outline-inventory-binding-mismatch');
      reviewRows[target] = row.row;
    }
    const review = validateOutlineReview({ handoff, attemptDir: attempt.attemptDir, captures, targetPaths,
      outlineDigests, inventory, sessionId: safeInput.sessionId });
    if (review.state !== 'accepted' || review.captureDigest !== seam.reviewCaptureDigest
      || review.reviewDigest !== seam.reviewDigest || review.reviewerPrincipal !== seam.reviewerPrincipal) {
      return fail(review.reason || 'outline-review-changed-after-dispatch');
    }
    const correlation = correlateOutlineDispatch(captures, cap, seam.workerRoot);
    if (correlation.state !== 'accepted') return fail(correlation.reason);
    const worker = correlation.start;
    const workerRoot = correlation.workerRoot;
    if (review.reviewerPrincipal === worker.agent_id) return fail('outline-reviewer-is-draft-worker');
    const principals = { author: safeInput.sessionId, executors: journalExecutors(captures, safeInput.sessionId) };
    if (!reviewRecordIndependent(review.review, captures, principals)) return fail('outline-review-not-independent');
    // An agent whose start and unique stop both precede the dispatch cannot write after the seam; earlier writes
    // are covered by the clean-O seam check and by unattributedWriters below.
    const journal = Array.isArray(captures) ? captures : [];
    const dispatchIndex = journal.indexOf(correlation.pre);
    const uniqueLifecycle = start => {
      if (!textOf(start.session_id) || !textOf(start.agent_id)) return null;
      const lifecycle = event => journal.filter(item => recordOf(item) && item.event === event
        && item.session_id === start.session_id && textOf(start.agent_id) && item.agent_id === start.agent_id);
      // Exactly one Start and one Stop per (session_id, agent_id); a duplicate either way stays ambiguous.
      const starts = lifecycle('SubagentStart');
      const stops = lifecycle('SubagentStop');
      if (starts.length !== 1 || starts[0] !== start || stops.length !== 1) return null;
      const startIndex = journal.indexOf(start);
      const stopIndex = journal.indexOf(stops[0]);
      if (startIndex < 0 || stopIndex <= startIndex) return null;
      return { startIndex, stopIndex };
    };
    const stoppedBeforeDispatch = start => {
      const lifecycle = uniqueLifecycle(start);
      return Boolean(lifecycle && dispatchIndex >= 0 && lifecycle.stopIndex < dispatchIndex);
    };
    const startedAfterWorkerStop = start => {
      const lifecycle = uniqueLifecycle(start);
      const workerStopIndex = journal.indexOf(correlation.stop);
      return Boolean(lifecycle && workerStopIndex >= 0 && lifecycle.startIndex > workerStopIndex);
    };
    const competingStarts = journal.filter(item => recordOf(item)
      && item.event === 'SubagentStart' && item.ref !== worker.ref && sameCanonicalPath(item.cwd, workerRoot)
      && !stoppedBeforeDispatch(item) && !startedAfterWorkerStop(item));
    if (competingStarts.length) return fail('outline-competing-writer-start');
    // Reviewer lifecycle is exactly one Start and one Stop for its identity; a duplicate or missing record withholds credit.
    const reviewerLifecycle = event => journal.filter(item => recordOf(item) && item.event === event
      && item.agent_id === review.reviewerPrincipal).length;
    if (reviewerLifecycle('SubagentStart') !== 1 || reviewerLifecycle('SubagentStop') !== 1) {
      return fail('outline-review-result-missing-or-ambiguous');
    }
    // The O the reviewer recorded at launch must still be the O dispatch and the handoff name (#341 step 1).
    const identityNow = validateOutlineIdentity({ handoff, captures });
    if (identityNow.state !== 'accepted' || identityNow.identityDigest !== seam.outlineIdentityDigest) {
      return fail(identityNow.reason || 'outline-identity-mismatch');
    }
    // Review window: the reviewer's first record (or its launch result) through its SubagentStop.
    const reviewLaunchIds = new Set(journal.filter(item => recordOf(item) && item.event === 'PostToolUse'
      && ['Task', 'Agent'].includes(item.tool_name) && item.agent_id === review.reviewerPrincipal && textOf(item.tool_use_id))
      .map(item => item.tool_use_id));
    const writerWindow = {
      sessionId: safeInput.sessionId, root: taskState.baseline.root, targets: targetPaths, worker, workerRoot,
      captures: journal,
      reviewStartIndex: journal.findIndex(item => recordOf(item) && (item.agent_id === review.reviewerPrincipal
        || (textOf(item.tool_use_id) && reviewLaunchIds.has(item.tool_use_id)))),
      reviewStopIndex: journal.indexOf(review.review), dispatchIndex, workerStopIndex: journal.indexOf(correlation.stop),
    };
    const stateOperations = evaluateW6StateOperations(journal, sessionDir, {
      allowInFlightToolUseId: safeInput.allowInFlightW6ToolUseId,
    });
    if (stateOperations.required && !stateOperations.readyForAssessment) return fail('outline-state-operation-unresolved');
    writerWindow.stateOperationToolUseIds = stateOperations.required ? stateOperations.acceptedToolUseIds : new Set();
    const unattributedWriters = journal.filter((item, index) => possibleWriterCapture(item)
      && !outlineWriterAllowed(item, { ...writerWindow, index }));
    if (unattributedWriters.length) return fail('outline-writer-activity-ambiguous');
    // The B→O commit is accepted only if O changes exactly the pinned target(s) relative to B.
    const oChanged = outlineGit(seam.worktree.root, ['diff', '--name-only', '--no-renames', '-z', taskState.baseline.commit,
      handoff.outline.commit]).split('\0').filter(Boolean).sort(compareKeys);
    if (captureJson(oChanged) !== captureJson([...targetPaths].sort(compareKeys))) return fail('outline-commit-scope-invalid');
    // The cumulative diff hides content committed then reverted inside B..O, so every commit (merges too, per parent) must touch only the targets.
    const targetSet = new Set(targetPaths);
    const rangeCommits = outlineGit(seam.worktree.root, ['rev-list', `${taskState.baseline.commit}..${handoff.outline.commit}`])
      .split('\n').filter(Boolean);
    for (const commit of rangeCommits) {
      const touched = outlineGit(seam.worktree.root, ['diff-tree', '-r', '--root', '-m', '--no-commit-id', '--name-only',
        '--no-renames', '-z', commit]).split('\0').filter(Boolean);
      if (touched.some(file => !targetSet.has(file))) return fail('outline-commit-scope-invalid');
    }

    let candidateRoot;
    try { candidateRoot = canonicalOutlineRoot(safeInput.workspaceRoot); }
    catch { return fail('outline-candidate-root-unavailable'); }
    const baseline = taskState.baseline;
    const outlineCommit = handoff.outline.commit;
    let finalCommit;
    let finalTree;
    try {
      finalCommit = outlineGit(candidateRoot, ['rev-parse', '--verify', 'HEAD^{commit}']).trim();
      finalTree = outlineGit(candidateRoot, ['rev-parse', '--verify', 'HEAD^{tree}']).trim();
      outlineGit(candidateRoot, ['rev-parse', '--verify', `${outlineCommit}^{commit}`]);
      outlineGit(candidateRoot, ['rev-parse', '--verify', `${baseline.commit}^{commit}`]);
    } catch { return fail('outline-final-git-object-unavailable'); }
    if (finalCommit === outlineCommit) return fail('outline-final-draft-missing', 'unavailable');
    if (!outlineAncestry(candidateRoot, baseline.commit, outlineCommit)) return fail('outline-B-to-O-ancestry-invalid');
    let merge = { state: 'accepted', draftCommit: finalCommit, mergedCommit: finalCommit, targetPaths };
    if (!outlineAncestry(candidateRoot, outlineCommit, finalCommit)) {
      const mergeFile = path.join(attempt.attemptDir, 'merge-correspondence.json');
      const mergeLoaded = readOutlineJson(mergeFile);
      if (mergeLoaded.state !== 'accepted') return fail('outline-merge-correspondence-unavailable', 'unavailable');
      const correspondence = mergeLoaded.value;
      if (correspondence.taskId !== dispatch.taskId || correspondence.attemptId !== dispatch.attemptId
        || correspondence.baselineCommit !== baseline.commit) return fail('outline-merge-correspondence-mismatch');
      merge = verifyOutlineMergeCorrespondence({ root: candidateRoot, outlineCommit,
        draftCommit: correspondence.draftCommit, mergedCommit: finalCommit, targetPaths, record: correspondence });
      if (!['accepted', 'changed'].includes(merge.state)) return fail(merge.reason || 'outline-merge-correspondence-invalid', 'unavailable');
    }
    const draftArtifactDigests = {};
    const draftBlobOids = {};
    for (const target of targetPaths) {
      const atBaseline = outlineGit(candidateRoot, ['ls-tree', '-r', '--name-only', baseline.commit, '--', target]).trim();
      if (atBaseline.split('\n').filter(Boolean).includes(target)) return fail('outline-target-existed-at-B');
      let candidateBytes;
      let commitBytes;
      try {
        candidateBytes = fs.readFileSync(path.join(candidateRoot, ...target.split('/')));
        commitBytes = outlineGit(candidateRoot, ['show', `${finalCommit}:${target}`], true);
      } catch { return fail('outline-final-target-missing'); }
      if (!Buffer.from(candidateBytes).equals(commitBytes)) return fail('outline-final-working-tree-not-D');
      draftArtifactDigests[target] = outlineSha(commitBytes);
      draftBlobOids[target] = outlineGit(candidateRoot, ['rev-parse', `${finalCommit}:${target}`]).trim();
    }
    const independentOf = [...new Set([safeInput.sessionId, ...principals.executors])].filter(value => textOf(value) && value !== review.reviewerPrincipal);
    const event = {
      eventId: 'claude-outline-' + digestText(captureJson({ handoffDigest: attempt.handoffDigest,
        seamDigest: seamLoadedDigest(seamFile), draftCommit: finalCommit })),
      producerId: 'claude-code-origin-provider', originRef, principalId: review.reviewerPrincipal,
      provenance: `claude-code-outline-capture:${cap.captureId}`, capability: 'outline-confirmation', kind: 'review',
      verdict: 'approve', summary: review.review.reviewSummary, independentOf,
      identity: recordOf(request.identity) ? JSON.parse(JSON.stringify(request.identity)) : null,
      paths: targetPaths, reviewedArtifactDigests: { ...outlineDigests,
        [review.inventoryPath]: inventory.artifactDigest }, draftArtifactDigests,
      outlineEvidence: {
        schema: 'harness.outline-confirmation.v1', state: 'validated', taskId: dispatch.taskId,
        attemptId: dispatch.attemptId, inventoryRowId: handoff.inventory.rowId, domain: handoff.inventory.domain,
        inventoryPinDigest: seam.inventoryPinDigest, inventoryArtifactDigest: inventory.artifactDigest,
        baselineCommit: baseline.commit, outlineCommit, outlineTree: handoff.outline.tree,
        outlineBlobOids: Object.fromEntries(targetPaths.map(target => [target, handoff.outline.targetBlobs[target].blobOid])),
        outlineArtifactDigests: outlineDigests, draftCommit: merge.draftCommit, mergedCommit: finalCommit,
        draftTree: finalTree, draftBlobOids, draftArtifactDigests, handoffDigest: attempt.handoffDigest,
        reviewCaptureRef: review.review.ref, reviewCaptureDigest: review.captureDigest,
        reviewDigest: review.reviewDigest, seamDigest: seamLoadedDigest(seamFile), dispatchInputDigest: seam.dispatchInputDigest,
        dispatchToolUseId: cap.tool_use_id, coordinatorPrincipal: safeInput.sessionId,
        reviewerPrincipal: review.reviewerPrincipal, workerPrincipal: worker.agent_id,
        workerRoot, writerLeaseDigest: seam.writerLeaseDigest,
        ancestry: 'strict-descendant', mergeCorrespondence: merge.state === 'accepted' && merge.draftCommit === finalCommit ? null : merge,
        targetPaths,
      },
      captured: { captureRef: cap.ref, toolUseId: cap.tool_use_id, seamDigest: seamLoadedDigest(seamFile) },
    };
    return { status: 'accepted', originRef, event,
      correlation: { toolCorrelationId: cap.tool_use_id, resultRef: cap.responseRef } };
  } catch (error) {
    return fail(error.message === 'outline-git-unavailable' ? 'outline-git-unavailable' : 'outline-evidence-unresolved', 'unavailable');
  }
}

function seamLoadedDigest(file) {
  try { return outlineSha(fs.readFileSync(file)); } catch { return ''; }
}

// ---- Shared provider state ------------------------------------------------------

function supportedHostCheck(input, expectedHost = HOST_ID) {
  if ([HOST_ID, OPENCODE_HOST_ID].includes(expectedHost) && recordOf(input) && input.hostId === expectedHost) return null;
  const host = recordOf(input) && typeof input.hostId === 'string' ? input.hostId : 'unknown';
  return diagnostic('unsupported-host', {
    reason: `unsupported host ${host} has no matching capture implementation; hosts must not borrow another host's exit mapping`,
  });
}

function contentSignature(cap) {
  return captureJson({
    event: cap.event === undefined ? null : cap.event,
    command: cap.command === undefined ? null : cap.command,
    cwd: cap.cwd === undefined ? null : cap.cwd,
    tool_use_id: cap.tool_use_id === undefined ? null : cap.tool_use_id,
    session_id: cap.session_id === undefined ? null : cap.session_id,
    agent_id: cap.agent_id === undefined ? null : cap.agent_id,
    agent_type: cap.agent_type === undefined ? null : cap.agent_type,
    responseDigest: cap.responseDigest === undefined ? null : cap.responseDigest,
    reviewDigest: cap.reviewDigest === undefined ? null : cap.reviewDigest,
    interrupted: typeof cap.interrupted === 'boolean' ? cap.interrupted : null,
    is_interrupt: typeof cap.is_interrupt === 'boolean' ? cap.is_interrupt : null,
    failureDisposition: cap.failureDisposition === undefined ? null : cap.failureDisposition,
    reviewVerdict: cap.reviewVerdict === undefined ? null : cap.reviewVerdict,
    reviewSummary: cap.reviewSummary === undefined ? null : cap.reviewSummary,
  });
}

function rejected(code, reason) { return { status: 'rejected', diagnostics: [diagnostic(code, { reason: `${code}: ${reason}` })] }; }
function unavailable(code, reason) { return { status: 'unavailable', diagnostics: [diagnostic(code, { reason: `${code}: ${reason}` })] }; }

const createClaudeOriginProvider = input => {
  const safeInput = recordOf(input) ? input : {};

  function resolveContext(request) {
    const hostFail = supportedHostCheck(safeInput);
    if (hostFail) return { status: 'unavailable', diagnostics: [hostFail] };
    const qualification = evaluateQualification(safeInput);
    if (!qualification.open) return { status: 'unavailable', diagnostics: [qualification.fail] };
    const workspaceRoot = textOf(safeInput.workspaceRoot) ? safeInput.workspaceRoot : (recordOf(request) && textOf(request.workspaceRoot) ? request.workspaceRoot : '');
    const author = recordOf(safeInput.principals) && textOf(safeInput.principals.author) ? safeInput.principals.author : safeInput.sessionId;
    const executors = recordOf(safeInput.principals) && Array.isArray(safeInput.principals.executors) ? safeInput.principals.executors.filter(textOf) : [];
    const originRef = 'origin://claude-code/' + digestText(captureJson({
      hostId: HOST_ID,
      sessionId: safeInput.sessionId === undefined ? null : safeInput.sessionId,
      workspaceRoot,
      taskId: safeInput.taskId === undefined ? null : safeInput.taskId,
      workflowId: safeInput.workflowId === undefined ? null : safeInput.workflowId,
      workflowRevision: safeInput.workflowRevision === undefined ? null : safeInput.workflowRevision,
      author,
      executors: executors.slice(),
      qualificationSource: qualification.source,
    }));
    return {
      status: 'accepted',
      originRef,
      context: {
        workspaceId: 'ws-' + digestText(captureJson({ workspaceRoot })),
        sessionId: safeInput.sessionId === undefined ? '' : safeInput.sessionId,
        workflowId: textOf(safeInput.workflowId) ? safeInput.workflowId : '',
        workflowRevision: Number.isInteger(safeInput.workflowRevision) ? safeInput.workflowRevision : 0,
        taskId: textOf(safeInput.taskId) ? safeInput.taskId : '',
        principals: { author, executors: executors.slice() },
        activeHost: HOST_ID,
        baselineReference: `retained-live-capture:claude-325-3b-s2b:${digestText(originRef)}`,
        // The concrete workflow-start pin, when the caller supplies it. It is never inferred from the current state.
        ...(recordOf(safeInput.baseline) && textOf(safeInput.baseline.commit) && textOf(safeInput.baseline.root)
          ? { baseline: { commit: safeInput.baseline.commit, root: safeInput.baseline.root } } : {}),
        workspaceRoot,
      },
    };
  }

  function resolveEvent(request) {
    if (!recordOf(request) || !textOf(request.reference)) return unavailable('invalid-input', 'resolveEvent requires a nonempty event reference');
    const hostFail = supportedHostCheck(safeInput);
    if (hostFail) return { status: 'unavailable', diagnostics: [hostFail] };
    const qualification = evaluateQualification(safeInput);
    if (!qualification.open) return { status: 'unavailable', diagnostics: [qualification.fail] };
    const { reference } = request;
    const captures = Array.isArray(safeInput.captures) ? safeInput.captures : [];
    // A reference is `<captureRef>` (lifecycle events) or `<captureRef>#<capability>` (doc-check projections).
    const [captureRef, capability] = String(reference).split('#');
    const index = captures.findIndex(item => recordOf(item) && item.ref === captureRef);
    if (index === -1) return unavailable('origin-unavailable', `no captured host event is retained for reference ${reference}`);
    const cap = captures[index];
    const originRefResponse = resolveContext(request);
    if (!originRefResponse || originRefResponse.status !== 'accepted' || !textOf(originRefResponse.originRef)) {
      return unavailable('origin-unavailable', 'origin context did not resolve');
    }
    const originRef = originRefResponse.originRef;
    const author = recordOf(safeInput.principals) && textOf(safeInput.principals.author) ? safeInput.principals.author : safeInput.sessionId;
    const executors = recordOf(safeInput.principals) && Array.isArray(safeInput.principals.executors) ? safeInput.principals.executors.filter(textOf) : [];
    // Session binding: a record copied from another session can never belong to
    // this workflow's assessment.
    if (cap.session_id === undefined || cap.session_id !== safeInput.sessionId) {
      return rejected('record-origin-mismatch', `captured record session_id must equal the provider session to belong to this invocation (owner row: copied records from another session are rejected)`);
    }
    // Observation-time identity (I2c): a record captured under another workflow, revision or baseline pin is stale.
    if (cap.observedIdentity !== undefined && cap.observedIdentity !== null) {
      const observed = cap.observedIdentity;
      const pin = recordOf(safeInput.baseline) ? safeInput.baseline : null;
      const sameWorkflow = observed.workflowId === safeInput.workflowId && observed.workflowRevision === safeInput.workflowRevision;
      const samePin = !pin || (recordOf(observed.baselinePin) && observed.baselinePin.commit === pin.commit
        && samePathKey(observed.baselinePin.root, pin.root));
      if (!sameWorkflow || !samePin) {
        return rejected('identity-mismatch', 'the observed workflow revision or baseline pin differs from the current one; stale evidence loses credit');
      }
    }
    if (capability && !(recordOf(cap.observedIdentity))) {
      return rejected('identity-missing', 'a doc capability needs the workflow identity observed at capture time');
    }
    if (capability === 'outline-confirmation') {
      const outlineQualification = validateOutlineCaptureQualification(safeInput);
      if (!outlineQualification.open) {
        return unavailable('outline-live-gate-unmet', `positive outline credit is disabled until retained Claude prompt, coordinator, synchronous-boundary and worker-root capture is qualified (${outlineQualification.reason})`);
      }
      return resolveOutlineEvidence({ safeInput, capture: cap, captures, request, originRef });
    }
    // Replay: identical host-event content re-presented under a new reference
    // cannot become a new accepted event. The first recorded occurrence wins.
    const signature = contentSignature(cap);
    const firstOccurrence = captures.findIndex(item => recordOf(item) && contentSignature(item) === signature);
    if (firstOccurrence !== index) {
      return rejected('replayed-record', `identical host-event content already recorded (first occurrence index ${firstOccurrence}); a copied record cannot become a new accepted event by changing its reference`);
    }
    const producerId = 'claude-code-origin-provider';
    // Only true doc capabilities reach the doc-check branch; quality-review is the SubagentStop review branch below.
    if (capability && capability !== 'quality-review') {
      // Doc capability: only a registered, passed, fully covered doc-check invocation with retained stdout can cover it.
      if (cap.event !== 'PostToolUse') return rejected('capability-mismatch', 'only a PostToolUse check invocation can cover a doc capability');
      const registered = resolveDocCheckInvocation(cap.command, cap.cwd);
      if (registered.kind === 'not-candidate') return rejected('unregistered-command', 'the command is not a registered doc-check invocation; an arbitrary successful shell command never covers a doc capability');
      if (capability === 'conflict-check' && registered.conflictAssessment !== true) {
        return rejected('capability-mismatch', 'conflict-check requires the structurally parsed --conflict-assessment mode');
      }
      if (registered.kind === 'rejected' && registered.reason !== 'implementation-pin-mismatch') {
        if (registered.reason === 'implementation-not-installed') return rejected('implementation-not-installed', 'the registered check does not resolve to this install\'s own doc-check runtime; a different path earns no credit');
        return rejected('unregistered-command', `doc-check invocation rejected (${registered.reason}); no credit`);
      }
      if (cap.implementationDigest !== fileDigest(registered.installed)) return rejected('implementation-digest-mismatch', 'the installed doc-check digest differs from the one observed at capture; no credit');
      if (registered.kind === 'rejected') return rejected('implementation-pin-mismatch', 'the installed doc-check is not the shipped script (canonical digest differs from SHIPPED_DOC_CHECK_DIGEST); no credit');
      if (!(cap.tool_use_id && typeof cap.tool_use_id === 'string')) return rejected('tool-use-id-missing', 'absent or empty tool_use_id: the invocation cannot be correlated, no credit');
      if (typeof cap.interrupted !== 'boolean') return rejected('outcome-ambiguous', 'ambiguous interruption/success correlation cannot be treated as success');
      if (cap.interrupted === true) return rejected('interrupted-not-credited', 'interrupted success is not mapped to exit 0 (owner decision row 1)');
      if (captures.some((item, i) => recordOf(item) && i !== index && item.event === 'PostToolUseFailure'
        && item.tool_use_id === cap.tool_use_id && item.session_id === cap.session_id)) {
        return rejected('failure-invalidates-mapping', 'a PostToolUseFailure arrived for the same tool_use_id; the success mapping is voided');
      }
      if (typeof cap.stdout !== 'string') return rejected('stdout-withheld', 'retained stdout is absent or over the cap; the event is withheld and never credited');
      if (crypto.createHash('sha256').update(cap.stdout).digest('hex') !== cap.stdoutDigest) return rejected('stdout-digest-mismatch', 'retained stdout does not match its digest');
      // The raw host result must still be the one observed: its canonical digest and stdout must match the record.
      if (!recordOf(cap.toolResponse) || captureDigest(cap.toolResponse) !== cap.responseDigest || cap.toolResponse.stdout !== cap.stdout) {
        return rejected('payload-edited', 'the retained raw tool response does not match the recorded responseDigest; an edited payload is never credited');
      }
      let report;
      try { report = JSON.parse(cap.stdout); } catch { return rejected('stdout-not-json', 'retained stdout is not a JSON check report'); }
      if (!recordOf(report) || report.schema !== DOC_CHECK_SCHEMA || !recordOf(report.lint) || report.lint.exit !== 0) {
        return rejected('check-not-passed', 'the registered check did not pass lint; no capability is credited');
      }
      const projection = recordOf(report.capabilities) ? report.capabilities[capability] : undefined;
      if (!recordOf(projection) || projection.state !== 'pass') {
        return rejected('partial-coverage', `${capability} is ${projection ? projection.state : 'absent'}; partial coverage earns no credit`);
      }
      const paths = Array.isArray(projection.checkedPaths) ? projection.checkedPaths.slice() : [];
      if (!paths.length) return rejected('scope-empty', `${capability} checked no governed paths`);
      let corpusBinding;
      let baselineArtifactDigests;
      let derivedBinding;
      if (capability === 'derived-regenerate') {
        if (!registered.derivedView || paths.length !== 1 || paths[0] !== registered.derivedView) {
          return rejected('capability-mismatch', 'derived-regenerate requires the exact registered --derived-view path');
        }
        const binding = projection.binding;
        const corpus = binding && binding.sourceCorpus;
        const config = binding && binding.config;
        const generator = binding && binding.generator;
        const generation = binding && binding.generation;
        const comparison = binding && binding.comparison;
        if (!recordOf(binding) || binding.view !== registered.derivedView || !recordOf(corpus) || corpus.complete !== true
          || !Array.isArray(corpus.paths) || !corpus.paths.length || !recordOf(corpus.digests)
          || JSON.stringify([...new Set(corpus.paths)].sort(compareKeys)) !== JSON.stringify(corpus.paths)
          || JSON.stringify(Object.keys(corpus.digests).sort(compareKeys)) !== JSON.stringify(corpus.paths)
          || corpus.paths.some(relative => !textOf(relative) || path.isAbsolute(relative) || relative.split(/[\\/]/).includes('..')
            || !HEX64.test(String(corpus.digests[relative] || '')))
          || !recordOf(config) || !textOf(config.path) || path.isAbsolute(config.path)
          || config.path.split(/[\\/]/).includes('..') || !HEX64.test(String(config.digest || ''))
          || !Array.isArray(config.sources) || !recordOf(generator) || !textOf(generator.path)
          || !HEX64.test(String(generator.digest || '')) || !recordOf(generation) || generation.state !== 'pass'
          || !HEX64.test(String(generation.outputDigest || '')) || !recordOf(comparison) || comparison.state !== 'equal'
          || comparison.targetDigest !== generation.outputDigest) {
          return rejected('derived-binding-invalid', 'derived-regenerate stdout lacks complete generation, comparison, and input binding');
        }
        const configPath = path.resolve(cap.cwd, registered.config);
        const configRelative = path.relative(path.resolve(cap.cwd), configPath).split(path.sep).join('/');
        const observedDerived = recordOf(cap.observedDerivedDigests) ? cap.observedDerivedDigests : {};
        if (configRelative !== config.path || observedDerived[config.path] !== config.digest
          || observedDerived[registered.derivedView] !== comparison.targetDigest) {
          return rejected('derived-input-changed-after-check', 'the selected config or derived target changed before host capture');
        }
        const expectedObservedPaths = [...new Set([...corpus.paths, config.path, registered.derivedView])].sort(compareKeys);
        if (JSON.stringify(Object.keys(observedDerived).sort(compareKeys)) !== JSON.stringify(expectedObservedPaths)
          || corpus.paths.some(relative => observedDerived[relative] !== corpus.digests[relative])) {
          return rejected('derived-input-changed-after-check', 'a source path is missing or changed before host capture');
        }
        const configSources = config.sources;
        if (JSON.stringify(configSources.map(item => item && item.path)) !== JSON.stringify([...new Set(configSources.map(item => item && item.path))].sort(compareKeys))
          || configSources.some(item => !recordOf(item) || !textOf(item.path) || path.isAbsolute(item.path)
            || item.path.split(/[\\/]/).includes('..') || !['present', 'missing'].includes(item.presence)
            || (item.presence === 'present' ? !HEX64.test(String(item.digest || '')) : item.digest !== undefined))) {
          return rejected('derived-config-binding-invalid', 'derived-regenerate config source inventory is malformed');
        }
        const observedConfigSources = cap.observedDerivedConfigSources;
        if (!Array.isArray(observedConfigSources) || JSON.stringify(observedConfigSources) !== JSON.stringify(configSources)) {
          return rejected('config-changed-after-check', 'a config source changed between check and host capture');
        }
        const configSource = configSources.find(item => item.path === config.path);
        if (!configSource || configSource.presence !== 'present' || configSource.digest !== config.digest) {
          return rejected('derived-config-binding-invalid', 'the selected config is absent from the observed config inventory');
        }
        let configData;
        try { configData = JSON.parse(fs.readFileSync(configPath, 'utf8')); }
        catch { return rejected('derived-config-binding-invalid', 'the selected config cannot be read during assessment'); }
        const selectedViews = Array.isArray(configData.derived) ? configData.derived.filter(item => item && item.path === registered.derivedView) : [];
        const expectedGenerator = `node harness-everything/scripts/doc-lifecycle.js index --workspace . --config ${registered.config} --all`;
        if (selectedViews.length !== 1 || selectedViews[0].generator !== expectedGenerator) {
          return rejected('derived-generator-unsupported', 'the selected config does not declare the supported lifecycle index operation');
        }
        let generatorPath;
        try { generatorPath = fs.realpathSync(path.join(path.dirname(registered.installed), 'doc-lifecycle.js')); }
        catch { return rejected('derived-generator-unavailable', 'the installed lifecycle index generator is missing'); }
        if (generator.path !== generatorPath || fileDigest(generatorPath) !== generator.digest) {
          return rejected('derived-generator-mismatch', 'the lifecycle generator differs from the implementation observed in stdout');
        }
        let currentConfigSources;
        try {
          const lifecycle = require(generatorPath);
          currentConfigSources = lifecycle.configSourceInventory(cap.cwd, configPath);
        } catch { return rejected('derived-config-binding-invalid', 'the lifecycle config inventory is unavailable'); }
        if (!currentConfigSources || currentConfigSources.complete !== true
          || JSON.stringify(currentConfigSources.sources) !== JSON.stringify(configSources)) {
          return rejected('config-changed-after-check', 'the lifecycle config source inventory changed after the check');
        }
        if (!recordOf(request.identity) || !HEX64.test(String(request.identity.baselineDigest || ''))
          || !HEX64.test(String(request.identity.candidateDigest || '')) || !HEX64.test(String(request.identity.configDigest || ''))) {
          return rejected('identity-missing', 'derived-regenerate needs the complete snapshot identity');
        }
        derivedBinding = {
          ...binding,
          baselineDigest: request.identity.baselineDigest,
          candidateDigest: request.identity.candidateDigest,
          configIdentityDigest: request.identity.configDigest,
        };
      }
      if (capability === 'conflict-check') {
        const assessment = report.conflictAssessment;
        const corpus = assessment && assessment.corpus;
        const config = corpus && corpus.config;
        if (registered.conflictAssessment !== true || report.mode !== 'conflict-assessment'
          || assessment?.schema !== DOC_CHECK_CONFLICT_SCHEMA || assessment.state !== 'pass'
          || projection.corpus?.complete !== true || corpus?.complete !== true
          || !Array.isArray(corpus.paths) || !corpus.paths.length || !recordOf(corpus.digests)
          || !recordOf(config) || !textOf(config.path) || path.isAbsolute(config.path)
          || config.path.split(/[\\/]/).includes('..') || !HEX64.test(String(config.digest || ''))
          || !/^[0-9a-f]{40,64}$/.test(String(corpus.baseCommit || ''))
          || JSON.stringify([...new Set(corpus.paths)].sort(compareKeys)) !== JSON.stringify(corpus.paths)
          || JSON.stringify(Object.keys(corpus.digests).sort(compareKeys)) !== JSON.stringify(corpus.paths)
          || corpus.paths.some(relative => !textOf(relative) || path.isAbsolute(relative)
            || relative.split(/[\\/]/).includes('..') || !HEX64.test(String(corpus.digests[relative] || '')))) {
          return rejected('corpus-binding-invalid', 'conflict-check stdout does not carry a complete, structured full-corpus assessment');
        }
        const observedCorpus = recordOf(cap.observedCorpusDigests) ? cap.observedCorpusDigests : {};
        if (corpus.paths.some(relative => observedCorpus[relative] !== corpus.digests[relative])) {
          return rejected('corpus-changed-after-check', 'a full-corpus path is missing or changed between assessment and capture');
        }
        if (cap.observedConfigDigest !== config.digest) {
          return rejected('config-changed-after-check', 'the project-docs config changed between assessment and capture');
        }
        if (!recordOf(request.identity) || !HEX64.test(String(request.identity.baselineDigest || ''))
          || !HEX64.test(String(request.identity.candidateDigest || '')) || !HEX64.test(String(request.identity.configDigest || ''))) {
          return rejected('identity-missing', 'conflict-check needs the complete snapshot identity');
        }
        corpusBinding = {
          complete: true,
          paths: corpus.paths.slice(),
          digests: { ...corpus.digests },
          config: { ...config },
          baseCommit: corpus.baseCommit,
          baselineDigest: request.identity.baselineDigest,
          candidateDigest: request.identity.candidateDigest,
          configIdentityDigest: request.identity.configDigest,
        };
        baselineArtifactDigests = recordOf(assessment.baselineArtifacts) ? assessment.baselineArtifacts : {};
      }
      const observed = recordOf(cap.observedDigests) ? cap.observedDigests : {};
      const artifactDigests = {};
      const baselineArtifacts = {};
      for (const relative of paths) {
        if (typeof observed[relative] === 'string') artifactDigests[relative] = observed[relative];
        else if (capability === 'conflict-check' && HEX64.test(String(baselineArtifactDigests[relative] || ''))) baselineArtifacts[relative] = baselineArtifactDigests[relative];
        else return rejected('artifact-unobserved', `no observation-time digest for ${relative}`);
      }
      const argv = ['node', ...registered.argv];
      const command = argv.join(' ');
      const event = {
        eventId: 'claude-check-' + digestText(cap.captureId + ':' + capability),
        producerId,
        originRef,
        principalId: cap.session_id,
        provenance: 'claude-code-capture:' + cap.captureId,
        capability,
        kind: 'execution',
        command,
        argv,
        cwd: typeof cap.cwd === 'string' ? cap.cwd : '',
        exitCode: 0,
        signal: null,
        toolCorrelationId: cap.tool_use_id,
        resultRef: cap.responseRef,
        identity: recordOf(request.identity) ? JSON.parse(JSON.stringify(request.identity)) : null,
        startIdentity: recordOf(request.identity) ? JSON.parse(JSON.stringify(request.identity)) : null,
        endIdentity: recordOf(request.identity) ? JSON.parse(JSON.stringify(request.identity)) : null,
        paths,
        artifactDigests,
        ...(Object.keys(baselineArtifacts).length ? { baselineArtifacts } : {}),
        ...(corpusBinding ? { corpusBinding } : {}),
        ...(derivedBinding ? { derivedBinding } : {}),
        captured: { responseRef: cap.responseRef, responseDigest: cap.responseDigest },
      };
      return { status: 'accepted', originRef, event, correlation: { toolCorrelationId: cap.tool_use_id, resultRef: cap.responseRef } };
    }
    // A quality-review reference must name a SubagentStop review; it never falls through to the lifecycle branches below.
    if (capability === 'quality-review' && cap.event !== 'SubagentStop') {
      return rejected('capability-mismatch', 'quality-review is credited only from a SubagentStop review');
    }
    if (cap.event === 'PostToolUseFailure') {
      return rejected('failure-not-credited', 'PostToolUseFailure is never credited; its Exit code N text is diagnostics-only (owner decision row 1)');
    }
    if (cap.event === 'SubagentStart') {
      return rejected('capture-not-completed', 'SubagentStart records only a launch; a background launch is not a completed review or execution');
    }
    if (cap.event === 'PreToolUse') {
      return rejected('capture-not-completed', 'PreToolUse records only a launch; without a completed outcome it cannot be credited');
    }
    if (cap.event === 'PostToolUse') {
      if (!(cap.tool_use_id && typeof cap.tool_use_id === 'string')) {
        return rejected('tool-use-id-missing', 'absent or empty tool_use_id: the invocation cannot be correlated, no credit');
      }
      if (typeof cap.interrupted !== 'boolean') {
        return rejected('outcome-ambiguous', 'ambiguous interruption/success correlation cannot be treated as success');
      }
      if (cap.interrupted === true) {
        return rejected('interrupted-not-credited', 'interrupted success is not mapped to exit 0 (owner decision row 1)');
      }
      if (!textOf(cap.command) && typeof cap.command !== 'string') {
        return rejected('command-missing', 'captured record without a retained command cannot be credited');
      }
      const failureForInvocation = captures.some((item, i) => recordOf(item) && i !== index
        && item.event === 'PostToolUseFailure' && item.tool_use_id === cap.tool_use_id && item.session_id === cap.session_id);
      if (failureForInvocation) {
        return rejected('failure-invalidates-mapping', 'a PostToolUseFailure arrived for the same tool_use_id; the success mapping is voided (owner decision row 1)');
      }
      const eventId = 'claude-exit-map-' + digestText(signature + ':execution');
      const event = {
        eventId,
        producerId,
        originRef,
        principalId: cap.session_id,
        capability: 'shell-command',
        kind: 'execution',
        command: cap.command,
        argv: [cap.command],
        cwd: cap.cwd === undefined ? '' : cap.cwd,
        exitCode: 0,
        signal: null,
        toolCorrelationId: cap.tool_use_id,
        resultRef: cap.responseRef,
        identity: recordOf(request.identity) ? JSON.parse(JSON.stringify(request.identity)) : null,
        startIdentity: recordOf(request.identity) ? JSON.parse(JSON.stringify(request.identity)) : null,
        endIdentity: recordOf(request.identity) ? JSON.parse(JSON.stringify(request.identity)) : null,
        paths: [],
        artifactDigests: {},
        captured: { responseRef: cap.responseRef, responseDigest: cap.responseDigest },
      };
      return { status: 'accepted', originRef, event, correlation: { toolCorrelationId: cap.tool_use_id, resultRef: cap.responseRef } };
    }
    if (cap.event === 'SubagentStop') {
      const reviewer = cap.agent_id;
      if (!textOf(reviewer)) {
        return rejected('reviewer-principal-missing', 'SubagentStop without a host-issued agent_id cannot establish a reviewer principal; a caller-supplied name or review prose is not an agent identity');
      }
      // Executors: the configured principals plus every session and agent that ran a captured tool in this task (F4).
      const reviewerExecutors = [...new Set([...executors, ...journalExecutors(captures, author)])];
      if (reviewer === author) {
        return rejected('reviewer-not-independent', 'the reviewer agent_id equals the author session principal; not independent');
      }
      if (reviewerExecutors.includes(reviewer)) {
        return rejected('reviewer-not-independent', 'the reviewer agent_id equals an executor principal; not independent');
      }
      // An approval needs its own correlated Agent/Task result surface, never a bare SubagentStop (F5).
      if (!agentResultSurface(captures, reviewer)) {
        return rejected('agent-result-missing', 'no correlated Agent/Task result names this reviewer agent_id; without that surface the review is not approved');
      }
      if (capability === 'quality-review') {
        const taskId = safeInput.taskBinding?.taskId || safeInput.taskId;
        const boundary = taskScopedFinalReviewBoundary(captures, cap, taskId);
        if (boundary.scoped && !boundary.accepted) {
          return rejected('final-review-before-worker-closure', 'an outline-backed final review must launch after the correlated worker Stop and completed Agent result');
        }
      }
      if (!HEX64.test(String(cap.reviewDigest === undefined ? '' : cap.reviewDigest))) {
        return rejected('review-digest-missing', 'SubagentStop without a bound final review artifact digest cannot close a review');
      }
      // Approval only from an explicit structured verdict in the bound final artifact. SubagentStop alone never approves.
      if (cap.reviewVerdict === 'reject') {
        return rejected('review-not-approved', 'the final review artifact states reject; a reject never approves');
      }
      if (cap.reviewVerdict !== 'approve') {
        return rejected('review-verdict-missing', 'the final review artifact has no explicit structured verdict; SubagentStop alone is never approval');
      }
      if (!textOf(cap.reviewSummary)) {
        return rejected('review-summary-missing', 'an approve verdict needs a non-empty summary');
      }
      // The reviewed paths and their digests come from the explicit verdict, never from the caller (F6).
      if (!reviewedDigestsValid(cap.reviewedArtifactDigests)) {
        return rejected('reviewed-artifacts-missing', 'an approve verdict must name each reviewed path with its sha256 (Reviewed artifact lines); without them the review cannot bind the candidate');
      }
      const eventId = 'claude-review-' + digestText(signature + ':review');
      const independentOf = [];
      for (const candidate of [author, ...reviewerExecutors]) {
        if (textOf(candidate) && candidate !== reviewer && !independentOf.includes(candidate)) independentOf.push(candidate);
      }
      const event = {
        eventId,
        producerId,
        originRef,
        principalId: reviewer,
        provenance: 'claude-code-capture:' + cap.captureId,
        capability: 'quality-review',
        kind: 'review',
        verdict: 'approve',
        summary: cap.reviewSummary,
        independentOf,
        identity: recordOf(request.identity) ? JSON.parse(JSON.stringify(request.identity)) : null,
        paths: Object.keys(cap.reviewedArtifactDigests).sort(compareKeys),
        reviewedArtifactDigests: { ...cap.reviewedArtifactDigests },
        captured: {
          responseRef: cap.responseRef,
          responseDigest: cap.responseDigest,
          reviewDigest: cap.reviewDigest,
          agentId: reviewer,
          agentType: cap.agent_type === undefined ? null : cap.agent_type,
        },
      };
      return { status: 'accepted', originRef, event, correlation: { toolCorrelationId: cap.agent_id, resultRef: cap.responseRef } };
    }
    return rejected('capture-event-unsupported', `event ${String(cap.event)} is outside the retained capture vocabulary`);
  }

  return { resolveContext, resolveEvent };
};

function opencodeContentSignature(cap) {
  return captureJson({
    hostId: cap.hostId,
    tool: cap.tool === undefined ? null : cap.tool,
    command: cap.command === undefined ? null : cap.command,
    cwd: cap.cwd === undefined ? null : cap.cwd,
    status: cap.status === undefined ? null : cap.status,
    exit: cap.exit === undefined ? null : cap.exit,
    resultDigest: cap.result_digest === undefined ? null : cap.result_digest,
    error: cap.error === undefined ? null : cap.error,
  });
}

const createOpencodeOriginProvider = input => {
  const safeInput = recordOf(input) ? input : {};

  function resolveContext(request) {
    const hostFail = supportedHostCheck(safeInput, OPENCODE_HOST_ID);
    if (hostFail) return { status: 'unavailable', diagnostics: [hostFail] };
    const qualification = evaluateQualification(safeInput, OPENCODE_HOST_ID);
    if (!qualification.open) return { status: 'unavailable', diagnostics: [qualification.fail] };
    const workspaceRoot = textOf(safeInput.workspaceRoot) ? safeInput.workspaceRoot : (recordOf(request) && textOf(request.workspaceRoot) ? request.workspaceRoot : '');
    const sessionId = textOf(safeInput.sessionId) ? safeInput.sessionId : '';
    const workflowId = textOf(safeInput.workflowId) ? safeInput.workflowId : '';
    const workflowRevision = Number.isInteger(safeInput.workflowRevision) ? safeInput.workflowRevision : null;
    const taskId = textOf(safeInput.taskId) ? safeInput.taskId : '';
    if (!workspaceRoot || !sessionId || !workflowId || workflowRevision === null || !taskId) {
      return { status: 'unavailable', diagnostics: [diagnostic('invalid-input', { reason: 'OpenCode origin requires the recorded workspace, session, workflow, revision and task identity' })] };
    }
    const suppliedPrincipals = recordOf(safeInput.principals) ? safeInput.principals : {};
    const author = textOf(suppliedPrincipals.author) ? suppliedPrincipals.author : sessionId;
    const executors = Array.isArray(suppliedPrincipals.executors) ? suppliedPrincipals.executors.filter(textOf) : [sessionId];
    const originRef = 'origin://opencode/' + digestText(captureJson({
      hostId: OPENCODE_HOST_ID, sessionId, workspaceRoot, taskId, workflowId, workflowRevision,
      author, executors, qualificationSource: qualification.source,
    }));
    return {
      status: 'accepted', originRef,
      context: {
        workspaceId: 'ws-' + digestText(captureJson({ workspaceRoot })), sessionId, workflowId, workflowRevision, taskId,
        principals: { author, executors: executors.slice() }, activeHost: OPENCODE_HOST_ID,
        baselineReference: `retained-live-capture:opencode-341:${digestText(originRef)}`,
        ...(recordOf(safeInput.baseline) && textOf(safeInput.baseline.commit) && textOf(safeInput.baseline.root)
          ? { baseline: { commit: safeInput.baseline.commit, root: safeInput.baseline.root } } : {}),
        workspaceRoot,
      },
    };
  }

  function resolveEvent(request) {
    if (!recordOf(request) || !textOf(request.reference)) return unavailable('invalid-input', 'resolveEvent requires a nonempty event reference');
    const hostFail = supportedHostCheck(safeInput, OPENCODE_HOST_ID);
    if (hostFail) return { status: 'unavailable', diagnostics: [hostFail] };
    const qualification = evaluateQualification(safeInput, OPENCODE_HOST_ID);
    if (!qualification.open) return { status: 'unavailable', diagnostics: [qualification.fail] };
    const [captureRef, capability] = String(request.reference).split('#');
    const captures = Array.isArray(safeInput.captures) ? safeInput.captures : [];
    const matches = captures.map((item, index) => ({ item, index })).filter(({ item }) => recordOf(item) && item.call_id === captureRef);
    if (!matches.length) return unavailable('origin-unavailable', `no captured OpenCode event is retained for reference ${request.reference}`);
    if (matches.length > 1) return rejected('replayed-record', 'multiple OpenCode records share this call id');
    const { item: cap, index } = matches[0];
    if (cap.hostId !== OPENCODE_HOST_ID || cap.schema !== OPENCODE_CAPTURE_RECORD_VERSION
      || cap.session_id !== safeInput.sessionId) {
      return rejected('record-origin-mismatch', 'the capture host and session must match this OpenCode provider invocation');
    }
    const observed = cap.observedIdentity;
    const pin = recordOf(safeInput.baseline) ? safeInput.baseline : null;
    if (!recordOf(observed)) return rejected('identity-missing', 'OpenCode capture lacks workflow identity observed at capture time');
    const sameWorkflow = observed.workflowId === safeInput.workflowId && observed.workflowRevision === safeInput.workflowRevision;
    const samePin = !pin || (recordOf(observed.baselinePin) && observed.baselinePin.commit === pin.commit
      && samePathKey(observed.baselinePin.root, pin.root));
    if (!sameWorkflow || !samePin) return rejected('identity-mismatch', 'the observed workflow revision or baseline pin differs from the current one; stale evidence loses credit');
    const signature = opencodeContentSignature(cap);
    const firstOccurrence = captures.findIndex(item => recordOf(item) && opencodeContentSignature(item) === signature);
    if (firstOccurrence !== index) return rejected('replayed-record', `identical OpenCode tool content already recorded (first occurrence index ${firstOccurrence})`);
    if (cap.error !== undefined && cap.error !== null) return rejected('failure-not-credited', 'the native tool event carries an error');
    if (typeof cap.status !== 'string' || !cap.status) return rejected('outcome-ambiguous', 'the native tool status is missing');
    if (cap.status !== 'completed') return rejected(cap.status === 'error' ? 'failure-not-credited' : 'outcome-ambiguous', `native tool status ${cap.status} does not prove completion`);
    const processTool = ['bash', 'shell', 'powershell', 'cmd'].includes(String(cap.tool).toLowerCase());
    if (processTool && !Number.isInteger(cap.exit)) return rejected('outcome-ambiguous', 'a process result without a numeric native exit is ambiguous');
    if (processTool && cap.exit !== 0) return rejected('failure-not-credited', `the native process exit was ${cap.exit}`);
    if (!/^[0-9a-f]{64}$/.test(String(cap.result_digest || '')) || !Number.isInteger(cap.result_bytes) || cap.result_bytes < 0) {
      return rejected('stdout-withheld', 'the native result digest and byte count are absent');
    }
    const author = recordOf(safeInput.principals) && textOf(safeInput.principals.author) ? safeInput.principals.author : safeInput.sessionId;
    if (capability === 'quality-review') {
      if (!textOf(cap.agent_id)) return rejected('reviewer-principal-missing', 'OpenCode supplied no host-issued reviewer identity');
      if (cap.agent_id === author) return rejected('reviewer-not-independent', 'the reviewer identity equals the author session principal');
      return rejected('reviewer-principal-missing', 'OpenCode supplied no host-issued independent-review record');
    }
    if (capability) {
      if (!['doc-lint', 'link-check'].includes(capability)) return rejected('capability-mismatch', `OpenCode cannot supply capability ${capability}`);
      if (!textOf(cap.command)) return rejected('command-missing', 'the native record has no command for a registered doc-check');
      if (!textOf(cap.cwd)) return rejected('unregistered-command', 'the host omitted per-tool cwd, so the doc-check invocation cannot be validated');
      const registered = resolveDocCheckInvocation(cap.command, cap.cwd);
      if (registered.kind !== 'accepted') return rejected('unregistered-command', `doc-check invocation rejected (${registered.reason}); no credit`);
      return rejected('stdout-withheld', 'the OpenCode result body is retained only as a digest and cannot prove doc-check output');
    }
    if (!textOf(cap.command)) return rejected('command-missing', 'captured OpenCode record has no retained process command');
    if (!textOf(cap.cwd)) return rejected('outcome-ambiguous', 'the host omitted per-tool cwd');
    if (!processTool) return rejected('capture-event-unsupported', `tool ${String(cap.tool)} has no OpenCode process mapping`);
    if (!recordOf(request.identity)) return rejected('identity-missing', 'execution evidence needs a snapshot identity');
    const contextResponse = resolveContext(request);
    if (contextResponse.status !== 'accepted') return unavailable('origin-unavailable', 'origin context did not resolve');
    const identity = JSON.parse(JSON.stringify(request.identity));
    const resultRef = `opencode-result/${cap.call_id}/${cap.result_digest}`;
    const event = {
      eventId: 'opencode-exec-' + digestText(signature + ':execution'),
      producerId: 'opencode-origin-provider', originRef: contextResponse.originRef,
      principalId: cap.session_id, provenance: 'opencode-capture:' + cap.call_id,
      capability: 'shell-command', kind: 'execution', command: cap.command, argv: [cap.command], cwd: cap.cwd,
      exitCode: cap.exit, signal: null, toolCorrelationId: cap.call_id, resultRef,
      identity, startIdentity: identity, endIdentity: identity,
      paths: [], artifactDigests: {}, captured: { responseRef: resultRef, responseDigest: cap.result_digest },
    };
    return { status: 'accepted', originRef: contextResponse.originRef, event,
      correlation: { toolCorrelationId: cap.call_id, resultRef } };
  }

  return { resolveContext, resolveEvent };
};

// ---- Capture record builder (consumed by state-persist.js) ----------------------

// Builds the retained capture record for a Claude hook payload. The field names
// are the doc's capture-table vocabulary (docs/doc-workflow-reconciliation.md
// § S2b). Absent input fields stay absent in the record, never invented.
// Responses:
// - value capturing the event, or null when the payload does not describe a
//   supported capture event.
let captureSequence = 0;

function buildCaptureRecord(payload, eventName, workspaceRoot, options = {}) {
  if (!recordOf(payload)) return null;
  const event = typeof eventName === 'string' ? eventName : (payload.hook_event_name || payload.hookEventName || '');
  if (['PreToolUse', 'PostToolUse', 'PostToolUseFailure', 'SubagentStart', 'SubagentStop'].indexOf(event) === -1) return null;
  // PreToolUse is captured only for the launches whose outcome the pilot can later correlate.
  if (event === 'PreToolUse' && PRE_CAPTURE_TOOLS.indexOf(payload.tool_name) === -1) return null;
  const toolInput = recordOf(payload.tool_input) ? payload.tool_input : {};
  const toolResponse = payload.tool_response;
  const rawExitCode = recordOf(toolResponse) ? (toolResponse.exitCode ?? toolResponse.exit_code) : payload.exitCode;
  const outlinePre = event === 'PreToolUse' && ['Task', 'Agent'].includes(payload.tool_name);
  const outlineResult = event === 'PostToolUse' && ['Task', 'Agent'].includes(payload.tool_name);
  // Demonstrated alias mapping (doc: "Host result aliases such as agentId
  // require a demonstrated capture mapping to the same subagent identity"):
  // the PostToolUse Task/Agent result surface reports the subagent id as
  // tool_response.agentId. No other alias is guessed.
  const responseAliasAgentId = recordOf(toolResponse) && typeof toolResponse.agentId === 'string' && toolResponse.agentId.trim() ? toolResponse.agentId : undefined;
  const captureId = `${event}:${new Date().toISOString()}:${process.pid}:${captureSequence += 1}`;
  const record = {
    captureId,
    // Stable origin ref: the reference the assessment looks up (the journal also keeps captureId and responseRef).
    ref: captureId,
    event,
    command: typeof toolInput.command === 'string' ? toolInput.command : '',
    tool_use_id: typeof payload.tool_use_id === 'string' ? payload.tool_use_id : '',
    session_id: payload.session_id === undefined && payload.sessionId === undefined ? '' : String(payload.session_id !== undefined ? payload.session_id : payload.sessionId),
    responseDigest: captureDigest(toolResponse),
    responseRef: `host-payload/${event}/${captureId}`,
  };
  if (typeof rawExitCode === 'number') record.exitCode = rawExitCode;
  const parsedWriterCommand = event === 'PreToolUse' && payload.tool_name === 'Bash'
    ? safeTokenize(record.command.trim()) : null;
  const writerMayNeedCwd = OUTLINE_WRITE_TOOLS.includes(payload.tool_name)
    || (parsedWriterCommand?.ok && parsedWriterCommand.tokens[0] === 'git'
      && ['add', 'commit'].includes(parsedWriterCommand.tokens[1]));
  if (typeof payload.cwd === 'string' && payload.cwd) record.cwd = payload.cwd;
  else if (!writerMayNeedCwd && !['SubagentStart', 'SubagentStop'].includes(event)
    && typeof workspaceRoot === 'string' && workspaceRoot) record.cwd = workspaceRoot;
  if (payload.prompt_id !== undefined) record.prompt_id = payload.prompt_id;
  if (payload.parent_tool_use_id !== undefined) record.parent_tool_use_id = payload.parent_tool_use_id;
  // The launch tool name separates the Agent/Task result surface and the subagent launch from executed tools (F4/F5).
  if (typeof payload.tool_name === 'string') record.tool_name = payload.tool_name;
  // The write target and its PreToolUse topology snapshot are path evidence for W1/W2; absent for other tools.
  if (OUTLINE_WRITE_TOOLS.includes(payload.tool_name)) record.writeTargets = writeTargetsOf(payload.tool_name, payload.tool_input);
  // shortcut: this snapshot cannot close capture-to-operation races; upgrade if the host can bind path proof atomically.
  if (event === 'PreToolUse') {
    let topologyTargets = OUTLINE_WRITE_TOOLS.includes(payload.tool_name) ? record.writeTargets : null;
    let allowMissing = OUTLINE_WRITE_TOOLS.includes(payload.tool_name);
    if (payload.tool_name === 'Bash') {
      const parsed = safeTokenize(record.command.trim());
      if (parsed.ok && parsed.tokens[0] === 'git' && parsed.tokens[1] === 'add') {
        const args = parsed.tokens.slice(2);
        topologyTargets = args[0] === '--' ? args.slice(1) : args;
        allowMissing = false;
      }
    }
    if (Array.isArray(topologyTargets)) {
      record.outlineWriteTopology = topologyTargets.map(target => {
        const recognized = recognizeOutlineTarget(target, { root: workspaceRoot, cwd: record.cwd, toolName: payload.tool_name });
        return recognized ? outlineFilesystemProof(workspaceRoot, record.cwd, recognized.candidate, allowMissing)
          : { path: null, state: 'unresolved' };
      });
    }
  }
  if (outlinePre) {
    if (Object.prototype.hasOwnProperty.call(toolInput, 'run_in_background')) record.run_in_background = toolInput.run_in_background;
    record.isolationSet = Object.prototype.hasOwnProperty.call(toolInput, 'isolation');
  }
  if (outlineResult && recordOf(toolResponse) && Object.prototype.hasOwnProperty.call(toolResponse, 'status')) {
    record.tool_response_status = toolResponse.status;
  }
  const resultAgentConflict = outlineResult && textOf(payload.agent_id) && textOf(responseAliasAgentId)
    && payload.agent_id !== responseAliasAgentId;
  const agentId = outlineResult ? (resultAgentConflict ? undefined : responseAliasAgentId)
    : payload.agent_id !== undefined ? payload.agent_id : responseAliasAgentId;
  if (agentId !== undefined) {
    record.agent_id = agentId;
    if (payload.agent_type !== undefined) record.agent_type = payload.agent_type;
  }
  if (payload.duration_ms !== undefined) record.duration_ms = payload.duration_ms;
  if (event === 'PostToolUse') {
    // An absent interrupted field stays absent: it is unknown, not false (A3 section 1).
    if (recordOf(toolResponse) && typeof toolResponse.interrupted === 'boolean') record.interrupted = toolResponse.interrupted;
    // A registered doc-check invocation keeps its full stdout (capped), a digest of it, and the checked paths' digests
    // at observation time. Assessment re-parses the stdout; nothing is trusted from an agent-written field.
    const installedCheck = resolveDocCheckInvocation(record.command, record.cwd);
    if (installedCheck.kind === 'accepted' || installedCheck.reason === 'implementation-pin-mismatch') {
      // Record the observed bytes even when unpinned; only an accepted result may retain stdout.
      record.implementationDigest = installedCheck.digest;
    }
    // G0: an unpinned doc-check keeps its digest only; its output is never retained, so no capture credit can be recorded.
    if (installedCheck && record.implementationDigest === SHIPPED_DOC_CHECK_DIGEST) {
      const stdout = recordOf(toolResponse) && typeof toolResponse.stdout === 'string' ? toolResponse.stdout : '';
      record.stdoutDigest = crypto.createHash('sha256').update(stdout).digest('hex');
      if (Buffer.byteLength(stdout) <= STDOUT_CAP_BYTES) {
        record.stdout = stdout;
        // The full tool response is retained so assessment can recompute responseDigest from the same bytes.
        record.toolResponse = toolResponse;
      } else { record.stdout = null; record.stdoutTruncated = true; }
      let checkedPaths = [];
      let conflictCorpus = null;
      try {
        const report = JSON.parse(stdout);
        checkedPaths = ['doc-lint', 'link-check'].flatMap(capability => (recordOf(report.capabilities) && recordOf(report.capabilities[capability])
          && Array.isArray(report.capabilities[capability].checkedPaths) ? report.capabilities[capability].checkedPaths : []));
        const derived = recordOf(report.capabilities) && report.capabilities['derived-regenerate'];
        const derivedBinding = recordOf(derived) && recordOf(derived.binding) ? derived.binding : null;
        if (installedCheck.derivedView && typeof workspaceRoot === 'string' && workspaceRoot && derivedBinding && derivedBinding.view === installedCheck.derivedView
          && recordOf(derivedBinding.sourceCorpus) && Array.isArray(derivedBinding.sourceCorpus.paths)
          && recordOf(derivedBinding.config) && Array.isArray(derivedBinding.config.sources)) {
          checkedPaths.push(derivedBinding.view);
          record.observedDerivedDigests = observedDigestsFor(workspaceRoot,
            [...derivedBinding.sourceCorpus.paths, derivedBinding.config.path, derivedBinding.view]);
          record.observedDerivedConfigSources = observedConfigSourcesFor(workspaceRoot, derivedBinding.config.sources);
        }
        const conflict = recordOf(report.capabilities) && report.capabilities['conflict-check'];
        if (installedCheck.conflictAssessment === true && report.mode === 'conflict-assessment'
          && recordOf(conflict) && conflict.state === 'pass' && recordOf(conflict.corpus)) {
          checkedPaths.push(...(Array.isArray(conflict.checkedPaths) ? conflict.checkedPaths : []));
          conflictCorpus = report.conflictAssessment && report.conflictAssessment.corpus;
        }
      } catch { /* not JSON: no paths observed, the event will be withheld */ }
      record.observedDigests = typeof workspaceRoot === 'string' && workspaceRoot ? observedDigestsFor(workspaceRoot, [...new Set(checkedPaths)]) : {};
      if (recordOf(conflictCorpus) && Array.isArray(conflictCorpus.paths) && recordOf(conflictCorpus.config)) {
        record.observedCorpusDigests = typeof workspaceRoot === 'string' && workspaceRoot
          ? observedDigestsFor(workspaceRoot, conflictCorpus.paths) : {};
        record.observedConfigDigest = typeof workspaceRoot === 'string' && workspaceRoot
          ? observedDigestsFor(workspaceRoot, [conflictCorpus.config.path])[conflictCorpus.config.path] || null : null;
      }
    }
  } else if (event === 'PostToolUseFailure') {
    record.is_interrupt = Boolean(payload.is_interrupt);
    record.failureDisposition = /Exit code (\d+)/.exec(String(payload.error === undefined ? '' : payload.error)) ? 'nonzero-exit' : 'host-failure-error';
  } else if (event === 'SubagentStop') {
    record.reviewDigest = digestText(String(payload.last_assistant_message === undefined ? '' : payload.last_assistant_message));
    const verdict = parseReviewVerdict(payload.last_assistant_message);
    record.reviewVerdict = verdict ? verdict.verdict : null;
    record.reviewSummary = verdict ? verdict.summary : null;
    record.reviewedArtifactDigests = verdict ? verdict.reviewedArtifactDigests : {};
    if (payload.agent_transcript_path !== undefined) record.agentTranscriptPath = payload.agent_transcript_path;
  }
  const stateOperation = captureW6StateOperation(payload, event, record, options.sessionDir, workspaceRoot);
  if (stateOperation) record.stateOperation = stateOperation;
  return record;
}

// ---- Immutable per-event capture records (I2c) ----------------------------------------------------------------------
// Each capture is one event file, created exclusively and never rewritten by this code. The compatibility journal
// `doc-reconciliation-capture.json` is rebuilt from those files, and readers compare the two. This detects accidental and
// journal-only edits. It does not stop the local agent from rewriting event files, which the owner's bound accepts (F13).
// F13 includes rewriting the reviewer Start event's W2 `outlineIdentity`; W2 revalidation assumes authentic captured
// events and does not authenticate locally rewritten capture state.
const EVENT_DIR = 'doc-reconciliation-capture';
const JOURNAL_FILE = 'doc-reconciliation-capture.json';
const EVENT_NAME = /^\d{8}\.json$/;

function immutableEventFiles(sessionDir) {
  const dir = path.join(sessionDir, EVENT_DIR);
  if (!fs.existsSync(dir)) return null;
  return fs.readdirSync(dir).filter(name => EVENT_NAME.test(name)).sort()
    .map(name => JSON.parse(fs.readFileSync(path.join(dir, name), 'utf8')));
}

function writeImmutableEvent(sessionDir, entry) {
  const dir = path.join(sessionDir, EVENT_DIR);
  fs.mkdirSync(dir, { recursive: true });
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const sequence = fs.readdirSync(dir).filter(name => EVENT_NAME.test(name)).length + 1 + attempt;
    try {
      fs.writeFileSync(path.join(dir, String(sequence).padStart(8, '0') + '.json'), JSON.stringify(entry, null, 2) + '\n', { encoding: 'utf8', flag: 'wx' });
      return;
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
    }
  }
  throw new Error('capture-sequence-exhausted');
}

function rebuildJournalView(sessionDir) {
  const records = immutableEventFiles(sessionDir) || [];
  const journalFile = path.join(sessionDir, JOURNAL_FILE);
  const tempFile = `${journalFile}.${process.pid}.tmp`;
  fs.writeFileSync(tempFile, JSON.stringify({ version: 1, records }, null, 2), 'utf8');
  fs.renameSync(tempFile, journalFile);
}

// The records a reader may use: the journal view, provided it still equals the immutable event files. Otherwise tampered.
function readCaptureView(sessionDir) {
  let view = [];
  try {
    const journal = JSON.parse(fs.readFileSync(path.join(sessionDir, JOURNAL_FILE), 'utf8'));
    view = Array.isArray(journal.records) ? journal.records : [];
  } catch { view = []; }
  const events = immutableEventFiles(sessionDir);
  if (events && captureJson(events) !== captureJson(view)) return { records: [], tampered: true };
  return { records: view, tampered: false };
}

function readOpencodeCaptureView(sessionDir) {
  const file = path.join(sessionDir, OPENCODE_CAPTURE_FILE);
  try {
    if (fs.statSync(file).size > OPENCODE_CAPTURE_LIMIT_BYTES) return { records: [], tampered: true };
    const text = fs.readFileSync(file, 'utf8');
    const records = text.split(/\r?\n/).filter(Boolean).map(line => JSON.parse(line));
    if (!records.every(item => recordOf(item) && item.schema === OPENCODE_CAPTURE_RECORD_VERSION
      && item.hostId === OPENCODE_HOST_ID && textOf(item.session_id) && textOf(item.call_id)
      && textOf(item.tool) && Object.prototype.hasOwnProperty.call(item, 'status'))) {
      return { records: [], tampered: true };
    }
    return { records, tampered: false };
  } catch (error) {
    if (error.code === 'ENOENT') return { records: [], tampered: false };
    return { records: [], tampered: true };
  }
}

// Observation-time identity: the workflow and pin the host event was captured under. Absent before a workflow starts.
function observedIdentityFor(sessionDir) {
  try {
    const workflow = JSON.parse(fs.readFileSync(path.join(sessionDir, 'workflow-run.json'), 'utf8'));
    return { workflowId: workflow.workflowId, workflowRevision: workflow.revision,
      baselinePin: workflow.docReconciliationBaseline || null, taskPin: workflow.docReconciliationTask || null };
  } catch {
    return null;
  }
}

// Independence rules for a completed host review (owner decision row 2), usable without the credit qualification gate:
// the reviewer is a host agent_id that differs from the author session and every executor, the surfaces agree, the final
// artifact digest is bound, and the verdict is an explicit approve with a non-empty summary. REJECT never approves.
function reviewRecordIndependent(cap, captures, principals) {
  if (!recordOf(cap) || cap.event !== 'SubagentStop' || !textOf(cap.agent_id)) return false;
  const executors = [...new Set([...(recordOf(principals) && Array.isArray(principals.executors) ? principals.executors : []),
    ...journalExecutors(captures, principals.author)])];
  if (cap.agent_id === principals.author || executors.includes(cap.agent_id)) return false;
  if (!agentResultSurface(captures, cap.agent_id)) return false;
  if (!HEX64.test(String(cap.reviewDigest === undefined ? '' : cap.reviewDigest))) return false;
  if (!reviewedDigestsValid(cap.reviewedArtifactDigests)) return false;
  return cap.reviewVerdict === 'approve' && textOf(cap.reviewSummary);
}

// Keep the old state-persist seam as an alias; it points at the single resolver above.
module.exports = { createClaudeOriginProvider, createOpencodeOriginProvider, buildCaptureRecord, resolveDocCheckInvocation,
  registeredInstalledCheck: resolveDocCheckInvocation, installedDocCheck,
  fileDigest, SHIPPED_DOC_CHECK_DIGEST, trustRisk, journalExecutors, reviewRecordIndependent,
  captureOutlineDispatch, captureOutlineStartIdentity, writeImmutableEvent, rebuildJournalView, readCaptureView,
  readOpencodeCaptureView, observedIdentityFor, isW6StateCommand, isVerifiedW6StateOperation, pendingW6VerificationInvocation,
  _internals: { validateOutlineIdentity, captureJson, captureDigest, digestText, canonicalCapture, safeTokenize, parseOutlineDispatchPrompt,
    parseInventoryPinRows, validateOutlineInventoryPin, resolveInventoryRow, parseOutlineCitation, resolveOutlineAttempt,
    validateOutlineReview,
    captureOutlineDispatch, resolveOutlineEvidence, verifyOutlineMergeCorrespondence, validateOutlineCaptureQualification,
    outlineCaptureMappingValid, correlateOutlineDispatch, evaluateW6StateOperations, validateW6StateOperationPair,
    OUTLINE_CAPTURE_MAPPING, OUTLINE_INVENTORY_PIN, W6_STATE_OPERATION_SCHEMA, W6_ROW17_REQUIREMENTS } };
