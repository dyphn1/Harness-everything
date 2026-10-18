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
  assert.ok(item.scope.paths.includes('docs/prd/graph/r002.md'), `scope names the PRD holding the cited REQ: ${item.scope.paths}`);
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

// Round 4 (§10, owner choice b): derivation exposes assertionChanged and inventoryComplete.
// assertionChanged is pure text analysis of REQ-citing test changes; inventoryComplete is caller-asserted only.

function factsWithInventory(name, inventory) {
  const input = loadCase(name);
  return deriveDocFacts({ base: input.base, candidate: input.candidate, config: caseConfig(name), ...(inventory ? { inventory } : {}) });
}

checkCase('325-3a assertion edit in a REQ-citing test: facts.assertionChanged is true (§10)', () => {
  const { facts } = factsWithInventory('tagged-test');
  assert.strictEqual(facts.assertionChanged, true, 'an assert line changed in the REQ-citing test');
});

checkCase('325-3a comment-only edit in a REQ-citing test: facts.assertionChanged is false (§10)', () => {
  const { facts } = factsWithInventory('comment-only-test');
  assert.strictEqual(facts.assertionChanged, false, 'only the comment line changed; no assertion line did');
});

checkCase('325-3a requirement-sync obligation carries assertionChanged and inventoryComplete (complete inventory supplied) (§10)', () => {
  const { facts } = factsWithInventory('tagged-test', { complete: true });
  const item = deriveDocObligations(facts).find(o => o.capability === 'requirement-sync');
  assert.ok(item, 'requirement-sync is in the catalog');
  assert.strictEqual(item.assertionChanged, true, 'obligation carries assertionChanged');
  assert.strictEqual(item.inventoryComplete, true, 'obligation carries the caller-asserted inventory completeness');
});

checkCase('325-3a inventory omitted: facts.inventoryComplete and requirement-sync inventoryComplete are false (§10)', () => {
  const { facts } = factsWithInventory('tagged-test');
  assert.strictEqual(facts.inventoryComplete, false, 'omitted inventory defaults to incomplete');
  const item = deriveDocObligations(facts).find(o => o.capability === 'requirement-sync');
  assert.strictEqual(item.inventoryComplete, false, 'the obligation inherits incomplete inventory');
});

// Round 5 (PR #334 review R1-R3). Derivation expectations only.

// R1: section extraction must be fence-aware. A "# Example" line inside a fenced block is not a heading,
// so an edit to real Decision text after the fence is a normative change.
checkCase('325-3a R1 backtick fence: a fenced "# Example" line does not truncate ADR Decision; Decision edit is normative', () => {
  assertCase('decision-fence-backtick', { applicable: ['doc-lint', 'link-check', 'quality-review', 'conflict-check'] });
});

checkCase('325-3a R1 tilde fence: a fenced "# Example" line does not truncate ADR Decision; Decision edit is normative', () => {
  assertCase('decision-fence-tilde', { applicable: ['doc-lint', 'link-check', 'quality-review', 'conflict-check'] });
});

// R2: a content-identical path-only rename of a declared derived source is a dependency change.
checkCase('325-3a R2 rename-only of a declared derived source: derived-regenerate applicable, scoped to the output docs/index.md', () => {
  const { obligations } = deriveCase('derived-rename');
  const item = obligations.find(o => o.capability === 'derived-regenerate');
  assert.strictEqual(item.applicability, 'applicable', 'a rename of a derived source triggers regeneration');
  assert.deepStrictEqual(item.scope.paths, ['docs/index.md'], 'scope is the declared output only');
});

// R3: a REQ-citing test triggers requirement-sync only through a changed assertion or a new REQ-tagged test.
checkCase('325-3a R3 comment-only edit in a REQ-citing test: requirement-sync is N/A', () => {
  const { obligations } = deriveCase('comment-only-test');
  assert.strictEqual(obligations.find(o => o.capability === 'requirement-sync').applicability, 'N/A',
    'a comment-only edit is not an assertion change');
});

checkCase('325-3a R3 whitespace-only edit in a REQ-citing test: requirement-sync is N/A', () => {
  const { obligations } = deriveCase('whitespace-only-test');
  assert.strictEqual(obligations.find(o => o.capability === 'requirement-sync').applicability, 'N/A',
    'a whitespace-only edit is not an assertion change');
});

checkCase('325-3a R3 control: assertion changed in a REQ-citing test: requirement-sync applicable', () => {
  const { obligations } = deriveCase('tagged-test');
  assert.strictEqual(obligations.find(o => o.capability === 'requirement-sync').applicability, 'applicable');
});

