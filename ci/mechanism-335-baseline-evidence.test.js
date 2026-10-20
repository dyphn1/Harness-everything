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

class CustomInventory {}

// Object-like values have no own enumerable keys, so the pre-fix provenance check treated
// them as an empty inventory. They are not plain objects and must fail baseline-only
// obligations closed; null-prototype dictionaries remain valid (tested separately).
const OBJECT_LIKE_INVALID_ARTIFACTS = [
  ['Map', new Map()],
  ['Date', new Date(0)],
  ['RegExp', /inventory/],
  ['class instance', new CustomInventory()],
  ['custom prototype', Object.create({ inherited: true })]
];

const INVALID_ARTIFACTS = [
  ['omitted', OMIT_ARTIFACTS],
  ['undefined', undefined],
  ['null', null],
  ['array', [DELETED_ADR]],
  ['string', 'not-a-map'],
  ['boolean', false],
  ...OBJECT_LIKE_INVALID_ARTIFACTS
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

checkCase('335 P3 deletion: object-like inventories fail closed for an approving review', () => {
  const failures = [];
  for (const [label, value] of OBJECT_LIKE_INVALID_ARTIFACTS) {
    const ctx = prepare('deleted-adr');
    const output = checkArtifacts(ctx, value, {
      reviewRecords: [reviewRecord(ctx, 'review-run', 'doc-change:quality-review', {
        paths: [DELETED_ADR], candidatePaths: [], baselinePaths: [DELETED_ADR]
      })]
    });
    const result = resultOf(output, 'doc-change:quality-review');
    if (result.outcome !== 'none') failures.push(`${label}: outcome=${result.outcome}`);
    if (!diagnosticCodes(output).includes('candidate-artifacts-invalid')) {
      failures.push(`${label}: diagnostics=${diagnosticCodes(output)}`);
    }
  }
  assert.deepStrictEqual(failures, [],
    `every object-like inventory must fail the review lane closed: ${failures.join('; ')}`);
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

checkCase('335 P3 null-prototype inventory is accepted for deletion and populated rename lanes', () => {
  const deletion = prepare('deleted-adr');
  const empty = Object.create(null);
  const deletionOut = checkArtifacts(deletion, empty, {
    executionRecords: [execRecord(deletion, 'tomb-run', 'doc-change:doc-lint', {
      paths: [DELETED_ADR], candidatePaths: [], baselinePaths: [DELETED_ADR]
    })]
  });
  assert.strictEqual(resultOf(deletionOut, 'doc-change:doc-lint').outcome, 'pass',
    'an empty null-prototype dictionary is a legitimate empty deletion inventory');
  assert.ok(!diagnosticCodes(deletionOut).includes('candidate-artifacts-invalid'),
    'the null-prototype empty inventory is not diagnosed as malformed');

  const rename = prepare('rename');
  const populated = Object.create(null);
  populated[RENAME_TO] = rename.artifacts[RENAME_TO];
  const renameOut = checkArtifacts(rename, populated, {
    executionRecords: [execRecord(rename, 'move-run', 'doc-change:doc-lint', {
      paths: [RENAME_FROM, RENAME_TO], candidatePaths: [RENAME_TO], baselinePaths: [RENAME_FROM]
    })]
  });
  assert.strictEqual(resultOf(renameOut, 'doc-change:doc-lint').outcome, 'pass',
    'a populated null-prototype inventory still satisfies the rename lane');
  assert.ok(!diagnosticCodes(renameOut).includes('candidate-artifacts-invalid'),
    'the populated null-prototype inventory is not diagnosed as malformed');
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

checkCase('335 P3 non-baseline callers keep the original artifactMap fallback for object-like values', () => {
  const ctx = prepare('docs-only');
  const records = {
    executionRecords: [execRecord(ctx, 'edit-run', 'doc-change:doc-lint', {
      paths: [GUIDE], candidatePaths: [GUIDE]
    })]
  };
  const empty = checkArtifacts(ctx, {}, records);
  const failures = [];
  for (const [label, value] of INVALID_ARTIFACTS) {
    const output = checkArtifacts(ctx, value, records);
    try {
      assert.deepStrictEqual(output, empty, `${label}: output differs from explicit {}`);
    } catch (error) {
      failures.push(error.message);
    }
    if (diagnosticCodes(output).includes('candidate-artifacts-invalid')) {
      failures.push(`${label}: candidate-artifacts-invalid leaked into a non-baseline obligation`);
    }
  }
  assert.deepStrictEqual(failures, [],
    `non-baseline fallback must stay unchanged: ${failures.join('; ')}`);
});

checkCase('335 P3 inventory guard is limited to applicable obligations with baseline paths', () => {
  const ctx = prepare('deleted-adr');
  const lint = obligationOf(ctx, 'doc-change:doc-lint');
  const obligations = [
    ['N/A', { ...lint, applicability: 'N/A' }],
    ['unknown', { ...lint, applicability: 'unknown' }],
    ['empty baselinePaths', { ...lint, scope: { ...lint.scope, baselinePaths: [] } }]
  ];
  for (const [label, obligation] of obligations) {
    const output = checkArtifacts(ctx, new Map(), { obligations: [obligation] });
    assert.ok(!diagnosticCodes(output).includes('candidate-artifacts-invalid'),
      `${label}: the inventory guard must not apply (${diagnosticCodes(output)})`);
  }
});

// A Proxy can pass every value check yet abort the whole checker when its prototype trap
// throws. The prototype read must be confined to applicable baseline-only obligations, and a
// throwing trap must classify the inventory as unknown instead of escaping as an exception.
function throwingPrototypeInventory() {
  return new Proxy({}, {
    getPrototypeOf() { throw new TypeError('throwing prototype trap'); }
  });
}

checkCase('335 P3 a throwing prototype trap cannot abort non-baseline or inapplicable obligations', () => {
  const ctx = prepare('docs-only');
  const records = {
    executionRecords: [execRecord(ctx, 'edit-run', 'doc-change:doc-lint', {
      paths: [GUIDE], candidatePaths: [GUIDE]
    })]
  };
  const empty = checkArtifacts(ctx, {}, records);
  let output;
  try {
    output = checkArtifacts(ctx, throwingPrototypeInventory(), records);
  } catch (error) {
    assert.fail(`a non-baseline obligation must not read the candidate prototype: ${error.message}`);
  }
  assert.deepStrictEqual(output, empty,
    'a non-baseline caller sees the same result as an explicit empty map');
  assert.ok(!diagnosticCodes(output).includes('candidate-artifacts-invalid'),
    'the new input-boundary diagnostic does not appear for non-baseline obligations');

  const deleted = prepare('deleted-adr');
  const lint = obligationOf(deleted, 'doc-change:doc-lint');
  const cases = [
    ['N/A', { ...lint, applicability: 'N/A' }],
    ['unknown', { ...lint, applicability: 'unknown' }],
    ['empty baselinePaths', { ...lint, scope: { ...lint.scope, baselinePaths: [] } }],
    ['no baselinePaths annotation', { ...lint, scope: { paths: lint.scope.paths } }]
  ];
  for (const [label, obligation] of cases) {
    let out;
    try {
      out = checkArtifacts(deleted, throwingPrototypeInventory(), { obligations: [obligation] });
    } catch (error) {
      assert.fail(`${label}: an inapplicable obligation must not read the candidate prototype: ${error.message}`);
    }
    assert.ok(!diagnosticCodes(out).includes('candidate-artifacts-invalid'),
      `${label}: the inventory guard must not apply (${diagnosticCodes(out)})`);
  }
});

checkCase('335 P3 a throwing prototype trap fails baseline-only evidence closed', () => {
  const failures = [];
  for (const scenario of ['deleted-adr', 'rename']) {
    const ctx = prepare(scenario);
    const isRename = scenario === 'rename';
    const paths = isRename ? [RENAME_FROM, RENAME_TO] : [DELETED_ADR];
    const candidatePaths = isRename ? [RENAME_TO] : [];
    const baselinePaths = isRename ? [RENAME_FROM] : [DELETED_ADR];
    const record = isRename
      ? execRecord(ctx, 'move-run', 'doc-change:doc-lint', { paths, candidatePaths, baselinePaths })
      : execRecord(ctx, 'tomb-run', 'doc-change:doc-lint', { paths, candidatePaths, baselinePaths });
    const outputs = [];
    for (const target of [modules, packageModules]) {
      let output;
      try {
        output = checkArtifacts(ctx, throwingPrototypeInventory(), { executionRecords: [record] }, target);
      } catch (error) {
        failures.push(`${scenario}: prototype trap escaped: ${error.message}`);
        continue;
      }
      if (resultOf(output, 'doc-change:doc-lint').outcome !== 'none') {
        failures.push(`${scenario}: outcome=${resultOf(output, 'doc-change:doc-lint').outcome}`);
      }
      if (!diagnosticCodes(output).includes('candidate-artifacts-invalid')) {
        failures.push(`${scenario}: diagnostics=${diagnosticCodes(output)}`);
      }
      outputs.push(output);
    }
    if (outputs.length === 2) {
      assert.deepStrictEqual(outputs[1].results, outputs[0].results,
        `${scenario}: packaged results match the canonical module`);
      assert.deepStrictEqual(outputs[1].diagnostics, outputs[0].diagnostics,
        `${scenario}: packaged diagnostics match the canonical module`);
    }
  }
  assert.deepStrictEqual(failures, [],
    `a throwing prototype trap must fail closed in both modules: ${failures.join('; ')}`);

  const ctx = prepare('deleted-adr');
  const lint = obligationOf(ctx, 'doc-change:doc-lint');
  const twin = { ...lint, id: 'doc-change:doc-lint-twin' };
  let reads = 0;
  const inventory = new Proxy({}, {
    getPrototypeOf() { reads += 1; throw new TypeError('throwing prototype trap'); }
  });
  checkArtifacts(ctx, inventory, { obligations: [lint, twin] });
  assert.strictEqual(reads, 1,
    'the inventory classification is resolved at most once for all obligations');
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

// ---------------------------------------------------------------------------
// P2 trust boundary: per-path evidence must be carried explicitly. Inherited
// properties in baseline.artifacts, record.baselineArtifacts, the rename
// destination digest, or the candidate destination inventory entry are not
// own-key evidence and cannot satisfy a baseline-bound obligation.
// ---------------------------------------------------------------------------

checkCase('335 P2 inherited baseline.artifacts entry is not trusted', () => {
  const ctx = prepare('deleted-adr');
  const inheritedBaseline = Object.create({ [DELETED_ADR]: ctx.baseline.artifacts[DELETED_ADR] });
  const output = check(ctx, {
    baseline: { digest: ctx.baseline.digest, artifacts: inheritedBaseline },
    executionRecords: [execRecord(ctx, 'tomb-run', 'doc-change:doc-lint', {
      paths: [DELETED_ADR], candidatePaths: [], baselinePaths: [DELETED_ADR]
    })]
  });
  assert.notStrictEqual(resultOf(output, 'doc-change:doc-lint').outcome, 'pass',
    'an inherited-only baseline digest cannot satisfy a deletion');
  assert.ok(diagnosticCodes(output).includes('baseline-artifact-missing'),
    `the absent own baseline digest is diagnosed: ${diagnosticCodes(output)}`);
});

checkCase('335 P2 inherited record baselineArtifacts entry does not bind', () => {
  const ctx = prepare('deleted-adr');
  const inheritedRecordBinding = Object.create({ [DELETED_ADR]: ctx.baseline.artifacts[DELETED_ADR] });
  const output = check(ctx, {
    executionRecords: [execRecord(ctx, 'tomb-run', 'doc-change:doc-lint', {
      paths: [DELETED_ADR], candidatePaths: [], baselinePaths: [DELETED_ADR],
      baselineArtifacts: inheritedRecordBinding
    })]
  });
  assert.notStrictEqual(resultOf(output, 'doc-change:doc-lint').outcome, 'pass',
    'an inherited-only record baseline digest cannot bind the path');
  assert.ok(diagnosticCodes(output).includes('baseline-binding-missing'),
    `the non-own record binding is diagnosed: ${diagnosticCodes(output)}`);
});

checkCase('335 P2 inherited rename destination digest does not bind the pair', () => {
  const ctx = prepare('rename');
  const inheritedDestination = Object.create({ [RENAME_TO]: ctx.artifacts[RENAME_TO].digest });
  const output = check(ctx, {
    executionRecords: [execRecord(ctx, 'move-run', 'doc-change:doc-lint', {
      paths: [RENAME_FROM, RENAME_TO], candidatePaths: [RENAME_TO], baselinePaths: [RENAME_FROM],
      artifactDigests: inheritedDestination
    })]
  });
  assert.notStrictEqual(resultOf(output, 'doc-change:doc-lint').outcome, 'pass',
    'an inherited-only destination digest cannot bind the rename pair');
});

checkCase('335 P2 inherited candidate destination entry is not an own inventory entry', () => {
  const ctx = prepare('rename');
  const inheritedCandidate = Object.create({ [RENAME_TO]: ctx.artifacts[RENAME_TO] });
  const output = checkArtifacts(ctx, inheritedCandidate, {
    executionRecords: [execRecord(ctx, 'move-run', 'doc-change:doc-lint', {
      paths: [RENAME_FROM, RENAME_TO], candidatePaths: [RENAME_TO], baselinePaths: [RENAME_FROM]
    })]
  });
  assert.notStrictEqual(resultOf(output, 'doc-change:doc-lint').outcome, 'pass',
    'an inherited-only candidate destination cannot satisfy the rename');
  assert.ok(diagnosticCodes(output).includes('baseline-path-invalid'),
    `the non-own candidate destination is diagnosed as a malformed annotation: ${diagnosticCodes(output)}`);
});

checkCase('335 P2 null-prototype baseline and record maps remain valid', () => {
  const ctx = prepare('deleted-adr');
  const baselineArtifacts = Object.assign(Object.create(null), baselineMapFor(ctx, [DELETED_ADR]));
  const recordBinding = Object.assign(Object.create(null), baselineMapFor(ctx, [DELETED_ADR]));
  const output = check(ctx, {
    baseline: { digest: ctx.baseline.digest, artifacts: baselineArtifacts },
    executionRecords: [execRecord(ctx, 'tomb-run', 'doc-change:doc-lint', {
      paths: [DELETED_ADR], candidatePaths: [], baselinePaths: [DELETED_ADR],
      baselineArtifacts: recordBinding
    })]
  });
  assert.strictEqual(resultOf(output, 'doc-change:doc-lint').outcome, 'pass',
    'own entries in null-prototype dictionaries remain valid baseline evidence');
  assert.ok(!diagnosticCodes(output).includes('baseline-artifact-missing'));
});

checkCase('335 P2 canonical and packaged modules agree on inherited-only evidence', () => {
  for (const target of [modules, packageModules]) {
    const ctx = prepare('deleted-adr', target);
    const inheritedBaseline = Object.create({ [DELETED_ADR]: ctx.baseline.artifacts[DELETED_ADR] });
    const inheritedRecord = Object.create({ [DELETED_ADR]: ctx.baseline.artifacts[DELETED_ADR] });
    const baselineOutput = target.checkDocObligations({
      obligations: ctx.obligations,
      artifacts: ctx.artifacts,
      baseline: { digest: ctx.baseline.digest, artifacts: inheritedBaseline },
      executionRecords: [execRecord(ctx, 'tomb-run', 'doc-change:doc-lint', {
        paths: [DELETED_ADR], candidatePaths: [], baselinePaths: [DELETED_ADR]
      })]
    });
    const recordOutput = target.checkDocObligations({
      obligations: ctx.obligations,
      artifacts: ctx.artifacts,
      baseline: ctx.baseline,
      executionRecords: [execRecord(ctx, 'tomb-run', 'doc-change:doc-lint', {
        paths: [DELETED_ADR], candidatePaths: [], baselinePaths: [DELETED_ADR],
        baselineArtifacts: inheritedRecord
      })]
    });
    for (const [label, output] of [['baseline', baselineOutput], ['record', recordOutput]]) {
      assert.notStrictEqual(resultOf(output, 'doc-change:doc-lint').outcome, 'pass',
        `${label}: inherited-only evidence cannot pass in ${target === modules ? 'canonical' : 'packaged'} modules`);
    }
  }
});

// ---------------------------------------------------------------------------
// P3 declarations: metadata presence is own-key presence, and a rename's
// destination must be a member of the same obligation scope.
// ---------------------------------------------------------------------------

checkCase('335 P3 explicitly present undefined baselinePaths fails closed', () => {
  const ctx = prepare('docs-only');
  const lint = obligationOf(ctx, 'doc-change:doc-lint');
  const explicitUndefined = { ...lint, scope: { ...lint.scope, baselinePaths: undefined } };
  const output = check(ctx, {
    obligations: ctx.obligations.map(item => (item.id === lint.id ? explicitUndefined : item)),
    executionRecords: [execRecord(ctx, 'edit-run', 'doc-change:doc-lint', {
      paths: [GUIDE], candidatePaths: [GUIDE]
    })]
  });
  assert.notStrictEqual(resultOf(output, 'doc-change:doc-lint').outcome, 'pass',
    'an explicitly present undefined baselinePaths annotation cannot pass');
  assert.ok(diagnosticCodes(output).includes('baseline-path-invalid'),
    `the present malformed annotation is diagnosed: ${diagnosticCodes(output)}`);
});

checkCase('335 P3 rename destination must belong to scope.paths', () => {
  const ctx = prepare('rename');
  const lint = obligationOf(ctx, 'doc-change:doc-lint');
  const outsideDestination = 'docs/reference/not-in-scope.md';
  // The out-of-scope destination has a real candidate artifact and a valid pair record, so an
  // implementation that only checks the destination digest would still pass it. Only the
  // scope-membership invariant makes this annotation fail closed.
  const artifacts = {
    ...ctx.artifacts,
    [outsideDestination]: { digest: sha256('outside destination candidate') }
  };
  const mutated = {
    ...lint,
    scope: {
      ...lint.scope,
      baselinePaths: [{ path: RENAME_FROM, reason: 'rename-from', renameTo: outsideDestination }]
    }
  };
  const output = check(ctx, {
    obligations: ctx.obligations.map(item => (item.id === lint.id ? mutated : item)),
    artifacts,
    executionRecords: [execRecord(ctx, 'move-run', 'doc-change:doc-lint', {
      paths: [RENAME_FROM, RENAME_TO, outsideDestination],
      candidatePaths: [],
      baselinePaths: [RENAME_FROM],
      artifactDigests: {
        [RENAME_TO]: artifacts[RENAME_TO].digest,
        [outsideDestination]: artifacts[outsideDestination].digest
      }
    })]
  });
  assert.notStrictEqual(resultOf(output, 'doc-change:doc-lint').outcome, 'pass',
    'a rename destination outside scope.paths cannot pass');
  assert.ok(diagnosticCodes(output).includes('baseline-path-invalid'),
    `the out-of-scope destination is diagnosed: ${diagnosticCodes(output)}`);
});

// ---------------------------------------------------------------------------
// P2 destination evidence: the rename destination artifact must carry its own
// digest. An inherited nested digest is not explicit candidate evidence, while
// own-digest and null-prototype entries remain valid.
// ---------------------------------------------------------------------------

checkCase('335 P2 inherited destination artifact digest cannot bind the rename', () => {
  const ctx = prepare('rename');
  const artifacts = {
    ...ctx.artifacts,
    [RENAME_TO]: Object.create({ digest: ctx.artifacts[RENAME_TO].digest })
  };
  const output = check(ctx, {
    artifacts,
    executionRecords: [execRecord(ctx, 'move-run', 'doc-change:doc-lint', {
      paths: [RENAME_FROM, RENAME_TO], candidatePaths: [RENAME_TO], baselinePaths: [RENAME_FROM]
    })]
  });
  assert.notStrictEqual(resultOf(output, 'doc-change:doc-lint').outcome, 'pass',
    'an inherited destination digest cannot satisfy the rename source');
  assert.ok(diagnosticCodes(output).includes('baseline-path-invalid'),
    `the destination without an own digest is diagnosed: ${diagnosticCodes(output)}`);
});

checkCase('335 P2 own and null-prototype destination digests remain valid', () => {
  const entryFactories = [
    ['own digest', digest => ({ digest })],
    ['null-prototype entry', digest => Object.assign(Object.create(null), { digest })]
  ];
  for (const [label, makeEntry] of entryFactories) {
    const ctx = prepare('rename');
    const artifacts = {
      ...ctx.artifacts,
      [RENAME_TO]: makeEntry(ctx.artifacts[RENAME_TO].digest)
    };
    const output = check(ctx, {
      artifacts,
      executionRecords: [execRecord(ctx, 'move-run', 'doc-change:doc-lint', {
        paths: [RENAME_FROM, RENAME_TO], candidatePaths: [RENAME_TO], baselinePaths: [RENAME_FROM]
      })]
    });
    assert.strictEqual(resultOf(output, 'doc-change:doc-lint').outcome, 'pass',
      `${label}: an explicit destination digest remains valid`);
  }
});

// ---------------------------------------------------------------------------
// P3 declaration presence: a deleted entry must not carry renameTo at all,
// including an explicitly present undefined value.
// ---------------------------------------------------------------------------

checkCase('335 P3 deleted entry with own renameTo undefined fails closed', () => {
  const ctx = prepare('deleted-adr');
  const lint = obligationOf(ctx, 'doc-change:doc-lint');
  const mutated = {
    ...lint,
    scope: {
      ...lint.scope,
      baselinePaths: [{ path: DELETED_ADR, reason: 'deleted', renameTo: undefined }]
    }
  };
  const output = check(ctx, {
    obligations: ctx.obligations.map(item => (item.id === lint.id ? mutated : item)),
    executionRecords: [execRecord(ctx, 'tomb-run', 'doc-change:doc-lint', {
      paths: [DELETED_ADR], candidatePaths: [], baselinePaths: [DELETED_ADR]
    })]
  });
  assert.notStrictEqual(resultOf(output, 'doc-change:doc-lint').outcome, 'pass',
    'a present renameTo on a deletion cannot pass, even when undefined');
  assert.ok(diagnosticCodes(output).includes('baseline-path-invalid'),
    `the present renameTo is diagnosed: ${diagnosticCodes(output)}`);
});

// ---------------------------------------------------------------------------
// P3 malformed-input safety: descriptor and digest accessor traps in the
// candidate inventory must not abort the checker. Applicable baseline-only
// obligations fail closed with candidate-artifacts-invalid; N/A and unknown
// obligations keep their non-applicable result.
// ---------------------------------------------------------------------------

function throwingDescriptorInventory() {
  return new Proxy({}, {
    getPrototypeOf() { return Object.prototype; },
    getOwnPropertyDescriptor() { throw new Error('descriptor trap'); }
  });
}

function throwingDigestArtifact() {
  const entry = {};
  Object.defineProperty(entry, 'digest', {
    enumerable: true,
    get() { throw new Error('digest trap'); }
  });
  return entry;
}

checkCase('335 P3 a throwing property descriptor trap fails baseline obligations closed', () => {
  const failures = [];
  for (const scenario of ['deleted-adr', 'rename']) {
    const isRename = scenario === 'rename';
    for (const target of [modules, packageModules]) {
      const ctx = prepare(scenario, target);
      const paths = isRename ? [RENAME_FROM, RENAME_TO] : [DELETED_ADR];
      const candidatePaths = isRename ? [RENAME_TO] : [];
      const baselinePaths = isRename ? [RENAME_FROM] : [DELETED_ADR];
      const record = execRecord(ctx, isRename ? 'move-run' : 'tomb-run', 'doc-change:doc-lint', {
        paths, candidatePaths, baselinePaths
      });
      let output;
      try {
        output = checkArtifacts(ctx, throwingDescriptorInventory(), { executionRecords: [record] }, target);
      } catch (error) {
        failures.push(`${scenario}: descriptor trap escaped: ${error.message}`);
        continue;
      }
      const result = resultOf(output, 'doc-change:doc-lint');
      if (result.outcome !== 'none') failures.push(`${scenario}: outcome=${result.outcome}`);
      if (!diagnosticCodes(output).includes('candidate-artifacts-invalid')) {
        failures.push(`${scenario}: diagnostics=${diagnosticCodes(output)}`);
      }
    }
  }
  assert.deepStrictEqual(failures, [],
    `descriptor traps must fail closed in both modules: ${failures.join('; ')}`);
});

checkCase('335 P3 a throwing destination digest accessor fails the rename closed', () => {
  const failures = [];
  for (const target of [modules, packageModules]) {
    const ctx = prepare('rename', target);
    const artifacts = {
      ...ctx.artifacts,
      [RENAME_TO]: throwingDigestArtifact()
    };
    const record = execRecord(ctx, 'move-run', 'doc-change:doc-lint', {
      paths: [RENAME_FROM, RENAME_TO], candidatePaths: [RENAME_TO], baselinePaths: [RENAME_FROM]
    });
    let output;
    try {
      output = check(ctx, { artifacts, executionRecords: [record] }, target);
    } catch (error) {
      failures.push(`digest accessor trap escaped: ${error.message}`);
      continue;
    }
    const result = resultOf(output, 'doc-change:doc-lint');
    if (result.outcome !== 'none') failures.push(`outcome=${result.outcome}`);
    if (!diagnosticCodes(output).includes('candidate-artifacts-invalid')) {
      failures.push(`diagnostics=${diagnosticCodes(output)}`);
    }
  }
  assert.deepStrictEqual(failures, [],
    `a throwing destination digest accessor must fail closed in both modules: ${failures.join('; ')}`);
});

checkCase('335 P3 descriptor and digest traps cannot abort N/A or unknown obligations', () => {
  const ctx = prepare('deleted-adr');
  const rename = prepare('rename');
  const lint = obligationOf(ctx, 'doc-change:doc-lint');
  const renameLint = obligationOf(rename, 'doc-change:doc-lint');
  const scenarios = [
    ['deleted descriptor trap', ctx, lint, throwingDescriptorInventory()],
    ['deleted digest trap', ctx, lint, { [DELETED_ADR]: throwingDigestArtifact() }],
    ['rename descriptor trap', rename, renameLint, throwingDescriptorInventory()],
    ['rename digest trap', rename, renameLint, {
      ...rename.artifacts,
      [RENAME_TO]: throwingDigestArtifact()
    }]
  ];
  for (const [label, scenarioCtx, obligation, artifacts] of scenarios) {
    for (const applicability of ['N/A', 'unknown']) {
      let output;
      try {
        output = checkArtifacts(scenarioCtx, artifacts, {
          obligations: [{ ...obligation, applicability }]
        });
      } catch (error) {
        assert.fail(`${label}/${applicability}: malformed inventory escaped: ${error.message}`);
      }
      const result = resultOf(output, obligation.id);
      assert.strictEqual(result.outcome, 'none',
        `${label}/${applicability}: non-applicable obligations stay none`);
      assert.ok(!diagnosticCodes(output).includes('candidate-artifacts-invalid'),
        `${label}/${applicability}: the inventory diagnostic is limited to applicable obligations`);
    }
  }
});

// ---------------------------------------------------------------------------
// P3 mixed scope: baseline-only and ordinary candidate paths in the same
// applicable obligation. A throwing accessor on the ordinary path must fail
// the inventory closed before the legacy candidate lane binds evidence.
// ---------------------------------------------------------------------------

checkCase('335 P3 mixed delete+edit scope fails closed on a candidate digest accessor', () => {
  const failures = [];
  for (const target of [modules, packageModules]) {
    const label = target === modules ? 'canonical' : 'packaged';
    const ctx = prepare('deleted-adr', target);
    const lint = obligationOf(ctx, 'doc-change:doc-lint');
    const mixed = {
      ...lint,
      scope: {
        ...lint.scope,
        paths: [DELETED_ADR, GUIDE],
        baselinePaths: [{ path: DELETED_ADR, reason: 'deleted' }]
      }
    };
    const obligations = ctx.obligations.map(item => (item.id === lint.id ? mixed : item));
    const editedDigest = sha256('mixed edited candidate');
    const record = execRecord(ctx, 'mixed-run', 'doc-change:doc-lint', {
      paths: [DELETED_ADR, GUIDE],
      candidatePaths: [],
      baselinePaths: [DELETED_ADR],
      artifactDigests: { [GUIDE]: editedDigest }
    });

    const positiveArtifacts = { ...ctx.artifacts, [GUIDE]: { digest: editedDigest } };
    let positive;
    try {
      positive = check(ctx, { obligations, artifacts: positiveArtifacts, executionRecords: [record] }, target);
    } catch (error) {
      failures.push(`${label}: positive control threw: ${error.message}`);
    }
    if (positive && resultOf(positive, 'doc-change:doc-lint').outcome !== 'pass') {
      failures.push(`${label}: positive control outcome=${resultOf(positive, 'doc-change:doc-lint').outcome}`);
    }

    const poisonedArtifacts = { ...ctx.artifacts, [GUIDE]: throwingDigestArtifact() };
    let output;
    try {
      output = check(ctx, { obligations, artifacts: poisonedArtifacts, executionRecords: [record] }, target);
    } catch (error) {
      failures.push(`${label}: candidate accessor escaped: ${error.message}`);
      continue;
    }
    const result = resultOf(output, 'doc-change:doc-lint');
    if (result.outcome !== 'none') failures.push(`${label}: outcome=${result.outcome}`);
    if (!diagnosticCodes(output).includes('candidate-artifacts-invalid')) {
      failures.push(`${label}: diagnostics=${diagnosticCodes(output)}`);
    }
  }
  assert.deepStrictEqual(failures, [],
    `mixed scopes must fail closed in both modules: ${failures.join('; ')}`);
});

// ---------------------------------------------------------------------------
// P3 cache consistency: for an applicable baseline-annotated obligation every
// ordinary scoped candidate digest is captured once, before binding. The audit
// identity and the stale-digest diagnostics must consult that same captured
// snapshot, not re-read a nested accessor whose later read throws or changes.
// ---------------------------------------------------------------------------

// A digest accessor that is valid for the first `validReads` property reads and
// then throws or returns `laterValue`. `artifact()` reads `entry.digest` up to
// three times per call, so the pre-binding capture consumes three valid reads.
function statefulDigestEntry(digest, { validReads = 3, later = 'throw', laterValue } = {}) {
  const entry = {};
  let reads = 0;
  Object.defineProperty(entry, 'digest', {
    enumerable: true,
    get() {
      reads += 1;
      if (reads <= validReads) return digest;
      if (later === 'throw') throw new Error('stateful digest accessor');
      return laterValue;
    }
  });
  return entry;
}

// The deleted-adr fixture with one extra ordinary candidate path (GUIDE) in the
// doc-lint scope, so the same applicable obligation declares baseline-only and
// ordinary candidate paths.
function mixedCacheContext(target) {
  const ctx = prepare('deleted-adr', target);
  const lint = obligationOf(ctx, 'doc-change:doc-lint');
  const mixed = {
    ...lint,
    scope: {
      ...lint.scope,
      paths: [DELETED_ADR, GUIDE],
      baselinePaths: [{ path: DELETED_ADR, reason: 'deleted' }]
    }
  };
  return { ctx, obligations: ctx.obligations.map(item => (item.id === lint.id ? mixed : item)) };
}

function mixedCacheRecord(ctx, id, guideDigest) {
  return execRecord(ctx, id, 'doc-change:doc-lint', {
    paths: [DELETED_ADR, GUIDE],
    candidatePaths: [],
    baselinePaths: [DELETED_ADR],
    artifactDigests: { [GUIDE]: guideDigest }
  });
}

checkCase('335 P3 captured candidate snapshot drives the audit identity and stale diagnostics', () => {
  const failures = [];
  const capturedDigest = sha256('captured mixed candidate snapshot');
  const staleDigest = sha256('stale previous mixed candidate');
  const changedDigest = sha256('later mixed candidate read');

  for (const target of [modules, packageModules]) {
    const label = target === modules ? 'canonical' : 'packaged';
    const { ctx, obligations } = mixedCacheContext(target);
    const valid = mixedCacheRecord(ctx, 'snapshot-run', capturedDigest);

    // Throwing after capture: the record bound to the captured digest must pass,
    // its audit identity must name that digest, and a stale record must still be
    // diagnosed as stale instead of silently losing its mismatch.
    let passing;
    try {
      passing = check(ctx, {
        obligations,
        artifacts: { ...ctx.artifacts, [GUIDE]: statefulDigestEntry(capturedDigest, { later: 'throw' }) },
        executionRecords: [valid]
      }, target);
    } catch (error) {
      failures.push(`${label}/throwing: valid check threw: ${error.message}`);
    }
    if (passing) {
      const result = resultOf(passing, 'doc-change:doc-lint');
      if (result.outcome !== 'pass') failures.push(`${label}/throwing: valid outcome=${result.outcome}`);
      if (!result.artifactDigest.includes(`${GUIDE}=${capturedDigest}`)) {
        failures.push(`${label}/throwing: audit identity is not the bound digest: ${result.artifactDigest}`);
      }
      if (diagnosticCodes(passing).includes('stale-artifact-digest')) {
        failures.push(`${label}/throwing: the captured-bound record was reported stale`);
      }
    }

    let stale;
    try {
      stale = check(ctx, {
        obligations,
        artifacts: { ...ctx.artifacts, [GUIDE]: statefulDigestEntry(capturedDigest, { later: 'throw' }) },
        executionRecords: [mixedCacheRecord(ctx, 'stale-run', staleDigest)]
      }, target);
    } catch (error) {
      failures.push(`${label}/throwing: stale check threw: ${error.message}`);
    }
    if (stale) {
      if (resultOf(stale, 'doc-change:doc-lint').outcome === 'pass') {
        failures.push(`${label}/throwing: a stale record passed`);
      }
      if (!diagnosticCodes(stale).includes('stale-artifact-digest')) {
        failures.push(`${label}/throwing: a stale record was not diagnosed: ${diagnosticCodes(stale)}`);
      }
    }

    // Changing after capture: the captured-bound record must pass and must not be
    // misreported stale, and the audit identity must keep the captured digest.
    let changed;
    try {
      changed = check(ctx, {
        obligations,
        artifacts: {
          ...ctx.artifacts,
          [GUIDE]: statefulDigestEntry(capturedDigest, { later: 'value', laterValue: changedDigest })
        },
        executionRecords: [valid]
      }, target);
    } catch (error) {
      failures.push(`${label}/changing: check threw: ${error.message}`);
    }
    if (changed) {
      const result = resultOf(changed, 'doc-change:doc-lint');
      if (result.outcome !== 'pass') failures.push(`${label}/changing: outcome=${result.outcome}`);
      if (!result.artifactDigest.includes(`${GUIDE}=${capturedDigest}`)) {
        failures.push(`${label}/changing: audit identity drifted to a later read: ${result.artifactDigest}`);
      }
      if (diagnosticCodes(changed).includes('stale-artifact-digest')) {
        failures.push(`${label}/changing: the captured-bound record was misreported stale`);
      }
    }
  }

  assert.deepStrictEqual(failures, [],
    `the captured candidate snapshot must stay consistent: ${failures.join('; ')}`);
});

// ---------------------------------------------------------------------------
// P3 rename cache consistency: the rename destination must bind against the
// same captured candidate digest that the ordinary candidate lane, the audit
// identity, and the stale diagnostics use. Metadata validation still requires
// the destination to be an own-key inventory entry with its own digest, so the
// strict own-key boundary is unchanged; after capture the digest is used
// exclusively, never re-read live.
// ---------------------------------------------------------------------------

const RENAME_CAPTURED = sha256('rename captured destination');
const RENAME_LATER = sha256('rename later destination');

function renameCacheContext(target) {
  const ctx = prepare('rename', target);
  return { ctx, obligations: [obligationOf(ctx, 'doc-change:doc-lint')] };
}

function renameCacheArtifacts(ctx, entry) {
  return { ...ctx.artifacts, [RENAME_TO]: entry };
}

function renamePairRecord(ctx, id, destinationDigest) {
  return execRecord(ctx, id, 'doc-change:doc-lint', {
    paths: [RENAME_FROM, RENAME_TO],
    candidatePaths: [],
    baselinePaths: [RENAME_FROM],
    artifactDigests: { [RENAME_TO]: destinationDigest }
  });
}

function renameDestinationOnlyRecord(ctx, id, destinationDigest) {
  return execRecord(ctx, id, 'doc-change:doc-lint', {
    paths: [RENAME_TO],
    candidatePaths: [],
    baselinePaths: [],
    artifactDigests: { [RENAME_TO]: destinationDigest }
  });
}

checkCase('335 P3 rename destination binds to the captured candidate snapshot', () => {
  const failures = [];
  for (const target of [modules, packageModules]) {
    const label = target === modules ? 'canonical' : 'packaged';
    const { ctx, obligations } = renameCacheContext(target);
    const runWith = (artifacts, records) => target.checkDocObligations({
      obligations, artifacts, baseline: ctx.baseline, executionRecords: records, reviewRecords: []
    });
    // Metadata + capture read the destination accessor six times; every later
    // read must not be needed because binding uses the captured snapshot.
    const entry = (later, laterValue) => statefulDigestEntry(RENAME_CAPTURED, { validReads: 6, later, laterValue });

    // 1) later-throw: the valid pair binds on the captured digest and reports it.
    let out;
    try {
      out = runWith(renameCacheArtifacts(ctx, entry('throw')),
        [renamePairRecord(ctx, 'pair-run', RENAME_CAPTURED)]);
    } catch (error) { failures.push(`${label}/throw: escaped: ${error.message}`); }
    if (out) {
      const result = resultOf(out, 'doc-change:doc-lint');
      if (result.outcome !== 'pass') failures.push(`${label}/throw: outcome=${result.outcome}`);
      if (!result.artifactDigest.includes(`${RENAME_TO}=${RENAME_CAPTURED}`)) {
        failures.push(`${label}/throw: audit identity=${result.artifactDigest}`);
      }
    }

    // 2) later-change: a valid pair bound to the captured digest still passes.
    out = undefined;
    try {
      out = runWith(renameCacheArtifacts(ctx, entry('value', RENAME_LATER)),
        [renamePairRecord(ctx, 'pair-run', RENAME_CAPTURED)]);
    } catch (error) { failures.push(`${label}/change: escaped: ${error.message}`); }
    if (out) {
      const result = resultOf(out, 'doc-change:doc-lint');
      if (result.outcome !== 'pass') failures.push(`${label}/change: outcome=${result.outcome}`);
      if (!result.artifactDigest.includes(`${RENAME_TO}=${RENAME_CAPTURED}`)) {
        failures.push(`${label}/change: audit identity=${result.artifactDigest}`);
      }
      if (diagnosticCodes(out).includes('stale-artifact-digest')) {
        failures.push(`${label}/change: the captured-bound pair was misreported stale`);
      }
    }

    // 3) stale pair + destination-only record must not jointly pass, and the
    //    stale pair must be diagnosed.
    out = undefined;
    try {
      out = runWith(renameCacheArtifacts(ctx, entry('value', RENAME_LATER)),
        [renamePairRecord(ctx, 'pair-run', RENAME_LATER),
         renameDestinationOnlyRecord(ctx, 'dest-only-run', RENAME_CAPTURED)]);
    } catch (error) { failures.push(`${label}/joint: escaped: ${error.message}`); }
    if (out) {
      if (resultOf(out, 'doc-change:doc-lint').outcome === 'pass') {
        failures.push(`${label}/joint: a stale pair plus a destination-only record jointly passed`);
      }
      if (!diagnosticCodes(out).includes('stale-artifact-digest')) {
        failures.push(`${label}/joint: the stale pair was not diagnosed: ${diagnosticCodes(out)}`);
      }
    }

    // 4) a stale pair alone cannot pass.
    out = undefined;
    try {
      out = runWith(renameCacheArtifacts(ctx, entry('value', RENAME_LATER)),
        [renamePairRecord(ctx, 'pair-run', RENAME_LATER)]);
    } catch (error) { failures.push(`${label}/stale: escaped: ${error.message}`); }
    if (out && resultOf(out, 'doc-change:doc-lint').outcome === 'pass') {
      failures.push(`${label}/stale: a stale pair passed`);
    }

    // 5) the strict own-key destination boundary is unchanged: static own and
    //    null-prototype own digests pass, an inherited-only digest fails closed.
    const ownStatic = runWith(renameCacheArtifacts(ctx, { digest: RENAME_CAPTURED }),
      [renamePairRecord(ctx, 'pair-run', RENAME_CAPTURED)]);
    if (resultOf(ownStatic, 'doc-change:doc-lint').outcome !== 'pass') {
      failures.push(`${label}/static: a static own digest did not pass`);
    }
    const nullProto = Object.assign(Object.create(null), { digest: RENAME_CAPTURED });
    const ownNull = runWith(renameCacheArtifacts(ctx, nullProto),
      [renamePairRecord(ctx, 'pair-run', RENAME_CAPTURED)]);
    if (resultOf(ownNull, 'doc-change:doc-lint').outcome !== 'pass') {
      failures.push(`${label}/nullproto: a null-prototype own digest did not pass`);
    }
    const inherited = runWith(renameCacheArtifacts(ctx, Object.create({ digest: RENAME_CAPTURED })),
      [renamePairRecord(ctx, 'pair-run', RENAME_CAPTURED)]);
    if (resultOf(inherited, 'doc-change:doc-lint').outcome === 'pass') {
      failures.push(`${label}/inherited: an inherited-only digest bound the rename`);
    }
  }

  assert.deepStrictEqual(failures, [],
    `the rename destination must bind to the captured snapshot: ${failures.join('; ')}`);
});

// ---------------------------------------------------------------------------
// P2 candidate-snapshot consistency (review r4318074471): metadata validation is
// the single candidate snapshot. A validated baseline-only path carries its
// source-absence proof, and a validated rename destination carries its own
// validated digest, so binding and the audit identity never re-inspect the
// candidate map. A plain-prototype Proxy whose own-property inspection is
// exhausted after metadata must not abort the check, while a trap that throws
// during metadata still fails the obligation closed.
// ---------------------------------------------------------------------------

function descriptorPatienceInventory(target, allowedDescriptorCalls) {
  let descriptorCalls = 0;
  const proxy = new Proxy(target, {
    getPrototypeOf() { return Object.prototype; },
    getOwnPropertyDescriptor(t, prop) {
      descriptorCalls += 1;
      if (descriptorCalls > allowedDescriptorCalls) {
        throw new Error(`descriptor trap call ${descriptorCalls}`);
      }
      return Reflect.getOwnPropertyDescriptor(t, prop);
    }
  });
  return { proxy, descriptorCalls: () => descriptorCalls };
}

function countingDigestEntry(digest, { validReads = 3, later = 'throw', laterValue } = {}) {
  const entry = {};
  let reads = 0;
  Object.defineProperty(entry, 'digest', {
    enumerable: true,
    get() {
      reads += 1;
      if (reads <= validReads) return digest;
      if (later === 'throw') throw new Error('stateful digest accessor');
      return laterValue;
    }
  });
  return { entry, reads: () => reads };
}

function runDocLint(ctx, target, { artifacts = ctx.artifacts, records = [] }) {
  return target.checkDocObligations({
    obligations: [obligationOf(ctx, 'doc-change:doc-lint')],
    artifacts,
    baseline: ctx.baseline,
    executionRecords: records,
    reviewRecords: []
  });
}

checkCase('335 P3 a validated rename pair is not re-inspected when the candidate descriptor trap is exhausted', () => {
  const failures = [];
  for (const target of [modules, packageModules]) {
    const label = target === modules ? 'canonical' : 'packaged';
    const ctx = prepare('rename', target);
    const guarded = descriptorPatienceInventory(ctx.artifacts, 2);
    const record = execRecord(ctx, 'pair-run', 'doc-change:doc-lint', {
      paths: [RENAME_FROM, RENAME_TO], candidatePaths: [RENAME_TO], baselinePaths: [RENAME_FROM]
    });
    let out;
    try {
      out = runDocLint(ctx, target, { artifacts: guarded.proxy, records: [record] });
    } catch (error) { failures.push(`${label}: escaped: ${error.message}`); continue; }
    if (resultOf(out, 'doc-change:doc-lint').outcome !== 'pass') {
      failures.push(`${label}: outcome=${resultOf(out, 'doc-change:doc-lint').outcome}`);
    }
    if (guarded.descriptorCalls() !== 2) failures.push(`${label}: descriptor calls=${guarded.descriptorCalls()}`);
  }
  assert.deepStrictEqual(failures, [],
    `a validated rename must not re-inspect the candidate: ${failures.join('; ')}`);
});

checkCase('335 P3 a validated deletion tombstone is not re-inspected when the candidate descriptor trap is exhausted', () => {
  const failures = [];
  for (const target of [modules, packageModules]) {
    const label = target === modules ? 'canonical' : 'packaged';
    const ctx = prepare('deleted-adr', target);
    const guarded = descriptorPatienceInventory(ctx.artifacts, 1);
    const record = execRecord(ctx, 'tomb-run', 'doc-change:doc-lint', {
      paths: [DELETED_ADR], candidatePaths: [], baselinePaths: [DELETED_ADR]
    });
    let out;
    try {
      out = runDocLint(ctx, target, { artifacts: guarded.proxy, records: [record] });
    } catch (error) { failures.push(`${label}: escaped: ${error.message}`); continue; }
    if (resultOf(out, 'doc-change:doc-lint').outcome !== 'pass') {
      failures.push(`${label}: outcome=${resultOf(out, 'doc-change:doc-lint').outcome}`);
    }
    if (guarded.descriptorCalls() !== 1) failures.push(`${label}: descriptor calls=${guarded.descriptorCalls()}`);
  }
  assert.deepStrictEqual(failures, [],
    `a validated tombstone must not re-inspect the candidate: ${failures.join('; ')}`);
});

checkCase('335 P3 a descriptor trap that throws during metadata still fails the baseline pair closed', () => {
  const failures = [];
  for (const target of [modules, packageModules]) {
    const label = target === modules ? 'canonical' : 'packaged';
    for (const scenario of ['deleted-adr', 'rename']) {
      const ctx = prepare(scenario, target);
      const guarded = descriptorPatienceInventory(ctx.artifacts, 0);
      const isRename = scenario === 'rename';
      const record = execRecord(ctx, 'run', 'doc-change:doc-lint', {
        paths: isRename ? [RENAME_FROM, RENAME_TO] : [DELETED_ADR],
        candidatePaths: isRename ? [RENAME_TO] : [],
        baselinePaths: isRename ? [RENAME_FROM] : [DELETED_ADR]
      });
      let out;
      try {
        out = runDocLint(ctx, target, { artifacts: guarded.proxy, records: [record] });
      } catch (error) { failures.push(`${label}/${scenario}: escaped: ${error.message}`); continue; }
      const result = resultOf(out, 'doc-change:doc-lint');
      if (result.outcome !== 'none') failures.push(`${label}/${scenario}: outcome=${result.outcome}`);
      if (!diagnosticCodes(out).includes('candidate-artifacts-invalid')) {
        failures.push(`${label}/${scenario}: diagnostics=${diagnosticCodes(out)}`);
      }
    }
  }
  assert.deepStrictEqual(failures, [],
    `a metadata descriptor trap must fail closed: ${failures.join('; ')}`);
});

checkCase('335 P3 the validated source-absence proof is carried into the audit and binding', () => {
  const failures = [];
  for (const target of [modules, packageModules]) {
    const label = target === modules ? 'canonical' : 'packaged';
    const ctx = prepare('rename', target);
    let sourceGets = 0;
    const inventory = new Proxy(ctx.artifacts, {
      getPrototypeOf() { return Object.prototype; },
      get(t, prop, receiver) {
        if (prop === RENAME_FROM) {
          sourceGets += 1;
          return { digest: sha256('spoofed source entry') };
        }
        return Reflect.get(t, prop, receiver);
      }
    });
    const record = execRecord(ctx, 'pair-run', 'doc-change:doc-lint', {
      paths: [RENAME_FROM, RENAME_TO], candidatePaths: [RENAME_TO], baselinePaths: [RENAME_FROM]
    });
    let out;
    try {
      out = runDocLint(ctx, target, { artifacts: inventory, records: [record] });
    } catch (error) { failures.push(`${label}: escaped: ${error.message}`); continue; }
    const result = resultOf(out, 'doc-change:doc-lint');
    if (result.outcome !== 'pass') failures.push(`${label}: outcome=${result.outcome}`);
    if (!result.artifactDigest.includes(`${RENAME_FROM}=missing`)) {
      failures.push(`${label}: audit=${result.artifactDigest}`);
    }
    if (sourceGets !== 0) failures.push(`${label}: source getter reads=${sourceGets}`);
  }
  assert.deepStrictEqual(failures, [],
    `the source-absence proof must be carried: ${failures.join('; ')}`);
});

checkCase('335 P3 the metadata-validated rename destination digest is carried without a second candidate read', () => {
  const failures = [];
  for (const target of [modules, packageModules]) {
    const label = target === modules ? 'canonical' : 'packaged';
    const ctx = prepare('rename', target);
    const counted = countingDigestEntry(RENAME_CAPTURED, { validReads: 3, later: 'throw' });
    const artifacts = { ...ctx.artifacts, [RENAME_TO]: counted.entry };
    const record = execRecord(ctx, 'pair-run', 'doc-change:doc-lint', {
      paths: [RENAME_FROM, RENAME_TO], candidatePaths: [], baselinePaths: [RENAME_FROM],
      artifactDigests: { [RENAME_TO]: RENAME_CAPTURED }
    });
    let out;
    try {
      out = runDocLint(ctx, target, { artifacts, records: [record] });
    } catch (error) { failures.push(`${label}: escaped: ${error.message}`); continue; }
    const result = resultOf(out, 'doc-change:doc-lint');
    if (result.outcome !== 'pass') failures.push(`${label}: outcome=${result.outcome}`);
    if (!result.artifactDigest.includes(`${RENAME_TO}=${RENAME_CAPTURED}`)) {
      failures.push(`${label}: audit=${result.artifactDigest}`);
    }
    if (counted.reads() !== 3) failures.push(`${label}: destination reads=${counted.reads()}`);
  }
  assert.deepStrictEqual(failures, [],
    `the validated destination digest must be carried: ${failures.join('; ')}`);
});

checkCase('335 P3 a stale pair plus a destination-only record stays none under descriptor patience', () => {
  const failures = [];
  for (const target of [modules, packageModules]) {
    const label = target === modules ? 'canonical' : 'packaged';
    const ctx = prepare('rename', target);
    const guarded = descriptorPatienceInventory(ctx.artifacts, 2);
    const stale = execRecord(ctx, 'pair-run', 'doc-change:doc-lint', {
      paths: [RENAME_FROM, RENAME_TO], candidatePaths: [], baselinePaths: [RENAME_FROM],
      artifactDigests: { [RENAME_TO]: RENAME_LATER }
    });
    const destOnly = execRecord(ctx, 'dest-only-run', 'doc-change:doc-lint', {
      paths: [RENAME_TO], candidatePaths: [], baselinePaths: [],
      artifactDigests: { [RENAME_TO]: RENAME_CAPTURED }
    });
    let out;
    try {
      out = runDocLint(ctx, target, { artifacts: guarded.proxy, records: [stale, destOnly] });
    } catch (error) { failures.push(`${label}: escaped: ${error.message}`); continue; }
    if (resultOf(out, 'doc-change:doc-lint').outcome === 'pass') {
      failures.push(`${label}: a stale pair plus a destination-only record jointly passed`);
    }
    if (!diagnosticCodes(out).includes('stale-artifact-digest')) {
      failures.push(`${label}: diagnostics=${diagnosticCodes(out)}`);
    }
  }
  assert.deepStrictEqual(failures, [],
    `a stale pair must not jointly pass: ${failures.join('; ')}`);
});

checkCase('335 P3 extra raw baselinePaths properties cannot forge the captured absence or destination digest', () => {
  const ctx = prepare('rename');
  const lint = obligationOf(ctx, 'doc-change:doc-lint');
  const forged = sha256('forged destination digest');
  const mutated = {
    ...lint,
    scope: {
      ...lint.scope,
      baselinePaths: [{
        path: RENAME_FROM, reason: 'rename-from', renameTo: RENAME_TO,
        candidatePathPresent: true, sourceAbsent: false, renameDestinationDigest: forged
      }]
    }
  };
  const output = check(ctx, {
    obligations: ctx.obligations.map(item => (item.id === lint.id ? mutated : item)),
    executionRecords: [execRecord(ctx, 'pair-run', 'doc-change:doc-lint', {
      paths: [RENAME_FROM, RENAME_TO], candidatePaths: [RENAME_TO], baselinePaths: [RENAME_FROM]
    })]
  });
  const result = resultOf(output, 'doc-change:doc-lint');
  assert.strictEqual(result.outcome, 'pass',
    'extra raw fields must not override the validated destination digest');
  assert.ok(result.artifactDigest.includes(`${RENAME_TO}=${ctx.artifacts[RENAME_TO].digest}`),
    `the audit identity must keep the validated destination digest: ${result.artifactDigest}`);
});

checkCase('335 P3 descriptor-patience inventories do not abort inapplicable or legacy obligations', () => {
  const ctx = prepare('deleted-adr');
  const lint = obligationOf(ctx, 'doc-change:doc-lint');
  for (const applicability of ['N/A', 'unknown']) {
    const guarded = descriptorPatienceInventory(ctx.artifacts, 0);
    let out;
    try {
      out = checkArtifacts(ctx, guarded.proxy, { obligations: [{ ...lint, applicability }] });
    } catch (error) {
      assert.fail(`${applicability}: descriptor-patience inventory escaped: ${error.message}`);
    }
    assert.strictEqual(resultOf(out, lint.id).outcome, 'none', `${applicability} stays none`);
    assert.ok(!diagnosticCodes(out).includes('candidate-artifacts-invalid'),
      `${applicability} emits no inventory diagnostic`);
  }
  const edited = prepare('docs-only');
  const guarded = descriptorPatienceInventory(edited.artifacts, 0);
  const records = {
    executionRecords: [execRecord(edited, 'edit-run', 'doc-change:doc-lint', { paths: [GUIDE], candidatePaths: [GUIDE] })]
  };
  const withProxy = checkArtifacts(edited, guarded.proxy, records);
  const withPlain = checkArtifacts(edited, { ...edited.artifacts }, records);
  assert.deepStrictEqual(withProxy, withPlain,
    'legacy unannotated callers read the candidate map through the legacy lane unchanged');
  assert.strictEqual(resultOf(withProxy, 'doc-change:doc-lint').outcome, 'pass',
    'a populated legacy inventory still satisfies a normal candidate path');
});

// ---------------------------------------------------------------------------
// P2 applicability + shared-destination consistency (reviews r4318354774 and
// r4318354780 at 4800a75): the validated source-absence audit shortcut is for
// applicable obligations only, and every accepted entry that shares a rename
// destination must agree on the validated own digest.
// ---------------------------------------------------------------------------

const RENAME_SOURCE_SPOOF = sha256('spoofed legacy source entry');
const RENAME_SECOND_SOURCE = 'docs/reference/second-old.md';
const SECOND_SOURCE_BASELINE = sha256('second source trusted baseline');

checkCase('335 P3 inapplicable baseline-annotated obligations keep the legacy candidate audit read', () => {
  const failures = [];
  for (const target of [modules, packageModules]) {
    const label = target === modules ? 'canonical' : 'packaged';
    const ctx = prepare('rename', target);
    const lint = obligationOf(ctx, 'doc-change:doc-lint');
    let sourceGets = 0;
    const inventory = new Proxy(ctx.artifacts, {
      getPrototypeOf() { return Object.prototype; },
      get(t, prop, receiver) {
        if (prop === RENAME_FROM) { sourceGets += 1; return { digest: RENAME_SOURCE_SPOOF }; }
        return Reflect.get(t, prop, receiver);
      }
    });
    for (const applicability of ['N/A', 'unknown']) {
      const out = checkArtifacts(ctx, inventory, { obligations: [{ ...lint, applicability }] }, target);
      const result = resultOf(out, lint.id);
      if (result.outcome !== 'none') failures.push(`${label}/${applicability}: outcome=${result.outcome}`);
      if (!result.artifactDigest.includes(`${RENAME_FROM}=${RENAME_SOURCE_SPOOF}`)) {
        failures.push(`${label}/${applicability}: audit=${result.artifactDigest}`);
      }
      if (diagnosticCodes(out).includes('candidate-artifacts-invalid')) {
        failures.push(`${label}/${applicability}: candidate-artifacts-invalid emitted`);
      }
    }
    if (sourceGets === 0) failures.push(`${label}: the legacy read was not performed`);

    const record = execRecord(ctx, 'pair-run', 'doc-change:doc-lint', {
      paths: [RENAME_FROM, RENAME_TO], candidatePaths: [RENAME_TO], baselinePaths: [RENAME_FROM]
    });
    const applicable = runDocLint(ctx, target, { artifacts: inventory, records: [record] });
    const applicableResult = resultOf(applicable, 'doc-change:doc-lint');
    if (applicableResult.outcome !== 'pass') failures.push(`${label}/applicable: outcome=${applicableResult.outcome}`);
    if (!applicableResult.artifactDigest.includes(`${RENAME_FROM}=missing`)) {
      failures.push(`${label}/applicable: audit=${applicableResult.artifactDigest}`);
    }
  }
  assert.deepStrictEqual(failures, [],
    `inapplicable obligations must keep the legacy audit read: ${failures.join('; ')}`);
});

checkCase('335 P3 non-baseline callers keep the legacy candidate read for the audit identity', () => {
  const ctx = prepare('docs-only');
  const spoof = sha256('legacy non-baseline spoof');
  const inventory = new Proxy(ctx.artifacts, {
    getPrototypeOf() { return Object.prototype; },
    get(t, prop, receiver) {
      if (prop === GUIDE) return { digest: spoof };
      return Reflect.get(t, prop, receiver);
    }
  });
  const output = check(ctx, {
    artifacts: inventory,
    executionRecords: [execRecord(ctx, 'edit-run', 'doc-change:doc-lint', {
      paths: [GUIDE], candidatePaths: [GUIDE], artifactDigests: { [GUIDE]: spoof }
    })]
  });
  const result = resultOf(output, 'doc-change:doc-lint');
  assert.strictEqual(result.outcome, 'pass', 'a non-baseline edit still binds through the legacy lane');
  assert.ok(result.artifactDigest.includes(`${GUIDE}=${spoof}`),
    `the legacy non-baseline audit read is retained: ${result.artifactDigest}`);
});

function sharedDestinationContext(target) {
  const ctx = prepare('rename', target);
  const lint = obligationOf(ctx, 'doc-change:doc-lint');
  const obligation = {
    ...lint,
    scope: {
      ...lint.scope,
      paths: [RENAME_FROM, RENAME_SECOND_SOURCE, RENAME_TO],
      baselinePaths: [
        { path: RENAME_FROM, reason: 'rename-from', renameTo: RENAME_TO },
        { path: RENAME_SECOND_SOURCE, reason: 'rename-from', renameTo: RENAME_TO }
      ]
    }
  };
  return {
    ctx,
    obligations: ctx.obligations.map(item => (item.id === lint.id ? obligation : item)),
    baseline: {
      digest: ctx.baseline.digest,
      artifacts: { ...ctx.baseline.artifacts, [RENAME_SECOND_SOURCE]: SECOND_SOURCE_BASELINE }
    }
  };
}

function sharedPairRecord(ctx, id, destinationDigest) {
  return execRecord(ctx, id, 'doc-change:doc-lint', {
    paths: [RENAME_FROM, RENAME_SECOND_SOURCE, RENAME_TO],
    candidatePaths: [],
    baselinePaths: [RENAME_FROM, RENAME_SECOND_SOURCE],
    artifactDigests: { [RENAME_TO]: destinationDigest },
    baselineArtifacts: {
      [RENAME_FROM]: ctx.baseline.artifacts[RENAME_FROM],
      [RENAME_SECOND_SOURCE]: SECOND_SOURCE_BASELINE
    }
  });
}

checkCase('335 P3 two accepted entries sharing a rename destination must agree on the validated digest', () => {
  const failures = [];
  for (const target of [modules, packageModules]) {
    const label = target === modules ? 'canonical' : 'packaged';
    const run = (artifacts, records) => {
      const { ctx, obligations, baseline } = sharedDestinationContext(target);
      return target.checkDocObligations({ obligations, artifacts, baseline, executionRecords: records, reviewRecords: [] });
    };

    // Stable shared destination: matching validated values still pass.
    {
      const { ctx } = sharedDestinationContext(target);
      const out = run(
        { ...ctx.artifacts, [RENAME_TO]: { digest: RENAME_CAPTURED } },
        [sharedPairRecord(ctx, 'pair-run', RENAME_CAPTURED)]
      );
      const result = resultOf(out, 'doc-change:doc-lint');
      if (result.outcome !== 'pass') failures.push(`${label}/stable: outcome=${result.outcome}`);
      if (!result.artifactDigest.includes(`${RENAME_TO}=${RENAME_CAPTURED}`)) {
        failures.push(`${label}/stable: audit=${result.artifactDigest}`);
      }
    }

    // Dynamic shared destination: D1 for the first entry's metadata, D2 for the second.
    {
      const { ctx } = sharedDestinationContext(target);
      const dynamic = countingDigestEntry(RENAME_CAPTURED, { validReads: 3, later: 'value', laterValue: RENAME_LATER });
      const artifacts = { ...ctx.artifacts, [RENAME_TO]: dynamic.entry };
      const out = run(artifacts, [
        sharedPairRecord(ctx, 'pair-run', RENAME_CAPTURED),
        sharedPairRecord(ctx, 'alternate-run', RENAME_CAPTURED)
      ]);
      const result = resultOf(out, 'doc-change:doc-lint');
      if (result.outcome !== 'none') failures.push(`${label}/dynamic: outcome=${result.outcome}`);
      if (!diagnosticCodes(out).includes('baseline-path-invalid')) {
        failures.push(`${label}/dynamic: diagnostics=${diagnosticCodes(out)}`);
      }
    }

    // Inherited-only destination digest is still not an own validated value.
    {
      const { ctx } = sharedDestinationContext(target);
      const out = run(
        { ...ctx.artifacts, [RENAME_TO]: Object.create({ digest: RENAME_CAPTURED }) },
        [sharedPairRecord(ctx, 'pair-run', RENAME_CAPTURED)]
      );
      if (resultOf(out, 'doc-change:doc-lint').outcome === 'pass') {
        failures.push(`${label}/inherited: an inherited-only shared destination passed`);
      }
    }

    // Caller-asserted alias fields are not authority: a raw diff digest does not override
    // the live validated value.
    {
      const { ctx, obligations, baseline } = sharedDestinationContext(target);
      const aliased = obligations.map(item => item.id === 'doc-change:doc-lint'
        ? {
            ...item,
            scope: {
              ...item.scope,
              baselinePaths: item.scope.baselinePaths.map(entry => ({
                ...entry, renameDestinationDigest: RENAME_LATER
              }))
            }
          }
        : item);
      const out = target.checkDocObligations({
        obligations: aliased,
        artifacts: { ...ctx.artifacts, [RENAME_TO]: { digest: RENAME_CAPTURED } },
        baseline,
        executionRecords: [sharedPairRecord(ctx, 'pair-run', RENAME_CAPTURED)],
        reviewRecords: []
      });
      const result = resultOf(out, 'doc-change:doc-lint');
      if (result.outcome !== 'pass') failures.push(`${label}/alias: outcome=${result.outcome}`);
      if (!result.artifactDigest.includes(`${RENAME_TO}=${RENAME_CAPTURED}`)) {
        failures.push(`${label}/alias: audit=${result.artifactDigest}`);
      }
    }
  }
  assert.deepStrictEqual(failures, [],
    `shared rename destinations must agree on the validated digest: ${failures.join('; ')}`);
});

// ---------------------------------------------------------------------------
// P2 applicability-gated destination snapshot (review r4318520818 at 56f3094):
// N/A and unknown obligations never bind evidence, so their destination digest
// getter must not be consumed during metadata validation; the audit identity
// keeps the un-gated legacy candidate read (the parent value).
// ---------------------------------------------------------------------------

checkCase('335 P2 an inapplicable rename never consumes the destination snapshot during metadata', () => {
  const failures = [];
  for (const target of [modules, packageModules]) {
    const label = target === modules ? 'canonical' : 'packaged';
    for (const applicability of ['N/A', 'unknown', undefined]) {
      const ctx = prepare('rename', target);
      const lint = obligationOf(ctx, 'doc-change:doc-lint');
      const counted = countingDigestEntry(RENAME_CAPTURED, { validReads: 3, later: 'value', laterValue: RENAME_LATER });
      const artifacts = { ...ctx.artifacts, [RENAME_TO]: counted.entry };
      let obligation;
      if (applicability === undefined) {
        obligation = { ...lint };
        delete obligation.applicability;
      } else {
        obligation = { ...lint, applicability };
      }
      let out;
      try {
        out = checkArtifacts(ctx, artifacts, { obligations: [obligation] }, target);
      } catch (error) {
        failures.push(`${label}/${applicability}: escaped: ${error.message}`);
        continue;
      }
      const result = resultOf(out, lint.id);
      if (result.outcome !== 'none') failures.push(`${label}/${applicability}: outcome=${result.outcome}`);
      if (!result.artifactDigest.includes(`${RENAME_TO}=${RENAME_CAPTURED}`)) {
        failures.push(`${label}/${applicability}: audit=${result.artifactDigest}`);
      }
      if (counted.reads() !== 3) failures.push(`${label}/${applicability}: destination getter reads=${counted.reads()}`);
      const codes = diagnosticCodes(out);
      if (codes.includes('baseline-path-invalid') || codes.includes('candidate-artifacts-invalid')) {
        failures.push(`${label}/${applicability}: diagnostics=${codes.join(', ')}`);
      }
    }

    // Positive control: the applicable obligation still captures the destination snapshot
    // once during metadata and binds against it.
    {
      const ctx = prepare('rename', target);
      const counted = countingDigestEntry(RENAME_CAPTURED, { validReads: 3, later: 'value', laterValue: RENAME_LATER });
      const artifacts = { ...ctx.artifacts, [RENAME_TO]: counted.entry };
      const record = {
        ...execRecord(ctx, 'pair-run', 'doc-change:doc-lint', {
          paths: [RENAME_FROM, RENAME_TO], candidatePaths: [], baselinePaths: [RENAME_FROM],
          artifactDigests: { [RENAME_TO]: RENAME_CAPTURED }
        })
      };
      const obligation = obligationOf(ctx, 'doc-change:doc-lint');
      const out = checkArtifacts(ctx, artifacts, { obligations: [obligation], executionRecords: [record] }, target);
      const result = resultOf(out, 'doc-change:doc-lint');
      if (result.outcome !== 'pass') failures.push(`${label}/applicable: outcome=${result.outcome}`);
      if (counted.reads() !== 3) failures.push(`${label}/applicable: destination getter reads=${counted.reads()}`);
    }
  }
  assert.deepStrictEqual(failures, [],
    `inapplicable obligations must not consume the destination snapshot: ${failures.join('; ')}`);
});

// ---------------------------------------------------------------------------
// P2 guarded baselinePaths entry inspection (review r4318520836 at 56f3094):
// a Proxy entry whose path, reason, or renameTo field getter/descriptor trap
// throws fails the entry closed as a metadata error instead of escaping the
// checker, and a late-throwing entry accessor cannot abort the audit mirror.
// ---------------------------------------------------------------------------

checkCase('335 P2 baselinePaths entry accessors that throw fail the entry closed without escaping', () => {
  const failures = [];
  for (const target of [modules, packageModules]) {
    const label = target === modules ? 'canonical' : 'packaged';
    const lintObligation = (ctx, entry) => {
      const lint = obligationOf(ctx, 'doc-change:doc-lint');
      return { ...lint, scope: { ...lint.scope, baselinePaths: [entry] } };
    };

    // A throwing path getter must not escape.
    {
      const ctx = prepare('deleted-adr', target);
      const entry = new Proxy({ path: DELETED_ADR, reason: 'deleted' }, {
        get(t, prop) {
          if (prop === 'path') throw new Error('entry path getter');
          return Reflect.get(t, prop);
        }
      });
      let out;
      try {
        out = checkArtifacts(ctx, ctx.artifacts, { obligations: [lintObligation(ctx, entry)] }, target);
      } catch (error) {
        failures.push(`${label}/path-getter: escaped: ${error.message}`);
        continue;
      }
      if (resultOf(out, 'doc-change:doc-lint').outcome !== 'none') {
        failures.push(`${label}/path-getter: outcome=${resultOf(out, 'doc-change:doc-lint').outcome}`);
      }
      if (!diagnosticCodes(out).includes('baseline-path-invalid')) {
        failures.push(`${label}/path-getter: diagnostics=${diagnosticCodes(out)}`);
      }
    }

    // A throwing reason getter must not escape.
    {
      const ctx = prepare('deleted-adr', target);
      const entry = new Proxy({ path: DELETED_ADR, reason: 'deleted' }, {
        get(t, prop) {
          if (prop === 'reason') throw new Error('entry reason getter');
          return Reflect.get(t, prop);
        }
      });
      let out;
      try {
        out = checkArtifacts(ctx, ctx.artifacts, { obligations: [lintObligation(ctx, entry)] }, target);
      } catch (error) {
        failures.push(`${label}/reason-getter: escaped: ${error.message}`);
        continue;
      }
      if (resultOf(out, 'doc-change:doc-lint').outcome !== 'none') {
        failures.push(`${label}/reason-getter: outcome=${resultOf(out, 'doc-change:doc-lint').outcome}`);
      }
      if (!diagnosticCodes(out).includes('baseline-path-invalid')) {
        failures.push(`${label}/reason-getter: diagnostics=${diagnosticCodes(out)}`);
      }
    }

    // A descriptor trap on the renameTo own-presence check must not escape.
    {
      const ctx = prepare('deleted-adr', target);
      const entry = new Proxy({ path: DELETED_ADR, reason: 'deleted' }, {
        getOwnPropertyDescriptor(t, prop) {
          if (prop === 'renameTo') throw new Error('entry descriptor trap');
          return Reflect.getOwnPropertyDescriptor(t, prop);
        }
      });
      let out;
      try {
        out = checkArtifacts(ctx, ctx.artifacts, { obligations: [lintObligation(ctx, entry)] }, target);
      } catch (error) {
        failures.push(`${label}/descriptor: escaped: ${error.message}`);
        continue;
      }
      if (resultOf(out, 'doc-change:doc-lint').outcome !== 'none') {
        failures.push(`${label}/descriptor: outcome=${resultOf(out, 'doc-change:doc-lint').outcome}`);
      }
      if (!diagnosticCodes(out).includes('baseline-path-invalid')) {
        failures.push(`${label}/descriptor: diagnostics=${diagnosticCodes(out)}`);
      }
    }

    // A path getter that throws only on a later read cannot abort the audit mirror; a
    // valid tombstone still passes (the entry metadata itself was validated once).
    {
      const ctx = prepare('deleted-adr', target);
      let pathReads = 0;
      const entry = new Proxy({ path: DELETED_ADR, reason: 'deleted' }, {
        get(t, prop) {
          if (prop === 'path') {
            pathReads += 1;
            if (pathReads > 1) throw new Error('late path getter');
            return Reflect.get(t, prop);
          }
          return Reflect.get(t, prop);
        }
      });
      const record = execRecord(ctx, 'tomb-run', 'doc-change:doc-lint', {
        paths: [DELETED_ADR], candidatePaths: [], baselinePaths: [DELETED_ADR]
      });
      let out;
      try {
        out = checkArtifacts(ctx, ctx.artifacts, {
          obligations: [lintObligation(ctx, entry)], executionRecords: [record]
        }, target);
      } catch (error) {
        failures.push(`${label}/late-path: escaped: ${error.message}`);
        continue;
      }
      if (resultOf(out, 'doc-change:doc-lint').outcome !== 'pass') {
        failures.push(`${label}/late-path: outcome=${resultOf(out, 'doc-change:doc-lint').outcome}`);
      }
    }

    // Inapplicable obligations keep the fail-closed metadata diagnostic and the legacy
    // legacy outcome without escaping.
    {
      const ctx = prepare('deleted-adr', target);
      const entry = new Proxy({ path: DELETED_ADR, reason: 'deleted' }, {
        get(t, prop) {
          if (prop === 'path' || prop === 'reason') throw new Error('entry field getter');
          return Reflect.get(t, prop);
        }
      });
      for (const applicability of ['N/A', 'unknown']) {
        let out;
        try {
          out = checkArtifacts(ctx, ctx.artifacts, {
            obligations: [{ ...lintObligation(ctx, entry), applicability }]
          }, target);
        } catch (error) {
          failures.push(`${label}/${applicability}: escaped: ${error.message}`);
          continue;
        }
        const result = resultOf(out, 'doc-change:doc-lint');
        if (result.outcome !== 'none') failures.push(`${label}/${applicability}: outcome=${result.outcome}`);
        if (!diagnosticCodes(out).includes('baseline-path-invalid')) {
          failures.push(`${label}/${applicability}: diagnostics=${diagnosticCodes(out)}`);
        }
      }
    }
  }
  assert.deepStrictEqual(failures, [],
    `baselinePaths entry accessor failures must fail closed: ${failures.join('; ')}`);
});

helper.finish();
