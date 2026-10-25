#!/usr/bin/env node
'use strict';

// F1 oc2 lock suite: the editor-lane doc-check contract, locked with one mechanism suite.
//
// Every case runs against both legs: the canonical harness-everything/scripts/doc-check.js and the packaged
// plugins/harness-everything/skills/harness-everything/scripts/doc-check.js. The script is spawned as a subprocess with
// cwd set to os.tmpdir(), so it must work from any cwd. Expected values come from
// harness-everything/references/doc-check.md and the F1 packet table, never from a run of the script.
// Exit 1 means at least one assertion FAILED.

const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const MODULE = 'doc-check.js';
const LINT = 'doc-lifecycle.js';
const CONFIG = '.agents/harness-everything/project-docs.json';
const LEGS = [
  { name: 'source', dir: path.join(ROOT, 'harness-everything', 'scripts') },
  { name: 'packaged', dir: path.join(ROOT, 'plugins', 'harness-everything', 'skills', 'harness-everything', 'scripts') }
];

let passed = 0;
let failed = 0;
let skipped = 0;
const failures = [];
const tmpDirs = [];

function record(status, id, leg, detail) {
  const where = leg ? ` [${leg}]` : '';
  if (status === 'PASS') passed += 1;
  else if (status === 'SKIP') skipped += 1;
  else { failed += 1; failures.push(`${id}${where}`); }
  console.log(`  ${status} ${id}${where}${detail ? ` — ${detail}` : ''}`);
}

function truncate(text) {
  return text.length > 300 ? `${text.slice(0, 300)}…` : text;
}

function same(actual, expected, label) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) throw new Error(`${label}: got ${truncate(String(a))} expected ${truncate(String(e))}`);
}

// ---- Fixture helpers -----------------------------------------------------------------------------------------------
function removeTree(dir) {
  fs.rmSync(dir, { recursive: true, force: true });
}

function writeDoc(ws, relative, text) {
  const absolute = path.join(ws, relative);
  fs.mkdirSync(path.dirname(absolute), { recursive: true });
  fs.writeFileSync(absolute, text);
}

// Fresh workspace per case, in a tmp dir whose name contains a space (intended). The config is written here unless the
// case needs a missing config.
function makeWorkspace(config) {
  const ws = fs.mkdtempSync(path.join(os.tmpdir(), 'f1 doc check '));
  tmpDirs.push(ws);
  if (config) writeDoc(ws, CONFIG, `${JSON.stringify(config, null, 2)}\n`);
  return ws;
}

const REFERENCE = config => ({ governed: [{ path: 'docs/a.md', role: 'reference' }], ...config });

function refDoc(body) {
  return `---\nrole: reference\nstatus: active\n---\n\n${body}\n`;
}

function runCheck(scriptDir, options) {
  return spawnSync(process.execPath, [
    path.join(scriptDir, MODULE), 'check',
    '--workspace', options.workspace,
    '--config', options.config,
    ...(options.args || [])
  ], { encoding: 'utf8', cwd: os.tmpdir(), ...(options.timeoutMs ? { timeout: options.timeoutMs } : {}) });
}

function runInventory(scriptDir, options) {
  return spawnSync(process.execPath, [
    path.join(scriptDir, LINT), 'inventory',
    '--workspace', options.workspace,
    '--manifest', options.manifest,
    '--base', options.base,
    ...(options.proposedUntracked || []).flatMap(value => ['--proposed-untracked', value])
  ], { encoding: 'utf8', cwd: os.tmpdir(), ...(options.timeoutMs ? { timeout: options.timeoutMs } : {}) });
}

function gitAt(root, args) {
  const result = spawnSync('git', ['-C', root, ...args], { encoding: 'utf8', env: { ...process.env, GIT_CONFIG_NOSYSTEM: '1' } });
  if (result.status !== 0) throw new Error(`git ${args.join(' ')} failed: ${result.stderr || result.stdout}`);
  return String(result.stdout || '').trim();
}

function jsonOut(result) {
  try { return JSON.parse(result.stdout); } catch {
    throw new Error(`stdout is not JSON (exit ${result.status}): ${truncate(result.stdout || result.stderr)}`);
  }
}

function assertUsageJson(result) {
  const out = jsonOut(result);
  same(Object.keys(out).sort(), ['coverage', 'links', 'lint'], 'top-level keys');
  same(Object.keys(out.lint).sort(), ['error', 'exit'], 'lint keys');
  same(out.lint.exit, 2, 'lint.exit');
  if (typeof out.lint.error !== 'string' || !out.lint.error) throw new Error('lint.error is missing');
  same(out.links, { checked: 0, broken: [], skipped: 'lint-usage-error' }, 'links');
  same(out.coverage, { unsupported: [] }, 'coverage');
  same(result.stdout, `${JSON.stringify(out, null, 2)}\n`, 'single JSON object on stdout');
  same(result.stderr, '', 'stderr');
}

function noDiagnosticOfCode(out, code, extraLabel) {
  const hits = (out.lint.diagnostics || []).filter(item => item.code === code);
  if (hits.length) throw new Error(`${extraLabel}: unexpected ${code} diagnostic(s): ${truncate(JSON.stringify(hits))}`);
}

function assertPerLeg(id, fn) {
  for (const leg of LEGS) {
    if (!fs.existsSync(path.join(leg.dir, MODULE))) {
      record('FAIL', id, leg.name, `module-missing: ${path.relative(ROOT, path.join(leg.dir, MODULE))}`);
      continue;
    }
    try { fn(leg); record('PASS', id, leg.name); } catch (error) {
      record('FAIL', id, leg.name, error.message.split('\n')[0]);
    }
  }
}

// ---- Cases 1–10, 12–15 ---------------------------------------------------------------------------------------------

// Case 1: clean doc, local link resolves.
assertPerLeg('case-1:clean-link-resolves', leg => {
  const ws = makeWorkspace(REFERENCE());
  writeDoc(ws, 'docs/a.md', refDoc('See [b](b.md).'));
  writeDoc(ws, 'docs/b.md', 'target doc.\n');
  const result = runCheck(leg.dir, { workspace: ws, config: CONFIG, args: ['--changed-path', 'docs/a.md'] });
  same(result.status, 0, 'exit');
  const out = jsonOut(result);
  same(out.links.checked, 1, 'links.checked');
  same(out.links.broken, [], 'links.broken');
  noDiagnosticOfCode(out, 'unresolved-ref', 'case 1');
});

