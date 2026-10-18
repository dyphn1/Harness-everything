'use strict';

const assert = require('assert');
const path = require('path');
const crypto = require('crypto');
const helper = require('./test-helper');

const modulePath = path.join(__dirname, '..', 'harness-everything', 'scripts', 'doc-obligations.js');
const evidencePath = path.join(__dirname, '..', 'harness-everything', 'scripts', 'doc-evidence.js');
const lifecyclePath = path.join(__dirname, '..', 'harness-everything', 'scripts', 'doc-lifecycle.js');
let deriveDocFacts, deriveDocObligations, checkDocObligations, lifecycle;
try {
  ({ deriveDocFacts, deriveDocObligations } = require(modulePath));
  ({ checkDocObligations } = require(evidencePath));
  lifecycle = require(lifecyclePath);
} catch (error) {
  helper.check('pr334-opencode. revision mechanism modules are available', false, error.message);
}

console.log('\n[pr334-opencode] doc-obligations requirement revision / lifecycle lane...');

const CONFIG = {
  governed: [
    { path: 'docs/prd/**', role: 'prd' },
    { path: 'docs/adr/**', role: 'adr' },
    { path: 'docs/reference/**', role: 'reference' }
  ],
  domains: ['GRPH'],
  legacy: ['docs/adr/legacy/**'],
  derived: [{ path: 'docs/roadmap/index.md', generator: 'npm run docs:index' }],
  tickets: 'tracker'
};

const sha256 = bytes => `sha256:${crypto.createHash('sha256').update(bytes).digest('hex')}`;
const sortedJson = value => Array.isArray(value)
  ? `[${value.map(sortedJson).join(',')}]`
  : value && typeof value === 'object'
    ? `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${sortedJson(value[key])}`).join(',')}}`
    : JSON.stringify(value);

function prdDoc({ id, revision, previous, previousDigest, acceptance, approvalBy = 'Bob Independent' }) {
  const data = { id, revision, drafted_by: 'Alice Example' };
  if (previous !== undefined) {
    data.previous_revision = previous;
    data.previous_digest = previousDigest;
  }
  const body = `### REQ-GRPH-011: Stable requirement\n\nAcceptance: ${acceptance}\n`;
  const walk = value => {
    const lines = [];
    for (const key of Object.keys(value)) {
      const item = value[key];
      if (item && typeof item === 'object' && !Array.isArray(item)) {
        lines.push(`${key}:`);
        walk(item).forEach(inner => lines.push(`  ${inner}`));
      } else if (key === 'revision' || key === 'previous_revision') {
        lines.push(`${key}: ${item}`);
      } else {
        lines.push(`${key}: ${JSON.stringify(item)}`);
      }
    }
    return lines;
  };
  const contentDigest = sha256(Buffer.concat([
    Buffer.from(`${sortedJson(data)}\n`, 'utf8'), Buffer.from(body, 'utf8')
  ]));
  const approval = { by: approvalBy, at: '2026-10-17T00:00:00Z', ref: 'https://approvals.example.invalid/PRD-GRPH-001', role: 'human', content_digest: contentDigest };
  const front = walk({ ...data, status: 'effective', effective_at: '2026-10-17T00:02:00Z', approval }).join('\n');
  return `---\n${front}\n---\n${body}`;
}

const r001Text = prdDoc({ id: 'PRD-GRPH-001', revision: 1, acceptance: 'stable v1 behavior.' });
const r002Descendant = acceptance => prdDoc({ id: 'PRD-GRPH-001', revision: 2, previous: 1, previousDigest: sha256(Buffer.from(r001Text, 'utf8')), acceptance });
const plainPrd = acceptance => `---\nstatus: "effective"\n---\n### REQ-GRPH-011: Plain requirement\n\nAcceptance: ${acceptance}\n`;
const renameTest = value => `// REQ-GRPH-011\nassert.equal(run(), ${value});\n`;

