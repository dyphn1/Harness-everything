'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const LIMITS = Object.freeze({
  indexBytes: 512 * 1024,
  indexRows: 512,
  recordBytes: 32 * 1024,
  candidates: 32,
  sourceBytes: 64 * 1024,
  candidateText: 4096,
  command: 8192,
  commandSegments: 16,
  output: 32 * 1024,
  reminders: 2,
  reminderChars: 1500
});
const INVITATION = 'Consider a fresh look, and zoom out if warranted.';
const PROVISIONAL_LABEL = 'Provisional local lesson (unreviewed)';
const LEDGER_RELATIVE = path.join('.agents', 'harness-everything', 'errors');
const FILE_PATTERN = /^\.agents\/harness-everything\/errors\/(E-\d{4,})-[a-z0-9-]+\.md$/;
const IDENTIFIER_PATTERN = /^[a-z0-9][a-z0-9_-]{0,63}$/;
const RECORD_ID_PATTERN = /^E-\d{4,}$/;
const PENDING_HANDOFFS = new WeakMap();

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function hasOnlyKeys(value, allowed) {
  return Object.keys(value).every(key => allowed.includes(key));
}

function validIdentifier(value) {
  return typeof value === 'string' && IDENTIFIER_PATTERN.test(value);
}

function validateRuleList(value, failure) {
  if (!Array.isArray(value) || value.length < 1 || value.length > 8) throw new Error('invalid rule list');
  const keys = failure ? ['tool', 'executable', 'subcommand', 'diagnostics'] : ['tool', 'executable', 'subcommand'];
  return value.map(rule => {
    if (!isObject(rule) || !hasOnlyKeys(rule, keys) || rule.tool !== 'shell' ||
        !validIdentifier(rule.executable) || !validIdentifier(rule.subcommand)) throw new Error('invalid rule');
    const result = { tool: 'shell', executable: rule.executable, subcommand: rule.subcommand };
    if (failure) {
      if (!Array.isArray(rule.diagnostics) || rule.diagnostics.length < 1 || rule.diagnostics.length > 16 ||
          !rule.diagnostics.every(validIdentifier) || new Set(rule.diagnostics).size !== rule.diagnostics.length) {
        throw new Error('invalid diagnostics');
      }
      result.diagnostics = [...rule.diagnostics];
    }
    return result;
  });
}

function validateMatch(match) {
  if (!isObject(match) || !hasOnlyKeys(match, ['actions', 'failures']) ||
      (!Object.hasOwn(match, 'actions') && !Object.hasOwn(match, 'failures'))) throw new Error('invalid match');
  const result = {};
  if (Object.hasOwn(match, 'actions')) result.actions = validateRuleList(match.actions, false);
  if (Object.hasOwn(match, 'failures')) result.failures = validateRuleList(match.failures, true);
  return result;
}

function frontmatter(text) {
  const found = text.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
  if (!found) throw new Error('missing frontmatter');
  return found[1];
}

