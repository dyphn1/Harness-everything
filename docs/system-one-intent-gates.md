# System One intent promotion gates (relevance-native)

Status: **proposed**. Decided in
[#233](https://github.com/dyphn1/Harness-everything/issues/233) (accept
relevance-native direction, keep production migration gated); evidence in
[#255](https://github.com/dyphn1/Harness-everything/issues/255). Thresholds
below are proposals: they take effect only after owner review, and the final
holdout runs **once** against the reviewed numbers. No threshold, gate, or
wording change may use the frozen holdout as feedback.

This replaces the single-winner intent gates (acceptedPrecision ≥ 0.85 at
coverage ≥ 0.8), which a 57%-precision / 66%-recall multi-label system
cannot clear by construction: owner prompts carry about 2.5 secondaries on
average, so a single-winner contract caps coverage near 6% no matter how
good the ranking is.

## Ground truth

- **Training/validation truth.** Teacher relevance scores binarized at the
  owner secondary band: intent is positive iff score ≥ 0.4
  ([system-one-intent.md](system-one-intent.md#relevance-scores)).
- **Holdout truth.** Owner-reviewed `{gold, secondary}` per case. A predicted
  set is compared as sets; graded agreement still applies where the report
  cites it, but promotion gates use the binary metrics below.

## Threshold flow (frozen)

1. Train on train rows only.
2. Fit one threshold per intent (max-F1) on validation, 2-fold CV reported.
3. Freeze thresholds, code, and this document.
4. Score the frozen holdout exactly once (two runs for repeatability).
5. Gate on the table below. A fail is a fail; re-tuning restarts at step 2
   with a documented reason, never at step 4.

## Metrics

- **micro precision / recall / F1** over all (case, intent) pairs.
- **macro F1**: mean of per-intent F1.
- **per-intent precision / recall / support** (support = holdout positives).
- **predicted cardinality**: mean fires per prompt vs gold mean.
- **abstain rate**: prompts with no intent fired.
- **exact-set-match**: all 12 decisions correct (reported, not gated).
- **weak-intent precision**: minimum precision over intents with support.
- **family consistency**: model vs gold (same definition as the old gates).
- **repeatability**: byte-identical decisions across two runs.
- **latency**: warm p50/p95 per decision batch.
- **policy evidence**: structural controls untouched (floor, fallback,
  abstain path, rollback availability).

## Proposed gates

Anchors: per-intent train-majority predicts nothing (micro-F1 0), so gates
are absolute. Reference measurement is the fine-tuned multilingual model on
validation teacher proxy (micro-F1 CV 0.60, fires 2.0 vs truth 1.8); holdout
gold is stricter, so thresholds sit below it.

| Metric | Gate | Rationale |
| --- | --- | --- |
| micro-F1 | ≥ 0.55 | CV 0.60 minus holdout strictness margin |
| macro-F1 | ≥ 0.50 | reference ≈ 0.61 |
| per-intent F1 (support ≥ 10) | ≥ 0.30 | keeps refactor-class weak spots visible, not fatal |
| weak-intent precision | ≥ 0.30 | tripwire for silent degradation |
| mean fires | within gold mean ± 1.0 | blocks spray (4+) and collapse (<1) |
| abstain rate | ≤ 0.20 | reference 0.09 |
| family consistency (model) | ≥ gold | same bar as the old gates |
| repeatability | == 1 | deterministic inference required |
| warm p95 | ≤ 100 ms | unchanged transport bar |
| structural controls | unchanged + rollback path live | migration stays shadow-compatible |

`rolloutReady` is true only when every gate passes. `policyEvidence` and
`liveHostEvidence` remain false until independently produced; they are
reported, not bypassed.

## Non-goals and invariants

- The single-winner path (contract.decide as shipped, n-gram provider,
  lexical fallback) stays live as rollback until promotion completes.
- Tier structural floor, explicit workflow constraints, action/security
  approval, and scope/memory ownership stay outside learned scoring.
- Taxonomy is frozen: 12 intents in catalog order plus abstain. Wording
  versions are recorded per artifact but never change categories.
- Private prompts never enter the public repository; public evidence holds
  aggregates, hashes, and per-intent metrics only.
