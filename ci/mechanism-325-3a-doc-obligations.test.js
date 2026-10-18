'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const helper = require('./test-helper');

const modulePath = path.join(__dirname, '..', 'harness-everything', 'scripts', 'doc-obligations.js');
const fixtureDir = path.join(__dirname, 'fixtures', 'doc-obligations', 'derive');
let deriveDocFacts;
let deriveDocObligations;
try {
  ({ deriveDocFacts, deriveDocObligations } = require(modulePath));
} catch (error) {
  helper.check('325-3a. derive module is available', false, error.message);
}

console.log('\n[325-3a] doc-change obligation derivation (RED)...');

// Full catalog of doc-change obligation capabilities, with the default strength.
// Every case returns one entry per capability; applicability says whether it is
// triggered. Entries that are not triggered carry applicability "N/A".
const CATALOG = Object.freeze({
  'doc-lint': 'MUST',
  'link-check': 'MUST',
  'update-over-create': 'SHOULD',
  'outline-confirmation': 'MUST',
  'derived-regenerate': 'MUST',
  'quality-review': 'MUST',
  'conflict-check': 'MUST',
  'prose-reminder': 'SHOULD',
  'requirement-sync': 'MUST'
});

const CONFIG = JSON.parse(fs.readFileSync(path.join(fixtureDir, 'config.json'), 'utf8'));

function readTree(root) {
  const files = {};
  if (!fs.existsSync(root)) return files;
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else files[path.relative(root, full).split(path.sep).join('/')] = fs.readFileSync(full, 'utf8');
    }
  };
  walk(root);
  return files;
}

function loadCase(name) {
  const caseDir = path.join(fixtureDir, name);
  return { base: { files: readTree(path.join(caseDir, 'base')) }, candidate: { files: readTree(path.join(caseDir, 'candidate')) } };
}

// A case may carry its own config.json (used by the derived-view controls); other cases use the shared config.
function caseConfig(name) {
  const own = path.join(fixtureDir, name, 'config.json');
  return fs.existsSync(own) ? JSON.parse(fs.readFileSync(own, 'utf8')) : CONFIG;
}

function deriveCase(name) {
  const input = loadCase(name);
  const result = deriveDocFacts({ base: input.base, candidate: input.candidate, config: caseConfig(name) });
  const obligations = deriveDocObligations(result.facts);
  return { result, obligations };
}

// expected: { applicable: [...], unknown: [...], strength: { capability: 'MUST'|'SHOULD' } }
// Capabilities not listed in applicable/unknown must come back as N/A.
function assertCase(name, expected) {
  const { obligations } = deriveCase(name);
  assert.strictEqual(obligations.length, Object.keys(CATALOG).length, `${name}: one entry per catalog capability`);

  const ids = obligations.map(item => item.id);
  assert.strictEqual(new Set(ids).size, ids.length, `${name}: obligation ids are unique`);
  for (const item of obligations) {
    assert.ok(typeof item.id === 'string' && item.id.length > 0, `${name}: id is non-empty`);
    assert.ok(Array.isArray(item.scope?.paths) && (item.applicability === 'N/A' || item.scope.paths.length > 0), `${name}: ${item.capability} scope.paths is an array, non-empty unless N/A`);
    assert.ok(typeof item.acceptance === 'string' && item.acceptance.length > 0, `${name}: ${item.capability} acceptance is non-empty`);
  }

  const byCapability = new Map(obligations.map(item => [item.capability, item]));
  const applicable = new Set(expected.applicable || []);
  const unknown = new Set(expected.unknown || []);
  for (const capability of Object.keys(CATALOG)) {
    const item = byCapability.get(capability);
    assert.ok(item, `${name}: catalog capability ${capability} is present`);
    const want = applicable.has(capability) ? 'applicable' : unknown.has(capability) ? 'unknown' : 'N/A';
    assert.strictEqual(item.applicability, want, `${name}: ${capability} applicability`);
    if (want !== 'N/A') {
      const strength = (expected.strength && expected.strength[capability]) || CATALOG[capability];
      assert.strictEqual(item.strength, strength, `${name}: ${capability} strength`);
    }
  }
}