checkCase('325-3a R3 control: new REQ-tagged test file: requirement-sync applicable', () => {
  const { obligations } = deriveCase('new-req-test');
  assert.strictEqual(obligations.find(o => o.capability === 'requirement-sync').applicability, 'applicable',
    'a new REQ-citing test is a trigger');
});

checkCase('325-3a R3 undetermined: a REQ-citing test that cannot be read as text gives assertionChanged unknown and requirement-sync unknown', () => {
  const input = loadCase('tagged-test');
  input.candidate.files['ci/mechanism-lint.test.js'] = null; // not readable as text
  const { facts } = deriveDocFacts({ base: input.base, candidate: input.candidate, config: CONFIG });
  assert.strictEqual(facts.assertionChanged, 'unknown', 'an undeterminable assertion change is unknown');
  const item = deriveDocObligations(facts).find(o => o.capability === 'requirement-sync');
  assert.strictEqual(item.applicability, 'unknown', 'requirement-sync stays unknown, never N/A or trivial');
});

// Round 6 (Sol round-3 review). Derivation expectations only.
// F1: current resolution authority comes only from the candidate PRD set. The exact resolution labels are
// not pinned here; the invariant is that a cited REQ which is not uniquely resolved in the candidate has no file.

function citedEntries(facts, id) {
  return facts.citedReqs.filter(entry => entry && entry.id === id);
}

checkCase('325-3a F1 duplicate cited ID across two current PRDs: cited REQ is not resolved (file null) (round 6)', () => {
  const { result } = deriveCase('dup-req-id');
  const entries = citedEntries(result.facts, 'REQ-GRPH-001');
  assert.ok(entries.length > 0, 'the cited id is reported');
  assert.ok(entries.every(entry => entry.file === null), `ambiguous id has no file: ${JSON.stringify(entries)}`);
});

checkCase('325-3a F1 malformed current PRD over a valid base: no base fallback, cited REQ not resolved (file null) (round 6)', () => {
  const { result } = deriveCase('malformed-prd');
  const entries = citedEntries(result.facts, 'REQ-GRPH-001');
  assert.ok(entries.length > 0, 'the cited id is reported');
  assert.ok(entries.every(entry => entry.file === null), `a parse error is not authority from the base: ${JSON.stringify(entries)}`);
});

checkCase('325-3a F1 PRD deleted in the candidate, base still declares it: cited REQ not resolved (file null) (round 6)', () => {
  const { result } = deriveCase('deleted-prd');
  const entries = citedEntries(result.facts, 'REQ-GRPH-001');
  assert.ok(entries.length > 0, 'the cited id is reported');
  assert.ok(entries.every(entry => entry.file === null), `a base-only declaration is not current authority: ${JSON.stringify(entries)}`);
});

checkCase('325-3a F1 control: uniquely declared unchanged current PRD: cited REQ resolves to that file', () => {
  const { result } = deriveCase('assertion-no-revision');
  const entries = citedEntries(result.facts, 'REQ-GRPH-001');
  assert.deepStrictEqual(entries.map(entry => entry.file), ['docs/prd/graph.md'], 'one current declaration resolves');
});

// F3: assertion detection is literal-aware. Whitespace inside string, template or regex literals is content.
// Formatting outside literals and trailing comments are not assertion changes.

for (const name of ['literal-whitespace-assert', 'template-literal-whitespace', 'regex-literal-whitespace']) {
  checkCase(`325-3a F3 whitespace inside a literal (${name}) is content: assertionChanged is not false, requirement-sync not N/A`, () => {
    const { result, obligations } = deriveCase(name);
    assert.notStrictEqual(result.facts.assertionChanged, false, `a literal change is not formatting: ${result.facts.assertionChanged}`);
    assert.notStrictEqual(obligations.find(o => o.capability === 'requirement-sync').applicability, 'N/A',
      'a literal change is not N/A');
  });
}

checkCase('325-3a F3 trailing-comment-only edit after an unchanged assertion: assertionChanged false, requirement-sync N/A', () => {
  const { result, obligations } = deriveCase('trailing-comment-test');
  assert.strictEqual(result.facts.assertionChanged, false, 'only the trailing comment changed');
  assert.strictEqual(obligations.find(o => o.capability === 'requirement-sync').applicability, 'N/A');
});

checkCase('325-3a F3 control: formatting outside literals and comments: assertionChanged false, requirement-sync N/A', () => {
  const { result, obligations } = deriveCase('formatting-only-test');
  assert.strictEqual(result.facts.assertionChanged, false, 'spacing outside literals is formatting');
  assert.strictEqual(obligations.find(o => o.capability === 'requirement-sync').applicability, 'N/A');
});

