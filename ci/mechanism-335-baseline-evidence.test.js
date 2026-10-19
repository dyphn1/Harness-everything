'use strict';

// Issue #335: baseline-bound evidence for deleted files and the source endpoint of a rename.
//
// These cases use the real deriveDocFacts -> deriveDocObligations -> checkDocObligations
// round trip on the existing deleted-adr and rename fixtures. Obligations are never
// hand-built, so the test exercises derivation and evidence together.

const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const helper = require('./test-helper');

const sourceRoot = path.join(__dirname, '..', 'harness-everything', 'scripts');
const packageRoot = path.join(__dirname, '..', 'plugins', 'harness-everything', 'skills', 'harness-everything', 'scripts');
const fixtureRoot = path.join(__dirname, 'fixtures', 'doc-obligations', 'derive');

function loadModules(root) {
  return {
    deriveDocFacts: require(path.join(root, 'doc-obligations.js')).deriveDocFacts,
    deriveDocObligations: require(path.join(root, 'doc-obligations.js')).deriveDocObligations,
    checkDocObligations: require(path.join(root, 'doc-evidence.js')).checkDocObligations
  };
}

let modules;
let packageModules;
try {
  modules = loadModules(sourceRoot);
} catch (error) {
  helper.check('335. canonical modules are available', false, error.message);
}
try {
  packageModules = loadModules(packageRoot);
} catch (error) {
  helper.check('335. packaged modules are available', false, error.message);
}

console.log('\n[335] baseline-bound document evidence...');

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
      else {
        const rel = path.relative(root, full).split(path.sep).join('/');
        files[rel.endsWith('.fixture') ? rel.slice(0, -'.fixture'.length) : rel] = fs.readFileSync(full, 'utf8');
      }
    }
  };
  walk(root);
  return files;
}

function loadCase(name) {
  const caseDir = path.join(fixtureRoot, name);
  return {
    base: { files: readTree(path.join(caseDir, 'base')) },
    candidate: { files: readTree(path.join(caseDir, 'candidate')) }
  };
}

function caseConfig(name) {
  const own = path.join(fixtureRoot, name, 'config.json');
  return fs.existsSync(own) ? JSON.parse(fs.readFileSync(own, 'utf8')) : JSON.parse(fs.readFileSync(path.join(fixtureRoot, 'config.json'), 'utf8'));
}

function treeDigest(files) {
  return sha256(JSON.stringify(Object.keys(files).sort().map(file => [file, files[file]])));
}

function prepare(name, target = modules) {
  const input = loadCase(name);
  const { facts } = target.deriveDocFacts({ base: input.base, candidate: input.candidate, config: caseConfig(name) });
  const obligations = target.deriveDocObligations(facts);
  const artifacts = {};
  for (const [file, text] of Object.entries(input.candidate.files)) artifacts[file] = { digest: sha256(text) };
  const baseline = {
    digest: treeDigest(input.base.files),
    artifacts: Object.fromEntries(Object.entries(input.base.files).map(([file, text]) => [file, sha256(text)]))
  };
  return { input, facts, obligations, artifacts, baseline };
}

function obligationOf(ctx, id) {
  return ctx.obligations.find(item => item.id === id);
}

function resultOf(output, id) {
  return output.results.find(item => item.obligationId === id);
}

function check(ctx, { executionRecords = [], reviewRecords = [], baseline = ctx.baseline, obligations = ctx.obligations, artifacts = ctx.artifacts } = {}, target = modules) {
  return target.checkDocObligations({ obligations, artifacts, baseline, executionRecords, reviewRecords });
}

// P3 input-boundary helper: distinguish an omitted `artifacts` key from an explicit value,
// including an explicit `undefined` or `{}`.
const OMIT_ARTIFACTS = Symbol('omit artifacts');
function checkArtifacts(ctx, artifactsArg, { executionRecords = [], reviewRecords = [], baseline = ctx.baseline, obligations = ctx.obligations } = {}, target = modules) {
  const args = { obligations, baseline, executionRecords, reviewRecords };
  if (artifactsArg !== OMIT_ARTIFACTS) args.artifacts = artifactsArg;
  return target.checkDocObligations(args);
}

function digestMap(ctx, paths) {
  return Object.fromEntries(paths.map(file => [file, ctx.artifacts[file].digest]));
}

function baselineMapFor(ctx, paths) {
  return Object.fromEntries(paths.map(file => [file, ctx.baseline.artifacts[file]]));
}

// A complete execution record. Candidate paths carry candidate digests; baseline-only
// paths carry trusted baseline digests.
function execRecord(ctx, id, obligationId, { paths, candidatePaths = paths, baselinePaths = [], artifactDigests, baselineArtifacts, ...overrides } = {}) {
  return {
    id,
    obligationId,
    command: `node ci/mechanism-335-baseline-evidence.test.js # ${obligationId}`,
    exitCode: 0,
    provenance: '335 fixture execution record bound to the trusted baseline',
    baseDigest: ctx.baseline.digest,
    paths: [...paths],
    artifactDigests: artifactDigests === undefined ? digestMap(ctx, candidatePaths.filter(file => ctx.artifacts[file])) : artifactDigests,
    baselineArtifacts: baselineArtifacts === undefined ? baselineMapFor(ctx, baselinePaths) : baselineArtifacts,
    ...overrides
  };
}

function reviewRecord(ctx, id, obligationId, { paths, candidatePaths = paths, baselinePaths = [], artifactDigests, baselineArtifacts, ...overrides } = {}) {
  return {
    ...execRecord(ctx, id, obligationId, { paths, candidatePaths, baselinePaths, artifactDigests, baselineArtifacts }),
    kind: 'review',
    verdict: 'approve',
    summary: 'independent reviewer approved the baseline-bound change',
    ...overrides
  };
}

