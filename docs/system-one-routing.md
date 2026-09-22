# System One routing migration

Status: experimental engineering; issue [#233](https://github.com/dyphn1/Harness-everything/issues/233).
The default router stays lexical until a Harness checkpoint passes the rollout gates.
Implement each phase in **documentation → failing tests → implementation** order.

## Phase 0: scorer contract

System One scores a complete, caller-owned candidate list in one pass. It cannot
generate a workflow, execute actions, authorize tools, or write memory. Policy and
contract assembly remain deterministic. This boundary does not add execution locks.

`createRequest(task, context, options)` returns a version-1 request. Task names and
candidate IDs use lowercase letters, digits, dots, underscores or hyphens (1–80
characters). Context is nonempty UTF-8 (at most 65,536 bytes). There are 2–256
unique `{id, text}` options; text is nonempty and at most 4,096 bytes. Empty,
malformed, unknown-field and wrong-type inputs are errors. Input objects are not
mutated. Candidate order matters. `catalogHash` is SHA-256 of JSON-encoded
`{task, options}`; `requestHash` additionally binds the exact context. Neither
fingerprint grants permission or authenticates a model.

The provider response has exactly `schemaVersion`, `requestHash`, `catalogHash`,
`model`, and `scores`. Model has nonempty `id`, `revision`, and `domain` strings.
Scores have exactly `{id, probability}` in request order. All candidates occur
exactly once; probabilities are finite numbers in [0, 1], summing to one within
1e-6. Unknown fields, stale request/catalog hashes, and version mismatches fail.

`decide(request, response, policy)` returns exactly `status`, `reason`,
`selectedId`, `confidence`, `margin`, and `model`. Status is `accepted`, `abstain`,
or `invalid-output`; nonaccepted results always have `selectedId: null`.
Policy requires a domain (default `harness-routing-v1`), minimum confidence
(default 0.9) and minimum margin (default 0.2). Invalid policy is a caller error.
Reject domain mismatch, tied winners, low confidence and low margin. A softmax
score is not calibrated correctness probability. Invalid output returns no raw
response, exception, or prompt. Identical inputs give identical decisions.

## Model suitability

The [CUA-S1-FORMS model card](https://huggingface.co/cua-ai/cua-s1-forms)
describes a form-specific option scorer, with English-centric training and short
byte contexts. These results do not establish Harness routing quality. Its
checkpoint is an experimental baseline, not a production routing checkpoint.
The [upstream source](https://github.com/trycua/cua/tree/main/libs/cua-s1)
has a source-only release description; source and checkpoint provenance/licenses
must be checked independently. Do not infer a published Python wheel or use an
unversioned download during a prompt hook.

## Planned phases

| Phase | Deliverable | Acceptance evidence |
| --- | --- | --- |
| 0 | Versioned option-scoring boundary | Complete positive/negative contract tests |
| 1 | Local CUA-S1 adapter | Bounded subprocess, artifact validation, explicit failures |
| 2 | Router integration | Off/shadow/prefer, existing policy invariants, rollback |
| 3 | Corpus and paired evaluator | Leakage checks, coverage/error metrics, repeatability |
| 4 | Harness training and rollout | Real checkpoint, reviewed holdout, measured host results |

## Rollout gates

Phase 4 requires a separately reviewed, family-disjoint holdout of at least 200
cases, at least 50 each in English and Traditional Chinese. Accepted precision
must be ≥98%, coverage ≥80%, and macro-F1 at least the lexical baseline.
Policy invariants must remain intact in every case; repeat decisions twice with
100% agreement. Record checkpoint/source hashes, CPU, OS, runtime, thread count,
cold latency and warm p95 (target ≤100ms). Synthetic fixtures and mock providers
only validate mechanisms. They cannot satisfy these model/behavior gates.
Until measured evidence passes, retain the default, fallback and this open issue.
