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

function canonicalMatch(match) {
  const normalized = {};
  if (match.actions) normalized.actions = match.actions.map(rule => ({
    tool: rule.tool, executable: rule.executable, subcommand: rule.subcommand
  }));
  if (match.failures) normalized.failures = match.failures.map(rule => ({
    tool: rule.tool, executable: rule.executable, subcommand: rule.subcommand, diagnostics: rule.diagnostics
  }));
  return JSON.stringify(normalized);
}

function parseMatchFrontmatter(frontmatter) {
  const lines = frontmatter.split(/\r?\n/);
  const start = lines.findIndex(line => line === 'match:');
  if (start === -1) return null;
  let currentList = null;
  let currentRule = null;
  let inDiagnostics = false;
  const match = {};
  for (const line of lines.slice(start + 1)) {
    if (!line.trim()) continue;
    if (!/^\s/.test(line)) break;
    let found = line.match(/^  (actions|failures):$/);
    if (found) {
      currentList = found[1];
      if (Object.hasOwn(match, currentList)) throw new Error('duplicate match list');
      match[currentList] = [];
      currentRule = null;
      inDiagnostics = false;
      continue;
    }
    if (line === '    - tool: shell' && currentList) {
      currentRule = { tool: 'shell' };
      match[currentList].push(currentRule);
      inDiagnostics = false;
      continue;
    }
    found = line.match(/^      (executable|subcommand): ([a-z0-9][a-z0-9_-]{0,63})$/);
    if (found && currentRule) {
      if (Object.hasOwn(currentRule, found[1])) throw new Error('duplicate match field');
      currentRule[found[1]] = found[2];
      continue;
    }
    if (line === '      diagnostics:' && currentRule && currentList === 'failures') {
      if (Object.hasOwn(currentRule, 'diagnostics')) throw new Error('duplicate diagnostics');
      currentRule.diagnostics = [];
      inDiagnostics = true;
      continue;
    }
    found = line.match(/^        - ([a-z0-9][a-z0-9_-]{0,63})$/);
    if (found && inDiagnostics && currentRule) {
      currentRule.diagnostics.push(found[1]);
      continue;
    }
    throw new Error('malformed match frontmatter');
  }
  return validateMatch(match);
}

function frontmatter(text) {
  const found = text.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
  if (!found) throw new Error('missing frontmatter');
  return found[1];
}

function scalar(frontmatterText, key) {
  const found = frontmatterText.match(new RegExp(`^${key}: ([^\\r\\n]+)$`, 'm'));
  return found ? found[1].trim() : null;
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
  if (!isObject(row) || !RECORD_ID_PATTERN.test(row.id) || !validIdentifier(row.signature) ||
      typeof row.file !== 'string') throw new Error('invalid index row');
  const file = FILE_PATTERN.exec(row.file);
  if (!file || file[1] !== row.id) throw new Error('invalid record path');
  const match = Object.hasOwn(row, 'match') ? validateMatch(row.match) : null;
  return { id: row.id, signature: row.signature, file: row.file, match };
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
  const fm = frontmatter(text);
  if (scalar(fm, 'id') !== row.id || scalar(fm, 'signature') !== row.signature) throw new Error('stale record identity');
  const sourceMatch = parseMatchFrontmatter(fm);
  if (row.match && (!sourceMatch || canonicalMatch(row.match) !== canonicalMatch(sourceMatch))) throw new Error('stale indexed match');
  if (!row.match && sourceMatch) throw new Error('stale indexed match');
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

// shortcut: only simple direct invocations are parsed; add wrapper support if a carrier needs it.
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

function normalizeShellCommand(command) {
  try {
    const tokens = words(command);
    if (!tokens || tokens.length < 2) return null;
    const executable = tokens[0].replaceAll('\\', '/').split('/').at(-1).toLowerCase().replace(/\.exe$/, '');
    if (!validIdentifier(executable) || !validIdentifier(tokens[1])) return null;
    return { tool: 'shell', executable, subcommand: tokens[1] };
  } catch (_) {
    return null;
  }
}

function normalizeGitCommitCommand(command) {
  const invocation = normalizeShellCommand(command);
  return invocation?.executable === 'git' && invocation.subcommand === 'commit' ? invocation : null;
}

function normalizeEvent(event) {
  if (!isObject(event) || !['action', 'failure'].includes(event.phase) || event.tool !== 'shell' ||
      !isObject(event.outcome) || ![true, false, 'unknown'].includes(event.outcome.failed) ||
      (event.outcome.output !== undefined && typeof event.outcome.output !== 'string') ||
      (event.phase === 'failure' && event.outcome.output && event.outcome.output.length > LIMITS.output)) return null;
  const invocation = normalizeShellCommand(event.command);
  return invocation ? { phase: event.phase, tool: 'shell', command: event.command, outcome: event.outcome, invocation } : null;
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
  if (event.phase === 'action') return Boolean(match.actions?.some(rule => ruleMatches(rule, event.invocation)));
  return event.outcome.failed === true && typeof event.outcome.output === 'string' &&
    Boolean(match.failures?.some(rule => rule.tool === event.invocation.tool &&
      rule.executable === event.invocation.executable && rule.subcommand === event.invocation.subcommand &&
      hasDiagnostic(event.outcome.output, rule.diagnostics)));
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