const BASELINE = 'sha256:pr334-opencode-baseline';

function derive(input) {
  return deriveDocFacts({ base: { files: input.base }, candidate: { files: input.candidate }, config: CONFIG, inventory: { complete: true } });
}

function factAssertions(setup, run) {
  const { facts } = derive(setup);
  run(facts);
}

function syncObligation(facts) {
  const obligations = deriveDocObligations(facts);
  const item = obligations.find(obligation => obligation.capability === 'requirement-sync');
  assert.ok(item, 'requirement-sync is in the catalog');
  return item;
}

function boundPassingEvidence(obligation, candidateFiles) {
  const artifacts = {};
  const records = obligation.scope.paths.map((targetPath, index) => {
    const text = candidateFiles[targetPath];
    assert.ok(typeof text === 'string', `scope path ${targetPath} exists in the candidate for evidence binding`);
    const digest = { digest: sha256(Buffer.from(text, 'utf8')) };
    artifacts[targetPath] = digest;
    return {
      id: `exec-${index}`,
      obligationId: obligation.id,
      command: `npm run verify -- ${targetPath}`,
      provenance: `bound execution record for ${targetPath}`,
      exitCode: 0,
      baseDigest: BASELINE,
      artifactDigests: { [targetPath]: digest.digest },
      paths: [targetPath]
    };
  });
  const outcome = checkDocObligations({
    obligations: [obligation],
    artifacts,
    baseline: { digest: BASELINE },
    executionRecords: records,
    reviewRecords: []
  });
  assert.deepStrictEqual(outcome.diagnostics.filter(item => item.code.endsWith('digest') || item.code === 'missing-path-coverage'), [],
    `evidence binding is accepted for every scope path`);
  return outcome.results[0];
}

function checkCase(name, run) {
  try {
    run();
    helper.check(name, true);
  } catch (error) {
    helper.check(name, false, error && error.message ? error.message : String(error));
  }
}

function citedEntry(facts, id) {
  const entries = facts.citedReqs.filter(entry => entry && entry.id === id);
  assert.ok(entries.length > 0, `citedReqs reports ${id}: ${JSON.stringify(facts.citedReqs)}`);
  assert.strictEqual(entries.length, 1, `${id} is reported once: ${JSON.stringify(facts.citedReqs)}`);
  return entries[0];
}

function mutationEntry(facts, id, file) {
  const entries = (facts.reqMutationNotRevision || []).filter(entry => entry && entry.id === id);
  assert.ok(entries.length > 0, `${id} is flagged as a mutation, not a revision: ${JSON.stringify(facts.reqMutationNotRevision)}`);
  const targeted = entries.filter(entry => !file || entry.file === file);
  assert.ok(targeted.length > 0, `${id} is flagged at ${file || 'some file'}: ${JSON.stringify(facts.reqMutationNotRevision)}`);
  return targeted[0];
}

checkCase('pr334-opencode. control: generated lifecycle docs are accepted as valid revisions with no error diagnostics', () => {
  const docs = [
    docForParse('docs/prd/graph/r001.md', r001Text),
    docForParse('docs/prd/graph/r002.md', r002Descendant('stable v2 behavior.'))
  ];
  const analysis = lifecycle.analyzeDocs(docs, CONFIG, { all: true });
  assert.deepStrictEqual(analysis.diagnostics.filter(item => item.severity === 'error'), [],
    `the generated r001/r002 revision chain is lifecycle-valid: ${JSON.stringify(analysis.diagnostics.filter(item => item.severity === 'error'))}`);
});

function docForParse(parsedPath, text) {
  const parsed = lifecycle.parseFrontmatter(text);
  return { path: parsedPath, body: parsed.body, frontmatter: parsed.data, error: parsed.error, storedBytes: Buffer.from(text, 'utf8'), legacy: false, role: 'prd' };
}