// Case 2: same setup, link target missing on disk.
function case2Assertions(scriptDir) {
  const ws = makeWorkspace(REFERENCE());
  writeDoc(ws, 'docs/a.md', refDoc('See [missing](missing.md).'));
  const result = runCheck(scriptDir, { workspace: ws, config: CONFIG, args: ['--changed-path', 'docs/a.md'] });
  same(result.status, 1, 'exit');
  const out = jsonOut(result);
  if (!Array.isArray(out.links.broken) || out.links.broken.length !== 1) {
    throw new Error(`broken: ${truncate(JSON.stringify(out.links.broken))}`);
  }
  const item = out.links.broken[0];
  same(item.path, 'docs/a.md', 'broken[0].path');
  same(item.target, 'missing.md', 'broken[0].target');
  if (!Number.isInteger(item.line) || item.line < 1) throw new Error('broken[0].line is not a 1-based line number');
}

assertPerLeg('case-2:missing-local-target-reported', leg => case2Assertions(leg.dir));

// Case 3: bad status is a lint error.
assertPerLeg('case-3:invalid-status-lint-error', leg => {
  const ws = makeWorkspace(REFERENCE());
  writeDoc(ws, 'docs/a.md', '---\nrole: reference\nstatus: bogus\n---\n\nSome standing text.\n');
  const result = runCheck(leg.dir, { workspace: ws, config: CONFIG, args: ['--changed-path', 'docs/a.md'] });
  same(result.status, 1, 'exit');
  const out = jsonOut(result);
  if (!(out.lint.diagnostics || []).some(item => item.code === 'invalid-status' && item.path === 'docs/a.md')) {
    throw new Error(`no invalid-status diagnostic: ${truncate(JSON.stringify(out.lint.diagnostics))}`);
  }
});

// Case 4: link syntax inside a fence and inside inline code is not checked.
assertPerLeg('case-4:fenced-and-inline-code-not-checked', leg => {
  const ws = makeWorkspace(REFERENCE());
  writeDoc(ws, 'docs/a.md', refDoc('Cached example:\n\n```\n[b](missing.md)\n```\n\nInline verbatim: `[c](also-missing.md)` stays text.\n'));
  const result = runCheck(leg.dir, { workspace: ws, config: CONFIG, args: ['--changed-path', 'docs/a.md'] });
  same(result.status, 0, 'exit');
  const out = jsonOut(result);
  same(out.links.checked, 0, 'links.checked');
  same(out.links.broken, [], 'links.broken');
});

// Case 5: external URLs and fragments are skipped on purpose; sibling file with fragment is checked.
assertPerLeg('case-5:external-fragment-skipped-sibling-checked', leg => {
  const ws = makeWorkspace(REFERENCE());
  writeDoc(ws, 'docs/a.md', refDoc('Remote [x](https://e.com), fragment [y](#frag), sibling [z](b.md#sec).'));
  writeDoc(ws, 'docs/b.md', 'target doc.\n');
  const result = runCheck(leg.dir, { workspace: ws, config: CONFIG, args: ['--changed-path', 'docs/a.md'] });
  same(result.status, 0, 'exit');
  const out = jsonOut(result);
  same(out.links.checked, 1, 'links.checked');
  same(out.links.broken, [], 'links.broken');
});

// Case 6: reference-style link syntax is listed as unsupported, not checked.
assertPerLeg('case-6:reference-syntax-listed-unsupported', leg => {
  const ws = makeWorkspace(REFERENCE());
  writeDoc(ws, 'docs/a.md', refDoc('See [x][r].\n\n[r]: missing.md\n'));
  const result = runCheck(leg.dir, { workspace: ws, config: CONFIG, args: ['--changed-path', 'docs/a.md'] });
  same(result.status, 0, 'exit');
  const out = jsonOut(result);
  const unsupported = out.coverage.unsupported || [];
  const pathText = JSON.stringify(unsupported);
  if (!pathText.includes('"reference-link"') || !pathText.includes('"reference-definition"')) {
    throw new Error(`coverage.unsupported lacks reference syntax: ${truncate(pathText)}`);
  }
  // Syntax entries are path-scoped; the run-level "no domains declared" note (case 16) has no path.
  if (!unsupported.filter(item => item.syntax).every(item => item.path === 'docs/a.md')) throw new Error('unsupported path mismatch');
  same(out.links.checked, 0, 'links.checked');
});

// Case 7: existing but ungoverned changed path is unsupported; links not checked.
assertPerLeg('case-7:ungoverned-changed-path-unsupported', leg => {
  const ws = makeWorkspace(REFERENCE());
  writeDoc(ws, 'docs/a.md', refDoc('Plain text only.\n'));
  writeDoc(ws, 'docs/ungoverned.md', refDoc('See [b](b.md).\n'));
  const result = runCheck(leg.dir, { workspace: ws, config: CONFIG, args: ['--changed-path', 'docs/ungoverned.md'] });
  const out = jsonOut(result);
  same(out.links.checked, 0, 'links.checked');
  same(out.links.broken, [], 'links.broken');
  if (!(out.coverage.unsupported || []).some(item => item.path === 'docs/ungoverned.md')) {
    throw new Error(`no unsupported entry for docs/ungoverned.md: ${truncate(JSON.stringify(out.coverage))}`);
  }
});

// Case 8: missing config is a usage/config error, not a check.
assertPerLeg('case-8:missing-config-exit-2', leg => {
  const ws = makeWorkspace(null);
  writeDoc(ws, 'docs/a.md', refDoc('Some standing text.\n'));
  const result = runCheck(leg.dir, { workspace: ws, config: CONFIG, args: ['--changed-path', 'docs/a.md'] });
  same(result.status, 2, 'exit');
  const out = jsonOut(result);
  same(out.lint.exit, 2, 'lint.exit');
  same(out.links.skipped, 'lint-usage-error', 'links.skipped');
});

