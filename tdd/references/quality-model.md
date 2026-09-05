# TDD Scoring Standard

This model turns each source requirement into auditable evidence. The authoritative source remains the contract even when it appears wrong. Record a suspected documentation problem as `SOURCE_DEFECT`; record disagreement between traced sources as `SOURCE_CONFLICT`. Never reinterpret either into a passing implementation. If no authoritative source exists, use `INFERRED` and state the inference basis.

## Profile contract

Every requirement declares exactly one `testProfile`: `unit` or `integration`. The selected profile defines which case classes are applicable; the common scoring and source rules do not make every test use identical evidence.

- `unit`: follow `unit-testing.md`. Integration determinism is N/A with a written reason.
- `integration`: follow `integration-testing.md`. Determinism is mandatory and cannot be declared N/A.

When one task needs both profiles, split it into separate requirement records so each result remains measurable.

## Workflow

1. Give every source requirement a stable `requirementId`, select its `testProfile`, and record the exact source path and section.
2. Use that profile to declare each applicable equivalence partition, field check, error path, and unexpected-input class before implementation.
3. RED: execute the source-backed tests and retain their evidence location.
4. GREEN/REFACTOR: update each check to `PASS`, `FAIL`, `SKIPPED`, or reasoned `N/A`.
5. For integration behavior, run identical input in clean equivalent state at least twice. Record exit status, error category, output, files, persistent state, events, logs, and external calls.
6. Run the gate and retain its JSON report:

```bash
npm run tdd:quality -- evidence.json --output tdd-quality-report.json
```

Exit `0` is PASS, `1` is a valid FAIL report, and `2` is malformed input or CLI usage failure. Schemas are in `tdd/schemas/`; start from `tdd/fixtures/pass-evidence.json`.

## Common evidence dimensions

| Dimension | Declarations and evidence |
| --- | --- |
| Positive parameters | One executed case per supported parameter class, enum, or equivalence partition |
| Negative parameters | One executed case per rejected partition or constraint |
| Input completeness | `required`, `optional`, `omitted`, `empty`, `null`, `min`, `max`, `boundary` |
| Output completeness | `value`, `type`, `schema`, `required-field`, `prohibited-extra-field`, `side-effect` |
| Error handling | `error-type`, `error-code`, `message`, `state-cleanup`, `rollback`, `no-unintended-output` |
| Unexpected input | `malformed`, `unknown`, `extra`, `unsupported`, `out-of-range`, `duplicate`, `wrong-type` |
| Determinism | At least two matching runs with identical input and complete output/side-effect records |
| Source traceability | Every source has an exact path/section, or is explicitly `INFERRED` with a basis |

For an applicable dimension, every fixed class must appear. The selected profile decides applicability. Mark an inapplicable dimension or check `N/A` with a written reason; omission is a schema/gate failure. Skipped and flaky tests remain visible and fail the gate.

## Scoring and mandatory gates

The evaluator derives raw counts and percentages from individual checks; evidence cannot supply or override an aggregate score.

```text
dimension_percentage = passed_checks / required_checks * 100
weighted_points = sum(dimension_percentage * canonical_weight)
quality_score = weighted_points / sum(applicable_weights)
```

Canonical weights are positive 0.15, negative 0.15, input 0.15, output 0.15, errors 0.15, unexpected 0.10, determinism 0.10, and traceability 0.05. Integration normally applies all weights. Unit excludes reasoned-N/A dimensions and renormalizes the remaining canonical weights; it never invents replacement weights. Reports publish `weights`, `weightedPoints`, `applicableWeight`, every dimension's raw counts/percentage, and the final score so the calculation is reproducible.

A report passes only at 100% and when every applicable dimension executed, every source is traced, no mismatch/conflict exists, input/output/error checks are complete, integration ran at least twice with equivalent normalized results, and no skipped/flaky test exists. `SOURCE_DEFECT` is reported independently and does not excuse `NON_CONFORMANT`.

## Agent self-check

1. Copy `tdd/fixtures/pass-evidence.json` and select `unit` or `integration` per requirement.
2. Replace fixture checks with real case IDs and test evidence; use explicit reasoned N/A instead of deleting inapplicable classes.
3. Run `npm run tdd:quality -- <evidence.json> --output <report.json>`.
4. Inspect each requirement score, dimension percentage, mandatory gate, skip/N/A list, and structural error.
5. Accept the tests only when exit code is 0, every requirement and aggregate result is `PASS`, and every score is 100. Exit 1 means valid but inadequate evidence; exit 2 means the input cannot be evaluated.

## Deterministic comparison

Object key order is canonicalized; array order remains significant. The same-input rule is strict. A normalization may target only `output.*` or `sideEffects.*`, must exist in every run, and must name the exact authoritative source section that permits volatility. The rule and ignored path remain in the report. Any other mismatch fails.
