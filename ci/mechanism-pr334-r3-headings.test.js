'use strict';

// PR #334 round 3 — heading boundary regressions in section extraction.
//
// extractSection in doc-obligations.js recognized only column-zero ATX headings. A
// CommonMark-valid Decision headings indented 1..3 spaces were invisible, so a real
// Decision edit reported quality-review and conflict-check N/A. Related boundary
// controls cover Setext Decision headings and tab-indented fence lookalikes.
//
// Authoritative rule: https://spec.commonmark.org/0.31.2/#atx-headings
//   * 0-3 ASCII spaces of indentation, then 1-6 "#", then a space/tab or end of line;
//   * 4 spaces or a leading tab is code indentation, not a heading;
//   * a closing sequence must be preceded by a space/tab.
//
// Scope is bounded to Decision section boundaries. This is not a CommonMark parser.
// Fence and code boundaries are exercised as regression controls.
//
// Every case runs the full deriveDocFacts -> deriveDocObligations pipeline. Expectations
// come from the spec and the D6.5 normative-change rule, not from the implementation.

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const helper = require('./test-helper');

const modulePath = path.join(__dirname, '..', 'harness-everything', 'scripts', 'doc-obligations.js');
const fixtureDir = path.join(__dirname, 'fixtures', 'doc-obligations', 'derive');
const CONFIG = JSON.parse(fs.readFileSync(path.join(fixtureDir, 'config.json'), 'utf8'));
const ADR = 'docs/adr/GRPH-007.md';

let deriveDocFacts;
let deriveDocObligations;
try {
  ({ deriveDocFacts, deriveDocObligations } = require(modulePath));
} catch (error) {
  helper.check('pr334-r3-headings. derive module is available', false, error.message);
}

console.log('\n[pr334-r3-headings] ATX heading indentation in Decision section extraction...');

function readFixture(caseName, side, file = 'GRPH-007.md') {
  return fs.readFileSync(path.join(fixtureDir, caseName, side, 'docs', 'adr', file), 'utf8');
}

// Existing typo-decision fixture: one Decision body word changes "lint" -> "lnt".
const TYPO_BASE = readFixture('typo-decision', 'base');
const TYPO_CANDIDATE = readFixture('typo-decision', 'candidate');

function adr(body) {
  return ['---', 'id: GRPH-007', 'role: adr', 'status: accepted', '---', '# GRPH-007 Lint first', '', body, ''].join('\n');
}

function replaceOnce(text, from, to) {
  assert.strictEqual(text.split(from).length, 2, `fixture text contains exactly one "${from}"`);
  return text.replace(from, to);
}

function indentDecision(text, prefix) {
  return replaceOnce(text, '## Decision', `${prefix}## Decision`);
}

function applicability(base, candidate, file = ADR) {
  const result = deriveDocFacts({
    base: { files: { [file]: base } },
    candidate: { files: { [file]: candidate } },
    config: CONFIG
  });
  const obligations = deriveDocObligations(result.facts);
  return new Map(obligations.map(item => [item.capability, item.applicability]));
}

// The normative capabilities must agree with each other; doc-lint and link-check always apply to a governed edit.
function assertDecisionEdit(name, base, candidate, want, file = ADR) {
  const map = applicability(base, candidate, file);
  assert.strictEqual(map.get('doc-lint'), 'applicable', `${name}: doc-lint`);
  assert.strictEqual(map.get('link-check'), 'applicable', `${name}: link-check`);
  assert.strictEqual(map.get('quality-review'), want, `${name}: quality-review`);
  assert.strictEqual(map.get('conflict-check'), want, `${name}: conflict-check`);
}

function checkCase(name, run) {
  try {
    run();
    helper.check(name, true);
  } catch (error) {
    helper.check(name, false, error && error.message ? error.message : String(error));
  }
}

// Matrix 1: indentation of the real Decision heading. 0-3 spaces are headings; 4 spaces and a leading tab are code.
for (const [label, prefix] of [['0 spaces', ''], ['1 space', ' '], ['2 spaces', '  '], ['3 spaces', '   ']]) {
  checkCase(`pr334-r3 indent matrix: Decision heading with ${label} is a heading; Decision edit is normative`, () => {
    assertDecisionEdit(label, indentDecision(TYPO_BASE, prefix), indentDecision(TYPO_CANDIDATE, prefix), 'applicable');
  });
}

for (const [label, prefix] of [['4 spaces', '    '], ['a leading tab', '\t']]) {
  checkCase(`pr334-r3 indent matrix: Decision heading with ${label} is code, not a heading; the edit is non-normative`, () => {
    assertDecisionEdit(label, indentDecision(TYPO_BASE, prefix), indentDecision(TYPO_CANDIDATE, prefix), 'N/A');
  });
}

// Matrix 2: fences. Existing fixtures keep their behavior; an indented fenced fake heading stays ignored.
for (const caseName of ['decision-fence-backtick', 'decision-fence-tilde']) {
  checkCase(`pr334-r3 fence control: ${caseName} fixture still treats the real Decision as normative`, () => {
    assertDecisionEdit(caseName, readFixture(caseName, 'base', 'GRPH-010.md'), readFixture(caseName, 'candidate', 'GRPH-010.md'), 'applicable', 'docs/adr/GRPH-010.md');
  });
}