checkCase('pr334-opencode. positive legal successor r001 -> r002: REQ-GRPH-011 is a reqUpdate at r002 and resolves there (fix scope control)', () => {
  const candidate = 'docs/prd/graph/r002.md';
  factAssertions(legalSuccessor(), facts => {
    assert.ok(facts.reqUpdates.some(entry => entry.id === 'REQ-GRPH-011' && entry.file === candidate),
      `the lifecycle successor is an update: ${JSON.stringify(facts.reqUpdates)}`);
    assert.deepStrictEqual(facts.reqMutationNotRevision, [], 'a legal successor is not flagged as a mutation');
    const cited = citedEntry(facts, 'REQ-GRPH-011');
    assert.strictEqual(cited.file, candidate, `the cited request resolves to the successor: ${JSON.stringify(facts.citedReqs)}`);
    assert.strictEqual(cited.resolution, 'resolved', 'the successor is current authority');
  });
});

checkCase('pr334-opencode. positive legal successor with matching bound passing evidence: requirement-sync passes (no over-block from the fix)', () => {
  const setup = legalSuccessor();
  const { facts } = derive(setup);
  const obligation = syncObligation(facts);
  assert.strictEqual(obligation.applicability, 'applicable', 'an assertion change triggers requirement-sync');
  const outcome = boundPassingEvidence(obligation, setup.candidate);
  assert.strictEqual(outcome.outcome, 'pass', `matching evidence over a legal successor passes: ${JSON.stringify(outcome)}`);
});

checkCase('pr334-opencode. negative in-place edit of the current effective r002: not a reqUpdate, flagged as req-mutation-not-revision, cited REQ mutated with file null (T2/S2 lane)', () => {
  factAssertions(inPlaceCurrent(), facts => {
    assert.ok(!facts.reqUpdates.some(entry => entry.id === 'REQ-GRPH-011'),
      `an in-place edit is not a legal revision: ${JSON.stringify(facts.reqUpdates)}`);
    mutationEntry(facts, 'REQ-GRPH-011', 'docs/prd/graph/r002.md');
    const cited = citedEntry(facts, 'REQ-GRPH-011');
    assert.strictEqual(cited.file, null, `the mutated requirement has no resolution file: ${JSON.stringify(facts.citedReqs)}`);
    assert.strictEqual(cited.resolution, 'mutated', 'the mutation is unresolved, never resolved');
  });
});

checkCase('pr334-opencode. negative in-place edit of the current effective r002 with matching bound passing evidence: requirement-sync must not pass', () => {
  const setup = inPlaceCurrent();
  const { facts } = derive(setup);
  const obligation = syncObligation(facts);
  assert.strictEqual(obligation.applicability, 'applicable', 'the accompanying assertion change triggers requirement-sync');
  const outcome = boundPassingEvidence(obligation, setup.candidate);
  assert.notStrictEqual(outcome.outcome, 'pass',
    `matching evidence cannot turn an in-place mutation into a legal revision: ${JSON.stringify(outcome)}`);
  assert.ok(outcome.observation === 'unresolved' && outcome.outcome === 'none',
    'the mutation lane stays unresolved with no observed pass');
});

checkCase('pr334-opencode. negative edit to a retained historical r001: not a reqUpdate, cited REQ mutated with file null (historical lane)', () => {
  factAssertions(inPlaceHistorical(), facts => {
    assert.ok(!facts.reqUpdates.some(entry => entry.id === 'REQ-GRPH-011'),
      `a historical edit is not a successor revision: ${JSON.stringify(facts.reqUpdates)}`);
    mutationEntry(facts, 'REQ-GRPH-011', 'docs/prd/graph/r001.md');
    const cited = citedEntry(facts, 'REQ-GRPH-011');
    assert.strictEqual(cited.file, null, `the historical mutation is not current authority: ${JSON.stringify(facts.citedReqs)}`);
    assert.strictEqual(cited.resolution, 'mutated', 'a historical edit is an unresolved mutation');
  });
});

