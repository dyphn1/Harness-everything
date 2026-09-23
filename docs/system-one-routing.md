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
weights. Configure its Python executable in the manifest. A manifest alone does
not prove which Python package was installed, so `provider.provenance(manifestPath)`
runs `cua_adapter.py --provenance` with the configured interpreter. The probe
reads installed metadata only (no torch import, no checkpoint load) and reports
the Python implementation/version, the distribution providing `cua_s1`, its
version, the torch version, and the source revision. Only a PEP 610
`direct_url.json` VCS `commit_id` counts as a source revision, so install from a
VCS URL pinned to that commit (not an editable or local-directory install).
The status is `pinned` when it matches, `mismatch` otherwise, or `unavailable`
when no revision is recorded. Malformed probe output is `provider-json`.

`npm run system-one:install` (or `node harness-everything/scripts/system-one/install.js`)
performs these steps on explicit request; hooks never run it. It selects a
Python 3.11–3.13 interpreter (`--python` overrides; 3.14 is rejected by upstream),
creates `<dir>/venv`, installs CPU-only torch from the PyTorch CPU index, then
installs the pinned `cua_s1` Git URL. It downloads the `cua-ai/cua-s1-forms`
safetensors weights and JSON sidecar at Hugging Face revision
`f54adbf447f4ca6ec259f529ee3f2e3e09f8cc71`, verifies pinned sizes and SHA-256
before an atomic write (the pickle `.pt` is never fetched), and writes
`<dir>/manifest.json` with `timeoutMs: 10000`, `transport: "resident"` and
`idleTimeoutMs: 1800000`. The default `<dir>` is
`~/.agents/harness-everything/system-one`; `--dir` takes an absolute path and
`--dry-run` prints the plan without changes. Acceptance requires a `pinned`
provenance probe and one real warm CPU inference through a resident server that
the installer starts and then stops; otherwise the exit code is 1. Child-process
output goes to stderr; stdout carries only the JSON report.
Torch/numpy/safetensors versions resolve at install time and are recorded by
the probe. The installer does not change the router mode: it prints
`HARNESS_SYSTEM_ONE_MODE=shadow` and the manifest path for the host
environment. This checkpoint declares domain `forms-v1`, so shadow diagnostics
report `domain-mismatch` and prefer never applies it. It also rejects context
above its 224-byte limit (`provider-exit`), so installing it proves the local
inference path only, not Harness routing quality.

The adapter verifies both files before `load_checkpoint(..., 'cpu')`, sets one
torch thread and deterministic inference, calls the upstream collator/model,
and returns a probability for every option. It rejects context or option text
that exceeds the loaded byte limits before collation (no silent truncation).
No prompts or model values are written to disk or echoed in error messages.

The Node transport has a hard timeout and a 1 MiB stdout/stderr bound; it kills
the direct child on timeout. It starts one short-lived Python process per score
request. This is the default `oneshot` transport, not a warm server; see the
resident provider below.
The process cannot execute actions and is not given a CUA driver. Failures return
`{status: 'unavailable', reason}` with a bounded reason code; malformed score
responses are checked by Phase 0. Transport fixtures prove IPC and failure
handling only. Real checkpoint inference and measured CPU latency remain a
separate gate, with explicit unavailable evidence if dependencies are absent.

## Resident provider (Phase 4 prerequisite)

The one-shot bridge pays Python start, `import torch` and checkpoint load on every
call (measured ≈5 s on CPU); warm in-process inference is a few milliseconds. The
manifest may set `transport: "resident"` (default `"oneshot"`) and optional
`idleTimeoutMs` (60000–14400000, default 1800000) to keep one verified model in
memory. Other manifest rules are unchanged; the timeout remains one-shot only.

