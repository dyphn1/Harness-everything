#!/usr/bin/env node
'use strict';

// Editorial document check: lifecycle lint (doc-lifecycle.js, run as a
// subprocess) plus local Markdown link targets in changed governed files.
// Prints one JSON result. Exit 0 = both pass, 1 = defect, 2 = usage/config error.
const fs = require('fs');
const path = require('path');
const { execFileSync, spawnSync } = require('child_process');
const { collectDocs } = require('./doc-lifecycle');

// Logical command IDs (A3 section 3): stdout that repeats an ID is not trusted as credit by itself.
const CHECK_ID = 'harness.doc-check.check.v1';
const COMPARE_ID = 'harness.doc-check.compare-derived.v1';
const USAGE = 'usage: doc-check.js check --workspace <dir> --config <json-file, relative to --workspace> --changed-path <path> [--changed-path <path> ...] [--base <git-rev>]';
const VALUE_FLAGS = ['--workspace', '--config', '--changed-path', '--base'];
const EXTERNAL = /^(?:https?:|mailto:)/i;
const SCHEME = /^[a-z][a-z0-9+.-]*:/i;

function escaped(text, index) {
  let slashes = 0;
  for (let i = index - 1; i >= 0 && text[i] === '\\'; i--) slashes++;
  return slashes % 2 === 1;
}

// Map each unescaped label opener to its closing bracket in one pass.
function labelCloses(text) {
  const closes = new Array(text.length).fill(-1);
  const opens = [];
  for (let i = 0; i < text.length; i++) {
    if ((text[i] !== '[' && text[i] !== ']') || escaped(text, i)) continue;
    if (text[i] === '[') opens.push(i);
    else if (opens.length) closes[opens.pop()] = i;
  }
  return closes;
}

