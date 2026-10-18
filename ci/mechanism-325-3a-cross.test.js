'use strict';

const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const helper = require('./test-helper');

const derivePath = path.join(__dirname, '..', 'harness-everything', 'scripts', 'doc-obligations.js');
const evidencePath = path.join(__dirname, '..', 'harness-everything', 'scripts', 'doc-evidence.js');
const fixtureDir = path.join(__dirname, 'fixtures', 'doc-obligations', 'derive');
const CONFIG = JSON.parse(fs.readFileSync(path.join(fixtureDir, 'config.json'), 'utf8'));
const GUIDE = 'docs/reference/guide.md';
const ADR = 'docs/adr/GRPH-007.md';

let deriveDocFacts;
let deriveDocObligations;
let checkDocObligations;
try {
  ({ deriveDocFacts, deriveDocObligations } = require(derivePath));
} catch (error) {
  helper.check('325-3a cross. derivation module is available', false, error.message);
}
try {
  ({ checkDocObligations } = require(evidencePath));
} catch (error) {
  helper.check('325-3a cross. evidence module is available', false, error.message);
}

console.log('\n[325-3a cross] derive -> check round trip on H4 fixtures...');

function sha256(text) {
  return crypto.createHash('sha256').update(text).digest('hex');
}

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

// Baseline digest over the whole base tree: a stable digest of the selected baseline.
function treeDigest(files) {
  return sha256(JSON.stringify(Object.keys(files).sort().map(file => [file, files[file]])));
}

// Derive obligations from a fixture case with the real derivation module, then
// build artifacts/baseline from the same fixture. No obligation is hand-built.
// A case may carry its own config.json (used by the derived-view controls); other cases use the shared config.
function caseConfig(name) {
  const own = path.join(fixtureDir, name, 'config.json');
  return fs.existsSync(own) ? JSON.parse(fs.readFileSync(own, 'utf8')) : CONFIG;
}

function prepare(name, inventory) {
  const input = loadCase(name);
  const { facts } = deriveDocFacts({
    base: input.base,
    candidate: input.candidate,
    config: caseConfig(name),
    ...(inventory ? { inventory } : {})
  });
  const obligations = deriveDocObligations(facts);
  const artifacts = {};
  for (const [file, text] of Object.entries(input.candidate.files)) artifacts[file] = { digest: sha256(text) };
  const baseline = { digest: treeDigest(input.base.files) };
  return { input, obligations, artifacts, baseline };
}

// A record bound to the current candidate digests and the baseline digest (§8).
function boundRecord(ctx, id, obligationId, paths, extra) {
  const artifactDigests = {};
  for (const file of paths) artifactDigests[file] = ctx.artifacts[file].digest;
  return {
    id,
    obligationId,
    command: `node ci/mechanism-325-3a-cross.test.js # ${obligationId}`,
    exitCode: 0,
    paths,
    artifactDigests,
    baseDigest: ctx.baseline.digest,
    provenance: 'cross-test fixture record',
    ...(extra || {})
  };
}

function check(ctx, { executionRecords = [], reviewRecords = [] }) {
  return checkDocObligations({
    obligations: ctx.obligations,
    artifacts: ctx.artifacts,
    baseline: ctx.baseline,
    executionRecords,
    reviewRecords
  });
}

function applicableIds(obligations, applicability) {
  return obligations.filter(item => item.applicability === applicability).map(item => item.id).sort();
}

function resultOf(output, obligationId) {
  return output.results.find(item => item.obligationId === obligationId);
}

function assertNoPass(output) {
  assert.strictEqual(JSON.stringify(output.results).includes('"pass"'), false,
    `no result may pass: ${JSON.stringify(output.results)}`);
}

function checkCase(name, run) {
  try {
    run();
    helper.check(name, true);
  } catch (error) {
    helper.check(name, false, error && error.message ? error.message : String(error));
  }
}

