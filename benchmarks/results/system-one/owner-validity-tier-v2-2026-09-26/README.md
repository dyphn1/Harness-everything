# Owner validity review and tier rules v2 (2026-09-26)

Validation-only, #233; five seeds each; holdout not read; aggregates only.

Inputs changed from `../tier-stage-cua-s1-2026-09-26/`:

- **Owner validity review.** The owner reviewed, blind and from the text
  alone, all 571 labeler-`null` prompts that rules v2 leave undecided
  (private repo `reviews/invalid-review-v1.json`, hashes only): 347 valid,
  181 invalid, 43 unsure. Valid rows become actionable seeds for the gate
  and leave the tier stage (they have no tier label); invalid rows become
  invalid seeds; unsure rows are dropped. Most of the labeler's `null`
  prompts are ordinary requests when read alone.
- **Tier rules v2** (`--tier-rules 2`, owner decision): a prompt whose
  primary intent is `feature` or `refactor` is tier3 whatever its width.
  The intent comes from the Codex intent labels. Validation tier3 grows from
  62 to 155 rows (tier1 118, tier2 359); this is a harder, different target,
  so tier numbers compare within this run, not with the earlier one.

Validation: 727 rows (the owner marked none of the validation rows
unsure). The gate is scored on all 727. The tier stage and the pipeline use
690: 632 valid rows with a tier label and 58 invalid rows. The 37
owner-valid rows have no tier label, so only the gate sees them.

## Validity gate (`--merge-invalid`, mean ± sd)

| Model | AUROC | confident invalid | confident actionable | invalid P / R at 0.5 |
| --- | --- | --- | --- | --- |
| curriculum R1 | 0.861 ± 0.009 | 0.36 ± 0.15 | 0.91 ± 0.05 | 0.48 / 0.45 |
| curriculum end | 0.839 ± 0.037 | 0.24 ± 0.13 | 0.95 ± 0.05 | 0.64 / 0.36 |
| control | 0.861 ± 0.011 | 0.24 ± 0.12 | 0.93 ± 0.03 | 0.58 / 0.38 |

Before the review, the same setup ranked at AUROC 0.785 (control 0.783);
the validation truth changed too, so the gain is indicative. Owner-invalid
rows still score low (mean invalid score 0.18–0.29): the prompts the owner
calls invalid are the hard part for a text-only model.

## Tier stage, rules v2 (valid rows, mean ± sd)

| Variant | coverage | acceptable | exact | under-tier | confident coverage | confident acceptable | invalid abstained |
| --- | --- | --- | --- | --- | --- | --- | --- |
| valid only (6 epochs) | 0.73 ± 0.27 | 0.71 | 0.62 | 0.29 | 0.08 | 0.75 | 0.24 |
| valid only (15 epochs) | 0.85 ± 0.05 | 0.74 | 0.59 | 0.24 | 0.53 | 0.79 | 0.16 |
| valid, then invalid in 3 stages | 0.87 ± 0.03 | **0.78** | 0.62 | **0.22** | 0.57 | 0.80 | 0.30 |
| all rows at once | 0.78 ± 0.07 | 0.76 | 0.60 | 0.22 | 0.50 | 0.78 | 0.55 |

Seed 0, all rows at once, per tier: tier1 recall 0.31, tier2 0.64, tier3
0.27 (precision 0.42); per-tier AUROC 0.77 / 0.66 / 0.67.

## Pipeline on the 690 tier-stage validation rows (mean)

| Tier variant | gate | invalid handed off | invalid given a tier | valid handed off | suggestion precision, all rows |
| --- | --- | --- | --- | --- | --- |
| valid, then invalid in 3 stages | none | 0 | 0.70 | 0 | 0.72 |
| valid, then invalid in 3 stages | 0.5 | 0.35 | 0.47 | 0.02 | 0.74 |
| all rows at once | 0.5 | 0.35 | 0.35 | 0.02 | 0.73 |

## Reading

1. **The owner review is the biggest single gain in this series.** The
   gate ranks at AUROC 0.86 and hands off 35% of invalid prompts at 0.5
   (was 27%), wrongly handing off 2% of valid ones.
2. **Feature/refactor-as-tier3 makes tier harder for this model.** Under
   the new rule, acceptable precision is 0.74–0.78 and under-tier 0.22–0.29,
   against 0.86 and 0.14 under the old rule. tier3 is now decided by the
   kind of work (new behavior, restructuring), not only its breadth, and the
   byte-level tier model separates it poorly (tier3 recall 0.27).
3. **Staged training is the best tier variant here** (acceptable 0.78,
   under-tier 0.22, lowest spread), though its lead over the other
   variants is within about two standard deviations.
4. Since the intent stage already scores `feature` and `refactor`, tier3
   under the new rule could be composed from the intent scores plus the
   structural floor instead of being learned a second time. Not measured.