function checkCase(name, run) {
  try {
    run();
    helper.check(name, true);
  } catch (error) {
    helper.check(name, false, error && error.message ? error.message : String(error));
  }
}

// H4 table cases. Expectations are written from the spec (D5 obligations table,
// D6.5 diff-fact matrix, D6.6 requirement-sync rules), not from an implementation.

checkCase('325-3a H4 docs-only: lint, links and prose reminder; requirement-sync not forced (no TDD)', () => {
  assertCase('docs-only', { applicable: ['doc-lint', 'link-check', 'prose-reminder'] });
});

checkCase('325-3a H4 mixed docs + code with REQ-citing test: requirement-sync is applicable', () => {
  assertCase('mixed-docs-code', { applicable: ['doc-lint', 'link-check', 'prose-reminder', 'requirement-sync'] });
});

checkCase('325-3a H4 tagged test change (REQ-citing, assertion changed): requirement-sync candidate signal', () => {
  assertCase('tagged-test', { applicable: ['requirement-sync'] });
});

checkCase('325-3a H4 typo-only in ADR Context: non-normative, only lint and links', () => {
  assertCase('typo-context', { applicable: ['doc-lint', 'link-check'] });
});

checkCase('325-3a H4 typo in ADR Decision: normative, adds quality review and conflict check', () => {
  assertCase('typo-decision', { applicable: ['doc-lint', 'link-check', 'quality-review', 'conflict-check'] });
});

checkCase('325-3a H4 code-only uncertainty: requirement-sync unknown, never trivial', () => {
  assertCase('code-only', { unknown: ['requirement-sync'] });
});

checkCase('325-3a H4 missing approval: normative PRD REQ change keeps quality review MUST applicable', () => {
  assertCase('missing-approval', { applicable: ['doc-lint', 'link-check', 'quality-review', 'conflict-check'] });
});

checkCase('325-3a untracked new PRD: outline confirmation is MUST for PRD, plus normative checks', () => {
  assertCase('new-prd', {
    applicable: ['doc-lint', 'link-check', 'update-over-create', 'outline-confirmation', 'quality-review', 'conflict-check'],
    strength: { 'outline-confirmation': 'MUST' }
  });
});

checkCase('325-3a untracked new reference doc: outline confirmation is only SHOULD outside PRD/ADR', () => {
  assertCase('new-reference', {
    applicable: ['doc-lint', 'link-check', 'update-over-create', 'outline-confirmation', 'prose-reminder'],
    strength: { 'outline-confirmation': 'SHOULD' }
  });
});

checkCase('325-3a rename with identical content: not a new file, lint and links only', () => {
  assertCase('rename', { applicable: ['doc-lint', 'link-check'] });
});

checkCase('325-3a rename is reported in provenance as a move, not as separate add and delete', () => {
  const { result } = deriveCase('rename');
  const provenance = JSON.stringify(result.provenance);
  assert.ok(/rename/i.test(provenance), `provenance records a rename: ${provenance}`);
  assert.ok(provenance.includes('docs/reference/old-guide.md') && provenance.includes('docs/reference/guide.md'),
    `provenance cites both rename endpoints: ${provenance}`);
});

checkCase('325-3a deletion of an accepted ADR (base-only path): removed Decision is normative', () => {
  assertCase('deleted-adr', { applicable: ['doc-lint', 'link-check', 'quality-review', 'conflict-check'] });
});

checkCase('325-3a unknown normative section keeps triggered checks, never trivial', () => {
  assertCase('unknown-adr', {
    applicable: ['doc-lint', 'link-check'],
    unknown: ['quality-review', 'conflict-check']
  });
});

checkCase('325-3a derivation is deterministic and does not mutate its inputs', () => {
  const input = loadCase('mixed-docs-code');
  const snapshot = JSON.stringify(input);
  const first = deriveDocFacts({ base: input.base, candidate: input.candidate, config: CONFIG });
  const second = deriveDocFacts({ base: input.base, candidate: input.candidate, config: CONFIG });
  assert.deepStrictEqual(second, first, 'same inputs produce the same facts and provenance');
  assert.deepStrictEqual(deriveDocObligations(first.facts), deriveDocObligations(second.facts), 'same facts produce the same obligations');
  assert.strictEqual(JSON.stringify(input), snapshot, 'inputs are not mutated');
});

