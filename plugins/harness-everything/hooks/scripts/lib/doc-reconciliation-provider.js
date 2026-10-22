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
const RETAINED_LIVE_REL_PARTS = path.join('benchmarks', 'results', 'live-host', 'claude-325-3b-s2b');
const RETAINED_REQUIRED_ENTRIES = ['README.md', 'capture.sanitized.jsonl'];
const HEX64 = /^[0-9a-f]{64}$/;

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

function resolveRetainedLiveDir() {
  let dir = __dirname;
  for (;;) {
    const candidate = path.join(dir, RETAINED_LIVE_REL_PARTS);
    try { if (fs.statSync(candidate).isDirectory()) return candidate; } catch { /* keep walking */ }
    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
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
  // Production path: qualification is omitted, so it must resolve from retained
  // retained live-capture evidence. Never read from environment or capture flags.
  const dir = resolveRetainedLiveDir();
  if (!dir) {
    return {
      open: false,
      fail: diagnostic('live-gate-unmet', {
        reason: 'live gate unmet: no retained Claude Code live-capture evidence resolved at benchmarks/results/live-host/claude-325-3b-s2b; qualification is not satisfied',
      }),
    };
  }
  const missing = RETAINED_REQUIRED_ENTRIES.filter(name => {
    try { return fs.statSync(path.join(dir, name)).size === 0; } catch { return true; }
  });
  if (missing.length) {
    return {
      open: false,
      fail: diagnostic('live-gate-unmet', {
        reason: `live gate unmet: retained qualification evidence incomplete, missing or empty: ${missing.join(', ')}`,
      }),
    };
  }
  return { open: true, source: 'retained-live-capture' };
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
    const index = captures.findIndex(item => recordOf(item) && item.ref === reference);
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
    // Replay: identical host-event content re-presented under a new reference
    // cannot become a new accepted event. The first recorded occurrence wins.
    const signature = contentSignature(cap);
    const firstOccurrence = captures.findIndex(item => recordOf(item) && contentSignature(item) === signature);
    if (firstOccurrence !== index) {
      return rejected('replayed-record', `identical host-event content already recorded (first occurrence index ${firstOccurrence}); a copied record cannot become a new accepted event by changing its reference`);
    }
    const producerId = 'claude-code-origin-provider';
    if (cap.event === 'PostToolUseFailure') {
      return rejected('failure-not-credited', 'PostToolUseFailure is never credited; its Exit code N text is diagnostics-only (owner decision row 1)');
    }
    if (cap.event === 'SubagentStart') {
      return rejected('capture-not-completed', 'SubagentStart records only a launch; a background launch is not a completed review or execution');
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
        summary: `host subagent review completed by ${reviewer}; the final review artifact is bound by digest ${cap.reviewDigest}`,
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
  if (['PostToolUse', 'PostToolUseFailure', 'SubagentStart', 'SubagentStop'].indexOf(event) === -1) return null;
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
    record.interrupted = Boolean(toolResponse && toolResponse.interrupted);
  } else if (event === 'PostToolUseFailure') {
    record.is_interrupt = Boolean(payload.is_interrupt);
    record.failureDisposition = /Exit code (\d+)/.exec(String(payload.error === undefined ? '' : payload.error)) ? 'nonzero-exit' : 'host-failure-error';
  } else if (event === 'SubagentStop') {
    record.reviewDigest = digestText(String(payload.last_assistant_message === undefined ? '' : payload.last_assistant_message));
    if (payload.agent_transcript_path !== undefined) record.agentTranscriptPath = payload.agent_transcript_path;
  }
  return record;
}

module.exports = { createClaudeOriginProvider, buildCaptureRecord, _internals: { captureJson, captureDigest, digestText, canonicalCapture, resolveRetainedLiveDir } };
