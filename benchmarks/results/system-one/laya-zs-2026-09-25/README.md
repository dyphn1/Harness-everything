# System One: Laya zero-shot dense-label baseline (2026-09-25)

Local zero-shot evidence for the intent stage
([system-one-intent.md](../../../../docs/system-one-intent.md)) with Laya as a
typed-decision substrate. It is not live-host evidence. Issue
[#255](https://github.com/dyphn1/Harness-everything/issues/233) (research
track for [#233](https://github.com/dyphn1/Harness-everything/issues/233)).
**Result: zero-shot Laya is not a teacher. Primary exact agreement with the
sonnet-scored labels is ~15% (graded ~0.26); per-intent calibration cuts score
error by ~40% but adds almost no discrimination. Fine-tuning (Phase 3) or
question rewording is required before any training use.**

## Method

- **Mapping.** Each of the 12 owner intents (catalog order, frozen) becomes one
  Laya `noul` question (`scripts/system-one-label-laya.py`, questions v1).
  Derived gold/secondary follow the owner bands mechanically and are marked
  `derived: true`; they are bootstrap, never owner truth.
- **Backends.** Official PyTorch Laya 0.3.20 on MPS and the independent MLX
  port 0.2.0 on GPU, both over the 727 validation prompts (local only).
- **Compared.** The 537 validation rows that also have sonnet-scored labels.
  [`report.json`](report.json) holds aggregates, hashes and distributions only;
  no prompt text leaves the private corpus.

## Zero-shot vs teacher (537 rows)

| Metric | torch | mlx |
| --- | --- | --- |
| Primary exact | 14.3% | 14.9% |
| Graded mean | 0.261 | 0.267 |
| Mean top score (over-confident) | 0.759 | 0.741 |
| Null rate (teacher: 14.3%) | 3.5% | 3.9% |
| zh slice exact / graded (n=495) | 13.7% / 0.259 | 14.5% / 0.266 |
| en slice exact / graded (n=42) | 21.4% / 0.286 | 19.0% / 0.276 |

Per-intent rank correlation with the teacher sits at 0.1–0.3 (best: fix/git
~0.3; worst: explain/review/docs ~0.1).

## Backend parity (same 537 rows)

Overall agreement is poor (routing 61.6%, derived gold 63.1%) **entirely
because of routing**: the MLX port sends ~250 more Chinese rows to the English
checkpoint than the official Router (torch 441 multilingual / 96 english vs
mlx 237 / 300). On the 331 rows routed to the same checkpoint, numeric parity
is excellent: mean max |Δp| 0.0055, p95 0.0134, derived-gold agreement 98.2%.
Lesson: pin the checkpoint per language for bulk labeling; do not rely on
router agreement across implementations.

## Calibration (5-fold CV, per-intent isotonic)

| Metric | torch | mlx |
| --- | --- | --- |
| CV exact | 19.4% | 22.5% |
| CV graded | 0.236 | 0.267 |
| CV MAE (raw → calibrated) | 0.323 → 0.193 | 0.304 → 0.194 |

Calibration fixes the scale but cannot create rank signal. The zero-shot +
calibration path stays far below any promotion gate.

## Reading

- **Not a teacher.** Zero-shot scores correlate weakly with owner-judged
  relevance; the bands derive mostly noise.
- **MLX is a viable fast path** once the checkpoint is pinned per language
  (98% agreement with the official backend on shared checkpoints).
- **Next levers (Phase 3).** Soft-target fine-tuning on the 3,513 scored
  train rows; question rewording as a cheap parallel lane. PRAXIST enters at
  Phase 5, after a standalone fine-tune baseline exists.