function section(text, name) {
  const lines = text.split(/\r?\n/);
  const heading = lines.findIndex(line => new RegExp(`^## ${name}[ \\t]*$`).test(line));
  if (heading < 0) throw new Error(`missing ${name}`);
  let end = lines.length;
  for (let index = heading + 1; index < lines.length; index += 1) {
    if (/^#{1,2}\s/.test(lines[index])) { end = index; break; }
  }
  const body = lines.slice(heading + 1, end);
  while (body.length && !body[0].trim()) body.shift();
  while (body.length && !body[body.length - 1].trim()) body.pop();
  const result = body.join('\n');
  if (!result) throw new Error(`empty ${name}`);
  return result;
}

function isWithin(root, candidate) {
  const relative = path.relative(root, candidate);
  return relative === '' || (!path.isAbsolute(relative) && relative !== '..' && !relative.startsWith(`..${path.sep}`));
}

function canonicalWorkspace(root) {
  if (typeof root !== 'string' || !path.isAbsolute(root)) throw new Error('invalid workspace root');
  const real = fs.realpathSync.native(root);
  if (!fs.statSync(real).isDirectory()) throw new Error('workspace root is not a directory');
  return real;
}

function validIndexRow(row) {
  if (!isObject(row) || !hasOnlyKeys(row, [
    'id', 'signature', 'class', 'title', 'scope', 'status', 'sites', 'violates',
    'mechanism_ref', 'episodes', 'rounds', 'file', 'match', 'matchBinding'
  ]) ||
      !RECORD_ID_PATTERN.test(row.id) || !validIdentifier(row.signature) ||
      typeof row.file !== 'string') throw new Error('invalid index row');
  const file = FILE_PATTERN.exec(row.file);
  if (!file || file[1] !== row.id) throw new Error('invalid record path');
  const match = Object.hasOwn(row, 'match') ? validateMatch(row.match) : null;
  if (match ? (typeof row.matchBinding !== 'string' || !/^[a-f0-9]{64}$/.test(row.matchBinding))
    : Object.hasOwn(row, 'matchBinding')) throw new Error('invalid match binding');
  return {
    id: row.id,
    signature: row.signature,
    file: row.file,
    match,
    ...(match ? { matchBinding: row.matchBinding } : {})
  };
}

function matchBinding(frontmatterText, row) {
  return crypto.createHash('sha256').update(JSON.stringify([
    frontmatterText.replace(/\r\n?/g, '\n'), row.id, row.signature, row.file, row.match
  ])).digest('hex');
}

function readIndex(root) {
  const ledgerPath = path.join(root, LEDGER_RELATIVE);
  const ledger = fs.realpathSync.native(ledgerPath);
  if (!isWithin(root, ledger) || !fs.statSync(ledger).isDirectory()) throw new Error('ledger escaped workspace');
  const index = fs.realpathSync.native(path.join(ledger, 'index.jsonl'));
  if (!isWithin(ledger, index) || !fs.statSync(index).isFile()) throw new Error('index escaped ledger');
  const stat = fs.statSync(index);
  if (stat.size > LIMITS.indexBytes) throw new Error('oversized index');
  const content = fs.readFileSync(index, 'utf8');
  const lines = content.split(/\r?\n/);
  if (lines.at(-1) === '') lines.pop();
  if (lines.length > LIMITS.indexRows || lines.some(line => !line.trim())) throw new Error('invalid index rows');
  return { ledger, rows: lines.map(line => validIndexRow(JSON.parse(line))) };
}

function readRecord(ledger, row) {
  const fullPath = path.join(ledger, path.posix.basename(row.file));
  const real = fs.realpathSync.native(fullPath);
  if (!isWithin(ledger, real) || !fs.statSync(real).isFile()) throw new Error('record escaped ledger');
  const stat = fs.statSync(real);
  if (stat.size > LIMITS.recordBytes) throw new Error('oversized record');
  const text = fs.readFileSync(real, 'utf8');
  if (matchBinding(frontmatter(text), row) !== row.matchBinding) throw new Error('stale indexed match binding');
  return {
    id: row.id,
    signature: row.signature,
    identity: `signature:${row.signature}`,
    match: row.match,
    cue: section(text, 'Cue'),
    lesson: section(text, 'Lesson'),
    source: 'repo'
  };
}

// shortcut: only direct commands and listed Git prefixes are parsed; add wrapper support if a carrier needs it.
function words(command) {
  if (typeof command !== 'string' || command.length > LIMITS.command || /[\r\n\0]/.test(command)) return null;
  const tokens = [];
  let value = '';
  let quote = null;
  let active = false;
  for (let index = 0; index < command.length; index += 1) {
    const char = command[index];
    if (quote) {
      if (char === quote) quote = null;
      else if (char === '\\' && quote === '"' && index + 1 < command.length) value += command[++index];
      else value += char;
      active = true;
      continue;
    }
    if (char === '"' || char === "'") { quote = char; active = true; continue; }
    if (char === '\\' && index + 1 < command.length) { value += command[++index]; active = true; continue; }
    if (';&|<>'.includes(char)) return null;
    if (/\s/.test(char)) {
      if (active) { tokens.push(value); value = ''; active = false; }
      continue;
    }
    value += char;
    active = true;
  }
  if (quote) return null;
  if (active) tokens.push(value);
  return tokens;
}

// Recognize only a bounded top-level sequence. Wrappers, pipelines, redirects,
// subshells, and heredocs stay unsupported; quoted separators remain arguments.
function splitSimpleCommandSegments(command) {
  if (typeof command !== 'string' || command.length > LIMITS.command || /[\r\n\0]/.test(command)) return null;
  const segments = [];
  let quote = null;
  let start = 0;
  for (let index = 0; index < command.length; index += 1) {
    const char = command[index];
    if (quote) {
      if (char === quote) quote = null;
      else if (char === '\\' && quote === '"' && index + 1 < command.length) index += 1;
      continue;
    }
    if (char === '"' || char === "'") { quote = char; continue; }
    if (char === '\\' && index + 1 < command.length) { index += 1; continue; }
    if ('<>()`'.includes(char)) return null;
    let separatorLength = 0;
    if (char === ';') separatorLength = 1;
    else if (char === '&' || char === '|') {
      if (command[index + 1] !== char || command[index + 2] === char) return null;
      separatorLength = 2;
    }
    if (!separatorLength) continue;
    const segment = command.slice(start, index).trim();
    if (!segment || segments.length >= LIMITS.commandSegments - 1) return null;
    segments.push(segment);
    index += separatorLength - 1;
    start = index + 1;
  }
  if (quote) return null;
  const finalSegment = command.slice(start).trim();
  if (!finalSegment || segments.length >= LIMITS.commandSegments) return null;
  segments.push(finalSegment);
  return segments;
}

function normalizeShellCommand(command) {
  try {
    const tokens = words(command);
    if (!tokens || tokens.length < 2) return null;
    const executable = tokens[0].replaceAll('\\', '/').split('/').at(-1).toLowerCase().replace(/\.exe$/, '');
    if (!validIdentifier(executable)) return null;
    let index = 1;
    if (executable === 'git') {
      while (tokens[index]?.startsWith('-')) {
        const option = tokens[index++];
        if (option === '-C') {
          if (!tokens[index++]) return null;
        } else if (option === '-c') {
          const setting = tokens[index++];
          const equals = setting?.indexOf('=');
          if (!setting || equals < 1 || equals === setting.length - 1) return null;
        } else if (option === '--no-pager' || option === '-P') {
          continue;
        } else if (option.startsWith('--git-dir=')) {
          if (option.length === '--git-dir='.length) return null;
        } else if (option.startsWith('--work-tree=')) {
          if (option.length === '--work-tree='.length) return null;
        } else {
          return null;
        }
      }
    }
    if (!validIdentifier(tokens[index])) return null;
    return { tool: 'shell', executable, subcommand: tokens[index] };
  } catch (_) {
    return null;
  }
}

function normalizeGitCommitCommand(command) {
  const segments = splitSimpleCommandSegments(command);
  if (!segments) return null;
  for (const segment of segments) {
    const invocation = normalizeShellCommand(segment);
    if (invocation?.executable === 'git' && invocation.subcommand === 'commit') return invocation;
  }
  return null;
}

function normalizeEvent(event) {
  if (!isObject(event) || !['action', 'failure'].includes(event.phase) || event.tool !== 'shell' ||
      !isObject(event.outcome) || ![true, false, 'unknown'].includes(event.outcome.failed) ||
      (event.outcome.output !== undefined && typeof event.outcome.output !== 'string') ||
      (event.phase === 'failure' && event.outcome.output && event.outcome.output.length > LIMITS.output)) return null;
  const segments = splitSimpleCommandSegments(event.command);
  if (!segments) return null;
  const invocations = segments.map(normalizeShellCommand).filter(Boolean);
  return invocations.length
    ? { phase: event.phase, tool: 'shell', command: event.command, outcome: event.outcome,
      invocations, compound: segments.length > 1 }
    : null;
}

function ruleMatches(rule, invocation) {
  return rule.tool === invocation.tool && rule.executable === invocation.executable && rule.subcommand === invocation.subcommand;
}

function hasDiagnostic(output, diagnostics) {
  const accepted = new Set(diagnostics);
  return output.split(/\r?\n/).some(line => {
    const found = line.match(/^\s*✖\s+[^[]+\[([a-z0-9][a-z0-9_-]{0,63})\]\s*$/);
    return found && accepted.has(found[1]);
  });
}

function eventMatches(match, event) {
  if (!match) return false;
  const matchesInvocation = rule => event.invocations.some(invocation => ruleMatches(rule, invocation));
  if (event.phase === 'action') return Boolean(match.actions?.some(matchesInvocation));
  if (typeof event.outcome.output !== 'string') return false;
  return Boolean(match.failures?.some(rule => matchesInvocation(rule) &&
    hasDiagnostic(event.outcome.output, rule.diagnostics) &&
    (event.outcome.failed === true || event.compound)));
}

function validProvisionalCandidate(candidate) {
  const allowed = ['identity', 'signature', 'promotionId', 'match', 'cue', 'lesson'];
  if (!isObject(candidate) || !hasOnlyKeys(candidate, allowed) || !validIdentifier(candidate.identity) ||
      (candidate.signature !== undefined && !validIdentifier(candidate.signature)) ||
      (candidate.promotionId !== undefined && !RECORD_ID_PATTERN.test(candidate.promotionId)) ||
      typeof candidate.lesson !== 'string' || !candidate.lesson.trim() || candidate.lesson.length > LIMITS.candidateText ||
      (candidate.cue !== undefined && (typeof candidate.cue !== 'string' || candidate.cue.length > LIMITS.candidateText))) {
    throw new Error('invalid provisional candidate');
  }
  return {
    id: candidate.identity,
    identity: candidate.signature ? `signature:${candidate.signature}` : `identity:${candidate.identity}`,
    signature: candidate.signature || null,
    promotionId: candidate.promotionId || null,
    match: validateMatch(candidate.match),
    cue: candidate.cue || '',
    lesson: candidate.lesson,
    source: 'provisional'
  };
}

function readProvisional(source, workspaceIdentity) {
  if (source === undefined) return [];
  if (typeof source !== 'function') throw new Error('invalid provisional source');
  const values = source(workspaceIdentity, {
    maxCandidates: LIMITS.candidates,
    maxBytes: LIMITS.sourceBytes,
    maxTextChars: LIMITS.candidateText
  });
  if (!Array.isArray(values) || values.length > LIMITS.candidates) throw new Error('oversized provisional source');
  const result = values.map(validProvisionalCandidate);
  if (Buffer.byteLength(JSON.stringify(result), 'utf8') > LIMITS.sourceBytes) throw new Error('oversized provisional source');
  return result;
}

function matchedRepoCandidates(root, event) {
  try {
    const { ledger, rows } = readIndex(root);
    const candidates = [];
    for (const row of rows) {
      if (row.match && eventMatches(row.match, event)) {
        candidates.push(readRecord(ledger, row));
        if (candidates.length > LIMITS.candidates) throw new Error('too many repo candidates');
      }
    }
    return candidates;
  } catch (_) {
    return [];
  }
}

function matchedProvisionalCandidates(source, workspaceIdentity, event) {
  try {
    return readProvisional(source, workspaceIdentity)
      .filter(candidate => eventMatches(candidate.match, event));
  } catch (_) {
    return [];
  }
}

function collapseCandidates(repo, provisional) {
  const compare = (left, right) => left < right ? -1 : left > right ? 1 : 0;
  const orderedRepo = [...repo].sort((a, b) => compare(a.signature, b.signature) || compare(a.id, b.id));
  const orderedProvisional = [...provisional].sort((a, b) =>
    compare(a.signature || a.id, b.signature || b.id) || compare(a.id, b.id));
  const result = [];
  const aliases = new Map();
  const add = candidate => {
    const keys = [`id:${candidate.id}`];
    if (candidate.signature) keys.push(`signature:${candidate.signature}`);
    if (candidate.promotionId) keys.push(`id:${candidate.promotionId}`);
    if (keys.some(key => aliases.has(key))) return;
    const identity = candidate.signature ? `signature:${candidate.signature}` : candidate.identity;
    candidate.lessonIdentity = identity;
    result.push(candidate);
    for (const key of keys) aliases.set(key, identity);
  };
  orderedRepo.forEach(add);
  orderedProvisional.forEach(add);
  return result;
}

function ensureStateDir(stateDir) {
  if (typeof stateDir !== 'string' || !path.isAbsolute(stateDir)) return null;
  try {
    fs.mkdirSync(stateDir, { recursive: true, mode: 0o700 });
    const real = fs.realpathSync.native(stateDir);
    return fs.statSync(real).isDirectory() ? real : null;
  } catch (_) {
    return null;
  }
}

function claim(stateDir, input, candidate, phase) {
  const key = crypto.createHash('sha256').update(JSON.stringify([
    input.workspaceIdentity, input.sessionIdentity, candidate.lessonIdentity, phase
  ])).digest('hex');
  const file = path.join(stateDir, `ledger-match-${key}.claim`);
  const token = crypto.randomBytes(16).toString('hex');
  try {
    const fd = fs.openSync(file, 'wx', 0o600);
    try {
      fs.writeFileSync(fd, token, 'utf8');
      fs.closeSync(fd);
      return { status: 'claimed', file, token };
    } catch (error) {
      try { fs.closeSync(fd); } catch (_) {}
      try { fs.unlinkSync(file); } catch (_) {}
      return { status: 'unavailable' };
    }
  } catch (error) {
    return { status: error.code === 'EEXIST' ? 'exists' : 'unavailable' };
  }
}

function block(candidate) {
  return candidate.source === 'repo'
    ? `Cue:\n${candidate.cue}\nLesson:\n${candidate.lesson}`
    : `${PROVISIONAL_LABEL}\n${candidate.lesson}`;
}

function charCount(text) {
  return Array.from(text).length;
}

function matchLedgerLessons(input) {
  try {
    if (!isObject(input) || typeof input.workspaceIdentity !== 'string' || !input.workspaceIdentity.trim() ||
        input.workspaceIdentity.length > 256 || /[\0\r\n]/.test(input.workspaceIdentity) ||
        typeof input.sessionIdentity !== 'string' || !input.sessionIdentity.trim() ||
        input.sessionIdentity.length > 256 || /[\0\r\n]/.test(input.sessionIdentity)) return null;
    const root = canonicalWorkspace(input.workspaceRoot);
    const event = normalizeEvent(input.event);
    if (!event) return null;
    let repo = matchedRepoCandidates(root, event);
    let provisional = matchedProvisionalCandidates(input.provisionalSource, input.workspaceIdentity, event);
    const candidates = collapseCandidates(repo, provisional);
    if (!candidates.length) return null;
    const state = ensureStateDir(input.stateDir);
    if (!state) return null;

    const selected = [];
    const claims = [];
    for (const candidate of candidates) {
      if (selected.length >= LIMITS.reminders) break;
      const prospective = [...selected.map(item => block(item)), block(candidate)].join('\n\n') + `\n\n${INVITATION}`;
      if (charCount(prospective) > LIMITS.reminderChars) continue;
      const claimed = claim(state, input, candidate, event.phase);
      if (claimed.status === 'exists') continue;
      if (claimed.status !== 'claimed') {
        for (const prior of claims) releaseClaim(prior);
        return null;
      }
      claims.push(claimed);
      selected.push(candidate);
    }
    if (!selected.length) return null;
    const result = {
      text: `${selected.map(block).join('\n\n')}\n\n${INVITATION}`,
      ids: selected.map(candidate => candidate.id)
    };
    PENDING_HANDOFFS.set(result, claims);
    return result;
  } catch (_) {
    return null;
  }
}

function releaseClaim(claimed) {
  try {
    if (fs.readFileSync(claimed.file, 'utf8') !== claimed.token) return true;
  } catch (error) {
    if (error.code === 'ENOENT') return true;
    return false;
  }
  try { fs.unlinkSync(claimed.file); return true; } catch (_) { return false; }
}

// Carriers release a reservation only when the returned context handoff is dropped.
function releaseLedgerMatch(result) {
  const claims = result && PENDING_HANDOFFS.get(result);
  if (!claims) return false;
  const remaining = claims.filter(claimed => !releaseClaim(claimed));
  if (remaining.length) {
    PENDING_HANDOFFS.set(result, remaining);
    return false;
  }
  PENDING_HANDOFFS.delete(result);
  return true;
}

module.exports = { matchLedgerLessons, normalizeGitCommitCommand, releaseLedgerMatch };
