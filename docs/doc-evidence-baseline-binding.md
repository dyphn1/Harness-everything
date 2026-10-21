# Baseline-bound document evidence (#335)

Additive evidence contract for deleted files and the source endpoint of a rename. This extends
the phase 3a `doc-change` / `requirement-sync` producer in
[`document-lifecycle.md`](document-lifecycle.md). It does not reconcile evidence with workflow
disposition (#325 phase 3b/3c), add a lock, or add a router/provider path.

## Phase 0 read-boundary contract (#341)

Phase 0 preserves the public `checkDocObligations()` result and the current reads. A read role
captures facts at most once **per its existing role-specific identity and scope**; consumers of
that same role (validation, binding, stale diagnostics, and audit where applicable) reuse the
capture. Consumers are not roles, so separating consumers does not permit another caller-object
read. Detached immutable internal views are a Phase 0B implementation requirement; they must not
be obtained by freezing or retaining mutable caller-owned objects. An internally consistent
snapshot proves agreement with the supplied values, not their external truth or provenance.

The private `ReadResult<T>` contract for the later capture layer distinguishes:

```ts
type ReadResult<T> =
  | { kind: 'present'; value: T }
  | { kind: 'absent' }
  | { kind: 'inherited' }
  | { kind: 'unknown'; reason: string };
```

`present` includes an own property whose value is `undefined`; field validation decides whether
that value is valid, and it must not be collapsed into `absent`. `absent` means no own key exists.
`inherited` records that a value is reachable only through the prototype chain and cannot satisfy
an own-key evidence requirement. `unknown` covers throwing or otherwise uninspectable input. An
unknown read is not a completed obligation and cannot produce a pass; mandatory baseline evidence
that is invalid or unknown fails closed with a structured diagnostic. This representation does
not change existing field policy or the public output schema.

The read roles and compatibility traces are fixed to their existing identities:

| ID | Identity and read rule | Consumers / compatibility behavior |
| --- | --- | --- |
| R1 — whole-baseline digest | Invocation. Read once before the obligation loop only if `baseline` passes the plain-object check; otherwise zero reads. | Reused across obligations. This does not claim that the caller's baseline is externally attested. |
| R2 — candidate-inventory classification | Invocation, lazy. At most one prototype inspection, only when an applicable baseline-declaring obligation needs it. | The same classification is shared across obligations as today. Inapplicable and non-baseline lanes do not trigger it. |
| R3 — rename-destination validation | Obligation × declaring entry. One own-digest read for each declaring entry that reaches it; accepted entries must agree. | A rejected destination is poisoned: never reread, later declarations fail closed, and the failed snapshot takes precedence in audit over an earlier success. Distinct declaring entries remain separate observations. |
| R4 — baseline-entry metadata and source own-key absence | Obligation × entry. Capture `path`, `reason`, own `renameTo` presence/value, and source absence once for reuse. | The tested candidate descriptor budget combines R3 and R4: two inspections for a rename (destination presence and source absence), one for a deletion. |
| R5 — per-path baseline digest | Obligation × path. Capture once during metadata validation. | Audit mirror, stale diagnostics, and baseline binding reuse that validated value. |
| R6 — ordinary candidate capture | Obligation × path, applicable baseline-annotated lane. | Preserve today's `artifact()` access trace (up to three digest-property reads), seed from a successful R3 value, and reuse the capture for binding, audit, and stale diagnostics. |
| C1 — legacy audit lane | Obligation × path for N/A, unknown, or non-baseline cases. | Preserve today's `artifact()` reads; this is a compatibility trace, not a once-only guarantee. N/A and unknown do not consume R3. |
| C2 — evidence-record consumption | Obligation × record identity × field. | Preserve today's decision and provenance field read counts, including `paths`, `baseDigest`, `artifactDigests`, and `baselineArtifacts`; a single record must still bind both rename endpoints. |
| C3 — invocation-level ingestion | Invocation × record / obligation, before evaluation, including when there are no obligations. | Preserve `isRecord()` reads of `id` / `obligationId` (up to two each in the current guard/short-circuit order, twice each for an admitted stable record), `knownIds` reads of obligation `id` / `capability`, and the waiver scan reads of review-record `kind` / `obligationId`. |
| C4 — stale-diagnostic record paths | Obligation × record path. | Preserve iteration over `record.paths`; a path without a scoped capture falls back to the legacy `artifact()` read, including for applicable baseline-bound obligations. |
| C5 — requirement-sync PRD-set enumeration | Conditional obligation check. | Preserve own-key enumeration and `artifact()` reads for each `docs/prd/` path, including out-of-scope PRDs, only when envelope verification reaches that check. |

**Closure rule.** Any caller-object access not listed in R1–R6 remains a compatibility trace by
default: preserve its existing timing, count, and decision effect until a separately approved
change says otherwise. This does not permit a new access. A caller-object access absent from the
current implementation has a budget of zero in Phase 0. Phase 0A records ordered `get`, `ownKeys`,
`getOwnPropertyDescriptor`, and `getPrototypeOf` events across every factory-known caller object
and pins the complete trace per observed case and distribution, including symbol properties,
result category/identity, and thrown markers. Tracing must be transparent: the traced and unwrapped
controls must agree on outputs, exceptions, identity relationships, semantic read counts, and
caller-input integrity. The tracer must respect Proxy invariants for frozen objects and nested
non-configurable properties. A trace proves completeness for its observed case; it does not
establish branch coverage or replace Phase 0C's structural/API boundary and negative controls. Any
observed unclassified access is added to the contract before Phase 0B. The applicability gate
protects R2, R3, and scoped candidate capture; it does not gate every baseline, metadata, or
pre-evaluation ingestion read (R1 and C3 retain their stated timing). C2, C4, C5, and C3's
pre-evaluation ingestion are explicit compatibility lanes; their bounded reads must remain
isolated or be documented as narrow exceptions to the Phase 0C boundary.

### Phase limits

Phase 0A defines this contract and builds the RED replay corpus, exact read traces, and qualified
mutation controls. Each corpus case compares the full public result (`observation`, `outcome`,
diagnostics, `artifactDigest`, `baseDigest`, `baselineArtifacts`, provenance, and `recordRefs`),
role-specific counts/traces, and input integrity against canonical and packaged implementations.
Phase 0A does not change evaluator behavior. Phase 0B introduces the smallest private
capture layer as a pure refactor, preserving outputs, decision semantics, audit identity, read
order/counts, input integrity, and canonical/package parity. Phase 0C enforces the normalized
applicable baseline-bound boundary and qualifies mutation gates, including negative controls.
Those phases and relevant CI on the final merged SHA are required for Gate E0. Phase 0A alone is
not E0 and does not authorize runtime Evidence Reconciliation. Snapshot consistency is not external
VCS/provenance attestation; that remains in #325 Phase 3b/3c.

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
  candidate. A deleted entry must not carry `renameTo` at all; any own `renameTo` property,
  including an explicitly present `undefined`, is malformed and fails the obligation closed.
- `reason: 'rename-from'` describes the old endpoint of an identified content-identical move.
  The destination is named by `renameTo` and must itself be a member of the same
  `scope.paths`. A `renameTo` outside the scope is malformed and fails the obligation closed.
- Under R4, each `baselinePaths` entry's fields (`path`, `reason`, and the own-key `renameTo`
  presence) are snapshotted through one guarded inspection per obligation/entry, then reused by
  consumers. An entry whose field getter or descriptor trap throws is a metadata error (`baseline-path-invalid`)
  and fails the entry closed instead of escaping the checker; a field accessor that throws only on
  a later read cannot abort the audit mirror; the mirror is built from the metadata-validated
   snapshot (validated path and captured digest) and is never a second read of the raw entry
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
3. carries the exact trusted `baseline.artifacts[path]` value as an **own-key** entry in
   `baselineArtifacts`;
