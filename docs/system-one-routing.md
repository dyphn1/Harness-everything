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

## Phase 1: local provider

`provider.score(request, manifestPath)` uses a trusted host-configured manifest,
never a prompt-supplied executable. No shell or automatic download is used.
The manifest is version 1 with `python` (executable), `checkpoint` (absolute
`.safetensors` path), `weightsSha256`, `configSha256` (matching `.json` sidecar),
`modelId`, `revision`, `domain`, and optional `timeoutMs` (1–10000, default 2000).
All fields are required except the timeout; unknown fields are rejected. Hashes
must be lowercase SHA-256. Revision and domain are artifact-owner declarations,
not independently verified quality claims. The known `cua-ai/cua-s1-forms` ID
must use domain `forms-v1`. No pickle format or remote URL is accepted.

Install the optional `cua_s1` source in a dedicated Python 3.11–3.13 environment
from upstream revision `b7f7e2d8714609853a29c7d049140bc46aec0954`, using the
`libs/cua-s1/python` project. This npm package does not install Python, torch or
weights. Configure its Python executable in the manifest. Record the actual
environment and source revision in evaluation evidence; a manifest alone does
not prove which Python package was installed.

The adapter verifies both files before `load_checkpoint(..., 'cpu')`, sets one
torch thread and deterministic inference, calls the upstream collator/model,
and returns a probability for every option. It rejects context or option text
that exceeds the loaded byte limits before collation (no silent truncation).
No prompts or model values are written to disk or echoed in error messages.

The Node transport has a hard timeout and a 1 MiB stdout/stderr bound; it kills
the direct child on timeout. It starts one short-lived Python process per score
request. This is an evaluation bridge, not a warm, persistent low-latency server.
The process cannot execute actions and is not given a CUA driver. Failures return
`{status: 'unavailable', reason}` with a bounded reason code; malformed score
responses are checked by Phase 0. Transport fixtures prove IPC and failure
handling only. Real checkpoint inference and measured CPU latency remain a
separate gate, with explicit unavailable evidence if dependencies are absent.

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
