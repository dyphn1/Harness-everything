# Tier stage on valid prompts, and the two-stage pipeline (2026-09-26)

Validation-only, #233. Stage 1 marks a prompt `invalid` when its text alone
has no actionable request and hands it to the host agent (see
`../noise-gate-cua-s1-2026-09-26/`). Stage 2 picks a tier for the rest. The
holdout was not read; files here hold aggregates only.

- Scripts: `scripts/system-one-tier-stage-experiment.py` (tier stage),
  `scripts/system-one-pipeline-eval.py` (both stages on every validation
  row); tests in `ci/system-one-tier-stage-experiment-test.py`.
- Labels: tier labels (Codex, owner overrides) under the corpus rules as of
  2026-09-24; validity from rules v2 plus the labeler's `null`. The owner's
  2026-09-26 decision that new features count as tier3 is **not** in these
  labels yet.
- Model: `tinyx` width 128, 2 layers, three independent tier sigmoids; a pick
  is the highest tier at or above 0.5, else abstain. Seeds 0–4, CPU.
- Validation: 727 rows, 632 valid (tier1 122, tier2 448, tier3 62), 95
  invalid. Gate for the pipeline: the seed-matched `--merge-invalid`
  curriculum checkpoint from the noise-gate runs.

## Tier stage (valid rows; mean ± sd over five seeds)

| Variant | coverage | acceptable precision | exact | under-tier | confident coverage | invalid rows abstained |
| --- | --- | --- | --- | --- | --- | --- |
| valid only (6 epochs) | 0.82 ± 0.16 | 0.85 ± 0.05 | 0.73 | 0.15 | 0.24 | 0.20 |
| valid only (15 epochs) | 0.93 ± 0.04 | 0.84 ± 0.03 | 0.70 | 0.15 | 0.72 | 0.07 |
| valid, then invalid in 3 stages | 0.83 ± 0.06 | 0.86 ± 0.03 | 0.73 | 0.14 | 0.61 | 0.39 |
| all rows at once | 0.85 ± 0.04 | 0.86 ± 0.02 | 0.73 | 0.14 | 0.63 | 0.47 |

Confident picks (max score ≥ 0.8) are acceptable 87–88% of the time in
every variant.

## Pipeline on all validation rows (mean over five seeds)

| Tier variant | gate | invalid handed off | invalid given a tier | valid handed off | suggestion precision, all rows |
| --- | --- | --- | --- | --- | --- |
| valid only (15 epochs) | none | 0 | 0.93 | 0 | 0.73 |
| valid only (15 epochs) | 0.5 | 0.27 | 0.67 | 0.03 | 0.76 |
| all rows at once | none | 0 | 0.54 | 0 | 0.79 |
| all rows at once | 0.5 | 0.27 | 0.50 | 0.03 | 0.79 |
| valid, then invalid in 3 stages | 0.5 | 0.27 | 0.50 | 0.03 | 0.79 |

"Suggestion precision, all rows" counts a tier shown on an invalid prompt as
wrong.

## Reading

1. **Tier on valid prompts reaches the acceptable-precision bar, not the
   under-tier bar.** Acceptable precision is 0.84–0.86 against the proposed
   0.85; under-tier is 0.13–0.15 against 0.05. Most misses are tier3 read as
   tier2 and tier2 read as tier1: seed 0 recovers 7 of 62 tier3 prompts.
   Preferring the highest qualifying tier instead of the argmax lowers
   under-tier only to 0.12 (in-sample, reported for direction only).
2. **Training on invalid prompts helps the tier model.** Adding them back,
   in stages or at once, keeps acceptable precision and makes the tier model
   itself abstain on 39–47% of invalid prompts, against 7% when it never saw
   them. Stages and all-at-once end the same.
3. **The current gate adds little.** It hands off only 18–27% of invalid
   prompts (thresholds 0.8 and 0.5), with 1–3% of valid prompts handed off by
   mistake. The pipeline's best all-row suggestion precision is 0.79, and
   half of the invalid prompts still get a tier. The owner's review of the
   unruled `null` rows is the next input for the gate.
4. **tier3 is the weak class.** Its line depends on scope, which a
   byte-level model at this size reads poorly, and it is 10% of the data.
   Relabeling with the owner's feature-is-tier3 rule would change this class
   and should be measured before tuning the readout.
