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
// - Unsupported hosts (opencode/codex) never borrow the Claude exit mapping:
//   both seam methods report `unavailable` with diagnostics.
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

const HOST_ID = 'claude-code';
const CAPTURE_RECORD_VERSION = 'claude-capture-record/1';
const QUALIFICATION_EXPORT_SCHEMA = 'harness.doc-reconciliation.qualification.v1';
const HEX64 = /^[0-9a-f]{64}$/;
const PRE_CAPTURE_TOOLS = ['Bash', 'PowerShell', 'Task', 'Agent'];
const STDOUT_CAP_BYTES = 1024 * 1024;
const DOC_CHECK_FLAGS = new Set(['--workspace', '--config', '--changed-path', '--base']);
const DOC_CHECK_SCHEMA = 'harness.doc-check.check.v1';
const DOC_CHECK_SHELLS = new Set(['sh', 'bash', 'dash', 'zsh', 'ksh', 'fish']);
const DOC_CHECK_LAUNCHERS = new Set(['node', 'nodejs', 'bun', 'deno', 'tsx', 'ts-node']);
const DOC_CHECK_LAUNCHER_VALUE_FLAGS = new Set(['-r', '--require', '--import', '--loader', '--experimental-loader', '--inspect-port', '--input-type', '--conditions', '--env-file']);
const DOC_CHECK_WRAPPERS = new Set(['env', 'npx']);
const DOC_CHECK_ENV_VALUE_FLAGS = new Set(['-u', '--unset', '-C', '--chdir']);
const DOC_CHECK_NPX_VALUE_FLAGS = new Set(['-p', '--package', '--prefix', '--cache', '--userconfig', '--registry', '--workspace', '-w']);
// Canonical SHA-256 of harness-everything/scripts/doc-check.js (CRLF normalised to LF). Re-pin deliberately when that script changes.
const SHIPPED_DOC_CHECK_DIGEST = 'da5e51a763eda6680afb63ee781b566253df9d358eec1e65436786c9ecebbbdb';
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
      token += next;
      active = true;
      index += 1;
      continue;
    }
    if (';&|<>()'.includes(ch)) return { ok: false, reason: 'shell-operator' };
    if ('*?[]{}~'.includes(ch) || ch === '$' || ch === '`') return { ok: false, reason: 'shell-expansion' };
    if (ch === '#' && !active) return { ok: false, reason: 'shell-comment' };
    token += ch;
    active = true;
  }
  if (quote) return { ok: false, reason: 'unclosed-quote' };
  push();
  return { ok: true, tokens };
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
    if (quote === "'") {
      if (ch === "'") quote = null;
      else token += ch;
      continue;
    }
    if (quote === '"') {
      if (ch === '"') { quote = null; continue; }
      if (ch === '\\' && command[index + 1] !== undefined) {
        token += command[++index];
        active = true;
        continue;
      }
      token += ch;
      active = true;
      continue;
    }
    if (ch === "'" || ch === '"') { quote = ch; active = true; continue; }
    if (ch === '\\' && command[index + 1] !== undefined) {
      token += command[index + 1];
      if (command[index + 1] === '\r' && command[index + 2] === '\n') index += 2;
      else index += 1;
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
  for (let index = 3; index < tokens.length; index += 2) {
    const flag = tokens[index];
    const value = tokens[index + 1];
    if (!DOC_CHECK_FLAGS.has(flag)) return rejected('unknown-flag');
    if (value === undefined || !value || value.startsWith('--')) return rejected('flag-value-missing');
    if (flag === '--changed-path') changedPaths.push(value);
    else {
      if (values.has(flag)) return rejected('duplicate-flag');
      values.set(flag, value);
    }
  }
  if (!values.has('--workspace') || !values.has('--config') || !changedPaths.length) {
    return rejected('required-flag-missing');
  }

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
  return { kind: 'accepted', reason: null, installed: registered.installed, digest, argv };
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

// Executor principals of this task (owner #325, 2026-10-21: the reviewer "must differ from the author's `session_id` and
// from every executor principal"; an executor principal is the principal of execution evidence used in this assessment).
// The author session is always an executor. Other executors are the principals of a registered doc-check run, the only
// execution evidence a doc obligation uses. Acceptance is not required, so the set over-approximates and fails closed:
// a reviewer whose registered run was refused still counts as an executor. Read-only tool use, such as a plain Bash
// call, does not make a reviewer an executor. The Agent/Task launch surface is never execution evidence.
function journalExecutors(captures, author) {
  const executors = new Set(textOf(author) ? [author] : []);
  for (const item of Array.isArray(captures) ? captures : []) {
    if (!recordOf(item) || item.event !== 'PostToolUse') continue;
    if (item.tool_name === 'Agent' || item.tool_name === 'Task') continue;
    if (resolveDocCheckInvocation(item.command, item.cwd).kind === 'not-candidate') continue;
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
function validateQualificationExport() {
  const exported = JSON.parse(fs.readFileSync(path.join(__dirname, EXPORT_FILE), 'utf8'));
  if (!recordOf(exported) || exported.schema !== QUALIFICATION_EXPORT_SCHEMA) return 'qualification export schema is not recognized';
  if (exported.host !== HOST_ID || !textOf(exported.hostVersion)) return 'qualification export host or host version is missing';
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

function evaluateQualification(input) {
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
    reason = validateQualificationExport();
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

// ---- Shared provider state ------------------------------------------------------

function supportedHostCheck(input) {
  if (recordOf(input) && input.hostId === HOST_ID) return null;
  const host = recordOf(input) && typeof input.hostId === 'string' ? input.hostId : 'unknown';
  return diagnostic('unsupported-host', {
    reason: `unsupported host ${host} has no supported capture implementation; OpenCode/Codex must not borrow the Claude exit mapping`,
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
      const samePin = !pin || (recordOf(observed.baselinePin) && observed.baselinePin.commit === pin.commit && observed.baselinePin.root === pin.root);
      if (!sameWorkflow || !samePin) {
        return rejected('identity-mismatch', 'the observed workflow revision or baseline pin differs from the current one; stale evidence loses credit');
      }
    }
    if (capability && !(recordOf(cap.observedIdentity))) {
      return rejected('identity-missing', 'a doc capability needs the workflow identity observed at capture time');
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
      const observed = recordOf(cap.observedDigests) ? cap.observedDigests : {};
      const artifactDigests = {};
      for (const relative of paths) {
        if (typeof observed[relative] !== 'string') return rejected('artifact-unobserved', `no observation-time digest for ${relative}`);
        artifactDigests[relative] = observed[relative];
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

// ---- Capture record builder (consumed by state-persist.js) ----------------------

// Builds the retained capture record for a Claude hook payload. The field names
// are the doc's capture-table vocabulary (docs/doc-workflow-reconciliation.md
// § S2b). Absent input fields stay absent in the record, never invented.
// Responses:
// - value capturing the event, or null when the payload does not describe a
//   supported capture event.
let captureSequence = 0;

function buildCaptureRecord(payload, eventName, workspaceRoot) {
  if (!recordOf(payload)) return null;
  const event = typeof eventName === 'string' ? eventName : (payload.hook_event_name || payload.hookEventName || '');
  if (['PreToolUse', 'PostToolUse', 'PostToolUseFailure', 'SubagentStart', 'SubagentStop'].indexOf(event) === -1) return null;
  // PreToolUse is captured only for the launches whose outcome the pilot can later correlate.
  if (event === 'PreToolUse' && PRE_CAPTURE_TOOLS.indexOf(payload.tool_name) === -1) return null;
  const toolInput = recordOf(payload.tool_input) ? payload.tool_input : {};
  const toolResponse = payload.tool_response;
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
    cwd: typeof payload.cwd === 'string' && payload.cwd ? payload.cwd : (typeof workspaceRoot === 'string' && workspaceRoot ? workspaceRoot : ''),
    tool_use_id: typeof payload.tool_use_id === 'string' ? payload.tool_use_id : '',
    session_id: payload.session_id === undefined && payload.sessionId === undefined ? '' : String(payload.session_id !== undefined ? payload.session_id : payload.sessionId),
    responseDigest: captureDigest(toolResponse),
    responseRef: `host-payload/${event}/${captureId}`,
  };
  if (payload.prompt_id !== undefined) record.prompt_id = payload.prompt_id;
  // The launch tool name separates the Agent/Task result surface and the subagent launch from executed tools (F4/F5).
  if (typeof payload.tool_name === 'string') record.tool_name = payload.tool_name;
  const agentId = payload.agent_id !== undefined ? payload.agent_id : responseAliasAgentId;
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
      try {
        const report = JSON.parse(stdout);
        checkedPaths = ['doc-lint', 'link-check'].flatMap(capability => (recordOf(report.capabilities) && recordOf(report.capabilities[capability])
          && Array.isArray(report.capabilities[capability].checkedPaths) ? report.capabilities[capability].checkedPaths : []));
      } catch { /* not JSON: no paths observed, the event will be withheld */ }
      record.observedDigests = typeof workspaceRoot === 'string' && workspaceRoot ? observedDigestsFor(workspaceRoot, [...new Set(checkedPaths)]) : {};
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
  return record;
}

// ---- Immutable per-event capture records (I2c) ----------------------------------------------------------------------
// Each capture is one event file, created exclusively and never rewritten by this code. The compatibility journal
// `doc-reconciliation-capture.json` is rebuilt from those files, and readers compare the two. This detects accidental and
// journal-only edits. It does not stop the local agent from rewriting event files, which the owner's bound accepts (F13).
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

// Observation-time identity: the workflow and pin the host event was captured under. Absent before a workflow starts.
function observedIdentityFor(sessionDir) {
  try {
    const workflow = JSON.parse(fs.readFileSync(path.join(sessionDir, 'workflow-run.json'), 'utf8'));
    return { workflowId: workflow.workflowId, workflowRevision: workflow.revision, baselinePin: workflow.docReconciliationBaseline || null };
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
module.exports = { createClaudeOriginProvider, buildCaptureRecord, resolveDocCheckInvocation,
  registeredInstalledCheck: resolveDocCheckInvocation, installedDocCheck,
  fileDigest, SHIPPED_DOC_CHECK_DIGEST, journalExecutors, reviewRecordIndependent,
  writeImmutableEvent, rebuildJournalView, readCaptureView, observedIdentityFor, _internals: { captureJson, captureDigest, digestText, canonicalCapture } };
