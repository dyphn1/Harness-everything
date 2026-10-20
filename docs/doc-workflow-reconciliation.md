# Document workflow reconciliation — Phase 3b preparation

**Status: design and fixture contracts only. Runtime reconciliation is not shipped or activated.**
This document refines the planned [document lifecycle contract](document-lifecycle.md#phase-3b--narrow-integration-contract-planned-not-shipped).
The [owner's E0/E1 decision](https://github.com/dyphn1/Harness-everything/issues/325#issuecomment-6283237637)
permits design and RED preparation before #341 E0. Even a default-OFF runtime implementation
MUST NOT merge or activate before E0 is reviewed and accepted.

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
An unsupported host reports unavailable capability/reason. H1/H2 runtime proof remains pending.

## One switch and rollback

Planned switch: `HARNESS_DOC_RECONCILIATION_PILOT=1`. Missing, `0`, or any other value is OFF.
No production switch reader or runtime import is part of preparation. Test children explicitly
set or remove the variable; requesting ON during prep still runs existing legacy production code.

After E0, OFF preserves legacy disposition and grants zero pilot verification credit. Legacy
`pass` or `satisfied` is not relabeled as document verification. Rollback removes the opt-in,
records that pilot credit is disabled, and preserves session/evidence history. ON→OFF→ON MUST
recollect/reconcile rather than trust any persisted pilot or legacy PASS. Withholding pilot
credit never rejects Stop or changes host authorization. Runtime activation still requires E0;
the switch cannot serve as a substitute for that acceptance gate.

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
it is not a separate `cases.json` record. The 16 cases currently produce 13 `EXPECTED_RED` cases
and three `CONTROL_PASS` cases (`P02d`, `P06`, and `P07u`); all replay legs must agree. These
statuses qualify the preparation harness only and do not grant document credit.

The [pending-red.json registry](../ci/fixtures/doc-obligations/reconciliation-prep/pending-red.json)
records 62 exact source/packaged gaps. Its root records `schemaVersion`, `phase`, `baselineSha`,
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

The discovered [preparation suite](../ci/mechanism-325-3b-preparation.test.js) validates the
inventory, green OFF controls, exact pending-gap qualification and parity. Its report root contains
`schemaVersion`, `mode`, `baselineSha`, `runtimeFingerprintMatches`, `pilotCredit`, and `cases`.
Each case reports `caseId`, `status`, `qualifiedGaps`, `parity`, and `assertions`; each assertion
identifies its `leg` (`source` or `packaged`), `mode` (`off` or `on`), full assertion `id`,
classification `status`, and `actual`, with `desired`/`registered` values when applicable. Case
statuses are `EXPECTED_RED`, `CONTROL_PASS`, `INFRASTRUCTURE`, or `FAIL`; assertion statuses distinguish
passing controls, unexpected passes, qualified gaps, unqualified gaps, and registry mismatches.
`pilotCredit` is always false. `reportOrigin` belongs to the replay's `pilotReportOrigin`
(`runtime` only for an actual runtime report, otherwise `harness` for a synthesized marker);
it is not a field on the preparation report's assertion rows. A harness-synthesized unavailable
marker is never presented as a production report.
## Implementation and acceptance after E0

After accepted E0, implement the minimum trusted producer and optional provider adapter, add
the switch reader and narrow W/D/completion integration, package generated copies, and remove
pending exemptions as strict tests become GREEN. Require every expected applicable MUST and
freshness check, source/package compatibility, negative cases and relevant green CI including
Windows. A green preparation harness establishes only its declared mechanism/data checks.
It does not claim runtime reconciliation, E0/E1 acceptance, independent host provenance or
architectural benefit. E1 observations and H1–H4/paired evaluation remain separate gates.