function parseInlineLink(text, start, closes) {
  const close = closes[start];
  if (close < 0 || text[close + 1] !== '(') return null;

  let i = close + 2;
  while (/\s/.test(text[i] || '') && i < text.length) i++;
  let target = '';
  if (text[i] === '<') {
    const begin = ++i;
    while (i < text.length && (text[i] !== '>' || escaped(text, i))) i++;
    if (i === text.length) return { invalid: true, end: i };
    target = text.slice(begin, i++);
  } else {
    const begin = i;
    let parens = 0;
    while (i < text.length) {
      if (escaped(text, i)) { i++; continue; }
      if (text[i] === '(') parens++;
      else if (text[i] === ')') {
        if (parens === 0) break;
        parens--;
      } else if (/\s/.test(text[i])) break;
      i++;
    }
    if (parens !== 0) return { invalid: true, end: i };
    target = text.slice(begin, i);
  }

  while (/\s/.test(text[i] || '') && i < text.length) i++;
  if (text[i] === '"' || text[i] === "'") {
    const quote = text[i++];
    while (i < text.length && (text[i] !== quote || escaped(text, i))) i++;
    if (i === text.length) return { invalid: true, end: i };
    i++;
    while (/\s/.test(text[i] || '') && i < text.length) i++;
  }
  if (text[i] !== ')') return { invalid: true, end: i };
  return { target: target.replace(/\\([\\`*{}\[\]()#+.!_>~-])/g, '$1'), end: i + 1 };
}

function parseArgs(argv) {
  const [command, ...rest] = argv;
  if (command !== 'check') throw new Error(USAGE);
  const options = { changedPaths: [] };
  for (let index = 0; index < rest.length; index += 2) {
    const flag = rest[index];
    const value = rest[index + 1];
    if (!VALUE_FLAGS.includes(flag) || value === undefined) throw new Error(`${USAGE}\nunknown or incomplete argument: ${flag}`);
    if (value.startsWith('--')) throw new Error(`${USAGE}\n${flag} requires a value, not a flag: ${value}`);
    if (flag === '--changed-path') options.changedPaths.push(value);
    else {
      if (options[flag.slice(2)] !== undefined) throw new Error(`${USAGE}\nrepeated argument: ${flag}`);
      options[flag.slice(2)] = value;
    }
  }
  if (!options.workspace || !options.config) throw new Error(`${USAGE}\n--workspace and --config are required`);
  if (!options.changedPaths.length) throw new Error(`${USAGE}\n--changed-path is required`);
  return options;
}

function runLint(workspace, options) {
  const args = [path.join(__dirname, 'doc-lifecycle.js'), 'lint', '--workspace', workspace, '--config', options.config];
  for (const changed of options.changedPaths) args.push('--changed-path', changed);
  if (options.base !== undefined) args.push('--base', options.base);
  return spawnSync(process.execPath, args, { encoding: 'utf8' });
}

// Scan nested label spans depth-first, then resume after each destination. Matching brackets are precomputed per line,
// and an explicit stack keeps nesting from consuming the JS call stack. A nested link inside a label remains an
// intentional over-check: CommonMark keeps only the inner link, so both targets are checked and neither is silent.
function scanSpan(text, line, targets, unsupported) {
  const closes = labelCloses(text);
  const spans = [{ from: 0, to: text.length }];
  while (spans.length) {
    const span = spans.pop();
    for (let i = span.from; i < span.to; i++) {
      if (text[i] !== '[' || escaped(text, i)) continue;
      const parsed = parseInlineLink(text, i, closes);
      if (!parsed) continue;
      if (parsed.invalid) unsupported.push({ line, syntax: 'inline-link-unparsed' });
      else targets.push({ line, target: parsed.target });
      if (parsed.end < span.to) spans.push({ from: parsed.end, to: span.to });
      if (closes[i] > i + 1) spans.push({ from: i + 1, to: closes[i] });
      break;
    }
  }
}

// Returns link targets outside fenced and inline code, plus link syntax this
// check does not evaluate. Unsupported syntax is reported, never skipped silently.
function scanLinks(lines) {
  const targets = [];
  const unsupported = [];
  let fence = null;
  lines.forEach((raw, index) => {
    const line = index + 1;
    const marker = raw.match(/^\s*(`{3,}|~{3,})/);
    if (fence) {
      if (marker && marker[1][0] === fence[0] && marker[1].length >= fence.length && raw.trim() === marker[1]) fence = null;
      return;
    }
    if (marker) { fence = marker[1]; return; }
    const text = raw.replace(/(`+)(.+?)\1/g, '');
    scanSpan(text, line, targets, unsupported);
    if (/\[[^\]]*\]\[[^\]]*\]/.test(text)) unsupported.push({ line, syntax: 'reference-link' });
    if (/^\s{0,3}\[[^\]]+\]:/.test(text)) unsupported.push({ line, syntax: 'reference-definition' });
  });
  return { targets, unsupported };
}

function unsupportedSyntax(target) {
  if (SCHEME.test(target)) return 'scheme';
  if (target.startsWith('/')) return 'root-relative';
  return 'scheme-less-url';
}

function decodeTarget(value) {
  try { return decodeURI(value); } catch { return value; }
}

function emit(result, exit) {
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  return exit;
}

// A1 §3 line classifier over the body (frontmatter already removed). Returns prose and eligible physical-line counts.
function proseShare(body) {
  let prose = 0;
  let eligible = 0;
  let fence = null;
  for (const line of body.split(/\r?\n/)) {
    if (fence) {
      const close = line.match(/^ {0,3}(`{3,}|~{3,})\s*$/);
      if (close && close[1][0] === fence[0] && close[1].length >= fence.length) fence = null;
      continue;
    }
    const open = line.match(/^ {0,3}(`{3,}|~{3,})/);
    if (open) { fence = open[1]; continue; }
    if (!line.trim() || /^( {4}|\t)/.test(line)) continue;
    eligible++;
    if (!/^ {0,3}(#{1,6}(\s|$)|([-+*]|\d+[.)])\s|\||(-{3,}|\*{3,}|_{3,})\s*$)/.test(line)) prose++;
  }
  return { prose, eligible };
}

const COMPARE_FLAGS = ['--workspace', '--config', '--view', '--candidate', '--generation-status'];
const GENERATION_STATUSES = ['ok', 'failed', 'timeout', 'unavailable', 'unsupported'];
const COMPARE_EXIT = { equal: 0, stale: 1, 'missing-view': 1, 'generator-failed': 1, 'generation-timeout': 2, 'generator-unavailable': 2, 'comparison-unavailable': 2, unsupported: 2, 'usage-error': 2 };

function emitCompare(result) {
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  return COMPARE_EXIT[result.result];
}

function parseCompareArgs(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 2) {
    const flag = argv[index];
    const value = argv[index + 1];
    if (!COMPARE_FLAGS.includes(flag) || value === undefined || value.startsWith('--')) return { error: `unknown or incomplete argument: ${flag}` };
    if (options[flag] !== undefined) return { error: `repeated argument: ${flag}` };
    options[flag] = value;
  }
  return { options };
}

// Escape regex metacharacters, then translate `**`, `*` and `?`. Used only to detect a declared glob.
function globToRegExp(pattern) {
  const body = pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*\*/g, '\u0000').replace(/\*/g, '[^/]*').replace(/\?/g, '[^/]').replace(/\u0000/g, '.*');
  return new RegExp(`^${body}$`);
}

// Same file when both paths stat to one device and inode, so symlinks and hard links are caught.
function sameFile(a, b) {
  const x = fs.statSync(a);
  const y = fs.statSync(b);
  return x.ino > 0 && x.ino === y.ino && x.dev === y.dev;
}

// Open without blocking (O_NONBLOCK keeps a FIFO from waiting for a writer), then require a regular file before reading.
function readRegularFile(file) {
  const fd = fs.openSync(file, fs.constants.O_RDONLY | (fs.constants.O_NONBLOCK || 0));
  try {
    if (!fs.fstatSync(fd).isFile()) throw new Error('not a regular file');
    return fs.readFileSync(fd);
  } finally {
    fs.closeSync(fd);
  }
}

// compare-derived: a pure byte comparison of a caller-captured generator output with a declared view.
// It never spawns the declared generator and never writes; every lane prints one JSON object.
function compareDerived(argv) {
  // Loaded lazily so `check` keeps its load-time dependencies (doc-lifecycle.js only).
  const { validateDocsConfig } = require('./project-docs-resolver');
  const parsed = parseCompareArgs(argv);
  const flags = parsed.options || {};
  const base = { schema: COMPARE_ID, command: COMPARE_ID, view: flags['--view'] ?? null, generationStatus: flags['--generation-status'] ?? null };
  if (parsed.error) return emitCompare({ ...base, result: 'usage-error', reason: parsed.error });
  if (!flags['--workspace'] || !flags['--config'] || !flags['--view'] || !flags['--candidate']) return emitCompare({ ...base, result: 'usage-error', reason: '--workspace, --config, --view and --candidate are required' });
  const status = flags['--generation-status'];
  if (!GENERATION_STATUSES.includes(status)) return emitCompare({ ...base, result: 'comparison-unavailable', reason: '--generation-status is required: ok, failed, timeout, unavailable or unsupported' });
  const view = flags['--view'];
  const workspace = path.resolve(flags['--workspace']);
  const configPath = path.resolve(workspace, flags['--config']);
  let config;
  try { config = JSON.parse(fs.readFileSync(configPath, 'utf8')); } catch { return emitCompare({ ...base, result: 'comparison-unavailable', reason: 'config is missing or not valid JSON' }); }
  const validation = validateDocsConfig(config);
  if (!validation.valid) return emitCompare({ ...base, result: 'comparison-unavailable', reason: `config is invalid: ${validation.diagnostics.map(item => item.code).join(', ')}` });
  if (path.isAbsolute(view) || view.split(/[\\/]/).includes('..')) return emitCompare({ ...base, result: 'unsupported', reason: 'view must be a repo-relative path without traversal' });
  if (/[*?[\]{}]/.test(view)) return emitCompare({ ...base, result: 'unsupported', reason: 'glob view selections are unsupported' });
  const declared = Array.isArray(config.derived) ? config.derived : [];
  const matches = declared.filter(entry => entry.path === view);
  if (matches.length > 1) return emitCompare({ ...base, result: 'comparison-unavailable', reason: 'view is declared more than once (ambiguous selection)' });
  if (matches.length === 0) {
    const viaGlob = declared.some(entry => /[*?[\]{}]/.test(entry.path) && globToRegExp(entry.path).test(view));
    const closest = declared.find(entry => normalizeView(entry.path) === normalizeView(view));
    return emitCompare(viaGlob
      ? { ...base, result: 'unsupported', reason: 'view matches a declared glob; only literal derived paths are supported' }
      : { ...base, result: 'comparison-unavailable', reason: closest ? `view is not a declared derived path; the closest declared path is "${closest.path}"` : 'view is not a declared derived path' });
  }
  const target = path.join(workspace, view);
  if (fs.existsSync(target) && !fs.realpathSync(target).startsWith(fs.realpathSync(workspace) + path.sep)) return emitCompare({ ...base, result: 'unsupported', reason: 'view resolves outside the workspace' });
  if (status === 'failed') return emitCompare({ ...base, result: 'generator-failed', reason: 'generation reported failure; candidate not compared' });
  if (status === 'timeout') return emitCompare({ ...base, result: 'generation-timeout', reason: 'generation timed out; candidate not compared' });
  if (status === 'unavailable') return emitCompare({ ...base, result: 'generator-unavailable', reason: 'generator unavailable; candidate not compared' });
  if (status === 'unsupported') return emitCompare({ ...base, result: 'unsupported', reason: 'generator reported unsupported (write-in-place or glob output); candidate not compared' });
  const candidate = path.resolve(workspace, flags['--candidate']);
  let candidateBytes;
  try { candidateBytes = readRegularFile(candidate); } catch { return emitCompare({ ...base, result: 'comparison-unavailable', reason: 'candidate is missing, not a regular file, or unreadable' }); }
  if (!fs.existsSync(target)) return emitCompare({ ...base, result: 'missing-view', reason: 'declared target file is absent' });
  if (sameFile(candidate, target)) return emitCompare({ ...base, result: 'comparison-unavailable', reason: 'candidate aliases the target' });
  const equal = Buffer.compare(candidateBytes, fs.readFileSync(target)) === 0;
  return emitCompare({ ...base, result: equal ? 'equal' : 'stale', reason: equal ? 'candidate bytes equal the declared target' : 'candidate bytes differ from the declared target; target left unchanged' });
}

const GLOB_CHARS = /[*?[\]{}]/;
const VIEW_REASON = 'derived view not verified: run its authorized generator, then compare-derived';

// Near-miss comparison only (separators, leading ./, trailing /, case); never used to accept a view.
function normalizeView(value) {
  return value.replace(/\\/g, '/').replace(/^\.\//, '').replace(/\/+$/, '').toLowerCase();
}

// Declarations at the base revision, read with argv arrays (no shell). Null when unavailable.
function readBaseDeclarations(workspace, base, configRelative) {
  if (base.startsWith('-')) return null;
  try {
    const text = execFileSync('git', ['show', `${base}:${configRelative}`], { cwd: workspace, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    const parsed = JSON.parse(text);
    return Array.isArray(parsed.derived) ? parsed.derived : [];
  } catch {
    return null;
  }
}

// F3 coverage. Declared views are unverified when a source, a derived output or the config changed. Declaration changes
// against --base are named; globs and self-governed views are named as unsupported. No generator is ever run.
function derivedCoverage(config, { workspace, configRelative, configChanged, affectsViews, base }) {
  const declared = Array.isArray(config.derived) ? config.derived : [];
  const governedPatterns = [...(config.governed || []), ...(config.legacy || [])]
    .map(item => (typeof item === 'string' ? item : item && item.path))
    .filter(item => typeof item === 'string');
  const entries = [];
  for (const view of new Set(declared.map(entry => entry.path))) {
    if (GLOB_CHARS.test(view)) {
      entries.push({ path: view, applicability: 'glob-unsupported', reason: 'glob declarations are unsupported; declare the concrete output path' });
      continue;
    }
    if (affectsViews) entries.push({ path: view, state: 'unverified', applicability: 'conservative-all-governed', reason: VIEW_REASON });
    if (governedPatterns.some(pattern => globToRegExp(pattern).test(view))) entries.push({ path: view, applicability: 'self-governed', reason: 'a derived view must not be governed or indexed by its own generator' });
  }
  if (base === undefined) {
    if (configChanged) entries.push({ reason: 'config changed without --base; removed or renamed derived declarations cannot be detected' });
    return entries;
  }
  const baseDeclared = readBaseDeclarations(workspace, base, configRelative);
  if (baseDeclared === null) {
    entries.push({ reason: `base config unavailable at ${base}; declarations cannot be compared` });
    return entries;
  }
  for (const old of baseDeclared) {
    if (GLOB_CHARS.test(old.path)) {
      entries.push({ path: old.path, applicability: 'glob-unsupported', reason: `glob declaration at ${base}; glob declarations are unsupported` });
      continue;
    }
    const current = declared.find(entry => entry.path === old.path);
    if (!current) entries.push({ path: old.path, state: 'unverified', applicability: 'declaration-removed', reason: `declared at ${base}, absent from the current config; not verified` });
    else if (current.generator !== old.generator) entries.push({ path: old.path, state: 'unverified', applicability: 'declaration-changed', reason: `generator changed since ${base}; not verified` });
  }
  return entries;
}

function check(options) {
  const workspace = path.resolve(options.workspace);
  const configPath = path.resolve(workspace, options.config);
  const lint = runLint(workspace, options);
  const lintExit = lint.status === 0 || lint.status === 1 ? lint.status : 2;
  if (lintExit === 2) {
    return emit({ schema: CHECK_ID, command: CHECK_ID, lint: { exit: 2, error: String(lint.stderr || lint.error || '').trim(), diagnostics: [] }, links: { checked: 0, broken: [], skipped: 'lint-usage-error' }, coverage: { unsupported: [] } }, 2);
  }
  let analysis;
  try { analysis = JSON.parse(lint.stdout); } catch {
    return emit({ schema: CHECK_ID, command: CHECK_ID, lint: { exit: 2, error: 'lint output was not JSON', diagnostics: [] }, links: { checked: 0, broken: [], skipped: 'lint-usage-error' }, coverage: { unsupported: [] } }, 2);
  }
  const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  const docs = collectDocs(workspace, config);
  const governed = new Set(docs.filter(doc => doc.role).map(doc => doc.path));

  const broken = [];
  const unsupported = [];
  if (!Array.isArray(config.domains) || !config.domains.length) {
    unsupported.push({ reason: 'no domains declared; bare <DOMAIN>-NNN references are not checked' });
  }
  let checked = 0;
  for (const value of options.changedPaths) {
    const relative = path.relative(workspace, path.resolve(workspace, value)).split(path.sep).join('/');
    const absolute = path.join(workspace, relative);
    if (!fs.existsSync(absolute)) {
      unsupported.push({ path: relative, reason: 'not on disk' });
      continue;
    }
    let text;
    try { text = fs.readFileSync(absolute, 'utf8'); } catch {
      broken.push({ path: relative, line: 0, target: null, reason: 'unreadable' });
      continue;
    }
    if (!governed.has(relative)) {
      unsupported.push({ path: relative, reason: 'not governed' });
      continue;
    }
    const scan = scanLinks(text.split(/\r?\n/));
    unsupported.push(...scan.unsupported.map(item => ({ path: relative, ...item })));
    for (const { line, target } of scan.targets) {
      if (target.startsWith('#') || EXTERNAL.test(target)) continue;
      if (SCHEME.test(target) || target.startsWith('/') || /^www\./i.test(target)) {
        unsupported.push({ path: relative, line, syntax: unsupportedSyntax(target), target });
        continue;
      }
      checked++;
      const file = decodeTarget(target.split('#')[0].split('?')[0]);
      if (!file || !fs.existsSync(path.resolve(path.dirname(absolute), file))) broken.push({ path: relative, line, target });
    }
  }

  // SHOULD reminders only: they never change the exit code and are never diagnostics.
  const changed = new Set(options.changedPaths.map(value => path.relative(workspace, path.resolve(workspace, value)).split(path.sep).join('/')));
  // F3 applicability (conservative): a governed or legacy source, an unknown or deleted path, a derived output or the config
  // itself marks every declared view unverified. check still never runs a generator.
  const configRelative = path.relative(workspace, configPath).split(path.sep).join('/');
  const declaredViews = [...new Set((Array.isArray(config.derived) ? config.derived : []).map(entry => entry.path))];
  const affectsViews = [...changed].some(item => {
    if (item === configRelative || !fs.existsSync(path.join(workspace, item))) return true;
    if (declaredViews.includes(item)) return true;
    const doc = docs.find(entry => entry.path === item);
    return Boolean(doc && (doc.role || doc.legacy));
  });
  unsupported.push(...derivedCoverage(config, { workspace, configRelative, configChanged: changed.has(configRelative), affectsViews, base: options.base }));

  const reminders = [];
  for (const doc of docs) {
    if (!changed.has(doc.path) || doc.role !== 'reference' || doc.legacy || doc.error) continue;
    const { prose, eligible } = proseShare(doc.body);
    if (2 * prose > eligible) reminders.push({ code: 'prose-share', path: doc.path, strength: 'SHOULD', proseLines: prose, eligibleLines: eligible, share: prose / eligible, threshold: 0.5 });
  }

  // Per-capability reports (A3 section 3). Partial coverage is never reported as a full pass.
  const governedChanged = [...changed].filter(item => governed.has(item));
  const noDomains = !Array.isArray(config.domains) || !config.domains.length;
  const linkSkipped = unsupported.filter(item => item.syntax || (item.path && item.reason && !item.applicability));
  const result = {
    schema: CHECK_ID,
    command: CHECK_ID,
    lint: { exit: lintExit, evidence: analysis.evidence, diagnostics: analysis.diagnostics },
    links: { checked, broken },
    coverage: { unsupported },
    reminders,
    capabilities: {
      'doc-lint': {
        state: lintExit === 1 ? 'fail' : noDomains ? 'partial' : 'pass',
        checkedPaths: governedChanged,
        skipped: unsupported.filter(item => !item.path).map(item => item.reason),
      },
      'link-check': {
        state: broken.length ? 'fail' : linkSkipped.length ? 'partial' : 'pass',
        checkedPaths: governedChanged,
        skipped: linkSkipped,
      },
    }
  };
  return emit(result, lintExit === 1 || broken.length ? 1 : 0);
}

function main(argv = process.argv.slice(2)) {
  if (argv[0] === 'compare-derived') return compareDerived(argv.slice(1));
  let options;
  try { options = parseArgs(argv); } catch (error) {
    return emit({ lint: { exit: 2, error: error.message }, links: { checked: 0, broken: [], skipped: 'lint-usage-error' }, coverage: { unsupported: [] } }, 2);
  }
  return check(options);
}

module.exports = { main, scanLinks };

if (require.main === module) process.exitCode = main();
