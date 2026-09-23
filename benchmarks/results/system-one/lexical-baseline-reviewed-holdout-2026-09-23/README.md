# System One: lexical baseline on the reviewed tier holdout (2026-09-23)

Evidence layer: **deterministic evaluation of the current lexical router against
owner-reviewed gold**. No model was run: the manifest path does not exist, so
every model decision is `provider-config` and model coverage is 0 by design.
Issue [#233](https://github.com/dyphn1/Harness-everything/issues/233).

## Command

```bash
node scripts/evaluate-system-one.js benchmarks/fixtures/system-one-holdout.json \
  /nonexistent/manifest.json \
  benchmarks/results/system-one/lexical-baseline-reviewed-holdout-2026-09-23/report.json
```

[`report.json`](report.json) is the unmodified output. The holdout contains 215
owner-reviewed cases and is described in
[system-one-corpus.md](../../../../docs/system-one-corpus.md).

## Lexical baseline

| Metric | Value |
| --- | --- |
| Accuracy (abstention counted as `null`) | 28.8% |
| Macro-F1 over tier1, tier2, tier3, null | 0.254 |
| Coverage (a tier was chosen) | 40.5% |
| Precision of chosen tiers | 49.4% |

Gold versus lexical prediction (rows are gold):

| Gold \ lexical | tier1 | tier2 | tier3 | unclassified |
| --- | --- | --- | --- | --- |
| tier1 (47) | 1 | 6 | 3 | 37 |
| tier2 (97) | 0 | 28 | 10 | 59 |
| tier3 (51) | 0 | 24 | 14 | 13 |
| null (20) | 0 | 0 | 1 | 19 |

The keyword router leaves most prompts unclassified and almost never selects
`tier1`. `reviewedHoldout` passes. A `harness-routing-v1` checkpoint must reach
at least this macro-F1 (0.254) and also meet accepted precision of at least 98%
and coverage of at least 80% before any default change.

## Limitations

This is one annotator's gold on 215 synthetic or de-identified prompts, with no
inter-annotator agreement measured. It measures the lexical tier decision only,
not the policy assembler's final workflow plan.