function diagnosticCodes(output) {
  return output.diagnostics.map(item => item.code);
}

function checkCase(name, run) {
  try {
    run();
    helper.check(name, true);
  } catch (error) {
    helper.check(name, false, error && error.message ? error.message : String(error));
  }
}

const DELETED_ADR = 'docs/adr/GRPH-008.md';
const RENAME_FROM = 'docs/reference/old-guide.md';
const RENAME_TO = 'docs/reference/guide.md';
const GUIDE = 'docs/reference/guide.md';

// ---------------------------------------------------------------------------
// Derivation shape: scope.paths is preserved and baseline paths are annotated.
// ---------------------------------------------------------------------------

checkCase('335 derivation annotates the deleted ADR without dropping it from scope.paths', () => {
  const ctx = prepare('deleted-adr');
  const lint = obligationOf(ctx, 'doc-change:doc-lint');
  assert.ok(lint.scope.paths.includes(DELETED_ADR), 'the deleted path stays in scope.paths');
  assert.deepStrictEqual(lint.scope.baselinePaths,
    [{ path: DELETED_ADR, reason: 'deleted' }], 'the deleted path is annotated as baseline-only');
  assert.deepStrictEqual(obligationOf(ctx, 'doc-change:quality-review').scope.baselinePaths,
    [{ path: DELETED_ADR, reason: 'deleted' }], 'normative obligations carry the same annotation');
});

checkCase('335 derivation annotates a rename source with its destination and keeps both scope paths', () => {
  const ctx = prepare('rename');
  const lint = obligationOf(ctx, 'doc-change:doc-lint');
  assert.ok(lint.scope.paths.includes(RENAME_FROM) && lint.scope.paths.includes(RENAME_TO),
    `scope.paths keeps both endpoints: ${JSON.stringify(lint.scope.paths)}`);
  assert.deepStrictEqual(lint.scope.baselinePaths,
    [{ path: RENAME_FROM, reason: 'rename-from', renameTo: RENAME_TO }], 'the old endpoint is baseline-only');
  assert.ok(!lint.scope.baselinePaths.some(entry => entry.path === RENAME_TO),
    'the rename destination is not baseline-only');
});

// ---------------------------------------------------------------------------
// Positive controls: deletion tombstones and rename pairs pass.
// ---------------------------------------------------------------------------

checkCase('335 deleted ADR: baseline-bound lint, link, conflict and review evidence passes', () => {
  const ctx = prepare('deleted-adr');
  const output = check(ctx, {
    executionRecords: [
      execRecord(ctx, 'lint-run', 'doc-change:doc-lint', { paths: [DELETED_ADR], candidatePaths: [], baselinePaths: [DELETED_ADR] }),
      execRecord(ctx, 'links-run', 'doc-change:link-check', { paths: [DELETED_ADR], candidatePaths: [], baselinePaths: [DELETED_ADR] }),
      execRecord(ctx, 'conflict-run', 'doc-change:conflict-check', { paths: [DELETED_ADR], candidatePaths: [], baselinePaths: [DELETED_ADR] })
    ],
    reviewRecords: [
      reviewRecord(ctx, 'review-run', 'doc-change:quality-review', { paths: [DELETED_ADR], candidatePaths: [], baselinePaths: [DELETED_ADR] })
    ]
  });
  for (const id of ['doc-change:doc-lint', 'doc-change:link-check', 'doc-change:quality-review', 'doc-change:conflict-check']) {
    const result = resultOf(output, id);
    assert.ok(result, `${id} has a result`);
    assert.strictEqual(result.observation, 'observed', `${id} observation`);
    assert.strictEqual(result.outcome, 'pass', `${id} outcome`);
  }
  const lint = resultOf(output, 'doc-change:doc-lint');
  assert.strictEqual(lint.baseDigest, ctx.baseline.digest, 'result records the whole-baseline identity');
  assert.strictEqual(lint.baselineArtifacts[DELETED_ADR], ctx.baseline.artifacts[DELETED_ADR],
    'result exposes the trusted per-path baseline digest');
  assert.ok(lint.recordRefs.includes('lint-run'), 'the tombstone record is cited');
  assert.ok(!output.diagnostics.some(item => item.code === 'missing-path-coverage'),
    `no path-coverage diagnostic on a complete tombstone: ${JSON.stringify(output.diagnostics)}`);
});

checkCase('335 identified rename: one record binding both endpoints satisfies lint and links', () => {
  const ctx = prepare('rename');
  const output = check(ctx, {
    executionRecords: [
      execRecord(ctx, 'move-run', 'doc-change:doc-lint', {
        paths: [RENAME_FROM, RENAME_TO], candidatePaths: [RENAME_TO], baselinePaths: [RENAME_FROM]
      }),
      execRecord(ctx, 'move-links', 'doc-change:link-check', {
        paths: [RENAME_FROM, RENAME_TO], candidatePaths: [RENAME_TO], baselinePaths: [RENAME_FROM]
      })
    ]
  });
  for (const id of ['doc-change:doc-lint', 'doc-change:link-check']) {
    const result = resultOf(output, id);
    assert.strictEqual(result.outcome, 'pass', `${id} passes with a single pair record: ${JSON.stringify(result)}`);
    assert.strictEqual(result.baselineArtifacts[RENAME_FROM], ctx.baseline.artifacts[RENAME_FROM],
      `${id} records the rename source digest`);
  }
});

// ---------------------------------------------------------------------------
// Deletion negative controls.
// ---------------------------------------------------------------------------

