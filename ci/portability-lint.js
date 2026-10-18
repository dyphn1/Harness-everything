#!/usr/bin/env node
'use strict';

/**
 * Test-Source Portability Lint
 *
 * The Windows CI matrix has failed on fixture paths that macOS/Linux never
 * reject: a filename containing ':' and '"' (mechanism-2ay, run 39043848220)
 * and a Windows device-namespace path (mechanism-2au, run 38760213406).
 * This lint moves that failure class from "after push" to this local gate.
 *
 * Scanned: every .js file under ci/ (fixture creators, check scripts, tests).
 *
 * Rules, all requiring a whitespace-free single-token literal so prose,
 * regex sources and message templates stay out of the net:
 *   WIN_DEVICE_PATH     the literal begins with the \\.\ or \\?\ device
 *                       namespace prefix
 *   WIN_RESERVED_NAME   the literal, or a path segment of it, is CON PRN
 *                       AUX NUL COM1-9 LPT1-9, with or without an extension
 *   WIN_INVALID_CHAR    a path-like literal contains one of : * ? " < > |
 *                       (clock-like 12:34 fragments are not counted; only
 *                       verified URL/Node-specifier schemes with a value
 *                       after the colon and wildcard-led glob segments are
 *                       exempt, so bad:name.md and bad*name.md are flagged)
 *
 * The exemptions are contextual, and ci/mechanism-37-portability-lint.test.js
 * holds the positive/negative corpus that locks them down.
 *
 * Known limits, kept deliberately narrow over noisy coverage: it does not
 * flag spaced fixture names, trailing dots/spaces, bare single tokens
 * without a path separator or extension (except reserved names), or
 * invalid characters inside prose-like strings. Those still rely on review
 * and the Windows CI matrix. A finding here is a tripwire, not proof of a
 * Windows failure.
 *
 * Remedy: use a portable fixture name, platform-guard the code path, or mark
 * one deliberate case with `portability-lint: allow <reason>` on its line.
 *
 * Usage: node ci/portability-lint.js
 */

const fs = require('fs');
const path = require('path');