4. carries **no** `artifactDigests` entry for that path, and the candidate artifact map has **no
   own-key entry** for that path.

The trusted per-path value is validated and captured once for its R5 obligation/path identity
during metadata validation.
The audit mirror, the stale-baseline diagnostics, and baseline binding compare against that
captured value and never re-read the caller-owned `baseline.artifacts` map during evidence
evaluation: a stateful own getter cannot satisfy a record with a value it started returning only
after validation, cannot mute the stale-baseline diagnostic, and cannot drift the audit mirror.
Its first read must therefore be the value every consumer sees; a getter that starts returning a
different or unusable value later is factored out entirely. A baseline per-path inspection that
throws during validation is a `baseline-artifact-invalid` metadata error and fails the path
closed instead of escaping the checker. The audit mirror is likewise keyed by the **validated**
path snapshot rather than a re-read of `baselinePaths[].path`, so a stateful `path` accessor is
read once within its R4 obligation/entry snapshot and a passing result always describes the
baseline identity that validated and bound the evidence.

The whole-baseline identity `baseline.digest` follows R1: the invocation-level read, when eligible,
is the scalar validated and reused by every obligation. A rename destination's own digest follows
R3: each declaring entry that reaches validation has its own read, with shared-destination
agreement and poisoned-snapshot precedence. Consumers of each accepted snapshot reuse its captured
value for metadata, binding, stale diagnostics, and audit identity.