checkCase('pr334-opencode. negative edit to a retained historical r001 with matching bound passing evidence: requirement-sync must not pass', () => {
  const setup = inPlaceHistorical();
  const { facts } = derive(setup);
  const obligation = syncObligation(facts);
  assert.strictEqual(obligation.applicability, 'applicable', 'the accompanying assertion change triggers requirement-sync');
  const outcome = boundPassingEvidence(obligation, setup.candidate);
  assert.notStrictEqual(outcome.outcome, 'pass',
    `matching evidence cannot launder a historical edit: ${JSON.stringify(outcome)}`);
});

checkCase('pr334-opencode. negative in-place rewrite of an unnumbered governed PRD that mints a new effective PRD identity: not a reqUpdate and unresolved (finding 4305942766 round: identity laundering)', () => {
  const plainCandidate = prdDoc({ id: 'PRD-GRPH-001', revision: 2, acceptance: 'MUTATED plain behavior.' });
  const setup = {
    base: { 'docs/prd/graph/plain.md': plainPrd('plain v1 behavior.'), 'ci/mechanism-inplace.test.js': renameTest(1) },
    candidate: { 'docs/prd/graph/plain.md': plainCandidate, 'ci/mechanism-inplace.test.js': renameTest(2) }
  };
  factAssertions(setup, facts => {
    assert.ok(!facts.reqUpdates.some(entry => entry.id === 'REQ-GRPH-011'),
      `a freshly minted identity is not a lifecycle successor of the base declaration: ${JSON.stringify(facts.reqUpdates)}`);
    mutationEntry(facts, 'REQ-GRPH-011', 'docs/prd/graph/plain.md');
  });
});

checkCase('pr334-opencode. negative identity laundering with matching bound passing evidence: requirement-sync must not pass and the cited REQ is unresolved', () => {
  const plainCandidate = prdDoc({ id: 'PRD-GRPH-001', revision: 2, acceptance: 'MUTATED plain behavior.' });
  const setup = {
    base: { 'docs/prd/graph/plain.md': plainPrd('plain v1 behavior.'), 'ci/mechanism-inplace.test.js': renameTest(1) },
    candidate: { 'docs/prd/graph/plain.md': plainCandidate, 'ci/mechanism-inplace.test.js': renameTest(2) }
  };
  const { facts } = derive(setup);
  const obligation = syncObligation(facts);
  assert.strictEqual(obligation.applicability, 'applicable', 'the accompanying assertion change triggers requirement-sync');
  const cited = citedEntry(facts, 'REQ-GRPH-011');
  assert.strictEqual(cited.file, null, `a laundered mutation resolves unresolved (previously it resolved): ${JSON.stringify(facts.citedReqs)}`);
  assert.strictEqual(cited.resolution, 'mutated', 'the laundering lane reports the mutation');
  const outcome = boundPassingEvidence(obligation, setup.candidate);
  assert.notStrictEqual(outcome.outcome, 'pass',
    `matching evidence cannot launder an identity-granting in-place rewrite: ${JSON.stringify(outcome)}`);
});

checkCase('pr334-opencode. negative duplicate-revision fork of r002: no reqUpdate and the cited REQ stays unresolved (malformed lifecycle lane)', () => {
  const forkText = prdDoc({ id: 'PRD-GRPH-001', revision: 2, previous: 1, previousDigest: sha256(Buffer.from(r001Text, 'utf8')), acceptance: 'forked behavior.' });
  const mainCandidate = r002Descendant('MUTATED main fork behavior.');
  const setup = {
    base: { 'docs/prd/graph/r001.md': r001Text, 'docs/prd/graph/r002.md': r002Descendant('stable v2 behavior.'), 'ci/mechanism-inplace.test.js': renameTest(1) },
    candidate: { 'docs/prd/graph/r001.md': r001Text, 'docs/prd/graph/r002.md': mainCandidate, 'docs/prd/graph/r002-fork.md': forkText, 'ci/mechanism-inplace.test.js': renameTest(2) }
  };
  factAssertions(setup, facts => {
    assert.ok(!facts.reqUpdates.some(entry => entry.id === 'REQ-GRPH-011'),
      `an ambiguous revision chain is not a legal update: ${JSON.stringify(facts.reqUpdates)}`);
    const cited = citedEntry(facts, 'REQ-GRPH-011');
    assert.strictEqual(cited.file, null, `an ambiguous chain has no resolution file: ${JSON.stringify(facts.citedReqs)}`);
    assert.ok(['mutated', 'ambiguous', 'analysis-error'].includes(cited.resolution),
      `an ambiguous chain is explicit unresolved, never resolved: ${cited.resolution}`);
  });
});

