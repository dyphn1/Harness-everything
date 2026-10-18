'use strict';

const lifecycle = require('./doc-lifecycle');

const CATALOG = Object.freeze([
  { capability: 'doc-lint', strength: 'MUST', scope: 'Changed governed documents', acceptance: 'Run document lifecycle lint for every changed governed document.' },
  { capability: 'link-check', strength: 'MUST', scope: 'Changed governed documents', acceptance: 'Check in-repository links for every changed governed document.' },
  { capability: 'update-over-create', strength: 'SHOULD', scope: 'New governed documents', acceptance: 'Confirm an existing document could not be updated instead.' },
  { capability: 'outline-confirmation', strength: 'SHOULD', scope: 'New governed documents', acceptance: 'Confirm the new document outline before drafting.' },
  { capability: 'derived-regenerate', strength: 'MUST', scope: 'Affected declared derived views', acceptance: 'Regenerate the affected view and confirm it matches its source.' },
  { capability: 'quality-review', strength: 'MUST', scope: 'Normative document changes', acceptance: 'Review changes to normative document fields and content.' },
  { capability: 'conflict-check', strength: 'MUST', scope: 'Normative document changes', acceptance: 'Check normative changes for conflicts with current project documents.' },
  { capability: 'prose-reminder', strength: 'SHOULD', scope: 'Changed governed reference content', acceptance: 'Review the prose-to-structure reminder for reference content.' },
  { capability: 'requirement-sync', strength: 'MUST', scope: 'Code changes or changed REQ-citing tests', acceptance: 'Evaluate whether affected requirements need an update or supported no-change record.' }
]);

const CODE_EXTENSION = /\.(?:c|cc|cpp|h|hpp|m|mm|go|rs|java|kt|swift|js|jsx|mjs|cjs|ts|tsx|py|rb|php|sh|ps1|sql)$/i;
const TEST_PATH = /(?:^|\/)(?:test|tests|__tests__|spec)(?:\/|$)|(?:^|\/)[^/]*(?:\.test|\.spec)\.[^/]+$/i;
const REQUIREMENT_ID = /\bREQ-[A-Z][A-Z0-9]{1,9}-\d{3,}\b/;
const REQUIREMENT_IDS = /\b(REQ-[A-Z][A-Z0-9]{1,9}-\d{3,})\b/g;
const MAX_LINE_DIFF_CELLS = 2_000_000;
const DOCUMENT_NORMATIVE_FIELDS = ['status', 'supersedes'];
const INVENTORY_ENVELOPE_FIELDS = [
  'complete',
  'waiverInventoryComplete',
  'baseDigest',
  'candidateDigest',
  'configDigest'
];

