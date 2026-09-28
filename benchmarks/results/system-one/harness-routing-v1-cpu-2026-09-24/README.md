# System One: first harness-routing-v1 checkpoint (2026-09-24)

This is local real-checkpoint evidence for a candidate tier checkpoint trained on the owner's
own prompts, evaluated once on the owner-reviewed holdout. It is not live-host evidence.
Issue [#233](https://github.com/dyphn1/Harness-everything/issues/233); the pipeline is in
[system-one-training.md](../../../../docs/system-one-training.md). **Result: the checkpoint is
not released.**

## Data and labels

The training data stays local and is not committed.

- **Prompts:** 5,625 from the owner's Claude Code, Codex (interactive only), Copilot CLI and
  VS Code Copilot Chat histories. That is 1,401 session families, split 4,898 train / 727
  validation, and 93% of the prompts are zh-TW.
- **Labels:** assigned under the refined rules (rules SHA-256 prefix `e153bd5ff747d6c9`).
  - 3,300 by Claude Sonnet, which agreed with the holdout at 83.7%
    ([check](../labeler-holdout-check-2026-09-24/report.json)). This run stopped when the
    Claude session limit was reached.
  - 2,325 by Codex `gpt-5.6-luna` in stateless per-batch calls, which agreed at 81.9%
    ([check](../labeler-holdout-check-codex-2026-09-24/report.json)).
- **Rejected labeling run:** two long-running Codex lane sessions were rejected. One labeled
  with a keyword regex, and the long sessions consumed most of the Codex budget.

## Training (CPU, Intel Core Ultra 5 225H, 4 torch threads)

The model is a fresh `cua_s1` `tinyx` with width 128, 2 layers, 4 heads and `context_tokens` 1024. It was trained for 12 epochs at about 6 minutes each. The best validation NLL came at epoch 7:

| Validation | Value |
| --- | --- |
| NLL | 0.911 |
| Top-1 accuracy | 65.1% |

Checkpoint SHA-256 values: weights `d0744d894eb3…`, config `c9833f3791eb…`.

## Calibration on validation (727)

| Min confidence | Coverage | Accepted precision |
| --- | --- | --- |
| 0.5 | 85.1% | 67.9% |
| 0.7 | 55.8% | 71.7% |
| 0.8 | 29.4% | 75.7% |
| 0.9 | 3.7% | 81.5% |
| 0.95 (chosen for ≥98%) | 0.1% | 100% (1 case) |

Precision never approaches 98% at useful coverage.

## Holdout (215 owner-reviewed cases, one run)

[`report.json`](report.json) is the unmodified evaluator output. It was produced with the resident transport and the calibrated `acceptance` (0.95 / 0).

| Metric | Value |
| --- | --- |
| Accepted | 0 of 215; every decision is `low-confidence` |
| Raw top-1, ignoring thresholds | 35.3% |
| Raw macro-F1 | 0.255 (the lexical baseline is 0.254) |
| tier3 predicted correctly | 0 of 51 |
| Warm p95 | 59.8 ms (the `warmLatency` gate passes) |
| Repeatability | 1.0 |

**Gates.** The `reviewedHoldout`, `repeatability`, `warmLatency` and `sourceProvenance` gates pass. The `acceptedPrecision`, `coverage`, `macroF1`, `policyEvidence` and `liveHostEvidence` gates fail. `rolloutReady` is false.

## Reading

- **Generalization gap.** Validation top-1 is 65%, which is in-distribution with the owner's
  real session prompts. On the holdout it falls to 35%. The holdout consists of authored
  prompts and de-identified rewrites with balanced classes.
- **Label skew.** The training labels are about 61% tier2. The model mostly predicts tier2 or
  unclassified and never tier3.
- **Label noise.** The labels disagree with the owner's gold roughly 16–18% of the time, which
  also caps accuracy.
- **Model capacity.** A 4-way byte-level scorer trained from scratch on about 5k noisy
  examples does not reach the rollout gates. Better class balance, more tier3 and tier1
  examples, or a pretrained multilingual encoder are the likely next levers. None of them is
  measured yet.
