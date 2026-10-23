# Archived #325 prep gates (F4-T2)

Historical evidence only. Nothing here is a GREEN gate.

- **Not discovered:** `ci/mechanism-test.js` runs only top-level `ci/mechanism-*.test.js`, so nothing in this directory runs in `npm run test:mechanism`.
- **Owner clause (T2, 2026-10-22):** "only archive the prep fingerprint and the RED-plan gates as historical evidence, and tag tests with `locks: <anchor clause>`. List the unmapped tests, but don't delete them."
- **Revision of the historical results:** `0308386058ad942e2764475d48fd65a013910e1e`. The registry was captured at `c271249a8a99d7e0320288af8cb086bb03f8fa1a`.

## Manifest

| # | Archived entry | Original path (sha256 at 0308386) | Removed live gate | Old result at 0308386 | Replacement behaviour command | Residual failure |
|---|---|---|---|---|---|---|
| 1 | Prep runner `doc-reconciliation-red.js` | `ci/prep/doc-reconciliation-red.js` (`5e85af19…7849c`) | Runtime-fingerprint check that forces every replay to FAIL on drift; `--expect-red` qualification | `--expect-red`: exit 1, "runtime fingerprint changed" | `node ci/mechanism-325-3b-preparation.test.js` (live infrastructure bounds only) | Fingerprint mismatch: registry `a7679becc1cb…8153b`, current `17a4821a21e1…2394` |
| 2 | Frozen registry `pending-red.json` | `ci/fixtures/doc-obligations/reconciliation-prep/pending-red.json` (`08ad9eef…7ff0`), kept at its fixture path (outside the T2 write-set) | Registry used as the qualified-gap gate | Validates; fingerprint field stale (see #1) | none (historical data) | Same fingerprint mismatch |
| 3 | Historical checks from the 3b suite (10 checks) | `ci/mechanism-325-3b-preparation.test.js` (pre-split) | Expected-RED mode, expected-RED report, gap registry, strict-mode gap log, registry validator, omitted-gap and unexpected-PASS checks, fingerprint invalidation, recapture | 4 FAIL, 6 PASS (see `historical-qualification.test.js`) | `node ci/archive/325-prep/historical-qualification.test.js` reproduces the old result | 4 FAIL: expected-RED mode, expected-RED report, gap registry, recapture (all fingerprint-bound) |
| 4 | T12 `EXPECTED_RED` list and `--expect-red` mode | `ci/mechanism-325-f4-invariants.test.js` (`bd61e6e7…bfcca19`), list in `f4-expected-red.json` | Frozen 20-entry RED plan; `STATUS: RED-PLAN-MATCHED` | `--expect-red`: `RED-PLAN-MISMATCH (expected 20, observed 14, infra 0)`, exit 1. S2-I4, S5-I4 and S6-I4 are CONTROL on both legs | `node ci/mechanism-325-f4-invariants.test.js` (plain mode reports the actual failures) | 14 RED cells, unchanged by T2 (see the live report) |
| 5 | Probe `P-ignore-missing-expected-must` | `ci/mechanism-325-f4-invariants.test.js` `MUTANTS` (pre-archive line 408, owner S6-I1) | "must become APPLIED" pending handoff in `--mutants` | `NOT APPLIED`. Never detected | Actual missing-MUST refusal tests stay live in the core suite (`ci/mechanism-325-3b-s2a-core.test.js`) | Open gap: no mutant witnesses the missing-MUST refusal. Record it, do not add a resolver redesign to manufacture one |

## Relocation edits (entry 1)

Code changes against the original runner (sha256 `5e85af19…7849c`) are limited to:

- `ROOT` resolves three levels up (`path.resolve(__dirname, '..', '..', '..')`).
- The fixtures `require` path is `../../lib/doc-reconciliation-prep-fixtures`.
- The printed re-capture command names `ci/archive/325-prep/doc-reconciliation-red.js`.

The header comment also gained an archive note. Logic, the registry path and the fingerprint files are unchanged.

## Commands

```
node ci/archive/325-prep/doc-reconciliation-red.js --expect-red   # exit 1, runtime fingerprint changed
node ci/archive/325-prep/doc-reconciliation-red.js --strict --case P03   # exit 1, recorded gaps
node ci/archive/325-prep/historical-qualification.test.js          # 4 FAIL, 6 PASS
```

## Live suite after T2

- `ci/mechanism-325-3b-preparation.test.js` still runs the archived runner, but only for its infrastructure path (exit 2, child deadline, output bound). Those checks are live.
- The live suite no longer reads the registry for qualification.

## Coordinator disposition (pending)

The WA pending-probe gate (`P-ignore-missing-expected-must`, WA report 28–30) is superseded for WB by the coordinator's disposition. The coordinator records that disposition. It is not recorded here.

## Retired 2026-10-23 (owner decision 5)

Owner decision 5 (2026-10-23) retired the schema and preload-only predicates below. Each entry keeps its old predicate and its last result at `0c53a57` (source and packaged legs gave the same result unless noted). Each retired cell left a `// locks: historical — retired 2026-10-23 (owner decision 5)` comment where it was.

**Retired from the active pass/fail set**

| Cell | Old predicate | Last result at `0c53a57` | Where |
|---|---|---|---|
| S6-I3 | `pilot.acceptedEvents` is an array with one `provenance` per accepted ref (`on-valid-direct-quoted-review` / `review`) | RED: `{"acceptedRefs":2,"acceptedEvents":null}` | `ci/mechanism-325-f4-invariants.test.js` |
| S7-I3 | `Boolean(pilot.identity)` (`on-valid-direct-quoted-review` / `review`) | RED: `null` | `ci/mechanism-325-f4-invariants.test.js` |
| S8-I3 | some key of the withheld `obligations` matches `/origin\|withheld\|source/i` (`on-malformed` / `base`) | RED: keys are `schemaVersion, workflowId, sessionId, …` with no origin key | `ci/mechanism-325-f4-invariants.test.js` |
| F8 preload spy | the internal modules `./lib/harness-state`, `./lib/workflow-isolation`, `./lib/telemetry` are not eagerly loaded in any OFF route/switch case | FAIL: internal-module-load 24/24 OFF cases | `ci/mechanism-325-3b-s2b-capture.test.js` (`R2C1-OFF-CAPTURE-ONLY-FAST-PATH`) |

F8's OFF side-effect assertions (state, capture, output, exit = 0) and the legacy OFF controls stay in the active set. At `0c53a57` they observed 0 / 0 / 0 / 0.

**Replaced oracles (cell kept, key predicate swapped for a behaviour oracle)**

| Cell | Old predicate | Last result at `0c53a57` | Behaviour oracle now |
|---|---|---|---|
| S1-I2 | no `session-workspaces/` file exists after the OFF capture-only route (state created by route/plan/start included) | RED: `session-workspaces/346be55a….json` present | file-set delta across the hook (OFF adds none; ON control adds some) |
| S2-I3 | a `handoff` key matches `/lastVerify/` and `/(source\|kind\|origin)/` | RED: no such key | after drift, `lastDocVerifyAt` is withdrawn, the generic record survives, the workflow Stop names `req-verify` |
| S10-I3 | the same key predicate on the OFF legacy run | RED: no such key | after drift, `lastGenericVerifyAt` equals the aggregate, and the generic Stop stays silent |

Limits: the S1-I2 delta compares file sets, so an in-place rewrite of a binding that route/plan/start already created is not seen. Pre-existing OFF handoff writes are legacy behaviour and are not part of this cell.

Sources: `F4-T3-before-invariants.log` and `F4-T3-before-capture.log` (`0c53a57`), `F4-T3-after-invariants.log` and `F4-T3-after-capture.log` (this change).