checkCase('335 deleted ADR with no evidence stays none', () => {
  const ctx = prepare('deleted-adr');
  const output = check(ctx);
  for (const id of ['doc-change:doc-lint', 'doc-change:link-check', 'doc-change:quality-review', 'doc-change:conflict-check']) {
    assert.notStrictEqual(resultOf(output, id).outcome, 'pass', `${id} cannot pass without evidence`);
  }
});

checkCase('335 deleted ADR stale whole-baseline identity is rejected', () => {
  const ctx = prepare('deleted-adr');
  const output = check(ctx, {
    executionRecords: [execRecord(ctx, 'lint-run', 'doc-change:doc-lint', {
      paths: [DELETED_ADR], candidatePaths: [], baselinePaths: [DELETED_ADR], baseDigest: sha256('another baseline')
    })]
  });
  assert.notStrictEqual(resultOf(output, 'doc-change:doc-lint').outcome, 'pass', 'a different baseline cannot pass');
  assert.ok(diagnosticCodes(output).includes('stale-base-digest'), `stale base is diagnosed: ${diagnosticCodes(output)}`);
});

checkCase('335 deleted ADR wrong per-path baseline digest is rejected', () => {
  const ctx = prepare('deleted-adr');
  const output = check(ctx, {
    executionRecords: [execRecord(ctx, 'lint-run', 'doc-change:doc-lint', {
      paths: [DELETED_ADR], candidatePaths: [], baselinePaths: [],
      baselineArtifacts: { [DELETED_ADR]: sha256('another baseline file') }
    })]
  });
  assert.notStrictEqual(resultOf(output, 'doc-change:doc-lint').outcome, 'pass', 'a wrong old-path digest cannot pass');
  assert.ok(diagnosticCodes(output).includes('stale-baseline-artifact-digest'),
    `wrong baseline digest is diagnosed: ${diagnosticCodes(output)}`);
});

checkCase('335 deleted ADR missing baseline.artifacts fails closed', () => {
  const ctx = prepare('deleted-adr');
  const output = check(ctx, {
    executionRecords: [execRecord(ctx, 'lint-run', 'doc-change:doc-lint', {
      paths: [DELETED_ADR], candidatePaths: [], baselinePaths: [DELETED_ADR]
    })],
    baseline: { digest: ctx.baseline.digest }
  });
  assert.notStrictEqual(resultOf(output, 'doc-change:doc-lint').outcome, 'pass', 'absent baseline artifacts fail closed');
  assert.ok(diagnosticCodes(output).includes('baseline-artifacts-missing'),
    `missing baseline artifacts are diagnosed: ${diagnosticCodes(output)}`);
});

checkCase('335 deleted ADR missing per-path baseline binding on the record is not a pass', () => {
  const ctx = prepare('deleted-adr');
  const output = check(ctx, {
    executionRecords: [execRecord(ctx, 'lint-run', 'doc-change:doc-lint', {
      paths: [DELETED_ADR], candidatePaths: [], baselineArtifacts: {}
    })]
  });
  assert.notStrictEqual(resultOf(output, 'doc-change:doc-lint').outcome, 'pass', 'a record without the old-path binding cannot pass');
  assert.ok(diagnosticCodes(output).includes('missing-path-coverage'),
    `unbound baseline path is diagnosed: ${diagnosticCodes(output)}`);
});

checkCase('335 deleted path that still has a candidate artifact is a contradiction and fails closed', () => {
  const ctx = prepare('deleted-adr');
  ctx.artifacts[DELETED_ADR] = { digest: sha256('a candidate artifact for a deleted path') };
  const output = check(ctx, {
    executionRecords: [execRecord(ctx, 'lint-run', 'doc-change:doc-lint', {
      paths: [DELETED_ADR], candidatePaths: [DELETED_ADR], baselinePaths: []
    })]
  });
  assert.notStrictEqual(resultOf(output, 'doc-change:doc-lint').outcome, 'pass',
    'a candidate-present contradiction cannot pass');
  assert.ok(diagnosticCodes(output).includes('baseline-path-candidate-present'),
    `candidate-present contradiction is diagnosed: ${diagnosticCodes(output)}`);
});

checkCase('335 absent whole-baseline identity fails closed for a declared baseline path', () => {
  const ctx = prepare('deleted-adr');
  const output = check(ctx, {
    executionRecords: [execRecord(ctx, 'lint-run', 'doc-change:doc-lint', {
      paths: [DELETED_ADR], candidatePaths: [], baselinePaths: [DELETED_ADR]
    })],
    baseline: { artifacts: ctx.baseline.artifacts }
  });
  assert.notStrictEqual(resultOf(output, 'doc-change:doc-lint').outcome, 'pass', 'absent baseline identity cannot pass');
  assert.ok(diagnosticCodes(output).includes('baseline-identity-missing'),
    `absent baseline identity is diagnosed: ${diagnosticCodes(output)}`);
});

checkCase('335 invalid per-path baseline digest fails closed', () => {
  const ctx = prepare('deleted-adr');
  const output = check(ctx, {
    executionRecords: [execRecord(ctx, 'lint-run', 'doc-change:doc-lint', {
      paths: [DELETED_ADR], candidatePaths: [], baselinePaths: []
    })],
    baseline: { digest: ctx.baseline.digest, artifacts: { [DELETED_ADR]: 'not-a-sha256-digest' } }
  });
  assert.notStrictEqual(resultOf(output, 'doc-change:doc-lint').outcome, 'pass', 'an invalid baseline digest cannot pass');
  assert.ok(diagnosticCodes(output).includes('baseline-artifact-invalid'),
    `invalid baseline digest is diagnosed: ${diagnosticCodes(output)}`);
});