checkCase('pr334-opencode. negative r003 successor with a broken previous_digest: not a reqUpdate, requirement unresolved, not a pass (malformed lifecycle lane)', () => {
  const r003Broken = prdDoc({ id: 'PRD-GRPH-001', revision: 3, previous: 2, previousDigest: 'sha256:0000000000000000000000000000000000000000000000000000000000000000', acceptance: 'third generation behavior.' });
  const validR003 = prdDoc({ id: 'PRD-GRPH-001', revision: 3, previous: 2, previousDigest: sha256(Buffer.from(r002Descendant('stable v2 behavior.'), 'utf8')), acceptance: 'stable v3 behavior.' });
  assert.notStrictEqual(r003Broken, validR003, 'the malformed case really carries a broken previous_digest');
  const setup = {
    base: { 'docs/prd/graph/r001.md': r001Text, 'ci/mechanism-inplace.test.js': renameTest(1) },
    candidate: { 'docs/prd/graph/r001.md': r001Text, 'docs/prd/graph/r002.md': r002Descendant('stable v2 behavior.'), 'docs/prd/graph/r003.md': r003Broken, 'ci/mechanism-inplace.test.js': renameTest(2) }
  };
  factAssertions(setup, facts => {
    assert.ok(!facts.reqUpdates.some(entry => entry.id === 'REQ-GRPH-011'),
      `a malformed successor is not a legal update: ${JSON.stringify(facts.reqUpdates)}`);
    const cited = citedEntry(facts, 'REQ-GRPH-011');
    assert.strictEqual(cited.file, null, `a malformed chain has no resolution file: ${JSON.stringify(facts.citedReqs)}`);
  });
});

function legalSuccessor() {
  return {
    base: { 'docs/prd/graph/r001.md': r001Text, 'ci/mechanism-inplace.test.js': renameTest(1) },
    candidate: { 'docs/prd/graph/r001.md': r001Text, 'docs/prd/graph/r002.md': r002Descendant('stable v2 behavior.'), 'ci/mechanism-inplace.test.js': renameTest(2) }
  };
}

function inPlaceCurrent() {
  return {
    base: { 'docs/prd/graph/r001.md': r001Text, 'docs/prd/graph/r002.md': r002Descendant('stable v2 behavior.'), 'ci/mechanism-inplace.test.js': renameTest(1) },
    candidate: { 'docs/prd/graph/r001.md': r001Text, 'docs/prd/graph/r002.md': r002Descendant('MUTATED stable behavior.'), 'ci/mechanism-inplace.test.js': renameTest(2) }
  };
}

function inPlaceHistorical() {
  const mutatedR001 = prdDoc({ id: 'PRD-GRPH-001', revision: 1, acceptance: 'MUTATED historical behavior.' });
  return {
    base: { 'docs/prd/graph/r001.md': r001Text, 'docs/prd/graph/r002.md': r002Descendant('stable v2 behavior.'), 'ci/mechanism-inplace.test.js': renameTest(1) },
    candidate: { 'docs/prd/graph/r001.md': mutatedR001, 'docs/prd/graph/r002.md': r002Descendant('stable v2 behavior.'), 'ci/mechanism-inplace.test.js': renameTest(2) }
  };
}

helper.finish();