**Lifecycle.** A resident-mode score never blocks on model loading. If no live
server exists, the Node provider creates a start lock with exclusive-create,
spawns `cua_adapter.py --serve` detached with the configured Python (no shell),
and returns `unavailable/provider-starting`, so the lexical route is used for
that prompt. Concurrent callers seeing a lock younger than 60 s do not spawn
again. The server verifies artifact hashes before `load_checkpoint`, writes its
state file atomically, then removes the lock. A startup failure writes a bounded
reason into the lock and exits; callers report `provider-unavailable` without
respawning until the lock is 60 s old. An executable that cannot be spawned at
all is detected synchronously (no child PID) and recorded as `spawn-failed` the
same way. The server exits after `idleTimeoutMs` without requests, on
`shutdown`, when either checkpoint file's size or modification time changes
(`artifact-changed`), or as soon as its state file no longer names its PID and
token (replaced, corrupted or deleted), so an undiscoverable server never
lingers as an orphan. It deletes only a state file that still names it.

**Files.** State and lock live beside the manifest as
`system-one-resident-<digest>.json` / `.starting`, where `<digest>` is the first
16 hex digits of SHA-256 of the parsed manifest re-serialized with `JSON.stringify`
(file key order). Editing the manifest
therefore selects a new server; the old one exits when idle. The state file has
exactly `schemaVersion: 1`, `pid`, `port`, `token` (64 hex), and `startedAt`, and
is created with mode 0600; on Windows the file instead receives an explicit
DACL with inheritance removed and a single full-control entry for the current
user's SID before the token is written. The manifest directory must still be
writable only by that user: whoever can replace files there can redirect the
client, and whoever can edit the manifest chooses the executable.

**Protocol.** The server binds only `127.0.0.1` on an ephemeral port and handles
one request per connection: one newline-terminated JSON object of at most 2 MiB
with `token`, `op` (`score`, `ping`, `shutdown`) and, for `score`, a request with
the exact Phase 0 structure (fields, lowercase IDs, unique options, 2–256
options, 64-hex fingerprints). Connections are served concurrently, up to 64, each
with a 1 s read deadline; beyond that the reply is `busy`. Inference itself is
serialized, so a silent or slow client cannot delay other callers. Tokens are compared in constant time; a mismatch returns
`{ok: false, reason: "unauthorized"}`. `score` applies the same byte limits
(no truncation) and returns `{ok: true, response}` in the Phase 0 response
format, which Phase 0 validation still checks. Any other failure returns
`{ok: false, reason}` with a bounded code; no prompt, traceback, path or score is
echoed in errors. The server never executes actions and is not given a driver.

**Client.** The router API is synchronous, so the client performs one socket
round trip on a worker thread and waits with `Atomics.wait` (1000 ms deadline).
Results map to the existing reasons: timeout → `provider-timeout` (no respawn);
refused connection or dead PID → stale state removed and a new start
(`provider-starting`); `unauthorized` → `provider-unavailable`; any other
server-declined request → `provider-exit`; malformed replies → `provider-json`.

**Operators.** `node harness-everything/scripts/system-one/resident.js
start|status|stop <absolute manifest>` controls a server explicitly; `start`
waits up to 60 s for readiness. The evaluation CLI waits for readiness before
measuring, so resident runs are recorded with `coldStart: false`. The installer
writes `transport: "resident"`, verifies one resident score, and stops the server
it started. Repository tests use a stub scorer behind the real server/protocol
code; they prove the mechanism, not host survival of detached processes or model
quality. Those require retained evidence.

## Phase 2: tier integration and rollback

Set `HARNESS_SYSTEM_ONE_MODE=off|shadow|prefer` in the host environment. Default
is `off`: no provider process, diagnostic, or contract change. Supply an absolute
`HARNESS_SYSTEM_ONE_CONFIG` path to the Phase 1 manifest for the other modes.
An unknown mode reports `invalid-mode` and leaves the lexical result unchanged.
Shadow records the decision but never changes the route. Prefer replaces only
the recommended tier when a valid `harness-routing-v1` result passes Phase 0
thresholds. The full fixed tier catalog (tier1, tier2, tier3, unclassified) is
always scored; it is never filtered using lexical matches. `unclassified` means
abstention and keeps the existing route. Explicit strategy/model requests keep
precedence and prevent model tier replacement. Set mode back to `off` to roll back.

