#!/usr/bin/env node
'use strict';

// F2 doc-craft lock suite: the prose-share reminder and the shared-craft carrier pointers.
//
// R cases run the doc-check command on both legs (canonical scripts + packaged mirror) and assert the
// prose-share reminder contract from the A1 §3 spec: top-level `reminders`, exact line classification,
// `share = proseLines/eligibleLines`, trigger strictly when `2*proseLines > eligibleLines`, no exit effect.
// Expected values come from the spec and the packet table, never from running the code.
// C cases pin the shared-craft carrier pointers; P pins doc-check byte parity.
//
// RED is expected until the implementer lands: R* must fail at an assertion (missing `reminders`), never crash.

const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const MODULE = 'doc-check.js';
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
  const s = text === undefined ? 'undefined' : String(text);
  return s.length > 300 ? `${s.slice(0, 300)}…` : s;
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

function makeWorkspace(config) {
  const ws = fs.mkdtempSync(path.join(os.tmpdir(), 'f2 doc craft '));
  tmpDirs.push(ws);
  if (config) writeDoc(ws, CONFIG, `${JSON.stringify(config, null, 2)}\n`);
  return ws;
}

const REFERENCE = config => ({ governed: [{ path: 'docs/x.md', role: 'reference' }], ...config });

function refDoc(body) {
  return `---\nrole: reference\nstatus: active\n---\n\n${body}\n`;
}

function runCheck(scriptDir, options) {
  return spawnSync(process.execPath, [
    path.join(scriptDir, MODULE), 'check',
    '--workspace', options.workspace,
    '--config', options.config,
    ...(options.args || [])
  ], { encoding: 'utf8', cwd: os.tmpdir() });
}