// H4 case 1: docs-only, no evidence. The real derived MUSTs must resolve to unresolved.
checkCase('325-3a cross docs-only with no evidence: applicable MUSTs are in a non-observed state (any of the three) and none pass', () => {
  const ctx = prepare('docs-only');
  assert.deepStrictEqual(applicableIds(ctx.obligations, 'applicable'),
    ['doc-change:doc-lint', 'doc-change:link-check', 'doc-change:prose-reminder'], 'docs-only derivation union');
  const output = check(ctx, {});
  for (const item of ctx.obligations.filter(o => o.applicability === 'applicable' && o.strength === 'MUST')) {
    const result = resultOf(output, item.id);
    assert.ok(result, `${item.id} has a result`);
    assert.ok(['unavailable', 'unresolved', 'not-observed'].includes(result.observation),
      `${item.id} observation is a non-observed state, got ${result.observation}`);
    assert.strictEqual(result.outcome, 'none', `${item.id} outcome is none`);
  }
  assertNoPass(output);
});

// Valid evidence control: fresh path-bound observed records for the docs-only MUSTs.
checkCase('325-3a cross docs-only with fresh bound evidence: doc-lint and link-check pass', () => {
  const ctx = prepare('docs-only');
  const output = check(ctx, {
    executionRecords: [
      boundRecord(ctx, 'lint-run', 'doc-change:doc-lint', [GUIDE]),
      boundRecord(ctx, 'links-run', 'doc-change:link-check', [GUIDE])
    ]
  });
  for (const id of ['doc-change:doc-lint', 'doc-change:link-check']) {
    const result = resultOf(output, id);
    assert.ok(result, `${id} has a result`);
    assert.strictEqual(result.observation, 'observed', `${id} is observed`);
    assert.strictEqual(result.outcome, 'pass', `${id} passes on fresh bound evidence`);
  }
});

// H4 case 2: mixed docs + code. The derived union must match the derivation test's expected union.
checkCase('325-3a cross mixed docs+code: derived union matches the derivation expectation, no evidence means no pass', () => {
  const ctx = prepare('mixed-docs-code');
  assert.deepStrictEqual(applicableIds(ctx.obligations, 'applicable'),
    ['doc-change:doc-lint', 'doc-change:link-check', 'doc-change:prose-reminder', 'doc-change:requirement-sync'],
    'mixed docs+code derivation union');
  const output = check(ctx, {});
  for (const id of applicableIds(ctx.obligations, 'applicable')) {
    const item = ctx.obligations.find(o => o.id === id);
    if (item.strength !== 'MUST') continue;
    const result = resultOf(output, id);
    assert.ok(result, `${id} has a result`);
    assert.notStrictEqual(result.observation, 'observed', `${id} is not observed without evidence`);
    assert.strictEqual(result.outcome, 'none', `${id} outcome is none`);
  }
  assertNoPass(output);
});

// H4 case 3: code-only uncertainty. requirement-sync stays not-observed and cannot satisfy a MUST.
checkCase('325-3a cross code-only uncertainty: requirement-sync is not-observed, outcome none, never a pass', () => {
  const ctx = prepare('code-only');
  const item = ctx.obligations.find(o => o.capability === 'requirement-sync');
  assert.ok(item, 'requirement-sync is in the derived catalog');
  assert.strictEqual(item.applicability, 'unknown', 'code-only requirement-sync is unknown');
  assert.strictEqual(item.strength, 'MUST', 'code-only requirement-sync stays MUST');
  assert.deepStrictEqual(item.scope.paths, ['src/lint.js'], 'scope binds the changed code path');
  const output = check(ctx, {});
  const result = resultOf(output, item.id);
  assert.ok(result, 'requirement-sync has a visible result');
  assert.strictEqual(result.observation, 'not-observed', 'code-only uncertainty is not-observed');
  assert.strictEqual(result.outcome, 'none', 'not-observed never satisfies a MUST');
  assertNoPass(output);
});

// H4 case 4: typo-only. Unrelated and stale records must not produce a false pass.
checkCase('325-3a cross typo-only: unrelated obligation record and stale-digest record never produce a pass', () => {
  const ctx = prepare('typo-context');
  assert.deepStrictEqual(applicableIds(ctx.obligations, 'applicable'),
    ['doc-change:doc-lint', 'doc-change:link-check'], 'typo-only derivation union');
  const output = check(ctx, {
    executionRecords: [
      // Correct digest and path, but for an obligation that is not applicable here.
      boundRecord(ctx, 'quality-run', 'doc-change:quality-review', [ADR]),
      // Right obligation, but bound to a digest from a previous candidate text.
      boundRecord(ctx, 'lint-stale', 'doc-change:doc-lint', [ADR], {
        artifactDigests: { [ADR]: sha256('previous candidate text') }
      })
    ]
  });
  const lint = resultOf(output, 'doc-change:doc-lint');
  assert.ok(lint, 'doc-lint has a result');
  assert.notStrictEqual(lint.observation, 'observed', 'the stale record is not an observed match');
  assert.strictEqual(lint.outcome, 'none', 'stale digest cannot pass doc-lint');
  const links = resultOf(output, 'doc-change:link-check');
  assert.ok(links, 'link-check has a result');
  assert.strictEqual(links.outcome, 'none', 'no record for link-check, so none');
  assertNoPass(output);
});

