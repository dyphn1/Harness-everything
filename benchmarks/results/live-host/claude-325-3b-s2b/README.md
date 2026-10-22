# Live-host capture: claude-325-3b-s2b (F4-L2)

**Qualifying run: Run 2b.** A headless Claude Code session completed the registered doc-check command and the reviewer returned a labelled verdict. The Pre and Post PreToolUse/PostToolUse of the doc-check call are correlated on one `tool_use_id`, and the reviewer's `agent_id` is populated and correlated with the parent session. Positive credit stays disabled: this directory is evidence for the qualification gate, and the export is not written (see the report).

Run 1 (gate unmet) and Run 2a (a denied attempt) are kept below for the record.

## Pins

| Item | Value |
|---|---|
| F4 HEAD (capture implementation) | `97243e5054329ef2f8d20138f41cf9b6d6d1cfdd` |
| HEAD tree | `aa21c5dd93d6b5894c683222e0c3d66a72f09aeb` |
| Staging | `node scripts/stage-claude-plugin.js <scratch>/plugin` at the clean HEAD (1711 tracked files) |
| Host | Claude Code `2.1.308`, macOS (darwin 25.6.0), zsh |
| Plugin loaded | `harness-everything` 0.39.0, source `inline`, from `--plugin-dir` |

The live worktree has an uncommitted change to `hooks/scripts/lib/doc-reconciliation-pilot.js` that is not part of the staged copy and was not exercised.

## Run 2b (qualifying)

### Command (sanitized)

```text
cd <scratch>/project
HARNESS_DOC_RECONCILIATION_PILOT=1 HARNESS_STATE_HOME=<scratch>/state-run2b \
claude -p "<fixed prompt: read docs/a.md; run exactly the registered doc-check command (quoted path); invoke the foreground doc-reviewer; wait; stop>" \
  --plugin-dir <scratch>/plugin \
  --settings <scratch>/capture-settings-run2.json \
  --agents '{"doc-reviewer":{"description":"Read-only documentation reviewer","prompt":"Read only. Return explicit verdict, summary and reviewed artifact digests; never edit or execute the implementation."}}' \
  --allowedTools "Bash(node \"<staged doc-check.js>\" check:*)" Read Task \
  --session-id <fresh UUID> --setting-sources project,local \
  --output-format stream-json --verbose
```

No bypass flag. The allowlist is the coordinator's scoped set: the one doc-check invocation pattern, `Read`, and `Task`. No `Bash(*)`, no Write or Edit.

### Settings and digests (sha256)

| File | sha256 |
|---|---|
| `capture-settings-run2.json` (session `--settings`, five events) | `b1f480c9971e9104ef6e4d36856a52bb7ba4dc10a8c4b4d7c87fe4aeb75d402c` |
| `capture-wrapper-run2.js` (log-only, no hook call) | `6172f35858439f7de63c8f726dc7bf0ee8eaefa913ced0c55aba319e7c30b331` |
| staged `hooks/hooks.json` | `e3c711dce8d8cebaad1ea433febf4d2de2d4a3a03e514024657544d3e0c1304e` |
| staged `harness-everything/scripts/doc-check.js` | `1bbf23e8f830690ffae8e8535c70ed3db0dc35d2ae4d3d76aea1bfc2b1a6a426` |

### Exit and outcome

