# Baseline-bound document evidence (#335)

Additive evidence contract for deleted files and the source endpoint of a rename. This extends
the phase 3a `doc-change` / `requirement-sync` producer in
[`document-lifecycle.md`](document-lifecycle.md). It does not reconcile evidence with workflow
disposition (#325 phase 3b/3c), add a lock, or add a router/provider path.

## Data shape

The trusted baseline keeps its existing whole-tree identity and may add per-path SHA256 values:

```js
baseline = {
  digest: '<whole-baseline identity>',
  artifacts: {
    'docs/adr/GRPH-008.md': '<sha256 of the trusted baseline file>'
  }
}
```

`digest` is still required for every record, including baseline-only evidence. `artifacts` is
optional; when a scope declares baseline-only paths, the matching per-path values are required.

Derivation keeps every original `scope.paths` entry and adds an annotation for paths that cannot
have a candidate artifact:

```js
scope = {
  paths: ['docs/reference/guide.md', 'docs/reference/old-guide.md'],
  baselinePaths: [
    { path: 'docs/reference/old-guide.md', reason: 'rename-from', renameTo: 'docs/reference/guide.md' }
  ]
}
```

- `reason: 'deleted'` describes a path present in the trusted baseline and absent from the
  candidate.
- `reason: 'rename-from'` describes the old endpoint of an identified content-identical move.
  The destination is named by `renameTo`.
- A path without a `baselinePaths` entry remains a normal candidate path and keeps the existing
  exact candidate-digest requirement.
- `scope.paths` is never filtered to hide a baseline-only path. If the annotation is absent, the
  old fail-closed behavior remains: the path still needs candidate evidence and cannot pass.

## Record binding

Records keep `paths`, `artifactDigests`, and `baseDigest`. They may add
`baselineArtifacts`:

```js
{
  id, obligationId, command, exitCode, provenance,
  baseDigest: '<whole-baseline identity>',
  paths: ['docs/reference/old-guide.md', 'docs/reference/guide.md'],
  artifactDigests: { 'docs/reference/guide.md': '<candidate sha256>' },
  baselineArtifacts: { 'docs/reference/old-guide.md': '<trusted baseline sha256>' }
}
```

A deleted path is satisfied only when one observed record:

1. carries the exact whole-baseline `baseDigest`;
2. lists the path in `paths`;
3. carries the exact trusted `baseline.artifacts[path]` value in `baselineArtifacts`;
4. carries **no** `artifactDigests` entry for that path, and the candidate artifact map has **no
   own-key entry** for that path.

Presence is own-key membership, not digest truthiness: a candidate map entry such as `{}`,
`{ digest: '' }`, or `null` still means the path is present, so it is contradictory path state,
not a deletion. Equally, a record with an otherwise correct `baselineArtifacts` entry that also
carries an `artifactDigests` entry for the deleted path (a real, empty, or fake digest) is
contradictory and does not bind that path; it is reported as `baseline-path-candidate-digest`.
A valid alternate record may still satisfy the obligation.

A rename source is satisfied only by a **single** record that also lists the current
`renameTo` path, carries its current candidate digest in `artifactDigests`, carries no
`artifactDigests` entry for the old path, and has no own-key candidate artifact map entry for the
old path. The same record can cover both endpoints. Destination-only evidence, source-only
tombstones, split endpoint records, and stale destination digests do not satisfy the source. A
deletion tombstone therefore cannot stand in for a known rename.

The binding applies to execution and review records alike. Existing review approval, waiver,
failing-command, requirement-sync authority, and applicability rules are unchanged. A correctly
bound command that fails still produces an observed failure, not a pass.

## Trust limits

- `baseline.artifacts` is trusted caller/VCS input. The checker proves that evidence agrees with
  the declared baseline values; it does not read Git or recompute those bytes.
- The whole-baseline `digest` remains the identity anchor. A per-path digest without the exact
  whole-baseline identity is insufficient.
- Candidate evidence remains authoritative for every present, new, or edited path. A baseline
  digest alone never satisfies such a path.
- Path membership is explicit. A record cannot bind a path only by carrying its digest.
- Candidate presence is own-key membership in the candidate artifact map. A present entry whose
  digest is absent, empty, or not a usable value is still present; it is never silently
  reinterpreted as a deletion or as a rename source.

## Fail-closed cases

The result is not a pass when any of the following is observed:

- absent whole-baseline identity, absent `baseline.artifacts`, or an invalid/missing per-path
  baseline value for a declared baseline-only path;
- a baseline-only entry that is missing from `scope.paths`, is duplicated, has an unknown reason,
  or has a malformed `renameTo`;
- a baseline-only path with an own-key candidate artifact map entry, even when that entry has no
  usable digest (`{}`, `{ digest: '' }`, or `null`);
- a record that carries an `artifactDigests` entry (real, empty, or fake) for a baseline-only
  path;
- a rename destination with no candidate artifact;
- a record with the wrong baseline identity, the wrong per-path baseline digest, an absent or
  empty `baselineArtifacts` entry, or stale/missing endpoint evidence;
- an unsupported review kind, an unapproved review, or an incomplete execution record.

These cases are visible in diagnostics and remain `outcome: 'none'` unless the failure is a
correctly bound command, which remains `outcome: 'fail'` as before.

## Audit output

Results keep the existing `artifactDigest`, `baseDigest`, `provenance`, and `recordRefs` fields.
Obligations that declare baseline paths additionally expose `baselineArtifacts`, mapping each
baseline-only path to the trusted baseline value used for the check. The field is additive; callers
that do not use baseline binding see unchanged output.
