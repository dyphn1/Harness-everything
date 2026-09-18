# Contract Integrity Audit

The contract-integrity audit reconciles the chain:

```text
ADR decision -> living spec requirement -> ticket/change
-> #58 completeness evidence -> predeclared protection probes
-> implementation evidence
```

Phase 1 is a **trace/reconciliation engine**. It does not yet generate or execute mutation probes. A green existing suite therefore cannot manufacture a protection PASS.

## Inputs

`contract-integrity/schemas/trace.schema.json` defines version `1.0.0`.

Every current requirement has:

- a stable `requirementId` and revision;
- one current living spec;
- zero or more governing ADR decisions;
- linked tickets, tests, and implementation evidence;
- **predeclared** `requiredProbeIds`;
- explicit source validity.

Artifacts use stable IDs and lifecycle state instead of appending ticket history into ADR text.

Protection probe dispositions are:

- `KILLED`: valid only when an isolated source-derived contract probe fails for the expected contract reason;
- `SURVIVED`: the implementation violated the contract and the tests did not stop it;
- `INVALID`: build/infrastructure/flaky or otherwise unusable evidence;
- `NOT_EVALUATED`: not executed.

A compile/build failure is never counted as a killed contract probe.

## Scoring

Completeness is not reimplemented. Pass `--tdd-evidence` and Harness calls the existing #58 evaluator.

Protection is intentionally anti-padding:

1. each requirement declares `requiredProbeIds` before execution;
2. only those probe IDs affect its score;
3. a requirement is 100 only when **every required probe is validly KILLED**;
4. any required `SURVIVED` probe makes that requirement 0;
5. missing/invalid/not-evaluated required evidence also gives 0 and `NOT_EVALUATED`;
6. extra killed probes do not change the requirement score.

The project score is:

```text
contractIntegrityScore = min(completenessScore, protectionScore)
```

Scores never override a drift or evidence gate.

## Drift vocabulary

The machine report uses:

- `CONSISTENT`
- `UNTRACED_CHANGE`
- `STALE_SPEC`
- `STALE_TEST`
- `STALE_IMPLEMENTATION`
- `SOURCE_DEFECT`
- `SOURCE_CONFLICT`
- `INTENTIONAL_SUPERSESSION`
- `NOT_EVALUATED`

A ticket with behavior/architecture impact targeting a newer requirement revision than the living spec is `STALE_SPEC + UNTRACED_CHANGE`. Test/probe evidence must point to the current living spec, not merely have a green score.

## CLI

```bash
node contract-integrity/scripts/audit.js trace.json \
  --tdd-evidence tdd-evidence.json \
  --output contract-report.json \
  --markdown contract-report.md
```

Or:

```bash
npm run contract:integrity -- trace.json --tdd-evidence tdd-evidence.json
```

### Modes

`strict`
: unresolved drift, missing completeness evidence, surviving/invalid/missing probes, source defects/conflicts, or a score below 100 fail the completion gate.

`audit`
: intended for migration of legacy projects. It returns an audit report and exits zero for valid input even when debt exists, but `gateEligible` remains false and it **cannot authorize completion**.

Malformed input/evidence returns exit 2 in either mode.

## Reports

JSON contains raw artifact/requirement/probe counts, both component scores, integrity score, drift counts, per-requirement reason codes, and the compact contract graph.

Markdown stays concise. Detailed lineage belongs in the generated graph/report, not as raw ticket chronology appended to ADRs/specs.

## Phase boundary

Phase 1 consumes declared probe evidence but does not create it. Phase 3 of #84 will define project adapters and execute source-derived probes in isolated/recoverable workspaces. Until then, absent probe evidence is `NOT_EVALUATED`, never PASS.

No new directly routed skill is introduced in Phase 1. Phase 2 must first review routing/description collision before integrating this audit into `grill-with-docs`, `to-spec`, `to-tickets`, or completion workflows.
