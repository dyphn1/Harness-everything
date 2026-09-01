---
name: install-cognitive-os
description: Defines the fundamental physical laws of behavior — Discover, Think, Try, Summarize, Record — for all Agents. Use this loop before acting on any task to ground progress in verified tool output.
license: Apache-2.0
metadata:
  author: Miya Daniel
  version: 0.3.5
---

# Agent Cognitive OS (Underlying Cognitive System)

## 📋 Skill Contract

| Component | Specification |
| :--- | :--- |
| **Trigger / Input** | Always — the foundational loop; loaded before acting. |
| **Expected Output** | Actions follow Discover → Think → Try → Summarize → Record; Summarize relies on objective verification. |
| **State Mutations** | None directly — provides the meta-loop within which other skills manage state. |
| **Enforcement Gate** | `[Record]` is grounded in verified tool output. A failing step returns to `[Think]`; repeated failures lead to `zoom-out`. |
## USE FOR:
- Structuring any multi-step task with the Discover > Think > Try > Summarize > Record loop
- Grounding progress in verified tool output before recording state

## DO NOT USE FOR:
- Skill authoring style (use `skill-style`) or Git history conventions
- Tasks already governed by a more specific domain skill's own gates

## Core Loop: The State Machine

1. `[Discover]` Verify workspace state first: confirm OS, shell, tooling (`environment-detection`); trace code references instead of assuming.
2. `[Think]` Establish intent before modifying code; evaluate failure modes early.
3. `[Try]` Apply minimal, focused changes; run commands to validate behavior.
4. `[Summarize]` Base conclusions on actual tool outputs (`npm test`, linters, `harness-everything/scripts/verify-gate.js`, `npx github:dyphn1/Harness-everything verify`). On failure, use diagnostics to refine `[Think]`. After 3 consecutive failures, step back to `zoom-out`.
5. `[Record]` Record milestones via the native host tracker or Markdown checklist once verification passes.

On advisory-only platforms hooks cannot block tool calls; gates are self-directed guidance.

Deep dive: references/cognitive-loop.md
