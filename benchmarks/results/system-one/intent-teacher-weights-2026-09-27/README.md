# Intent: Laya teacher rows and feature/refactor weights (2026-09-27)

Validation-only, #233 / #255 Candidate B; three seeds; holdout not read;
aggregates only. Same setup and evaluation as
`../intent-stage-cua-s1-2026-09-27/`: valid prompts only, 12 epochs, 2-fold
cross-validated intent thresholds, tier3 composed from `feature`/`refactor`.

- **Laya teacher rows.** `scripts/system-one-teacher-laya-ft.py` scored the
  1,385 train prompts without Sonnet scores with the fine-tuned Laya
  checkpoint (local, about 3 minutes; private repo
  `training/labels-intent-laya-ft.jsonl`). After the validity filter,
  4,473 valid train rows instead of about 3,500. Validation truth stays
  Sonnet-only.
- **Weights.** BCE positive weight 2 for `feature` and `refactor`
  (`--intent-weights`), the two intents the tier3 composition reads.

## Results (mean ± sd, three seeds)

| Variant | intent micro-F1 | mean fires | feature R / P | refactor R / P | tier acceptable | tier under | tier3 R / P |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Sonnet rows | 0.361 ± 0.006 | 4.35 | 0.62 / 0.23 | 0.62 / 0.10 | 0.840 ± 0.018 | 0.041 ± 0.032 | 0.86 / 0.32 |
| + Laya rows | **0.390 ± 0.011** | **3.52** | 0.51 / 0.24 | 0.24 / 0.15 | 0.837 ± 0.023 | 0.092 ± 0.011 | 0.66 / 0.38 |
| Sonnet rows, weighted | 0.362 ± 0.004 | 3.93 | 0.52 / 0.30 | 0.40 / 0.17 | 0.838 ± 0.005 | 0.093 ± 0.042 | 0.66 / 0.39 |
| + Laya rows, weighted | **0.390 ± 0.024** | 3.66 | 0.63 / 0.28 | 0.55 / 0.12 | **0.841 ± 0.020** | 0.059 ± 0.031 | 0.78 / 0.34 |

## Reading

1. **The Laya teacher improves the intent scorer.** Adding its rows raises
   micro-F1 from 0.361 to 0.390 (the Sonnet-only runs vary by ±0.006; the unweighted Laya runs by ±0.011) and cuts
   fires per prompt from 4.4 to 3.5. This is the first intent gain in this
   series beyond seed noise.
2. **A sharper intent scorer fires feature/refactor less, which hurts the
   tier3 composition** (under-tier 0.041 → 0.092). Weighting those two
   intents restores recall; with both, intent stays at 0.390 and tier is at
   0.841 acceptable, 0.059 under-tier.
3. **Tier numbers are noisy at this size.** The Sonnet-rows variant repeats
   the earlier `valid-only` setup and lands at under-tier 0.041 here against
   0.070 there: run-to-run variance on CPU is about ±0.03, as large as the
   differences between variants. Tier acceptable precision sits at 0.84 in
   every variant.
4. Recommended intent setup for the next trial build: valid prompts only,
   Sonnet plus Laya teacher rows, feature/refactor weight 2.
