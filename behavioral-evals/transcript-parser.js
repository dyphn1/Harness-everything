'use strict';

const { commandMatches } = require('../scripts/lib/execution-contract');

const fs = require('fs');

const DENIAL_RE = /permission\s+denied|\bdenied\b|not\s+allowed|rejected|forbidden|blocked\s+by|approval\s+required/i;
const SUCCESS_RE = /^(?:complete(?:d)?|success(?:ful)?|succeeded|ok|done|finished)$/i;
const FAILURE_RE = /^(?:error|failed|failure|cancel(?:led)?)$/i;

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function firstDefined(...values) {
  return values.find(value => value !== undefined && value !== null);
}

function stableJson(value) {
  if (value === undefined) return '';
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(',')}}`;
}

function clone(value) {
  if (value === undefined) return undefined;
  return JSON.parse(JSON.stringify(value));
}

function makeMetadata() {
  return {
    cost: null,
    total_cost_usd: null,
    cost_usd: null,
    usage: null,
    duration_ms: null,
    num_turns: null,
    session_id: null,
    model: null,
    model_usage: null,
    modelUsage: null,
    cli_version: null,
    subtype: null,
    is_error: null,
    permission_denials: [],
    result: null,
  };
}

function makeContext(engine, format, visibility = 'structured') {
  return {
    engine,
    format,
    visibility,
    metadata: makeMetadata(),
    finalResult: null,
    sawResult: false,
    sawRecognizedEvent: false,
    sawAssistantEvent: false,
    textChunks: [],
    partialTextChunks: [],
    calls: [],
    callsById: new Map(),
    callsByAnonymousKey: new Map(),
    resultKeys: new Set(),
    streamToolIndexes: new Map(),
    streamToolInput: new Map(),
    nextAnonymousId: 1,
    orderedEvents: [],
    nextSequence: 0,
  };
}

function appendUnique(list, value) {
  if (typeof value !== 'string' || !value) return;
  if (list[list.length - 1] !== value) list.push(value);
}

function appendText(context, list, value) {
  const before = list.length;
  appendUnique(list, value);
  if (list.length > before) {
    context.orderedEvents.push({ kind: 'text', text: value, sequence: context.nextSequence++ });
  }
}

function normalizeId(value) {
  if (typeof value === 'string' && value.trim()) return value;
  if (typeof value === 'number') return String(value);
  return null;
}

function callIdentity(name, input) {
  return `${name || 'tool'}|${stableJson(input)}`;
}

function getCallId(value) {
  if (!isObject(value)) return null;
  return normalizeId(firstDefined(value.id, value.tool_use_id, value.callID, value.call_id, value.callId));
}

function findCall(context, details = {}) {
  const id = getCallId(details);
  // An explicit ID is authoritative. Falling back to the anonymous
  // name/input key would merge two distinct calls that happen to have the
  // same arguments.
  if (id) return context.callsById.get(id) || null;
  const name = firstDefined(details.name, details.tool_name, details.tool);
  const input = firstDefined(details.input, details.tool_input);
  if (name !== undefined || input !== undefined) {
    const key = callIdentity(name, input);
    return context.callsByAnonymousKey.get(key) || null;
  }
  return null;
}

function ensureCall(context, details = {}) {
  const name = String(firstDefined(details.name, details.tool_name, details.tool, 'tool'));
  const input = firstDefined(details.input, details.tool_input, {});
  const suppliedId = getCallId(details);
  const anonymousKey = callIdentity(name, input);
  const existing = suppliedId
    ? context.callsById.get(suppliedId)
    : context.callsByAnonymousKey.get(anonymousKey);
  if (existing) {
    if (suppliedId) context.callsById.set(suppliedId, existing);
    if (details.input !== undefined || details.tool_input !== undefined) existing.input = clone(input);
    if (details.name || details.tool_name || details.tool) existing.name = name;
    if (!existing.explicitId) {
      existing.anonymousKey = callIdentity(existing.name, existing.input);
      context.callsByAnonymousKey.set(existing.anonymousKey, existing);
    }
    return existing;
  }

  const id = suppliedId || `anonymous-tool-${context.nextAnonymousId++}`;
  const call = {
    id,
    name,
    input: clone(input),
    attempted: true,
    completed: false,
    denied: false,
    status: 'attempted',
    result_count: 0,
    explicitId: Boolean(suppliedId),
    anonymousKey: suppliedId ? null : anonymousKey,
  };
  context.calls.push(call);
  call.sequence = context.nextSequence++;
  context.orderedEvents.push({ kind: 'tool', call });
  context.callsById.set(id, call);
  if (!suppliedId) context.callsByAnonymousKey.set(anonymousKey, call);
  return call;
}

function statusFrom(details = {}, result = {}) {
  const text = [
    details.status,
    result.status,
    result.subtype,
    result.error,
    result.error_message,
  ].filter(value => typeof value === 'string').join(' ');
  if (details.denied || details.permission_denied || result.denied || result.permission_denied || DENIAL_RE.test(text)) return 'denied';
  if (result.type === 'tool_result' || result.type === 'tool_output') return result.is_error === true ? 'failed' : 'completed';
  if (result.is_error === false || details.is_error === false || SUCCESS_RE.test(String(firstDefined(details.status, result.status, '')))) return 'completed';
  if (result.is_error === true || FAILURE_RE.test(String(firstDefined(details.status, result.status, '')))) return 'failed';
  if (SUCCESS_RE.test(String(firstDefined(result.subtype, '')))) return 'completed';
  return 'attempted';
}

function applyStatus(call, status) {
  if (status === 'denied') {
    call.denied = true;
    call.completed = false;
    call.status = 'denied';
  } else if (status === 'completed') {
    call.completed = true;
    if (!call.denied) call.status = 'completed';
  } else if (!call.completed && !call.denied && status === 'failed') {
    call.status = 'failed';
  }
}

function addToolResult(context, details = {}, result = {}, forcedStatus) {
  const call = findCall(context, details) || ensureCall(context, details);
  const status = forcedStatus || statusFrom(details, result);
  const content = firstDefined(result.content, result.output, details.output, details.content, null);
  const resultKey = `${call.id}|${status}|${stableJson(content)}|${result.is_error === true ? 'error' : ''}`;
  if (!context.resultKeys.has(resultKey)) {
    context.resultKeys.add(resultKey);
    call.result_count += 1;
  }
  applyStatus(call, status);
  return call;
}

function addToolCall(context, details = {}) {
  const call = ensureCall(context, details);
  const status = statusFrom(details, details);
  if (status !== 'attempted') applyStatus(call, status);
  return call;
}

function addDenial(context, denial = {}) {
  const details = {
    id: firstDefined(denial.tool_use_id, denial.call_id, denial.callID, denial.id),
    name: firstDefined(denial.tool_name, denial.name, denial.tool),
    input: firstDefined(denial.tool_input, denial.input),
  };
  const call = findCall(context, details) || ensureCall(context, details);
  addToolResult(context, details, { ...denial, denied: true, permission_denied: true }, 'denied');
  return call;
}

function setMetadata(context, value, { result = false } = {}) {
  if (!isObject(value)) return;
  const metadata = context.metadata;
  const cost = [value.total_cost_usd, value.cost_usd, value.cost].find(item => typeof item === 'number');
  if (cost !== undefined) metadata.cost = cost;
  for (const key of ['total_cost_usd', 'cost_usd']) {
    if (typeof value[key] === 'number') metadata[key] = value[key];
  }
  for (const key of ['duration_ms', 'num_turns']) {
    if (typeof value[key] === 'number') metadata[key] = value[key];
  }
  if (isObject(value.usage)) metadata.usage = clone(value.usage);
  if (isObject(value.modelUsage)) metadata.modelUsage = clone(value.modelUsage);
  if (isObject(value.model_usage)) metadata.model_usage = clone(value.model_usage);
  for (const key of ['session_id', 'model', 'claude_code_version', 'subtype']) {
    if (value[key] !== undefined) metadata[key === 'claude_code_version' ? 'cli_version' : key] = value[key];
  }
  if (typeof value.is_error === 'boolean') metadata.is_error = value.is_error;
  if (Array.isArray(value.permission_denials)) {
    metadata.permission_denials = clone(value.permission_denials);
  }
  if (result) metadata.result = clone(value);
}

function processContent(context, content, { partial = false, includeText = true } = {}) {
  if (Array.isArray(content)) {
    for (const block of content) processContent(context, block, { partial, includeText });
    return;
  }
  if (typeof content === 'string') {
    if (includeText) appendText(context, partial ? context.partialTextChunks : context.textChunks, content);
    return;
  }
  if (!isObject(content)) return;
  if (content.type === 'text') {
    if (includeText) appendText(context, partial ? context.partialTextChunks : context.textChunks, content.text);
  } else if (content.type === 'tool_use' || content.type === 'tool_call') {
    context.sawRecognizedEvent = true;
    addToolCall(context, {
      id: content.id,
      name: content.name,
      input: content.input,
    });
  } else if (content.type === 'tool_result' || content.type === 'tool_output') {
    context.sawRecognizedEvent = true;
    addToolResult(context, {
      id: content.tool_use_id || content.call_id || content.callID,
      name: content.tool_name || content.name,
    }, content);
  }
}

function processClaudeEvent(context, event) {
  if (!isObject(event) || typeof event.type !== 'string') return;
  const type = event.type;
  if (type === 'system') {
    context.sawRecognizedEvent = true;
    setMetadata(context, event);
    return;
  }
  if (type === 'assistant') {
    context.sawRecognizedEvent = true;
    context.sawAssistantEvent = true;
    const message = isObject(event.message) ? event.message : event;
    setMetadata(context, message);
    processContent(context, message.content);
    return;
  }
  if (type === 'user') {
    context.sawRecognizedEvent = true;
    const message = isObject(event.message) ? event.message : event;
    // User events carry tool results and may also carry tool-output prose.
    // Keep the former for correlation, but never let user text become agent
    // trace evidence.
    processContent(context, message.content, { includeText: false });
    return;
  }
  if (type === 'result') {
    context.sawRecognizedEvent = true;
    context.sawResult = true;
    setMetadata(context, event, { result: true });
    context.finalResult = typeof event.result === 'string' ? event.result : null;
    for (const denial of event.permission_denials || []) addDenial(context, denial);
    return;
  }
  if (type === 'stream_event') {
    context.sawRecognizedEvent = true;
    processClaudeStreamEvent(context, event.event || event);
    return;
  }
  // Some Claude versions expose the inner stream event as a top-level type.
  if (type === 'content_block_start' || type === 'content_block_delta') {
    context.sawRecognizedEvent = true;
    processClaudeStreamEvent(context, event);
  }
}

function processClaudeStreamEvent(context, event) {
  if (!isObject(event)) return;
  if (event.type === 'message_start') {
    setMetadata(context, event.message || event);
  } else if (event.type === 'content_block_start') {
    const block = event.content_block || {};
    if (block.type === 'tool_use') {
      const call = addToolCall(context, { id: block.id, name: block.name, input: block.input || {} });
      if (event.index !== undefined) context.streamToolIndexes.set(event.index, call);
      context.streamToolInput.set(call.id, '');
    } else if (block.type === 'text' && typeof block.text === 'string') {
      appendText(context, context.partialTextChunks, block.text);
    }
  } else if (event.type === 'content_block_delta') {
    const delta = event.delta || {};
    if (delta.type === 'text_delta') appendText(context, context.partialTextChunks, delta.text);
    if (delta.type === 'input_json_delta') {
      const call = context.streamToolIndexes.get(event.index);
      if (call) {
        const previous = context.streamToolInput.get(call.id) || '';
        const next = previous + String(delta.partial_json || '');
        context.streamToolInput.set(call.id, next);
        try { call.input = JSON.parse(next); } catch { /* wait for the final delta */ }
      }
    }
  } else if (event.type === 'message_delta') {
    setMetadata(context, event.usage ? { usage: event.usage } : event);
  }
}

function processOpencodeEvent(context, event) {
  if (!isObject(event)) return;
  const part = isObject(event.part) ? event.part : event;
  const type = String(event.type || part.type || '');
  if (type === 'text' || part.type === 'text') {
    context.sawRecognizedEvent = true;
    appendText(context, context.textChunks, part.text);
    return;
  }
  if (type === 'step_start' || type === 'step-start' || part.type === 'step-start') {
    context.sawRecognizedEvent = true;
    return;
  }
  if (type === 'step_finish' || type === 'step-finish' || part.type === 'step-finish') {
    context.sawRecognizedEvent = true;
    setMetadata(context, {
      cost: part.cost,
      usage: part.tokens,
      duration_ms: typeof event.timestamp === 'number' ? event.timestamp : undefined,
    });
    if (typeof context.metadata.num_turns !== 'number') context.metadata.num_turns = context.calls.length;
    return;
  }
  if (type.includes('tool') || String(part.type || '').includes('tool')) {
    context.sawRecognizedEvent = true;
    const state = isObject(part.state) ? part.state : {};
    const details = {
      id: firstDefined(part.callID, part.callId, part.call_id, part.id, part.tool_use_id),
      name: firstDefined(part.tool, part.name, part.tool_name),
      input: firstDefined(state.input, part.input, part.tool_input, part.arguments),
      status: state.status || part.status,
      output: firstDefined(state.output, part.output, part.result),
      content: firstDefined(state.output, part.output, part.result),
    };
    const isDenied = type.includes('denied') || type.includes('rejected') || state.status === 'denied' || state.status === 'rejected' || part.denied === true || part.permission_denied === true;
    const isResult = type.includes('result') || type.includes('output') || state.output !== undefined || state.status === 'completed' || isDenied;
    if (isResult) addToolResult(context, details, { ...part, ...state, output: details.output, content: details.content });
    else addToolCall(context, details);
  }
}

function parseJsonLines(raw) {
  const lines = String(raw).split(/\r?\n/);
  const events = [];
  const errors = [];
  let nonEmpty = 0;
  lines.forEach((line, index) => {
    if (!line.trim()) return;
    nonEmpty += 1;
    try {
      events.push({ line: index + 1, value: JSON.parse(line) });
    } catch (error) {
      errors.push(`line ${index + 1}: ${error.message}`);
    }
  });
  return { events, errors, nonEmpty };
}

function detectEngine(events, requested) {
  if (requested && requested !== 'auto') return requested;
  if (events.some(item => isObject(item.value) && isObject(item.value.part))) return 'opencode';
  if (events.some(item => isObject(item.value) && typeof item.value.type === 'string' && item.value.type.toLowerCase().includes('tool'))) return 'opencode';
  if (events.some(item => isObject(item.value) && ['system', 'assistant', 'user', 'result', 'stream_event'].includes(item.value.type))) return 'claude';
  return requested || 'unknown';
}

function publicCall(call) {
  return {
    id: call.id,
    name: call.name,
    input: clone(call.input),
    attempted: true,
    completed: call.completed,
    denied: call.denied,
    status: call.status,
  };
}

function finishContext(context, { parseStatus, parseError = null, rawLineCount = 0 } = {}) {
  const assistantText = context.textChunks.length
    ? context.textChunks.join('\n')
    : context.partialTextChunks.join('');
  const text = assistantText || (typeof context.finalResult === 'string' ? context.finalResult : '');
  const calls = context.visibility === 'unavailable' ? [] : context.calls.map(publicCall);
  const attempted = calls.filter(call => call.attempted);
  const completed = calls.filter(call => call.completed);
  const denied = calls.filter(call => call.denied);
  const unresolved = calls.filter(call => call.attempted && !call.completed && !call.denied);
  const traceEvents = context.orderedEvents.map(event => event.kind === 'text'
    ? event.text
    : `[${event.call.name || 'tool'}] ${JSON.stringify(event.call.input ?? {})}`);
  const trace = traceEvents.length ? traceEvents.join('\n') : text;
  const executionEvidence = {
    visibility: context.visibility,
    attempted,
    completed,
    denied,
    unresolved,
    counts: context.visibility === 'unavailable'
      ? { attempted: null, completed: null, denied: null, unresolved: null }
      : { attempted: attempted.length, completed: completed.length, denied: denied.length, unresolved: unresolved.length },
  };
  const metadata = { ...context.metadata };
  if (metadata.cost === null && typeof metadata.total_cost_usd === 'number') metadata.cost = metadata.total_cost_usd;
  if (metadata.total_cost_usd === null && typeof metadata.cost === 'number') metadata.total_cost_usd = metadata.cost;
  return {
    engine: context.engine,
    format: context.format,
    parseStatus,
    parseError,
    rawLineCount,
    trace,
    assistantText: text,
    finalResult: context.finalResult,
    metadata,
    toolCalls: attempted,
    toolResults: context.visibility === 'unavailable' ? [] : context.calls.filter(call => call.result_count > 0).map(publicCall),
    toolEvidence: executionEvidence,
    executionEvidence,
    hasFinalResult: context.sawResult,
  };
}

function parseTranscript(raw, requestedEngine = 'auto') {
  const text = Buffer.isBuffer(raw) ? raw.toString('utf8') : String(raw ?? '');
  const parsed = parseJsonLines(text);
  let events = parsed.events;
  let errors = parsed.errors;
  let legacy = null;
  const requestedOrDetected = detectEngine(events, requestedEngine);
  if (events.length === 1 && (requestedOrDetected === 'claude' || requestedOrDetected === 'unknown') && isObject(events[0].value)) {
    const only = events[0].value;
    // The old Claude `--output-format json` contract is one result object. A
    // one-line result event has no tool visibility, even though it is valid
    // JSON and superficially resembles a stream event.
    if (!['assistant', 'user', 'system', 'stream_event'].includes(only.type)
      && (requestedOrDetected === 'claude' || typeof only.result === 'string')) {
      legacy = only;
      events = [];
    }
  }
  if (!events.length && text.trim()) {
    try {
      legacy = JSON.parse(text);
      events = [{ line: 1, value: legacy }];
      errors = [];
    } catch {
      // Keep the line parse error; the parser must fail closed below.
    }
  }

  const engine = detectEngine(events, requestedEngine);
  if (legacy && isObject(legacy)) {
    const context = makeContext(engine === 'unknown' ? 'claude' : engine, 'claude-json', 'unavailable');
    context.sawRecognizedEvent = typeof legacy.result === 'string' || isObject(legacy);
    context.sawResult = typeof legacy.result === 'string';
    context.finalResult = typeof legacy.result === 'string' ? legacy.result : null;
    setMetadata(context, legacy, { result: true });
    return finishContext(context, {
      // The legacy one-object JSON contract contains final prose but no
      // structured tool events. Keep the text readable while making every
      // grader treat its evidence as unavailable.
      parseStatus: context.sawRecognizedEvent ? 'unavailable' : 'unrecognized',
      rawLineCount: parsed.nonEmpty || 1,
    });
  }

  const format = engine === 'opencode' ? 'opencode-jsonl' : engine === 'claude' ? 'claude-stream-json' : 'unknown';
  const context = makeContext(engine, format, engine === 'unknown' ? 'unavailable' : 'structured');
  for (const item of events) {
    if (engine === 'opencode') processOpencodeEvent(context, item.value);
    else if (engine === 'claude') processClaudeEvent(context, item.value);
  }
  const recognized = context.sawRecognizedEvent;
  let parseStatus = recognized ? 'parsed' : 'unrecognized';
  if (errors.length && recognized) parseStatus = 'partial';
  if (engine === 'claude' && recognized && !context.sawResult) {
    parseStatus = 'partial';
    if (!errors.length) errors.push('stream ended before a result event');
  }
  if (!recognized && !errors.length && parsed.nonEmpty === 0) errors.push('empty transcript');
  return finishContext(context, {
    parseStatus,
    parseError: errors.length ? errors.join('; ') : null,
    rawLineCount: parsed.nonEmpty,
  });
}

function parseTranscriptFile(filePath, engine = 'auto') {
  return parseTranscript(fs.readFileSync(filePath, 'utf8'), engine);
}

function targetMatches(call, target) {
  if (target === undefined || target === null || target === '') return true;
  if (isObject(target)) {
    if (target.id !== undefined && call.id !== target.id) return false;
    if (target.name !== undefined && call.name !== target.name) return false;
    if (target.command !== undefined && (!isObject(call.input) || !commandMatches(call.input.command, target.command))) return false;
    if (target.input_contains !== undefined && !stableJson(call.input).includes(String(target.input_contains))) return false;
    return true;
  }
  const value = String(target);
  return call.id === value || call.name === value || (isObject(call.input) && commandMatches(call.input.command, value));
}

function gradeExecutionEvidence(expectation, parsedOrEvidence) {
  const parsed = parsedOrEvidence && parsedOrEvidence.executionEvidence ? parsedOrEvidence : null;
  const evidence = parsed ? parsed.executionEvidence : parsedOrEvidence;
  if (!evidence || evidence.visibility !== 'structured') {
    return { pass: false, status: 'inconclusive', reason: 'structured tool evidence is unavailable', observed: null };
  }
  if (parsed && parsed.parseStatus !== 'parsed') {
    return { pass: false, status: 'inconclusive', reason: parsed.parseError || 'transcript parsing is incomplete', observed: null };
  }
  const type = String(expectation && expectation.type || '').toLowerCase();
  const state = type.includes('denied') || expectation.evidence === 'denied' ? 'denied'
    : type.includes('completed') || type.includes('executed') || expectation.evidence === 'completed' ? 'completed'
      : 'attempted';
  const list = evidence[state] || [];
  const target = {};
  if (expectation && isObject(expectation.value)) Object.assign(target, expectation.value);
  if (expectation && expectation.tool !== undefined) target.name = expectation.tool;
  if (expectation && expectation.name !== undefined) target.name = expectation.name;
  if (expectation && expectation.command !== undefined) target.command = expectation.command;
  if (expectation && expectation.input_contains !== undefined) target.input_contains = expectation.input_contains;
  const targetValue = Object.keys(target).length
    ? target
    : expectation && typeof expectation.value === 'string' ? expectation.value : undefined;
  const matches = list.filter(call => targetMatches(call, targetValue));
  const requestedCount = typeof expectation.count === 'number'
    ? expectation.count
    : typeof expectation.value === 'number' ? expectation.value : 1;
  const pass = matches.length >= requestedCount;
  return {
    pass,
    status: pass ? 'pass' : 'fail',
    reason: pass ? `found ${matches.length} ${state} tool call(s)` : `expected ${requestedCount} ${state} tool call(s), found ${matches.length}`,
    observed: matches,
    state,
  };
}

module.exports = {
  gradeExecutionEvidence,
  parseTranscript,
  parseTranscriptFile,
};
