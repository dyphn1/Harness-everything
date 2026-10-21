# PR #353 — Implementation report (leg B)

Base: `59421f41a8ce2b00250c96634a4a43ae0ba782bf` (read-only `git show`/`git log` only; no git/gh write
commands were run, no commits, no worktree mutation, no remote messages).

Worktree: `/Users/daniel.chang/Desktop/Skills/Harness-everything/.worktrees/353-r6-b`
Evidence dir: `/tmp/harness-353-r6-b` (logs under `logs/`, scratch probes under `probe/`, both outside the repo)

## Round 2 — coordinator defect (executed omission defect) and its fix

**Defect (executed, coordinator-found).** The coordinator's transition probe
(`/tmp/harness-353-r6-coordinator/semantic-transitions.js`, log `b-transitions.log`) failed all four
source/packaged cases. My first implementation probed relevance with
`base.undecodable[path] → same text + "\n"` only: it read the **baseline** record's lossy text and never the
candidate's. A capture whose baseline record is nonsemantic while the candidate record's bytes carry a
`role: prd` frontmatter or a REQ-citing test therefore looked irrelevant, and the candidate's document
meaning was silently dropped from the derivation. Two further weaknesses: a same-text modification cannot
show new/deleted test identity, and no addition/deletion transition was probed at all.

**Fix (minimal, in the shared helper).** `deriveCapturedFacts` now probes relevance through the unchanged
derivation with each undecodable record's **own** bytes and three transition witnesses:

| Witness | Baseline side | Candidate side | Shows |
| --- | --- | --- | --- |
| actual | the record's baseline lossy text (if present) | the record's candidate lossy text (if present) | the real transition of this capture, carrying the candidate's own semantics |
| addition | the record absent | the record's lossy text | new document / new REQ-citing test identity |
| deletion | the record's lossy text | the record absent | deleted document / deleted test identity |

If any witness changes the derived obligations (applicability **and** scope included), the record is
semantically relevant and the capture fails closed as `inventory-unsupported`; otherwise it is omitted from
the derivation inputs. The stored bytes of every record stay in the whole-project hash, so the inventory
byte identity is intact (`candidateDigest` still covers binary bytes; `baselineDigest` unchanged).

**Honest scope of the claim.** These witnesses are lossy-text probes of the unchanged derivation, not a
proof about the true bytes of an undecodable file. They establish that the unchanged derivation finds no
document meaning for the record under the actual, addition and deletion transitions; they do **not**
establish full decision equivalence for every possible undecodable byte sequence. Where the witnesses
disagree the implementation fails closed, which is the safe branch.

### Round-2 evidence

| Suite | RED (v1 implementation, new tests) | GREEN (fixed) | Log |
| --- | --- | --- | --- |
| S2a core | **191 PASS, 2 FAIL, 0 INFRA** / 193 assertion-legs | **193 PASS, 0 FAIL, 0 INFRA** | `logs/RED2-core.log` → `logs/GREEN-core.log` |
| S2a producer | **74 PASS, 4 FAIL, 0 INFRA** / 78 assertion-legs | **78 PASS, 0 FAIL, 0 INFRA** | `logs/RED2-producer.log` → `logs/GREEN-producer.log` |

RED2 failure reason, identical on the `source` and `packaged` legs and equal to the coordinator's finding:

```
FAIL R2h-P2:prd-frontmatter-binary-semantics-are-never-omitted — the candidate semantics of the binary record at assets/role.dat were omitted
FAIL R2h-P2:req-citing-test-binary-semantics-are-never-omitted — the candidate semantics of the binary record at tests/fixture.dat were omitted
FAIL R2h-P2:candidate-binary-semantics-never-earn-credit-while-omitted — the candidate semantics of the binary record at assets/role.dat were omitted
```

Shipped regression tests (run on both legs by the S2a runner):

- `ci/mechanism-325-3b-s2a-producer.test.js` — `R2h-P2:prd-frontmatter-binary-semantics-are-never-omitted`
  and `R2h-P2:req-citing-test-binary-semantics-are-never-omitted`: a capture is acceptable only if it fails
  closed with `inventory-unsupported`, or if the derived obligations still carry the candidate's semantics
  (`role: prd` in a MUST scope / a non-N/A `requirement-sync`).
- `ci/mechanism-325-3b-s2a-core.test.js` — `R2h-P2:candidate-binary-semantics-never-earn-credit-while-omitted`:
  the same property through the full produce → accept → decide flow, and no credit without accepted evidence.

Coordinator probes re-executed read-only against the fixed implementation:

```
node /tmp/harness-353-r6-coordinator/semantic-transitions.js <worktree>   → 4 passed, 0 failed   (all four now FAIL-CLOSED: state "unavailable")
node /tmp/harness-353-r6-coordinator/probes.js <worktree>                 → 26 passed, 0 failed
```