// Round 2 (§9A, §9B, §9C). Derivation expectations only; evidence is in the cross and evidence suites.

checkCase('325-3a acceptance-only edit under a final REQ nested #### Acceptance: quality-review and conflict-check applicable', () => {
  assertCase('acceptance-only', { applicable: ['doc-lint', 'link-check', 'quality-review', 'conflict-check'] });
});

checkCase('325-3a unchanged REQ with nested acceptance plus an unrelated Context typo: lint and links only', () => {
  assertCase('req-context-typo', { applicable: ['doc-lint', 'link-check'] });
});

checkCase('325-3a requirement-sync scope names the cited PRD and the REQ-citing test (§9A)', () => {
  const { obligations } = deriveCase('req-revision');
  const item = obligations.find(o => o.capability === 'requirement-sync');
  assert.ok(item, 'requirement-sync is in the catalog');
  assert.strictEqual(item.applicability, 'applicable', 'a REQ-citing test change triggers requirement-sync');
  assert.ok(item.scope.paths.includes('docs/prd/graph.md'), `scope names the PRD holding the cited REQ: ${item.scope.paths}`);
  assert.ok(item.scope.paths.includes('ci/mechanism-lint.test.js'), `scope names the REQ-citing test: ${item.scope.paths}`);
});

checkCase('325-3a requirement-sync scope names the REQ-citing test for a tagged-test-only change (§9A)', () => {
  const { obligations } = deriveCase('tagged-test');
  const item = obligations.find(o => o.capability === 'requirement-sync');
  assert.ok(item.scope.paths.includes('ci/mechanism-lint.test.js'), `scope names the test: ${item.scope.paths}`);
});

checkCase('325-3a one changed source feeding two derived views: derived-regenerate scope names both outputs (§9C)', () => {
  const { obligations } = deriveCase('derived-two-outputs');
  const item = obligations.find(o => o.capability === 'derived-regenerate');
  assert.ok(item, 'derived-regenerate is in the catalog');
  assert.strictEqual(item.applicability, 'applicable', 'a changed derived source triggers regeneration');
  assert.strictEqual(item.strength, 'MUST');
  assert.ok(item.scope.paths.includes('docs/index.md'), `scope names the first declared output: ${item.scope.paths}`);
  assert.ok(item.scope.paths.includes('docs/model-summary.md'), `scope names the second declared output: ${item.scope.paths}`);
});

// Round 3 (final review round 2, finding 1): heading clauses are part of the REQ's normative
// identity. The parser output (validClause, replaces, aliases) must reach the normative comparison.

checkCase('325-3a replacement target changed (REQ-GRPH-012 -> REQ-GRPH-013), id/title/body unchanged: quality-review and conflict-check applicable', () => {
  assertCase('replacement-target', { applicable: ['doc-lint', 'link-check', 'quality-review', 'conflict-check'] });
});

checkCase('325-3a alias-only clause change (aliases REQ-GRAPH-020 -> REQ-GRAPH-021), body unchanged: quality-review and conflict-check applicable', () => {
  assertCase('alias-only', { applicable: ['doc-lint', 'link-check', 'quality-review', 'conflict-check'] });
});

checkCase('325-3a invalid replacement clause stays visible: uninterpretable clause is unknown, not equal to a valid unchanged clause', () => {
  // Parser output for the candidate: validClause false, replaces [] (see doc-lifecycle.js parseRequirementBlocks).
  // A fact that cannot be determined keeps its triggered checks as unknown (D6.5), never N/A.
  assertCase('invalid-clause', {
    applicable: ['doc-lint', 'link-check'],
    unknown: ['quality-review', 'conflict-check']
  });
});

checkCase('325-3a control: identical replacement clause and body plus an unrelated Context typo: lint and links only', () => {
  assertCase('clause-context-typo', { applicable: ['doc-lint', 'link-check'] });
});

helper.finish();
