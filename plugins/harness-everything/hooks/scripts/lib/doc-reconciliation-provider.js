'use strict';

// S2b Claude origin provider (docs/doc-workflow-reconciliation.md § S2b, "Claude
// capture and origin-provider contract" and "Retained live-capture gate";
// owner decision rows 1 and 2 are reproduced verbatim there as the binding
// trust-contract). Implements the existing S2a resolveContext/resolveEvent seam
// consumed by doc-reconciliation-producer.js / doc-reconciliation-events.js.
//
// Binding properties:
// - Positive credit is disabled until qualification resolves. The production
//   path resolves the retained live-capture evidence directory
//   benchmarks/results/live-host/claude-325-3b-s2b (or its verified export).
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
const DOC_CHECK_SCRIPT = /(^|\/)harness-everything\/scripts\/doc-check\.js$/;
const DOC_CHECK_FLAGS = ['--workspace', '--config', '--changed-path', '--base'];
const DOC_CHECK_SCHEMA = 'harness.doc-check.check.v1';

// A registered, argv-validated `doc-check check` invocation, or null. No shell operators, expansions or quoting.
function parseRegisteredCheck(command) {
  if (typeof command !== 'string' || /[&|;<>`$()\\"']/.test(command)) return null;
  const tokens = command.trim().split(/\s+/);
  if (tokens.length < 4 || tokens[0] !== 'node' || !DOC_CHECK_SCRIPT.test(tokens[1]) || tokens[2] !== 'check') return null;
  const flags = tokens.slice(3);
  if (flags.length % 2 !== 0) return null;
  for (let index = 0; index < flags.length; index += 2) {
    if (!DOC_CHECK_FLAGS.includes(flags[index]) || flags[index + 1].startsWith('--')) return null;
  }
  return tokens;
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
// Free text such as `REJECT: ...` carries no verdict, so it can never approve.
function parseReviewVerdict(message) {
  if (typeof message !== 'string') return null;
  const match = /^\s*Review verdict:\s*(approve|reject)\b[.:]?\s*(.*)$/im.exec(message);
  if (!match) return null;
  const summary = [match[2], message.slice(match.index + match[0].length)].join('\n').trim();
  return { verdict: match[1].toLowerCase(), summary };
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
    if (capability) {
      // Doc capability: only a registered, passed, fully covered doc-check invocation with retained stdout can cover it.
      if (cap.event !== 'PostToolUse') return rejected('capability-mismatch', 'only a PostToolUse check invocation can cover a doc capability');
      const registered = parseRegisteredCheck(cap.command);
      if (!registered) return rejected('unregistered-command', 'the command is not a registered doc-check invocation; an arbitrary successful shell command never covers a doc capability');
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
      const command = registered.join(' ');
      const event = {
        eventId: 'claude-check-' + digestText(cap.captureId + ':' + capability),
        producerId,
        originRef,
        principalId: cap.session_id,
        provenance: 'claude-code-capture:' + cap.captureId,
        capability,
        kind: 'execution',
        command,
        argv: registered,
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
      if (reviewer === author) {
        return rejected('reviewer-not-independent', 'the reviewer agent_id equals the author session principal; not independent');
      }
      if (executors.includes(reviewer)) {
        return rejected('reviewer-not-independent', 'the reviewer agent_id equals an executor principal; not independent');
      }
      const taskResults = captures.filter(item => recordOf(item) && item.event === 'PostToolUse' && textOf(item.agent_id));
      if (taskResults.length && !taskResults.some(item => item.agent_id === reviewer)) {
        return rejected('surface-inconsistency', 'SubagentStop and the Agent/Task result name different subagent identities; inconsistent surfaces are rejected');
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
      const eventId = 'claude-review-' + digestText(signature + ':review');
      const independentOf = [];
      for (const candidate of [author, ...executors]) {
        if (textOf(candidate) && candidate !== reviewer && !independentOf.includes(candidate)) independentOf.push(candidate);
      }
      const event = {
        eventId,
        producerId,
        originRef,
        principalId: reviewer,
        capability: 'quality-review',
        kind: 'review',
        verdict: 'approve',
        summary: cap.reviewSummary,
        independentOf,
        identity: recordOf(request.identity) ? JSON.parse(JSON.stringify(request.identity)) : null,
        paths: [],
        reviewedArtifactDigests: {},
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
    if (parseRegisteredCheck(record.command)) {
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
    if (payload.agent_transcript_path !== undefined) record.agentTranscriptPath = payload.agent_transcript_path;
  }
  return record;
}

// ---- Immutable per-event capture records (I2c) ----------------------------------------------------------------------
// Each capture is one write-once file (created exclusively, never rewritten). The compatibility journal
// `doc-reconciliation-capture.json` is rebuilt from those files. Readers compare the two: any difference is tampering.
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
  const executors = recordOf(principals) && Array.isArray(principals.executors) ? principals.executors : [];
  if (cap.agent_id === principals.author || executors.includes(cap.agent_id)) return false;
  const taskResults = (Array.isArray(captures) ? captures : []).filter(item => recordOf(item) && item.event === 'PostToolUse' && textOf(item.agent_id));
  if (taskResults.length && !taskResults.some(item => item.agent_id === cap.agent_id)) return false;
  if (!HEX64.test(String(cap.reviewDigest === undefined ? '' : cap.reviewDigest))) return false;
  return cap.reviewVerdict === 'approve' && textOf(cap.reviewSummary);
}

module.exports = { createClaudeOriginProvider, buildCaptureRecord, parseRegisteredCheck, reviewRecordIndependent,
  writeImmutableEvent, rebuildJournalView, readCaptureView, observedIdentityFor, _internals: { captureJson, captureDigest, digestText, canonicalCapture } };