// Case 9: no --changed-path is a usage error.
assertPerLeg('case-9:missing-changed-path-exit-2', leg => {
  const ws = makeWorkspace(REFERENCE());
  writeDoc(ws, 'docs/a.md', refDoc('Some standing text.\n'));
  const result = runCheck(leg.dir, { workspace: ws, config: CONFIG, args: [] });
  same(result.status, 2, 'exit');
  assertUsageJson(result);
});

// Case 10: no --base shows the immutability factor as not-observed.
assertPerLeg('case-10:no-base-immutability-not-observed', leg => {
  const ws = makeWorkspace(REFERENCE());
  writeDoc(ws, 'docs/a.md', refDoc('Plain text only.\n'));
  const result = runCheck(leg.dir, { workspace: ws, config: CONFIG, args: ['--changed-path', 'docs/a.md'] });
  same(result.status, 0, 'exit');
  const out = jsonOut(result);
  same(out.lint.exit, 0, 'lint.exit');
  if (!out.lint.evidence || typeof out.lint.evidence.immutability !== 'string') {
    throw new Error(`lint.evidence missing: ${truncate(JSON.stringify(out.lint.evidence))}`);
  }
  same(out.lint.evidence.immutability, 'not-observed', 'lint.evidence.immutability');
});

// ---- Case 11: byte parity between the two script copies -------------------------------------------------------------