Per-path evidence must be carried explicitly. Inherited properties in `baseline.artifacts` or a
record's `baselineArtifacts` are not own-key evidence and never satisfy a path; the trusted
baseline entry itself must also be an own-key entry. Null-prototype dictionaries remain valid
when they carry own entries.

Presence is own-key membership, not digest truthiness: a candidate map entry such as `{}`,
`{ digest: '' }`, or `null` still means the path is present, so it is contradictory path state,
not a deletion. Equally, a record with an otherwise correct `baselineArtifacts` entry that also
carries an `artifactDigests` entry for the deleted path (a real, empty, or fake digest) is
contradictory and does not bind that path; it is reported as `baseline-path-candidate-digest`.
A valid alternate record may still satisfy the obligation.

A rename source is satisfied only by a **single** record that also lists the current
`renameTo` path, carries its current candidate digest as an **own-key** entry in
`artifactDigests`, carries no `artifactDigests` entry for the old path, and has no own-key
candidate artifact map entry for the old path. The candidate destination must itself be an
own-key entry in the candidate artifact map whose artifact entry declares its own `digest`; an
inherited nested digest is not explicit evidence. The own digest validated by that metadata check
is carried into the captured snapshot, and the record binds the destination against that captured
candidate digest — the same one used by ordinary candidate binding, the audit identity, and the
stale diagnostics. The destination is therefore never read again through the candidate map during
capture or binding: a nested `digest` that throws or changes after validation cannot make a stale
destination pair bind while the audit/stale verdicts still describe the captured value. The same
R3 also governs rejected destination snapshots: when a declaring entry's own-digest read throws or
returns an unusable value, that failed snapshot ('') is recorded and later declarations in the
same obligation's metadata loop do not reread the poisoned destination — the rejected entry's
metadata read remains its only digest read, and the failed path contributes `path=missing` to
`artifactDigest` instead of a later, different value. The same
record can cover both endpoints. Destination-only evidence, source-only tombstones, split endpoint
records, and stale destination digests do not satisfy the source. A deletion tombstone therefore
cannot stand in for a known rename. This destination validation and the snapshot it produces are
**applicability-gated**: `N/A` and `unknown` (and obligations without an applicability) never bind
evidence, so they do not consume the destination digest getter during metadata validation; their
audit identity keeps the un-gated legacy candidate read, and a stateful accessor therefore reports
the same first legacy value to them that it would report without baseline binding.

For an applicable baseline-only path, R4 metadata validation captures candidate own-key absence
once for that obligation/entry. Once a declared baseline path has been confirmed to have **no**
own-key candidate entry, that validated absence is carried on the entry; binding and the
`artifactDigest` audit identity reuse it instead of
re-inspecting the candidate map, so a `Proxy` that answers own-property or `get` inspection
consistently during validation cannot later abort the check or change the audit key. A
baseline-only path therefore contributes `path=missing` to `artifactDigest` from the validated
proof rather than from a fresh candidate read. This shortcut applies only to **applicable**
obligations. `N/A` and `unknown` obligations never bind evidence and keep the legacy candidate read
for their audit identity (so a candidate `get` that supplies a digest is still reflected there);
they remain `outcome: 'none'` and do not emit `candidate-artifacts-invalid` from this applicability-gated check.

