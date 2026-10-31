# PR #353 — Cross-review of peer leg B (reviewer: leg A)

Reviewed: peer worktree `/Users/daniel.chang/Desktop/Skills/Harness-everything/.worktrees/353-r6-b`
(base `59421f41a8ce2b00250c96634a4a43ae0ba782bf`), report `/tmp/harness-353-r6-b/REPORT.md`, and B's
working-tree diff against `59421f4`.
Method: read B's current source, its test and doc diffs; ran **one** independent probe
(`/tmp/harness-353-r6-a/probe/cross-review-probe.js`, scratch, outside both repositories) against **both**
worktrees; no suite was re-run, no implementation was edited, no git/gh write was issued, no full gate
was run. The probe builds its own Git fixture repositories, its own fake origin provider and its own
event builder; it depends on neither leg's fixture harness.

## Verdict

| | Peer B | Leg A |
| --- | --- | --- |
| P1 origin tuple (`workspaceId`, `sessionId`, `workflowId`, `workflowRevision`, `taskId`) | closed | closed |
| P1 `activeHost` ↔ captured selected config | closed | closed |
| P1 captured plan ↔ identity | **open** (F1) | closed |
| P1 captured config bytes ↔ captured inventory | **open** (F2) | closed |
| P2 binary bytes stay in both digests | closed | closed |
| P2 irrelevant binary asset does not break the capture | closed | closed |
| P2 baseline/candidate/new/deleted relevance class | closed | closed |
| P2 relevance decided by the unchanged derivation (no rule duplication) | **yes** | no (F5) |
| P2 a record that opens a frontmatter block cannot vanish | not guaranteed (F4) | closed |

**Peer B is not accepted as-is.** One blocker-class finding (F1) and two recommended additions (F2, F4),
all in the packet's own P1/P2 scope and all reproducible with the probe. With the minimal delta
described below, I accept B. **Leg A has no blocker-class finding** in this review; its only weakness is
a maintenance coupling (F5), not a present trust gap.

## Probe results (one probe, both worktrees)