function jsonOut(result) {
  try { return JSON.parse(result.stdout); } catch {
    throw new Error(`stdout is not JSON (exit ${result.status}): ${truncate(result.stdout || result.stderr)}`);
  }
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

// The reminder oracle per A1 §3: one prose-share reminder with exactly these fields.
function assertReminder(out, pathValue, prose, eligible, idLabel) {
  if (!Array.isArray(out.reminders) || out.reminders.length !== 1) {
    throw new Error(`${idLabel}: expected exactly one reminder, got ${truncate(JSON.stringify(out.reminders))}`);
  }
  const item = out.reminders[0];
  same(item.code, 'prose-share', 'reminder code');
  same(item.path, pathValue, 'reminder path');
  same(item.strength, 'SHOULD', 'reminder strength');
  same(item.proseLines, prose, 'proseLines');
  same(item.eligibleLines, eligible, 'eligibleLines');
  same(item.share, prose / eligible, 'share');
  same(item.threshold, 0.5, 'threshold');
}

// ---- R cases -------------------------------------------------------------------------------------------------------

// R1: heading + one prose line. Exact 50% must not trigger.
assertPerLeg('case-r1:exact-half-no-reminder', leg => {
  const ws = makeWorkspace(REFERENCE());
  writeDoc(ws, 'docs/x.md', refDoc('# Title\n\nOnly prose line.\n'));
  const result = runCheck(leg.dir, { workspace: ws, config: CONFIG, args: ['--changed-path', 'docs/x.md'] });
  const out = jsonOut(result);
  same(out.reminders, [], 'reminders');
  same(result.status, 0, 'exit');
});

// R2: heading + prose + label line. 2/3 triggers; the label line counts as prose.
assertPerLeg('case-r2:label-line-counts', leg => {
  const ws = makeWorkspace(REFERENCE());
  writeDoc(ws, 'docs/x.md', refDoc('# Title\n\nIntro prose sentence.\n\n**Problem:** More\n'));
  const result = runCheck(leg.dir, { workspace: ws, config: CONFIG, args: ['--changed-path', 'docs/x.md'] });
  same(result.status, 0, 'exit');
  assertReminder(jsonOut(result), 'docs/x.md', 2, 3, 'case-r2');
});

// R3: heading + blank + fenced code. 0/1, no reminder.
assertPerLeg('case-r3:fenced-code-0-of-1', leg => {
  const ws = makeWorkspace(REFERENCE());
  writeDoc(ws, 'docs/x.md', refDoc('# Title\n\n```text\nconst code = 1;\n```\n'));
  const result = runCheck(leg.dir, { workspace: ws, config: CONFIG, args: ['--changed-path', 'docs/x.md'] });
  const out = jsonOut(result);
  same(out.reminders, [], 'reminders');
  same(result.status, 0, 'exit');
});

// R4: blockquote CJK + CJK prose pipe table row. 2/3, one reminder.
assertPerLeg('case-r4:cjk-blockquote-and-table', leg => {
  const ws = makeWorkspace(REFERENCE());
  writeDoc(ws, 'docs/x.md', refDoc('> 引用された行も散文として数えます\n\n本文の行は散文です。\n\n| before | after |\n'));
  const result = runCheck(leg.dir, { workspace: ws, config: CONFIG, args: ['--changed-path', 'docs/x.md'] });
  const out = jsonOut(result);
  assertReminder(out, 'docs/x.md', 2, 3, 'case-r4');
});

// R5: fence only. 0/0, share 0, no reminder.
assertPerLeg('case-r5:fence-only-0-of-0', leg => {
  const ws = makeWorkspace(REFERENCE());
  writeDoc(ws, 'docs/x.md', refDoc('```text\nonly fence content\n```\n'));
  const result = runCheck(leg.dir, { workspace: ws, config: CONFIG, args: ['--changed-path', 'docs/x.md'] });
  const out = jsonOut(result);
  same(out.reminders, [], 'reminders');
  same(result.status, 0, 'exit');
});

// R6: frontmatter lines are not counted. The body sits below the threshold (1/2, exact half);
// counting the 5 frontmatter lines would push the share above (prose 5, eligible 9 → 2*5 > 9), so a
// mutant that counts frontmatter fires here while the documented behaviour must not.
assertPerLeg('case-r6:frontmatter-not-counted', leg => {
  const ws = makeWorkspace(REFERENCE());
  writeDoc(ws, 'docs/x.md', '---\nrole: reference\nstatus: active\ntitle: A longer title field\nowner: The doc owner\n---\n\n# Title\n\nOnly prose line.\n');
  const result = runCheck(leg.dir, { workspace: ws, config: CONFIG, args: ['--changed-path', 'docs/x.md'] });
  const out = jsonOut(result);
  same(out.reminders, [], 'reminders');
});

// R7: an unclosed fence consumes to EOF; three prose-like lines inside stay excluded (0/1, no reminder).
assertPerLeg('case-r7:unclosed-fence-consumes-to-eof', leg => {
  const ws = makeWorkspace(REFERENCE());
  writeDoc(ws, 'docs/x.md', refDoc('# Title\n\n```\nplain sentence one inside fence\nplain sentence two inside fence\nplain sentence three inside fence\n'));
  const result = runCheck(leg.dir, { workspace: ws, config: CONFIG, args: ['--changed-path', 'docs/x.md'] });
  const out = jsonOut(result);
  same(out.reminders, [], 'reminders');
  same(result.status, 0, 'exit');
});

// R8: list items are eligible but not prose; a 4-space-indented line is excluded. 0/2, no reminder.
assertPerLeg('case-r8:lists-eligible-not-prose', leg => {
  const ws = makeWorkspace(REFERENCE());
  writeDoc(ws, 'docs/x.md', refDoc('- bullet item one\n\n1. ordered item alpha\n\n    indented code line\n'));
  const result = runCheck(leg.dir, { workspace: ws, config: CONFIG, args: ['--changed-path', 'docs/x.md'] });
  const out = jsonOut(result);
  same(out.reminders, [], 'reminders');
  same(result.status, 0, 'exit');
});

// R9: a CRLF body classifies identically to R2.
assertPerLeg('case-r9:crlf-same-counts', leg => {
  const ws = makeWorkspace(REFERENCE());
  writeDoc(ws, 'docs/x.md', `${refDoc('# Title\n\nIntro prose sentence.\n\n**Problem:** More\n').replace(/\n/g, '\r\n')}`);
  const result = runCheck(leg.dir, { workspace: ws, config: CONFIG, args: ['--changed-path', 'docs/x.md'] });
  const out = jsonOut(result);
  assertReminder(out, 'docs/x.md', 2, 3, 'case-r9');
});

// R10: the same changed path passed twice yields exactly one reminder.
assertPerLeg('case-r10:duplicate-path-one-reminder', leg => {
  const ws = makeWorkspace(REFERENCE());
  writeDoc(ws, 'docs/x.md', refDoc('# Title\n\nIntro prose sentence.\n\n**Problem:** More\n'));
  const result = runCheck(leg.dir, {
    workspace: ws, config: CONFIG,
    args: ['--changed-path', 'docs/x.md', '--changed-path', 'docs/x.md']
  });
  const out = jsonOut(result);
  if (!Array.isArray(out.reminders) || out.reminders.length !== 1) {
    throw new Error(`expected exactly one reminder, got ${truncate(JSON.stringify(out.reminders))}`);
  }
  same(out.reminders[0].path, 'docs/x.md', 'reminder path');
});

// R11: an ungoverned file and a legacy file with high prose both stay reminder-free.
assertPerLeg('case-r11:ungoverned-and-legacy-skipped', leg => {
  const ungoverned = makeWorkspace(REFERENCE());
  writeDoc(ungoverned, 'docs/x.md', refDoc('Plain text only.\n'));
  writeDoc(ungoverned, 'README.md', '# Readme\n\nprose one\nprose two\nprose three\n');
  const outU = jsonOut(runCheck(leg.dir, { workspace: ungoverned, config: CONFIG, args: ['--changed-path', 'README.md'] }));
  if ((outU.reminders || []).length > 0) throw new Error(`reminders for an ungoverned file: ${truncate(JSON.stringify(outU.reminders))}`);

  const legacy = makeWorkspace(REFERENCE({ legacy: ['docs/legacy/**'] }));
  writeDoc(legacy, 'docs/x.md', refDoc('Plain text only.\n'));
  writeDoc(legacy, 'docs/legacy/old.md', 'legacy prose one\nlegacy prose two\nlegacy prose three\n');
  const outL = jsonOut(runCheck(leg.dir, { workspace: legacy, config: CONFIG, args: ['--changed-path', 'docs/legacy/old.md'] }));
  if ((outL.reminders || []).length > 0) throw new Error(`reminders for a legacy file: ${truncate(JSON.stringify(outL.reminders))}`);
});

// R12: high prose AND a broken link stays exit 1; the reminder does not hide the defect.
assertPerLeg('case-r12:reminder-never-masks-broken-link', leg => {
  const ws = makeWorkspace(REFERENCE());
  writeDoc(ws, 'docs/x.md', refDoc('# Title\n\nIntro prose sentence.\n\n**Problem:** More\n\nA broken [link](missing.md).\n'));
  const result = runCheck(leg.dir, { workspace: ws, config: CONFIG, args: ['--changed-path', 'docs/x.md'] });
  same(result.status, 1, 'exit');
  const out = jsonOut(result);
  if (!(out.links.broken || []).some(item => item.target === 'missing.md')) {
    throw new Error(`broken_link missing: ${truncate(JSON.stringify(out.links))}`);
  }
  if (!(Array.isArray(out.reminders) && out.reminders.length === 1)) {
    throw new Error(`expected one reminder alongside the failure: ${truncate(JSON.stringify(out.reminders))}`);
  }
});

// R13: high prose and a valid doc exits 0; the reminder never causes failure.
assertPerLeg('case-r13:reminder-never-causes-failure', leg => {
  const ws = makeWorkspace(REFERENCE());
  writeDoc(ws, 'docs/x.md', refDoc('# Title\n\nIntro prose sentence.\n\n**Problem:** More\n\nAnd another plain sentence.\n'));
  const result = runCheck(leg.dir, { workspace: ws, config: CONFIG, args: ['--changed-path', 'docs/x.md'] });
  same(result.status, 0, 'exit');
  const out = jsonOut(result);
  if (!(Array.isArray(out.reminders) && out.reminders.length === 1)) {
    throw new Error(`expected one reminder on a valid doc: ${truncate(JSON.stringify(out.reminders))}`);
  }
});

// R14: a missing config exits 2 with no reminder analysis.
assertPerLeg('case-r14:missing-config-exit-2-no-reminders', leg => {
  const ws = makeWorkspace(null);
  writeDoc(ws, 'docs/x.md', refDoc('Plain text only.\n'));
  const result = runCheck(leg.dir, { workspace: ws, config: CONFIG, args: ['--changed-path', 'docs/x.md'] });
  same(result.status, 2, 'exit');
  const out = jsonOut(result);
  if (Object.prototype.hasOwnProperty.call(out, 'reminders')) {
    throw new Error(`reminders present on the exit-2 lane: ${truncate(JSON.stringify(out.reminders))}`);
  }
});

// R15: governed prd and adr docs with high prose stay reminder-free — the reminder scope is
// governed reference docs only (D6.5). Asserts on reminders only; prd/adr fixtures may lint.
function caseR15(dir) {
  const ws = makeWorkspace({
    domains: ['DOCA'],
    governed: [
      { path: 'docs/plan.md', role: 'prd' },
      { path: 'docs/decision.md', role: 'adr' }
    ]
  });
  writeDoc(ws, 'docs/plan.md', '---\nid: PRD-DOCA-001\nrevision: 1\nstatus: draft\ndrafted_by: prd author\n---\n\n# Title\n\nIntro prose sentence.\n\n**Problem:** More\n');
  writeDoc(ws, 'docs/decision.md', '---\nid: DOCA-001\nstatus: accepted\n---\n\n# Decision\n\nAnother prose sentence.\n\nAnd one more plain sentence.\n');
  const out = jsonOut(runCheck(dir, {
    workspace: ws, config: CONFIG,
    args: ['--changed-path', 'docs/plan.md', '--changed-path', 'docs/decision.md']
  }));
  if ((out.reminders || []).length > 0) throw new Error(`reminders for prd/adr docs: ${truncate(JSON.stringify(out.reminders))}`);
}
assertPerLeg('case-r15:prd-and-adr-no-reminder', leg => caseR15(leg.dir));

// R16: a legacy file with high prose counts no reminder even when it is governed
// with the reference role — the legacy guard, not the role, is what keeps it out.
function caseR16(dir) {
  const ws = makeWorkspace({ governed: [{ path: 'docs/legacy/old.md', role: 'reference' }], legacy: ['docs/legacy/**'] });
  writeDoc(ws, 'docs/legacy/old.md', refDoc('# Title\n\nIntro prose sentence.\n\n**Problem:** More\n'));
  const out = jsonOut(runCheck(dir, { workspace: ws, config: CONFIG, args: ['--changed-path', 'docs/legacy/old.md'] }));
  if ((out.reminders || []).length > 0) throw new Error(`reminders for a legacy file: ${truncate(JSON.stringify(out.reminders))}`);
}
assertPerLeg('case-r16:legacy-governed-no-reminder', leg => caseR16(leg.dir));

// R17: reminders are advisory-only. A valid high-prose reference still produces exactly one
// reminder, and nothing with the prose-share code may leak into lint.diagnostics.
function caseR17(dir) {
  const ws = makeWorkspace(REFERENCE());
  writeDoc(ws, 'docs/x.md', refDoc('# Title\n\nIntro prose sentence.\n\n**Problem:** More\n'));
  const out = jsonOut(runCheck(dir, { workspace: ws, config: CONFIG, args: ['--changed-path', 'docs/x.md'] }));
  assertReminder(out, 'docs/x.md', 2, 3, 'case-r17');
  const diagnosticsText = JSON.stringify(out.lint.diagnostics);
  if (diagnosticsText.includes('prose-share')) throw new Error(`reminder leaked into lint.diagnostics: ${truncate(diagnosticsText)}`);
}
assertPerLeg('case-r17:reminder-never-in-diagnostics', leg => caseR17(leg.dir));

// R18: a doc with malformed frontmatter (doc.error) gets no reminder even with high prose.
function caseR18(dir) {
  const ws = makeWorkspace(REFERENCE());
  writeDoc(ws, 'docs/x.md', '---\nrole: reference\n\nPlain prose sentence one.\nPlain prose sentence two.\nPlain prose sentence three.\n');
  const out = jsonOut(runCheck(dir, { workspace: ws, config: CONFIG, args: ['--changed-path', 'docs/x.md'] }));
  if ((out.reminders || []).length > 0) throw new Error(`reminders for a malformed-frontmatter doc: ${truncate(JSON.stringify(out.reminders))}`);
}
assertPerLeg('case-r18:malformed-frontmatter-no-reminder', leg => caseR18(leg.dir));

// R19: a closing fence must match the opening character. A ~~~ line inside a ``` fence does not
// close it, so the fence stays open to EOF and the prose-like lines after ~~~ stay excluded (0/1).
function caseR19(dir) {
  const ws = makeWorkspace(REFERENCE());
  writeDoc(ws, 'docs/x.md', refDoc('# Title\n\n```text\ncode inside the fence\n~~~\nplain prose sentence after the mismatched closer\nplain prose sentence two after the closer\n'));
  const out = jsonOut(runCheck(dir, { workspace: ws, config: CONFIG, args: ['--changed-path', 'docs/x.md'] }));
  if (out.reminders.length !== 0) throw new Error(`~~~ closed a backtick fence: ${truncate(JSON.stringify(out.reminders))}`);
}
assertPerLeg('case-r19:mismatched-fence-chars-not-closed', leg => caseR19(leg.dir));

// R20: a line with 4 leading spaces before a backtick run is an indented line, not an opening
// fence (0–3 spaces per the A1 §3 table), so it is excluded from eligible and the lines after
// it count: prose 2 of eligible 2 triggers one reminder.
function caseR20(dir) {
  const ws = makeWorkspace(REFERENCE());
  writeDoc(ws, 'docs/x.md', refDoc('    ```\nPlain prose sentence one.\nPlain prose sentence two.\n'));
  const out = jsonOut(runCheck(dir, { workspace: ws, config: CONFIG, args: ['--changed-path', 'docs/x.md'] }));
  assertReminder(out, 'docs/x.md', 2, 2, 'case-r20');
}
assertPerLeg('case-r20:indented-backticks-not-a-fence', leg => caseR20(leg.dir));

// ---- C cases: shared-craft carriers --------------------------------------------------------------------------------

const SHARED = 'harness-everything/references/documentation/_shared';
const CRAFT_TARGET = path.join(ROOT, 'plugins', 'harness-everything', 'skills', SHARED, 'writing-craft.md');
const C1_FILES = {
  'to-spec': 'process.md',
  'to-tickets': 'publishing-and-templates.md',
  'repo-docs': 'process-guide.md',
  'grill-with-docs': 'session-playbook.md'
};

// C1: the four thin consumers name the shared craft reference through <skills-repo-root>, and the target
// exists in the packaged skills tree.
{
  const id = 'case-c1:consumer-pointers-resolve';
  const missing = [];
  try {
    for (const [skill, fileName] of Object.entries(C1_FILES)) {
      const file = path.join(ROOT, 'plugins', 'harness-everything', 'skills', skill, 'references', fileName);
      if (!fs.existsSync(file)) { missing.push(`${skill}: reference file missing`); continue; }
      const text = fs.readFileSync(file, 'utf8');
      if (!text.includes('<skills-repo-root>/harness-everything/references/documentation/_shared/writing-craft.md')) {
        missing.push(`${skill}: writing-craft pointer missing`);
      }
    }
    if (!fs.existsSync(CRAFT_TARGET)) missing.push('packaged writing-craft.md target missing');
    if (missing.length) throw new Error(missing.join(' | '));
    record('PASS', id, 'both');
  } catch (error) {
    record('FAIL', id, 'both', error.message.split('\n')[0]);
  }
}

// C2: the doc-check reference links both shared files, and both exist in the source and packaged layouts.
{
  const id = 'case-c2:doc-check-links-shared-pair';
  const missing = [];
  try {
    for (const [skillRel, refFile] of [['harness', 'harness-everything'], ['packaged', 'plugins/harness-everything/skills/harness-everything']]) {
      const docFile = path.join(ROOT, refFile, 'references', 'doc-check.md');
      if (!fs.existsSync(docFile)) { missing.push(`${skillRel}: doc-check.md missing`); continue; }
      const text = fs.readFileSync(docFile, 'utf8');
      for (const sharedName of ['writing-craft.md', 'maintenance.md']) {
        if (!text.includes(`documentation/_shared/${sharedName}`)) missing.push(`${skillRel}: link to _shared/${sharedName} missing`);
        if (!fs.existsSync(path.join(ROOT, refFile, 'references', 'documentation', '_shared', sharedName))) {
          missing.push(`${skillRel}: shared file _shared/${sharedName} missing`);
        }
      }
    }
    if (missing.length) throw new Error(missing.join(' | '));
    record('PASS', id, 'both');
  } catch (error) {
    record('FAIL', id, 'both', error.message.split('\n')[0]);
  }
}

// ---- P case: byte parity -------------------------------------------------------------------------------------------

{
  const id = 'case-p1:doc-check-byte-parity';
  try {
    const digest = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
    same(digest(path.join(LEGS[1].dir, MODULE)), digest(path.join(LEGS[0].dir, MODULE)), 'sha256 doc-check.js source = packaged');
    record('PASS', id, 'both');
  } catch (error) {
    record('FAIL', id, 'both', error.message.split('\n')[0]);
  }
}

// ---- Mutation probes (run with --mutation-probes once the suite is GREEN) -------------------------------------------
// Both probes apply their mutation to a tmp copy of the source scripts, rerun the case assertion against the copy,
// and expect the assertion to throw (the mutation must be detected).

function scriptCopy(prefix) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tmpDirs.push(dir);
  fs.cpSync(LEGS[0].dir, dir, { recursive: true });
  return dir;
}

