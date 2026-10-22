#!/usr/bin/env node
'use strict';

// Editorial document check: lifecycle lint (doc-lifecycle.js, run as a
// subprocess) plus local Markdown link targets in changed governed files.
// Prints one JSON result. Exit 0 = both pass, 1 = defect, 2 = usage/config error.
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { collectDocs } = require('./doc-lifecycle');

const USAGE = 'usage: doc-check.js check --workspace <dir> --config <json-file, relative to --workspace> --changed-path <path> [--changed-path <path> ...] [--base <git-rev>]';
const VALUE_FLAGS = ['--workspace', '--config', '--changed-path', '--base'];
const INLINE_LINK = /!?\[[^\]]*\]\((<[^>]*>|[^)\s]+)(?:\s+(?:"[^"]*"|'[^']*'))?\)/g;
const EXTERNAL = /^(?:https?:|mailto:)/i;
const SCHEME = /^[a-z][a-z0-9+.-]*:/i;

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
    for (const match of text.matchAll(INLINE_LINK)) targets.push({ line, target: match[1].replace(/^<(.*)>$/, '$1') });
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

function check(options) {
  const workspace = path.resolve(options.workspace);
  const configPath = path.resolve(workspace, options.config);
  const lint = runLint(workspace, options);
  const lintExit = lint.status === 0 || lint.status === 1 ? lint.status : 2;
  if (lintExit === 2) {
    return emit({ lint: { exit: 2, error: String(lint.stderr || lint.error || '').trim(), diagnostics: [] }, links: { checked: 0, broken: [], skipped: 'lint-usage-error' }, coverage: { unsupported: [] } }, 2);
  }
  let analysis;
  try { analysis = JSON.parse(lint.stdout); } catch {
    return emit({ lint: { exit: 2, error: 'lint output was not JSON', diagnostics: [] }, links: { checked: 0, broken: [], skipped: 'lint-usage-error' }, coverage: { unsupported: [] } }, 2);
  }
  const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  const governed = new Set(collectDocs(workspace, config).filter(doc => doc.role).map(doc => doc.path));

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

  const result = {
    lint: { exit: lintExit, evidence: analysis.evidence, diagnostics: analysis.diagnostics },
    links: { checked, broken },
    coverage: { unsupported }
  };
  return emit(result, lintExit === 1 || broken.length ? 1 : 0);
}

function main(argv = process.argv.slice(2)) {
  let options;
  try { options = parseArgs(argv); } catch (error) { process.stderr.write(`${error.message}\n`); return 2; }
  return check(options);
}

module.exports = { main, scanLinks };

if (require.main === module) process.exitCode = main();
