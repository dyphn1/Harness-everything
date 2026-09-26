# Noise gate on CUA-S1: curriculum vs all-at-once (2026-09-26)

Two runs: rules v1 (`report-rules-v1.json`) and rules v2
(`report-rules-v2.json`, `--rules 2`). Same model, schedule and seed.

Validation-only experiment for #233. It asks whether a CUA-S1 `tinyx`
scorer can tell from the text alone that a prompt is **unclassifiable**:
a continuation that needs the previous turn (`go`, `好`, `完成了`, an option
pick) or a message with no request (pastes, host markers, chatter). The
target is a confident split, not a correct tier. The holdout was not read.

- Script: `scripts/system-one-noise-experiment.py`; rule and metric tests in
  `ci/system-one-noise-experiment-test.py`.
- Data: private corpus (`harness-system-one-data` `main` at `f4d1a78`), tier
  labels plus owner overrides, owner exclusions removed.
- Model: `tinyx`, width 128, 2 layers, context 1024 bytes, three independent
  sigmoid options (actionable, continuation, no-request), masked BCE.
- Host: Mac (Apple silicon), CPU, 8 threads, torch 2.14, `cua_s1` `b7f7e2d8`.
  One seed; no repeat runs.

## Label buckets

| Bucket | Meaning | Train | Validation |
| --- | --- | --- | --- |
| rule-continuation | high-precision rule: go-ahead, approval, pick, bare identifier | 89 | 11 |
| rule-no-request | high-precision rule: host markers, chatter, pasted output without a request line | 39 | 8 |
| tier-long | tier label, at least 20 characters, no rule hit | 3,604 | 553 |
| tier-short | tier label, under 20 characters, no rule hit | 632 | 90 |
| null-unruled | labeler said `null`, no rule decides the subtype (subtype masked) | 530 | 65 |

Seeds are the first three buckets. The curriculum trains on seeds (6
epochs), then adds the remaining rows in three stages ordered by how well
the model already agrees with their labels (3 epochs each). The control
trains all rows from scratch for the same 15 epochs.

## Rules v1 results (validation, 727 rows, 84 unclassifiable)

"Confident" means a noise score (1 − p(actionable)) of at least 0.8 for
unclassifiable rows, or p(actionable) of at least 0.8 for actionable rows.

| Round | AUROC all | AUROC ambiguous | confident noise | confident continuation (rule rows) | confident actionable |
| --- | --- | --- | --- | --- | --- |
| R0 seeds | 0.740 | 0.41 | 0.23 | 0.82 | 0.97 |
| R1 + 1/3 | 0.749 | 0.41 | 0.30 | 0.91 | 0.95 |
| R2 + 2/3 | 0.735 | 0.52 | 0.07 | 0.00 | 0.99 |
| R3 all | 0.641 | 0.63 | 0.08 | 0.00 | 0.98 |
| control | 0.771 | 0.48 | 0.26 | 0.55 | 0.88 |

On the seed rows alone, AUROC is 0.99 (R0) and 0.98 (R1).

## Reading

1. **Rule-defined continuations are learnable with confidence.** On seed
   rows the split is nearly perfect, and after R1, 91% of validation
   continuations score at or above 0.8.
2. **The ambiguous rows are not separable from text as labeled.** Between
   `null-unruled` and `tier-short`, AUROC stays near chance (0.41–0.63). The
   labeler marked text-alike prompts both ways: follow-up feedback such as
   "still the same error" is `null` in one row and a tier in another,
   because it judged with session context the model never sees.
3. **Mixing them back destroys the confidence the seeds built.** Once those
   rows enter (R2), confident continuations drop from 0.91 to 0.00. The
   curriculum does not fix contradictory targets; it only delays them.
4. The best checkpoint here is R1: seeds plus the rows the model already
   agrees with. It is a research result, not a candidate: the rule rows in
   validation are few (19), and there is one seed.

## Rules v2: relabel what the text cannot tier

The owner chose to widen the rules instead of hand-relabeling. v2 also
marks as continuation three shapes whose tier the text alone cannot
decide: a change verb with no concrete object (`修正一下`, `優化這段`),
feedback on earlier work (`還是一樣的錯誤`, `少了 SRE`), and a pointer to
earlier content (`請依照需求實作`). Questions are excluded. This moves 108
rows (91 train, 17 validation) to continuation; 84 of them had carried a
tier label that the labeler assigned from session context.

Validation truth changes with the rules (28 continuation rows instead of
11), so v2 numbers compare rounds and the control within v2, not with v1.

| Round | AUROC all | AUROC seeds | confident continuation | confident no-request | confident actionable (long) |
| --- | --- | --- | --- | --- | --- |
| R0 seeds | 0.746 | 0.92 | 0.25 | 0.50 | 1.00 |
| R1 + 1/3 | 0.785 | 0.97 | 0.71 | 0.50 | 0.99 |
| R2 + 2/3 | 0.789 | 0.97 | 0.04 | 0.62 | 0.99 |
| R3 all | 0.796 | 0.97 | 0.71 | 0.75 | 0.94 |
| control | 0.807 | 0.92 | 0.43 | 0.75 | 0.90 |

