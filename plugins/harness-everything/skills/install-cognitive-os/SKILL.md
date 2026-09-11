---
name: install-cognitive-os
description: "Explain or explicitly apply the Harness cognitive policy: Discover, Think, Try, Summarize, Record. It provides cross-cutting behavior without requiring this skill to be selected before domain skills."
license: Apache-2.0
metadata:
  author: Miya Daniel
  version: 0.3.7
---

# Agent Cognitive OS

The Cognitive OS is policy, not a required peer-skill selection. Supported runtimes should establish the smaller Harness invariant contract before domain-skill execution; this skill remains its human-readable/manual entry point.

## USE FOR:
- Apply or explain Discover → Think → Try → Summarize → Record.
- Debug Harness cognitive behavior.
- Use the policy explicitly on hosts without automatic kernel context.

## DO NOT USE FOR:
- Skill authoring style (`skill-style`) or Git conventions.
- Replacing domain expertise such as `tdd`, `security-review`, or `repo-docs`.

## Skill Contract

| Component | Specification |
| :--- | :--- |
| **Input** | Explicit cognitive-loop use, or a host without automatic Harness kernel context. |
| **Output** | Evidence-grounded work without a fixed domain-skill sequence. |
| **State** | None directly. |
| **Gate** | Completion claims need evidence; repeated same-signature failures require re-planning. |

## Core Loop

1. `[Discover]` Verify relevant workspace state.
2. `[Think]` Establish intent, scope, and failure modes.
3. `[Try]` Make the smallest useful change and gather evidence.
4. `[Summarize]` Ground conclusions in tool output; after 3 same-signature failures use `zoom-out`.
5. `[Record]` Record milestones only when evidence supports them.

Domain skills may define their own tactics and phases. They do not need to invoke this skill first as long as the Harness invariants remain satisfied.

On advisory-only platforms, these rules are guidance rather than hard tool-call gates.

Deep dive: <this-skill-dir>/references/cognitive-loop.md