Prefer can raise a tier but never lower it below the deterministic structural
floor: a macro-scope signal sets floor `tier3`, and multi-task, multi-sentence
structure (other than a trivial docs edit) sets floor `tier2`. An accepted result
below the floor is not applied and reports `structural-floor`, so repository-wide
work keeps its Tier 3 strategy, independent verification and worktree
invariants. Tier-3 keywords are lexical guesses, not structural floors. The
policy assembler still consumes the original structural and risk signals.
Safety, explicit prohibitions, memory ownership, and verification are not model
outputs. This phase does not yet replace guide matching, dynamic
skill triggers, fact-audit reminders, or the structural workflow signals.
The same scorer API can evaluate caller-supplied text options; additional routing
surfaces require their own catalog and held-out evidence before integration.

When enabled, a single `SYSTEM ONE` JSON diagnostic reports mode, status, reason,
selected candidate, model identity, confidence and margin; it omits prompt text,
score vectors and artifact paths. The existing router contract schema is unchanged.
Kernel/packaged entry points inherit these host environment variables. Prompts
and hook payload fields cannot set model configuration or launch executables.
Claude Code settings `env` is hot-reloaded and reaches hooks and every command
the agent runs; Codex hooks inherit the `codex` process environment, so a Codex
started from an ordinary terminal needs user/OS-level variables (which then apply
to every program the user starts). The recommended setting is `off` until a
`harness-routing-v1` checkpoint passes the rollout gates.
Repository tests establish mechanism/package evidence only; actual host loading
and semantic quality remain unverified until retained sessions demonstrate them.

## Phase 3: corpus and paired evaluation

Use `node scripts/evaluate-system-one.js corpus.json /absolute/manifest.json report.json`.
The corpus is `{schemaVersion: 1, cases: [...]}`. Each case has exactly `id`,
`family`, `split` (`train|validation|holdout`), `language` (`en|zh-TW`), `source`
(human-reviewed provenance, not baseline-generated gold), `reviewed` (boolean),
`request` (Phase 0 tier request), and `gold` (candidate ID, or null for abstention).
The complete fixed tier catalog must match. IDs and request hashes are unique;
no family may span splits. Evaluation uses only holdout, never training labels.
The committed seed corpus is a mechanism fixture, not an independently reviewed
holdout. Expand and review it separately before making quality claims.

The CLI runs the real lexical baseline and the configured provider twice per
holdout case. Records contain IDs, baseline prediction, decision, model identity,
the catalog-order probability vector (`scores`; null for unavailable or invalid
output), latency, and `coldStart: true`; they do not copy prompts into the
report. A scored run's confidence and margin must match its vector. Gold
`unclassified` is represented by null. Nonaccepted model results also predict
null. The evaluator rejects missing, duplicate or unknown cases, unsupported
predictions, malformed measurements, and inconsistent model identities. Reruns
compare the full decision, model identity and score vector, but not measured
latency: equal top-2 values with a reordered tail still disagree.
No normalization is permitted for candidate IDs or model revision.

Report both baseline and model accuracy/macro-F1, model coverage, accepted
precision/error rate, abstention, repeated-decision agreement, and separate
cold/warm p95. Zero accepted decisions has null precision and never passes.
Unavailable responses remain abstentions and count against coverage. Null gold
is included in macro-F1's class set; the four catalog labels are always included
even when unobserved, preventing favorable per-run class selection.

The evaluator emits explicit rollout checks, not an automatic deployment. It
requires reviewed holdout counts, semantic/coverage thresholds, repeatability,
warm measurements, a `pinned` source revision, plus independently retained
policy and live-host evidence. The report's `evidence.source` keeps the probe
result (including `mismatch` or `unavailable`) and `environment.python`.
The latter evidence is not supplied by this offline runner, so it always reports
those gates pending. With the one-shot adapter, all latency is cold and the warm
gate also remains pending. Exporting a report never changes router defaults.

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