// MP1: flip the strict trigger (>) to >=; case R1 (exact 50%) must then fail.
// ProbeApplyError extends the probe set and applyMutation; only doc-check.js is mutated.
class ProbeApplyError extends Error {}

// Each probe edits one guard by a unique substring locator. 0 or 2+ matches → "did not apply", never a guess.
function applyMutation(dir, needle, replacement, label) {
  const file = path.join(dir, MODULE);
  const original = fs.readFileSync(file, 'utf8');
  const occurrences = original.split(needle).length - 1;
  if (occurrences !== 1) throw new ProbeApplyError(`locator "${needle}" (${label}) matched ${occurrences} lines; probe did not apply`);
  fs.writeFileSync(file, original.replace(needle, replacement));
}

function mp1Apply() {
  const dir = scriptCopy('f2 doc craft mp1 ');
  const file = path.join(dir, MODULE);
  const original = fs.readFileSync(file, 'utf8');
  const lines = original.split('\n');
  const hits = lines.map((text, index) => ({ text, index }))
    .filter(({ text }) => /\b2\s*\*\s*\w/.test(text) && !/=\s*2\s*\*/.test(text) && />/.test(text) && !/>=/.test(text));
  if (hits.length !== 1) throw new ProbeApplyError(`could not uniquely locate the > trigger line (${hits.length} candidates); update this probe for the green shape`);
  const { text, index } = hits[0];
  lines[index] = text.replace('>', '>=');
  fs.writeFileSync(file, lines.join('\n'));
  return dir;
}

