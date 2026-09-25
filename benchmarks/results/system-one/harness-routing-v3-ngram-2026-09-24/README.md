# System One: ngram tier model after the third spot-check (2026-09-24)

This is local real-model evidence for the `ngram` transport. It is not live-host
evidence. Issue [#233](https://github.com/dyphn1/Harness-everything/issues/233); the
first ngram run is [harness-routing-v1-ngram-2026-09-24](../harness-routing-v1-ngram-2026-09-24/README.md).
**Result: cleaner labels raise coverage, but accepted precision on the holdout is still
below 85%, so the model is not released.**

## What changed since v1

- **Rules.** The owner settled the tier lines from the third training spot-check
  ([system-one-corpus.md](../../../../docs/system-one-corpus.md#gold-labels)):
  - Git work is `tier1` at any width.
  - Adding an option inside one tool, or fixing a bug, is `tier2`.
  - Short replies follow the work in progress.
  - Explicit agents, architecture changes, and repository-wide or cross-component work
    are `tier3`.
- **Holdout.** The owner moved nine holdout cases to these lines. The holdout is now
  `tier1` 48, `tier2` 104, `tier3` 43 and `null` 20, still 215 reviewed cases.
- **Labeler.** Under the final rules the Codex labeler agrees with the holdout 85.1%
  (it was 80.5%).
- **Labels.** The labeler relabeled 2,061 prompts under the new rules, and then relabeled
  again 295 prompts that the first pass had moved from `tier3` to `tier2`. There are
  126 owner overrides and 4 exclusions. The final labels are:
  - `tier2`: 3,207.
  - `tier1`: 1,148.
  - `null`: 726.
  - `tier3`: 544.

  The training data stays local.
- **Training.** Same trainer and defaults as v1. The artifact is 1,048,576 bytes, revision
  `d9aa40e711a3`.

## Calibration (validation, 727)

The 85% target is reached at `minConfidence` 0.5 and `minMargin` 0, with 44.0% coverage
(320 accepted, precision 85.9%). v1 had 29.0%.

## Holdout (current 215 cases, one run each)

[`report.json`](report.json) is the unmodified evaluator output for v3. v1 was measured
again on the same holdout for comparison; that report stays local.

| Metric | v3 | v1 on the same holdout | Lexical baseline |
| --- | --- | --- | --- |
| Accepted | 59 (27.4%) | 43 (20.0%) | 87 (40.5%) |
| Accepted correct | 40 | 31 | 47 |
| Accepted precision | 67.8% | 72.1% | 54.0% |
| Warm p95 | 0.66 ms | 0.81 ms | — |

Gates `reviewedHoldout`, `repeatability`, `warmLatency` and `sourceProvenance` pass.
`acceptedPrecision`, `coverage` and gated `macroF1` fail.

## Reading

- **`tier3` is the weak class.** The largest error among accepted answers is gold `tier3`
  predicted `tier2` (9 of 19 errors). Only one `tier3` answer was accepted.
- **Validation is optimistic.** The labeler's labels make up the validation set, and it
  reaches 85.9%. The owner-reviewed holdout reaches only 67.8%, because it holds twice as
  many `tier3` cases (20% against 10%) and they are authored prompts.
- **Character n-grams are not enough.** The `tier3` line depends on scope ("every",
  "across", "the whole repo") rather than on surface words. That supports the staged plan:
  an intent classifier first, then the tier.