checkCase('335 malformed baselinePaths metadata fails closed', () => {
  const ctx = prepare('deleted-adr');
  const mutate = (baselinePaths) => check(ctx, {
    obligations: ctx.obligations.map(item => item.capability === 'doc-lint'
      ? { ...item, scope: { ...item.scope, baselinePaths } }
      : item),
    executionRecords: [execRecord(ctx, 'lint-run', 'doc-change:doc-lint', {
      paths: [DELETED_ADR], candidatePaths: [], baselinePaths: [DELETED_ADR]
    })]
  });
  const cases = [
    [{ path: DELETED_ADR, reason: 'deleted' }, { path: DELETED_ADR, reason: 'deleted' }],
    [{ path: 'docs/adr/not-in-scope.md', reason: 'deleted' }],
    [{ path: DELETED_ADR, reason: 'moved' }],
    [{ path: DELETED_ADR, reason: 'rename-from' }],
    [{ path: DELETED_ADR, reason: 'rename-from', renameTo: DELETED_ADR }]
  ];
  for (const baselinePaths of cases) {
    const output = mutate(baselinePaths);
    assert.notStrictEqual(resultOf(output, 'doc-change:doc-lint').outcome, 'pass',
      `malformed metadata fails closed: ${JSON.stringify(baselinePaths)}`);
    assert.ok(diagnosticCodes(output).includes('baseline-path-invalid'),
      `malformed metadata is diagnosed: ${JSON.stringify(baselinePaths)} -> ${diagnosticCodes(output)}`);
  }
});

// ---------------------------------------------------------------------------
// Rename negative controls.
// ---------------------------------------------------------------------------

checkCase('335 rename destination-only evidence cannot satisfy the source endpoint', () => {
  const ctx = prepare('rename');
  const output = check(ctx, {
    executionRecords: [execRecord(ctx, 'dest-run', 'doc-change:doc-lint', {
      paths: [RENAME_TO], candidatePaths: [RENAME_TO], baselinePaths: []
    })]
  });
  assert.notStrictEqual(resultOf(output, 'doc-change:doc-lint').outcome, 'pass', 'the source endpoint stays unmet');
  assert.ok(JSON.stringify(output.diagnostics).includes(RENAME_FROM),
    `the diagnostic names the unmet source: ${JSON.stringify(output.diagnostics)}`);
});

checkCase('335 rename source-only tombstone cannot satisfy the source endpoint', () => {
  const ctx = prepare('rename');
  const output = check(ctx, {
    executionRecords: [execRecord(ctx, 'source-run', 'doc-change:doc-lint', {
      paths: [RENAME_FROM], candidatePaths: [], baselinePaths: [RENAME_FROM]
    })]
  });
  assert.notStrictEqual(resultOf(output, 'doc-change:doc-lint').outcome, 'pass',
    'a deletion tombstone alone cannot satisfy a known rename');
});

checkCase('335 split endpoint records cannot satisfy the source endpoint', () => {
  const ctx = prepare('rename');
  const output = check(ctx, {
    executionRecords: [
      execRecord(ctx, 'source-run', 'doc-change:doc-lint', { paths: [RENAME_FROM], candidatePaths: [], baselinePaths: [RENAME_FROM] }),
      execRecord(ctx, 'dest-run', 'doc-change:doc-lint', { paths: [RENAME_TO], candidatePaths: [RENAME_TO], baselinePaths: [] })
    ]
  });
  assert.notStrictEqual(resultOf(output, 'doc-change:doc-lint').outcome, 'pass',
    'two records, one per endpoint, cannot satisfy a rename');
  assert.ok(JSON.stringify(output.diagnostics).includes(RENAME_FROM),
    `the diagnostic names the unmet source: ${JSON.stringify(output.diagnostics)}`);
});

checkCase('335 rename pair with a stale destination digest cannot pass', () => {
  const ctx = prepare('rename');
  const output = check(ctx, {
    executionRecords: [execRecord(ctx, 'move-run', 'doc-change:doc-lint', {
      paths: [RENAME_FROM, RENAME_TO], baselinePaths: [RENAME_FROM],
      artifactDigests: { [RENAME_TO]: sha256('stale destination content') }
    })]
  });
  assert.notStrictEqual(resultOf(output, 'doc-change:doc-lint').outcome, 'pass', 'a stale destination cannot pass');
  assert.ok(diagnosticCodes(output).includes('stale-artifact-digest'),
    `stale destination is diagnosed: ${diagnosticCodes(output)}`);
});

checkCase('335 rename pair missing the source endpoint in paths cannot pass', () => {
  const ctx = prepare('rename');
  const output = check(ctx, {
    executionRecords: [execRecord(ctx, 'move-run', 'doc-change:doc-lint', {
      paths: [RENAME_TO], candidatePaths: [RENAME_TO], baselinePaths: [RENAME_FROM]
    })]
  });
  assert.notStrictEqual(resultOf(output, 'doc-change:doc-lint').outcome, 'pass',
    'a record must list the old path explicitly');
});

checkCase('335 rename pair missing the destination candidate digest cannot pass', () => {
  const ctx = prepare('rename');
  const output = check(ctx, {
    executionRecords: [execRecord(ctx, 'move-run', 'doc-change:doc-lint', {
      paths: [RENAME_FROM, RENAME_TO], candidatePaths: [], baselinePaths: [RENAME_FROM]
    })]
  });
  assert.notStrictEqual(resultOf(output, 'doc-change:doc-lint').outcome, 'pass',
    'the current destination digest is required');
});

