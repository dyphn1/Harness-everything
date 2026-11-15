---
id: E-0017
signature: training-budget-ignores-cost-shape
class: cost-shape
title: "A training batch budget counted prompt tokens only, then a size-based default bump ignored attention's quadratic cost and was killed within 60 s"
sites:
  - scripts/system-one-train.py
  - ci/system-one-train-test.py
  - "6 GB RSS guard on the training run"
violates: "Shared agent standard: \"Never claim success from reading code. Name the evidence layer: package, deterministic mechanism, live host or behaviour.\" A changed default needs a guarded measurement, not batch-size reasoning."
scope: in
status: lesson
mechanism_ref: null
episodes:
  - episode: 442-cua-s1-batch-budget-cost-shape
    feature: "#233/#442 CUA-S1 12-option intent training"
    date: 2026-11-15
    closed: true
    rounds:
      - round: 0
        change: null
        review: "live run"
        result: "The batch budget counted prompt tokens only. Per-batch cost for 12-option intent training is options × length (703 examples × 12 options × 96 option tokens per batch), so the budget undercounted it and the 6 GB RSS guard killed the run three times."
      - round: 1
        change: "Raise the default token budget to 84000 by reasoning about batch size"
        review: "live run"
        result: "1024-token batches became 4.7× larger because attention memory is quadratic in length; the run was killed within 60 s."
      - round: 2
        change: "Commit dde4e073: count option tokens in the batch budget; ff1cd93f: restore the 16384 default"
        review: "guarded live run"
        result: "Option-aware cost at 16384 gave a 2.2 GB peak; episode closed on the measured peak."
---

## Cue

A resource or batch budget for model training is set, or its default is changed, from one cost dimension, and the run dies against a memory or limit guard.

## What happened

On 2026-11-15 the CUA-S1 batch budget counted prompt tokens only. The real per-batch cost of 12-option intent training is options × length: 703 examples × 12 options × 96 option tokens per batch. The budget undercounted that, so the 6 GB RSS guard killed the run three times. The first fix raised the default budget to 84000 by reasoning about batch size, but memory is quadratic in sequence length, so 1024-token batches needed 4.7× more memory and were killed within 60 s. Restoring 16384 with an option-aware cost model gave a 2.2 GB peak.

## Lesson

Model the cost shape, not one term of it: options × length for the batch and length² for attention. Confirm a budget change with a guarded measurement at the real worst-case input before changing a default; reasoning about batch size from the code is not evidence.

## Evidence

- Commits `dde4e073` (option-aware cost) and `ff1cd93f` (16384 restored); 2.2 GB measured peak.
- #233/#442 CUA-S1; the 6 GB RSS guard.