function sha256(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

{
  const id = 'case-11:byte-parity-source-packaged';
  try {
    same(sha256(path.join(LEGS[1].dir, MODULE)), sha256(path.join(LEGS[0].dir, MODULE)), 'sha256(doc-check.js) source = packaged');
    record('PASS', id, 'both');
  } catch (error) {
    record('FAIL', id, 'both', error.message.split('\n')[0]);
  }
}

// ---- Case 12: the repo's own dogfood -------------------------------------------------------------------------------

assertPerLeg('case-12:repo-dogfood-exit-0', leg => {
  const result = spawnSync(process.execPath, [
    path.join(leg.dir, MODULE), 'check',
    '--workspace', ROOT,
    '--config', CONFIG,
    '--changed-path', 'docs/architecture.md',
    '--changed-path', 'docs/doc-workflow-reconciliation.md'
  ], { encoding: 'utf8', cwd: os.tmpdir() });
  if (result.status !== 0) {
    throw new Error(`exit ${result.status}; stdout=${truncate(result.stdout)} stderr=${truncate(result.stderr)}`);
  }
  const out = jsonOut(result);
  same(out.links.broken, [], 'links.broken');
});

// ---- Cases 13–15: bare-token reference rules (the F1 real-path fix) -------------------------------------------------

// Case 13: bare SHA-256/UTF-8 tokens without a declared domain are not references.
assertPerLeg('case-13:bare-tech-tokens-not-references', leg => {
  const ws = makeWorkspace(REFERENCE());
  writeDoc(ws, 'docs/a.md', refDoc('Digests use SHA-256 and sources are read as UTF-8.\n'));
  const result = runCheck(leg.dir, { workspace: ws, config: CONFIG, args: ['--changed-path', 'docs/a.md'] });
  same(result.status, 0, 'exit');
  const out = jsonOut(result);
  noDiagnosticOfCode(out, 'unresolved-ref', 'case 13');
});

// Case 14: declared-domain bare tokens are still checked; a dangling GRPH-NNN fails.
assertPerLeg('case-14:declared-domain-dangling-token-fails', leg => {
  const ws = makeWorkspace(REFERENCE({ domains: ['GRPH'] }));
  writeDoc(ws, 'docs/a.md', refDoc('See GRPH-007 for the drawing format.\n'));
  const result = runCheck(leg.dir, { workspace: ws, config: CONFIG, args: ['--changed-path', 'docs/a.md'] });
  same(result.status, 1, 'exit');
  const out = jsonOut(result);
  const hit = (out.lint.diagnostics || []).find(item => item.code === 'unresolved-ref');
  if (!hit) throw new Error(`no unresolved-ref diagnostic: ${truncate(JSON.stringify(out.lint.diagnostics))}`);
  same(hit.id, 'GRPH-007', 'unresolved-ref id');
  same(hit.path, 'docs/a.md', 'unresolved-ref path');
});

// Case 15: an active ADR's alias resolves citations of the old ID (domain not declared).
assertPerLeg('case-15:adr-alias-resolves-old-id', leg => {
  const ws = makeWorkspace({
    domains: ['GRPH'],
    governed: [{ path: 'docs/adr.md', role: 'adr' }, { path: 'docs/notes.md', role: 'reference' }]
  });
  writeDoc(ws, 'docs/adr.md', '---\nrole: adr\nstatus: accepted\nid: GRPH-001\naliases:\n  - OLD-001\n---\n\nDecision: the layout named GRPH-001 stands.\n');
  writeDoc(ws, 'docs/notes.md', refDoc('Retrieval cites OLD-001.\n'));
  const result = runCheck(leg.dir, {
    workspace: ws,
    config: CONFIG,
    args: ['--changed-path', 'docs/adr.md', '--changed-path', 'docs/notes.md']
  });
  same(result.status, 0, 'exit');
  const out = jsonOut(result);
  noDiagnosticOfCode(out, 'unresolved-ref', 'case 15');
});

// ---- Revert check: the suite detects removal of the broken-link scan ------------------------------------------------
// Copy the source scripts to tmp, neutralise the broken.push line in the copy, and confirm case 2 then FAILS.

{
  const id = 'revert-check:mutated-copy-fails-case-2';
  // Copy the whole scripts directory: doc-lifecycle.js lazily requires ./project-docs-resolver.
  function fullCopy(destination) {
    fs.cpSync(LEGS[0].dir, destination, { recursive: true });
    return destination;
  }
  try {
    const controlDir = fullCopy(fs.mkdtempSync(path.join(os.tmpdir(), 'f1 doc check control ')));
    tmpDirs.push(controlDir);
    case2Assertions(controlDir); // control: an intact copy must still satisfy case 2

    const mutatedDir = fullCopy(fs.mkdtempSync(path.join(os.tmpdir(), 'f1 doc check revert ')));
    tmpDirs.push(mutatedDir);
    const scriptFile = path.join(mutatedDir, MODULE);
    const original = fs.readFileSync(scriptFile, 'utf8');
    const mutated = original.replace('broken.push({ path: relative, line, target });', ';');
    if (mutated === original) throw new Error('mutation did not apply: broken.push line not found in the copy');
    fs.writeFileSync(scriptFile, mutated);
    case2Assertions(mutatedDir);
    record('FAIL', id, 'source', 'mutated copy still satisfies case 2; the broken-link assertion does not detect removal of the broken.push line');
  } catch (error) {
    record('PASS', id, 'source', `case 2 fails on the mutated copy, so the assertion detects it (${error.message.split('\n')[0]})`);
  }
}

// ---- Cases 16–28: F1-T2 lock for the F1-R review fixes ------------------------------------------------------------
// Expected values come from the F1-T2 packet table and the F1-W3 fix spec, not from running the code. The cases there
// marked by the packet may be RED until haiku's F1-W3 implementer lands; that is expected and is reported per case.

// Case 16: with no domains declared, the run says so exactly once in coverage.unsupported.
assertPerLeg('case-16:no-domains-declared-entry-once', leg => {
  const ws = makeWorkspace(REFERENCE());
  writeDoc(ws, 'docs/a.md', refDoc('Plain text only.\n'));
  const result = runCheck(leg.dir, { workspace: ws, config: CONFIG, args: ['--changed-path', 'docs/a.md'] });
  const out = jsonOut(result);
  const entries = (out.coverage.unsupported || []).filter(item => typeof item.reason === 'string' && item.reason.startsWith('no domains declared'));
  if (entries.length !== 1) {
    throw new Error(`expected exactly one "no domains declared" entry, got ${truncate(JSON.stringify(out.coverage.unsupported))}`);
  }
});

// Case 17: with domains declared there is no such entry.
assertPerLeg('case-17:domains-declared-no-entry', leg => {
  const ws = makeWorkspace(REFERENCE({ domains: ['GRPH'] }));
  writeDoc(ws, 'docs/a.md', refDoc('Plain text only.\n'));
  const result = runCheck(leg.dir, { workspace: ws, config: CONFIG, args: ['--changed-path', 'docs/a.md'] });
  const out = jsonOut(result);
  const trailing = JSON.stringify(out.coverage.unsupported || []);
  if (trailing.includes('no domains declared')) throw new Error(`unexpected reason: ${truncate(trailing)}`);
});

// Case 18: a malformed PRD-ID reference (PRD-012) is a lint error, not silently skipped.
assertPerLeg('case-18:malformed-prd-id-invalid-ref', leg => {
  const ws = makeWorkspace(REFERENCE());
  writeDoc(ws, 'docs/a.md', refDoc('See PRD-012 for the product spec.\n'));
  const result = runCheck(leg.dir, { workspace: ws, config: CONFIG, args: ['--changed-path', 'docs/a.md'] });
  same(result.status, 1, 'exit');
  const out = jsonOut(result);
  if (!(out.lint.diagnostics || []).some(item => item.code === 'invalid-ref')) {
    throw new Error(`no invalid-ref diagnostic: ${truncate(JSON.stringify(out.lint.diagnostics))}`);
  }
});

// Case 19: an unreadable governed doc is a defect (broken entry with reason unreadable), not "not governed".
assertPerLeg('case-19:unreadable-governed-doc-broken-entry', leg => {
  if (process.platform === 'win32') { record('SKIP', undefined, leg.name, 'win32: chmod 000 semantics differ'); return; }
  const ws = makeWorkspace(REFERENCE());
  writeDoc(ws, 'docs/a.md', refDoc('Plain text only.\n'));
  const absolute = path.join(ws, 'docs/a.md');
  fs.chmodSync(absolute, 0o000);
  try {
    let readable = false;
    try { fs.accessSync(absolute, fs.constants.R_OK); readable = true; } catch { readable = false; }
    if (readable) { record('SKIP', 'case-19:unreadable-governed-doc-broken-entry', leg.name, 'environment can read a chmod-000 file (running as root?)'); return; }
    const result = runCheck(leg.dir, { workspace: ws, config: CONFIG, args: ['--changed-path', 'docs/a.md'] });
    same(result.status, 1, 'exit');
    const out = jsonOut(result);
    const hit = (out.links.broken || []).find(item => item.path === 'docs/a.md');
    if (!hit || hit.reason !== 'unreadable') {
      throw new Error(`no broken entry with reason "unreadable": ${truncate(JSON.stringify(out.links))}`);
    }
  } finally {
    try { fs.chmodSync(absolute, 0o644); } catch { /* removal works regardless */ }
  }
});

// Case 20: a changed path that is not on disk says exactly that.
assertPerLeg('case-20:changed-path-not-on-disk-reason', leg => {
  const ws = makeWorkspace(REFERENCE());
  writeDoc(ws, 'docs/a.md', refDoc('Plain text only.\n'));
  const result = runCheck(leg.dir, { workspace: ws, config: CONFIG, args: ['--changed-path', 'docs/gone.md'] });
  const out = jsonOut(result);
  const hit = (out.coverage.unsupported || []).find(item => item.path === 'docs/gone.md');
  if (!hit) throw new Error(`no unsupported entry for docs/gone.md: ${truncate(JSON.stringify(out.coverage))}`);
  same(hit.reason, 'not on disk', 'unsupported reason');
  same(result.status, 0, 'exit');
});

// Case 21: an existing but ungoverned changed path says exactly that.
assertPerLeg('case-21:existing-ungoverned-changed-path-reason', leg => {
  const ws = makeWorkspace(REFERENCE());
  writeDoc(ws, 'docs/a.md', refDoc('Plain text only.\n'));
  writeDoc(ws, 'docs/free.md', 'free file, not governed.\n');
  const result = runCheck(leg.dir, { workspace: ws, config: CONFIG, args: ['--changed-path', 'docs/free.md'] });
  const out = jsonOut(result);
  const hit = (out.coverage.unsupported || []).find(item => item.path === 'docs/free.md');
  if (!hit) throw new Error(`no unsupported entry for docs/free.md: ${truncate(JSON.stringify(out.coverage))}`);
  same(hit.reason, 'not governed', 'unsupported reason');
});

// Case 22: angle-bracket destinations, query strings and titles are valid link forms.
assertPerLeg('case-22:angle-query-title-links-checked', leg => {
  const ws = makeWorkspace(REFERENCE());
  writeDoc(ws, 'docs/a.md', refDoc('Angle [a](<./b.md>), query [q](./b.md?x=1), titled [t](./b.md "Title").'));
  writeDoc(ws, 'docs/b.md', 'target doc.\n');
  const result = runCheck(leg.dir, { workspace: ws, config: CONFIG, args: ['--changed-path', 'docs/a.md'] });
  same(result.status, 0, 'exit');
  const out = jsonOut(result);
  same(out.links.checked, 3, 'links.checked');
  same(out.links.broken, [], 'links.broken');
  if (JSON.stringify(out.coverage.unsupported || []).includes('angle-bracket-destination')) {
    throw new Error(`unexpected angle-bracket-destination entry: ${truncate(JSON.stringify(out.coverage))}`);
  }
});

// Case 23: a double-backtick code span is not scanned.
assertPerLeg('case-23:double-backtick-span-not-checked', leg => {
  const ws = makeWorkspace(REFERENCE());
  writeDoc(ws, 'docs/a.md', refDoc('Verbatim text: ``[x](./nope.md)`` is not a link.\n'));
  const result = runCheck(leg.dir, { workspace: ws, config: CONFIG, args: ['--changed-path', 'docs/a.md'] });
  same(result.status, 0, 'exit');
  const out = jsonOut(result);
  same(out.links.checked, 0, 'links.checked');
  same(out.links.broken, [], 'links.broken');
});

// Case 24: a scheme-less www. destination is unsupported, not a broken local file.
assertPerLeg('case-24:scheme-less-url-unsupported', leg => {
  const ws = makeWorkspace(REFERENCE());
  writeDoc(ws, 'docs/a.md', refDoc('Site [w](www.example.com) reference.\n'));
  const result = runCheck(leg.dir, { workspace: ws, config: CONFIG, args: ['--changed-path', 'docs/a.md'] });
  const out = jsonOut(result);
  const hit = (out.coverage.unsupported || []).find(item => item.syntax === 'scheme-less-url');
  if (!hit) throw new Error(`no scheme-less-url entry: ${truncate(JSON.stringify(out.coverage))}`);
  same(out.links.checked, 0, 'links.checked');
  same(out.links.broken, [], 'links.broken');
});

// Case 25: non-JSON lint output is a guarded lint-pipe failure, never a stack trace.
assertPerLeg('case-25:non-json-lint-output-guarded', leg => {
  const stubDir = fs.mkdtempSync(path.join(os.tmpdir(), 'f1 doc check stub '));
  tmpDirs.push(stubDir);
  fs.cpSync(path.join(leg.dir, MODULE), path.join(stubDir, MODULE));
  fs.writeFileSync(path.join(stubDir, LINT), '#!/usr/bin/env node\n\u0027use strict\u0027;\nif (require.main === module) { process.stdout.write(\u0027not json\\n\u0027); process.exit(1); }\nmodule.exports = { collectDocs: () => [] };\n');
  const ws = makeWorkspace(REFERENCE());
  writeDoc(ws, 'docs/a.md', refDoc('Plain text only.\n'));
  const result = runCheck(stubDir, { workspace: ws, config: CONFIG, args: ['--changed-path', 'docs/a.md'] });
  same(result.status, 2, 'exit');
  const out = jsonOut(result);
  if (typeof out.lint.error !== 'string' || !out.lint.error.includes('not JSON')) {
    throw new Error(`lint.error does not mention "not JSON": ${truncate(JSON.stringify(out.lint))}`);
  }
  if ((result.stderr || '').includes('SyntaxError')) throw new Error('stack trace leaked to stderr');
});

// Case 26: a flag-shaped value is a usage error, not a silently consumed path.
assertPerLeg('case-26:flag-shaped-value-exit-2', leg => {
  const ws = makeWorkspace(REFERENCE());
  writeDoc(ws, 'docs/a.md', refDoc('Plain text only.\n'));
  const result = spawnSync(process.execPath, [
    path.join(leg.dir, MODULE), 'check',
    '--workspace', ws, '--config', CONFIG,
    '--changed-path', '--base'
  ], { encoding: 'utf8', cwd: os.tmpdir() });
  same(result.status, 2, 'exit');
  assertUsageJson(result);
});

// Case 27: a repeated --config is a usage error even when both configs are valid.
assertPerLeg('case-27:repeated-config-exit-2', leg => {
  const ws = makeWorkspace(REFERENCE({ domains: ['GRPH'] }));
  writeDoc(ws, 'docs/a.md', refDoc('Plain text only.\n'));
  writeDoc(ws, 'a.json', `${JSON.stringify(REFERENCE({ domains: ['GRPH'] }), null, 2)}\n`);
  writeDoc(ws, 'b.json', `${JSON.stringify(REFERENCE({ domains: ['GRPH'] }), null, 2)}\n`);
  const result = runCheck(leg.dir, { workspace: ws, config: 'a.json', args: ['--config', 'b.json', '--changed-path', 'docs/a.md'] });
  same(result.status, 2, 'exit');
  assertUsageJson(result);
});

// ---- Case 28: the shared obligation derivation is not broken by the SHA-256 rule ----------------------------------------------------------------
// A valid revisioned PRD whose prose names SHA-256, cited by an added test. The REQ must resolve, not analysis-error.
// Fixture construction mirrors the approvalDigest contract (frontmatter minus status/effective_at/approval plus body);
// the expected value (resolution resolved) comes from the F1-W3 finding-3 note, never from running the code.

const CASE28 = (() => {
  const prdBody = '# Graph\n\n## Context\n\nThe router is deterministic and stores a SHA-256 digest.\n\n### REQ-GRPH-020 (aliases: REQ-GRAPH-020): Export\n\nThe graph exports a stable index.\n\nAcceptance: the index is byte-identical across runs.\n';
  const sortedJson = value => {
    if (Array.isArray(value)) return `[${value.map(sortedJson).join(',')}]`;
    if (value && typeof value === 'object') {
      return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${sortedJson(value[key])}`).join(',')}}`;
    }
    return JSON.stringify(value);
  };
  const digest = 'sha256:' + crypto.createHash('sha256').update(
    Buffer.concat([
      Buffer.from(`${sortedJson({ id: 'PRD-GRPH-001', revision: 1, drafted_by: 'Alice Example' })}\n`, 'utf8'),
      Buffer.from(prdBody, 'utf8')
    ])).digest('hex');
  const prd = `---
id: "PRD-GRPH-001"
revision: 1
status: "effective"
drafted_by: "Alice Example"
effective_at: "2026-10-17T00:01:00Z"
approval:
  by: "Bob Independent"
  at: "2026-10-17T00:00:00Z"
  ref: "https://approvals.example.invalid/PRD-GRPH-001"
  role: "human"
  content_digest: "${digest}"
---
${prdBody}`;
  return {
    base: { files: { 'docs/prd/graph.md': prd } },
    candidate: { files: {
      'docs/prd/graph.md': prd,
      'ci/mechanism-lint.test.js': '// REQ-GRPH-020\nassert.equal(runGraph(), 2);\n'
    } }
  };
})();

assertPerLeg('case-28:sha256-prose-keeps-req-resolution-resolved', leg => {
  const moduleFile = path.join(leg.dir, 'doc-obligations.js');
  if (!fs.existsSync(moduleFile)) throw new Error(`module-missing: ${path.relative(ROOT, moduleFile)}`);
  delete require.cache[require.resolve(moduleFile)];
  const { deriveDocFacts } = require(moduleFile);
  const config = JSON.parse(fs.readFileSync(path.join(ROOT, 'ci', 'fixtures', 'doc-obligations', 'derive', 'config.json'), 'utf8'));
  const { facts } = deriveDocFacts({ base: CASE28.base, candidate: CASE28.candidate, config });
  const cited = (facts.citedReqs || []).filter(item => item.id === 'REQ-GRPH-020');
  if (cited.length !== 1) throw new Error(`REQ-GRPH-020 not cited exactly once: ${truncate(JSON.stringify(facts.citedReqs))}`);
  same(cited[0].resolution, 'resolved', 'cited REQ resolution');
});

// Case 29: nested and escaped label brackets must not hide missing destinations.
assertPerLeg('case-29:nested-and-escaped-labels-find-broken-links', leg => {
  const ws = makeWorkspace(REFERENCE({ domains: ['GRPH'] }));
  writeDoc(ws, 'docs/a.md', refDoc('See [API [v2]](missing-nested.md) and [API \\[v3\\]](missing-escaped.md).'));
  const result = runCheck(leg.dir, { workspace: ws, config: CONFIG, args: ['--changed-path', 'docs/a.md'] });
  same(result.status, 1, 'exit');
  const out = jsonOut(result);
  same((out.links.broken || []).map(item => item.target), ['missing-nested.md', 'missing-escaped.md'], 'broken targets');
});

// Case 30: balanced parentheses belong to the destination, not the link delimiter.
assertPerLeg('case-30:balanced-parentheses-in-destination-resolve', leg => {
  const ws = makeWorkspace(REFERENCE({ domains: ['GRPH'] }));
  writeDoc(ws, 'docs/a.md', refDoc('See [release](release(v2).md).'));
  writeDoc(ws, 'docs/release(v2).md', 'release notes\n');
  const result = runCheck(leg.dir, { workspace: ws, config: CONFIG, args: ['--changed-path', 'docs/a.md'] });
  same(result.status, 0, 'exit');
  const out = jsonOut(result);
  same(out.links.checked, 1, 'links.checked');
  same(out.links.broken, [], 'links.broken');
});

// Case 31: malformed inline-link syntax must be reported as unsupported, never silently omitted.
assertPerLeg('case-31:unparsed-inline-link-reported-unsupported', leg => {
  const ws = makeWorkspace(REFERENCE({ domains: ['GRPH'] }));
  writeDoc(ws, 'docs/a.md', refDoc('See [broken](missing.md without closing paren.'));
  const result = runCheck(leg.dir, { workspace: ws, config: CONFIG, args: ['--changed-path', 'docs/a.md'] });
  same(result.status, 0, 'exit');
  const out = jsonOut(result);
  if (!(out.coverage.unsupported || []).some(item => item.path === 'docs/a.md' && item.syntax === 'inline-link-unparsed')) {
    throw new Error(`unparsed inline link missing from coverage.unsupported: ${truncate(JSON.stringify(out.coverage))}`);
  }
});

// Case 32: an image nested in a link label is a link target. A missing image is broken; a present one passes.
assertPerLeg('case-32:image-in-link-label-checked', leg => {
  const ws = makeWorkspace(REFERENCE({ domains: ['GRPH'] }));
  writeDoc(ws, 'docs/a.md', refDoc('See [text ![img](i.png)](doc.md).'));
  writeDoc(ws, 'docs/doc.md', 'doc\n');
  const result = runCheck(leg.dir, { workspace: ws, config: CONFIG, args: ['--changed-path', 'docs/a.md'] });
  same(result.status, 1, 'exit with a missing image');
  const out = jsonOut(result);
  same((out.links.broken || []).map(item => item.target), ['i.png'], 'broken targets');
  same(out.links.checked, 2, 'links.checked');
});

// Control for case 32: the same label with the image present passes.
assertPerLeg('case-32-control:image-in-link-label-present-passes', leg => {
  const ws = makeWorkspace(REFERENCE({ domains: ['GRPH'] }));
  writeDoc(ws, 'docs/a.md', refDoc('See [text ![img](i.png)](doc.md).'));
  writeDoc(ws, 'docs/doc.md', 'doc\n');
  writeDoc(ws, 'docs/i.png', 'png\n');
  const result = runCheck(leg.dir, { workspace: ws, config: CONFIG, args: ['--changed-path', 'docs/a.md'] });
  same(result.status, 0, 'exit');
  const out = jsonOut(result);
  same(out.links.broken, [], 'links.broken');
  same(out.links.checked, 2, 'links.checked');
});

// Case 33: a link nested in a link label. CommonMark makes only the inner link a link; doc-check checks both targets, so
// neither is skipped silently. Both missing gives both broken, compared as sorted sets.
assertPerLeg('case-33:link-nested-in-link-label-both-checked', leg => {
  const ws = makeWorkspace(REFERENCE({ domains: ['GRPH'] }));
  writeDoc(ws, 'docs/a.md', refDoc('See [outer [inner](b.md)](doc.md).'));
  const result = runCheck(leg.dir, { workspace: ws, config: CONFIG, args: ['--changed-path', 'docs/a.md'] });
  same(result.status, 1, 'exit');
  const out = jsonOut(result);
  same((out.links.broken || []).map(item => item.target).sort(), ['b.md', 'doc.md'], 'broken targets');
});

// Case 34: deeply nested labels complete within a generous cross-platform bound and count every target once.
assertPerLeg('case-34:deeply-nested-labels-iterative-and-complete', leg => {
  const depth = 6000;
  const ws = makeWorkspace(REFERENCE({ domains: ['GRPH'] }));
  writeDoc(ws, 'docs/a.md', refDoc('['.repeat(depth) + 'x' + '](a)'.repeat(depth)));
  writeDoc(ws, 'docs/a', 'target\n');
  const result = runCheck(leg.dir, {
    workspace: ws, config: CONFIG, timeoutMs: 30000,
    args: ['--changed-path', 'docs/a.md']
  });
  same(result.status, 0, 'exit within 30 seconds');
  const out = jsonOut(result);
  same(out.links.checked, depth, 'all nested targets checked once');
  same(out.links.broken, [], 'broken targets');
  same(out.coverage.unsupported, [], 'unsupported syntax');
  same(result.stdout, `${JSON.stringify(out, null, 2)}\n`, 'single JSON object on stdout');
  same(result.stderr, '', 'stderr');
});

// Case 35: inventory metadata stays separate from doc-check's partial no-domain result.
assertPerLeg('case-35:p1-inventory-does-not-upgrade-no-domain-doc-check', leg => {
  const ws = makeWorkspace(REFERENCE());
  writeDoc(ws, 'docs/a.md', refDoc('Plain text only.\n'));
  const manifest = '.agents/harness-everything/document-inventory.json';
  writeDoc(ws, manifest, `${JSON.stringify({
    schemaVersion: 1,
    documentGlobs: ['**/*.md'],
    rules: [
      { match: 'docs/a.md', role: 'reference', lifecycle: 'current', disposition: 'applicable', reason: 'fixture positive control' },
      { match: 'docs/proposed.md', role: 'proposed-reference', lifecycle: 'new', disposition: 'applicable', reason: 'explicit proposal control' }
    ]
  }, null, 2)}\n`);
  gitAt(ws, ['init', '-q']);
  for (const [key, value] of [['user.name', 'Harness Test'], ['user.email', 'harness@example.invalid'], ['commit.gpgsign', 'false']]) gitAt(ws, ['config', key, value]);
  gitAt(ws, ['add', '-A']);
  gitAt(ws, ['commit', '-qm', 'F1 inventory fixture']);
  const base = gitAt(ws, ['rev-parse', 'HEAD']);
  writeDoc(ws, 'local-session/private-notes.md', 'private sentinel: first value\n');
  writeDoc(ws, 'docs/proposed.md', 'explicit proposal\n');

  const inventoryResult = runInventory(leg.dir, { workspace: ws, manifest, base });
  same(inventoryResult.status, 0, 'inventory exit');
  const inventory = jsonOut(inventoryResult);
  const entry = (inventory.records || []).find(item => item.path === 'docs/a.md');
  if (!entry) throw new Error(`inventory omitted the positive path: ${truncate(inventoryResult.stdout)}`);
  same(entry.role, 'reference', 'inventory role');
  same(entry.disposition, 'applicable', 'inventory disposition');
  same(entry.validation.outcome, 'unchecked', 'inventory validation remains unchecked');
  same(inventory.coverage.complete, true, 'explicit disposition coverage');
  same(inventory.records.some(item => item.path === 'local-session/private-notes.md'), false, 'unproposed local session path is absent');
  same(inventoryResult.stdout.includes('private sentinel'), false, 'unproposed local session contents are absent');
  writeDoc(ws, 'local-session/private-notes.md', 'private sentinel: changed value\n');
  const afterScratchChange = jsonOut(runInventory(leg.dir, { workspace: ws, manifest, base }));
  same(afterScratchChange.candidate.sha256, inventory.candidate.sha256, 'unproposed scratch changes do not affect candidate digest');
  const explicit = jsonOut(runInventory(leg.dir, { workspace: ws, manifest, base, proposedUntracked: ['docs/proposed.md'] }));
  const proposedEntry = (explicit.records || []).find(item => item.path === 'docs/proposed.md');
  if (!proposedEntry) throw new Error('explicitly proposed untracked document is absent');
  same(proposedEntry.role, 'proposed-reference', 'explicit proposal role');
  same(explicit.candidate.proposedUntrackedPaths, 1, 'explicit proposal count');
  const traversal = runInventory(leg.dir, { workspace: ws, manifest, base, proposedUntracked: ['../outside-private-notes.md'] });
  same(traversal.status, 2, 'outside explicit proposal exit');
  if (!/within --workspace/.test(traversal.stderr)) throw new Error(`outside explicit proposal rejection missing: ${truncate(traversal.stderr)}`);

  const result = runCheck(leg.dir, { workspace: ws, config: CONFIG, args: ['--changed-path', 'docs/a.md'] });
  same(result.status, 0, 'doc-check remains partial without turning the informational note into a failure');
  const out = jsonOut(result);
  const notes = (out.coverage.unsupported || []).filter(item => typeof item.reason === 'string' && item.reason.startsWith('no domains declared'));
  same(notes.length, 1, 'existing no-domain capability remains visible exactly once');
});

const proposalSymlinkProbeTarget = fs.mkdtempSync(path.join(os.tmpdir(), 'f1 proposal symlink probe target '));
tmpDirs.push(proposalSymlinkProbeTarget);
const proposalSymlinkProbe = path.join(os.tmpdir(), `f1-proposal-symlink-probe-${process.pid}`);
let proposalSymlinkUnavailable = null;
try {
  fs.symlinkSync(proposalSymlinkProbeTarget, proposalSymlinkProbe, process.platform === 'win32' ? 'junction' : 'dir');
  fs.rmSync(proposalSymlinkProbe, { recursive: true, force: true });
} catch (error) {
  if (!['EPERM', 'EACCES', 'ENOTSUP'].includes(error.code)) throw error;
  proposalSymlinkUnavailable = error.code;
}
if (proposalSymlinkUnavailable) {
  for (const leg of LEGS) record('SKIP', 'case-37:proposed-untracked-symlink-ancestor-fails-closed', leg.name, `symlink creation unavailable (${proposalSymlinkUnavailable})`);
} else assertPerLeg('case-37:proposed-untracked-symlink-ancestor-fails-closed', leg => {
  const ws = makeWorkspace(null);
  const manifest = '.agents/harness-everything/document-inventory.json';
  const manifestValue = {
    schemaVersion: 1, documentGlobs: ['**/*.md'],
    rules: [{ match: 'docs/proposed.md', role: 'proposed-reference', lifecycle: 'new', disposition: 'applicable', reason: 'explicit proposal control' }]
  };
  writeDoc(ws, manifest, `${JSON.stringify(manifestValue)}\n`);
  writeDoc(ws, 'docs/a.md', 'tracked\n');
  gitAt(ws, ['init', '-q']);
  for (const [key, value] of [['user.name', 'Harness Test'], ['user.email', 'harness@example.invalid'], ['commit.gpgsign', 'false']]) gitAt(ws, ['config', key, value]);
  gitAt(ws, ['add', '-A']);
  gitAt(ws, ['commit', '-qm', 'F1 proposed path symlink fixture']);
  const base = gitAt(ws, ['rev-parse', 'HEAD']);
  writeDoc(ws, 'docs/proposed.md', 'positive proposal\n');
  const positive = runInventory(leg.dir, { workspace: ws, manifest, base, proposedUntracked: ['docs/proposed.md'] });
  same(positive.status, 0, 'direct proposal exit');
  same(jsonOut(positive).records.some(item => item.path === 'docs/proposed.md'), true, 'direct proposal is inventoried');

  const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'f1 external proposed path '));
  tmpDirs.push(outside);
  writeDoc(outside, 'private-notes.md', 'private sentinel: external target\n');
  fs.mkdirSync(path.join(ws, 'local-session'), { recursive: true });
  fs.symlinkSync(outside, path.join(ws, 'local-session', 'linked'), process.platform === 'win32' ? 'junction' : 'dir');
  const escaped = runInventory(leg.dir, { workspace: ws, manifest, base, proposedUntracked: ['local-session/linked/private-notes.md'] });
  same(escaped.status, 2, 'proposal through symlink ancestor exit');
  if (!/symbolic link|symlink/i.test(escaped.stderr)) throw new Error(`symlink ancestor rejection reason missing: ${truncate(escaped.stderr)}`);
  same(escaped.stdout.includes('private sentinel'), false, 'external target contents absent');
});