Overall confident noise at the end: 0.41 (curriculum) and 0.38 (control),
against 0.08 and 0.26 under v1.

## Reading (v2)

1. **Relabeling, not scheduling, restored confidence.** Mixing every row
   back no longer erases the continuation class: the final curriculum model
   keeps 71% of continuations at ≥ 0.8 (v1: 0%).
2. **The curriculum beats the control on confidence, not on ranking.**
   AUROC is about the same (0.80 vs 0.81); the curriculum is more confident
   on continuations (0.71 vs 0.43) and on long actionable prompts (0.94 vs
   0.90).
3. **It is not stable yet.** R2 dips to 0.04 before R3 recovers, with one
   seed; repeat seeds are needed before reading the schedule as a win.
4. **A residue remains.** The rows the rules still leave to the labeler
   (`null-unruled` against `tier-short`) rank below chance (AUROC 0.27–0.49):
   the labeler's context-based choices still disagree with the text.

This supports the owner's reading that much of the earlier "noise" was the
labeler's own prior judgement from session context, not ambiguity in the
text.

## Ten stages (owner request)

Same rules v2, model and seed; ambiguous rows added in 10 stages instead of
3. Two schedules: 1 epoch per stage (16 epochs total, close to the 3-stage
run) and 3 epochs per stage (36 total). Each control trains the same total
epochs from scratch. Reports: `report-rules-v2-stages10-e1.json`,
`report-rules-v2-stages10-e3.json`.

| Run | AUROC end | confident continuation end | confident noise end | control: confident continuation | control: confident noise |
| --- | --- | --- | --- | --- | --- |
| 3 stages × 3 epochs | 0.796 | 0.71 | 0.41 | 0.43 | 0.38 |
| 10 stages × 1 epoch | 0.76 | 0.32 | 0.19 | 0.11 | 0.11 |
| 10 stages × 3 epochs | 0.79 | 0.57 | 0.36 | 0.21 | 0.17 |

Across the ten stages, confident continuation swings between neighbouring
checkpoints: 0.04 to 0.71 (1 epoch per stage) and 0.07 to 0.71 (3 epochs
per stage), while AUROC stays within 0.67–0.79.

## Reading (ten stages)

1. **More stages did not help.** Ten stages end below three (0.57 and 0.32
   against 0.71) and swing more along the way.
2. **The confident rate is unstable, the ranking is not.** Continuation
   scores sit near the 0.8 line, so a small update moves many rows across
   it. The controls show the same: 0.43, 0.11 and 0.21 for 15, 16 and 36
   epochs. A single checkpoint's confident rate is not a reliable number.
3. **Direction is consistent.** In all three pairs the curriculum ends more
   confident on continuations than its control (0.71/0.43, 0.32/0.11,
   0.57/0.21), with the same AUROC. That is 3 of 3 with one seed, so it is
   a direction, not a measured effect.

## Invalid class, five seeds

Owner decision: the small model sees only the current prompt, so
continuations and no-request messages merge into one `invalid` class that
is handed to the host agent (`--merge-invalid`: two options, every row
fully labeled). Rules v2, 3 stages × 3 epochs, seeds 0–4. Reports:
`report-invalid-seed{0..4}.json`. Mean ± standard deviation over the five
seeds on validation:

| Model | AUROC | confident invalid | mean invalid score on invalid rows | confident actionable | invalid precision / recall at 0.5 |
| --- | --- | --- | --- | --- | --- |
| curriculum R1 | 0.758 ± 0.010 | 0.26 ± 0.10 | 0.30 ± 0.11 | 0.94 ± 0.05 | 0.59 / 0.30 |
| curriculum end (R3) | 0.785 ± 0.020 | 0.18 ± 0.05 | 0.33 ± 0.07 | 0.90 ± 0.04 | 0.64 / 0.28 |
| control | 0.783 ± 0.015 | 0.29 ± 0.06 | 0.42 ± 0.05 | 0.84 ± 0.05 | 0.45 / 0.40 |

Paired by seed, the curriculum end is less confident on invalid rows than
its control in 4 of 5 seeds (confident invalid −0.17 to +0.05) and more
confident on actionable rows; AUROC differs by at most ±0.03.

## Reading (five seeds)

1. **The curriculum advantage did not replicate.** With seeds, the
   curriculum and the control rank equally well (AUROC 0.785 vs 0.783). The
   curriculum only moves the operating point toward "actionable": more
   confident on actionable prompts, less on invalid ones. The earlier 3 of 3
   was one seed on the three-option task and does not hold here.
2. **Invalid detection is capped at about 0.78 AUROC by labels, not the
   schedule.** Rule-defined rows are separable; the labeler's other `null`
   rows get a mean invalid score of 0.15–0.30 (per model, averaged over seeds), because many of them read as
   ordinary requests in isolation.
3. Caveat: this run changed the task (two merged options) and added seeds at
   the same time; the three-option task was not re-run with five seeds.
