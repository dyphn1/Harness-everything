# Codex CLI shell outcomes for #488 (2026-11-26)

Codex CLI `0.172.0` on Windows build `10.0.26200` ran UnifiedExec `exec_command` with Windows PowerShell and Git Bash. Each run used an isolated profile, a user-level `PostToolUse` capture hook, and a loopback Responses fixture that issued fixed shell calls. The CLI executed the commands and delivered hook stdin. The fixture supplied only tool calls and a final message.

[Sanitized capture](capture.sanitized.jsonl) pairs each hook payload excerpt with the corresponding `codex exec --json` command completion event. It retains the full top-level key names and the probe's command and output. It omits paths and session, turn, and tool identifiers.

| Probe | CLI event exit code (PowerShell / Git Bash) | Hook `tool_response` | Harness outcome |
|---|---|---|---|
| Exit zero | `0` / `0` | Output string | `unknown` |
| Exit nonzero | `1` / `7` | Output string | `unknown` |
| Exit nonzero after printing `Process exited with code 0` | `1` / `9` | Output string containing that line | `unknown` |
| Delayed exit zero | `0` / `0` | Output string | `unknown` |

The documented hook schema exposes tool-specific output without guaranteeing a shell status field. In this release, UnifiedExec serializes the command output as a JSON string for `PostToolUse`. The structured `item.exit_code` belongs to the separate CLI event stream, outside the hook payload. [Hook schema](https://learn.chatgpt.com/docs/hooks#posttooluse) · [UnifiedExec source](https://github.com/openai/codex/blob/3d86e43b075adeba2193ec5c22ac92f55afd82e6/codex-rs/core/src/tools/context.rs#L506-L514) · [CLI event source](https://github.com/openai/codex/blob/3d86e43b075adeba2193ec5c22ac92f55afd82e6/codex-rs/exec/src/exec_events.rs#L160-L166)

## Async completion follow-up

The same CLI and Windows build reproduced the synchronous results on both shells from checkout `a534e549`. The temporary capture hook invoked the installed Harness 1.2.1 outcome adapter, whose SHA-256 matched the checkout. The `async_failure` rows in the capture record one additional run per shell with a 12-second command and a `write_stdin` poll.

| Tool result | PostToolUse delivery for the delayed command |
|---|---|
| `exec_command` returned a running session | No delivery by the time the fixture received the running result |
| `write_stdin` returned the completed process | One `Bash` hook for the original command with an empty string response. The installed adapter returned `unknown`. The CLI completion event reported exit `1` in PowerShell and `7` in Git Bash. |

Automatic verification credit for these shell results depends on Codex exposing machine-readable status in `PostToolUse`. Source and packaged regression tests independently cover structured zero, nonzero, and ambiguous results through `state-persist` and `contract-test`. Native plugin mounting is tracked in [#122](https://github.com/dyphn1/Harness-everything/issues/122). This capture covers the two Windows shells on the tested CLI release.