When several `rename-from` entries declare one shared destination, the read-once promise is scoped
**per declaring entry**: each entry's metadata validation reads the shared destination once (their
agreement of validated values is what detects a contradictory shared-destination snapshot). A
poisoned destination — one whose snapshot was rejected — is honored inside the metadata loop: a
later declaring entry fails closed without reading the destination again, and the failed snapshot
wins in the audit, overriding any previously validated successful snapshot that an earlier entry
carried, rather than silently describing a value the getter shipped after the failure.

A rename destination's validated own digest is carried too. When more than one accepted
`rename-from` entry shares one `renameTo`, every entry's validated own digest must agree; a
conflicting validated digest is a contradictory shared-destination snapshot and fails the whole
obligation closed (metadata error, `outcome: 'none'`) before any binding. The carried digest must
be a non-empty string: a stateful `digest` accessor whose value is not a usable string is not
carried or seeded — instead the destination path is recorded as a visited failure, and neither the
capture loop nor the audit identity reads the destination again. Only **applicable** obligations
validate and carry this destination snapshot; `N/A` and `unknown` obligations keep the legacy
candidate read for their audit identity and do not consume the destination getter during metadata
validation.

The binding applies to execution and review records alike. Existing review approval, waiver,
failing-command, requirement-sync authority, and applicability rules are unchanged. A correctly
bound command that fails still produces an observed failure, not a pass.

## Trust limits

- `baseline.artifacts` is trusted caller/VCS input. The checker proves that evidence agrees with
  the declared baseline values; it does not read Git or recompute those bytes. A validated
  per-path value is read and captured once, so the agreement proof is against a single validated
  snapshot rather than the value a stateful getter returns at later moments.
- The whole-baseline `digest` remains the identity anchor. A per-path digest without the exact
  whole-baseline identity is insufficient.
- Candidate evidence remains authoritative for every present, new, or edited path. A baseline
  digest alone never satisfies such a path.
- Path membership is explicit. A record cannot bind a path only by carrying its digest.
- Candidate presence is own-key membership in the candidate artifact map. A present entry whose
  digest is absent, empty, or not a usable value is still present; it is never silently
  reinterpreted as a deletion or as a rename source.
- For an applicable obligation that declares baseline-only paths, the top-level candidate
  `artifacts` argument must itself be a non-null object, not an array, whose prototype is
  `Object.prototype` or `null`. An omitted, `undefined`, `null`, array, string, `Map`, `Date`,
  `RegExp`, class instance, custom-prototype object, or other malformed top-level value is
  **unknown inventory** and fails closed with `candidate-artifacts-invalid`; an explicit `{}` or
  an empty null-prototype dictionary remains the legitimate empty deletion inventory. This
  provenance check is limited to obligations that actually declare baseline paths, and it does
  not change the shared `isPlainObject` normalizer used by callers without
  `scope.baselinePaths`. The prototype is read only for those applicable baseline-only
  obligations; a value whose prototype inspection throws (for example a `Proxy` with a throwing
  `getPrototypeOf` trap) is likewise unknown inventory, and unrelated non-baseline or
  inapplicable obligations never trigger the read. The same boundary is exception-safe for
  own-property inspection: a throwing property-descriptor trap or a throwing nested `digest`
  accessor encountered during metadata validation or the pre-binding capture is classified as
  unknown inventory (`candidate-artifacts-invalid` for applicable baseline-only obligations)
  instead of escaping the checker. Inspecting a `baselinePaths` entry itself is guarded the same
  way: an entry whose `path`, `reason`, or `renameTo` field getter or descriptor trap throws is a
  `baseline-path-invalid` metadata error, not an escape; the audit mirror is built from the
  validated snapshot and contains no second read of the raw entry, so an accessor that only
  misbehaves after the guarded snapshot is never reached. Inspection is not repeated after
  validation for a validated baseline-only path or a rename destination, so a trap that only
  starts throwing on a later re-inspection is never reached. `N/A` and `unknown` obligations never
  emit that diagnostic.
