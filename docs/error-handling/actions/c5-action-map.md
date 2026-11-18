# C5 — Level 2 Action Map (pin one host protocol at its real boundary)

> **Guidance-only Level 2 map for [#402](https://github.com/dyphn1/Harness-everything/issues/402) class C5.** Companion to the [Error Handling Level 1 overview](../README.md) and the [C5 host replay contract](../details/c5-host-replay-contract.md). This map describes what the agent should do; it does not implement a replay, change `opencode-plugin/`, `ci/`, hooks, or the Error Ledger, and it is not a shipped mechanism. The packet gate is verbatim: "With evidence missing, document the exact unavailable field or artifact."

**Lookup:** [Registry table](../registry.md) locates this Level 2 behavior block and its Level 3 reference. It maps documents, not control-flow arrows.

**Decision (binding, from advisor answer 4, C5):** pin one host protocol at its real boundary — the OpenCode V2 host protocol as consumed by `opencode-plugin/index.mjs` (flat events, session id at `data.sessionID`, turn end on `session.execution.succeeded`, V2 context messages using `type`/`content[]`). Use a retained E-0006 host payload and a deterministic replay in the existing consumer suite **if** the payload, expected translation and fixture owner are available. Otherwise ship Level 2 guidance and the replay contract, and do not dispatch any replay implementation.

## Block 1 — ASSESS: capture, triage and identify this occurrence

| Scope from Level 1 | What the agent should do (Level 2) | Handoff/condition |
| --- | --- | --- |
| **A Capture** | Record the boundary observation: which host event shapes reach the consumer, where the session id lives (`data.sessionID` on V2 flat events), which event ends a turn (`session.execution.succeeded`, since V2 sends no `session.idle`), and which message shape the consumer reads (`type`/`content[]`). Capture the ledger class E-0006 (live-kit-host-protocol-mismatch) and its sites. | Give B the boundary sites and the ledger reference. |
| **B Triage** | Check the three packet-named locations for a retained E-0006 host payload: `benchmarks/results/live-host/`, `ci/*opencode*`, `opencode-plugin/`. Record each retained artifact's provenance. | Only a payload with expected translation and a named fixture owner proceeds to D; otherwise hold the replay. |
| **C Identify** | Classify as E-0006 class. Pin the boundary sites: `opencode-plugin/index.mjs` event loop (`raw.sessionID` / `raw.data.sessionID`, `turnEnded` on `session.idle` or `session.execution.succeeded`) and the existing consumer test `ci/mechanism-397-opencode-observations.test.js` (its `v2Event` helper and `session.execution.succeeded` pushes). | Identified but replay prerequisites missing → Defer the replay; keep the docs path. |

## Block 2 — RESPOND: decide, act, deliver and accept

| Scope from Level 1 | What the agent should do (Level 2) | Handoff/condition |
| --- | --- | --- |
| **D Decide (response block)** | If retained payload + expected translation + fixture owner are all available: Converge — wire a deterministic replay into the named consumer test. Otherwise (this slice): Defer the replay and ship this Level 2 map plus the Level 3 replay contract documenting the exact missing field/artifact. Do not start E on a replay implementation. | No replay implementation without all three prerequisites. |
| **E Treat (response block)** | Write `docs/error-handling/actions/c5-action-map.md` and `docs/error-handling/details/c5-host-replay-contract.md`. Name exact fixture/test paths and pin provenance (host, version, date, source revision where known). Document the exact missing field/artifact when evidence is missing. No new scripts, hooks, ledger entries, or test changes. | The contract's missing-artifact section is the evidence layer for the next slice. |
| **F Deliver (response block)** | Hand off the two doc paths and the contract's replay preconditions to the coordinator. The replay stays undispatched until the retained payload, expected translation and fixture owner exist. | Do not present a replay harness as installed or runnable. |
| **G Accept (response block)** | Accept via objective local checks only: `npm run test:consistency`, `test:references`, `test:portability` and the report-writer `write`/`check` cycle for the C5 report. No independent review claim; no behavioral claim (docs only). Structural PASS ≠ replay PASS. | Missing prerequisites remain recorded as unresolved, not fabricated as done. |

## Level 3 — details consulted only when needed

- [C5 host replay contract: retained payload inventory, provenance, consumer test path, missing artifact, replay preconditions](../details/c5-host-replay-contract.md)
- [Existing E-0006 ledger](../../../.agents/harness-everything/errors/E-0006-live-kit-host-protocol.md): existing class/history, not duplicated here

**Acceptance of this draft:** Level 2 action guidance only. No end-to-end replay conclusion until the retained payload, expected translation and fixture owner are pinned and the consumer test is exercised end to end.