checkCase('335 rename with the wrong old-path baseline digest cannot pass', () => {
  const ctx = prepare('rename');
  const output = check(ctx, {
    executionRecords: [execRecord(ctx, 'move-run', 'doc-change:doc-lint', {
      paths: [RENAME_FROM, RENAME_TO], candidatePaths: [RENAME_TO],
      baselineArtifacts: { [RENAME_FROM]: sha256('wrong old content') }
    })]
  });
  assert.notStrictEqual(resultOf(output, 'doc-change:doc-lint').outcome, 'pass',
    'a wrong old-path digest cannot satisfy the rename source');
  assert.ok(diagnosticCodes(output).includes('stale-baseline-artifact-digest'),
    `wrong old-path digest is diagnosed: ${diagnosticCodes(output)}`);
});

checkCase('335 rename whose destination has no candidate artifact fails closed', () => {
  const ctx = prepare('rename');
  delete ctx.artifacts[RENAME_TO];
  const output = check(ctx, {
    executionRecords: [execRecord(ctx, 'move-run', 'doc-change:doc-lint', {
      paths: [RENAME_FROM, RENAME_TO], candidatePaths: [], baselinePaths: [RENAME_FROM]
    })]
  });
  assert.notStrictEqual(resultOf(output, 'doc-change:doc-lint').outcome, 'pass',
    'a rename destination without a candidate artifact fails closed');
  assert.ok(diagnosticCodes(output).includes('baseline-path-invalid'),
    `absent rename destination is diagnosed: ${diagnosticCodes(output)}`);
});

// ---------------------------------------------------------------------------
// Normal candidate-bound edits and failing/unsupported evidence.
// ---------------------------------------------------------------------------

checkCase('335 normal candidate-bound edits still pass and baseline-only digests cannot substitute', () => {
  const ctx = prepare('docs-only');
  const bound = check(ctx, {
    executionRecords: [
      execRecord(ctx, 'lint-run', 'doc-change:doc-lint', { paths: [GUIDE], candidatePaths: [GUIDE] }),
      execRecord(ctx, 'links-run', 'doc-change:link-check', { paths: [GUIDE], candidatePaths: [GUIDE] })
    ]
  });
  assert.strictEqual(resultOf(bound, 'doc-change:doc-lint').outcome, 'pass', 'a normal candidate-bound edit passes');
  const baselineOnly = check(ctx, {
    executionRecords: [execRecord(ctx, 'lint-run', 'doc-change:doc-lint', {
      paths: [GUIDE], candidatePaths: [], baselineArtifacts: baselineMapFor(ctx, [GUIDE])
    })]
  });
  assert.notStrictEqual(resultOf(baselineOnly, 'doc-change:doc-lint').outcome, 'pass',
    'a baseline-only digest cannot satisfy a normal edited artifact');
});

checkCase('335 correctly bound failing command still fails (never pass, never none)', () => {
  const ctx = prepare('deleted-adr');
  const output = check(ctx, {
    executionRecords: [execRecord(ctx, 'lint-run', 'doc-change:doc-lint', {
      paths: [DELETED_ADR], candidatePaths: [], baselinePaths: [DELETED_ADR], exitCode: 1
    })]
  });
  const result = resultOf(output, 'doc-change:doc-lint');
  assert.strictEqual(result.observation, 'observed', 'a bound failing command is observed');
  assert.strictEqual(result.outcome, 'fail', 'a bound failing command fails');
});

checkCase('335 unsupported review kind and unapproved review cannot satisfy a baseline-only review MUST', () => {
  const ctx = prepare('deleted-adr');
  for (const bad of [
    reviewRecord(ctx, 'review-run', 'doc-change:quality-review', { paths: [DELETED_ADR], candidatePaths: [], baselinePaths: [DELETED_ADR], kind: 'note' }),
    reviewRecord(ctx, 'review-run', 'doc-change:quality-review', { paths: [DELETED_ADR], candidatePaths: [], baselinePaths: [DELETED_ADR], verdict: 'reject' })
  ]) {
    const output = check(ctx, { reviewRecords: [bad] });
    assert.notStrictEqual(resultOf(output, 'doc-change:quality-review').outcome, 'pass',
      'only an approved review can satisfy quality-review');
  }
});

checkCase('335 incomplete execution record on a baseline-only path is not a pass', () => {
  const ctx = prepare('deleted-adr');
  const output = check(ctx, {
    executionRecords: [execRecord(ctx, 'lint-run', 'doc-change:doc-lint', {
      paths: [DELETED_ADR], candidatePaths: [], baselinePaths: [DELETED_ADR], command: undefined, provenance: undefined
    })]
  });
  assert.notStrictEqual(resultOf(output, 'doc-change:doc-lint').outcome, 'pass', 'incomplete execution evidence cannot pass');
  assert.ok(diagnosticCodes(output).includes('execution-record-incomplete'),
    `incomplete execution is diagnosed: ${diagnosticCodes(output)}`);
});

// ---------------------------------------------------------------------------
// Determinism, no input mutation, and source/package parity.
// ---------------------------------------------------------------------------

checkCase('335 baseline derivation, evidence and check are deterministic and do not mutate inputs', () => {
  const first = prepare('deleted-adr');
  const second = prepare('deleted-adr');
  assert.deepStrictEqual(second.obligations, first.obligations, 'same inputs derive the same obligations');
  const records = {
    executionRecords: [
      execRecord(first, 'lint-run', 'doc-change:doc-lint', { paths: [DELETED_ADR], candidatePaths: [], baselinePaths: [DELETED_ADR] })
    ]
  };
  const snapshot = JSON.stringify({ obligations: first.obligations, artifacts: first.artifacts, baseline: first.baseline, records });
  const outputA = check(first, records);
  const outputB = check(second, records);
  assert.deepStrictEqual(outputB, outputA, 'same inputs produce the same check output');
  assert.strictEqual(JSON.stringify({ obligations: first.obligations, artifacts: first.artifacts, baseline: first.baseline, records }), snapshot,
    'the check does not mutate its inputs');
});

