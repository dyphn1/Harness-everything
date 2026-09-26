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

## Composed tier3: take it from intent instead of learning it

`scripts/system-one-tier-compose-eval.py`. Under rules v2 tier3 means
"primary intent is feature or refactor" (plus the breadth-based tier3 of
the old rules). The composed readout is: tier3 when the intent readout
says feature/refactor, otherwise the old-rules tier model's pick (staged
variant, same seed). Two intent readouts: `primary` (feature or refactor is
the top intent) and `fires` (either is at or above its own threshold). Two
intent scorers, both with their saved per-intent thresholds, which were fit
on the teacher's validation scores, never on tier truth:

- `cua`: the CUA-S1 intent baseline from PR #264 (deployable size).
- `laya`: the fine-tuned Laya reference from #255 (ceiling only, not
  deployable).

Rows: the 471 valid validation rows that also have teacher intent scores
(123 tier3). Mean ± sd over the five tier seeds (`tier-compose.json`):

| Readout | acceptable | exact | under-tier | tier3 recall | tier3 precision |
| --- | --- | --- | --- | --- | --- |
| learned on rules-v2 labels | 0.77 ± 0.03 | 0.60 | 0.22 | 0.28 | 0.55 |
| old-rules tier model alone | 0.72 ± 0.03 | 0.58 | 0.28 | 0.08 | 0.51 |
| composed, cua, fires | **0.82 ± 0.02** | 0.52 | **0.13** | 0.60 | 0.39 |
| composed, cua, primary | 0.72 ± 0.03 | 0.58 | 0.28 | 0.08 | 0.51 |
| composed, laya, fires | 0.89 ± 0.02 | 0.64 | 0.09 | 0.71 | 0.55 |
| composed, laya, primary | 0.83 ± 0.02 | 0.68 | 0.17 | 0.48 | 0.74 |

Reading:

1. **Composing beats learning tier3 a second time.** With the deployable
   CUA-S1 intent scorer, acceptable precision rises from 0.77 to 0.82 and
   under-tier falls from 0.22 to 0.13. The Laya ceiling reaches 0.89 and
   0.09, which shows how much a better intent scorer would add.
2. **Use `fires`, not `primary`, with the small intent model.** It spreads
   its scores and never ranks feature or refactor first, so `primary` adds
   nothing. `fires` over-assigns tier3 (precision 0.39), which is the safe
   direction: one tier too high is acceptable, one too low is not.
3. Caveats: the rules-v2 truth is derived from Codex intent labels, while
   both intent scorers learned from Sonnet dense scores, so truth and
   predictor share the task definition but not the labeler. Thresholds are
   in-sample on validation for the intent task. The structural floor
   (cross-repo, cross-component) is not part of this text-only comparison.