function mp1Assert(dir) {
  const ws = makeWorkspace(REFERENCE());
  writeDoc(ws, 'docs/x.md', refDoc('# Title\n\nOnly prose line.\n'));
  const result = runCheck(dir, { workspace: ws, config: CONFIG, args: ['--changed-path', 'docs/x.md'] });
  // The R1 assertion: with >=, 2*1 >= 2 triggers and must violate the empty-reminders contract.
  const out = jsonOut(result);
  same(out.reminders, [], 'reminders (mutated >= must violate this)');
}

// MP2: force exit 1 whenever any reminder exists; case R13 (high prose, valid doc) must then fail.
function mp2Apply() {
  const dir = scriptCopy('f2 doc craft mp2 ');
  const file = path.join(dir, MODULE);
  const original = fs.readFileSync(file, 'utf8');
  const emitMatches = [...original.matchAll(/return emit\(result[^;]*\);/g)];
  if (emitMatches.length !== 1) throw new ProbeApplyError(`could not uniquely locate the final emit (${emitMatches.length} candidates); update this probe for the green shape`);
  const injected = `if (result.reminders && result.reminders.length) return emit(result, 1);\n  ${emitMatches[0][0]}`;
  fs.writeFileSync(file, original.replace(emitMatches[0][0], injected));
  return dir;
}

