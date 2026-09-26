# Intent stage for the tier3 composition (2026-09-27)

Validation-only, #233; three seeds; holdout not read; aggregates only.

Question: which training setup gives the CUA-S1 intent scorer the best
`feature`/`refactor` signal for the tier3 composition in
`docs/system-one-suggestion-gates.md#tier-composition`?

- Script: `scripts/system-one-intent-stage-experiment.py`; tests in
  `ci/system-one-tier-stage-experiment-test.py`.
- Targets: the teacher's dense relevance scores
  (`labels-intent-scores.jsonl`), 12 independent sigmoids, BCE, 12 epochs.
- Variants: `all` (every scored row, the PR #264 setup); `valid-only`
  (rows the validity stage calls invalid removed; rules v2 plus the owner
  review); `staged` (valid rows, then invalid rows with all-zero targets in
  two stages); `valid-large` (valid-only, width 256, 4 layers).
- Evaluation: the 496 valid validation rows with teacher scores. Per-intent
  thresholds are fit by 2-fold cross-validation, so every row is scored with
  thresholds fit on the other half. Truth is teacher score ≥ 0.4. The
  downstream check composes tier on 471 of those rows: tier3 when `feature` or
  `refactor` fires, otherwise the old-rules tier model (staged variant, same
  seed). It is scored against tier rules v2.
- Seed 0 stopped silently near the end of its first run while three seeds
  shared the CPU; it was rerun alone and is included.

## Results (mean ± sd, three seeds)

| Variant | intent micro-F1 | mean fires | feature recall | refactor recall | tier acceptable | tier under | tier3 recall | tier3 precision |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| all | 0.360 ± 0.007 | 4.1 | 0.48 | 0.36 | 0.812 ± 0.016 | 0.098 ± 0.023 | 0.65 | 0.33 |
| valid-only | **0.370 ± 0.017** | **3.6** | 0.53 | 0.35 | **0.826 ± 0.018** | 0.070 ± 0.042 | 0.75 | 0.33 |
| staged | 0.351 ± 0.012 | 4.5 | 0.48 | 0.36 | 0.802 ± 0.041 | 0.108 ± 0.040 | 0.60 | 0.30 |
| valid-large | 0.334 ± 0.017 | 5.1 | 0.55 | 0.67 | 0.801 ± 0.018 | 0.050 ± 0.060 | 0.81 | 0.28 |

## Reading

1. **Dropping invalid prompts helps intent a little.** `valid-only` has the
   best micro-F1, fires fewer intents per prompt, and gives the best
   composed tier: acceptable 0.83 and under-tier 0.07, against 0.81 and 0.10
   for the #264 setup. The gains are about one standard deviation.
2. **Staging does not help intent.** Unlike the tier stage, adding invalid
   prompts back with zero targets lowers every number.
3. **A larger encoder is not better.** It fires more and has lower micro-F1.
   Its low mean under-tier comes with the largest seed-to-seed spread
   (±0.06), because it sometimes over-fires refactor.
4. **The under-tier bar (≤ 0.05) is not met reliably yet.** The intent
   scorer is still weak (micro-F1 about 0.37; the Laya reference measured
   0.60 on the teacher proxy), and tier3 precision stays near 0.33. The next
   lever is intent data or teacher quality rather than model size.