Logs: `logs/GATE-coordinator-transitions.log`, `logs/GATE-coordinator-probes.log`.

## Changed files (write-set respected)

| File | Change |
| --- | --- |
| `hooks/scripts/lib/doc-reconciliation-core.js` | P1 origin↔identity binding in `validateSnapshot`; P2 binary-safe shared derivation (`readRecords`, `decodeUtf8`, `deriveCapturedFacts`); `inventory-unsupported` mapped out of the validation catch |
| `hooks/scripts/lib/doc-reconciliation-producer.js` | Producer now derives through the shared `U.deriveCapturedFacts`; local `filesOf` and the now-unused derive import removed |
| `plugins/harness-everything/hooks/scripts/lib/doc-reconciliation-core.js` | generated copy (`npm run plugin:sync`), byte-identical to source |
| `plugins/harness-everything/hooks/scripts/lib/doc-reconciliation-producer.js` | generated copy (`npm run plugin:sync`), byte-identical to source |
| `ci/mechanism-325-3b-s2a-core.test.js` | 8 new P1/P2 assertions (7 round 1 + 1 round 2); `withVector` now returns the callback value |
| `ci/mechanism-325-3b-s2a-producer.test.js` | 7 new P2 assertions (5 round 1 + 2 round 2) |
| `ci/fixtures/doc-obligations/reconciliation-s2a/harness.js` | shared `BINARY_ASSET` / `BINARY_ASSET_CHANGED` byte fixtures (raw bytes, invalid UTF-8) |
| `docs/doc-workflow-reconciliation.md` | S2a contract: origin-identity binding paragraph; binary-record derivation paragraph |
| `CHANGELOG.md` | topmost `[Unreleased]` entry only |

Not changed (deliberately): `doc-reconciliation-events.js` needed no change — it already compares the
provider context with `snapshot.originContext` and calls `validateSnapshot`, so it inherits both fixes.
No public derive/checker API, identity/digest schema, S1 runtime, workflow wiring, version or dependency
was touched. No scratch `.js` file was left inside the repo (`git status --porcelain -uall` shows only the
nine modified files above).

## P1 — the whole captured origin identity must agree with the hashed identity

**Finding (source-traced → executed).** `validateSnapshot` bound only the baseline pin
(`context.baseline.commit` / `context.baseline.root`); `acceptDocEvents` compared the provider context with
`snapshot.originContext`, and the event's `identity` was compared with `snapshot.identity`. The
`originContext ↔ identity` link was missing, so the two halves never met. `snapshot.originContext` is not
hashed by anything (`snapshotDigest` covers baseline/coverage/records, `configDigest` covers the config,
`taskScopeDigest` covers the plan), so it was an unbound field.

**Fix.** In `validateSnapshot` (pure, no I/O):

- every origin-correlated identity field — `workspaceId`, `sessionId`, `workflowId`, `workflowRevision`,
  `taskId` — must equal the same field in `snapshot.identity`; a disagreement is `identity-mismatch`;
- the captured `activeHost` must equal the selected config capture's `activeHost`
  (`snapshot.config.capture.activeHost`), which is the selection context already hashed into
  `configDigest`.

Because `validateSnapshot` runs in `acceptDocEvents` **and** in `reconcileDocResults`, the binding holds at
event acceptance, in `verification` mode, in `review` mode, and for a cached `accepted` report replayed
against the tampered snapshot. The plan side was already bound: `taskScopeDigest` covers task id, workflow
id/revision/session, scope, coverage and the PRD root, so a joint plan/digest change is caught by the event
identity check (pinned as a regression, it already passed on the RED base).

Represented tuple links inspected (not just two examples): identity↔originContext (5 fields),
identity↔activeHost, identity↔plan (via `taskScopeDigest`), identity↔baseline pin, identity↔baseline/
candidate digests, identity↔config digest, identity↔PRD root.

## P2 — a binary asset must not make the whole-project capture unsupported

**Finding (source-traced → executed).** `filesOf` decoded every captured record with
`new TextDecoder('utf-8', {fatal: true})`, so one ordinary tracked asset (`assets/logo.png`) made the whole
producer `inventory-unsupported` — fatal decoding was applied to a whole-project inventory.

**Relevance is decided by the unchanged derivation, not by an extension allowlist.** The relevance rule is
the derivation's own path classification (governed/legacy globs, derived paths and sources, code
extensions, test paths), and the unchanged `deriveDocFacts`/`deriveDocObligations` decide it: an
undecodable record is **probed** through the derivation with its own bytes, under the actual, addition and
deletion transitions (round 2), and the derived obligations (applicability *and* scope) must stay
identical. Only then is the record omitted from the derivation inputs; otherwise the record is semantically
relevant and the capture fails closed as `inventory-unsupported`. The stored bytes of every record remain
in the whole-project hash, so `candidateDigest` still changes when a binary asset changes.

