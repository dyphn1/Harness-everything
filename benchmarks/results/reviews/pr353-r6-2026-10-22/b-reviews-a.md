# Cross-review — PR #353 leg A (reviewer: leg B)

Reviewer role: **read-only** reviewer of peer A at `/Users/daniel.chang/Desktop/Skills/Harness-everything/.worktrees/353-r6-a`.
Nothing in either worktree was edited; no git/gh writes; no full suites run.

Inputs read: `/tmp/harness-353-r6-a/REPORT.md`, A's `git diff 59421f4` (production files, tests, fixture,
docs, CHANGELOG), the unchanged derive contract `harness-everything/scripts/doc-obligations.js` and
`doc-lifecycle.js`, and the S2a contract text.

Probes executed (read-only, both implementations): my consolidated probe
`/tmp/harness-353-r6-b/probe/cross-review-probe.js` (8 cases × both legs) and the coordinator's
`semantic-transitions.js` (4 cases) against A. Logs: `logs/CROSS-probe-A.log`, `logs/CROSS-probe-B.log`,
`logs/CROSS-coordinator-transitions-A.log`.

## Verdict

**ACCEPT peer A.** No blocker found. One executed behavioural difference against leg B, where A is the
stricter and packet-compliant side. Three non-blocking follow-ups for the owner.

## Review by dimension

| Dimension | Finding | Label |
| --- | --- | --- |
| Origin tuple ↔ identity | A binds all five origin-correlated fields (`workspaceId`, `sessionId`, `workflowId`, `workflowRevision`, `taskId`) of `originContext` to `identity` (`originBound`), so the provider↔captured-context half and the event-identity↔identity half are connected. The joint substitution is rejected in verification, review and the cached-acceptance path. | executed (coordinator probe 26/26 for A, per A's report) + source-traced (A's `originBound`, core line 149ff) |
| Plan ↔ identity | A checks the captured plan explicitly (`workflow.workflowId/workflowRevision/sessionId`, `task.taskId`, `prdRoot`, `configDigest`) against the identity. B relies on `taskScopeDigest` for the same links, so A's plan check is the more legible of the two; A's `plan.configDigest ↔ identity.configDigest` link has no counterpart in B. | source-traced |
| Config ↔ inventory | A adds `configBytesBound`: the captured config source bytes must equal the captured inventory bytes for the same path (`config-capture-mismatch` otherwise). The producer already enforced this at capture; the core did not. **A closes a represented link that B does not.** | source-traced + A's own non-vacuity probe (`legA/logs/red-config-link-3.log`) |
| Host binding | `originContext.activeHost` vs `config.capture.activeHost`, skipped only when neither side represents a host — same rule as B, both absent-tolerant. | source-traced |
| Binary bytes intact | Every stored byte stays in the identity framing; A ships a test asserting the per-record digest equals SHA-256 of the stored bytes and that a changed asset changes `candidateDigest` while the MUST set is unchanged. My probe's `irrelevant-asset-control` → `ready` on both legs. | executed |
| Relevant undecodable content cannot disappear | The coordinator's defect class (candidate bytes carrying `role: prd` or a REQ-citing test while the baseline record is nonsemantic) **fails closed in A** (`semantic-transitions.js` 4/4 → `unavailable`), and my probe reproduces the same two shapes → `unavailable` in both A and B. A additionally fails closed for every governed/legacy/derived/code/**test** path. | executed |
| Divergence A vs B | `undecodable-test-path-no-req` (an undecodable record at `tests/plain.dat`, no REQ id): **A → `inventory-unsupported`**, **B → `ready` (the test input is silently omitted)**. The packet says "Do not silently drop code/test/governed/derived inputs"; B drops a test input, A does not. `undecodable-code-path-no-req` → both fail closed. | executed |
| Producer/core parity | Both legs share one helper (`U.deriveFiles` in A, `deriveCapturedFacts` in B). A's producer is non-strict and its core strict, which preserves the base code's asymmetry; B makes both strict (a superset). Neither diverges on the semantic handling. | source-traced |
| Malformed inputs | A's core catch maps the message `invalid-input`/`inventory-incomplete`/`inventory-unsupported`; because the shared `bytes()` helper throws a plain `Error('inventory-unsupported')` for a malformed `storedBytes`, **A now reports `inventory-unsupported` where the base reported `invalid-input`**. Credit is withheld either way; B preserves the base diagnostic. One-line mapping fix available. | source-traced |
| Purity | A's new core code is pure (no `fs`, no `child_process`, no network); the core's no-I/O assertion still holds. | source-traced |
| Scope / API regressions | Only the write-set is touched: S2a core + producer (+ generated copies), the two S2a suites, the S2a fixture, the S2a contract text, `CHANGELOG.md`. No public derive/checker API, identity/digest schema, S1 runtime, workflow wiring, version or dependency change; `doc-reconciliation-events.js` untouched (it inherits the P1 binding through `validateSnapshot`). A added two `[Unreleased]` entries instead of one — trivial deviation from the packet's "topmost entry" wording, consistent with the repo's existing multi-entry `[Unreleased]` convention. | source-traced + executed (`git status`/`git diff --stat` read-only) |