const symlinkProbeTarget = fs.mkdtempSync(path.join(os.tmpdir(), 'f1 manifest symlink probe target '));
tmpDirs.push(symlinkProbeTarget);
const symlinkProbe = path.join(os.tmpdir(), `f1-manifest-symlink-probe-${process.pid}`);
let symlinkUnavailable = null;
try {
  fs.symlinkSync(symlinkProbeTarget, symlinkProbe, process.platform === 'win32' ? 'junction' : 'dir');
  fs.rmSync(symlinkProbe, { recursive: true, force: true });
} catch (error) {
  if (!['EPERM', 'EACCES', 'ENOTSUP'].includes(error.code)) throw error;
  symlinkUnavailable = error.code;
}
if (symlinkUnavailable) {
  for (const leg of LEGS) record('SKIP', 'case-36:inventory-manifest-symlink-ancestor-fails-closed', leg.name, `symlink creation unavailable (${symlinkUnavailable})`);
} else assertPerLeg('case-36:inventory-manifest-symlink-ancestor-fails-closed', leg => {
  const ws = makeWorkspace(null);
  const manifest = '.agents/harness-everything/document-inventory.json';
  const insideManifest = {
    schemaVersion: 1, documentGlobs: ['**/*.md'],
    rules: [{ match: 'docs/a.md', role: 'inside-control', lifecycle: 'current', disposition: 'applicable', reason: 'inside manifest' }]
  };
  writeDoc(ws, manifest, `${JSON.stringify(insideManifest)}\n`);
  writeDoc(ws, 'docs/a.md', 'tracked\n');
  gitAt(ws, ['init', '-q']);
  for (const [key, value] of [['user.name', 'Harness Test'], ['user.email', 'harness@example.invalid'], ['commit.gpgsign', 'false']]) gitAt(ws, ['config', key, value]);
  gitAt(ws, ['add', '-A']);
  gitAt(ws, ['commit', '-qm', 'F1 manifest symlink fixture']);
  const base = gitAt(ws, ['rev-parse', 'HEAD']);
  const inside = runInventory(leg.dir, { workspace: ws, manifest, base });
  same(inside.status, 0, 'inside manifest exit');
  same(jsonOut(inside).records.find(item => item.path === 'docs/a.md').role, 'inside-control', 'inside manifest role');

  const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'f1 external manifest '));
  tmpDirs.push(outside);
  const externalManifest = { ...insideManifest, rules: [{ ...insideManifest.rules[0], role: 'external-sentinel-secret', reason: 'must not be accepted' }] };
  writeDoc(outside, 'harness-everything/document-inventory.json', `${JSON.stringify(externalManifest)}\n`);
  fs.rmSync(path.join(ws, '.agents'), { recursive: true, force: true });
  fs.symlinkSync(outside, path.join(ws, '.agents'), process.platform === 'win32' ? 'junction' : 'dir');
  const escaped = runInventory(leg.dir, { workspace: ws, manifest, base });
  same(escaped.status, 2, 'manifest ancestor symlink exit');
  if (!/symbolic link|symlink/i.test(escaped.stderr)) throw new Error(`manifest ancestor rejection reason missing: ${truncate(escaped.stderr)}`);
  same(escaped.stdout.includes('external-sentinel-secret'), false, 'external manifest content absent');
});

// ---- Summary -------------------------------------------------------------------------------------------------------

console.log(`\nF1 doc-check summary: ${passed} PASS, ${failed} FAIL, ${skipped} SKIP${failed ? `\nFAILED assertions (${failures.length}):\n  ${failures.join('\n  ')}` : ''}${failed === 0 && skipped > 0 ? ' (skips are environment-gated cases only)' : ''}`);

for (const dir of tmpDirs) {
  try { removeTree(dir); } catch { /* tmp leftovers are harmless */ }
}

process.exitCode = failed > 0 ? 1 : 0;
