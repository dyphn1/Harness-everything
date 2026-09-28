# System One: fine-tuned Laya intent model, holdout promotion run (2026-09-25)

First Phase 3 promotion run for [#255](https://github.com/dyphn1/Harness-everything/issues/233):
multilingual Laya 322M fine-tuned with RLCD on 42,156 soft-target items
(3,513 scored train prompts), evaluated on the frozen 222-case intent
holdout through a research-only bridge (production transports untouched).
It is not live-host evidence.
**Result: the promotion gate fails. Graded accepted precision lands exactly
on the line (0.850, strict gate reads 0.8499…), coverage is 6.3% against an
80% target, and the tradeoff does not beat the intent n-gram baseline
(95.6% at 7.2%). Per the #255 stop/go rule, no PRAXIST scale-up is started
on this evidence.**

## Model

- **Base.** `convaiinnovations/laya` multilingual, revision `55cf4c4e`.
- **Training.** Single-device RLCD port of the upstream recipe (GRPO +
  soft cross-entropy, 2 epochs, local MPS fp32, ~3.1 h). Held-out
  calibration slice, per-type temperatures, fp16 artifact.
- **Bridge.** `harness-everything/scripts/system-one/laya_adapter.py`:
  fixed v1 noul questions, 13th option (unclassified) on a linear abstain
  ramp under cutoff 0.45, vector normalized to the contract simplex.
  Resident serve machinery reused from `cua_adapter`; `resident.js` and
  `provider.js` unchanged.
- **Thresholds.** `minConfidence` 0.5, `minMargin` 0, secondary 0.05 from
  `system-one-calibrate.js` on 727 validation scores (graded 0.927, exact
  0.914 at 9.6% coverage).

## Holdout (222 owner-reviewed cases, two runs each)

[`report.json`](report.json) is the unmodified evaluator output.

| Gate | Value | Target | Pass |
| --- | --- | --- | --- |
| Accepted precision, graded | 0.850 (float 0.8499…) | ≥ 0.85 | no |
| Accepted precision, exact | 0.786 | — | — |
| Coverage | 6.3% (14/222) | ≥ 0.8 | no |
| Macro-F1 vs majority baseline | 0.080 vs 0.020 | ≥ baseline | yes |
| Repeatability (2 runs) | 1.0 | == 1 | yes |
| Warm p95 | 179 ms (MPS) | ≤ 100 ms | no |
| Source provenance | research transport | pinned | no |

## Reading

- **Same profile as the n-gram, slightly worse.** The n-gram intent model
  scores 95.6% graded at 7.2% coverage; fine-tuned Laya scores 85.0% at
  6.3%. The fine-tune clearly learned (zero-shot was 14% exact), but the
  precision/coverage tradeoff does not clear the baseline.
- **Paradigm mismatch, not just weights.** Twelve independent relevance
  scores are forced into a single-winner 13-simplex; normalization crushes
  confident rows below the acceptance bar. A relevance-native router (per-
  intent thresholds instead of top-1 confidence) is a #233 contract
  question, not a #255 training question.
- **Transport notes for Phase 7.** MPS inference is deterministic across
  runs (repeatability 1.0) but too slow for the warm gate (179 ms vs
  100 ms); the MLX port measured 7–13 ms on the same class of hardware.
- **Stop/go.** STOP the scale-up path on this evidence. Legitimate next
  lanes (each frozen on validation first, never tuned on this holdout):
  question rewording, peakier contract mapping, relevance-native routing
  in #233.

## Shadow run: relevance-native gates (frozen taus, raw scores)

First evaluation under `docs/system-one-intent-gates.md` with frozen
validation-fit thresholds (never tuned on this holdout). Raw independent
scores, no simplex. `shadow-report.json` holds metrics only.

| Gate | Value | Pass |
| --- | --- | --- |
| micro-F1 | 0.507 | no (≥ 0.55) |
| macro-F1 | 0.501 | yes |
| per-intent floors | breach | no |
| weak precision | 0.181 | no |
| cardinality | 2.51 predicted | yes |
| abstain rate | 0.014 | yes |
| family consistency | model 0.47 vs gold 0.80 | no |
| repeatability | 1.0, byte-identical runs | yes |
| warm p95 | 182 ms (≤ 250 ms bar) | yes |

Verdict: not promotable under the reviewed contract. Owner gold is
stricter than the teacher proxy (validation CV micro-F1 was 0.60), and
weak intents collapse further (refactor-class precision 0.35 → 0.18).
The gates caught exactly what they were written to catch.
