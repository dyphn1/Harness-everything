---
name: fable-haiku
description: "Delegate bulk mechanical work to the fable-worker-haiku agent for staged execution at low cost: explicit pass conditions, optional fan-out, then a fable-verifier pass. Use for 'fable on haiku' requests."
license: Apache-2.0
metadata:
  author: Miya Daniel | Harness Core Team
  version: 0.3.4
---

# Fable Mode — Haiku (v3, agent-routed)

## 📋 Skill Contract

| Component | Specification |
| :--- | :--- |
| **Trigger / Input** | "Fable on haiku" / "stage this on haiku": bulk mechanical work run cheaply on Haiku. |
| **Expected Output** | Delegation to `fable-worker-haiku` (or inline fallback with rules verbatim), optional fan-out, then a `fable-verifier` pass before unsupervised delivery. |
| **State Mutations** | None directly — Task-tool subagents and their file edits. |
| **Enforcement Gate** | Worker brief **MUST** name the pass condition explicitly (no benefit of the doubt for Haiku). A "needs synthesis" escalation **MUST** re-route to the main Orchestrator context (Sonnet/Opus), never retried on Haiku louder. |

One obvious single-pass approach → skip this loop; do it directly.

## Run it

1. Confirm `fable-worker-haiku` is available; else spawn a general-purpose Haiku agent with rules verbatim from `../agents/fable-worker-haiku.md`.
2. Spawn **@fable-worker-haiku** (`subagent_type: "fable-worker-haiku"`). Brief: task, output path(s), named pass condition.
3. Fan out one worker per independent sub-part (cap concurrency); merge.
4. Follow with **@fable-verifier** for unsupervised delivery.

## USE FOR:
- "Fable on haiku" / "stage this on haiku" asks
- Bulk mechanical work on Haiku workers
- Fan-out plus cheap @fable-verifier checks

## DO NOT USE FOR:
- Tasks with one obvious approach fitting a single pass
- Synthesis-heavy work (main Orchestrator)
- Delivery without a `fable-verifier` pass

Deep dive: references/routing-notes.md