checkCase('335 canonical and packaged modules produce identical baseline-bound results', () => {
  for (const fixture of ['deleted-adr', 'rename']) {
    const sourceCtx = prepare(fixture, modules);
    const packageCtx = prepare(fixture, packageModules);
    const sourceRecords = fixture === 'rename'
      ? { executionRecords: [
          execRecord(sourceCtx, 'move-run', 'doc-change:doc-lint', { paths: [RENAME_FROM, RENAME_TO], candidatePaths: [RENAME_TO], baselinePaths: [RENAME_FROM] }),
          execRecord(sourceCtx, 'move-links', 'doc-change:link-check', { paths: [RENAME_FROM, RENAME_TO], candidatePaths: [RENAME_TO], baselinePaths: [RENAME_FROM] })
        ] }
      : { executionRecords: [
          execRecord(sourceCtx, 'lint-run', 'doc-change:doc-lint', { paths: [DELETED_ADR], candidatePaths: [], baselinePaths: [DELETED_ADR] }),
          execRecord(sourceCtx, 'links-run', 'doc-change:link-check', { paths: [DELETED_ADR], candidatePaths: [], baselinePaths: [DELETED_ADR] })
        ] };
    const packageRecords = fixture === 'rename'
      ? { executionRecords: [
          execRecord(packageCtx, 'move-run', 'doc-change:doc-lint', { paths: [RENAME_FROM, RENAME_TO], candidatePaths: [RENAME_TO], baselinePaths: [RENAME_FROM] }),
          execRecord(packageCtx, 'move-links', 'doc-change:link-check', { paths: [RENAME_FROM, RENAME_TO], candidatePaths: [RENAME_TO], baselinePaths: [RENAME_FROM] })
        ] }
      : { executionRecords: [
          execRecord(packageCtx, 'lint-run', 'doc-change:doc-lint', { paths: [DELETED_ADR], candidatePaths: [], baselinePaths: [DELETED_ADR] }),
          execRecord(packageCtx, 'links-run', 'doc-change:link-check', { paths: [DELETED_ADR], candidatePaths: [], baselinePaths: [DELETED_ADR] })
        ] };
    const sourceOutput = check(sourceCtx, sourceRecords, modules);
    const packageOutput = check(packageCtx, packageRecords, packageModules);
    assert.deepStrictEqual(packageOutput.results, sourceOutput.results,
      `${fixture}: packaged evidence results match the canonical module`);
    assert.deepStrictEqual(packageOutput.diagnostics, sourceOutput.diagnostics,
      `${fixture}: packaged evidence diagnostics match the canonical module`);
  }
});

// ---------------------------------------------------------------------------
// Remediation (cold-review finding 1): a record that carries a candidate digest
// for a baseline-only path is contradictory and must not bind, even when the
// baseline fields are otherwise correct. A valid alternate record may still pass.
// ---------------------------------------------------------------------------

checkCase('335 deleted path: a record carrying a candidate digest for the deleted path is rejected', () => {
  const ctx = prepare('deleted-adr');
  const ghost = execRecord(ctx, 'ghost-run', 'doc-change:doc-lint', {
    paths: [DELETED_ADR], candidatePaths: [], baselinePaths: [DELETED_ADR],
    artifactDigests: { [DELETED_ADR]: sha256('ghost candidate content') }
  });
  const output = check(ctx, { executionRecords: [ghost] });
  assert.notStrictEqual(resultOf(output, 'doc-change:doc-lint').outcome, 'pass',
    'a record with a candidate digest for a deleted path cannot bind');
  assert.ok(diagnosticCodes(output).includes('baseline-path-candidate-digest'),
    `the contradictory record is diagnosed: ${diagnosticCodes(output)}`);
});

checkCase('335 deleted path: a contradictory ghost record does not block a valid alternate tombstone', () => {
  const ctx = prepare('deleted-adr');
  const output = check(ctx, {
    executionRecords: [
      execRecord(ctx, 'ghost-run', 'doc-change:doc-lint', {
        paths: [DELETED_ADR], candidatePaths: [], baselinePaths: [DELETED_ADR],
        artifactDigests: { [DELETED_ADR]: sha256('ghost candidate content') }
      }),
      execRecord(ctx, 'clean-run', 'doc-change:doc-lint', {
        paths: [DELETED_ADR], candidatePaths: [], baselinePaths: [DELETED_ADR]
      })
    ]
  });
  assert.strictEqual(resultOf(output, 'doc-change:doc-lint').outcome, 'pass',
    'a valid alternate tombstone still satisfies the obligation');
  assert.ok(resultOf(output, 'doc-change:doc-lint').recordRefs.includes('clean-run'),
    'only the clean record is cited');
});

checkCase('335 deleted path: a review record carrying a candidate digest for the deleted path is rejected', () => {
  const ctx = prepare('deleted-adr');
  const output = check(ctx, {
    reviewRecords: [reviewRecord(ctx, 'ghost-review', 'doc-change:quality-review', {
      paths: [DELETED_ADR], candidatePaths: [], baselinePaths: [DELETED_ADR],
      artifactDigests: { [DELETED_ADR]: sha256('ghost candidate content') }
    })]
  });
  assert.notStrictEqual(resultOf(output, 'doc-change:quality-review').outcome, 'pass',
    'a review record with a candidate digest for a deleted path cannot bind');
  assert.ok(diagnosticCodes(output).includes('baseline-path-candidate-digest'),
    `the contradictory review record is diagnosed: ${diagnosticCodes(output)}`);
});