function compareText(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function normalizePath(value) {
  return String(value).replace(/\\/g, '/').replace(/^\.\//, '');
}

function snapshotFiles(snapshot) {
  const source = snapshot && snapshot.files && typeof snapshot.files === 'object' ? snapshot.files : {};
  const files = {};
  for (const path of Object.keys(source).sort(compareText)) {
    if (typeof source[path] === 'string') files[normalizePath(path)] = source[path];
  }
  return files;
}

function isSnapshotInput(snapshot) {
  return Boolean(snapshot && snapshot.files && typeof snapshot.files === 'object' && !Array.isArray(snapshot.files)
    && Object.values(snapshot.files).every(text => typeof text === 'string'));
}

function isConfigInput(config) {
  return Boolean(config && typeof config === 'object' && !Array.isArray(config));
}

function copyInventoryEnvelope(inventory) {
  if (!inventory || typeof inventory !== 'object' || Array.isArray(inventory)) return undefined;
  const envelope = {};
  for (const field of INVENTORY_ENVELOPE_FIELDS) {
    if (Object.prototype.hasOwnProperty.call(inventory, field)) envelope[field] = inventory[field];
  }
  return envelope;
}

function globToRegExp(glob) {
  const source = normalizePath(glob);
  let pattern = '^';
  for (let index = 0; index < source.length; index++) {
    const char = source[index];
    if (char === '*' && source[index + 1] === '*') {
      if (source[index + 2] === '/') {
        pattern += '(?:.*/)?';
        index += 2;
      } else {
        pattern += '.*';
        index++;
      }
    } else if (char === '*') {
      pattern += '[^/]*';
    } else {
      pattern += char.replace(/[|\\{}()[\]^$+?.]/g, '\\$&');
    }
  }
  return new RegExp(`${pattern}$`);
}

function matchesAny(path, globs) {
  return Array.isArray(globs) && globs.some(glob => typeof glob === 'string' && globToRegExp(glob).test(path));
}

function governedEntry(path, config) {
  const entries = Array.isArray(config && config.governed) ? config.governed : [];
  return entries.find(entry => entry && typeof entry.path === 'string' && globToRegExp(entry.path).test(path)) || null;
}

function parsedDocument(path, text, config) {
  const parsed = lifecycle.parseFrontmatter(text);
  const entry = governedEntry(path, config);
  const legacy = matchesAny(path, config && config.legacy);
  return {
    path,
    role: entry && typeof entry.role === 'string' ? entry.role : parsed.data && parsed.data.role || null,
    legacy,
    frontmatter: parsed.data,
    body: parsed.body,
    error: parsed.error,
    storedBytes: Buffer.from(text, 'utf8')
  };
}

function analyzeSnapshotWithLifecycle(files, config) {
  const docs = Object.keys(files).sort(compareText).map(path => parsedDocument(path, files[path], config));
  const analysis = lifecycle.analyzeDocs(docs, config, { all: true });
  return {
    docs,
    analysis,
    summary: { diagnostics: analysis.diagnostics, evidence: analysis.evidence }
  };
}

function analyzeSnapshot(files, config) {
  return analyzeSnapshotWithLifecycle(files, config).summary;
}

function findRenames(base, candidate) {
  const oldOnly = Object.keys(base).filter(path => !Object.prototype.hasOwnProperty.call(candidate, path)).sort(compareText);
  const newOnly = Object.keys(candidate).filter(path => !Object.prototype.hasOwnProperty.call(base, path)).sort(compareText);
  const destinations = new Map();
  for (const path of newOnly) {
    const text = candidate[path];
    if (!destinations.has(text)) destinations.set(text, []);
    destinations.get(text).push(path);
  }
  const moves = [];
  const consumedNew = new Set();
  const consumedOld = new Set();
  for (const from of oldOnly) {
    const matches = destinations.get(base[from]);
    const to = matches && matches.find(path => !consumedNew.has(path));
    if (!to) continue;
    moves.push({ kind: 'rename', from, to, baseText: base[from], candidateText: candidate[to] });
    consumedOld.add(from);
    consumedNew.add(to);
  }
  const changes = [...moves];
  for (const path of Object.keys(base).sort(compareText)) {
    if (Object.prototype.hasOwnProperty.call(candidate, path) && base[path] !== candidate[path]) {
      changes.push({ kind: 'modified', path, baseText: base[path], candidateText: candidate[path] });
    }
  }
  for (const path of oldOnly) {
    if (!consumedOld.has(path)) changes.push({ kind: 'deleted', path, baseText: base[path] });
  }
  for (const path of newOnly) {
    if (!consumedNew.has(path)) changes.push({ kind: 'added', path, candidateText: candidate[path] });
  }
  return changes.sort((left, right) => compareText(left.to || left.path || left.from, right.to || right.path || right.from)
    || compareText(left.kind, right.kind));
}

function changePaths(change) {
  return change.kind === 'rename' ? [change.from, change.to] : [change.path];
}

function uniqueSorted(values) {
  return [...new Set(values.filter(value => typeof value === 'string'))].sort(compareText);
}

const REGEX_PREFIX_KEYWORDS = new Set([
  'await', 'case', 'delete', 'do', 'else', 'in', 'instanceof', 'new', 'of', 'return', 'throw',
  'typeof', 'void', 'yield'
]);
const MULTI_CHAR_TOKENS = [
  '>>>=', '===', '!==', '**=', '&&=', '||=', '??=', '>>>', '<<=', '>>=', '...', '=>', '==', '!=',
  '<=', '>=', '++', '--', '**', '&&', '||', '??', '?.', '+=', '-=', '*=', '/=', '%=', '&=', '|=',
  '^=', '<<', '>>'
];

function tokenizeTestSource(text) {
  const source = String(text || '');
  const tokens = [];
  const comments = [];
  let index = 0;
  let line = 0;
  let canStartRegex = true;
  let valid = true;

  const push = (type, value, tokenLine = line) => tokens.push({ type, value, line: tokenLine, index: tokens.length });
  const bumpLine = char => {
    if (char === '\n' || (char === '\r' && source[index + 1] !== '\n')) line++;
  };
  const skipEscapedChar = () => {
    const escaped = source[index + 1];
    if (escaped === '\r' && source[index + 2] === '\n') {
      line++;
      index += 3;
    } else {
      bumpLine(escaped);
      index += 2;
    }
  };
  const isIdentifierStart = char => Boolean(char) && /[A-Za-z_$]/.test(char);
  const isIdentifierPart = char => Boolean(char) && /[A-Za-z0-9_$]/.test(char);

  function addPunctuator(value, tokenLine) {
    push('punctuator', value, tokenLine);
    if (value === ')' || value === ']' || value === '}' || value === '.' || value === '?.' || value === '++' || value === '--') {
      canStartRegex = false;
    } else {
      canStartRegex = true;
    }
  }

  function scanString(quote) {
    const start = index;
    const startLine = line;
    index++;
    while (index < source.length) {
      const char = source[index];
      if (char === '\\') {
        if (index + 1 >= source.length) return false;
        skipEscapedChar();
        continue;
      }
      if (char === quote) {
        index++;
        push('string', source.slice(start, index), startLine);
        canStartRegex = false;
        return true;
      }
      if (char === '\n' || char === '\r') return false;
      index++;
    }
    return false;
  }

  function scanRegex() {
    const start = index;
    const startLine = line;
    index++;
    let inCharacterClass = false;
    while (index < source.length) {
      const char = source[index];
      if (char === '\\') {
        if (index + 1 >= source.length || source[index + 1] === '\n' || source[index + 1] === '\r') return false;
        index += 2;
        continue;
      }
      if (char === '[') inCharacterClass = true;
      else if (char === ']') inCharacterClass = false;
      else if (char === '/' && !inCharacterClass) {
        index++;
        while (isIdentifierPart(source[index])) index++;
        push('regex', source.slice(start, index), startLine);
        canStartRegex = false;
        return true;
      }
      if (char === '\n' || char === '\r') return false;
      index++;
    }
    return false;
  }

  function scanTemplate() {
    index++;
    let chunkStart = index;
    let chunkLine = line;
    while (index < source.length) {
      const char = source[index];
      if (char === '\\') {
        if (index + 1 >= source.length) return false;
        skipEscapedChar();
        continue;
      }
      if (char === '`') {
        push('template', source.slice(chunkStart, index), chunkLine);
        index++;
        canStartRegex = false;
        return true;
      }
      if (char === '$' && source[index + 1] === '{') {
        push('template', source.slice(chunkStart, index), chunkLine);
        const markerLine = line;
        index += 2;
        push('template-expression', '${', markerLine);
        canStartRegex = true;
        if (!scanCode(true)) return false;
        chunkStart = index;
        chunkLine = line;
        continue;
      }
      bumpLine(char);
      index++;
    }
    return false;
  }

  function scanCode(stopAtTemplateBrace = false) {
    let braceDepth = 0;
    let parenDepth = 0;
    let bracketDepth = 0;
    while (index < source.length) {
      const char = source[index];
      if (/\s/.test(char)) {
        bumpLine(char);
        index++;
        continue;
      }

      if (char === '/' && source[index + 1] === '/') {
        const start = index;
        const commentLine = line;
        const topLevel = !stopAtTemplateBrace && braceDepth === 0 && parenDepth === 0 && bracketDepth === 0;
        index += 2;
        const contentStart = index;
        while (index < source.length && source[index] !== '\n' && source[index] !== '\r') index++;
        comments.push({
          kind: 'line', marker: '//', content: source.slice(contentStart, index),
          start, end: index, line: commentLine, topLevel
        });
        continue;
      }
      if (char === '/' && source[index + 1] === '*') {
        const start = index;
        const commentLine = line;
        const topLevel = !stopAtTemplateBrace && braceDepth === 0 && parenDepth === 0 && bracketDepth === 0;
        index += 2;
        const contentStart = index;
        let closed = false;
        while (index < source.length) {
          if (source[index] === '*' && source[index + 1] === '/') {
            const contentEnd = index;
            index += 2;
            closed = true;
            comments.push({
              kind: 'block', marker: '/*', content: source.slice(contentStart, contentEnd),
              start, end: index, line: commentLine, topLevel
            });
            break;
          }
          bumpLine(source[index]);
          index++;
        }
        if (!closed) return false;
        continue;
      }
      // Preserve Python-style whole-line comments for the test paths this helper also accepts.
      if (char === '#' && source.slice(0, index).split(/\r?\n/).pop().trim() === '') {
        const start = index;
        const commentLine = line;
        const topLevel = !stopAtTemplateBrace && braceDepth === 0 && parenDepth === 0 && bracketDepth === 0;
        index++;
        const contentStart = index;
        while (index < source.length && source[index] !== '\n' && source[index] !== '\r') index++;
        comments.push({
          kind: 'line', marker: '#', content: source.slice(contentStart, index),
          start, end: index, line: commentLine, topLevel
        });
        continue;
      }

      if (stopAtTemplateBrace && char === '}' && braceDepth === 0) {
        addPunctuator('}', line);
        index++;
        return true;
      }
      if (char === '{') {
        addPunctuator(char, line);
        braceDepth++;
        index++;
        continue;
      }
      if (char === '}' && braceDepth > 0) {
        addPunctuator(char, line);
        braceDepth--;
        index++;
        continue;
      }
      if (char === '(') {
        addPunctuator(char, line);
        parenDepth++;
        index++;
        continue;
      }
      if (char === ')') {
        if (parenDepth > 0) parenDepth--;
        addPunctuator(char, line);
        index++;
        continue;
      }
      if (char === '[') {
        addPunctuator(char, line);
        bracketDepth++;
        index++;
        continue;
      }
      if (char === ']') {
        if (bracketDepth > 0) bracketDepth--;
        addPunctuator(char, line);
        index++;
        continue;
      }
      if (char === "'" || char === '"') {
        if (!scanString(char)) return false;
        continue;
      }
      if (char === '`') {
        if (!scanTemplate()) return false;
        continue;
      }
      if (char === '/' && canStartRegex) {
        if (!scanRegex()) return false;
        continue;
      }
      if (isIdentifierStart(char)) {
        const start = index;
        const startLine = line;
        index++;
        while (isIdentifierPart(source[index])) index++;
        const value = source.slice(start, index);
        push('identifier', value, startLine);
        canStartRegex = REGEX_PREFIX_KEYWORDS.has(value);
        continue;
      }
      if (/[0-9]/.test(char)) {
        const start = index;
        const startLine = line;
        index++;
        while (/[A-Za-z0-9_$\.]/.test(source[index] || '')) index++;
        push('number', source.slice(start, index), startLine);
        canStartRegex = false;
        continue;
      }

      const tokenLine = line;
      const operator = MULTI_CHAR_TOKENS.find(value => source.startsWith(value, index));
      const value = operator || char;
      index += value.length;
      addPunctuator(value, tokenLine);
    }
    return !stopAtTemplateBrace;
  }

  valid = scanCode();
  return { tokens, comments, valid };
}

function tokenKey(token) {
  return `${token.type}\u0000${token.value}`;
}

function changedTokens(beforeTokens, afterTokens) {
  let prefix = 0;
  while (prefix < beforeTokens.length && prefix < afterTokens.length
    && tokenKey(beforeTokens[prefix]) === tokenKey(afterTokens[prefix])) prefix++;
  let beforeEnd = beforeTokens.length;
  let afterEnd = afterTokens.length;
  while (beforeEnd > prefix && afterEnd > prefix
    && tokenKey(beforeTokens[beforeEnd - 1]) === tokenKey(afterTokens[afterEnd - 1])) {
    beforeEnd--;
    afterEnd--;
  }
  const removedCount = beforeEnd - prefix;
  const addedCount = afterEnd - prefix;
  const width = addedCount + 1;
  if ((removedCount + 1) * width > MAX_LINE_DIFF_CELLS) return null;

  const table = new Uint32Array((removedCount + 1) * width);
  for (let oldIndex = removedCount - 1; oldIndex >= 0; oldIndex--) {
    for (let newIndex = addedCount - 1; newIndex >= 0; newIndex--) {
      const cell = oldIndex * width + newIndex;
      table[cell] = tokenKey(beforeTokens[prefix + oldIndex]) === tokenKey(afterTokens[prefix + newIndex])
        ? table[(oldIndex + 1) * width + newIndex + 1] + 1
        : Math.max(table[(oldIndex + 1) * width + newIndex], table[cell + 1]);
    }
  }

  const removed = [];
  const added = [];
  let oldIndex = 0;
  let newIndex = 0;
  while (oldIndex < removedCount && newIndex < addedCount) {
    if (tokenKey(beforeTokens[prefix + oldIndex]) === tokenKey(afterTokens[prefix + newIndex])) {
      oldIndex++;
      newIndex++;
    } else if (table[(oldIndex + 1) * width + newIndex] >= table[oldIndex * width + newIndex + 1]) {
      removed.push(beforeTokens[prefix + oldIndex++]);
    } else {
      added.push(afterTokens[prefix + newIndex++]);
    }
  }
  while (oldIndex < removedCount) removed.push(beforeTokens[prefix + oldIndex++]);
  while (newIndex < addedCount) added.push(afterTokens[prefix + newIndex++]);
  return { removed, added };
}

function snapshotText(snapshot, path) {
  const files = snapshot && snapshot.files && typeof snapshot.files === 'object' ? snapshot.files : {};
  const key = Object.keys(files).filter(candidate => normalizePath(candidate) === path).pop();
  if (key === undefined) return { readable: true, text: undefined };
  return typeof files[key] === 'string' ? { readable: true, text: files[key] } : { readable: false, text: undefined };
}

// Build just enough structure to map changed tokens to statements and their
// nearest test()/it() call. Parentheses inside comments and literals are opaque
// tokens in this scan, so they cannot change the depth.
function scanTestSource(text) {
  const lexical = tokenizeTestSource(text);
  const tokens = lexical.tokens;
  const parenDepthBefore = new Array(tokens.length);
  const parenDepthAfter = new Array(tokens.length);
  const braceDepthBefore = new Array(tokens.length);
  const braceDepthAfter = new Array(tokens.length);
  const parenPairs = new Map();
  const openParens = [];
  let braceDepth = 0;
  let valid = lexical.valid;

  for (let index = 0; index < tokens.length; index++) {
    const token = tokens[index];
    parenDepthBefore[index] = openParens.length;
    braceDepthBefore[index] = braceDepth;
    if (token.type === 'template-expression' && token.value === '${') braceDepth++;
    else if (token.type === 'punctuator') {
      if (token.value === '(') openParens.push(index);
      else if (token.value === ')') {
        const openIndex = openParens.pop();
        if (openIndex === undefined) valid = false;
        else parenPairs.set(openIndex, index);
      } else if (token.value === '{') braceDepth++;
      else if (token.value === '}') {
        braceDepth--;
        if (braceDepth < 0) valid = false;
      }
    }
    parenDepthAfter[index] = openParens.length;
    braceDepthAfter[index] = braceDepth;
  }
  if (openParens.length || braceDepth !== 0) valid = false;

  const scan = {
    tokens,
    comments: lexical.comments,
    valid,
    parenDepthBefore,
    parenDepthAfter,
    braceDepthBefore,
    braceDepthAfter,
    parenPairs,
    calls: []
  };
  for (let index = 0; index < tokens.length - 1; index++) {
    const token = tokens[index];
    if (token.type !== 'identifier' || !['test', 'it'].includes(token.value)
      || tokens[index + 1].value !== '(') continue;
    const openIndex = index + 1;
    const closeIndex = parenPairs.get(openIndex);
    const endIndex = Number.isInteger(closeIndex) ? closeIndex : tokens.length - 1;
    const callArgumentDepth = parenDepthBefore[openIndex] + 1;
    const callBraceDepth = braceDepthBefore[openIndex];
    const ids = new Set();
    for (let cursor = openIndex + 1; cursor <= endIndex; cursor++) {
      const candidate = tokens[cursor];
      if (!['string', 'template'].includes(candidate.type)
        || parenDepthBefore[cursor] !== callArgumentDepth
        || braceDepthBefore[cursor] !== callBraceDepth) continue;
      for (const match of candidate.value.matchAll(REQUIREMENT_IDS)) ids.add(match[1]);
    }
    const signatureTokens = [];
    let titleSeparator = -1;
    for (let cursor = openIndex + 1; cursor <= endIndex; cursor++) {
      if (tokens[cursor].value === ',' && parenDepthBefore[cursor] === callArgumentDepth
        && braceDepthBefore[cursor] === callBraceDepth) {
        titleSeparator = cursor;
        break;
      }
      signatureTokens.push(tokenKey(tokens[cursor]));
    }
    const bodyStartIndex = titleSeparator < 0 ? endIndex : titleSeparator + 1;
    const bodyEndIndex = Number.isInteger(closeIndex) ? closeIndex - 1 : endIndex;
    const bodySignature = tokens.slice(bodyStartIndex, bodyEndIndex + 1).map(tokenKey).join('\u0001');
    scan.calls.push({
      name: token.value,
      startIndex: index,
      openIndex,
      closeIndex,
      endIndex,
      titleStartIndex: openIndex + 1,
      titleEndIndex: titleSeparator < 0 ? bodyEndIndex : titleSeparator - 1,
      complete: Number.isInteger(closeIndex),
      ids: [...ids].sort(compareText),
      signature: `${token.value}:${signatureTokens.join('\u0001')}`,
      bodySignature,
      identitySignature: `${[...ids].sort(compareText).join(',')}\u0000${bodySignature}`
    });
  }
  return scan;
}

function continuesAcrossLine(previous, next) {
  const continuationTokens = new Set([
    '.', '?.', ',', '(', '[', '=', '=>', '+', '-', '*', '/', '%', '&&', '||', '??',
    '===', '!==', '==', '!=', '<', '>', '<=', '>=', '|', '&', '?', ':', '...'
  ]);
  return continuationTokens.has(previous.value) || continuationTokens.has(next.value);
}

function statementRangeForToken(scan, tokenIndex) {
  if (!scan || !scan.valid || !Number.isInteger(tokenIndex)
    || tokenIndex < 0 || tokenIndex >= scan.tokens.length) return null;
  const tokens = scan.tokens;
  const targetBraceDepth = scan.braceDepthBefore[tokenIndex];
  let startIndex = 0;
  let baseParenDepth = 0;

  for (let index = tokenIndex - 1; index >= 0; index--) {
    const value = tokens[index].value;
    if (scan.braceDepthAfter[index] !== targetBraceDepth) continue;
    if (![';', '{', '}'].includes(value)) continue;
    startIndex = index + 1;
    baseParenDepth = scan.parenDepthAfter[index];
    break;
  }

  for (let index = startIndex; index < tokenIndex; index++) {
    if (tokens[index].line >= tokens[index + 1].line
      || scan.braceDepthAfter[index] !== targetBraceDepth
      || scan.braceDepthBefore[index + 1] !== targetBraceDepth
      || scan.parenDepthAfter[index] !== baseParenDepth
      || scan.parenDepthBefore[index + 1] !== baseParenDepth
      || continuesAcrossLine(tokens[index], tokens[index + 1])) continue;
    startIndex = index + 1;
  }

  let endIndex = tokens.length - 1;
  for (let index = tokenIndex + 1; index < tokens.length; index++) {
    if (tokens[index].value === ';' && scan.braceDepthAfter[index] === targetBraceDepth
      && scan.parenDepthAfter[index] === baseParenDepth) {
      endIndex = index - 1;
      break;
    }
    if (tokens[index].value === '}' && scan.braceDepthBefore[index] === targetBraceDepth
      && scan.braceDepthAfter[index] < targetBraceDepth) {
      endIndex = index - 1;
      break;
    }
    if (tokens[index - 1].line < tokens[index].line
      && scan.braceDepthAfter[index - 1] === targetBraceDepth
      && scan.braceDepthBefore[index] === targetBraceDepth
      && scan.parenDepthAfter[index - 1] === baseParenDepth
      && scan.parenDepthBefore[index] === baseParenDepth
      && !continuesAcrossLine(tokens[index - 1], tokens[index])) {
      endIndex = index - 1;
      break;
    }
  }
  if (startIndex > tokenIndex || endIndex < tokenIndex) return null;
  return { startIndex, endIndex };
}

function assertionCallContainsToken(scan, tokenIndex) {
  if (!scan || !Number.isInteger(tokenIndex)) return false;
  const tokens = scan.tokens;
  const assertionMethods = new Set(['equal', 'deepEqual', 'ok', 'throws', 'strictEqual']);
  const contains = (startIndex, openIndex) => {
    const closeIndex = scan.parenPairs.get(openIndex);
    return Number.isInteger(closeIndex) && tokenIndex >= startIndex && tokenIndex <= closeIndex;
  };

  for (let index = 0; index < tokens.length; index++) {
    const token = tokens[index];
    if (token.type !== 'identifier') continue;
    if (token.value === 'assert') {
      if (tokens[index + 1] && tokens[index + 1].value === '(' && contains(index, index + 1)) return true;
      const memberIndex = index + 2;
      const openIndex = index + 3;
      if (tokens[index + 1] && ['.', '?.'].includes(tokens[index + 1].value)
        && tokens[memberIndex] && tokens[memberIndex].type === 'identifier'
        && tokens[openIndex] && tokens[openIndex].value === '(' && contains(index, openIndex)) return true;
    }
    if (token.value === 'expect' && tokens[index + 1] && tokens[index + 1].value === '(') {
      let endIndex = scan.parenPairs.get(index + 1);
      if (!Number.isInteger(endIndex)) continue;
      let cursor = endIndex + 1;
      while (tokens[cursor] && ['.', '?.'].includes(tokens[cursor].value)
        && tokens[cursor + 1] && tokens[cursor + 1].type === 'identifier') {
        const memberIndex = cursor + 1;
        const openIndex = memberIndex + 1;
        if (tokens[openIndex] && tokens[openIndex].value === '(') {
          const closeIndex = scan.parenPairs.get(openIndex);
          if (!Number.isInteger(closeIndex)) break;
          endIndex = closeIndex;
          cursor = closeIndex + 1;
        } else {
          // Modifiers such as .not, .resolves, and .rejects are property links
          // in the matcher chain; keep scanning for its eventual matcher call.
          endIndex = memberIndex;
          cursor = memberIndex + 1;
        }
      }
      if (tokenIndex >= index && tokenIndex <= endIndex) return true;
    }
    if (assertionMethods.has(token.value) && tokens[index - 1]
      && ['.', '?.'].includes(tokens[index - 1].value)
      && tokens[index + 1] && tokens[index + 1].value === '(' && contains(index - 1, index + 1)) return true;
  }
  return false;
}

function computedAssertionCallContainsToken(scan, tokenIndex, range) {
  if (!scan || !Number.isInteger(tokenIndex) || !range) return false;
  const tokens = scan.tokens;
  const findBracketClose = openIndex => {
    let depth = 0;
    for (let index = openIndex; index < tokens.length; index++) {
      if (tokens[index].value === '[') depth++;
      else if (tokens[index].value === ']') {
        depth--;
        if (depth === 0) return index;
      }
    }
    return null;
  };

  for (let startIndex = range.startIndex; startIndex <= range.endIndex; startIndex++) {
    if (tokens[startIndex].type !== 'identifier'
      || !['assert', 'expect'].includes(tokens[startIndex].value)) continue;
    let cursor = startIndex + 1;
    let endIndex = startIndex;
    let hasComputedMember = false;
    let hasCall = false;

    while (cursor <= range.endIndex) {
      if (tokens[cursor].value === '(') {
        const closeIndex = scan.parenPairs.get(cursor);
        if (!Number.isInteger(closeIndex)) break;
        hasCall = true;
        endIndex = closeIndex;
        cursor = closeIndex + 1;
        continue;
      }
      if (['.', '?.'].includes(tokens[cursor].value) && tokens[cursor + 1]
        && tokens[cursor + 1].value === '[') cursor++;
      if (tokens[cursor].value === '[') {
        const closeIndex = findBracketClose(cursor);
        if (!Number.isInteger(closeIndex)) break;
        hasComputedMember = true;
        endIndex = closeIndex;
        cursor = closeIndex + 1;
        continue;
      }
      if (['.', '?.'].includes(tokens[cursor].value)
        && tokens[cursor + 1] && tokens[cursor + 1].type === 'identifier') {
        endIndex = cursor + 1;
        cursor += 2;
        continue;
      }
      break;
    }

    if (hasComputedMember && hasCall && tokenIndex >= startIndex && tokenIndex <= endIndex) return true;
  }
  return false;
}

function unsupportedAssertionCallContainsToken(scan, tokenIndex, range) {
  if (!scan || !Number.isInteger(tokenIndex) || !range) return false;
  const tokens = scan.tokens;
  const end = Math.min(range.endIndex, tokens.length - 1);
  for (let index = range.startIndex; index <= end; index++) {
    if (tokens[index].type !== 'identifier'
      || !tokens[index + 1] || !['.', '?.'].includes(tokens[index + 1].value)
      || !tokens[index + 2] || tokens[index + 2].type !== 'identifier'
      || !tokens[index + 3] || tokens[index + 3].value !== '(') continue;
    const closeIndex = scan.parenPairs.get(index + 3);
    if (Number.isInteger(closeIndex) && tokenIndex >= index && tokenIndex <= closeIndex) return true;
  }
  return false;
}
function statementHasAssertion(tokens, range) {
  if (!range) return false;
  for (let index = range.startIndex; index <= range.endIndex; index++) {
    const token = tokens[index];
    if (token.type !== 'identifier') continue;
    if (token.value === 'assert') return true;
    if (token.value === 'expect' && tokens[index + 1] && tokens[index + 1].value === '(') return true;
    if (['equal', 'deepEqual', 'ok', 'throws', 'strictEqual'].includes(token.value)
      && tokens[index - 1] && ['.', '?.'].includes(tokens[index - 1].value)
      && tokens[index + 1] && tokens[index + 1].value === '(') return true;
  }
  return false;
}

function testCallTitleContainsToken(scan, tokenIndex) {
  return Boolean(scan && scan.calls.some(call => call.complete
    && tokenIndex >= call.titleStartIndex && tokenIndex <= call.titleEndIndex));
}

function nearestTestCall(scan, tokenIndex) {
  return scan.calls.filter(call => call.complete && tokenIndex >= call.startIndex && tokenIndex <= call.closeIndex)
    .sort((left, right) => (left.closeIndex - left.startIndex) - (right.closeIndex - right.startIndex)
      || right.startIndex - left.startIndex)[0] || null;
}

function testCallForChangedStatement(scan, tokenIndex, range) {
  const enclosingCall = nearestTestCall(scan, tokenIndex);
  if (enclosingCall) return enclosingCall;
  if (!range) return null;

  const endToken = scan.tokens[range.endIndex];
  return scan.calls.filter(call => call.complete && call.startIndex === range.startIndex
    && (call.closeIndex === range.endIndex
      || (endToken && endToken.value === ';' && call.closeIndex === range.endIndex - 1)))
    .sort((left, right) => (left.closeIndex - left.startIndex) - (right.closeIndex - right.startIndex)
      || right.startIndex - left.startIndex)[0] || null;
}

function fileLevelRequirementTags(text, scan) {
  if (typeof text !== 'string' || !scan || !scan.valid || !Array.isArray(scan.comments)) return [];
  const tags = [];

  for (const comment of scan.comments) {
    if (!comment.topLevel) continue;
    const insideTestCall = scan.calls.some(call => {
      if (!call.complete) return false;
      const startLine = scan.tokens[call.startIndex] && scan.tokens[call.startIndex].line;
      const endLine = scan.tokens[call.closeIndex] && scan.tokens[call.closeIndex].line;
      return Number.isInteger(startLine) && Number.isInteger(endLine)
        && comment.line >= startLine && comment.line <= endLine;
    });
    if (insideTestCall) continue;

    const lineStart = text.lastIndexOf('\n', comment.start - 1) + 1;
    const lineEnd = text.indexOf('\n', comment.end);
    const end = lineEnd === -1 ? text.length : lineEnd;
    if (text.slice(lineStart, comment.start).trim() || text.slice(comment.end, end).trim()) continue;

    const content = comment.kind === 'block'
      ? comment.content.split(/\r?\n/).map(line => line.replace(/^\s*\* ?/, '').trim()).filter(Boolean).join(' ')
      : comment.content;
    const match = content.trim().match(/^(REQ-[A-Z][A-Z0-9]{1,9}-\d{3,})$/);
    if (match) tags.push(match[1]);
  }

  return uniqueSorted(tags);
}

function requirementTestCallChanges(beforeScan, afterScan, changeKind) {
  const newCallIndexes = new Set();
  if (!afterScan) return { newCallIndexes, identityUnknown: false };
  if (changeKind === 'added') {
    for (let index = 0; index < afterScan.calls.length; index++) {
      if (afterScan.calls[index].ids.length > 0) newCallIndexes.add(index);
    }
    return { newCallIndexes, identityUnknown: false };
  }

  const beforeCalls = beforeScan ? beforeScan.calls : [];
  const unmatchedBefore = new Set(beforeCalls.map((_, index) => index));
  const unmatchedAfter = new Set(afterScan.calls.map((_, index) => index));
  for (const key of ['identitySignature', 'signature', 'bodySignature']) {
    const available = new Map();
    for (const index of unmatchedBefore) {
      const value = beforeCalls[index][key];
      if (!available.has(value)) available.set(value, []);
      available.get(value).push(index);
    }
    for (const index of unmatchedAfter) {
      const value = afterScan.calls[index][key];
      const matches = available.get(value);
      if (!matches || matches.length === 0) continue;
      unmatchedAfter.delete(index);
      unmatchedBefore.delete(matches.shift());
    }
  }

  let identityUnknown = false;
  const unmatchedAfterReq = [...unmatchedAfter].filter(index => afterScan.calls[index].ids.length > 0);
  const beforeRequirementTestCount = beforeCalls.filter(call => call.ids.length > 0).length;
  const afterRequirementTestCount = afterScan.calls.filter(call => call.ids.length > 0).length;
  if (unmatchedAfterReq.length && unmatchedBefore.size) {
    // A same-file replacement or simultaneous unrelated test edit leaves test
    // identity ambiguous, even when the total number of cited calls increased.
    identityUnknown = true;
  } else if (unmatchedAfterReq.length && afterRequirementTestCount > beforeRequirementTestCount) {
    for (const index of unmatchedAfterReq) newCallIndexes.add(index);
  }
  return { newCallIndexes, identityUnknown };
}

function analyzeTestChange(change, baseSnapshot, candidateSnapshot, beforeText, afterText) {
  const result = {
    assertionChanged: false,
    testWithRequirement: false,
    testAttributionUnknown: false,
    testCitedIds: [],
    newReqCitingTest: false
  };
  const oldPath = change.kind === 'rename' ? change.from : change.path;
  const newPath = change.kind === 'rename' ? change.to : change.path;
  if (![oldPath, newPath].some(path => typeof path === 'string' && TEST_PATH.test(path))
    || change.kind === 'rename' || !change.contentChanged) return result;

  const before = snapshotText(baseSnapshot, oldPath);
  const after = snapshotText(candidateSnapshot, newPath);
  const beforeValue = before.readable ? before.text : undefined;
  const afterValue = after.readable ? after.text : undefined;
  const beforeScan = typeof beforeValue === 'string' ? scanTestSource(beforeValue) : null;
  const afterScan = typeof afterValue === 'string' ? scanTestSource(afterValue) : null;
  const beforeFileTagIds = fileLevelRequirementTags(beforeValue, beforeScan);
  const afterFileTagIds = fileLevelRequirementTags(afterValue, afterScan);
  const hasCitedTest = [beforeScan, afterScan].some(scan => scan && scan.calls.some(call => call.ids.length > 0));
  const hasRequirementSignal = hasCitedTest || beforeFileTagIds.length > 0 || afterFileTagIds.length > 0;
  result.testWithRequirement = hasRequirementSignal;
  const testCallChanges = requirementTestCallChanges(beforeScan, afterScan, change.kind);
  result.newReqCitingTest = hasRequirementSignal
    && (testCallChanges.newCallIndexes.size > 0 || (change.kind === 'added' && afterFileTagIds.length === 1));

  if (!before.readable || !after.readable || (beforeScan && !beforeScan.valid) || (afterScan && !afterScan.valid)) {
    result.assertionChanged = 'unknown';
    result.testAttributionUnknown = true;
    return result;
  }

  let delta;
  if (change.kind === 'added') delta = { removed: [], added: afterScan ? afterScan.tokens : [] };
  else if (change.kind === 'deleted') delta = { removed: beforeScan ? beforeScan.tokens : [], added: [] };
  else delta = changedTokens(beforeScan.tokens, afterScan.tokens);
  if (delta === null) {
    result.assertionChanged = 'unknown';
    result.testAttributionUnknown = true;
    return result;
  }

  result.testAttributionUnknown = testCallChanges.identityUnknown;
  const citedIds = new Set();
  let assertionUnknown = false;
  for (const [scan, changed, fileTagIds] of [
    [beforeScan, delta.removed, beforeFileTagIds],
    [afterScan, delta.added, afterFileTagIds]
  ]) {
    if (!scan || !changed.length) continue;
    for (const token of changed) {
      const range = statementRangeForToken(scan, token.index);
      if (!range) {
        assertionUnknown = true;
        result.testAttributionUnknown = true;
        continue;
      }
      const assertionCallChanged = assertionCallContainsToken(scan, token.index);
      const unsupportedAssertionCallChanged = unsupportedAssertionCallContainsToken(scan, token.index, range);
      const computedAssertionCallChanged = computedAssertionCallContainsToken(scan, token.index, range);
      const assertionStatement = statementHasAssertion(scan.tokens, range);
      const assertionChangeSignal = assertionCallChanged || unsupportedAssertionCallChanged || computedAssertionCallChanged;
      if (assertionCallChanged) result.assertionChanged = true;
      else if (unsupportedAssertionCallChanged || computedAssertionCallChanged) assertionUnknown = true;
      else if (!testCallTitleContainsToken(scan, token.index)
        && ['string', 'template', 'regex'].includes(token.type)) assertionUnknown = true;

      const call = testCallForChangedStatement(scan, token.index, range);
      if (call) {
        const newTestSignal = scan === afterScan
          && testCallChanges.newCallIndexes.has(scan.calls.indexOf(call));
        if (call.ids.length && (assertionChangeSignal || newTestSignal)) {
          for (const id of call.ids) citedIds.add(id);
        } else if (assertionChangeSignal || newTestSignal) {
          result.testAttributionUnknown = true;
        }
      } else if (fileTagIds.length === 1 && assertionStatement && assertionChangeSignal) {
        // Preserve the established single-REQ file-tag convention used by older
        // unwrapped assertions; never borrow a different test call's title.
        citedIds.add(fileTagIds[0]);
      } else if (assertionChangeSignal) {
        result.testAttributionUnknown = true;
      }
    }
  }

  result.assertionChanged = result.assertionChanged === true ? true : assertionUnknown ? 'unknown' : false;
  result.testCitedIds = [...citedIds].sort(compareText);
  if (result.testCitedIds.length) result.testWithRequirement = true;
  return result;
}

function analyzeRequirementTestChanges(changes, baseSnapshot, candidateSnapshot) {
  let assertionChanged = false;
  let assertionUnknown = false;
  let newReqCitingTest = false;
  let scopeUnknown = false;
  for (const snapshot of [baseSnapshot, candidateSnapshot]) {
    const files = snapshot && snapshot.files && typeof snapshot.files === 'object' ? snapshot.files : {};
    if (Object.keys(files).some(path => TEST_PATH.test(normalizePath(path)) && typeof files[path] !== 'string')) {
      assertionUnknown = true;
      scopeUnknown = true;
    }
  }
  const analyzed = changes.map(change => {
    const oldPath = change.kind === 'rename' ? change.from : change.path;
    const newPath = change.kind === 'rename' ? change.to : change.path;
    const beforeText = textAt(snapshotFiles(baseSnapshot), oldPath);
    const afterText = textAt(snapshotFiles(candidateSnapshot), newPath);
    const test = analyzeTestChange(change, baseSnapshot, candidateSnapshot, beforeText, afterText);
    if (test.assertionChanged === true) assertionChanged = true;
    else if (test.assertionChanged === 'unknown') assertionUnknown = true;
    newReqCitingTest = newReqCitingTest || test.newReqCitingTest;
    scopeUnknown = scopeUnknown || test.testAttributionUnknown;
    return { ...change, ...test };
  });
  return {
    changes: analyzed,
    assertionChanged: assertionChanged ? true : assertionUnknown ? 'unknown' : false,
    newReqCitingTest,
    scopeUnknown
  };
}

function textAt(files, path) {
  return path && Object.prototype.hasOwnProperty.call(files, path) ? files[path] : undefined;
}

function roleAt(path, text, config) {
  const entry = governedEntry(path, config);
  if (entry && typeof entry.role === 'string') return entry.role;
  if (text !== undefined) {
    const parsed = lifecycle.parseFrontmatter(text);
    if (parsed.data && typeof parsed.data.role === 'string') return parsed.data.role;
  }
  return null;
}

function isGoverned(path, text, config) {
  return Boolean(governedEntry(path, config)) || matchesAny(path, config && config.legacy)
    || Boolean(roleAt(path, text, config));
}

function extractSection(text, wantedTitle) {
  const lines = String(text || '').replace(/\r\n?/g, '\n').split('\n');
  const headings = [];
  let fence = null;
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index];
    if (fence) {
      const close = line.match(/^[ \t]{0,3}(`{3,}|~{3,})[ \t]*$/);
      if (close && close[1][0] === fence.character && close[1].length >= fence.length) fence = null;
      continue;
    }
    const open = line.match(/^[ \t]{0,3}(`{3,}|~{3,})(.*)$/);
    if (open) {
      fence = { character: open[1][0], length: open[1].length };
      continue;
    }
    const match = line.match(/^(#{1,6})\s+(.+?)\s*#*\s*$/);
    if (match) headings.push({ index, level: match[1].length, title: match[2].trim() });
  }
  const found = headings.filter(item => item.title.toLowerCase() === wantedTitle.toLowerCase());
  if (found.length > 1) return { state: 'unknown', text: '' };
  if (!found.length) return { state: 'absent', text: '' };
  const heading = found[0];
  const next = headings.find(item => item.index > heading.index && item.level <= heading.level);
  const end = next ? next.index : lines.length;
  return { state: 'present', text: lines.slice(heading.index + 1, end).join('\n').trim() };
}

function requirementProjection(item) {
  return {
    id: item.id,
    title: item.title,
    block: item.block,
    aliases: Array.isArray(item.aliases) ? [...item.aliases] : [],
    replaces: Array.isArray(item.replaces) ? [...item.replaces] : [],
    validClause: item.validClause === true
  };
}

function extractRequirementBlocks(text) {
  if (text === undefined) return [];
  const parsed = lifecycle.parseFrontmatter(text);
  if (parsed.error) return [];
  return lifecycle.parseRequirementBlocks({ body: parsed.body }).map(requirementProjection);
}

function requirementDeclarations(files, config) {
  const declarations = [];
  for (const path of Object.keys(files).sort(compareText)) {
    const text = files[path];
    if (roleAt(path, text, config) !== 'prd') continue;
    const parsed = lifecycle.parseFrontmatter(text);
    if (parsed.error) continue;
    for (const item of lifecycle.parseRequirementBlocks({ body: parsed.body })) {
      const projection = requirementProjection(item);
      declarations.push({ ...projection, file: path, text: JSON.stringify(projection) });
    }
  }
  return declarations;
}

function compareRequirementBlocks(beforeReqs, afterReqs) {
  const byId = requirements => {
    const result = new Map();
    for (const item of requirements) {
      if (!result.has(item.id)) result.set(item.id, []);
      result.get(item.id).push(item);
    }
    return result;
  };
  const beforeById = byId(beforeReqs);
  const afterById = byId(afterReqs);
  const ids = uniqueSorted([...beforeById.keys(), ...afterById.keys()]);
  let changed = false;
  let unknown = false;
  for (const id of ids) {
    const before = beforeById.get(id) || [];
    const after = afterById.get(id) || [];
    if (JSON.stringify(before) === JSON.stringify(after)) continue;
    if ([...before, ...after].some(item => item.validClause !== true)) unknown = true;
    else changed = true;
  }
  return changed ? 'changed' : unknown ? 'unknown' : 'same';
}

function changedRequirementFacts(baseFiles, candidateFiles, config, baseLifecycle, candidateLifecycle, candidateRevisionAnalysis) {
  const beforeById = new Map();
  for (const item of requirementDeclarations(baseFiles, config)) {
    if (!beforeById.has(item.id)) beforeById.set(item.id, []);
    beforeById.get(item.id).push(item);
  }
  const changed = requirementDeclarations(candidateFiles, config).filter(item => {
    const priorItems = beforeById.get(item.id) || [];
    const prior = priorItems.find(candidate => candidate.file === item.file) || priorItems[0];
    return !prior || prior.text !== item.text;
  });
  const baseDocsByPath = new Map(baseLifecycle.docs.map(doc => [doc.path, doc]));
  const candidateDocsByPath = new Map(candidateLifecycle.docs.map(doc => [doc.path, doc]));
  const baseRevisionIds = new Set(baseLifecycle.docs.map(revisionIdentity).filter(Boolean));
  const revisionGraph = candidateRevisionAnalysis && candidateRevisionAnalysis._graph
    && candidateRevisionAnalysis._graph.parentByDoc instanceof Map ? candidateRevisionAnalysis._graph : null;
  const parentByDoc = revisionGraph ? revisionGraph.parentByDoc : new Map();
  const currentDocs = revisionGraph && revisionGraph.currentById instanceof Map
    ? new Set(revisionGraph.currentById.values()) : new Set();
  const eligibleDocs = candidateRevisionAnalysis._retirementEligibleSources instanceof Set
    ? candidateRevisionAnalysis._retirementEligibleSources : new Set();
  const reqUpdates = [];
  const reqMutationNotRevision = [];

  const chainRootedInBaseRevision = doc => {
    const visited = new Set();
    for (let cursor = doc; cursor && !visited.has(cursor); cursor = parentByDoc.get(cursor)) {
      visited.add(cursor);
      const identity = revisionIdentity(cursor);
      if (identity && baseRevisionIds.has(identity)) return true;
    }
    return false;
  };

  for (const { id, file } of changed) {
    const candidateDoc = candidateDocsByPath.get(file);
    const revisionId = revisionIdentity(candidateDoc);
    const validNewEffectiveRevision = Boolean(candidateDoc && revisionId
      && currentDocs.has(candidateDoc) && eligibleDocs.has(candidateDoc) && !baseRevisionIds.has(revisionId)
      && (!beforeById.has(id) || chainRootedInBaseRevision(candidateDoc)));
    if (validNewEffectiveRevision) {
      reqUpdates.push({ id, file });
      continue;
    }

    if (!beforeById.has(id)) continue;

    const baseDoc = baseDocsByPath.get(file);
    reqMutationNotRevision.push({
      id,
      file,
      code: 'req-mutation-not-revision',
      ...(revisionId && candidateDoc && baseDoc && revisionId === revisionIdentity(baseDoc) ? {} : { reason: 'not-a-base-rooted-successor' })
    });
  }

  const order = (left, right) => compareText(left.id, right.id) || compareText(left.file, right.file);
  reqUpdates.sort(order);
  reqMutationNotRevision.sort(order);
  return { reqUpdates, reqMutationNotRevision };
}

function revisionIdentity(doc) {
  const data = doc && doc.frontmatter;
  if (!data || typeof data.id !== 'string' || !Number.isInteger(data.revision)) return null;
  return `${data.id}\u0000${data.revision}`;
}

function lifecycleAnalysisAgainstBase(baseLifecycle, candidateLifecycle, config) {
  return lifecycle.analyzeDocs(candidateLifecycle.docs, config, {
    all: true,
    baseInventory: baseLifecycle.docs.map(doc => ({
      path: doc.path,
      bytes: doc.storedBytes,
      legacy: doc.legacy
    })),
    baseConfigSources: [config]
  });
}

function candidateRequirementResolution(id, candidateDocs, baseDeclarations, candidateAnalysis) {
  const diagnostics = candidateAnalysis && Array.isArray(candidateAnalysis.diagnostics)
    ? candidateAnalysis.diagnostics : [];
  const graph = candidateAnalysis && candidateAnalysis._graph;
  const graphCurrentDocs = graph && graph.currentById instanceof Map
    ? new Set(graph.currentById.values()) : new Set();
  const errorPaths = new Set(diagnostics.filter(item => item && item.severity === 'error'
    && typeof item.path === 'string').map(item => normalizePath(item.path)));
  const hasRelevantError = baseDeclarations.some(item => item && item.id === id
    && errorPaths.has(normalizePath(item.file)));
  if (hasRelevantError) return { file: null, resolution: 'analysis-error' };

  const resolved = lifecycle.resolveRef(candidateDocs, id, { graph });
  if (resolved && resolved.doc && resolved.requirement) {
    const requirementId = resolved.requirement.id;
    const duplicateInCurrentDoc = diagnostics.some(item => item && item.severity === 'error'
      && item.code === 'duplicate-req' && item.id === requirementId
      && normalizePath(item.path || '') === normalizePath(resolved.doc.path));
    if (duplicateInCurrentDoc) return { file: null, resolution: 'ambiguous' };

    const effectivePrefix = candidateAnalysis && candidateAnalysis._retirementEligibleSources;
    if (!graphCurrentDocs.has(resolved.doc) || !(effectivePrefix instanceof Set) || !effectivePrefix.has(resolved.doc)) {
      return { file: null, resolution: 'analysis-error' };
    }
    return { file: resolved.doc.path, resolution: 'resolved' };
  }

  const candidates = resolved && Array.isArray(resolved.candidates) ? resolved.candidates : [];
  const currentLogicalIds = new Set(candidates.filter(doc => graphCurrentDocs.has(doc))
    .map(doc => graph.logicalIdByDoc.get(doc)).filter(logicalId => typeof logicalId === 'string'));
  if (currentLogicalIds.size > 1) return { file: null, resolution: 'ambiguous' };
  return { file: null, resolution: 'missing' };
}

function citedRequirementFacts(changes, baseFiles, candidateDocs, config, candidateAnalysis, reqMutationNotRevision = []) {
  const citedIds = new Set();
  for (const change of changes) {
    for (const id of change.testCitedIds || []) citedIds.add(id);
  }

  const mutatedIds = new Set((Array.isArray(reqMutationNotRevision) ? reqMutationNotRevision : [])
    .map(item => item && item.id).filter(id => typeof id === 'string'));
  const before = requirementDeclarations(baseFiles, config);
  const result = [];
  for (const id of [...citedIds].sort(compareText)) {
    const resolution = mutatedIds.has(id)
      ? { file: null, resolution: 'mutated' }
      : candidateRequirementResolution(id, candidateDocs, before, candidateAnalysis);
    result.push({ id, ...resolution });
  }
  return result;
}

function derivedEntryAffected(change, item) {
  if (!item || typeof item.path !== 'string') return false;
  const paths = changePaths(change);
  const outputChanged = change.contentChanged && paths.some(path => globToRegExp(item.path).test(path));
  const sources = [item.source, ...(Array.isArray(item.sources) ? item.sources : [])]
    .filter(source => typeof source === 'string');
  const dependencyChanged = (change.contentChanged || change.kind === 'rename')
    && paths.some(path => sources.some(source => globToRegExp(source).test(path)));
  return outputChanged || dependencyChanged;
}

function derivedOutputPaths(changes, config) {
  const entries = Array.isArray(config && config.derived) ? config.derived : [];
  return uniqueSorted(entries.filter(item => item && typeof item.path === 'string'
    && changes.some(change => derivedEntryAffected(change, item))).map(item => item.path));
}

function normalizedFields(text) {
  if (text === undefined) return { state: 'absent', values: {} };
  const parsed = lifecycle.parseFrontmatter(text);
  return { state: parsed.error ? 'unknown' : 'present', values: parsed.data || {} };
}

function fieldsChanged(beforeText, afterText) {
  const before = normalizedFields(beforeText);
  const after = normalizedFields(afterText);
  if (before.state === 'unknown' || after.state === 'unknown') return 'unknown';
  return DOCUMENT_NORMATIVE_FIELDS.some(key => {
    const hasBefore = Object.prototype.hasOwnProperty.call(before.values, key);
    const hasAfter = Object.prototype.hasOwnProperty.call(after.values, key);
    return hasBefore !== hasAfter || JSON.stringify(before.values[key]) !== JSON.stringify(after.values[key]);
  }) ? 'changed' : 'same';
}

function normativeState(change, before, after, oldRole, newRole) {
  const role = newRole || oldRole;
  if (role !== 'prd' && role !== 'adr') return 'none';
  const fieldState = fieldsChanged(before, after);
  if (fieldState === 'changed') return 'changed';
  if (fieldState === 'unknown') return 'unknown';

  if (role === 'prd') {
    const beforeReqs = extractRequirementBlocks(before);
    const afterReqs = extractRequirementBlocks(after);
    const reqState = compareRequirementBlocks(beforeReqs, afterReqs);
    if (reqState !== 'same') return reqState;
    const hasIncompleteReqHeading = [before, after].some(text => text !== undefined
      && /^#{1,6}\s+REQ(?:\b|[-\s])/m.test(text)
      && !REQUIREMENT_ID.test(text));
    return hasIncompleteReqHeading ? 'unknown' : 'none';
  }

  const priorDecision = before === undefined ? { state: 'absent', text: '' } : extractSection(before, 'Decision');
  const nextDecision = after === undefined ? { state: 'absent', text: '' } : extractSection(after, 'Decision');
  if (priorDecision.state === 'unknown' || nextDecision.state === 'unknown') return 'unknown';
  if (priorDecision.state === 'present' && nextDecision.state === 'absent') {
    return change.kind === 'deleted' ? 'changed' : 'unknown';
  }
  if (priorDecision.state !== nextDecision.state || priorDecision.text !== nextDecision.text) return 'changed';
  return 'none';
}

function deriveDocFacts({ base, candidate, config, inventory } = {}) {
  const inputKnown = isSnapshotInput(base) && isSnapshotInput(candidate) && isConfigInput(config);
  const effectiveConfig = isConfigInput(config) ? config : {};
  const inventoryComplete = Boolean(inventory && inventory.complete === true);
  const baseFiles = snapshotFiles(base);
  const candidateFiles = snapshotFiles(candidate);
  const baseLifecycle = analyzeSnapshotWithLifecycle(baseFiles, effectiveConfig);
  const candidateLifecycle = analyzeSnapshotWithLifecycle(candidateFiles, effectiveConfig);
  const candidateAnalysis = candidateLifecycle.summary;
  const candidateRevisionAnalysis = lifecycleAnalysisAgainstBase(baseLifecycle, candidateLifecycle, effectiveConfig);
  const changes = findRenames(baseFiles, candidateFiles);
  const contextualChanges = changes.map(change => {
    const oldPath = change.kind === 'rename' ? change.from : change.path;
    const newPath = change.kind === 'rename' ? change.to : change.path;
    const beforeText = textAt(baseFiles, oldPath);
    const afterText = textAt(candidateFiles, newPath);
    const oldRole = roleAt(oldPath, beforeText, effectiveConfig);
    const newRole = roleAt(newPath, afterText, effectiveConfig);
    const oldGoverned = isGoverned(oldPath, beforeText, effectiveConfig);
    const newGoverned = isGoverned(newPath, afterText, effectiveConfig);
    const contentChanged = change.kind !== 'rename' && beforeText !== afterText;
    const paths = changePaths(change);
    return {
      ...change,
      oldPath,
      newPath,
      oldRole,
      newRole,
      oldGoverned,
      newGoverned,
      contentChanged,
      normative: contentChanged ? normativeState(change, beforeText, afterText, oldRole, newRole) : 'none',
      derivedAffected: (effectiveConfig && Array.isArray(effectiveConfig.derived) ? effectiveConfig.derived : [])
        .some(item => derivedEntryAffected({ ...change, contentChanged }, item)),
      testWithRequirement: contentChanged && paths.some(path => TEST_PATH.test(path))
        && REQUIREMENT_ID.test(`${beforeText || ''}\n${afterText || ''}`),
      codeChanged: contentChanged && paths.some(path => CODE_EXTENSION.test(path) && !TEST_PATH.test(path)
        && !isGoverned(path, textAt(baseFiles, path) ?? textAt(candidateFiles, path), effectiveConfig))
    };
  });

  const governedTouched = contextualChanges.some(change => change.oldGoverned || change.newGoverned);
  const newGovernedFiles = contextualChanges.filter(change => change.kind === 'added' && change.newGoverned);
  const normativeChanged = contextualChanges.some(change => change.normative === 'changed');
  const normativeUnknown = !normativeChanged && contextualChanges.some(change => change.normative === 'unknown');
  const referenceContentChanged = contextualChanges.some(change => change.contentChanged
    && [change.oldRole, change.newRole].includes('reference')
    && (change.oldGoverned || change.newGoverned));
  const requirementTestAnalysis = analyzeRequirementTestChanges(contextualChanges, base, candidate);
  const testChanges = requirementTestAnalysis.changes;
  const assertionChanged = requirementTestAnalysis.assertionChanged;
  const newReqCitingTest = requirementTestAnalysis.newReqCitingTest;
  const requirementSyncTrigger = newReqCitingTest ? 'new-test'
    : assertionChanged === true ? 'assertion-change' : null;
  const requirementSyncCandidate = requirementSyncTrigger !== null;
  const codeChanged = contextualChanges.some(change => change.codeChanged);
  const derivedAffected = contextualChanges.some(change => change.derivedAffected);
  const { reqUpdates, reqMutationNotRevision } = changedRequirementFacts(
    baseFiles, candidateFiles, effectiveConfig, baseLifecycle, candidateLifecycle, candidateRevisionAnalysis
  );
  const citedReqs = citedRequirementFacts(testChanges, baseFiles, candidateLifecycle.docs,
    effectiveConfig, candidateLifecycle.analysis, reqMutationNotRevision);
  const derivedPaths = derivedOutputPaths(contextualChanges, effectiveConfig);
  const baseAnalysis = baseLifecycle.summary;
  const inventoryEnvelope = copyInventoryEnvelope(inventory);

  const facts = {
    schemaVersion: 1,
    inputKnown,
    changedPaths: {
      added: contextualChanges.filter(change => change.kind === 'added').map(change => change.path).sort(compareText),
      modified: contextualChanges.filter(change => change.kind === 'modified').map(change => change.path).sort(compareText),
      deleted: contextualChanges.filter(change => change.kind === 'deleted').map(change => change.path).sort(compareText),
      renamed: contextualChanges.filter(change => change.kind === 'rename')
        .map(change => ({ from: change.from, to: change.to }))
        .sort((left, right) => compareText(left.from, right.from) || compareText(left.to, right.to))
    },
    reqCitingTests: uniqueSorted(testChanges.filter(change => change.testWithRequirement || change.testAttributionUnknown)
      .map(change => candidateFiles[change.newPath] !== undefined ? change.newPath : change.oldPath)),
    assertionChanged,
    requirementSyncTrigger,
    requirementScopeUnknown: requirementTestAnalysis.scopeUnknown,
    inventoryComplete,
    ...(inventoryEnvelope === undefined ? {} : { inventory: inventoryEnvelope }),
    reqUpdates,
    reqMutationNotRevision,
    citedReqs,
    changes: testChanges.map(change => ({
      kind: change.kind,
      ...(change.path ? { path: change.path } : {}),
      ...(change.from ? { from: change.from } : {}),
      ...(change.to ? { to: change.to } : {}),
      oldRole: change.oldRole,
      newRole: change.newRole,
      oldGoverned: change.oldGoverned,
      newGoverned: change.newGoverned,
      contentChanged: change.contentChanged,
      normative: change.normative,
      derivedAffected: change.derivedAffected,
      testWithRequirement: change.testWithRequirement,
      testAttributionUnknown: change.testAttributionUnknown,
      codeChanged: change.codeChanged
    })),
    governedTouched,
    governedPaths: uniqueSorted(contextualChanges.filter(change => change.oldGoverned || change.newGoverned)
      .flatMap(changePaths)),
    newGovernedPaths: newGovernedFiles.map(change => change.newPath).sort(compareText),
    derivedAffected,
    derivedPaths,
    normativeChanged,
    normativeUnknown,
    normativePaths: uniqueSorted(contextualChanges.filter(change => change.normative === 'changed' || change.normative === 'unknown')
      .flatMap(changePaths)),
    referenceContentChanged,
    referencePaths: uniqueSorted(contextualChanges.filter(change => change.contentChanged
      && [change.oldRole, change.newRole].includes('reference')
      && (change.oldGoverned || change.newGoverned)).flatMap(changePaths)),
    codeChanged,
    codePaths: uniqueSorted(contextualChanges.filter(change => change.codeChanged).flatMap(changePaths)),
    requirementSyncCandidate,
    documentAnalysis: { base: baseAnalysis, candidate: candidateAnalysis }
  };
  const provenance = {
    source: 'base/candidate file snapshots',
    changes: contextualChanges.map(change => change.kind === 'rename'
      ? { kind: 'rename', from: change.from, to: change.to }
      : { kind: change.kind, path: change.path })
  };
  return { facts, provenance };
}

function deriveDocObligations(facts) {
  const validFacts = Boolean(facts && facts.schemaVersion === 1 && facts.inputKnown === true);
  const applicable = new Set();
  const unknown = new Set();
  const strengths = new Map();
  if (!validFacts) {
    for (const { capability } of CATALOG) unknown.add(capability);
  } else {
    if (facts.governedTouched) {
      applicable.add('doc-lint');
      applicable.add('link-check');
    }
    if (facts.newGovernedPaths.length) {
      applicable.add('update-over-create');
      applicable.add('outline-confirmation');
      const newRoles = facts.changes.filter(change => change.kind === 'added' && facts.newGovernedPaths.includes(change.path))
        .map(change => change.newRole);
      if (newRoles.some(role => role === 'prd' || role === 'adr')) strengths.set('outline-confirmation', 'MUST');
      else if (newRoles.some(role => !role || !['reference', 'ticket', 'log', 'report'].includes(role))) {
        unknown.add('outline-confirmation');
        strengths.set('outline-confirmation', 'MUST');
      }
    }
    if (facts.derivedAffected) applicable.add('derived-regenerate');
    if (facts.normativeChanged) {
      applicable.add('quality-review');
      applicable.add('conflict-check');
    } else if (facts.normativeUnknown) {
      unknown.add('quality-review');
      unknown.add('conflict-check');
    }
    if (facts.referenceContentChanged) applicable.add('prose-reminder');
    if (facts.requirementScopeUnknown) unknown.add('requirement-sync');
    else if (facts.requirementSyncCandidate) applicable.add('requirement-sync');
    else if (facts.assertionChanged === 'unknown' || facts.codeChanged) unknown.add('requirement-sync');
  }

  const scopePaths = {
    'doc-lint': validFacts ? facts.governedPaths || [] : [],
    'link-check': validFacts ? facts.governedPaths || [] : [],
    'update-over-create': validFacts ? facts.newGovernedPaths || [] : [],
    'outline-confirmation': validFacts ? facts.newGovernedPaths || [] : [],
    'derived-regenerate': validFacts ? facts.derivedPaths || [] : [],
    'quality-review': validFacts ? facts.normativePaths || [] : [],
    'conflict-check': validFacts ? facts.normativePaths || [] : [],
    'prose-reminder': validFacts ? facts.referencePaths || [] : [],
    'requirement-sync': validFacts ? uniqueSorted([...(facts.codePaths || []), ...(facts.reqCitingTests || []),
      ...(facts.citedReqs || []).map(item => item && item.file)]) : []
  };
  const inventoryEnvelope = validFacts ? copyInventoryEnvelope(facts.inventory) : undefined;
  const requirementFacts = {
    citedReqs: validFacts && Array.isArray(facts.citedReqs) ? facts.citedReqs : [],
    reqUpdates: validFacts && Array.isArray(facts.reqUpdates) ? facts.reqUpdates : [],
    reqMutationNotRevision: validFacts && Array.isArray(facts.reqMutationNotRevision)
      ? facts.reqMutationNotRevision : [],
    assertionChanged: validFacts && (typeof facts.assertionChanged === 'boolean' || facts.assertionChanged === 'unknown')
      ? facts.assertionChanged : 'unknown',
    requirementSyncTrigger: validFacts && ['new-test', 'assertion-change', null].includes(facts.requirementSyncTrigger)
      ? facts.requirementSyncTrigger : null,
    requirementScopeUnknown: Boolean(validFacts && facts.requirementScopeUnknown === true),
    inventoryComplete: Boolean(validFacts && facts.inventoryComplete === true),
    ...(inventoryEnvelope === undefined ? {} : { inventory: inventoryEnvelope })
  };
  return CATALOG.map(item => ({
    id: `doc-change:${item.capability}`,
    capability: item.capability,
    strength: strengths.get(item.capability) || item.strength,
    applicability: applicable.has(item.capability) ? 'applicable' : unknown.has(item.capability) ? 'unknown' : 'N/A',
    scope: {
      paths: uniqueSorted(scopePaths[item.capability] || []),
      ...(item.capability === 'requirement-sync' && requirementFacts.requirementScopeUnknown
        ? { requirementIds: 'unknown' } : {})
    },
    acceptance: item.acceptance,
    ...(item.capability === 'requirement-sync' ? requirementFacts : {})
  }));
}

module.exports = { deriveDocFacts, deriveDocObligations };