Consequences, verified: `assets/logo.png` (irrelevant) → capture stays ready, MUST set unchanged,
`candidateDigest` changes; `docs/prd/logo.png` (governed), `docs/roadmap/index.md` (derived output) and
`src/logo.js` (code) → `inventory-unsupported`; a candidate binary carrying a `role: prd` frontmatter or a
REQ-citing test → `inventory-unsupported` (round 2, coordinator defect).

The bounded readers are untouched: the producer's `MAX_BYTES`, the lifecycle's bounded blob read and the
public lifecycle helpers (`parseFrontmatter`, `scanWorkspaceFiles`, `analyzeDocs`) are unchanged; only the
byte-to-text step in the S2a modules changed. Producer and core re-derivation call the same shared
`deriveCapturedFacts`, so a captured snapshot and its re-derivation always agree (asserted by comparing the
derived facts and obligations of the same repository with and without the asset).

## RED → GREEN evidence (deterministic mechanism only)

Logs: `/tmp/harness-353-r6-b/logs/`. RED was produced by restoring the two production modules (and their
packaged copies) from `HEAD` with read-only `git show`, running the **final** test files, then restoring the
implementation. Every RED failure below is the stated reason, not an artefact.

| Suite | RED (base code, final tests) | GREEN (implementation) | Log |
| --- | --- | --- | --- |
| S2a core | **177 PASS, 14 FAIL, 0 INFRA** / 191 assertion-legs | **193 PASS, 0 FAIL, 0 INFRA** / 193 | `logs/RED-core.log` → `logs/GREEN-core.log` |
| S2a producer | **70 PASS, 4 FAIL, 0 INFRA** / 74 assertion-legs | **78 PASS, 0 FAIL, 0 INFRA** / 78 | `logs/RED-producer.log` → `logs/GREEN-producer.log` |

Round 2 (after the coordinator defect) is reported in its own section above: `logs/RED2-*.log` →
`logs/GREEN-*.log`.

RED failure reasons (identical on the `source` and `packaged` legs):

```
FAIL R2g-P1:joint-origin-and-provider-workspaceId-substitution-rejected — expected one of ["identity-mismatch"] in []
FAIL R2g-P1:joint-origin-and-provider-sessionId-substitution-rejected — expected one of ["identity-mismatch"] in []
FAIL R2g-P1:joint-origin-and-provider-workflowId-substitution-rejected — expected one of ["identity-mismatch"] in []
FAIL R2g-P1:joint-origin-and-provider-workflowRevision-substitution-rejected — expected one of ["identity-mismatch"] in []
FAIL R2g-P1:joint-origin-and-provider-taskId-substitution-rejected — expected one of ["identity-mismatch"] in []
FAIL R2g-P1:joint-origin-and-provider-active-host-substitution-rejected — expected one of ["identity-mismatch"] in []
FAIL R2g-P2:binary-asset-capture-stays-eligible-and-derives-as-without-the-asset — no decision (producer unavailable: inventory-unsupported)
FAIL R2g-P2:unchanged-binary-asset-captures-and-keeps-the-document-must-set — state unavailable with codes ["inventory-unsupported"]
FAIL R2g-P2:changed-binary-asset-changes-the-candidate-digest-and-keeps-the-must-set — state unavailable with codes ["inventory-unsupported"]
```

i.e. on the base code the joint origin/provider substitution produced **no** diagnostic at all and stayed
eligible, and a binary asset made the capture unavailable.

Repeat-identical-input evidence: the two suites were run twice after the fix and the per-assertion
PASS/FAIL lines are identical (`logs/GREEN-core-run2.log`, `logs/GREEN-producer-run2.log`; `diff` clean).

## Tests executed

```
node ci/mechanism-325-3b-s2a-core.test.js        PASS (193/193)         logs/GREEN-core.log
node ci/mechanism-325-3b-s2a-producer.test.js     PASS (78/78)           logs/GREEN-producer.log
node ci/mechanism-325-3b-s1.test.js               PASS                   logs/GATE-mechanism-325-3b-s1.log
node ci/mechanism-325-3b-s1-review.test.js        PASS                   logs/GATE-mechanism-325-3b-s1-review.log
node ci/mechanism-325-3b-preparation.test.js      PASS                   logs/GATE-mechanism-325-3b-preparation.log
node ci/mechanism-2ax-doc-lifecycle.test.js       PASS                   logs/GATE-mechanism-2ax-doc-lifecycle.log
npm run test:consistency                          PASS                   logs/GATE-consistency3.log (and 1, 2)
npm run test:plugin:openai                        PASS                   logs/GATE-plugin-openai.log
npm run test:portability                          PASS                   logs/GATE-portability.log
npm run test:repo-contract                        PASS                   logs/GATE-repo-contract.log
npm run test:docs:capabilities                    PASS                   logs/GATE-docs-capabilities.log
npm run plugin:sync                               generated copies synced
```