checkCase('pr334-r3 fence: a 3-space indented fenced "## Decision" is ignored; the real Decision edit stays applicable (not unknown)', () => {
  const base = adr('## Context\n\nWe need lint.\n\n   ```md\n  ## Decision\n   ```\n\n## Decision\n\nRun lint first.');
  const candidate = base.replace('Run lint first.', 'Run lnt first.');
  assertDecisionEdit('indented fence', base, candidate, 'applicable');
});

checkCase('pr334-r3 fence: an indented tilde fence does not hide the following 3-space Decision heading', () => {
  const base = adr('## Context\n\nWe need lint.\n\n   ~~~md\n# Example\n   ~~~\n\n   ## Decision\n\nRun lint first.');
  const candidate = base.replace('Run lint first.', 'Run lnt first.');
  assertDecisionEdit('indented tilde fence', base, candidate, 'applicable');
});

checkCase('pr334-r3 fence: a tab-indented fence-looking line does not hide a following Decision heading', () => {
  const base = adr('## Context\n\nWe need lint.\n\n\t```md\n  ## Decision\n\nRun lint first.');
  const candidate = base.replace('Run lint first.', 'Run lnt first.');
  assertDecisionEdit('tab-indented opener', base, candidate, 'applicable');
});

checkCase('pr334-r3 fence: a tab-indented closer inside a real fence does not expose a fake Decision heading', () => {
  const base = adr('## Context\n\nWe need lint.\n\n```md\n  \t```\n## Decision\n\nFake text.\n```\n\n## Decision\n\nRun lint first.');
  const candidate = base.replace('Run lint first.', 'Run lnt first.');
  assertDecisionEdit('tab-indented closer', base, candidate, 'applicable');
});

checkCase('pr334-r3 fence: a backtick in a backtick-fence info string invalidates the opener, so Decision is visible', () => {
  const base = adr(['## Context', '', '```js `', '', '## Decision', '', 'Run lint first.'].join('\n'));
  const candidate = base.replace('Run lint first.', 'Run lnt first.');
  assertDecisionEdit('malformed backtick info', base, candidate, 'applicable');
});

checkCase('pr334-r3 fence: a tilde-fence info string may contain a backtick and still hides its fake Decision', () => {
  const base = adr(['## Context', '', '~~~js `', '## Decision', 'Fake text.', '~~~', '', '## Decision', '', 'Run lint first.'].join('\n'));
  const candidate = base.replace('Run lint first.', 'Run lnt first.');
  assertDecisionEdit('tilde info backtick', base, candidate, 'applicable');
});

checkCase('pr334-r3 setext: a suspected standalone Setext Decision yields unknown, never N/A', () => {
  const base = adr('## Context\n\nWe need lint.\n\nDecision\n--------\n\nRun lint first.');
  const candidate = base.replace('Run lint first.', 'Run lnt first.');
  assertDecisionEdit('Setext Decision', base, candidate, 'unknown');
});

checkCase('pr334-r3 setext: a multiline Setext paragraph ending in "Decision" stays unknown rather than a false Decision section', () => {
  const base = adr('## Context\n\nWe need lint.\n\nContext prose\nDecision\n--------\n\nRun lint first.');
  const candidate = base.replace('Run lint first.', 'Run lnt first.');
  assertDecisionEdit('multiline Setext title', base, candidate, 'unknown');
});

checkCase('pr334-r3 setext: a Setext-looking Decision inside a fence is ignored', () => {
  const base = adr('## Context\n\nWe need lint.\n\n```md\nDecision\n--------\nFake text.\n```\n\n## Decision\n\nRun lint first.');
  const candidate = base.replace('Run lint first.', 'Run lnt first.');
  assertDecisionEdit('Setext in fence', base, candidate, 'applicable');
});

checkCase('pr334-r3 setext: an unsupported Setext boundary inside Decision yields unknown instead of guessing its paragraph scope', () => {
  const base = adr('## Decision\n\nRun lint first.\n\nNext\n---\n\nLater.');
  const candidate = base.replace('Next\n---', 'Next steps\n---');
  assertDecisionEdit('unsupported Setext boundary', base, candidate, 'unknown');
});

checkCase('pr334-r3 thematic break: a rule after the ATX Decision remains inside the section', () => {
  const base = adr('## Decision\n\n---\n\nRun lint first.');
  const candidate = base.replace('Run lint first.', 'Run lnt first.');
  assertDecisionEdit('thematic break after ATX', base, candidate, 'applicable');
});

checkCase('pr334-r3 thematic break: a rule after a fenced block does not turn its closing fence into a Setext heading', () => {
  const base = adr('## Decision\n\n```js\nexample();\n```\n---\nUse A.');
  const candidate = base.replace('Use A.', 'Use B.');
  assertDecisionEdit('thematic break after fence', base, candidate, 'applicable');
});

