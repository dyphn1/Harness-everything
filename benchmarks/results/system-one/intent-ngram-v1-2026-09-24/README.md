# System One: first ngram intent model (2026-09-24)

This is local real-model evidence for the intent stage
([system-one-intent.md](../../../../docs/system-one-intent.md)) on the `ngram` transport. It
is not live-host evidence. Issue
[#233](https://github.com/dyphn1/Harness-everything/issues/233).
**Result: accepted intents are almost always right (95.6% graded), but the model accepts
only 7% of the holdout, so the coverage gate fails and the model is not released.**

## Model

- **Labels.** Codex labeled 5,625 local owner prompts for intent, each with a primary and
  secondary intents. The labeler reached a graded agreement of 84.9% on the holdout
  ([check](../labeler-holdout-check-intent-2026-09-24/report.json)). No owner overrides
  exist yet. The training data stays local.
- **Training.** `scripts/system-one-train-ngram.py --task intent` with soft targets. The
  primary gets 0.6 and the secondaries share 0.4.
- **Configuration.** Four configurations were compared on validation only. The one chosen
  uses 200 epochs, weight decay 1e-5, `nmax` 3 and square-root class weights. Its
  validation accuracy is 48.7%.
- **Artifact.** A 13-option catalog in 3.4 MB of float32 weights, revision `c25eabee9b54`.

## Calibration (validation, 727)

- **Secondary threshold.** 0.15, chosen by secondary micro-F1.
- **Acceptance.** `minConfidence` 0.64 and `minMargin` 0 give a graded precision of 85%
  or more at 14.3% coverage.

## Holdout (222 owner-reviewed cases, one run)

[`report.json`](report.json) is the unmodified evaluator output.

| Metric | Value |
| --- | --- |
| Accepted | 16 (7.2%) |
| Accepted precision, graded (gate) | **95.6%** |
| Accepted precision, exact primary | 93.8% |
| Top-1 without abstention, exact / graded | 33.8% / 40.5% |
| Macro-F1 (abstentions as null) vs majority baseline | 0.113 vs 0.020 |
| Family consistency, model vs owner gold | 86.7% vs 79.5% |
| Warm p95 | 0.58 ms |

These gates pass:

- `reviewedHoldout`.
- `acceptedPrecision`.
- `macroF1`.
- `repeatability`.
- `warmLatency`.
- `sourceProvenance`.

The `coverage` gate fails at 7% against a target of 80%.

## Reading

- **Precise but rarely confident.** A linear model over character n-grams separates 13
  intents poorly: without abstention it matches only a third of the owner's primaries.
  The few answers it is confident about are nearly always right.
- **Secondary intents are thin.** The labeler gives about 0.5 secondary intents per prompt;
  the owner gives about 2.5. The soft targets therefore teach little about secondaries.
- **Next levers.**
  - Owner spot-checks of intent labels, especially secondaries.
  - Word-level features next to the character n-grams.
  - A small encoder, if a few MB allows one.