// Round 2 (A): requirement-sync needs a REQ revision with matching evidence, or a
// supported current-bound waiver. A passing command alone never satisfies it (§9A).
function requirementSync(ctx) {
  const item = ctx.obligations.find(o => o.capability === 'requirement-sync');
  assert.ok(item, 'requirement-sync is in the derived catalog');
  return item;
}

function waiverRecord(ctx, id, obligationId, paths, extra) {
  return boundRecord(ctx, id, obligationId, paths, { kind: 'waiver', verdict: 'approve', summary: 'no-req-change', ...(extra || {}) });
}

checkCase('325-3a cross tagged-test-only + passing command + no waiver: requirement-sync is none (§9A)', () => {
  const ctx = prepare('tagged-test');
  const item = requirementSync(ctx);
  const output = check(ctx, { executionRecords: [boundRecord(ctx, 'test-run', item.id, item.scope.paths)] });
  const result = resultOf(output, item.id);
  assert.ok(result, 'requirement-sync has a result');
  assert.strictEqual(result.outcome, 'none', 'a passing test alone cannot satisfy requirement-sync');
});

checkCase('325-3a cross tagged-test-only + passing command + unsupported waiver (empty reason): requirement-sync is none (§9A)', () => {
  const ctx = prepare('tagged-test');
  const item = requirementSync(ctx);
  const output = check(ctx, {
    executionRecords: [boundRecord(ctx, 'test-run', item.id, item.scope.paths)],
    reviewRecords: [waiverRecord(ctx, 'waiver-empty', item.id, item.scope.paths, { reason: '', citedRecordIds: ['test-run'] })]
  });
  const result = resultOf(output, item.id);
  assert.ok(result, 'requirement-sync has a result');
  assert.strictEqual(result.outcome, 'none', 'an unsupported waiver cannot satisfy requirement-sync');
  assert.ok(output.diagnostics.some(d => d.obligationId === item.id && JSON.stringify(d).includes('waiver-empty')),
    'the unsupported waiver is diagnosed by id');
});

checkCase('325-3a cross tagged-test-only + passing command + stale waiver (previous baseline): requirement-sync is none (§9A)', () => {
  const ctx = prepare('tagged-test');
  const item = requirementSync(ctx);
  const output = check(ctx, {
    executionRecords: [boundRecord(ctx, 'test-run', item.id, item.scope.paths)],
    reviewRecords: [waiverRecord(ctx, 'waiver-stale', item.id, item.scope.paths, {
      reason: 'no-req-change: acceptance criteria unchanged',
      citedRecordIds: ['test-run'],
      baseDigest: sha256('previous baseline')
    })]
  });
  const result = resultOf(output, item.id);
  assert.ok(result, 'requirement-sync has a result');
  assert.strictEqual(result.outcome, 'none', 'a waiver bound to a previous baseline cannot satisfy requirement-sync');
  assert.ok(output.diagnostics.some(d => JSON.stringify(d).includes('waiver-stale')), 'the stale waiver is diagnosed by id');
});

checkCase('325-3a cross tagged-test-only + valid current waiver + matching evidence, PRD declares REQ-GRPH-001: requirement-sync passes (§9A, §11 R5)', () => {
  const ctx = prepare('tagged-test-prd');
  const item = requirementSync(ctx);
  const output = check(ctx, {
    executionRecords: [boundRecord(ctx, 'test-run', item.id, item.scope.paths)],
    reviewRecords: [waiverRecord(ctx, 'waiver-current', item.id, item.scope.paths, {
      reason: 'no-req-change: acceptance criteria unchanged, cited passing test',
      citedRecordIds: ['test-run']
    })]
  });
  const result = resultOf(output, item.id);
  assert.ok(result, 'requirement-sync has a result');
  assert.strictEqual(result.observation, 'observed', 'the waiver and its cited record are observed');
  assert.strictEqual(result.outcome, 'pass', 'a valid current waiver with matching evidence passes');
  assert.ok(result.recordRefs.includes('waiver-current'), 'the result cites the waiver');
});

