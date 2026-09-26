# System One Laya weak-intent training contract

This document defines the training-data semantics used by the #255 weak-intent experiment.

## Intent-level oversampling

`system-one-export-laya.py --oversample intent:factor` is an **intent-item** intervention.

For a prompt whose teacher score for the selected intent is at least `0.4`:

- only that `promptId + intent` training item is repeated to the requested factor;
- sibling intents from the same prompt are emitted once;
- prompts below the positive threshold are not repeated;
- the manifest records the requested oversample map.

Example: `--oversample refactor:3` emits three copies of the positive `refactor` item, but still emits one copy each of `review`, `explain`, and every other sibling intent.

This distinction is required so a weak-intent intervention does not silently reweight neighboring intents.

## Calibration isolation

The trainer calibration split is **prompt-group disjoint**.

- All items sharing one `promptId` must stay on the same side of the train/calibration boundary.
- Calibration uses one copy of each `promptId + intent` identity.
- Oversampled duplicates are retained only for prompt groups assigned to training.
- Oversampling therefore cannot create an exact duplicate in both training and calibration, and it cannot overweight temperature fitting.
- Items without `promptId` retain the legacy per-item deterministic split behavior for unit-level callers.

The calibration selection remains deterministic for a fixed seed and continues to respect the configured fraction and `CALIB_MAX` target over the de-duplicated base identities.

## Loss weights

`system-one-train-laya.py --intent-weights '{"refactor": 2.0}'` applies a per-sample multiplier to both RL and CE losses for the named intent. Unlisted intents remain at weight `1.0`. Weights must be finite and greater than zero.

## Evidence rule

Results produced before these isolation rules were enforced must not be used as causal evidence for neighbor-intent regressions without re-running the experiment. In particular, prompt-level duplication and train/calibration duplicate leakage confound interpretation of an intent-specific intervention.
