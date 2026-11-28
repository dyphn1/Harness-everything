# OpenCode V2 steering trace (2.4.1, #450)

**Observed:** OpenCode 2.4.1 on macOS 26.7.3, Node 24.22.1, 2026-11-28. One long-lived `opencode serve --hostname 127.0.0.1` (2.4.1 requires `OPENCODE_PASSWORD`; the first attempt without it returned HTTP 401), model `opencode/hy4-flash-free`. Turn A (multi-step bash) started in session `s1`; 7.7 s later prompt B was sent to the **same session** while A was still executing; after A+B settled, sequential control prompt C was sent as a positive control.

**Candidate:** Clean clone of `main` at `411e5a70`. The probe workspace loaded the 1-line re-export `.opencode/plugins/harness-enforcement.js` pointing to `opencode-plugin/index.mjs` alongside the key-only [steering-probe.js](steering-probe.js) (loaded as `zz-steer-trace.js`).

## Isolation (E-0029)

The server ran under `env -i` with `HOME`, `XDG_*`, `TMPDIR`, `HARNESS_OBSERVATIONS_DIR`, and `HARNESS_STATE_HOME` pointed at an empty probe directory, copying only provider auth, so no global Harness plugin, user config, or ambient store could interfere. [plugin-load-lines.txt](plugin-load-lines.txt) shows the server loaded exactly two plugins: the candidate and the key-only steering probe.

## Sequence

```mermaid
sequenceDiagram
  participant U as Operator prompts
  participant H as OpenCode 2.4.1
  participant P as Harness candidate
  U->>H: Turn A (m2, dt_ms 126) in s1
  H->>P: prompt(m2), inbox.enqueued, execution.started, inbox.delivered
  H->>P: context [m2:user] -> multi-step bash running
  U->>H: Prompt B (m4, dt_ms 7655) in same s1 while A runs
  H->>P: prompt(m4), inbox.enqueued (no new execution.started)
  P->>P: Turn 1 (A) closed with selfReportReason: stop-missing; no record for B
  H->>P: context [m2:user, m5:assistant, tool, m4:user] + inbox.delivered (live steering)
  H->>P: Single session.execution.succeeded (dt_ms 27554) covering A+B
  U->>H: Control C (m14, dt_ms 35716) after settle
  H->>P: prompt(m14), execution.started (35724) -> execution.succeeded (38840)
  P->>P: Turn 3 (C) recorded with valid selfReport: true
```

## What the files show

| File | Shows |
|---|---|
| [plugin-load-lines.txt](plugin-load-lines.txt) | Server log lines confirming exactly two plugins loaded: the candidate and `zz-steer-trace.js`. |
| [run-marks.txt](run-marks.txt) | Wall-clock start/exit timestamps for A, B (sent while A ran, `sid_found=yes`, both exiting together at `1795835809`), and sequential control C. |
| [steering-probe.js](steering-probe.js) | Key-only V2 probe recording hook/event type, key names, value types, pseudonymous IDs, and order with no prompt or response text. |
| [steering-trace.jsonl](steering-trace.jsonl) | Full key-only event/hook timeline: B (`m4` at `dt_ms: 7655`) triggers `prompt` + `session.inbox.enqueued` + `session.inbox.delivered` (`dt_ms: 7710`) with **no new `session.execution.started`** and appears in the next `context` messages (`dt_ms: 7709`) of the same execution; one `session.execution.succeeded` (`dt_ms: 27554`) covers A+B; control C (`m14` at `dt_ms: 35716`) gets its own `session.execution.started` (`dt_ms: 35724`) and `session.execution.succeeded` (`dt_ms: 38840`). |
| [observations-index-excerpt.json](observations-index-excerpt.json) | Observation store index after the run: turn 1 (`t1`, A) closed with `selfReport: false, selfReportReason: "stop-missing"` at `03:16:29.162Z` when B arrived; **no record for B**; control C recorded as turn 3 (`t2`) with `selfReport: true, selfReportReason: null`. |

## Boundary

- Establishes, for this one host/version/run (`2.4.1`, macOS 26.7.3, long-lived server): a mid-turn prompt B sent to an active session is delivered as **live steering** inside the same execution (not a queued next turn), with `prompt` + `session.inbox.enqueued` + `session.inbox.delivered`, `m4` injected into the next `context` messages, no new `session.execution.started`, and a single `session.execution.succeeded` covering A+B. Post-settle control C receives its own `session.execution.started` and `session.execution.succeeded`.
- **Witness only (#450):** the observation store shows the overwrite/drop behavior predicted by #450 (turn 1 closed `stop-missing` on B's arrival, no record for B, valid record for control C). The internal cause of B's missing record is `unknown` (not traced). This round stops at trace evidence with no product fix; a credible RED fixture and fix are deferred.
- **2.4.1 setup fact:** `opencode serve --hostname 127.0.0.1` required `OPENCODE_PASSWORD`; the first attempt without it returned HTTP 401.
- Not exercised: cancellation or retry during steering, ledger lessons, session create/delete reset, global scope, npm-package install, other OpenCode versions, and Windows/Linux.