## Comparison of the two approaches

**A — static relevance surface.** Relevance = the derive contract's own path classes (governed/legacy
globs, derived output/source globs, `CODE_EXTENSION`, `TEST_PATH`) plus "the record opens a frontmatter
block"; anything else is omitted. Fail closed for everything else that cannot be decoded.

**B — derivation-probe relevance.** Relevance = the unchanged derivation changes its obligations when the
record's own bytes are probed under the actual, addition and deletion transitions; otherwise omit.

| | A | B |
|---|---|---|
| Packet clause "do not drop code/test/governed/derived inputs" | **satisfied** (executed: test path fails closed) | **deviates** on the test class (executed: test path silently omitted) |
| Candidate-side semantics of an undecodable record | caught (frontmatter rule) and, for classified paths, by path class | caught (actual-transition probe) |
| Duplication of the derive contract | **duplicates** `CODE_EXTENSION`, `TEST_PATH`, glob semantics (A's own risk #1) | none |
| Extra derivation passes per capture with binaries | 0 | up to 3 |
| Additional represented links closed | config bytes ↔ inventory; plan.configDigest ↔ identity.configDigest | none |
| Residual gap | the mirrored surface is not provably complete; a future derive-contract change can silently narrow it (maintenance risk, no current defect) | the witness is a synthetic lossy-text probe; it is not a proof about the true bytes of an undecodable file (documented in both reports) |
| Shipped coverage of the coordinator's defect class | **unpinned** — the `opensFrontmatter` branch is exercised by no shipped test (A's binary paths are `assets/logo.png`, `docs/prd/binary.md`, `docs/roadmap/index.md`, `src/app.js`, `tests/app.test.js`; none opens a frontmatter) | pinned by `R2h-P2:*` (frontmatter + REQ-citing test) |
| Diagnostic fidelity for malformed records | drifts to `inventory-unsupported` | preserves `invalid-input` |

## Recommendation

**Take A**, optionally plus one small B-derived addition.

Reasons, in order of weight:

1. **A satisfies the packet's explicit drop clause; B does not.** The only executed behavioural difference
   is an undecodable REQ-test record: A fails closed, B omits it. The packet names test inputs explicitly,
   so A's behaviour is the compliant one.
2. **A closes two represented links B leaves open** (config source bytes ↔ captured inventory bytes;
   plan `configDigest` ↔ identity `configDigest`). Both are in the same class the packet asked to be closed
   coherently.
3. **A is simpler and cheaper**: one shared conversion helper, no extra derivation passes, and a
   readability advantage (explicit plan/host checks instead of digest-implied ones).
4. A's weaknesses are maintenance-level (mirrored path rules, an unpinned heuristic branch, a diagnostic
   drift), while B's weakness is a behavioural deviation from the written requirement.

Optional minimal combination, if the owner wants B's guarantee that the *candidate's own bytes* are always
consulted: keep A's static classification **and** add B's actual-transition witness as an additional
fail-closed trigger (the union). That closes A's "surface not provably complete" residual at the cost of
A's duplication plus B's extra derivation passes. It is **not** required for acceptance.

## Non-blocking follow-ups for peer A (owner decides)

1. **Pin the `opensFrontmatter` branch** with the coordinator's two transition shapes (a candidate record
   whose bytes open a `role: prd` frontmatter at a path no glob classifies; a candidate record whose bytes
   are a REQ-citing test). Today that branch carries the defect class and no shipped test reaches it.
2. **Preserve the base diagnostic** for a malformed record: map only the explicitly coded
   `inventory-unsupported` to itself and keep `invalid-input` for everything else (one line in the catch).
3. **Guard the mirrored path rules** (optional): a check that fails when `doc-obligations.js`'s
   `CODE_EXTENSION`/`TEST_PATH`/glob semantics change, so the duplication cannot silently narrow the
   relevance surface; otherwise keep the drift risk recorded as A does.

## Scope and limits of this review

- **Not executed**: A's and B's full S2a suites (the coordinator is running the common probes and the
  swapped suites), `npm test`, `verify:all`, the mechanism runner; the Windows and Node 22 lanes.
- **Not assessed**: live-host provenance, S1 runtime behaviour, workflow wiring, E1 readiness — all outside
  S2a. Every origin in these probes is the explicit test fake.
- **Inconclusive**: whether A's mirrored relevance surface is complete for every future derive-contract
  change; and whether B's witness omission of a test input could ever coincide with an applicability
  change not visible in the derived obligations (no such case was found in the eight probed shapes).
- No PR readiness is declared here; the owner decides.

STATUS: DONE