checkCase('pr334-r3 setext: four-space-indented Setext-looking text is code, not a Decision heading', () => {
  const base = adr('## Context\n\nWe need lint.\n\n    Decision\n    --------\n\nRun lint first.');
  const candidate = base.replace('Run lint first.', 'Run lnt first.');
  assertDecisionEdit('Setext in code', base, candidate, 'N/A');
});

// Matrix 3: section termination and inclusion.
checkCase('pr334-r3 termination: a 3-space subsection (### Consequences) is included in the Decision section', () => {
  const base = adr('   ## Decision\n\nRun lint first.\n\n   ### Consequences\n\nLint is cheap.');
  const candidate = base.replace('Lint is cheap.', 'Lnt is cheap.');
  assertDecisionEdit('subsection', base, candidate, 'applicable');
});

checkCase('pr334-r3 termination: a 3-space same-level heading (## Next) ends the Decision section; an edit there is non-normative', () => {
  const base = adr('   ## Decision\n\nRun lint first.\n\n   ## Next\n\nLint later.');
  const candidate = base.replace('Lint later.', 'Lnt later.');
  assertDecisionEdit('same-level terminator', base, candidate, 'N/A');
});

checkCase('pr334-r3 termination: a 1-space higher-level heading (# Appendix) ends the Decision section; an edit there is non-normative', () => {
  const base = adr('   ## Decision\n\nRun lint first.\n\n # Appendix\n\nLint notes.');
  const candidate = base.replace('Lint notes.', 'Lnt notes.');
  assertDecisionEdit('higher-level terminator', base, candidate, 'N/A');
});

checkCase('pr334-r3 termination: an empty "##" heading line ends the Decision section; an edit after it is non-normative', () => {
  const base = adr('   ## Decision\n\nRun lint first.\n\n##\n\nLint notes.');
  const candidate = base.replace('Lint notes.', 'Lnt notes.');
  assertDecisionEdit('empty terminator', base, candidate, 'N/A');
});

checkCase('pr334-r3 termination: a 4-space indented "## Example" is code and does not end the Decision section', () => {
  const base = adr('   ## Decision\n\nRun lint first.\n\n    ## Example\n\nLint sample.');
  const candidate = base.replace('Lint sample.', 'Lnt sample.');
  assertDecisionEdit('code-indented non-terminator', base, candidate, 'applicable');
});

// Matrix 4: duplicate Decision headings are ambiguous, whatever the indentation.
checkCase('pr334-r3 duplicate: a column-0 Decision plus a 2-space Decision is unknown, never N/A or applicable', () => {
  const base = adr('## Decision\n\nRun lint first.\n\n  ## Decision\n\nOther.');
  const candidate = base.replace('Run lint first.', 'Run lnt first.');
  assertDecisionEdit('duplicate', base, candidate, 'unknown');
});

// Matrix 5: closing sequences and separators, per the ATX rule. Only space/tab separators and preceding-space closings count.
checkCase('pr334-r3 closing: a 2-space "## Decision ##" closing sequence is the Decision heading', () => {
  const base = adr('  ## Decision ##\n\nRun lint first.');
  const candidate = base.replace('Run lint first.', 'Run lnt first.');
  assertDecisionEdit('closing', base, candidate, 'applicable');
});

checkCase('pr334-r3 closing: "## Decision#" has no preceding space, so the title is "Decision#" and Decision is absent', () => {
  const base = adr('## Decision#\n\nRun lint first.');
  const candidate = base.replace('Run lint first.', 'Run lnt first.');
  assertDecisionEdit('glued hash', base, candidate, 'N/A');
});

checkCase('pr334-r3 separator: a tab after the hashes ("##\\tDecision") is a valid separator', () => {
  const base = adr('##\tDecision\n\nRun lint first.');
  const candidate = base.replace('Run lint first.', 'Run lnt first.');
  assertDecisionEdit('tab separator', base, candidate, 'applicable');
});

checkCase('pr334-r3 separator: a no-break space after the hashes is not a CommonMark separator, so it is not a heading', () => {
  const base = adr('## Decision\n\nRun lint first.');
  const candidate = base.replace('Run lint first.', 'Run lnt first.');
  assertDecisionEdit('nbsp separator', base, candidate, 'N/A');
});

checkCase('pr334-r3 separator: "##Decision" with no separator is not a heading (control)', () => {
  const base = adr('##Decision\n\nRun lint first.');
  const candidate = base.replace('Run lint first.', 'Run lnt first.');
  assertDecisionEdit('no separator', base, candidate, 'N/A');
});

checkCase('pr334-r3 level: seven hashes is not an ATX heading (control)', () => {
  const base = adr('####### Decision\n\nRun lint first.');
  const candidate = base.replace('Run lint first.', 'Run lnt first.');
  assertDecisionEdit('seven hashes', base, candidate, 'N/A');
});

// Positive control: the column-0 typo-decision fixture is unchanged by this fix.
checkCase('pr334-r3 control: the existing column-0 typo-decision fixture stays normative', () => {
  assertDecisionEdit('typo-decision', TYPO_BASE, TYPO_CANDIDATE, 'applicable');
});

helper.finish();
