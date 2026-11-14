# System One routing migration

Status: experimental engineering; issue [#233](https://github.com/dyphn1/Harness-everything/issues/233).
The default mode stays `off`. `live` is opt-in for machines with an activated private checkpoint; recorded gate values are baselines and do not block that opt-in.
Implement each phase in **documentation → failing tests → implementation** order.

## Phase 0: scorer contract

For each stage, System One scores the complete, caller-owned candidate list in one pass. It cannot
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
exactly once; probabilities are finite independent values in [0, 1] and do not
sum to one. Unknown fields, stale request/catalog hashes, and version mismatches fail.

`decide(request, response, policy)` returns exactly `status`, `reason`,
`selectedId`, `confidence`, `margin`, and `model`. Status is `accepted`, `abstain`,
or `invalid-output`; nonaccepted results always have `selectedId: null`.
Policy requires a domain (default `harness-routing-v1`), minimum confidence
(default 0.9) and minimum margin (default 0.2). Invalid policy is a caller error.
The legacy `decide` path rejects domain mismatch, tied winners, low confidence
and low margin. Live stages use their own calibrated per-option thresholds.
Probabilities are reference confidence, not correctness guarantees. Invalid
output returns no raw response, exception, or prompt. Identical inputs give
identical decisions.

## Phase 1: local provider

`provider.score(request, manifestPath)` uses a trusted host-configured manifest,
never a prompt-supplied executable. No shell or automatic download is used.
The manifest is version 1 with `python` (executable), `checkpoint` (absolute
`.safetensors` path), `weightsSha256`, `configSha256` (matching `.json` sidecar),
`modelId`, `revision`, `domain`, and optional `timeoutMs` (1–10000, default 2000).
All fields are required except the timeout; unknown fields are rejected. An
optional `acceptance` object holds `minConfidence` (0.5–0.99) and
`minMargin` (0–0.9). It may also hold `secondaryThreshold` (0.05–0.5), the
probability at which another intent counts as a secondary intent; that key is
valid only for an intent checkpoint ([system-one-intent.md](system-one-intent.md#scoring)).
These are the thresholds calibrated on validation for this
checkpoint. A scored result carries them, and the router and the evaluator pass
the first two to `decide`. Without the field the Phase 0 defaults apply. For an
intent corpus the evaluator also reports graded accepted precision, exact accepted
precision and family consistency. The `acceptedPrecision` gate uses the graded
value. Hashes
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

Install a private checkpoint from a local data-repository checkout or its Git
SSH URL. The checkout must contain
`models/cua-s1/<id>/manifest.json` with validity, intent and tier stages:

```sh
node harness-everything/scripts/system-one/install.js install \
  --from /path/to/private-data-repo --version <id>
node harness-everything/scripts/system-one/install.js install \
  --from git@host:private/data-repo.git --version <id>
```

The SSH path uses a shallow sparse clone of the requested checkpoint in a
temporary cache directory; SSH credentials must come from the local SSH
configuration, not the URL. The installer verifies each stage's `sha256`, then
copies the manifest, weights, configs and optional evaluation file to
`~/.agents/harness-everything/system-one/versions/<id>/`. It also creates the
dedicated Python 3.11–3.13 virtual environment, installs CPU-only torch and the
pinned `cua_s1` source. `--python` selects the interpreter, `--dir` selects an
absolute install directory, and `--dry-run` prints the plan without changes.
The default directory is `~/.agents/harness-everything/system-one`; set
`HARNESS_SYSTEM_ONE_HOME` to override it.

Installation does not activate a checkpoint. Run
`node harness-everything/scripts/system-one/install.js activate <id>` to switch
the atomic `active.json` pointer; it records the prior version for
`rollback`. `status` reports active and previous versions, verifies their
checkpoint hashes, and prints the `HARNESS_SYSTEM_ONE_MODE=live` opt-in hint.
The router remains off by default; set `HARNESS_SYSTEM_ONE_MODE=live` only on
machines where System One is opted in. The public plugin contains the installer
code but no private weights.

The adapter verifies both files before `load_checkpoint(..., 'cpu')`, sets one
torch thread and deterministic inference, calls the upstream collator/model,
and applies a sigmoid independently to each option logit. It rejects context
or option text that exceeds the loaded byte limits before collation (no silent
truncation).
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

## N-gram provider (Phase 4)

`transport: "ngram"` scores in the Node process itself. It needs no Python, no
torch, no resident server and no subprocess. It exists because a byte-level
transformer trained from scratch learned little beyond class priors on the
owner's data. A linear model over character n-grams learned more from the same
labels at about 1 MB. See
[harness-routing-v1-cpu-2026-09-24](../benchmarks/results/system-one/harness-routing-v1-cpu-2026-09-24/README.md).

**Artifact.** The manifest `checkpoint` is an absolute path to `<name>.bin`, and
`weightsSha256` is that file's hash. A `<name>.json` sidecar beside it has the
hash `configSha256`. `python` is not required for this transport. The sidecar
holds exactly:

| Field | Value |
| --- | --- |
| `format` | `harness-ngram` |
| `formatVersion` | `1` |
| `dim` | Feature buckets, a power of two between 2^10 and 2^20 |
| `nmax` | Longest n-gram, 1–4 |
| `hash` | `fnv1a32` |
| `catalog` | The option IDs in catalog order |
| `bias` | One number per option |
| `metadata` | An object with training provenance |

`.bin` holds `dim × catalog.length` little-endian float32 weights in row-major
order (feature, then option), so its size must equal `dim × options × 4` bytes.
Both files are hash-checked before use. Any mismatch in hash, shape or field
returns `provider-config` and never scores.

**Features.** Featurization is identical in the trainer and the provider, and a
cross-language test proves it.

1. Lowercase the text and join its whitespace-separated parts with one space.
2. For each n from 1 to `nmax`, take every n-gram of Unicode code points that is
   not only spaces. Add it to bucket `fnv1a32("<n>:<gram>" as UTF-8) mod dim`.
3. Add one length feature, bucket `fnv1a32("len:<k>") mod dim`, where
   `k = min(8, floor(log2(utf8Bytes + 1)))`.
4. Weight each bucket as `log(1 + count)` and L2-normalize the vector.

**Scoring.** The probabilities are `softmax(x·W + bias)` in catalog order. The
request's option IDs must equal `catalog`, or the result is `provider-config`.
The response has the Phase 0 shape, and the manifest `acceptance` thresholds
apply as for any transport. The Phase 0 context limit (64 KiB) is the only
length limit.

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

**Client.** The hook entry pre-scores asynchronously. When `tier-router.js` runs
as a script (the kernel and packaged hooks spawn it) in `shadow` or `prefer`
mode, it builds the fixed-catalog tier request before routing and makes one
direct async loopback round trip (`scoreAsync`), with no worker thread. Start,
lock, stale-state, deadline (1000 ms) and reply-limit (1 MiB) rules are the same
as the synchronous path. The router uses the pre-scored result only when its
request hash equals the request the router builds; otherwise it scores
synchronously. A pre-score error is reported exactly as a synchronous scorer
error would be. In `off` mode the entry neither pre-scores nor contacts a
provider. The synchronous `score` API remains for programmatic callers: it
makes the same round trip on a worker thread and waits with `Atomics.wait`.
Starting that worker costs 29–41 ms per call on the reference host, which is why
the hook avoids it. The paired measurements are in
[cua-s1-forms-resident-async-cpu-2026-09-23](../benchmarks/results/system-one/cua-s1-forms-resident-async-cpu-2026-09-23/README.md).
Both paths map results to the existing reasons: timeout → `provider-timeout` (no respawn);
refused connection or dead PID → stale state removed and a new start
(`provider-starting`); `unauthorized` → `provider-unavailable`; any other
server-declined request → `provider-exit`; malformed replies → `provider-json`.

**Operators.** `node harness-everything/scripts/system-one/resident.js
start|status|stop <absolute manifest>` controls a server explicitly; `start`
waits up to 60 s for readiness. The evaluation CLI waits for readiness before
measuring, so resident runs are recorded with `coldStart: false`. It times
`scoreAsync`, the path the hook uses, so `warmLatency` measures what a prompt
actually pays. The installer
writes `transport: "resident"`, verifies one resident score, and stops the server
it started. Repository tests use a stub scorer behind the real server/protocol
code; they prove the mechanism, not host survival of detached processes or model
quality. Those require retained evidence.

## Phase 2: compatibility modes and staged live routing

`HARNESS_SYSTEM_ONE_MODE=off` remains the default. Off starts no provider, emits
no System One text or workflow field, and preserves the lexical route byte for
byte. The older `shadow` and `prefer` single-tier modes remain for compatibility
and use an absolute `HARNESS_SYSTEM_ONE_CONFIG` manifest path. `live` reads the
active version pointer described below; it does not use that legacy manifest.
Set the mode back to `off` to roll back. Unknown modes keep the lexical result.

Live reads `~/.agents/harness-everything/system-one/active.json`; tests can point
`HARNESS_SYSTEM_ONE_HOME` at another System One home. The pointer has exactly
`schemaVersion`, `version`, `dir`, `previous`, and `activatedAt`. Its version
directory contains `manifest.json` with `schemaVersion`, `version`, `createdAt`,
`stages`, and `evaluation`. `stages` contains `validity`, `intent`, and `tier`;
each entry names sibling `weights` and `config` files, the weights `sha256`, its
ordered `options`, and per-option `thresholds`. The router verifies the weight
hash and the CUA-S1 adapter verifies the checkpoint/config pair before loading.
The workflow hash is the first 16 hex digits of the tier weights hash. A single
resident process loads all three checkpoints from that version. The public plugin
contains the loading and training method, not private weights.

Live scores the prompt text in order: validity, then intent and tier only when
validity is actionable. An invalid result stops later scoring. `p(invalid)` at
or above its threshold marks the prompt invalid. Each option keeps its own
sigmoid probability. Intent suggestions include options at or above their
thresholds, sorted by probability and capped at three. The highest-scoring tier
is returned only when it meets that tier's own threshold; otherwise the tier
stage abstains. A tie at the top also abstains.

Precedence is structural floor and explicit user/workflow choices, then System
One, then lexical tier when System One abstains, is invalid or unavailable, or
mode is off. The structural floor can only raise the route. Existing safety,
explicit prohibitions, memory ownership, and verification remain deterministic.

When a valid active version is available, `workflowPlan.systemOne` records the
fixed version, weight hash, mode, raw stage probabilities, and thresholded
decision. Unscored stages are `null`. When System One has no active version, the
field is omitted. User-visible routing text labels the highest stage options
with their probabilities as reference confidence, never as a verdict; it does
not print prompt text or artifact paths. Checkpoint activation is opt-in and the
default mode remains `off`.

The live field has exactly this shape; probability maps contain independent
values in `[0, 1]` and omit `unclassified`:

```json
{
  "version": "<active version id>",
  "sha256": "<first 16 hex digits of tier weights hash>",
  "mode": "live",
  "validity": { "invalid": 0.12 },
  "intents": {
    "explain": 0.1, "discuss": 0.12, "git": 0.1, "fix": 0.81,
    "edit": 0.2, "feature": 0.54, "refactor": 0.1, "review": 0.1,
    "test": 0.1, "docs": 0.14, "plan": 0.1, "investigate": 0.1
  },
  "tier": { "tier1": 0.1, "tier2": 0.84, "tier3": 0.62 },
  "decision": { "validity": "actionable", "intents": ["fix"], "tier": "tier2" }
}
```

`decision.validity` is `actionable`, `invalid`, or `abstain`. `decision.intents`
contains up to three above-threshold IDs in probability order. `decision.tier` is
the unique highest above-threshold tier or `null` when the tier stage abstains.

Kernel and packaged entry points inherit host environment variables. Prompts
and hook payload fields cannot set model configuration or launch executables.
Claude Code settings `env` is hot-reloaded and reaches hooks and every command
the agent runs; Codex hooks inherit the `codex` process environment. Repository
tests establish mechanism and package evidence only; live host loading and
behavioral quality require retained host evidence.

## Phase 3: corpus and paired evaluation

Use `node scripts/evaluate-system-one.js corpus.json /absolute/manifest.json report.json`.
The corpus is `{schemaVersion: 1, cases: [...]}`. Each case has exactly `id`,
`family`, `split` (`train|validation|holdout`), `language` (`en|zh-TW`), `source`
(human-reviewed provenance, not baseline-generated gold), `reviewed` (boolean),
`request` (Phase 0 tier request), and `gold` (candidate ID, or null for abstention).
The complete fixed tier catalog must match. IDs and request hashes are unique;
no family may span splits. Evaluation uses only holdout, never training labels.
The committed seed corpus is a mechanism fixture, not an independently reviewed
holdout. The reviewed holdout is written, labeled and assembled as described in
[system-one-corpus.md](system-one-corpus.md).

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

For the `ngram` transport, samples are recorded with `coldStart: false`, because
scoring happens in process. The evaluator loads and verifies the artifact once
before any timed sample, so that load is not part of the warm latency. The
source check does not run the Python `cua_s1` probe, which this transport does
not use. It records `{status: "recorded", transport: "ngram", artifactVerified}`,
where `artifactVerified` is true only when both artifact files load and match
their SHA-256 values. For this transport, the `sourceProvenance` gate passes
when `artifactVerified` is true.

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
| 2 | Router integration | Off/shadow/prefer/live, active pointer, precedence, rollback |
| 3 | Corpus and paired evaluator | Leakage checks, coverage/error metrics, repeatability |
| 4 | Harness training and rollout | Real checkpoint, reviewed holdout, measured host results |

Phase 4 training data, labeling, calibration and release are defined in
[system-one-training.md](system-one-training.md).

## Staged classification

Live routing scores three fixed catalogs in order. Validity is `actionable` or
`invalid`; the intent catalog contains the twelve work intents plus
`unclassified`; and the tier catalog contains `tier1`, `tier2`, `tier3` plus
`unclassified`. `unclassified` is an abstention option and is not included in
the output probability maps.

Invalid prompts receive no intent or tier suggestion. For actionable prompts,
all intent options are scored independently and up to three above-threshold
suggestions are reported. Tier uses its own per-option thresholds and abstains
when no tier meets its threshold. The live tier readout is independent of intent
scores. System One does not choose workflow strategies or skill paths in this
contract; explicit workflow requests, action gates, memory ownership, the Rule
of 3 and the active-step binding contract remain deterministic.

## Rollout and evaluation

The measurement definitions in
[system-one-suggestion-gates.md](system-one-suggestion-gates.md) remain useful
for recording model behavior. For opt-in live routing, their numeric values are
stored as a baseline and do not block activation. Version comparison and
rollback follow the long-term optimization curve, not one threshold or metric.
The default mode stays `off`; private weights are used only by machines with an
active version pointer, and the public plugin ships the training method rather
than weights.

Evaluation records stage distributions, provenance, repeatability, CPU, OS,
runtime, thread count, cold latency and warm p95. System One provides reference
confidence, not absolute answers. Mechanism tests and mock providers establish
contract behavior only; they do not claim model quality or a live-host result.
