# C8 — Level 3 single-run dispatch CLI contract

This detail implements the C8 action map for one coordinator-selected runner attempt. It does not provide launcher policy or a live provider integration.

## Invocation

```sh
npm run --silent dispatch -- --runner <codex|opencode> --model <id> \
  --packet <path> --worktree <git-root> --scratch <absolute-external-path> \
  --report <path> [--effort <low|medium|high|xhigh>] [--dry-run] [--json]
```

`node scripts/dispatch.js` accepts the same options. `--help` prints this short synopsis. The coordinator supplies every value; packet and report paths may be relative to the worktree or absolute. The worktree must be an existing Git root. Scratch must be absolute and outside every Git repository/worktree. A pre-existing report path is rejected as invalid input.

| Option | Meaning |
| --- | --- |
| `--runner` | Required explicit selection: `codex` or `opencode`. |
| `--model` | Required model id for that runner. |
| `--packet` | Required existing packet file, resolved from the worktree when relative. |
| `--worktree` | Required existing Git repository or worktree root; child cwd. |
| `--scratch` | Required absolute path outside all Git repository/worktree roots; child `TMPDIR`. |
| `--report` | Required fresh report path, resolved from the worktree when relative. |
| `--effort` | Optional Codex reasoning effort: `low`, `medium`, `high`, or `xhigh`. It passes a Codex `-c model_reasoning_effort="…"` override; omission leaves Codex configuration unchanged. Rejected for OpenCode. |
| `--dry-run` | Validate inputs and return planned argv/cwd; no child or filesystem writes. |
| `--json` | Return one JSON object on stdout, including refusals. |
| `--help` | Return the short usage synopsis with exit 0. |

In JSON mode the common shape is `{ok, code, phase, message}` with resolved `runner`, `model`, and existing `evidence` paths when available. A validated requested Codex `--effort` is also returned as `effort`; it records the request and does not claim the provider applied it. Dry run also returns `argv` and `cwd`; Codex's generated raw-output argument uses a `<run-id>` placeholder. Human-mode refusals go to stderr. Child logs and raw output stay in evidence files, not in the JSON result.

## Exit and JSON codes

| Exit | JSON `code` | Meaning |
| --- | --- | --- |
| `0` | `HELP`, `DRY_RUN_OK`, `DONE` | Help, validated dry run, or a fresh validated DONE report. |
| `1` | `INTERNAL_ERROR` | Unexpected application failure outside a named phase result. |
| `10` | `INVALID_INPUT` | Bad/missing/duplicate option, unsupported or runner-incompatible effort, runner/model, packet/worktree, or a report path that already exists. |
| `11` | `UNSAFE_SCRATCH` | Scratch is relative, an existing scratch path is not a directory, or it is inside a Git repository/worktree. |
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

The readiness prompt is `Reply with the single word READY`. After trimming outer whitespace, only `READY` and `READY.` are accepted. Any other reply returns `12 NOT_READY`. A nonzero, signaled, or timed-out child is refused even if it produced an accepted reply.

Classification requires a full runner-specific diagnostic line on the failed readiness child's stderr after ANSI stripping. Only a normal nonzero exit is eligible; zero exits, signals, timeouts, stdout, quoted text, a different envelope, and partial or bare `429` text do not receive provider credit. Everything else, including local/cache errors, invalid `--quota`, header timeout, or a missing/ambiguous diagnostic, returns `12 NOT_READY`. The JSON `code` distinguishes throttling from usage/quota exhaustion.

| Runner / outcome | Recognized stderr line | Evidence |
| --- | --- | --- |
| OpenCode provider rate limit | `Error: Provider request failed with HTTP 429: {"status":429,"title":"Too Many Requests"}` | The ANSI `Error:` stderr envelope and exit 1 are live-traced. The 429 body is from the retained OpenCode log; a live 429 reproduction remains unchecked. |
| OpenCode usage/quota exhaustion | `Error: Free usage limit reached. Free models work in OpenCode (https://opencode.ai); subscribe to OpenCode Go to keep going: https://opencode.ai/go` | The stderr envelope is live-traced; the cause is from the retained OpenCode log. |
| Codex provider rate limit | `ERROR: Provider request failed with HTTP 429: {"status":429,"title":"Too Many Requests"}` | Fixture-only; no retained live Codex 429 trace. |
| Codex usage/quota exhaustion | `ERROR: Free usage limit reached. Free models work in OpenCode (https://opencode.ai); subscribe to OpenCode Go to keep going: https://opencode.ai/go` | Fixture-only; no retained live Codex usage-limit trace. |

Each invocation uses one selected runner and one readiness attempt. A `12` or `13` refusal starts no execution, report writer, fallback, or retry; available child evidence remains available to the coordinator.

Codex writes raw output with `codex exec -o`; it must contain an explicit terminal DONE or BLOCKED status. `report-writer --from-codex-output` strips an optional valid terminal host label, writes the final report, and `report-writer check` validates it. OpenCode is asked to write the report path directly; the path must remain absent through readiness and the resulting file must pass `report-writer check`. A valid BLOCKED report returns 17. Failed execution returns 15 and preserves its logs/raw output; it may have changed the worktree.

## Evidence boundary

| Layer | What it establishes | What it does not establish |
| --- | --- | --- |
| Fixture | The real Node entry with stubbed child runners exercises argv, cwd, closed stdin, readiness, quota, timeout, fresh delivery, report writing/checking, and exit/JSON outcomes. | No real provider behavior or live host behavior. |
| Checkout/package entry | The npm script invokes the checked-in entry, and documented options work through that entry; named repository gates validate local consistency and portability. | No installed npm tarball or distributed plugin integration. |
| Live (channel probe only) | `opencode run --auto -m <model>`, the exact C8 OpenCode readiness argv, against failing nvidia models on OpenCode 2.1.4 (2026-11-21): provider errors reach stderr as one ANSI `Error: <message>` line, exit 1, empty stdout. | Not a C8 dispatch: no live 429 or quota reproduction (the 429 and quota bodies come from the retained OpenCode log), no Codex provider call, no host dispatch or live report delivery. |

## #466 boundary

#466 owns automatic `TMPDIR` selection and lifecycle, enforcement across launch paths, per-key admission/reservation, and refusing packets that declare worker `gh`/network needs. This CLI accepts coordinator-supplied inputs for one attempt and cannot certify those launcher guarantees. It also does not add a distributed plugin command or run a live provider.
