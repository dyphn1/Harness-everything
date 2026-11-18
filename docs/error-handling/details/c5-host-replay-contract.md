# C5 Treat — Level 3 host replay contract

> **Level 3 supporting contract for C5** (companion to [actions/c5-action-map.md](../actions/c5-action-map.md) and [Level 1](../README.md) in [#402](https://github.com/dyphn1/Harness-everything/issues/402)). Specifies what the agent should do next time and documents the evidence boundary. This document changes no production code, hooks, tests or ledger state. Per the packet gate: "With evidence missing, document the exact unavailable field or artifact."

## Problem to prevent

**E-0006** (`live-kit-host-protocol-mismatch`): live-run kits repeatedly mismatched the real host and provider protocol. The #397 episode (2026-11-15) found three host-shape findings — router runtime under Bun, the V2 turn-end event, and the V2 message shape — and its lesson (memory) is: "record one live trace of the real shapes before a fix packet (#397: `session.execution.succeeded`, id at `data.sessionID`, `type`/`content[]`)." That trace was never retained in the packet sources, so the episode stays open (`closed: false`).

## Retained payloads in the repo today

Searched the three packet-named locations: `benchmarks/results/live-host/`, `ci/*opencode*`, `opencode-plugin/`.

| Retained artifact | Provenance | Host / version / date | V2 host payload present? | Missing artifact |
| --- | --- | --- | --- | --- |
| `benchmarks/results/live-host/opencode-2026-09-16/` (`circuit-breaker.json`, `edit-state.json`, `compliance.json`, `zoom-out-report.md`, `probe-control.md`, `run-commands.md`) | Retained live-host evidence for the OpenCode enforcement plugin (README: limited mechanism/live-host evidence, post-reset snapshot, no raw transcript) | opencode 1.18.31 / macOS / 2026-09-16 / plugin rev `dc3ea80` (0.5.2) | **No.** V1-era `session.idle`-based evidence; no `session.execution.succeeded`, no `data.sessionID`, no V2 `type`/`content[]` messages. | The E-0006 V2 host payload (`session.execution.succeeded`, id at `data.sessionID`, `type`/`content[]`). |
| `benchmarks/results/live-host/opencode-2026-11-15-workspace/` (`live-workspace-trace-2026-11-15.jsonl`, `live-workspace-probe.js`, `README.md`) | Workspace-field attribution probe (`setup`/`prompt` events: `sessionID`, `messageID`, `prompt`, `metadata`, `delivery`; `ctx.session.get({sessionID})`) | OpenCode 2.1.4 / macOS / 2026-11-15 | **No.** Same date as #397, but it traces workspace fields, not the V2 turn-end/message shapes. Its README: "It is not a live reproduction of the workspace attribution defect or verification of the fix." | The E-0006 V2 host payload; expected translation; fixture owner. |
| `ci/mechanism-397-opencode-observations.test.js` (consumer test suite) | #397 mechanism test (fix/397-opencode-router-node); E-0006 O3 input `f7addfc0` resolves the session id from `data.sessionID` | OpenCode V2 consumer | **Partially — synthetic only.** Builds V2 fixtures inline via `v2Event(type, sessionID, data)` = `{id, created, type, durable: true, data: {sessionID, ...data}}` and pushes `session.execution.succeeded` as turn end. These are self-authored deterministic fixtures, not a retained live payload, with no pinned expected-translation fixture and no named fixture owner. | Retained live payload; pinned expected translation; fixture owner. |
| `opencode-plugin/index.mjs` (V2 default export `setup(ctx)`) | #397 consumer fix: OpenCode 2.x flat events with session id at `data.sessionID`; turn end on `session.idle` or `session.execution.succeeded`; event loop at `raw.sessionID` / `raw.data.sessionID` | OpenCode V2 host contract | **Source only, no payload.** The boundary itself, not evidence of it. | Retained live payload; expected translation; fixture owner. |

## Exact consumer test that would host a replay

`ci/mechanism-397-opencode-observations.test.js` — the existing OpenCode V2 observation suite. Its `v2Event` helper and `session.execution.succeeded` pushes are the deterministic replay shape: flat `{id, created, type, durable, data}` events with the session id at `data.sessionID`. A replay would feed a retained real payload through this suite's assertions (e.g., the V2 completion and context-message tests around `session.execution.succeeded` / `type`/`content[]`).

## Exact missing field or artifact (gate: evidence missing)

All three C5 replay prerequisites are unavailable in this repo snapshot:

1. **Retained E-0006 host payload:** no retained live trace contains a real V2 `session.execution.succeeded` event with the id at `data.sessionID` and V2 context messages using `type`/`content[]`. E-0006 episode 2 (2026-11-15, #397): "That trace is not a closing review and the packet sources do not re-record it, so the episode stays closed false."
2. **Expected translation:** no pinned fixture maps a retained V2 payload to the consumer's expected record/assertion fields.
3. **Fixture owner:** no named owner for a replay fixture; the consumer test exists but no replay harness is wired to it.

Review probe areas named by the packet: version/event shape differences (opencode 1.18.31 `session.idle` vs OpenCode 2.1.4 `session.execution.succeeded`), stale session binding (a `data.sessionID` bound to a stale/dropped session), and fake evidence (a synthetic fixture passed off as a retained live trace — a fixture pass proves mechanism behavior only).

## Replay contract (preconditions before dispatch)

1. A retained payload file under `benchmarks/results/live-host/` (provenance: host, version, date, source revision) containing real V2 events including `session.execution.succeeded` with the id at `data.sessionID`.
2. A pinned expected translation: assertions mapping those payload fields to the consumer's record format, owned by a named fixture owner (the consumer test's maintainer).
3. Dispatch: run `ci/mechanism-397-opencode-observations.test.js` against the payload. A deliberately mistranslated event or session ID fails; the correct path passes. A fixture pass proves mechanism behavior only.

Until 1–3 exist, this Level 2 map and this contract are the shipped treatment; nothing in `opencode-plugin/`, `ci/`, hooks or the ledger is changed by this slice.
