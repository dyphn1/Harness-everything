# Document workflow reconciliation — Phase 3b S1 runtime

**Status: S1 runtime ships default OFF; opt in with `HARNESS_DOC_RECONCILIATION_PILOT=1`.
S1 grants no positive document verification credit. S2/S3 are pending; E1 has not started.**
This document refines the [document lifecycle contract](document-lifecycle.md#phase-3b--narrow-integration-contract-s1-shipped-default-off-positive-reconciliation-not-shipped).
The [accepted E0](https://github.com/dyphn1/Harness-everything/issues/341#issuecomment-6308604128)
permits this limited, reversible consumer under the
[owner's E0/E1 decision](https://github.com/dyphn1/Harness-everything/issues/325#issuecomment-6283237637).
Current evidence establishes deterministic mechanism/package behavior, not live-host loading or E1 GO.

## Entry gates and ownership

| Gate | Permitted scope |
| --- | --- |
| Preparation, before E0 | This design, provider/trust data contracts, RED fixtures and legacy compatibility controls |
| Accepted #341 E0 | Limited, opt-in, reversible consumer on the existing non-Fable typed workflow path, including the minimum trusted producer |
| #341 E1 GO | Expansion beyond that limited consumer, after sufficient genuine development/review exposure; initial target 2–3 cycles is not a time-only gate |
| #325 H1–H4 and paired-task architectural evidence | Inputs to separately owner-approved #320 promotion; neither E0 nor E1 alone approves a registry/CDG |

Shared read/binding/decision defects return to #341 with fixture-first correction and affected
re-observation. Documentation policy and host/VCS provenance belong to #325. The existing
checker API and result schema remain unchanged. This consumer adds no router, provider requirement,
automatic step insertion, tool/Stop lock, generator execution during discovery, or auto-commit.

## Existing seams and planned credit order

These source anchors describe the preparation baseline, `dba470813cb383945d405686cc6a65bd969b57ec`.
They are source-traced behavior, not live-host evidence.

| Boundary | Current implementation | Post-E0 integration requirement |
| --- | --- | --- |
| Authored step | `hooks/scripts/lib/workflow-obligations.js:updateStep()` (lines 617–645) validates active step/bindings and text, then persists pass | An authored `doc-change` step MAY advance under this existing contract; that grants no verified document-MUST credit |
| Aggregate derivation | `syncTypedAggregateObligations()` (586–614) derives execute/verify from step statuses | Authored execute may reflect completed authored steps; verification PASS requires current document reconciliation |
| Verification write | `hooks/scripts/workflow-disposition.js:279–296` delegates to `updateStep()` | After existing authorization/binding checks, reconcile before writing verification-step or aggregate verify PASS |
| Direct aggregate write | `updateObligation()` (520–537) accepts nonempty evidence text and persists disposition | Guard direct `obligation execute\|verify --disposition pass` on doc-governed typed scope; text cannot bypass derived/reconciled evidence |
| Unresolved calculation | `unresolvedObligations()` (648–682) checks generic obligations and active bindings | Include missing/unknown/unavailable/failed document evidence and current identity freshness |
| Final completion | `hooks/scripts/workflow-stop-gate.js:36–64` calls unresolved calculation before writing `state = 'satisfied'` | Recollect identities and reconcile immediately before completion credit, including already-persisted PASS |

An ordered `doc-change → review → verification` remains reachable. Authored work does not need
to invent evidence that a later reviewer or authorized verification will produce. At verification,
missing evidence leaves verification unresolved; later valid evidence permits a retry. A direct
aggregate PASS attempt with unsatisfied document MUSTs MUST be rejected or ignored, including
`execute` as well as `verify`; this does not prohibit internally derived authored execute status.

Scope comes from trusted task/config/diff facts. Existing typed plans that acquire doc-governed
scope MUST be checked against that current scope; their old aggregate PASS is not completion
proof. Omitting a document result or authored step cannot erase a diff-derived expected MUST.
Non-document typed plans retain existing bindings, authorization and disposition behavior.

Supported reconciliation requires `stepBindingsEnabled === true` and a non-Fable strategy.
Fable stage paths (`fable-staged`, `fable-parallel`, `fable-multi-agent-workspace`) and untyped
workflows are explicitly unavailable for pilot credit. Loaded stage bindings are not document
verification. Existing unsupported-path lifecycle behavior remains; unavailable pilot status
does not add a host lock. Both Stop reminder surfaces continue to return success to the host.

## Expected obligations and evidence

The future adapter obtains trusted inputs, calls existing `deriveDocFacts()` and
`deriveDocObligations()`, then `checkDocObligations()`, and reconciles against the **expected**
obligation set. It MUST NOT treat a returned subset, empty results, or loaded skill as completion.
Every expected applicable MUST needs a matching scope/identity-bound `observed` + `pass` result
supported by independently accepted producer records. Missing, duplicate/conflicting, stale or
untrusted results leave the MUST unsatisfied. Unknown applicability remains unresolved; N/A
requires its derivation reason. SHOULD reminders do not become new gates.

The checker's observation values remain `observed`, `not-observed`, `unavailable`, `unresolved`;
its outcome values remain `pass`, `fail`, `none`. Adapter reason states such as `unknown` are
separate from those enums. A structured pilot report is separate from the checker result.
No timestamps, free text or result field can establish independent provenance on its own.

## Minimum trusted producer

The [trust data contract](../ci/fixtures/doc-obligations/reconciliation-prep/trust-contract.json)
defines the exact identity tuple and fixture/report fields. Its positive examples are simulated
test data, not runtime attestations. Production MUST derive or verify origins from host/VCS state;
a caller cannot gain trust by copying these JSON fields or supplying different actor names.

| Input | Required binding | Unknown/unavailable condition |
| --- | --- | --- |
| Baseline | Recorded baseline tree, whole identity and per-path SHA256 from the same repository-stored bytes | Missing history, unmatched snapshot origin, contradictory tree/path values |
| Candidate | Actual candidate under review, complete inventory including new/untracked/deleted/rename paths and stored-byte semantics | Partial inventory, unsupported export, or only a PRD-set digest offered as whole candidate identity |
| Config | Resolver-selected validated value, source/active-host selection and exact bytes parsed, bound to configDigest | Invalid/ambiguous selection, presence-only digest, substituted or changed bytes |
| Task | Workspace/session/workflow identity and revision, task ID, effective scope digest and PRD root | Replayed task, narrowed/substituted scope or unsupported custom PRD root |
| Execution/verification | Exact command, integer exit code, event/report reference, producer/principal identity, scope and complete identity tuple | Text-only claim, uncorrelated event, missing verifier, contradiction or replay |
| Review | Host-validated independent human/cold-verifier principal, current reviewed scope/artifacts, approve verdict, summary and reference | Missing/mismatched reviewer, self-review by author/executor or stale approval |

Preserve the checker's current `docs/prd/` envelope boundary; an unsupported custom root is
unavailable, not silently generalized. The PRD-set digest and whole-candidate identity are distinct.
Existing `state-persist.js:25–47` and `lib/observations.js:258,436` are potential event seams,
not evidence that today's timestamps/counters already carry the required provenance tuple.
Unavailable host capabilities remain visible and cannot earn PASS. A host export must establish
repository-stored bytes across line endings; raw checkout-byte equality alone does not prove it.

At verification and completion, recollect the tuple and validate relevant execution/review
bindings. Later candidate/config/task/plan changes invalidate old credit despite persisted PASS.
Collection never implicitly runs a verifier, generator or network fetch; new executions require
the existing authorized verification path. Snapshot consistency is not VCS or reviewer attestation.

## Advisory provider contract

The [provider data contract](../ci/fixtures/doc-obligations/reconciliation-prep/provider-contract.json)
specifies the planned interface:

```text
suggestDocProviders({ activeStep, neededCapabilities, availableProviderMetadata, hostCapabilities })
  → { suggestions: [{ capability, providerId, availability, reason }], unavailable: [...] }
```

Only metadata relevant to the active step may be exposed. Candidate metadata supplies declared
capabilities, host requirements and existing binding/tool locators; it does not execute commands
or load SKILL.md content. Candidates are optional. Swapping or omitting a provider cannot alter
expected obligations, authorize a tool, or convert missing evidence to PASS. Existing binding
resolution handles a chosen provider; independent valid evidence can satisfy a MUST without it.
An unsupported host reports unavailable capability/reason. S3 provider integration and its H1/H2 runtime proof remain pending.

## One switch and rollback

S1 reads `HARNESS_DOC_RECONCILIATION_PILOT=1`; missing, `0`, or any other value is OFF.
OFF returns before pilot collection or state/report writes. Test children explicitly set or remove
the variable; ON invokes the S1 runtime's scope assessment and no-credit gate.

OFF preserves legacy disposition and grants zero pilot verification credit. Legacy
`pass` or `satisfied` is not relabeled as document verification. Rollback removes the opt-in,
records that pilot credit is disabled, and preserves session/evidence history. ON→OFF→ON MUST
recollect/reconcile rather than trust any persisted pilot or legacy PASS. Withholding pilot
credit never rejects Stop or changes host authorization. Accepted E0 permits the limited S1 opt-in;
the switch does not authorize expansion or replace E1 GO.

## Preparation harness handoff

[provider-contract.json](../ci/fixtures/doc-obligations/reconciliation-prep/provider-contract.json)
and [trust-contract.json](../ci/fixtures/doc-obligations/reconciliation-prep/trust-contract.json)
are versioned plain-data specifications consumed by the preparation harness, not a production
schema registry. Required shape and enums are validated before replay. Negative recipes remain
inside their declared fixture payloads; assertions use stable IDs and explicit paths into captured
replay reports.

The executable source of the current case inventory is
[cases.json](../ci/fixtures/doc-obligations/reconciliation-prep/cases.json). It contains 16
replay cases:

| Family | Executable case IDs | Coverage |
| --- | --- | --- |
| P01 | `P01` | Binding and free text without document evidence |
| P02 | `P02a`, `P02b`, `P02c`, `P02d`, `P02e`, `P02f`, `P02g` | Missing result, failed execution, unknown observation, unavailable verifier control, self-review, forged identity, partial MUST coverage |
| P03 | `P03` | Ordered work with evidence arriving before a later verification retry |
| P04 | `P04` | Direct aggregate execute/verify PASS bypass |
| P05 | `P05` | Candidate/config freshness, including ON→OFF→ON |
| P06 | `P06` | Non-document typed-plan compatibility control |
| P07 | `P07-fable-staged`, `P07-fable-parallel`, `P07-fable-multi-agent-workspace`, `P07u` | Three Fable strategies and the untyped compatibility control |

P08 is the suite-level source/package parity check across every replay and the shared runtime bytes;
it is not a separate `cases.json` record. The 16 prep cases currently produce 13 `CONTROL_PASS`
cases and three `EXPECTED_RED` cases (`P02e`, `P03`, and `P05`); all replay legs must agree. These
statuses qualify the preparation harness only and do not grant document credit.

The [pending-red.json registry](../ci/fixtures/doc-obligations/reconciliation-prep/pending-red.json)
records 10 exact source/packaged S2 gaps (five assertion IDs × two distributions), after 52 S1 entries were retired. Its root records `schemaVersion`, `phase`, `baselineSha`,
`runtimeFingerprint`, and `entries`. The runner validates schema version, a 40-hex capture
`baselineSha`, a 64-hex `runtimeFingerprint`, and the entry array. Each entry has exactly
`caseId`, `assertionId`, `distribution`, `baselineSha`, `actual`, `desired`, `blocker`, and
`reasonCode`; `assertionId` names an ON assertion as
`<caseId>.on.<expectation-id>`, `distribution` is `source` or `packaged`, and each entry's
`baselineSha` must equal the registry capture. Missing JSON values use the explicit
`{ "kind": "absent" }` marker.

`baselineSha` records the capture commit for provenance; it is not compared with the current
checkout and does not qualify a gap by itself. Qualification uses `runtimeFingerprint`: the
runner hashes the ordered paths and exact bytes in its `FINGERPRINT_FILES` list, framing each
path and file content with NUL bytes. The current list is
`hooks/scripts/lib/workflow-obligations.js`, `hooks/scripts/workflow-disposition.js`, and
`hooks/scripts/workflow-stop-gate.js`; `doc-evidence.js` is excluded because the P01–P08 replays
do not load it. A changed fingerprint fails qualification. To refresh deliberately, the runner
prints an explicit command such as
`node ci/prep/doc-reconciliation-red.js --recapture-candidate ci/fixtures/doc-obligations/reconciliation-prep/pending-red.candidate.json --baseline-sha <40-hex-commit>`.
It writes a separate candidate; review its actual/desired values and reason codes before replacing
the committed registry, then remove the candidate. Nothing is auto-accepted.

The [preparation runner](../ci/prep/doc-reconciliation-red.js) has two replay modes:
`--strict` exits 1 when a desired-contract gap remains; `--expect-red` exits 0 only when every
current mismatch matches an exact case/assertion/distribution/actual/desired registry entry and
all controls and parity checks pass. A stale fingerprint, unexpected PASS, unqualified mismatch,
wrong assertion, crash, missing fixture, import error, or other infrastructure failure fails
qualification. Infrastructure/registry errors exit 2. Expected RED is never a mutation kill or
document verification credit.

Each action may declare `expectExit` per mode (`off` and `on`; an exit code or array of exit codes,
default `0`) for an intentional rejection. Before registry matching or parity, a replay action with a
spawn error, a signal, no exit status, an exit outside its policy, or missing required output (the
routing checkpoint on `route`, a JSON envelope with a string `state` on controller operations) makes
the case `INFRASTRUCTURE`. That exits 2 and never qualifies as a gap, even when the other legs or
later assertions still match.

Every replay child has a 10 s deadline, a 4 MiB output bound and a SIGKILL on expiry. A child that
times out (`ETIMEDOUT`), exceeds the output bound (`ENOBUFS`) or is force-terminated is an
`INFRASTRUCTURE` fault. A test copy of the corpus may only shorten the deadline and substitute a
fixture script; the committed corpus carries neither.

The runner fails fast at three levels, so one shared fault costs one deadline, not one per replay. A
replay stops at its first infrastructure fault and runs no later action. The case's remaining
replays (both legs, both modes) are not run. The first `INFRASTRUCTURE` case ends the run. Each case
not reached is reported `NOT_RUN` with its reason, so the report never looks complete. An
`INFRASTRUCTURE` case names its `offending` leg, mode, action and fault, and `replaysRun` counts the
replays actually started. `--recapture-candidate` refuses at the first infrastructure case.

The discovered [preparation suite](../ci/mechanism-325-3b-preparation.test.js) validates the
inventory, green OFF controls, exact pending-gap qualification and parity. Its report root contains
`schemaVersion`, `mode`, `baselineSha`, `runtimeFingerprintMatches`, `pilotCredit`, and `cases`.
Each case reports `caseId`, `status`, `qualifiedGaps`, `parity`, and `assertions`; each assertion
identifies its `leg` (`source` or `packaged`), `mode` (`off` or `on`), full assertion `id`,
classification `status`, and `actual`, with `desired`/`registered` values when applicable. Case
statuses are `EXPECTED_RED`, `CONTROL_PASS`, `INFRASTRUCTURE`, `NOT_RUN`, or `FAIL`; assertion statuses distinguish
passing controls, unexpected passes, qualified gaps, unqualified gaps, and registry mismatches.
`pilotCredit` is always false. The replay records origin in `pilotReportOrigin`
(`runtime` only for an actual runtime report, otherwise `harness` for a synthesized marker).
Preparation assertion rows do not carry `reportOrigin`; the S1 runtime report carries its own origin. A harness-synthesized unavailable
marker is never presented as a production report.
## S1 — switch, trusted scope and fail-closed no-credit gate

**S1 runtime ships default OFF (`HARNESS_DOC_RECONCILIATION_PILOT=1` opts in). It grants no positive document verification credit; S2/S3 are pending and E1 has not started.**
The [accepted E0](https://github.com/dyphn1/Harness-everything/issues/341#issuecomment-6308604128)
permits this limited implementation; the [posted execution plan](https://github.com/dyphn1/Harness-everything/issues/325)
orders Docs → RED → GREEN → independent review → green CI for each slice. S1 is a temporary
negative-credit slice. S2 supplies trusted producer records, independent review provenance,
positive reconciliation and freshness; only then can E1 observation begin. S3 adds optional
provider suggestions. None of these slices authorizes wider #320 integration.

### Switch and scope decision

Only the exact string `1` enables `HARNESS_DOC_RECONCILIATION_PILOT`. Unset, `0`, `true`,
whitespace and every other value are OFF. OFF MUST return before any pilot collection or
report mutation and preserve ordinary output, status and evidence history. Legacy PASS earns
zero pilot credit. Each ON assessment recollects current scope, including ON→OFF→ON; persisted
pilot reports or legacy PASS cannot substitute for collection. No discovery runs a generator,
verifier or network fetch.

On supported non-Fable typed workflows (`stepBindingsEnabled === true`), doc-governed means
current trusted task/config/baseline/candidate facts establish an applicable document MUST,
or cannot exclude one. Governed/legacy paths and document roles are evaluated at both old and
new endpoints, so deletion or rename cannot erase scope. D6.5 facts also include declared derived
sources, normative content and REQ-citing tests. Use the union of derived obligations; a path
suffix or an authored step name alone is not a scope assessment. A declared `doc-change` MAY
request assessment but is neither sufficient nor required for governed applicability. Omitted,
unknown, incomplete or unavailable scope MUST be treated as governed for withholding credit;
it cannot establish an empty expected set or opt out. Only a trusted non-document assessment
retains legacy behavior (P06). Unknown applicability remains unresolved, N/A needs its derivation
reason, and SHOULD is not a gate.

- A code-only diff (changed code with no changed REQ-citing test) yields `requirement-sync` applicability `unknown` (a MUST), so it is withheld under ON. This is the unknown-applicability cost the Docuvia pilot measures in E1; see [#350](https://github.com/dyphn1/Harness-everything/issues/350) for the false-rejection measurement.

The following anchors are **source-traced at S1 base `5f9726c`**, not runtime or live-host proof:

| Input / boundary | Existing seam and limit | S1 requirement |
| --- | --- | --- |
| Config selection | `harness-everything/scripts/project-docs-resolver.js:352` (`resolveDocsConfig`) selects/validates project or host config; active-host, absent and ambiguous branches at `:395–447`. `resolveProjectDocs` at `:607` resolves project paths, not a complete evidence identity | Reuse resolver authority and diagnostics; invalid/ambiguous config, or absent config with governed-scope uncertainty, cannot establish trusted non-doc scope. Parsed config and the bytes selected must agree |
| Baseline / candidate collection | `harness-everything/scripts/doc-lifecycle.js:1534` (`readGitBaseInventory`) reads Git base blobs/config scope; candidate stored-byte walk at `:1398–1425`; lifecycle baseline consumption at `:1971`. These are lifecycle internals, not an exported workflow scope collector (`:2399`) | Reuse existing stored-byte semantics, but establish current task scope and complete baseline/candidate inventories, including untracked, deletion and rename endpoints; no caller-supplied fixture map is runtime authority |
| Facts / obligations | `harness-everything/scripts/doc-obligations.js:1375` (`deriveDocFacts`) accepts snapshots/config, not host/VCS collection; `:1065` classifies governed paths; `:1390–1420` evaluates both endpoints; `:1508–1543` (`deriveDocObligations`) handles applicable/unknown capabilities | Reuse these pure APIs unchanged after trusted collection. Input shape validity is not provenance or inventory completeness |
| Verification-step PASS | `hooks/scripts/workflow-disposition.js:279–296` delegates to `updateStep`; `hooks/scripts/lib/workflow-obligations.js:617–645` validates active step/bindings then writes status | Collect current config and diff scope after ordinary validation, before writing verification PASS |
| Direct aggregate PASS | `hooks/scripts/workflow-disposition.js:240–258` delegates to `updateObligation`; `hooks/scripts/lib/workflow-obligations.js:513–539` accepts evidence text and writes the aggregate | Assess scope before direct `execute` or `verify` PASS, even after every authored step has passed |
| Completion | `hooks/scripts/lib/workflow-obligations.js:648–682` reports only current active-step evidence; `hooks/scripts/workflow-stop-gate.js:36–64` checks unresolved items then may persist satisfied | Recollect config and diff scope before every completion decision, including already-satisfied and all-PASS plans |

### S1 pilot-local scope collector

The minimal collector ships in S1 at the seams above, enabled only by the opt-in switch.
Its deterministic mechanism/package coverage does not establish live-host loading or positive credit.

| Input / decision | S1 contract |
| --- | --- |
| Baseline capture | With the switch ON at workflow `plan`, record the repository top-level and the `git rev-parse HEAD` commit in workflow state; ON `start` captures them if the plan lacked a baseline. OFF returns early and records nothing |
| Baseline unavailable | Not a Git repository, a Git failure or a missing baseline record means baseline `unavailable`; scope cannot be excluded and is treated as governed, withholding credit. An OFF-planned workflow first assessed ON at a credit boundary therefore withholds, including OFF-seeded legacy PASS→ON |
| Candidate | Collect the current working tree, including non-ignored untracked files, deletions and renames against the recorded baseline commit. Reuse the existing `doc-lifecycle.js` readers / `readGitBaseInventory` and stored-byte semantics; do not re-implement byte normalization. Incomplete inventory means unknown scope, treated as governed |
| Config | Use existing `resolveDocsConfig` at the candidate. Invalid or ambiguous selection, or absent config with governed-scope uncertainty, cannot establish trusted non-document scope. S1 does not yet bind `configDigest` or the task identity tuple; freshness/provenance binding belongs to S2 |
| Decision | Feed collected snapshots/config into unchanged `deriveDocFacts` → `deriveDocObligations`. Doc-governed means any applicable or unknown document MUST. Trusted non-document scope requires complete collection and no applicable or unknown document MUST |

Do not use HEAD at assessment as the baseline: a commit during the workflow could erase the
governed diff and bypass withholding by appearing non-document.

After baseline capture at plan/start, scope collection runs only at verification PASS writes,
direct aggregate PASS writes and completion. It never runs generators, verifiers or network
operations. Each boundary recollects candidate/config against the recorded baseline; ON→OFF→ON
cannot replace that baseline with the latest HEAD or trust a persisted PASS.

**Harness materialization:** prep replays create a temporary workspace, materialize non-empty
`input.baseFiles` as a committed Git baseline before `plan`, then materialize
`input.candidateFiles` as the working tree. This lets P06 establish trusted non-document scope
and governed cases exercise actual diffs. Fixtures without `baseFiles` remain non-Git, so their
baseline is unavailable and credit is withheld. Fixture maps alone are not runtime authority.

- **Accepted S1 residual (gitignored paths):** ignored, untracked candidate content is outside the non-ignored inventory. S1 grants no positive credit either way; the S2 producer must close this gap or explicitly re-accept it.

### Refusal and completion contract

| Attempt with ON + supported governed/unknown scope | Required S1 result |
| --- | --- |
| Authored `doc-change` or review PASS | Remains reachable under existing binding/authorization rules; later missing verification does not reject earlier authored work |
| Verification-step PASS | Exit `2`; verification status remains pending; no positive document credit |
| Direct aggregate `obligation --obligation-id execute\|verify --disposition pass` | Exit `2`; requested aggregate stays pending; direct text cannot bypass the gate |
| Stop / completion, including persisted or legacy PASS | Withhold current completion credit; report `step:<verify>:pending` for the verification step even if no step is active; aggregate verify is effectively pending and workflow cannot remain credited as satisfied |

Withholding persisted credit MUST NOT reset authored `doc-change`, review, bindings or evidence
history merely to manufacture an active step. Compute current unresolved verification independently
of saved PASS; do not trust old aggregate status. Test OFF-completed→ON and an all-PASS typed plan
that acquires governed scope. Both `hooks/scripts/workflow-stop-gate.js:12–65` and
`hooks/scripts/stop-gate.js:14–47` MUST still exit `0`, including collector errors. Reminders never
reject Stop, authorize a tool or introduce a tool lock. Only disposition PASS attempts return `2`.
Existing binding/authorization diagnostics precede pilot refusal (P02d).

### Runtime pilot report and unsupported paths

The S1 runtime report uses the shape specified in
[trust-contract.json](../ci/fixtures/doc-obligations/reconciliation-prep/trust-contract.json):
`schemaVersion`, `pilotStatus`, `pilotCredit`, `identity`, `expectedMustIds`, `results`,
`unsatisfied`, `diagnostics`. Each unsatisfied item contains `obligationId`, `state`, `reasonCode`.
S1 always reports `pilotCredit: false`; it cannot emit `verified`. Missing producer identity is
`null`; unknown expected scope stays diagnostic/unresolved, never an inferred empty-set PASS.
`results` retain checker observation/outcome enums unchanged. Supported withheld scope reports
`unavailable` when collection/producer support is absent, otherwise `unresolved`; known MUSTs
remain listed without pretending that producer evidence exists. S1 reason codes are
`unknown-applicability` for an unknown MUST, `producer-unavailable` for an applicable MUST
without the S2 producer, `baseline-unavailable`, `config-unavailable`, `scope-unavailable`
for missing baseline/config or incomplete inventory, and `collector-unavailable` for other
collector failures. Unsupported paths diagnose `unsupported-workflow`; a complete assessment
with no applicable/unknown MUST diagnoses `trusted-non-document-scope`.

An actual runtime report MUST carry `reportOrigin: runtime`; replay extraction sets
`pilotReportOrigin: runtime` only for that captured report. The helper's
`ci/lib/doc-reconciliation-prep-fixtures.js:runtimePilotOf()` reads the emitted report;
missing reports retain `pilot: null` and origin `harness`, never a synthesized runtime marker.
OFF does not produce or mutate a pilot report.

With ON, loaded `fable-staged`, `fable-parallel`, `fable-multi-agent-workspace` and persisted
untyped workflows report `unavailable`, with no credit and a reason. Fable stage bindings,
including a correlated loaded stage binding, cannot become document verification; preserve
existing stage lifecycle rather than entering generic typed-step reconciliation. A **new invalid
untyped plan** is different: P07u still rejects plan creation with exit `2` and `pilot === null`.
The separate persisted-untyped fixture covers loaded records. Unsupported paths add no Stop lock.

### Registry staging and independent RED handoff

S1 has **52 entries retired / 10 kept**, each assertion ID counted separately for
`source` and `packaged`. Strict runtime assertions cover the retired entries; the reviewed prep
registry retains these five S2 assertion IDs × two distributions:

| S1 retire: 26 IDs × 2 | Assertion suffixes under `<case>.on.` |
| --- | --- |
| P01 | `verify-exit-refused`, `verify-obligation-pending`, `stop-unsatisfied`, `stop-reports-verification` |
| P04 | `direct-execute-refused`, `direct-verify-refused`, `verify-obligation-pending` |
| Each of P02a, P02b, P02c, P02f, P02g | `verify-pass-exit`, `stop-state`, `stop-reports` |
| P03 | `verify-pass-exit` |
| Each of the three P07 Fable cases | `pilot-status-unavailable` |
| **S2 keep: 5 IDs × 2** | **Assertion suffixes under `<case>.on.`** |
| P02e | `review-pass-exit`, `stop-reports` |
| P03 | `verify-retry-exit` |
| P05 | `stop-on-2-withheld`, `stop-on-3-withheld` |

- Move retired gaps into strict runtime assertions. Declare intentional ON exit `2` in each
  action's `expectExit`; do not weaken crash, output, deadline or other infrastructure policies
  (`ci/lib/doc-reconciliation-prep-fixtures.js:298–352`). Preserve explicit Stop exit `0` checks.
- P02e independent review provenance belongs to S2. Do not reject review by matching self-review
  prose or because later verifier evidence is absent. P03 first review remains reachable; its
  first verification is refused, and retry remains RED in S1. S2 changes retry ON `expectExit`
  from `2` to `0` when real evidence can earn credit.
- P05's initial ON positive verification and `stop-on-1` cannot pass in S1. Preserve a distinct S2
  positive-credit case and its approved desired outcomes; add a separate OFF-seeded legacy PASS→ON
  withholding case for S1. Merely changing exit policy introduces an unregistered initial-state gap.
- Deliberately review/recapture the changed baseline and registry actual/desired qualification;
  include the newly imported pilot module in the ordered runtime fingerprint. Then exactly the
  targeted entries retire and the remaining `--expect-red` run must qualify on that reviewed S1
  baseline. Deleting registry rows alone proves nothing.
- Additional strict S1 cases: governed diff without authored `doc-change`, direct aggregate PASS
  after authored completion, correlated Fable stage binding, persisted untyped workflow, legacy
  PASS and ON→OFF→ON recollection. These additions are not part of the 52 existing entries.
- Preserve P06 with trusted non-doc scope, P07u, P02d ordering, OFF controls and source/package
  parity. Require the relevant deterministic gates plus `npm run verify:all -- --fast`, independent
  review with no open P1/P2, and full green CI including Windows on the PR head.

S1 proves only its tested no-credit mechanism. It does not prove positive reconciliation,
independent producer provenance, live-host loading, H1–H4 effectiveness or E1 GO. Registry empty
is a later strict-prep gate, not proof of any of those evidence layers.

## Implementation and acceptance after E0

S1 ships the default-OFF switch, narrow disposition/completion no-credit integration and runtime
status reporting. S2's trusted producer, positive reconciliation and freshness remain pending;
S3's optional provider adapter remains pending. Require every expected applicable MUST and
freshness check before positive credit, plus source/package compatibility, negative cases and
relevant green CI including Windows. The S1 suites establish their tested mechanism/package
contracts; they do not establish independent host provenance, live-host loading or architectural
benefit. E1 has not started and begins only after a creditable S2; E1 GO and H1–H4/paired evidence
remain separate gates.
