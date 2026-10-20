'use strict';

// #341 Phase 0A read-boundary corpus: replay conformance for the caller-graph read boundary.
//
// Each case in ci/fixtures/doc-obligations/read-boundary/cases.json is built fresh for every run and
// executed against both explicit distributions (canonical and packaged), unwrapped and traced. Its
// output, exception, semantic counters and full ordered trace are compared with the reviewed values
// in expected.json, and its matrix-level role claims (result outcome, diagnostic codes, read budgets)
// are checked from cases.json. Nothing is accepted or updated during test execution.
//
// IDs follow the Phase 0A fixture interface: caseId is `RB` plus digits; assertionId is
// `<caseId>.<contract>.<property>`. Each claim emits one JSONL event to HARNESS_ASSERTION_EVENT_FILE,
// and HARNESS_CASE_ID selects a single case.

const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { buildCase, runChecker } = require('./lib/doc-evidence-fixtures');

const FIXTURE_DIR = path.join(__dirname, 'fixtures', 'doc-obligations', 'read-boundary');
const corpus = JSON.parse(fs.readFileSync(path.join(FIXTURE_DIR, 'cases.json'), 'utf8'));
const expected = JSON.parse(fs.readFileSync(path.join(FIXTURE_DIR, 'expected.json'), 'utf8'));

// Explicit distributions. Each is loaded from its own path and must be a distinct file.
const DISTRIBUTIONS = Object.freeze({
  canonical: path.join(__dirname, '..', 'harness-everything', 'scripts', 'doc-evidence.js'),
  packaged: path.join(__dirname, '..', 'plugins', 'harness-everything', 'skills', 'harness-everything', 'scripts', 'doc-evidence.js')
});

const EVENT_FILE = process.env.HARNESS_ASSERTION_EVENT_FILE;
const SELECTED_ASSERTION = process.env.HARNESS_ASSERTION_ID;
// The selected assertion names its case, so a selection without HARNESS_CASE_ID still runs one case.
const SELECTED_CASE = process.env.HARNESS_CASE_ID
  || (SELECTED_ASSERTION ? SELECTED_ASSERTION.slice(0, SELECTED_ASSERTION.indexOf('.')) : undefined);
const claimedAssertions = new Set();

const failures = [];
let passed = 0;

function emit(event) {
  if (!EVENT_FILE) return;
  fs.appendFileSync(EVENT_FILE, `${JSON.stringify({ schemaVersion: 1, ...event })}\n`, 'utf8');
}

// Only an assertion-library comparison produces an assertion-failure event. Any other error is an
// infrastructure failure: it propagates, the process terminates abnormally, and no event is written.
function assertion(caseId, contract, run) {
  const assertionId = `${caseId}.${contract}`;
  claimedAssertions.add(assertionId);
  // Only the selected claim runs: a selected result or exception claim fails on its own, and later
  // claims never dereference an output the selected claim did not need.
  if (SELECTED_ASSERTION && SELECTED_ASSERTION !== assertionId) return;
  try {
    run();
  } catch (error) {
    if (!(error instanceof assert.AssertionError)) throw error;
    failures.push(assertionId);
    emit({
      event: 'assertion-failure',
      caseId,
      assertionId,
      errorCode: 'ERR_ASSERTION',
      message: String(error.message).split('\n')[0]
    });
    console.error(`❌ ${assertionId}`);
    return;
  }
  passed += 1;
  emit({ event: 'assertion-pass', caseId, assertionId });
  console.log(`✅ ${assertionId}`);
}

