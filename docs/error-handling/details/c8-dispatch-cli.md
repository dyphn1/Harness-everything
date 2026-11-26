# C8 — Level 3 single-run dispatch CLI contract

This detail implements the C8 action map for one coordinator-selected runner attempt. It does not provide launcher policy or a live provider integration.

## Invocation

```sh
npm run --silent dispatch -- --runner <codex|opencode|agy> --model <id> \
  --packet <path> --worktree <git-root> --scratch <absolute-external-path> \
  --report <path> [--effort <low|medium|high|xhigh>] [--assignment <path>] \
  [--admission-policy <path>] [--dry-run] [--json]
```

`node scripts/dispatch.js` accepts the same options. `--help` prints this short synopsis. The coordinator supplies every value; packet and report paths may be relative to the worktree or absolute (for `agy`, both must resolve inside `--worktree` so the prompt passes cwd-relative worker paths only). The worktree must be an existing Git root. Scratch must be absolute and outside every Git repository/worktree. A pre-existing report path is rejected as invalid input.

| Option | Meaning |
| --- | --- |
| `--runner` | Required explicit selection: `codex`, `opencode`, or `agy`. |
| `--model` | Required model id for that runner. |
| `--packet` | Required existing packet file, resolved from the worktree when relative (must resolve inside `--worktree` for `agy`). |
| `--worktree` | Required existing Git repository or worktree root; child cwd. |
| `--scratch` | Required absolute path outside all Git repository/worktree roots; child `TMPDIR` (in managed mode: the external root of per-attempt directories, see [Managed scratch](#managed-scratch-and-lifecycle-466-d-scratch)). |
| `--report` | Required fresh report path, resolved from the worktree when relative (must resolve inside `--worktree` for `agy`). |
| `--effort` | Optional Codex reasoning effort: `low`, `medium`, `high`, or `xhigh`. It passes a Codex `-c model_reasoning_effort="…"` override; omission leaves Codex configuration unchanged. Rejected for OpenCode and `agy`. |
| `--assignment` | Optional managed-mode gate assignment sidecar JSON; see [Managed mode](#managed-mode-and-gate-assignment-466-d-gate). |
| `--admission-policy` | Required in managed mode (`--assignment`); host-level per-pool reservation policy JSON, see [Managed admission](#managed-per-pool-admission-466-d-admission). Rejected in unmanaged mode (`10 INVALID_INPUT`). |
| `--dry-run` | Validate inputs and return planned argv/cwd; no child or filesystem writes. |
| `--json` | Return one JSON object on stdout, including refusals. |
| `--help` | Return the short usage synopsis with exit 0. |

In JSON mode the common shape is `{ok, code, phase, message}` with resolved `runner`, `model`, and existing `evidence` paths when available. A validated requested Codex `--effort` is also returned as `effort`; it records the request and does not claim the provider applied it. For `agy`, JSON also returns `sandbox: "requested"`; it records the requested `--sandbox` flag only and does not claim proven isolation (scope any isolation claim to separately executed evidence). Dry run also returns `argv` and `cwd`; Codex's generated raw-output argument uses a `<run-id>` placeholder. Human-mode refusals go to stderr. Child logs and raw output stay in evidence files, not in the JSON result.

## Exit and JSON codes

| Exit | JSON `code` | Meaning |
| --- | --- | --- |
| `0` | `HELP`, `DRY_RUN_OK`, `DONE` | Help, validated dry run, or a fresh validated DONE report. |
| `1` | `INTERNAL_ERROR` | Unexpected application failure outside a named phase result. |
| `10` | `INVALID_INPUT` | Bad/missing/duplicate option, unsupported or runner-incompatible effort, runner/model, packet/worktree, or a report path that already exists. |
| `11` | `UNSAFE_SCRATCH` | Scratch is relative, an existing scratch path is not a directory, it crosses a dangling symlink or unresolved symlink chain, or it resolves inside a Git repository/worktree. |
| `12` | `NOT_READY` | Selected executable is missing or readiness failed, timed out, or omitted `READY`. No run starts. |
| `13` | `RUNNER_RATE_LIMITED` | The selected runner's failed readiness stderr has a recognized provider throttling diagnostic. No run starts. |
| `13` | `RUNNER_QUOTA` | The selected runner's failed readiness stderr has an explicit usage/quota exhaustion diagnostic. No run starts. |
| `15` | `RUN_FAILED`, `RUN_TIMEOUT` | Execution could not start, returned nonzero, timed out, or failed during execution. |
| `16` | `REPORT_INVALID` | Fresh raw/report input is missing, stale delivery appeared before execution, the writer rejected input, or final validation failed. |
| `17` | `WORKER_BLOCKED` | A fresh report passed validation with terminal `STATUS: BLOCKED: <reason>`. The reason is retained. |

| Readiness code | Coordinator message |
| --- | --- |
| `RUNNER_RATE_LIMITED` | Reduce concurrency on the affected key or retry later. |
| `RUNNER_QUOTA` | Select an authorized runner or model with available quota. |
| `NOT_READY` | Readiness failed. Keep the available child evidence. |

## Readiness classification and evidence

The readiness prompt is `Reply with the single word READY`. One terminal Harness host label line (`<!-- harness-label {…} -->`, valid JSON object; its fields are not validated) is dropped first, because Harness hosts append it to every final message. After trimming outer whitespace, only `READY` and `READY.` are accepted. Any other reply returns `12 NOT_READY`. A nonzero, signaled, or timed-out child is refused even if it produced an accepted reply.

Classification requires a full runner-specific diagnostic line on the failed readiness child's stderr after ANSI stripping. Only a normal nonzero exit is eligible; zero exits, signals, timeouts, stdout, quoted text, a different envelope, and partial or bare `429` text do not receive provider credit. Everything else, including local/cache errors, invalid `--quota`, header timeout, or a missing/ambiguous diagnostic, returns `12 NOT_READY`. The JSON `code` distinguishes throttling from usage/quota exhaustion.

| Runner / outcome | Recognized stderr line | Evidence |
| --- | --- | --- |
| OpenCode provider rate limit | `Error: Provider request failed with HTTP 429: {"status":429,"title":"Too Many Requests"}` | The ANSI `Error:` stderr envelope and exit 1 are live-traced. The 429 body is from the retained OpenCode log; a live 429 reproduction remains unchecked. |
| OpenCode usage/quota exhaustion | `Error: Free usage limit reached. Free models work in OpenCode (https://opencode.ai); subscribe to OpenCode Go to keep going: https://opencode.ai/go` | The stderr envelope is live-traced; the cause is from the retained OpenCode log. |
| Codex provider rate limit | `ERROR: Provider request failed with HTTP 429: {"status":429,"title":"Too Many Requests"}` | Fixture-only; no retained live Codex 429 trace. |
| Codex usage/quota exhaustion | `ERROR: Free usage limit reached. Free models work in OpenCode (https://opencode.ai); subscribe to OpenCode Go to keep going: https://opencode.ai/go` | Fixture-only; no retained live Codex usage-limit trace. |
| `agy` usage/quota exhaustion | Exit `3` (no signal, no timeout, no report) with ANSI-stripped stderr line matching `^(?:(?:Error\|jetski):\s*)?429 RESOURCE_EXHAUSTED\b.+\bResets in [0-9A-Za-z][0-9A-Za-z :.,-]*$` | Fixture-only in C8 (rows A5); matches the probed `agy` Claude-model exit-3 `429 RESOURCE_EXHAUSTED … Resets in <time>` shape. Other exit-3 shapes, non-3 exits, stdout-only lines, or runs that wrote a report are not classified as quota. |

Each invocation uses one selected runner and one readiness attempt. A `12` or `13` refusal starts no execution, report writer, fallback, or retry; available child evidence remains available to the coordinator.

Codex writes raw output with `codex exec -o`; it must contain an explicit terminal DONE or BLOCKED status. `report-writer --from-codex-output` strips an optional valid terminal host label (blank lines between STATUS and the label are allowed; live codex output has one), writes the final report, and `report-writer check` validates it. OpenCode and `agy` follow the direct-delivery contract: the worker writes the report path directly, the path must remain absent through readiness (pre-existing returns `10 INVALID_INPUT`, populated during readiness returns `16 REPORT_INVALID`), exit 0 without a fresh regular report file fails delivery (`16 REPORT_INVALID`) with logs retained, and the resulting file must pass `report-writer check`. A valid BLOCKED report returns 17. Failed execution returns 15 and preserves its logs/raw output (for `agy`, an execution exit `3` with no report and the validated `429 RESOURCE_EXHAUSTED … Resets in <time>` stderr diagnostic returns `13 RUNNER_QUOTA` with `phase: "execution"` and logs retained); a failed execution may have changed the worktree.

## `agy` headless runner adapter (#466 D-agy)

`agy` is invoked with the pinned headless argv, `cwd` set to `--worktree`, closed stdin (`stdio: ['ignore', 'pipe', 'pipe']`), and child execution bounded by C8 (`120s` readiness, `2700s` execution) in addition to `--print-timeout`:

```sh
agy -p "<prompt>" --model <id> --mode accept-edits --sandbox \
  --settings '{"permissions":{"allow":["command(*)","read_file(*)"]}}' --print-timeout <N>s
```

- **Cwd-relative worker paths:** `--packet` and `--report` must resolve inside `--worktree` (otherwise `10 INVALID_INPUT`), and the execution prompt points only at cwd-relative paths (`<packet-rel>`, `<report-rel>`).
- **Readiness:** runs the same pinned argv with `Reply with the single word READY` and `--print-timeout 120s`; accepts `READY` or `READY.` after dropping an optional trailing Harness host label. A failed readiness check starts no execution.
- **Sandbox configuration:** `--sandbox` is recorded as requested configuration (`sandbox: "requested"` in JSON). No isolation is claimed; scope any isolation claim to separately executed evidence.
- **Gate profile:** `runnerProfile('agy')` returns `{ sandboxed: true }` conservatively because `agy` requests `--sandbox` and is not treated as an unsandboxed loopback-capable profile. Assigning `verify:all` or `verify:all --fast` to the worker returns `18 GATE_REFUSED` ("assign it to the coordinator").
- **Evidence:** fixture rows A1–A10 in `ci/mechanism-468-dispatch-cli.test.js` (real Node entry, stubbed `agy` fixture). Live `agy` runs remain out of scope here until admission is in place.

## Evidence boundary

| Layer | What it establishes | What it does not establish |
| --- | --- | --- |
| Fixture | The real Node entry with stubbed child runners exercises argv, cwd, closed stdin, readiness, quota, timeout, fresh delivery, report writing/checking, and exit/JSON outcomes. | No real provider behavior or live host behavior. |
| Checkout/package entry | The npm script invokes the checked-in entry, and documented options work through that entry; named repository gates validate local consistency and portability. | No installed npm tarball or distributed plugin integration. |
| Live dispatch (2026-11-21, #497) | One full `npm run --silent dispatch` per runner on this Mac: OpenCode `opencode/hy4-flash-free` and Codex `gpt-6-luna --effort medium`, a two-line probe packet, both `0 DONE` with a validated report. The readiness replies carried a trailing host label; the Codex raw output had a blank line before it. | Effort is recorded as requested; provider-side application of the effort is not observed. One run each, not a reliability claim. |
| Live (channel probe only) | `opencode run --auto -m <model>`, the exact C8 OpenCode readiness argv, against failing nvidia models on OpenCode 2.1.4 (2026-11-21): provider errors reach stderr as one ANSI `Error: <message>` line, exit 1, empty stdout. | Not a C8 dispatch: no live 429 or quota reproduction (the 429 and quota bodies come from the retained OpenCode log), no Codex provider call, no host dispatch or live report delivery. |

## Managed mode and gate assignment (#466 D-gate)

Managed mode is entered only by `--assignment <path>` (resolved from the worktree when relative): a sidecar JSON file next to the packet. Without the option, behavior, output, and JSON shape are unchanged. A sidecar was chosen over packet frontmatter so the C6 packet format stays untouched and C8 reads one strict, machine-checkable file; packet metadata owns which actor runs each gate, C8 owns admission.

```json
{ "schemaVersion": 1, "gates": [ { "id": "verify:all", "actor": "coordinator" }, { "id": "npm run test:consistency", "actor": "worker" } ] }
```

Validation is strict: the root has exactly `schemaVersion` (`1`) and `gates`; each gate has exactly `id` and `actor` (`worker` or `coordinator`); ids are unique and must be in the registry. Any unknown key, value, shape, unreadable file, or unknown id returns `19 GATE_ASSIGNMENT_INVALID`.

| Gate id | Requirement for a worker |
| --- | --- |
| `verify:all`, `verify:all --fast` | Unsandboxed, loopback-capable profile |
| `npm run test:consistency`, `npm run test:references`, `npm run test:portability`, `node --test <repo-relative .js file>` | Any profile (focused) |

One decision function maps the selected runner to a profile: `codex` runs `-s workspace-write` and `agy` requests `--sandbox` (not treated as an unsandboxed loopback-capable profile), so both are conservatively `sandboxed: true`; `opencode` is not. A sandboxed profile with a worker assignment of either full or fast `verify:all` returns `18 GATE_REFUSED` ("assign it to the coordinator"). Both refusals happen after input validation and before readiness or any file creation, so no child starts and no scratch, report, or evidence exists; `--dry-run` applies the same refusals. An accepted managed run returns `gates: {worker: [...], coordinator: [...]}` in JSON (also on dry run). C8 never runs a gate itself: coordinator gates are only recorded, and the attempt is the same single readiness plus execution.

| Exit | JSON `code` | Meaning |
| --- | --- | --- |
| `18` | `GATE_REFUSED` | Managed worker gate needs a profile the selected runner does not provide. |
| `19` | `GATE_ASSIGNMENT_INVALID` | Managed assignment is missing, malformed, or names an unknown gate. |

Evidence: fixture rows G1–G7 in `ci/mechanism-468-dispatch-cli.test.js` (real entry, stubbed runners). The registry is a v1 list of gates C8 can assess; gates outside it are refused rather than assumed.

## Managed scratch and lifecycle (#466 D-scratch)

This is #466 policy within C8, entered only with `--assignment`. In managed mode `--scratch` names the canonical external **root**, not the child `TMPDIR`. Unmanaged invocations (no `--assignment`) are unchanged: `--scratch` is used directly and nothing is removed.

| Step | Behavior |
| --- | --- |
| Root check | Same `UNSAFE_SCRATCH` (`11`) validation as before, on the canonical path: a root inside any repository or linked worktree, including through a symlink or a symlinked ancestor, or crossing a dangling symlink or unresolved symlink chain at the root or any ancestor, is refused before any slot, directory, report, or child exists. |
| Attempt dir | After validation and admission, C8 creates `<root>/attempt-<random>` with `mkdtemp` (distinct for concurrent attempts, even on one root). It is re-resolved after creation; one that lands inside a repository is removed and refused. It is the child `TMPDIR` and holds readiness/run/report-writer logs and Codex raw output. |
| Checked DONE | Report validated and not BLOCKED: the logs and raw output are copied to `<root>/retained/<attempt>/` (outside the run dir), each copy is size-verified, and only then this attempt's own directory is removed. The JSON `evidence` paths point at the retained copies. Other attempt dirs are never touched. The report stays at `--report`. |
| BLOCKED (`17`), failure (`12`/`13`/`15`/`16`) | The attempt dir and all available evidence are kept. |
| Retention failure | Returns `20 EVIDENCE_RETENTION_FAILED` (phase `retention`) although the report was valid; the attempt dir and evidence are kept, and `evidence` points at them. |
| `--dry-run` | Creates no root, attempt dir, or child. |

| Exit | JSON `code` | Meaning |
| --- | --- | --- |
| `20` | `EVIDENCE_RETENTION_FAILED` | Managed DONE could not copy and verify its evidence outside the run dir; nothing was deleted. |

Scratch and evidence have different lifetimes: scratch is disposable only after a checked DONE has usable retained evidence. Evidence: fixture rows S1–S8 in `ci/mechanism-468-dispatch-cli.test.js`.

## Managed per-pool admission (#466 D-admission)

In managed mode (`--assignment`), C8 requires `--admission-policy <path>` (resolved from the worktree when relative) and atomically reserves one slot for the selected credential or shared quota pool before readiness. Without `--assignment`, unmanaged invocations are unchanged and take no reservation (`--admission-policy` without `--assignment` returns `10 INVALID_INPUT`).

```json
{
  "schemaVersion": 1,
  "dir": "/abs/external/admission-dir",
  "pools": {
    "opencode-pilot-key": { "cap": 2 },
    "agy-shared-pool": { "cap": 1 }
  },
  "routes": [
    { "runner": "opencode", "model": "fixture/opencode-model", "pool": "opencode-pilot-key" },
    { "runner": "opencode", "model": "fixture/opencode-alias", "pool": "opencode-pilot-key" },
    { "runner": "agy", "model": "gemini-4-neon-medium", "pool": "agy-shared-pool" }
  ]
}
```

- **Strict validation (`21 ADMISSION_POLICY_INVALID`, phase `admission`):** exact root keys (`schemaVersion: 1`, `dir`, `pools`, `routes`); `dir` must be an absolute directory outside every Git repository/worktree (reusing the canonical path check from D-scratch) and disjoint from `--scratch`; `pools` maps opaque pool ids (`^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$`) to `{ "cap": <integer >= 1> }`; `routes` maps unique `(runner, model)` pairs to defined pools; the selected `(runner, model)` must have a route. Missing, malformed, or unknown policies refuse before spawn.
- **Opaque identity, no credentials:** pool ids are operator-supplied opaque names. C8 never derives identity from environment secrets and never emits credential values in JSON, slot files, or evidence. Aliases sharing a pool consume the same cap even across different scratch roots.
- **Atomic bounded slots:** `<dir>/<pool>/slot-<0..cap-1>.json` created with `O_EXCL` (`wx`). Each slot records `{ schemaVersion: 1, pool, slot, holderPid, childPid, startedAt }`, updating `childPid` when a child spawns and clearing it after the child exits.
- **Over-cap refusal (`22 ADMISSION_CAP_REACHED`, phase `admission`):** no queueing. If all `cap` slots are occupied (including live, abandoned, corrupt, or indeterminate slot files), the excess attempt refuses before spawn and creates no scratch attempt dir; independent pools remain eligible.
- **Release and coordinator manual slot recovery:** DONE, BLOCKED, readiness failure, runner failure, timeout, and report/retention errors release the owned slot in `finally` after the child has ended (verifying ownership before unlink). Automatic stale-slot reclamation is disabled for the pilot: any existing slot file — including an abandoned, corrupt, or indeterminate reservation — is treated as occupied and is never displaced by contenders. To recover an abandoned slot, the coordinator must first quiesce admission for that pool, confirm that the recorded `holderPid` and any `childPid` (and any spawned child process) have ended and are absent, and only then remove the stale `slot-<k>.json` file before resuming admission.
- **`--dry-run`:** validates the policy and route and returns `admission: { pool, cap }` without creating `dir` or taking any reservation.

| Exit | JSON `code` | Meaning |
| --- | --- | --- |
| `21` | `ADMISSION_POLICY_INVALID` | Managed admission policy is missing, malformed, unsafe, or has no route for the selected runner/model. |
| `22` | `ADMISSION_CAP_REACHED` | Selected admission pool is at cap; excess attempt refused before spawn (no queueing). |

Admission bounds concurrency; a provider can still return quota exhaustion at concurrency one. Evidence: fixture rows R1–R10 in `ci/mechanism-468-dispatch-cli.test.js`.

## #466 boundary

#466 still owns enforcement across launch paths, refusing packets that declare worker `gh`/network needs (no network capability is assessed here), and any live `agy` pilot. Managed gate assignment, managed scratch, the `agy` headless runner adapter, and managed per-pool admission above are the #466 policy implemented in C8. This CLI otherwise accepts coordinator-supplied inputs for one attempt and cannot certify launcher guarantees outside C8. It also does not add a distributed plugin command or run a live provider.
