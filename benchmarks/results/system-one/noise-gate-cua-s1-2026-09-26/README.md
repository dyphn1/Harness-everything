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
