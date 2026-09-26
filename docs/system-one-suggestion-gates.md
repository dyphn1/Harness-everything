# System One suggestion gates

Status: **proposed, pending owner review**. Once the owner approves it, this
document is frozen for the next candidate of each stage. Decided in the
[#233 design correction](https://github.com/dyphn1/Harness-everything/issues/233#issuecomment-5842359628)
(one event, matched against every option); research evidence is in
[#255](https://github.com/dyphn1/Harness-everything/issues/255).

This document supersedes the table in
[system-one-intent-gates.md](system-one-intent-gates.md). That table stays
as the historical contract for the runs made under it. It also supersedes
the model-quality part of
[system-one-routing.md#rollout-gates](system-one-routing.md#rollout-gates).
`evaluate.relevanceGates` still implements the superseded table. The code
change follows this document (docs → RED → GREEN) in its own commit.

## Principle

1. **One event, scored against every option.** For a prompt, the scorer
   returns an independent relevance `p_i ∈ [0, 1]` for every option of the
   stage catalog. Scores do not sum to 1 and are never renormalized into a
   simplex. With CUA-S1 this is the per-option logit passed through a
   sigmoid. Upstream `tinyx` already encodes each option separately and
   scores it against the context, so one forward pass scores every option.
2. **Suggestions, not verdicts.** Output is advice to the agent. A wrong
   suggestion costs little; a confident wrong suggestion, or a long list the
   agent must read, costs trust and tokens. Gates therefore measure
   *trustworthy confidence* and *suggestion coverage under a noise cap*,
   not exact accuracy.
3. **Deterministic controls stay outside learned scoring.** Tier structural
   floor, explicit workflow requests, action/security approval, scope and
   memory ownership and the Rule of 3 are unchanged. Abstention always falls
   back to the lexical path.

## Readout per stage

All stages share the scoring and the calibration. Only the readout differs.

| Stage | Catalog | Readout | Cap |
| --- | --- | --- | --- |
| Tier | `tier1`, `tier2`, `tier3` | pick one: highest calibrated `p` among options at or above their threshold; none → abstain; final tier = max(pick, structural floor) | 1 |
| Workflow | the router's strategies (`direct-single`, `iterative-single`, `fable-staged`, `fable-parallel`, `fable-multi-agent-workspace`) | pick one, same rule; an explicit workflow request always wins | 1 |
| Intent | the 12 intents of [system-one-intent.md](system-one-intent.md) | set: every intent at or above its threshold, highest `p` first, truncated at the cap | 3 |
| Skills | canonical skills, scored against their descriptions | set, same rule | 3 |

The cap of 3 for set stages comes from AGENTS.md rule 10: a suggested skill
must be read before it can be dismissed, so each extra suggestion has a
reading cost. The cap is part of the readout, so noise is bounded by
construction; the gates then judge what survives the cap.

`unclassified`/`null` is not an option in the new readout. It is the
abstain outcome: no option reaches its threshold.

## Calibration and thresholds

- **Calibration.** A monotone per-option map (isotonic or Platt, chosen and
  recorded before fitting) from raw `p` to calibrated `p`, fitted on
  validation only. Needed because a model trained on soft teacher scores
  outputs a *relevance degree* (0.5 = "secondary relevance"), not a
  probability of being relevant. Gates read calibrated `p`.
- **Suggest threshold `τ_i`.** One per option, fitted on validation
  (max-F1 against the validation truth), 2-fold CV reported.
- **Confident band.** Calibrated `p ≥ 0.8`. A confident suggestion is a
  claim that at least 8 in 10 such suggestions are relevant.
- Calibration maps, thresholds, cap, band and this document are frozen
  before a holdout run. Nothing is refit after it.

## Truth

| Split | Relevant set | Primary |
| --- | --- | --- |
| Train / validation | teacher score ≥ 0.4, after owner intent overrides and exclusions | teacher primary |
| Intent holdout | owner `gold ∪ secondary` | owner `gold` |
| Tier holdout | owner `gold` tier; `null` means abstention is correct | — |

### Continuations

Some prompts cannot be tiered from their text: a go-ahead (`go`, `好`,
`完成了`), an option pick, a change verb with no object (`修正一下`),
feedback on earlier work (`還是一樣的錯誤`) or a pointer to earlier
content (`請依照需求實作`). Their tier comes from the previous turn, so the
router inherits it deterministically; the model is not asked to guess it.
The noise-gate experiment (#265) showed that tier labels assigned to such
prompts from session context are what kept a text-only model unsure.

- **Definition.** A holdout case is a continuation when the frozen rules
  (`rule_v2` in `scripts/system-one-noise-experiment.py`, #265) match its
  text. The owner reviews that list before the holdout run; the list is then
  frozen with the rest of step 4 below.
- **Scoring.** On a continuation case, the model is correct when it returns
  continuation (or abstains); any tier pick counts as an error for that case,
  whatever its gold tier. Continuation cases are excluded from the tier
  metrics (acceptablePrecision, underRate, coverage) and reported separately
  as continuation recall.
- **Size.** The rules mark 9 of 215 tier-holdout cases (6 `null`, 2 `tier1`,
  1 `tier2`) and 3 of 222 intent-holdout cases. The holdouts were built with
  most continuations removed, so they under-represent this class; the
  continuation gate below is read on validation until a reviewed
  continuation set exists.

The two intent truths differ in size: the teacher marks 1.76 relevant
intents per validation prompt, the owner 3.50 per holdout prompt (p95 6).
Recall against the whole relevant set is therefore structurally lower on
the holdout and is reported, not gated. The gated recall is **primary
hit**: whether the owner's primary intent is among the suggestions.

## Metrics

Set stages (intent, skills), over actionable prompts:

| Metric | Definition |
| --- | --- |
| suggestionCoverage | share of prompts with at least one suggestion |
| confidentCoverage | share of prompts with at least one confident suggestion |
| primaryHit | share of prompts whose primary is among the suggestions |
| suggestionPrecision | relevant suggestions / all suggestions |
| confidentPrecision | relevant confident suggestions / all confident suggestions |
| ECE | expected calibration error over all (prompt, option) pairs, 10 equal-width bins of calibrated `p` against set membership |
| Brier | mean squared error of calibrated `p` against set membership |
| per-option precision / recall / support | support = holdout prompts where the option is relevant |
| cardinality | mean and p95 suggestions per prompt, share of prompts at the cap |
| recall | relevant suggestions / relevant options (reported) |

ECE alone rewards a timid model that never says anything confident; it is
gated together with confidentCoverage, never alone.

Pick stages (tier, workflow):

| Metric | Definition |
| --- | --- |
| coverage | share of actionable prompts that get a pick |
| acceptablePrecision | picks equal to gold or one tier above it, among picks |
| underRate | picks below gold, among picks |
| exactPrecision | picks equal to gold, among picks (reported) |
| nullPickRate | picks made on `null` prompts, among `null` prompts |
| ECE / Brier | as for set stages, one-vs-rest per option |

One tier above gold is acceptable because over-routing adds process;
under-routing skips obligations, so it has its own hard gate.

Every stage also reports family consistency (same family, same top
option), repeatability, latency, artifact size and policy evidence.

## Gates

### Intent (holdout)

Anchors are validation-proxy measurements, not holdout results: the
fine-tuned Laya reference, capped at 3 with in-sample thresholds, reaches
coverage 0.97, primary hit 0.75, precision 0.63, raw-`p ≥ 0.6` precision
0.85 and ECE 0.06. Holdout truth is stricter, so bars sit below it.

| Gate | Bar |
| --- | --- |
| suggestionCoverage | ≥ 0.90 |
| primaryHit | ≥ 0.65 |
| suggestionPrecision | ≥ 0.60 |
| confidentCoverage | ≥ 0.40 |
| confidentPrecision | ≥ 0.75 (the 0.8 claim minus about two standard errors at about 250 confident suggestions) |
| ECE | ≤ 0.10 |
| per-intent precision, support ≥ 20 | ≥ 0.40 |
| family consistency (top suggestion) | ≥ 0.70 (owner gold 0.80) |

### Tier (holdout)

| Gate | Bar |
| --- | --- |
| acceptablePrecision | ≥ 0.85 (the owner's advisory bar, now counting one tier above gold) |
| underRate | ≤ 0.05 |
| coverage | ≥ 0.60 |
| nullPickRate | ≤ 0.30 |
| ECE | ≤ 0.10 |
| continuation recall (holdout continuation cases) | reported; ≥ 0.80 on validation continuations |

Tier bars have no validation anchor from a relevance-native tier model
yet. The first tier candidate reports its validation numbers first, and
these bars are confirmed or amended in this document **before** its
holdout run, never after.

### Workflow and skills

No reviewed holdout exists for these stages, so they cannot be promoted.
Before any gate applies, each needs:

- a fixed catalog document (skills: option text written for scoring; the
  current 96-byte option limit truncates skill descriptions, so the
  checkpoint's `option_tokens` must be sized for them);
- an owner-reviewed, family-disjoint holdout of at least 200 cases, at
  least 50 each in English and Traditional Chinese;
- the paired lexical baseline on that holdout.

Their gates take the shape of tier (workflow) and intent (skills). A
learned stage must also be no worse than the lexical baseline on
primaryHit/suggestionPrecision (skills) or acceptablePrecision (workflow)
in the same paired run.

### Every stage

| Gate | Bar |
| --- | --- |
| repeatability | identical scores and suggestions across two runs |
| warm p95 | ≤ 250 ms, with the host record ([latency note](system-one-intent-gates.md#latency-note)) |
| deployable artifact | CPU only, checkpoint ≤ 10 MB, installed by `npm run system-one:install` with pinned hashes |
| structural controls | unchanged, rollback path live |
| policyEvidence / liveHostEvidence | reported; required before the default changes from `shadow` |

The artifact gate encodes the #255 decision: Laya is a teacher and a
ceiling reference, never a production candidate.

## Evaluation order

1. Train on train rows only.
2. Fit calibration and thresholds on validation (2-fold CV reported).
3. **Qualify on validation.** Report every metric above against the
   validation truth. A candidate may spend a holdout run only if it meets
   the holdout bars on validation *and* passes the deployable-artifact
   gate. Otherwise it stays a validation result.
4. Freeze the checkpoint hash, calibration, thresholds, evaluator
   revision and this document.
5. Score the holdout once, with two runs for repeatability.
6. A fail is final for that candidate. A new candidate restarts at step 1
   with a recorded reason.

## Holdout budget

Every holdout run spends the holdout a little: each published result makes
later choices less independent. Each run is recorded in the evidence
directory with candidate hash, date and aggregate result.

- Intent holdout, spent before this document: n-gram intent v1,
  fine-tuned Laya (single-winner), fine-tuned Laya (relevance shadow).
- Tier holdout, spent before this document: tinyx v1 and the n-gram
  versions reported in #233, plus the lexical baseline.

Under this document, each holdout allows **one** further candidate run.
Before a second run, the owner adds at least 50 freshly reviewed cases (at
least 20 per language) that no earlier candidate or threshold saw, and the
gates are read on the enlarged holdout.

Earlier holdout results are historical. They are never re-scored under
these gates to claim a pass.

## Non-goals

- The single-winner path (`contract.decide`, n-gram provider, lexical
  fallback) stays live as rollback until a stage is promoted.
- The intent taxonomy and the owner-reviewed holdouts do not change here.
- Private prompts never enter this repository; public evidence holds
  aggregates, hashes and per-option metrics only.