Round-2 additions: the coordinator's `semantic-transitions.js` (4/4 PASS) and `probes.js` (26/26 PASS),
both re-executed read-only — `logs/GATE-coordinator-transitions.log`, `logs/GATE-coordinator-probes.log`.
Source and packaged copies of all three S2a modules are byte-identical (SHA-256 checked).

Not run by instruction: `npm test`, `npm run verify:all`, `ci/mechanism-test.js` (the coordinator runs the
full gates once).

## Findings by evidence layer

- **executed** — P1 joint substitution of every origin-correlated identity field and of `activeHost` is
  rejected at event acceptance, in `verification`, in `review`, and against a cached accepted report; the
  unchanged-context control stays eligible.
- **executed** — a tracked binary asset no longer makes the producer unavailable; `candidateDigest` still
  changes when the asset changes; the document MUST set is unchanged; producer and core re-derivation agree.
- **executed** — a binary record at a governed path, a derived output path or a code path fails closed with
  `inventory-unsupported`; the unchanged-binary and changed-binary variants are both covered.
- **executed (round 2)** — a candidate binary record whose bytes carry a `role: prd` frontmatter or a
  REQ-citing test is no longer omitted: the capture fails closed, on both the source and the packaged leg.
  The coordinator's four transition cases now pass; its 26-case probe suite still passes.
- **source-traced** — the plan side of the tuple (`taskId`, workflow id/revision/session, scope, coverage,
  PRD root) is bound by `taskScopeDigest`; a joint plan/digest change is rejected by the event identity
  check. The regression test for it already passed on the RED base (it is a pin, not a new RED).
- **source-traced** — the root half of the workspace binding stays out of scope, exactly as the S2a
  contract already states: root metadata is not in the hashed identity and external worktree
  authentication remains outside this guarantee (`docs/doc-workflow-reconciliation.md`).
- **inconclusive** — the completeness of the relevance witnesses. They are lossy-text probes of the
  unchanged derivation under the actual, addition and deletion transitions. They show that the derivation
  finds no document meaning for the record under those transitions; they do **not** prove decision
  equivalence for every possible undecodable byte sequence, and they are not a proof about the true bytes
  of an undecodable file.
- **inconclusive** — live-host provenance. Every origin in these suites is an explicit fake provider
  (`H.FakeOrigin`). The suites prove the acceptance/decision algorithm only; they prove nothing about
  authentic host provenance, reviewer independence in deployment, live-host loading or E1 readiness.
- **inconclusive** — platform coverage. The suites ran on macOS only. `test:portability` passed (no
  Windows-hostile paths in the scanned test sources), but the Windows lane and the Node 22 runtime floor
  were not executed locally; CI owns them.

## Remaining risks

1. **Binary relevance is decided by lossy-text witnesses of the unchanged derivation** (round 2). A record
   whose bytes the witnesses cannot read as meaningful document structure is omitted, so
   `facts.changedPaths` and `facts.documentAnalysis` do not mention it. Applicability and scope are
   unchanged under every probed transition, but the informational facts no longer list the omitted path.
   Where the witnesses disagree the capture fails closed, which is the safe branch. Documented in
   `docs/doc-workflow-reconciliation.md`.
2. **The witnesses cost up to three extra `deriveDocFacts` calls** when a capture contains undecodable
   records (batched over all such records, short-circuiting on the first difference). No extra call for
   text-only repositories.
3. **`workspaceRoot` is still not hashed into the identity.** The joint provider/context pin-root
   replacement remains detectable only for snapshot-internal consistency, as the contract already states.
   Closing it needs a root-bound identity, which would change the identity schema — out of scope here.
4. **`activeHost` comparison treats "absent" on both sides as equal**, because the producer's own check
   requires the provider's and the input's `activeHost` to be strictly equal, and an undefined input host
   is captured as `null` by the resolver. A snapshot with an absent host on one side and a present host on
   the other is rejected.
5. **Cross-leg coordination.** This leg edits `ci/fixtures/doc-obligations/reconciliation-s2a/harness.js`
   (shared constants). If leg A edited the same fixture, the coordinator's selection must take one harness,
   not merge both.
6. **The coordinator's transition probe asserts "fail closed or semantics retained"**, not which of the two
   happens. This implementation always fails closed on those inputs. If a later revision keeps such a
   capture ready, the shipped regression tests still require the semantics to be present in the obligations.

## Not certified

PR readiness is not certified here. The owner decides. The coordinator still owes the full `npm test` /
`npm run verify:all` run (including the Windows and Node 22 lanes) and the cross-validation against leg A.

STATUS: DONE
