# System One: in-process ngram tier model (2026-09-24)

This is local real-model evidence for the `ngram` transport, evaluated once on the reviewed
holdout. It is not live-host evidence. Issue
[#233](https://github.com/dyphn1/Harness-everything/issues/233); the provider is defined in
[system-one-routing.md](../../../../docs/system-one-routing.md#n-gram-provider-phase-4).
**Result: this is better than the transformer and the lexical baseline, but the 85% gate is not met, so the model is not released.**

## Model

- **Training:** `scripts/system-one-train-ngram.py` with defaults `dim` 65,536, `nmax` 3,
  square-root inverse-frequency class weights, weight decay 1e-4, 60 Adam steps and
  seed 7.
- **Labels:** 5,625 local owner prompts (4,896 train / 727 validation) with Codex labels
  under the owner's tier2/tier3 boundary. The labeler agreed with the holdout 80.5%
  ([check](../labeler-holdout-check-codex-tier3-2026-09-24/report.json)). 48 of the
  labels are owner spot-check overrides made with session context, and 2 prompts were
  excluded. The training data stays local.
- **Artifact:** `harness-routing-v1.bin` (1,048,576 bytes, SHA-256 `f43e08938dc0…`) plus a
  676-byte `.json` sidecar. There is no Python or torch at inference.

## Calibration (validation, 727)

The 85% precision target is reached at `minConfidence` 0.5 and `minMargin` 0.25, with 29.0%
coverage (211 accepted, precision 85.3%). These thresholds went into the manifest
`acceptance`.

## Holdout (215 owner-reviewed cases, one run)

[`report.json`](report.json) is the unmodified output of `scripts/evaluate-system-one.js`.

| Metric | ngram | First transformer (v1) | Lexical baseline |
| --- | --- | --- | --- |
| Raw top-1 | **47.4%** | 35.3% | 28.8% |
| Raw macro-F1 | **0.411** | 0.255 | 0.254 |
| Accepted | 43 (20.0%) | 0 | — |
| Accepted precision | **72.1%** (validation 85.3%) | — | 49.4% |
| Gated macro-F1, abstentions counted as null | 0.204 | — | 0.254 |
| Scoring p95 | **0.44 ms** in process | 59.8 ms resident | — |

Decisions broke down as 43 accepted, 163 `low-confidence`, 3 `low-margin` and 6
`unclassified` abstentions. Repeatability was 1.0.

**Gates.** `reviewedHoldout` and `repeatability` pass. `acceptedPrecision` (72.1%, gate
85%), `coverage` (20%, gate 80%) and gated `macroF1` fail.

**Gate artifacts.** Two gates fail because of how the evaluator runs:

- `warmLatency` fails because the evaluator records non-resident samples as cold. The ngram
  transport has no cold or warm phase, so the evaluator needs a transport-aware update.
- `sourceProvenance` does not apply: it checks the pinned `cua_s1` Python package, which the
  ngram transport does not use.

## Reading

- **Content, not priors.** The linear model learns from the prompt text itself, unlike the
  byte-level transformer, which fell back on class priors. Raw macro-F1 rises by 0.16 over
  both the transformer and the lexical baseline.
- **Holdout precision gap.** Accepted precision drops from 85% on validation to 72% on the
  holdout. The holdout's authored and rewritten prompts are distributed differently from
  the owner's real sessions.
- **Label noise.** The labeler agrees with the owner only about 80% of the time, which caps
  what any model trained on these labels can reach.
- **Next levers.** More owner-reviewed labels would help, especially tier1 and tier3, as
  would the staged intent and skill classifiers. Both are small and cheap to iterate with
  this transport.