function mp2Assert(dir) {
  const ws = makeWorkspace(REFERENCE());
  writeDoc(ws, 'docs/x.md', refDoc('# Title\n\nIntro prose sentence.\n\n**Problem:** More\n\nAnd another plain sentence.\n'));
  const result = runCheck(dir, { workspace: ws, config: CONFIG, args: ['--changed-path', 'docs/x.md'] });
  // The R13 assertion: the mutated forced failure must flip exit 0 to 1.
  same(result.status, 0, 'exit (mutated forced failure must violate this)');
}

// MP3: drop the role === 'reference' guard; case R15 (prd/adr high prose) must then fail.
function mp3Apply() {
  const dir = scriptCopy('f2 doc craft mp3 ');
  applyMutation(dir, "doc.role !== 'reference' || ", '', 'R15 role guard');
  return dir;
}

function mp3Assert(dir) {
  caseR15(dir);
}

// MP4: drop the legacy guard; case R16 (legacy governed reference) must then fail.
function mp4Apply() {
  const dir = scriptCopy('f2 doc craft mp4 ');
  applyMutation(dir, ' || doc.legacy', '', 'R16 legacy guard');
  return dir;
}

function mp4Assert(dir) {
  caseR16(dir);
}

// MP5: also push the reminders into lint.diagnostics; case R17 must then fail.
function mp5Apply() {
  const dir = scriptCopy('f2 doc craft mp5 ');
  applyMutation(dir, 'diagnostics: analysis.diagnostics',
    "diagnostics: analysis.diagnostics.concat(reminders.map(item => ({ ...item, severity: 'error' })))",
    'R17 reminders-never-diagnostics');
  return dir;
}