- A mixed scope can combine baseline-only paths with ordinary candidate paths (for example one
  document deleted and another edited in the same change set). For an applicable obligation
  that declares baseline paths, every ordinary scoped candidate digest is captured once before
  evidence binding; binding, the `artifactDigest` audit identity, and the stale-digest
  diagnostics all use that same captured snapshot, so a nested digest accessor whose later read
  throws or returns a different value cannot make the audit key or a stale verdict disagree with
  the digest that bound evidence. This includes the rename destination: after metadata proves the
  destination is an own-key inventory entry with its own digest, the captured snapshot is seeded
  with that validated own digest and the destination candidate map is not read again during
  capture, so a stale pair plus a destination-only record cannot jointly pass. Declared
  baseline-only paths were validated absent during metadata and are not read again either. A
  throwing accessor on one of the remaining ordinary paths during capture also fails the candidate
  inventory closed. Callers without `scope.baselinePaths` keep the legacy candidate-binding
  behavior unchanged, including the legacy `candidateBound` read path.

## Fail-closed cases

The result is not a pass when any of the following is observed:

- absent whole-baseline identity, absent `baseline.artifacts`, or an invalid/missing per-path
  baseline value for a declared baseline-only path;
- a baseline-only entry that is missing from `scope.paths`, is duplicated, has an unknown reason,
  has a malformed `renameTo` (empty, equal to the source, outside `scope.paths`, or — for an
  applicable obligation — without an own-key candidate destination artifact that declares its own
  `digest`), or whose field inspection fails (a `path`, `reason`, or `renameTo` getter or
  descriptor trap that throws during the guarded entry snapshot);
- a deleted entry that carries a `renameTo` property at all, including an explicitly present
  `undefined`;
- a present `scope.baselinePaths` annotation that is not an array, including an explicitly
  present `undefined`; absence of the property remains backward-compatible;
- an applicable obligation that declares baseline-only paths but receives an absent or malformed
  top-level candidate `artifacts` map (omitted, `undefined`, `null`, array, string, or an
  object-like value that is not a plain object or null-prototype dictionary, including `Map`,
  `Date`, `RegExp`, class instances, objects whose prototype cannot be inspected, and inventories
  whose own-property descriptors or nested digest accessors throw); an explicit `{}` or
  null-prototype dictionary is valid;
- a mixed baseline+ordinary scope whose ordinary candidate digest accessor throws while the
  candidate inventory is captured before binding;
- a rename pair whose destination digest differs from the captured destination candidate digest,
  including a stale pair that a separate destination-only record would otherwise leave jointly
  passing;
- a rename destination whose validated own digest conflicts with another accepted entry that
  shares the same `renameTo`, or whose captured own value is not a usable non-empty string;
- a baseline-only path with an own-key candidate artifact map entry, even when that entry has no
  usable digest (`{}`, `{ digest: '' }`, or `null`);
- a record that carries an `artifactDigests` entry (real, empty, or fake) for a baseline-only
  path;
- a rename destination with no candidate artifact (applicable obligations only; `N/A` and
  `unknown` obligations keep the legacy candidate read for their audit identity);
- a record with the wrong baseline identity, the wrong per-path baseline digest, an absent or
  empty `baselineArtifacts` entry, or stale/missing endpoint evidence — where "wrong" is judged
  against the validated baseline value captured during metadata, not a live re-read;
- a baseline per-path digest whose inspection throws (a getter or descriptor trap), which is a
  `baseline-artifact-invalid` metadata error rather than an escape;
- a stateful `baselinePaths[].path` accessor whose later read names a different path: the audit
  mirror is keyed by the validated path snapshot, so a pass can never describe a different
  baseline identity than the one that validated the evidence;
- an unsupported review kind, an unapproved review, or an incomplete execution record.

These cases are visible in diagnostics and remain `outcome: 'none'` unless the failure is a
correctly bound command, which remains `outcome: 'fail'` as before.

## Audit output

Results keep the existing `artifactDigest`, `baseDigest`, `provenance`, and `recordRefs` fields.
Obligations that declare baseline paths additionally expose `baselineArtifacts`, mapping each
validated baseline-only path to the trusted baseline value used for the check. The field is
additive; callers that do not use baseline binding see unchanged output.