checkCase('335 rename source: a single pair record carrying a candidate digest for the old path is rejected', () => {
  const ctx = prepare('rename');
  const output = check(ctx, {
    executionRecords: [execRecord(ctx, 'move-run', 'doc-change:doc-lint', {
      paths: [RENAME_FROM, RENAME_TO], candidatePaths: [RENAME_TO], baselinePaths: [RENAME_FROM],
      artifactDigests: {
        [RENAME_FROM]: sha256('ghost old endpoint'),
        [RENAME_TO]: ctx.artifacts[RENAME_TO].digest
      }
    })]
  });
  assert.notStrictEqual(resultOf(output, 'doc-change:doc-lint').outcome, 'pass',
    'a pair record with a ghost old-path digest cannot satisfy the rename source');
  assert.ok(diagnosticCodes(output).includes('baseline-path-candidate-digest'),
    `the contradictory pair record is diagnosed: ${diagnosticCodes(output)}`);
});

// ---------------------------------------------------------------------------
// Remediation (orchestrator probe 2): candidate artifact map OLD path present
// with an invalid/absent digest. Own-key presence is not deletion; it is
// contradictory path state and fails closed.
// ---------------------------------------------------------------------------

checkCase('335 deleted path: a present-but-invalid candidate entry fails closed (own-key presence)', () => {
  for (const bad of [{}, { digest: '' }, null]) {
    const ctx = prepare('deleted-adr');
    ctx.artifacts[DELETED_ADR] = bad;
    const output = check(ctx, {
      executionRecords: [execRecord(ctx, 'tomb-run', 'doc-change:doc-lint', {
        paths: [DELETED_ADR], candidatePaths: [], baselinePaths: [DELETED_ADR]
      })]
    });
    assert.notStrictEqual(resultOf(output, 'doc-change:doc-lint').outcome, 'pass',
      `present candidate entry ${JSON.stringify(bad)} cannot be treated as a deletion`);
    assert.ok(diagnosticCodes(output).includes('baseline-path-candidate-present'),
      `present candidate entry is diagnosed: ${JSON.stringify(bad)} -> ${diagnosticCodes(output)}`);
  }
});

checkCase('335 rename source: a present-but-invalid candidate entry fails closed (own-key presence)', () => {
  for (const bad of [{}, { digest: '' }, null]) {
    const ctx = prepare('rename');
    ctx.artifacts[RENAME_FROM] = bad;
    const output = check(ctx, {
      executionRecords: [execRecord(ctx, 'move-run', 'doc-change:doc-lint', {
        paths: [RENAME_FROM, RENAME_TO], candidatePaths: [RENAME_TO], baselinePaths: [RENAME_FROM]
      })]
    });
    assert.notStrictEqual(resultOf(output, 'doc-change:doc-lint').outcome, 'pass',
      `present candidate entry ${JSON.stringify(bad)} cannot be treated as a rename source`);
    assert.ok(diagnosticCodes(output).includes('baseline-path-candidate-present'),
      `present candidate entry is diagnosed: ${JSON.stringify(bad)} -> ${diagnosticCodes(output)}`);
  }
});

checkCase('335 missing per-path binding is visible as baseline-binding-missing', () => {
  const ctx = prepare('deleted-adr');
  const output = check(ctx, {
    executionRecords: [execRecord(ctx, 'lint-run', 'doc-change:doc-lint', {
      paths: [DELETED_ADR], candidatePaths: [], baselineArtifacts: {}
    })]
  });
  assert.notStrictEqual(resultOf(output, 'doc-change:doc-lint').outcome, 'pass');
  assert.ok(diagnosticCodes(output).includes('baseline-binding-missing'),
    `a record that names a baseline path without a binding is diagnosed: ${diagnosticCodes(output)}`);
});

// ---------------------------------------------------------------------------
// P3 input boundary: an absent or malformed top-level candidate artifact map is
// not a deletion inventory. It is unknown input and fails baseline-only
// obligations closed; an explicit {} remains a valid empty deletion inventory.
// ---------------------------------------------------------------------------

const INVALID_ARTIFACTS = [
  ['omitted', OMIT_ARTIFACTS],
  ['undefined', undefined],
  ['null', null],
  ['array', [DELETED_ADR]],
  ['string', 'not-a-map'],
  ['boolean', false]
];

checkCase('335 P3 deletion: absent or malformed top-level artifacts fails closed', () => {
  const failures = [];
  for (const [label, value] of INVALID_ARTIFACTS) {
    const ctx = prepare('deleted-adr');
    const output = checkArtifacts(ctx, value, {
      executionRecords: [execRecord(ctx, 'tomb-run', 'doc-change:doc-lint', {
        paths: [DELETED_ADR], candidatePaths: [], baselinePaths: [DELETED_ADR]
      })]
    });
    const result = resultOf(output, 'doc-change:doc-lint');
    if (result.outcome !== 'none') failures.push(`${label}: outcome=${result.outcome}`);
    if (!diagnosticCodes(output).includes('candidate-artifacts-invalid')) {
      failures.push(`${label}: diagnostics=${diagnosticCodes(output)}`);
    }
  }
  assert.deepStrictEqual(failures, [],
    `all absent/malformed candidate inventory variants must fail closed: ${failures.join('; ')}`);
});