checkCase('325-3a cross genuine REQ revision + matching evidence on every scope path: requirement-sync passes (§9A)', () => {
  const ctx = prepare('req-revision');
  const item = requirementSync(ctx);
  const output = check(ctx, { executionRecords: [boundRecord(ctx, 'req-test-run', item.id, item.scope.paths)] });
  const result = resultOf(output, item.id);
  assert.ok(result, 'requirement-sync has a result');
  assert.strictEqual(result.observation, 'observed');
  assert.strictEqual(result.outcome, 'pass', 'a REQ revised in the same change, with matching evidence, passes');
});

// Round 2 (C): one changed source feeding two declared derived outputs needs both outputs bound (§9C).
checkCase('325-3a cross derived views: source-only evidence cannot satisfy derived-regenerate', () => {
  const ctx = prepare('derived-two-outputs');
  const item = ctx.obligations.find(o => o.capability === 'derived-regenerate');
  assert.ok(item && item.applicability === 'applicable', 'derived-regenerate is applicable');
  const output = check(ctx, { executionRecords: [boundRecord(ctx, 'source-run', item.id, ['src/model.js'])] });
  const result = resultOf(output, item.id);
  assert.ok(result, 'derived-regenerate has a result');
  assert.strictEqual(result.outcome, 'none', 'evidence bound to the source alone cannot regenerate the outputs');
});

checkCase('325-3a cross derived views: one of two declared outputs bound is not enough', () => {
  const ctx = prepare('derived-two-outputs');
  const item = ctx.obligations.find(o => o.capability === 'derived-regenerate');
  const output = check(ctx, { executionRecords: [boundRecord(ctx, 'index-run', item.id, ['docs/index.md'])] });
  const result = resultOf(output, item.id);
  assert.ok(result, 'derived-regenerate has a result');
  assert.strictEqual(result.outcome, 'none', 'the second output has no bound evidence');
});

checkCase('325-3a cross derived views: both declared outputs bound pass derived-regenerate', () => {
  const ctx = prepare('derived-two-outputs');
  const item = ctx.obligations.find(o => o.capability === 'derived-regenerate');
  const output = check(ctx, {
    executionRecords: [boundRecord(ctx, 'regen-run', item.id, ['docs/index.md', 'docs/model-summary.md'])]
  });
  const result = resultOf(output, item.id);
  assert.ok(result, 'derived-regenerate has a result');
  assert.strictEqual(result.observation, 'observed');
  assert.strictEqual(result.outcome, 'pass', 'regeneration bound to both outputs passes');
});

// Round 4 (§10): derive with a complete inventory, then check with no records. The fixture's PRD exists,
// is unchanged, and the REQ-citing test's assertion changed, so the unmet obligation is observed as fail.
// The same fixture without an inventory must not fail.
checkCase('325-3a cross assertion edit, PRD present and unchanged, complete inventory, no records: requirement-sync is observed fail (§10)', () => {
  const ctx = prepare('assertion-no-revision', attestedFor('assertion-no-revision'));
  const item = requirementSync(ctx);
  assert.strictEqual(item.assertionChanged, true, 'derivation reports the assertion change');
  assert.strictEqual(item.inventoryComplete, true, 'derivation carries the complete inventory');
  const output = check(ctx, {});
  const result = resultOf(output, item.id);
  assert.ok(result, 'requirement-sync has a result');
  assert.strictEqual(result.observation, 'observed', 'the unmet obligation is observed');
  assert.strictEqual(result.outcome, 'fail', 'the unmet obligation fails');
  assert.ok(output.diagnostics.some(d => d.code === 'req-sync-no-revision-or-waiver' && d.obligationId === item.id),
    'the failure is diagnosed');
});

