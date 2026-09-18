# Harness Telemetry

Harness telemetry is a **local operational evidence layer**, not analytics upload and not a memory store. It normalizes host-native lifecycle evidence into JSONL so benchmark/report definitions can evolve without rewriting historical events.

## Privacy defaults

Events contain skill/runtime metadata only:

- skill name/version;
- host;
- locally hashed session/turn/agent IDs;
- random invocation ID;
- tool name (never tool arguments);
- status/retry count;
- separate timing fields;
- short reason codes.

The sink rejects content-bearing fields such as prompt, source/code contents, command/tool arguments, paths, transcript, messages, email/user identity. It never sends data over the network. Set `HARNESS_TELEMETRY=off` to disable local writes.

Raw events live under the workspace-keyed Harness state root:

```text
~/.agents/harness-everything/workspaces/<workspace-key>/state/telemetry/events.jsonl
```

They are not project files and are not committed automatically.

## Timing semantics

Do not collapse these into one `duration_ms`:

- `skillLoadDurationMs`: host Skill pre-event to correlated Skill post-event. This is loading/framework latency.
- `activeWindowMs`: successful/observed skill load until the host turn/Stop boundary. This is a context exposure window, **not CPU/runtime**.
- `attributedToolDurationMs`: tool duration observed while a skill invocation is active. It is observational/non-exclusive: overlapping active skills may each receive the same tool observation.

When a host does not expose a reliable duration, the value remains `null`; Harness does not fabricate it.

## Host adapters

| Host | Adapter | Evidence boundary |
| --- | --- | --- |
| Claude Code | Narrow `Skill` Pre/Post hooks + Stop; existing `state-persist` observes host-reported tool duration | Mechanism covered in CI; live certification remains #82 |
| OpenCode | Existing single-process plugin records skill before/after, measures tool elapsed in-process, closes on `session.idle` | Mechanism covered in CI; retained live support remains bounded by #37/#82 |
| Codex | OpenAI package includes the same narrow Skill/Stop adapter | **Mechanism only** while plugin hook mounting/attribution is blocked by #122; no live claim |

Telemetry failure is always fail-open and cannot block a task.

## Reports

```bash
node telemetry/scripts/report.js --workspace <repo>
node telemetry/scripts/report.js --file <events.jsonl> --markdown
node telemetry/scripts/benchmark.js 250
```

The report exposes invocation counts, completion statuses, P50/P95 for each timing vocabulary, and invalid-event counts. Raw JSONL remains the source of truth; SQLite/dashboard projections can be added later without changing the event evidence contract.

The overhead benchmark measures only local event normalization + append cost. Host adapter/process startup overhead should be measured separately in live host studies before using telemetry data for performance comparisons.

## Benchmark use

#71 may consume telemetry cost/execution evidence, but correctness pass rates stay separate. Infrastructure/telemetry failures must not become behavioral failures.