const SELF = path.resolve(__filename);
const SCAN_ROOT = path.resolve(__dirname);
const SKIP_DIRS = new Set(['fixtures', 'node_modules', '__pycache__']);
const EXTENSIONS = new Set(['.js', '.cjs', '.mjs']);
const PRAGMA = /portability-lint:\s*allow/;
const RESERVED_NAME = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\..*)?$/i;
const INVALID_CHARS = /[:*?"<>|]/;
const WILDCARD_CHARS = /[*?]/g;
const CLOCK_FRAGMENT = /\d{1,2}:\d{2}(?::\d{2}(?:\.\d+)?)?/g;
const DEVICE_NAMESPACE = /^(\\\\|\\)[.?](\\|$)/;
// A scheme is only exempt with a real authority (`https://...`) or as a
// known Node/tooling/repo-data specifier (`node:assert/strict`,
// `pkg:npm/...`, `HEAD:refs/heads/main`, `legacy:GRAPH-1@docs/x.md`). A bare
// word before the colon (`bad:name.md`) is a filename, not a scheme.
const URL_WITH_AUTHORITY = /^[a-z][a-z0-9+.-]*:\/\//i;
const SPECIFIER_SCHEME = /^(node|pkg|https?|git\+https?|ssh|file|mailto|data|github|fallback-task|HEAD|legacy|human):/i;
const DRIVE_PREFIX = /^[A-Za-z]:/;
// Strings that open like regex sources rather than filenames: a char-class
// or inline-group opener after a leading slash, a leading inline group, or a
// leading backslash escape such as \s or \d.
const REGEX_SOURCE = /^(?:\(\?[:=!]|\/\[|\/\(\?|\\[sSdDwWbB])/;
// Markup tags, <placeholder> roots, desync tails, and `${...}` templates are
// data under test, never fixture names.
const DATAISH_PREFIX = /^[<>{}\[\]$]/;
// A wildcard-led segment (`*.md`, `**`) marks the token as a glob pattern.
const GLOB_SEGMENT = /^[*?]/;
const REGEX_PREFIX_CHARS = '([{,;:=!&|?+-*%<>~^';
const REGEX_KEYWORDS = /(?:^|[^\w$])(return|typeof|case|in|of|new|delete|void|instanceof)\s*$/;

function extractLiterals(source) {
  const literals = [];
  let line = 1;
  let i = 0;
  const n = source.length;
  while (i < n) {
    const ch = source[i];
    if (ch === '\n') {
      line += 1;
      i += 1;
      continue;
    }
    if (ch === '/' && source[i + 1] === '/') {
      const next = source.indexOf('\n', i);
      i = next === -1 ? n : next;
      continue;
    }
    if (ch === '/' && source[i + 1] === '*') {
      let j = i + 2;
      while (j < n && !(source[j] === '*' && source[j + 1] === '/')) {
        if (source[j] === '\n') line += 1;
        j += 1;
      }
      i = j + 2;
      continue;
    }
    if (ch === '/' && regexPosition(source, i)) {
      // Skip regex literals so quotes and brackets inside them never desync
      // the scanner into reading code as a string.
      let j = i + 1;
      let inClass = false;
      while (j < n) {
        const c = source[j];
        if (c === '\n') break;
        if (c === '\\') {
          j += 2;
          continue;
        }
        if (c === '[') inClass = true;
        else if (c === ']') inClass = false;
        else if (c === '/' && !inClass) {
          j += 1;
          break;
        }
        j += 1;
      }
      i = j;
      continue;
    }
    if (ch === "'" || ch === '"' || ch === '`') {
      const quote = ch;
      const startLine = line;
      let value = '';
      let j = i + 1;
      let closed = false;
      while (j < n) {
        const c = source[j];
        if (c === '\n') break;
        if (c === '\\') {
          if (j + 1 >= n) break;
          value += source[j + 1];
          j += 2;
          continue;
        }
        if (c === quote) {
          closed = true;
          break;
        }
        value += c;
        j += 1;
      }
      if (closed) {
        literals.push({ line: startLine, value });
        i = j + 1;
        continue;
      }
      // Unterminated on this line: treat the quote as plain text, rescan.
      i += 1;
      continue;
    }
    i += 1;
  }
  return literals;
}

function regexPosition(source, i) {
  let k = i - 1;
  while (k >= 0 && (source[k] === ' ' || source[k] === '\t')) k -= 1;
  if (k < 0 || source[k] === '\n') return true;
  if (REGEX_PREFIX_CHARS.includes(source[k])) return true;
  return REGEX_KEYWORDS.test(source.slice(Math.max(0, k - 12), k + 1));
}

function looksPathLike(value) {
  const s = value.trim();
  if (!s || s.length > 300) return false;
  if (/[\\/]/.test(s)) return true;
  return /\.[A-Za-z0-9]{1,8}$/.test(s); // bare filename with extension
}

function pathSegments(value) {
  const body = DRIVE_PREFIX.test(value) ? value.slice(2) : value;
  return body.split(/[\\/]+/).filter(Boolean);
}

function analyzeLiteral(literal) {
  const findings = [];
  const value = literal.value.trim();
  if (!value) return findings;
  if (DEVICE_NAMESPACE.test(value)) {
    findings.push({
      rule: 'WIN_DEVICE_PATH',
      detail: `literal begins with the ${value.slice(0, 3)} device-namespace prefix`,
    });
    return findings;
  }
  if (DATAISH_PREFIX.test(value)) return findings;
  if (/\s/.test(value)) return findings; // prose, templates, patch bodies

  const segments = pathSegments(value);
  const glob = segments.some((segment) => GLOB_SEGMENT.test(segment));

  if (RESERVED_NAME.test(value)) {
    findings.push({
      rule: 'WIN_RESERVED_NAME',
      detail: `literal "${value}" is a reserved Windows name`,
    });
  } else if (looksPathLike(value)) {
    for (const segment of segments) {
      if (RESERVED_NAME.test(segment)) {
        findings.push({
          rule: 'WIN_RESERVED_NAME',
          detail: `segment "${segment}" is a reserved Windows name`,
        });
      }
    }
  }

  if (
    looksPathLike(value) &&
    !URL_WITH_AUTHORITY.test(value) &&
    !SPECIFIER_SCHEME.test(value) &&
    !REGEX_SOURCE.test(value)
  ) {
    // The drive-letter colon is portable; everything after it is not.
    const withoutDrive = DRIVE_PREFIX.test(value) ? value.slice(2) : value;
    const withoutClocks = withoutDrive.replace(CLOCK_FRAGMENT, '');
    const scanned = glob ? withoutClocks.replace(WILDCARD_CHARS, '') : withoutClocks;
    const invalid = scanned.match(INVALID_CHARS);
    if (invalid) {
      findings.push({
        rule: 'WIN_INVALID_CHAR',
        detail: `literal "${value}" contains '${invalid[0]}'`,
      });
    }
  }
  return findings;
}

function collectFiles(dir, out) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name) || entry.name.startsWith('.')) continue;
      collectFiles(path.join(dir, entry.name), out);
      continue;
    }
    if (!entry.isFile()) continue;
    if (!EXTENSIONS.has(path.extname(entry.name))) continue;
    const full = path.join(dir, entry.name);
    if (full === SELF) continue;
    out.push(full);
  }
  return out;
}

function main() {
  console.log('=== 🧭 Harness test-source portability lint ===');

  const files = collectFiles(SCAN_ROOT, []);
  let literalCount = 0;
  let findings = 0;

  for (const file of files) {
    const text = fs.readFileSync(file, 'utf8');
    const lines = text.split('\n');
    for (const literal of extractLiterals(text)) {
      literalCount += 1;
      const allowed =
        PRAGMA.test(lines[literal.line - 1] || '') ||
        PRAGMA.test(lines[literal.line - 2] || '');
      if (allowed) continue;
      for (const finding of analyzeLiteral(literal)) {
        findings += 1;
        const shown = literal.value.length > 80 ? `${literal.value.slice(0, 77)}...` : literal.value;
        const rel = path.relative(path.resolve(SCAN_ROOT, '..'), file);
        console.error(`❌ ${rel}:${literal.line} [${finding.rule}] ${finding.detail}`);
        console.error(`   literal: ${shown}`);
        console.error('   fix: portable fixture name, platform guard, or `portability-lint: allow <reason>`');
      }
    }
  }

  console.log(`Scanned ${files.length} file(s), ${literalCount} single-line literal(s).`);
  if (findings > 0) {
    console.error(`❌ portability lint found ${findings} finding(s) in the Windows-hostile class.`);
    process.exit(1);
  }
  console.log('✅ no Windows-hostile paths in scanned test sources.');
}

if (require.main === module) {
  main();
}

module.exports = { extractLiterals, analyzeLiteral, looksPathLike, pathSegments };