checkCase('325-3a cross assertion edit, same fixture with inventory omitted: requirement-sync is not a fail (§10)', () => {
  const ctx = prepare('assertion-no-revision');
  const item = requirementSync(ctx);
  assert.strictEqual(item.inventoryComplete, false, 'omitted inventory is incomplete');
  const output = check(ctx, {});
  const result = resultOf(output, item.id);
  assert.ok(result, 'requirement-sync has a result');
  assert.notStrictEqual(result.outcome, 'fail', 'incomplete inventory never establishes absence');
});

checkCase('325-3a cross tagged-test-only with complete inventory but no PRD in the tree: requirement-sync is not a fail (§10 file null)', () => {
  const ctx = prepare('tagged-test', { complete: true });
  const item = requirementSync(ctx);
  const output = check(ctx, {});
  const result = resultOf(output, item.id);
  assert.ok(result, 'requirement-sync has a result');
  assert.notStrictEqual(result.outcome, 'fail', 'a cited REQ with no resolved file never establishes absence');
});

// Round 5 (PR #334 review R5), round trip: the test cites REQ-GRPH-099, which no PRD declares. A current-bound
// execution record and a current-bound valid waiver must not pass it; the unresolved REQ is diagnosed by id.
checkCase('325-3a cross orphan REQ-citing test + valid current waiver + passing execution: requirement-sync not pass, req-unresolved (R5)', () => {
  const ctx = prepare('orphan-req-test', { complete: true });
  const item = requirementSync(ctx);
  assert.ok(item.scope.paths.every(path => typeof path === 'string'), 'derived scope holds only real paths');
  const output = check(ctx, {
    executionRecords: [boundRecord(ctx, 'test-run', item.id, item.scope.paths)],
    reviewRecords: [waiverRecord(ctx, 'waiver-orphan', item.id, item.scope.paths, {
      reason: 'no-req-change: acceptance criteria unchanged, cited passing test',
      citedRecordIds: ['test-run']
    })]
  });
  const result = resultOf(output, item.id);
  assert.ok(result, 'requirement-sync has a result');
  assert.notStrictEqual(result.outcome, 'pass', 'an orphan REQ never passes through a waiver');
  const diag = output.diagnostics.find(d => d.code === 'req-unresolved');
  assert.ok(diag, 'the unresolved REQ is diagnosed');
  assert.ok(JSON.stringify(diag).includes('REQ-GRPH-099'), 'the diagnostic names the REQ id');
});

// Round 6 (Sol round-3 review, end to end). Real derivation, then real check. The envelope is built from the
// fixture trees with the same formulas as the evidence suite: baseDigest = treeDigest(base),
// candidateDigest = prdSetDigest(artifacts), configDigest = sha256(config).

function prdSetDigest(artifacts) {
  return sha256(JSON.stringify(Object.keys(artifacts).filter(p => p.startsWith('docs/prd/')).sort()
    .map(p => [p, artifacts[p].digest])));
}

function attestedFor(name) {
  const input = loadCase(name);
  const artifacts = {};
  for (const [file, text] of Object.entries(input.candidate.files)) artifacts[file] = { digest: sha256(text) };
  return {
    complete: true,
    waiverInventoryComplete: true,
    baseDigest: treeDigest(input.base.files),
    candidateDigest: prdSetDigest(artifacts),
    configDigest: sha256(JSON.stringify(caseConfig(name)))
  };
}

const ATTESTED_FIXTURE = 'assertion-no-revision-attested';
const ATTESTED_FILE = JSON.parse(fs.readFileSync(path.join(fixtureDir, ATTESTED_FIXTURE, 'inventory.json'), 'utf8'));

checkCase('325-3a F2 fixture envelope is current: inventory.json matches the trees it describes (round 6)', () => {
  assert.deepStrictEqual(ATTESTED_FILE, attestedFor(ATTESTED_FIXTURE), 'the attested fixture envelope is up to date');
});