function sha256(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

const checkers = Object.fromEntries(Object.entries(DISTRIBUTIONS).map(([name, file]) => [
  name,
  require(file).checkDocObligations
]));

function countEvents(events, where) {
  return events.filter(event => (where.id === undefined || event.id === where.id)
    && (where.op === undefined || event.op === where.op)
    && (where.key === undefined || JSON.stringify(event.key) === JSON.stringify(where.key))).length;
}

function budgetValue(budget, run) {
  if (budget.kind === 'accessor') return run.counters.accessors[budget.path] ? run.counters.accessors[budget.path].reads : 0;
  if (budget.kind === 'trace') return countEvents(run.events, budget.where);
  if (budget.kind === 'trap') return run.counters.traps[budget.node] ? run.counters.traps[budget.node].calls : 0;
  if (budget.kind === 'receiver') {
    const entry = run.counters.accessors[budget.path];
    return entry ? entry.receivers.filter(item => item === budget.node).length : 0;
  }
  throw new Error(`unknown budget kind ${budget.kind}`);
}

function budgetClaim(budget) {
  return `${budget.role}.${budget.name}`;
}

function budgetHolds(budget, value) {
  if (budget.kind === 'receiver') return value >= (budget.min || 1);
  if (budget.count !== undefined) return value === budget.count;
  return value >= budget.min;
}

// Every assertion a case may emit, derived from its declared claims. The mutation mapping must name
// one of these, so a mutant can only be credited to a claim the corpus actually makes.
function claimsFor(item) {
  const claims = [
    'setup.events-excluded',
    'conformance.output-matches-expected',
    'conformance.exception-matches-expected',
    'conformance.counters-match-expected',
    'conformance.trace-matches-expected',
    'conformance.traced-matches-unwrapped',
    'trace.deterministic',
    'integrity.inputs-unchanged',
    'aliasing.no-input-leak',
    'identity.all-references-named',
    'distribution.parity'
  ];
  if (item.recipe.detached) {
    claims.push('detached.result-unchanged-after-mutation', 'detached.fresh-invocation-matches-expected', 'integrity.post-return-unchanged');
    if (item.expect && item.expect.secondDiffers) claims.push('detached.fresh-invocation-differs');
  }
  if (item.expect) claims.push('result.observation-outcome', 'result.diagnostic-codes');
  for (const budget of item.budgets) claims.push(budgetClaim(budget));
  return claims;
}

const casesById = new Map(corpus.cases.map(item => [item.caseId, item]));

if (SELECTED_CASE && !casesById.has(SELECTED_CASE)) {
  console.error(`infrastructure: unknown HARNESS_CASE_ID ${SELECTED_CASE}`);
  process.exit(2);
}
if (SELECTED_ASSERTION && (!SELECTED_CASE || !SELECTED_ASSERTION.startsWith(`${SELECTED_CASE}.`))) {
  console.error(`infrastructure: HARNESS_ASSERTION_ID ${SELECTED_ASSERTION} does not belong to case ${SELECTED_CASE}`);
  process.exit(2);
}

for (const [mutantId, mapping] of Object.entries(corpus.mutantCoverage)) {
  const item = casesById.get(mapping.caseId);
  const claimed = item && claimsFor(item).includes(mapping.assertionId.slice(`${mapping.caseId}.`.length));
  if (!claimed) {
    console.error(`infrastructure: mutant ${mutantId} maps to ${mapping.assertionId}, which the corpus does not make`);
    process.exit(2);
  }
}

// One replay of a case under one distribution: unwrapped, traced, and a repeat traced build. Each
// build is independent; setup and integrity snapshots must produce no trace events.
function replay(item, distribution) {
  const checker = checkers[distribution];
  const untracedBuild = buildCase(item.recipe, { traced: false });
  const untraced = runChecker(checker, untracedBuild);
  const tracedBuild = buildCase(item.recipe, { traced: true });
  const setupEvents = tracedBuild.recorder.events.length;
  tracedBuild.integrity();
  const setupEventsAfterSnapshot = tracedBuild.recorder.events.length;
  const traced = runChecker(checker, tracedBuild);
  const repeat = runChecker(checker, buildCase(item.recipe, { traced: true }));
  return { untraced, traced, repeat, tracedBuild, setupEvents, setupEventsAfterSnapshot };
}

for (const item of corpus.cases) {
  const caseId = item.caseId;
  if (SELECTED_CASE && SELECTED_CASE !== caseId) continue;
  const pinned = expected.cases[caseId];
  assert.ok(pinned, `${caseId} has no pinned expectation`);

  const runs = {};
  for (const distribution of Object.keys(DISTRIBUTIONS)) runs[distribution] = replay(item, distribution);
  const each = fn => {
    for (const [distribution, run] of Object.entries(runs)) fn(distribution, run);
  };

  assertion(caseId, 'setup.events-excluded', () => each((distribution, run) => {
    assert.strictEqual(run.setupEvents, 0, `${distribution}: building a traced graph must record no events`);
    assert.strictEqual(run.setupEventsAfterSnapshot, 0, `${distribution}: integrity snapshots must record no events`);
  }));

  assertion(caseId, 'conformance.output-matches-expected', () => each((distribution, run) => {
    assert.deepStrictEqual(run.traced.output, pinned.output, `${distribution}: traced output differs from the reviewed output`);
    assert.deepStrictEqual(run.untraced.output, pinned.output, `${distribution}: unwrapped output differs from the reviewed output`);
  }));

  assertion(caseId, 'conformance.exception-matches-expected', () => each((distribution, run) => {
    assert.deepStrictEqual(run.traced.exception, pinned.exception, `${distribution}: traced exception differs from the reviewed exception`);
    assert.deepStrictEqual(run.untraced.exception, pinned.exception, `${distribution}: unwrapped exception differs from the reviewed exception`);
  }));

  assertion(caseId, 'conformance.counters-match-expected', () => each((distribution, run) => {
    assert.deepStrictEqual(run.traced.counters, pinned.counters, `${distribution}: traced counters differ from the reviewed counters`);
    assert.deepStrictEqual(run.untraced.counters, pinned.counters, `${distribution}: unwrapped counters differ from the reviewed counters`);
  }));

  assertion(caseId, 'conformance.trace-matches-expected', () => each((distribution, run) => {
    assert.deepStrictEqual(run.traced.events, pinned.trace, `${distribution}: traced access trace differs from the reviewed trace`);
  }));

  assertion(caseId, 'conformance.traced-matches-unwrapped', () => each((distribution, run) => {
    assert.deepStrictEqual(run.traced.output, run.untraced.output, `${distribution}: traced output must equal the unwrapped output`);
    assert.deepStrictEqual(run.traced.exception, run.untraced.exception, `${distribution}: traced exception must equal the unwrapped one`);
    assert.deepStrictEqual(run.traced.counters, run.untraced.counters, `${distribution}: traced counters must equal the unwrapped counters`);
  }));

  assertion(caseId, 'trace.deterministic', () => each((distribution, run) => {
    assert.deepStrictEqual(run.repeat.events, run.traced.events, `${distribution}: two traced builds must produce identical traces`);
  }));

  assertion(caseId, 'integrity.inputs-unchanged', () => each((distribution, run) => {
    assert.deepStrictEqual(run.traced.integrityChangedTwins, [], `${distribution}: traced checker must not mutate its inputs`);
    assert.deepStrictEqual(run.untraced.integrityChangedTwins, [], `${distribution}: unwrapped checker must not mutate its inputs`);
  }));

  assertion(caseId, 'aliasing.no-input-leak', () => each((distribution, run) => {
    assert.strictEqual(run.traced.aliasLeaks, 0, `${distribution}: checker output must not carry live input objects`);
  }));

  assertion(caseId, 'identity.all-references-named', () => each((distribution, run) => {
    assert.strictEqual(run.traced.unregisteredReferences, 0, `${distribution}: every caller-visible reference must carry a stable identity`);
    assert.strictEqual(pinned.unregisteredReferences, 0, 'the reviewed corpus must name every reference');
  }));

  assertion(caseId, 'distribution.parity', () => {
    assert.strictEqual(sha256(DISTRIBUTIONS.canonical), sha256(DISTRIBUTIONS.packaged),
      'canonical and packaged doc-evidence.js must be byte-identical in 0A');
    assert.deepStrictEqual(runs.packaged.traced.events, runs.canonical.traced.events, 'packaged trace must equal canonical trace');
    assert.deepStrictEqual(runs.packaged.traced.output, runs.canonical.traced.output, 'packaged output must equal canonical output');
    assert.deepStrictEqual(runs.packaged.traced.counters, runs.canonical.traced.counters, 'packaged counters must equal canonical counters');
    assert.deepStrictEqual(runs.packaged.traced.postReturn, runs.canonical.traced.postReturn, 'packaged post-return run must equal canonical');
  });

  if (item.expect) {
    assertion(caseId, 'result.observation-outcome', () => each((distribution, run) => {
      assert.notStrictEqual(run.traced.output, null, `${distribution}: the checker threw, so no observation/outcome exists`);
      const actual = run.traced.output.results.map(result => [result.observation, result.outcome]);
      assert.deepStrictEqual(actual, item.expect.results, `${distribution}: observation/outcome differs from the matrix expectation`);
    }));

    assertion(caseId, 'result.diagnostic-codes', () => each((distribution, run) => {
      assert.notStrictEqual(run.traced.output, null, `${distribution}: the checker threw, so no diagnostic codes exist`);
      const actual = run.traced.output.diagnostics.map(diagnostic => diagnostic.code).sort();
      assert.deepStrictEqual(actual, [...item.expect.codes].sort(), `${distribution}: diagnostic codes differ from the matrix expectation`);
    }));
  }

  if (pinned.postReturn) {
    assertion(caseId, 'detached.result-unchanged-after-mutation', () => each((distribution, run) => {
      assert.ok(run.traced.postReturn, `${distribution}: a detached case must record a post-return run`);
      assert.strictEqual(run.traced.postReturn.outputUnchangedAfterMutation, true,
        `${distribution}: the first result must not change when caller state changes`);
      assert.deepStrictEqual(run.traced.output, pinned.output, `${distribution}: the first result differs from the reviewed result`);
    }));

    assertion(caseId, 'detached.fresh-invocation-matches-expected', () => each((distribution, run) => {
      assert.deepStrictEqual(run.traced.postReturn.secondOutput, pinned.postReturn.secondOutput,
        `${distribution}: fresh invocation output differs from the reviewed output`);
      assert.deepStrictEqual(run.traced.postReturn.secondEvents, pinned.postReturn.secondEvents,
        `${distribution}: fresh invocation trace differs from the reviewed trace`);
    }));

    if (item.expect && item.expect.secondDiffers) {
      assertion(caseId, 'detached.fresh-invocation-differs', () => each((distribution, run) => {
        assert.notDeepStrictEqual(run.traced.postReturn.secondOutput, run.traced.output,
          `${distribution}: a fresh invocation must see the mutated caller state`);
      }));
    }

    assertion(caseId, 'integrity.post-return-unchanged', () => each((distribution, run) => {
      assert.deepStrictEqual(run.traced.postReturn.secondIntegrityChangedTwins, [],
        `${distribution}: the fresh invocation must not mutate its inputs beyond the factory's writes`);
    }));
  }

  for (const budget of item.budgets) {
    assertion(caseId, budgetClaim(budget), () => each((distribution, run) => {
      const value = budgetValue(budget, run.traced);
      assert.ok(budgetHolds(budget, value), `${distribution}: ${budgetClaim(budget)} observed ${value}, expected ${budget.count !== undefined ? `=${budget.count}` : budget.kind === 'receiver' ? 'receiver identity' : `>=${budget.min}`}`);
    }));
  }
}

if (SELECTED_ASSERTION && !claimedAssertions.has(SELECTED_ASSERTION)) {
  console.error(`infrastructure: HARNESS_ASSERTION_ID ${SELECTED_ASSERTION} is not a claim the corpus makes`);
  process.exit(2);
}

console.log(`\n[341 read-boundary] ${passed} passed, ${failures.length} failed`);
if (failures.length) {
  console.error(`FAILED: ${failures.join(', ')}`);
  process.exitCode = 1;
}