| Probe case | Expected | A | B |
| --- | --- | --- | --- |
| `p1-control-eligible` | eligible | eligible | eligible |
| `p1-joint-origin-task-substitution` (the packet's named attack) | rejected | rejected | rejected |
| `p1-plan-only-substitution` | rejected | rejected (`identity-mismatch`) | **accepted (eligible)** |
| `p1-config-bytes-substitution` | rejected | rejected (`config-capture-mismatch`) | **accepted (eligible)** |
| `p1-fully-joint-self-consistent-substitution` | rejected | accepted (eligible) | accepted (eligible) |
| `p2-asset-irrelevant` | ready | ready | ready |
| `p2-governed-path-unchanged` | unavailable | unavailable | unavailable |
| `p2-role-frontmatter-asset` | unavailable | unavailable | unavailable |
| `p2-masked-frontmatter-asset` | unavailable | unavailable | **ready** |
| `p2-new-binary-governed-record` | unavailable | unavailable | unavailable |
| `p2-deleted-binary-governed-record` | unavailable | unavailable | unavailable |
| `p2-binary-bytes-covered-by-both-digests` | differ | differ | differ |
| `p2-producer-core-parity` | no errors | no errors | no errors |
| `p2-malformed-record-rejected` | `invalid-input` | `invalid-input` | `invalid-input` |

Probe definitions: *plan-only* = the captured plan names another workflow and `taskScopeDigest` is
recomputed correctly, the identity and the captured origin context keep the original tuple; *config-bytes* =
the captured config source bytes are replaced and every digest that names them is recomputed, and the
cached acceptance is restated; *fully joint* = the captured origin context, the identity, the captured plan,
the digests and the cached acceptance are restated together; *masked frontmatter* = the record's bytes open
a `---` block whose closing delimiter is separated from it by one invalid UTF-8 byte.

## Findings

**F1 — executed — peer B — blocker-class (P1 scope): the captured plan is not bound to the identity.**
`validateSnapshot` checks `originContext` against `identity` and `activeHost` against the config capture,
but nothing compares the captured plan with the identity. `taskScopeDigest` binds the plan *content* to the
identity's digest field; it does not bind the plan's workflow triple / task id to the identity's. A
snapshot whose plan describes another workflow, with the digest correctly recomputed, verifies as
`eligible` (probe `p1-plan-only-substitution`). The packet asks to "inspect all represented tuple links,
not only two examples" and to check the plan "where represented"; the plan represents `workflowId`,
`workflowRevision`, `sessionId` and `taskId`, which the identity also represents. B's shipped doc text
("The plan stays bound through `taskScopeDigest`") states more than the code enforces. Fix: compare
`taskSemantics.workflow.{workflowId,workflowRevision,sessionId}`, `taskSemantics.task.taskId`,
`taskSemantics.prdRoot` and `taskSemantics.configDigest` with the identity inside the existing
`validateSnapshot` (A: `originBound`, ~6 lines, pure, no I/O).

**F2 — executed — peer B — recommended (same class): the captured config bytes are not bound to the
captured inventory.** Replacing the captured config source bytes and recomputing every digest that names
them (`configDigest`, `identity.configDigest`, the plan's `configDigest`, `taskScopeDigest`) plus
restating the cached acceptance verifies as `eligible` (probe `p1-config-bytes-substitution`). The
producer already enforces exactly this rule at capture (its config-source loop compares the captured
source bytes with the candidate records); the core re-checks nothing, so the two halves of the capture
can describe different files. Fix: the producer's rule as a core check → `config-capture-mismatch`
(A: `configBytesBound`, ~8 lines).

**F3 — executed — shared by both legs — contract-bounded, not a defect of either: a fully joint,
self-consistent restatement is accepted.** Restating the captured origin context, the identity, the
captured plan, the digests and the cached acceptance together yields `eligible` under A and B
(probe `p1-fully-joint-self-consistent-substitution`). The snapshot is detached and self-authenticating;
the only external anchor is the origin provider, which `acceptDocEvents` consults on a fresh acceptance
and the pure core never re-reads. This matches the S2a contract's own boundary ("external worktree
authentication remains outside this S2a guarantee"; S2b recollects every tuple and accepted binding before
credit). Consequence for the selection: F1 and F2 are *partial* defenses — they reject partial
substitutions, not a full restatement. Both legs share that boundary, so it is not a differentiator.

**F4 — executed — divergence — peer B: a record that opens a frontmatter block can still be omitted.**
The lifecycle decides "is this a frontmatter document" by the first line being exactly `---`
(`harness-everything/scripts/doc-lifecycle.js`, `parseFrontmatter`). B's relevance decision is the
unchanged derivation applied to the *lossy* reading of the record; when the invalid byte sits inside the
frontmatter block, the lossy reading is unterminated, carries no role, and the record is omitted
(probe `p2-masked-frontmatter-asset`: B → ready, A → unavailable). A governed document with one stray
invalid byte in its frontmatter can therefore be dropped from the derivation, so `doc-lint` / `link-check`
would not fire where a tolerant reader would see a governed PRD. Exotic, but it is the one probed case
where the two legs differ on a trust-relevant outcome. Fix on B: fail closed when a record's first line is
exactly `---` — the lifecycle's own test, independent of the witnesses (~3 lines).

**F5 — source-traced — leg A (for balance): A mirrors the derive contract's path rules inside the
reconciliation module.** Because `doc-obligations.js` is outside the write-set, A duplicates
`CODE_EXTENSION`, `TEST_PATH` and the contract's glob semantics to decide relevance. The duplication is
currently exact (the probe shows A and B agreeing on 8 of 9 P2 cases), but a later change to the derive
contract's code/test/glob rules would silently make A *omit* a record the contract treats as relevant —
the dangerous direction — with no test failure. B has no such surface: its relevance decision is the
derivation's own. Removing A's coupling needs either a public export of the contract's classification
(out of this packet's scope) or B's witness approach.

**F6 — executed — shared residual: a binary record at a governed path makes the capture unavailable even
when unchanged.** Both legs fail closed for `docs/prd/diagram.png` (probe `p2-governed-path-unchanged`;
B via the addition witness, A via the path rule). This matches the S2a contract ("Unsupported
encodings ... that prevent faithful identity yield unavailable") and is conservative in both, but it means
a repository holding a binary diagram under `docs/prd/` can never be captured. Availability cost, not a
trust gap; identical in both legs.

**F7 — executed — shared: the new/deleted record identity class is closed in both.** A binary record that
exists on only one side of the capture fails closed in both legs (probes `p2-new-binary-governed-record`,
`p2-deleted-binary-governed-record`), and both agree with the coordinator's transition probe. B's
round-2 witnesses (actual / addition / deletion) close the candidate-only omission the coordinator found
in B's first implementation; A's path rules cover the same paths. Neither leg depends on a newline-only
modification to detect the transition.

**F8 — executed — shared: byte integrity, parity and malformed inputs.** Both legs keep the binary bytes
in `candidateDigest` *and* `baselineDigest` (probe `p2-binary-bytes-covered-by-both-digests`), the core's
re-derivation accepts the producer's snapshot with a binary asset in both (probe
`p2-producer-core-parity`), and a record whose stored bytes do not match its digest is refused with
`invalid-input` in both (probe `p2-malformed-record-rejected`).

**F9 — source-traced — scope, API and parity between the legs.** Both legs touch the same nine files
inside the packet's write-set, change no public derive/checker API, no identity/digest schema, no S1
runtime and no workflow wiring, add no new `.js` file to the repository, and leave
`doc-reconciliation-events.js` untouched — correct, because that module already compares the provider
context with the captured origin context and calls `validateSnapshot`, so it inherits the P1 binding. Both
cores stay pure (no file, process or network activity); B's extra derivation calls are pure computations.
B's packaged copies are byte-identical to its canonical files (sha256 verified); A's parity is asserted
by its own suite. B's doc text and CHANGELOG entries accurately describe B's behaviour except for the
plan-binding claim noted in F1.

**F10 — inconclusive.** The completeness of B's relevance witnesses is not provable for every byte
sequence (B's own report says so; F4 is the demonstrated instance). Live-host provenance is out of reach
in both legs (the origin provider is an explicit fake). Platform coverage is macOS-only in both; the
Windows lane and the Node 22 floor remain CI's.

## Comparison of the two approaches

**Peer B — strengths.** The relevance decision is the *unchanged derivation's own*, so there is no
extension allowlist and no duplicated path rules to drift (the packet's "inspect existing derive/lifecycle
semantics to justify relevance" in its strongest form). The three witnesses (actual transition, addition,
deletion) directly answer the coordinator's class requirement, and B's round-2 fix is a real improvement
over a naive path-rule approach. Its P1 origin binding is exactly equivalent to A's for the five tuple
fields and the host. Its test set is larger and pins the semantic-binary regressions.

**Peer B — defects.** F1 (blocker-class, P1 scope), F2 (same class), F4 (one probed omission case). Its
report's plan-binding claim is stronger than its code.

**Leg A — strengths.** Strictly more of the P1 class is closed (F1, F2), the derivation-relevant omission
cannot happen for a frontmatter-opening record (F4), the implementation is cheaper (no extra derivation
calls) and the reason codes are explicit.

**Leg A — defects.** F5: the relevance rule is a mirror of the derive contract rather than the contract
itself, so it can drift silently; and it fails closed on any record whose first line is `---`, which is
stricter than the derivation requires (an availability cost, the mirror image of B's F4).

**Shared.** F3 (no external anchor in the cached path), F6 (a binary under a governed path is
unavailable), F10 (residual limits). Neither leg's extra checks change F3.

## Recommendation

**Minimal combination, base B**: keep B's derivation-grounded relevance (no duplicated rules, no drift
surface, and it already answers the baseline/candidate/new/deleted class), and add A's three small
additions to B's core — the plan↔identity comparison (F1), the config-bytes↔inventory check (F2) and the
frontmatter-opener guard (F4). Cost: ≈17 lines in `hooks/scripts/lib/doc-reconciliation-core.js` plus the
three corresponding test cases; no public API, digest schema, event module or producer change; the
packaged copy is regenerated with `npm run plugin:sync`.

**If the owner selects one leg without merging**: take **A**. The P1 gaps in B are current and
demonstrated, and this PR exists to close that class; A's weakness is a maintenance coupling that can be
removed later (exporting the derive contract's classification, or porting B's witness approach) without
changing any trust guarantee. B's grounding is the better long-term shape for the P2 rule, so it is worth
recording as the follow-up. B should not be selected unmodified: F1 alone is inside the packet's stated
P1 scope, and B's documentation currently claims that scope is closed.

**Acceptance.** Leg A: accepted (no blocker-class finding; F5 is a recorded residual). Peer B: not
accepted as-is (F1); accepted once F1, F2 and F4 are applied and pinned by the three probe cases above.

This review does not certify PR readiness and does not judge the live-host provenance of either leg; the
owner decides.

STATUS: DONE