// F1 end to end.
checkCase('325-3a cross F1 duplicate cited ID across two current PRDs + valid waiver + passing execution: not pass, req-unresolved (round 6)', () => {
  const ctx = prepare('dup-req-id', attestedFor('dup-req-id'));
  const item = requirementSync(ctx);
  const output = check(ctx, {
    executionRecords: [boundRecord(ctx, 'dup-run', item.id, item.scope.paths)],
    reviewRecords: [waiverRecord(ctx, 'waiver-dup', item.id, item.scope.paths, {
      reason: 'no-req-change: acceptance criteria unchanged, cited passing test',
      citedRecordIds: ['dup-run']
    })]
  });
  const result = resultOf(output, item.id);
  assert.ok(result, 'requirement-sync has a result');
  assert.notStrictEqual(result.outcome, 'pass', 'an ambiguous REQ never passes');
  assert.ok(output.diagnostics.some(d => d.code === 'req-unresolved' && JSON.stringify(d).includes('REQ-GRPH-001')),
    'the ambiguous REQ is diagnosed by id');
});

checkCase('325-3a cross F1 malformed current PRD over a valid base, complete attested inventory: none, not an absence fail (round 6)', () => {
  const ctx = prepare('malformed-prd', attestedFor('malformed-prd'));
  const item = requirementSync(ctx);
  const output = check(ctx, {});
  const result = resultOf(output, item.id);
  assert.ok(result, 'requirement-sync has a result');
  assert.notStrictEqual(result.outcome, 'fail', 'an analysis error is not an observed absence');
});

checkCase('325-3a cross F1 PRD deleted in the candidate, complete attested inventory: none, not an absence fail (round 6)', () => {
  const ctx = prepare('deleted-prd', attestedFor('deleted-prd'));
  const item = requirementSync(ctx);
  const output = check(ctx, {});
  const result = resultOf(output, item.id);
  assert.ok(result, 'requirement-sync has a result');
  assert.notStrictEqual(result.outcome, 'fail', 'a base-only declaration is not current authority');
});

// F2 end to end.
checkCase('325-3a cross F2 fully attested current no-revision/no-waiver: observed fail, end to end (round 6 positive)', () => {
  const ctx = prepare(ATTESTED_FIXTURE, ATTESTED_FILE);
  const item = requirementSync(ctx);
  const output = check(ctx, {});
  const result = resultOf(output, item.id);
  assert.strictEqual(result.observation, 'observed', 'the attested absence is observed');
  assert.strictEqual(result.outcome, 'fail', 'the attested absence fails');
  assert.ok(output.diagnostics.some(d => d.code === 'req-sync-no-revision-or-waiver' && d.obligationId === item.id),
    'the failure is diagnosed');
});

checkCase('325-3a cross F2 unobserved waiver inventory on the same fixture: not a fail, req-sync-envelope-unattested (round 6)', () => {
  const ctx = prepare(ATTESTED_FIXTURE, { ...ATTESTED_FILE, waiverInventoryComplete: false });
  const item = requirementSync(ctx);
  const output = check(ctx, {});
  assert.notStrictEqual(resultOf(output, item.id).outcome, 'fail', 'an unobserved waiver inventory never establishes absence');
  assert.ok(output.diagnostics.some(d => d.code === 'req-sync-envelope-unattested'), 'the unattested envelope is diagnosed');
});

checkCase('325-3a cross F2 stale base on the same fixture: not a fail, req-sync-envelope-unattested (round 6)', () => {
  const ctx = prepare(ATTESTED_FIXTURE, { ...ATTESTED_FILE, baseDigest: sha256('old base') });
  const item = requirementSync(ctx);
  const output = check(ctx, {});
  assert.notStrictEqual(resultOf(output, item.id).outcome, 'fail', 'a stale base never establishes absence');
  assert.ok(output.diagnostics.some(d => d.code === 'req-sync-envelope-unattested'), 'the stale envelope is diagnosed');
});

checkCase('325-3a cross F2 absent baseline at check time: not a fail (round 6)', () => {
  const ctx = prepare(ATTESTED_FIXTURE, ATTESTED_FILE);
  const item = requirementSync(ctx);
  const output = checkDocObligations({ obligations: ctx.obligations, artifacts: ctx.artifacts, executionRecords: [], reviewRecords: [] });
  assert.notStrictEqual(resultOf(output, item.id).outcome, 'fail', 'no baseline identity, no negative result');
});

checkCase('325-3a cross F2 absent artifact identity at check time: not a fail (round 6)', () => {
  const ctx = prepare(ATTESTED_FIXTURE, ATTESTED_FILE);
  const item = requirementSync(ctx);
  const output = checkDocObligations({ obligations: ctx.obligations, artifacts: {}, baseline: ctx.baseline, executionRecords: [], reviewRecords: [] });
  assert.notStrictEqual(resultOf(output, item.id).outcome, 'fail', 'no artifact identity, no negative result');
});