checkCase('335 P3 deletion: an approving review cannot pass with absent top-level artifacts', () => {
  const ctx = prepare('deleted-adr');
  const output = checkArtifacts(ctx, OMIT_ARTIFACTS, {
    reviewRecords: [reviewRecord(ctx, 'review-run', 'doc-change:quality-review', {
      paths: [DELETED_ADR], candidatePaths: [], baselinePaths: [DELETED_ADR]
    })]
  });
  assert.strictEqual(resultOf(output, 'doc-change:quality-review').outcome, 'none',
    'an approving review cannot satisfy quality-review without a known candidate inventory');
  assert.ok(diagnosticCodes(output).includes('candidate-artifacts-invalid'),
    `candidate inventory is diagnosed: ${diagnosticCodes(output)}`);
});

checkCase('335 P3 rename: absent or malformed top-level artifacts fails closed', () => {
  const failures = [];
  for (const [label, value] of INVALID_ARTIFACTS) {
    const ctx = prepare('rename');
    const output = checkArtifacts(ctx, value, {
      executionRecords: [execRecord(ctx, 'move-run', 'doc-change:doc-lint', {
        paths: [RENAME_FROM, RENAME_TO], candidatePaths: [RENAME_TO], baselinePaths: [RENAME_FROM]
      })]
    });
    const result = resultOf(output, 'doc-change:doc-lint');
    if (result.outcome !== 'none') failures.push(`${label}: outcome=${result.outcome}`);
    if (!diagnosticCodes(output).includes('candidate-artifacts-invalid')) {
      failures.push(`${label}: diagnostics=${diagnosticCodes(output)}`);
    }
  }
  assert.deepStrictEqual(failures, [],
    `rename must fail closed for every absent/malformed inventory: ${failures.join('; ')}`);
});

checkCase('335 P3 deletion: explicit empty object remains a valid empty deletion inventory', () => {
  const ctx = prepare('deleted-adr');
  const output = checkArtifacts(ctx, {}, {
    executionRecords: [execRecord(ctx, 'tomb-run', 'doc-change:doc-lint', {
      paths: [DELETED_ADR], candidatePaths: [], baselinePaths: [DELETED_ADR]
    })]
  });
  assert.strictEqual(resultOf(output, 'doc-change:doc-lint').outcome, 'pass',
    'an explicit empty object is a legitimate empty deletion inventory');
  assert.ok(!diagnosticCodes(output).includes('candidate-artifacts-invalid'),
    'the legitimate empty inventory is not diagnosed as malformed');
});

checkCase('335 P3 populated inventory and normal candidate binding stay valid', () => {
  const deletion = prepare('deleted-adr');
  const deletionOut = checkArtifacts(deletion, deletion.artifacts, {
    executionRecords: [execRecord(deletion, 'tomb-run', 'doc-change:doc-lint', {
      paths: [DELETED_ADR], candidatePaths: [], baselinePaths: [DELETED_ADR]
    })]
  });
  assert.strictEqual(resultOf(deletionOut, 'doc-change:doc-lint').outcome, 'pass',
    'a populated candidate inventory still satisfies the deletion lane');
  const edited = prepare('docs-only');
  const editedOut = checkArtifacts(edited, edited.artifacts, {
    executionRecords: [execRecord(edited, 'edit-run', 'doc-change:doc-lint', {
      paths: [GUIDE], candidatePaths: [GUIDE]
    })]
  });
  assert.strictEqual(resultOf(editedOut, 'doc-change:doc-lint').outcome, 'pass',
    'normal candidate-bound edits still pass with a populated inventory');
  assert.ok(!diagnosticCodes(deletionOut).includes('candidate-artifacts-invalid'));
  assert.ok(!diagnosticCodes(editedOut).includes('candidate-artifacts-invalid'));
});

checkCase('335 P3 non-baseline callers keep absent-map behavior', () => {
  const ctx = prepare('docs-only');
  const records = {
    executionRecords: [execRecord(ctx, 'edit-run', 'doc-change:doc-lint', {
      paths: [GUIDE], candidatePaths: [GUIDE]
    })]
  };
  const omitted = checkArtifacts(ctx, OMIT_ARTIFACTS, records);
  const empty = checkArtifacts(ctx, {}, records);
  assert.deepStrictEqual(omitted, empty,
    'non-baseline obligations treat an absent map and an explicit empty map identically');
  assert.ok(diagnosticCodes(omitted).includes('missing-path-coverage'),
    `the normal edited path still fails closed: ${diagnosticCodes(omitted)}`);
  assert.ok(!diagnosticCodes(omitted).includes('candidate-artifacts-invalid'),
    'the new input-boundary diagnostic does not appear for non-baseline obligations');
});

checkCase('335 P3 canonical and packaged modules agree on absent/malformed candidate inventory', () => {
  for (const [label, value] of INVALID_ARTIFACTS) {
    const sourceCtx = prepare('deleted-adr', modules);
    const packageCtx = prepare('deleted-adr', packageModules);
    const sourceOut = checkArtifacts(sourceCtx, value, {
      executionRecords: [execRecord(sourceCtx, 'tomb-run', 'doc-change:doc-lint', {
        paths: [DELETED_ADR], candidatePaths: [], baselinePaths: [DELETED_ADR]
      })]
    }, modules);
    const packageOut = checkArtifacts(packageCtx, value, {
      executionRecords: [execRecord(packageCtx, 'tomb-run', 'doc-change:doc-lint', {
        paths: [DELETED_ADR], candidatePaths: [], baselinePaths: [DELETED_ADR]
      })]
    }, packageModules);
    assert.deepStrictEqual(packageOut.results, sourceOut.results,
      `${label}: packaged results match the canonical module`);
    assert.deepStrictEqual(packageOut.diagnostics, sourceOut.diagnostics,
      `${label}: packaged diagnostics match the canonical module`);
  }
});

helper.finish();