function mp5Assert(dir) {
  caseR17(dir);
}

// MP6: drop the doc.error guard; case R18 (malformed frontmatter) must then fail.
function mp6Apply() {
  const dir = scriptCopy('f2 doc craft mp6 ');
  applyMutation(dir, ' || doc.error', '', 'R18 doc.error guard');
  return dir;
}

function mp6Assert(dir) {
  caseR18(dir);
}

if (process.argv.includes('--mutation-probes')) {
  for (const leg of LEGS) {
    for (const [id, apply, assertFn] of [
      ['mp1:threshold-ge-mutation-detected-by-r1', mp1Apply, mp1Assert],
      ['mp2:forced-exit-mutation-detected-by-r13', mp2Apply, mp2Assert],
      ['mp3:role-guard-mutation-detected-by-r15', mp3Apply, mp3Assert],
      ['mp4:legacy-guard-mutation-detected-by-r16', mp4Apply, mp4Assert],
      ['mp5:reminder-in-diagnostics-mutation-detected-by-r17', mp5Apply, mp5Assert],
      ['mp6:doc-error-guard-mutation-detected-by-r18', mp6Apply, mp6Assert]
    ]) {
      // A probe PASSES when the case assertion throws on the mutant (mutation detected).
      let dir;
      try { dir = apply(); } catch (error) {
        record('FAIL', id, leg.name, `probe did not apply: ${error.message.split('\n')[0]}`);
        continue;
      }
      try { assertFn(dir); record('FAIL', id, leg.name, 'mutation survived — the case passed on the mutant'); } catch (error) {
        record('PASS', id, leg.name, `mutation detected: ${error.message.split('\n')[0]}`);
      }
    }
  }
}

// ---- Summary -------------------------------------------------------------------------------------------------------

console.log(`\nF2 doc-craft summary: ${passed} PASS, ${failed} FAIL, ${skipped} SKIP${failed ? `\nFAILED assertions (${failures.length}):\n  ${failures.join('\n  ')}` : ''}${failed === 0 && skipped > 0 ? ' (skips are environment-gated cases only)' : ''}`);

for (const dir of tmpDirs) {
  try { removeTree(dir); } catch { /* tmp leftovers are harmless */ }
}

process.exitCode = failed > 0 ? 1 : 0;