// F3 end to end.
checkCase('325-3a cross F3 whitespace inside a string literal: requirement-sync not N/A and no records give none (round 6)', () => {
  const ctx = prepare('literal-whitespace-assert', attestedFor('literal-whitespace-assert'));
  const item = requirementSync(ctx);
  assert.notStrictEqual(item.applicability, 'N/A', 'a literal change is not N/A');
  const output = check(ctx, {});
  assert.strictEqual(resultOf(output, item.id).outcome, 'none', 'no records, no pass or fail');
});

checkCase('325-3a cross F3 trailing-comment-only edit with unchanged PRD and complete attested inventory: not a fail (round 6)', () => {
  const ctx = prepare('trailing-comment-test', attestedFor('trailing-comment-test'));
  const item = requirementSync(ctx);
  assert.strictEqual(item.applicability, 'N/A', 'a trailing comment is not an assertion change');
  const output = check(ctx, {});
  assert.notStrictEqual(resultOf(output, item.id).outcome, 'fail', 'a comment-only edit never fails the obligation');
});

// Round 7 (Sol round-4 finding 1), end to end: real derivation, then real check.

checkCase('325-3a cross R7 retained valid revision chain + valid current waiver + matching evidence: requirement-sync passes (round 7)', () => {
  const ctx = prepare('retained-revision-chain', attestedFor('retained-revision-chain'));
  const item = requirementSync(ctx);
  const output = check(ctx, {
    executionRecords: [boundRecord(ctx, 'retained-run', item.id, item.scope.paths)],
    reviewRecords: [waiverRecord(ctx, 'waiver-retained', item.id, item.scope.paths, {
      reason: 'no-req-change: acceptance criteria unchanged, cited passing test',
      citedRecordIds: ['retained-run']
    })]
  });
  const result = resultOf(output, item.id);
  assert.strictEqual(result.observation, 'observed', 'the resolved current REQ and its evidence are observed');
  assert.strictEqual(result.outcome, 'pass', 'a retained chain resolves to the current revision, so a supported waiver passes');
});

checkCase('325-3a cross R7 control: the same ID in two DISTINCT current logical PRDs + valid waiver + matching evidence: not pass, req-unresolved (round 7)', () => {
  const ctx = prepare('distinct-logical-prds', attestedFor('distinct-logical-prds'));
  const item = requirementSync(ctx);
  const output = check(ctx, {
    executionRecords: [boundRecord(ctx, 'distinct-run', item.id, item.scope.paths)],
    reviewRecords: [waiverRecord(ctx, 'waiver-distinct', item.id, item.scope.paths, {
      reason: 'no-req-change: acceptance criteria unchanged, cited passing test',
      citedRecordIds: ['distinct-run']
    })]
  });
  assert.notStrictEqual(resultOf(output, item.id).outcome, 'pass', 'an ambiguous REQ never passes');
  assert.ok(output.diagnostics.some(d => d.code === 'req-unresolved' && JSON.stringify(d).includes('REQ-GRPH-011')),
    'the ambiguous REQ is diagnosed by id');
});

checkCase('325-3a cross R7 historical-only ID + valid waiver + matching evidence: not pass, req-unresolved names REQ-GRPH-013 (round 7)', () => {
  const ctx = prepare('historical-only-req', attestedFor('historical-only-req'));
  const item = requirementSync(ctx);
  const output = check(ctx, {
    executionRecords: [boundRecord(ctx, 'historical-run', item.id, item.scope.paths)],
    reviewRecords: [waiverRecord(ctx, 'waiver-historical', item.id, item.scope.paths, {
      reason: 'no-req-change: acceptance criteria unchanged, cited passing test',
      citedRecordIds: ['historical-run']
    })]
  });
  assert.notStrictEqual(resultOf(output, item.id).outcome, 'pass', 'a historical-only REQ is not current authority');
  assert.ok(output.diagnostics.some(d => d.code === 'req-unresolved' && JSON.stringify(d).includes('REQ-GRPH-013')),
    'the historical-only REQ is diagnosed by id');
});

helper.finish();
