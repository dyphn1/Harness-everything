---
name: install-cognitive-os
description: Defines the Harness cognitive policy — Discover, Think, Try, Summarize, Record — and explains the minimal invariants used across software work. Use it to inspect, teach, debug, or explicitly apply the cognitive loop; domain skills remain free to choose their own tactics.
license: Apache-2.0
metadata:
  author: Miya Daniel
  version: 0.3.7
---

# Agent Cognitive OS (Underlying Cognitive System)

The Cognitive OS is a **policy**, not a required peer-skill selection. On supported hosts, Harness runtime/hooks should establish the relevant invariants before domain-skill routing. This skill remains the canonical human-readable/manual entry point for the cognitive model.

## 📋 Skill Contract

| Component | Specification |
| :--- | :--- |
| **Trigger / Input** | Explicit requests to inspect/apply the cognitive loop, or hosts without an automatic Harness kernel. |
| **Expected Output** | Work is grounded in Discover → Think → Try → Summarize → Record without forcing a fixed domain-skill sequence. |
| **State Mutations** | None directly — domain skills may manage state when useful. |
| **Enforcement Gate** | `[Record]`/completion claims are grounded in verified tool output; repeated same-signature failures require re-planning. |

## USE FOR:
- Structuring multi-step work with Discover → Think → Try → Summarize → Record.
- Explaining or debugging Harness cognitive behavior.
- Applying the policy explicitly when the host cannot inject Harness runtime context.

## DO NOT USE FOR:
- Skill authoring style (use `skill-style`) or Git history conventions.
- Replacing a more specific domain skill's expertise; the policy surrounds domain tactics rather than competing with them.

## Core Loop: The State Machine

1. `[Discover]` Verify relevant workspace state instead of assuming it.
2. `[Think]` Establish intent, scope, and likely failure modes before mutation.
3. `[Try]` Apply the smallest useful change and gather evidence.
4. `[Summarize]` Ground conclusions in actual tool outputs. On failure, refine the diagnosis; after 3 same-signature failures, use `zoom-out` instead of micro-retrying.
5. `[Record]` Record milestones only after the evidence supports them.

## Relationship to Domain Skills

Domain skills such as `tdd`, `security-review`, or `repo-docs` are not children in a mandatory pipeline. A capable agent may select them directly, combine them, or omit them. Harness only requires the cross-cutting invariants established by the kernel: route before execution, verify before claim, and re-plan after repeated failure.

On advisory-only platforms, these invariants remain guidance rather than hard tool-call gates.

Deep dive: <this-skill-dir>/references/cognitive-loop.md