- `claude` exit `0`. Result `subtype: success`, `is_error: false`, 4 turns.
- The registered doc-check Bash call **completed**: tool result `is_error: false`, and it emitted `harness.doc-check.check.v1`.
- The doc-reviewer was invoked through the `Agent` tool (the host's name in this build), with `subagent_type: doc-reviewer`. It returned `Review verdict: approve` with a summary.
- The reviewer's own `shasum` Bash call was **denied** (`This Bash command contains multiple operations. The following part requires approval`). This is the allowlist working as intended: subagent shell calls are not granted. The reviewer still returned its verdict.

### Must-report table (Run 2b)

| Field | Observed? | Evidence (sanitized placeholders) |
|---|---|---|
| `tool_use_id` on the doc-check tool, Pre and Post correlated | **yes** | `<tool-use-3>`: wrapper `PreToolUse,PostToolUse`; journal `PreToolUse,PostToolUse`. Post `tool_response.interrupted: false` |
| `tool_response.interrupted` present and its value | **yes, `false`** | Post keys include `interrupted` |
| Reviewer `agent_id` / `agent_type` on SubagentStart/Stop, correlated with parent session | **yes** | `<agent-1>`, `agent_type: doc-reviewer`. SubagentStart and SubagentStop carry the same `session_id` as the parent session |
| Agent/Task result alias correlation | **yes** | the `Agent` tool's PostToolUse `tool_response.agentId` equals `<agent-1>`, `status: completed` |
| Hook list actually loaded (duplicates or missing) | **no duplicates** | see below |

### Reviewer verdict

SubagentStop `last_assistant_message` begins `Review verdict: approve`, then a summary. The journal record carries `reviewVerdict: approve` and `reviewSummary`. The verdict is host-bound to `<agent-1>`.

### Loaded hooks and what fired

Declared for the five events (staged `hooks/hooks.json`): PreToolUse matches `Bash|PowerShell|Task|Agent` → `state-persist`; PostToolUse matches `Task|Agent` and `Edit|Write|Bash|PowerShell|apply_patch` → `state-persist`; PostToolUseFailure matches `Bash|PowerShell|apply_patch` → `state-persist`; SubagentStart and SubagentStop → `state-persist`. Other declared hooks are not recorded: the stream reports only SessionStart hook events.

Observed in the plugin journal (11 records, **zero duplicates**):

- PreToolUse and PostToolUse for the doc-check Bash call, from the plugin's own mounted `state-persist`.
- SubagentStart, SubagentStop, and PreToolUse and PostToolUse for the reviewer's Bash calls, all carrying `agent_id`.
- PostToolUse for the `Agent` tool, carrying the alias `agentId`.

The wrapper logged 11 payloads and ran no hook of its own, so no record was journaled twice.

## Run 1 (gate unmet)

First attempt: Bash denied outright (`This command requires approval`) with no allowlist. No PostToolUse, no reviewer. Settings `e0ba8b39…`, wrapper `d8f568cd…`. The wrapper also ran the staged hook, so the PreToolUse for the denied call was journaled **twice** (two capture ids, two pids). Duplicate mounting caused by the wrapper, now removed in Run 2b.

Run 1 sanitized lines: `run: "1"` in `capture.sanitized.jsonl`.

## Run 2a (denied, allowlist pattern mismatch)

Same allowlist text with the path **unquoted** in the prompt. The model's command was `node /private/…/doc-check.js check …`, which does not match the quoted pattern `node "…" check:*`. The call was denied (`This command requires approval`). No PostToolUse. Its journal was cleared when Run 2b started, so only its wrapper payload is retained (`run: "2a"`). Fixed by quoting the path in the prompt; the allowlist text itself was not changed.

## Files

- `capture.sanitized.jsonl`: 26 lines across runs 1, 2a and 2b. Every line has a top-level `event`, `tool_use_id`, `agent_id` and `interrupted` where the host supplied them (absent stays absent). Two sources per run: `wrapper-stdin` (the raw hook payload, sanitized) and `journal-record` (the plugin's capture record). One consistent placeholder map across runs (`<session-N>`, `<tool-use-N>`, `<prompt-N>`, `<agent-N>`, `<capture-N>`). Tool response bodies are reduced to keys, `interrupted`, `status`, `agentId` and a digest. No local paths, no session ids, no tokens (checked by grep). The production validator (`resolveContext`) reads these lines: payload checks pass for Run 2b, and it stops only at the missing qualification export.
- Raw payloads, transcripts, journals and the staged plugin stay **private** in `scratchpad/live-l/`.

## What this does not establish

- Live credit. The production gate is evaluated by the provider; this directory alone does not open it (see the report).
- Reviewer `reviewed digest` binding: the reviewer's own digest calculation was denied, so the bound digest is the SubagentStop `last_assistant_message` digest, not a digest the reviewer computed.
- Hooks other than `state-persist` on these events: their execution is not recorded here.
- One session on one host. No Windows, no other host.