checkCase('325-3a F3 control: numeric assertion edit: assertionChanged true', () => {
  const { result } = deriveCase('tagged-test');
  assert.strictEqual(result.facts.assertionChanged, true, 'a real assertion value changed');
});

// Round 7 (Sol round-4 finding 1): resolution uses the lifecycle's current effective namespace, not every
// candidate declaration. A retained revision chain of ONE logical PRD is not ambiguous. The exact resolution
// label is not pinned for the failure cases; the invariant is file null when the REQ is not current.

checkCase('325-3a R7 retained valid revision chain of one PRD: cited REQ-GRPH-011 resolves uniquely to the current effective revision r002 (round 7)', () => {
  const { result } = deriveCase('retained-revision-chain');
  const entries = citedEntries(result.facts, 'REQ-GRPH-011');
  assert.deepStrictEqual(entries.map(entry => entry.file), ['docs/prd/graph/r002.md'],
    `one current file, the effective revision: ${JSON.stringify(entries)}`);
  assert.ok(entries.every(entry => entry.resolution !== 'ambiguous'), 'a retained revision is not ambiguous');
});

checkCase('325-3a R7 control: the same ID in two DISTINCT current logical PRDs is ambiguous, file null (round 7)', () => {
  const { result } = deriveCase('distinct-logical-prds');
  const entries = citedEntries(result.facts, 'REQ-GRPH-011');
  assert.ok(entries.length > 0, 'the cited id is reported');
  assert.ok(entries.every(entry => entry.file === null), `two distinct current logical PRDs are ambiguous: ${JSON.stringify(entries)}`);
});

checkCase('325-3a R7 historical-only ID: REQ-GRPH-013 exists only in the historical r001 and is removed by the current r002: unresolved, file null (round 7)', () => {
  const { result } = deriveCase('historical-only-req');
  const entries = citedEntries(result.facts, 'REQ-GRPH-013');
  assert.ok(entries.length > 0, 'the cited id is reported');
  assert.ok(entries.every(entry => entry.file === null),
    `a historical or replaced revision is not current authority: ${JSON.stringify(entries)}`);
});

// Round 7 positive-fixture correction (Sol round-5 P2). The req-revision positive is a legal delivery:
// the base effective r001 is retained byte-identical, the candidate keeps r001 unchanged and adds r002.
// The old in-place rewrite of effective r001 is kept only as a named negative, rejected by the lifecycle.

let lifecycle = null;
try {
  lifecycle = require(path.join(__dirname, '..', 'harness-everything', 'scripts', 'doc-lifecycle.js'));
} catch (error) {
  helper.check('325-3a R7 lifecycle module is available', false, error.message);
}

function lifecycleInventory(root) {
  return lifecycle.collectDocs(root, CONFIG).map(doc => ({
    id: doc.frontmatter.id,
    revision: doc.frontmatter.revision,
    path: doc.path,
    status: doc.frontmatter.status,
    bytes: doc.storedBytes
  }));
}

checkCase('325-3a R7 legal positive: the candidate analysis has no error diagnostic and REQ-GRPH-011 resolves to r002 (round 7)', () => {
  const root = path.join(fixtureDir, 'req-revision');
  const docs = lifecycle.collectDocs(path.join(root, 'candidate'), CONFIG);
  const analysis = lifecycle.analyzeDocs(docs, CONFIG, { all: true, baseInventory: lifecycleInventory(path.join(root, 'base')) });
  assert.deepStrictEqual(analysis.diagnostics.filter(item => item.severity === 'error'), [], 'the legal revision has no error diagnostic');
  const resolved = lifecycle.resolveRef(docs, 'REQ-GRPH-011');
  assert.strictEqual(resolved.doc && resolved.doc.path, 'docs/prd/graph/r002.md', 'REQ-GRPH-011 resolves to the current effective revision');
});

checkCase('325-3a R7 named negative: rewriting effective r001 in place is rejected by the lifecycle with immutable-revision-modified (round 7)', () => {
  const root = path.join(fixtureDir, 'req-revision-in-place');
  const docs = lifecycle.collectDocs(path.join(root, 'candidate'), CONFIG);
  const analysis = lifecycle.analyzeDocs(docs, CONFIG, { all: true, baseInventory: lifecycleInventory(path.join(root, 'base')) });
  assert.ok(analysis.diagnostics.some(item => item.code === 'immutable-revision-modified' && item.path === 'docs/prd/graph/r001.md'),
    `the in-place rewrite is an immutable-revision-modified error: ${JSON.stringify(analysis.diagnostics.map(item => item.code))}`);
});

helper.finish();
