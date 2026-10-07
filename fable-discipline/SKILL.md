---
name: fable-discipline
description: Enforce fable-mode context discipline as a shadow guard. Use for staged multi-agent loops to compact state, constrain stage scope, verify handoffs, and surface build divergence without adding an independent hard stop.
license: Apache-2.0
metadata:
  author: Miya Daniel
  version: 0.4.0
---

# Fable Discipline (Macro Task Discipline & Safety Net)

## 📋 Skill Contract

| Component | Specification |
| :--- | :--- |
| **Trigger / Input** | Background shadow for the whole duration `fable-mode` is active — not a standalone trigger. |
| **Expected Output** | State compaction after milestones; authorized commit-boundary guidance; a state manifest at every sub-agent handoff. |
| **State Mutations** | None of its own — constrains how `fable-mode` and `multi-agent-workspace` mutate state. |
| **Enforcement Gate** | Build divergence is a warning signal: surface it and recommend `zoom-out`. Rule-of-3 owns mandatory reflection. |

Shadow guard for `fable-mode`: **MUST** run in the background for its whole duration.

## USE FOR:
- Long architectural tasks under `fable-mode`
- Compacting state after milestones
- Sub-agent handoffs via `multi-agent-workspace`
- Surfacing diverging build errors

## DO NOT USE FOR:
- Small tasks where `fable-mode` is inactive
- Standalone one-shot invocation
- Routine single-file edits

## Core Rules

1. **Anti-context bloat**: After each milestone, **MUST** compact state and decisions; avoid irrelevant broad reads.
2. **Physical boundaries**: **MUST** know the CWD. If commits are authorized, independent logic blocks **SHOULD** remain separate; otherwise leave changes uncommitted.
3. **Agent handoff**: Outgoing agents **MUST** leave a state manifest; incoming agents **MUST** verify it first.
4. **Divergence signal**: **MUST** surface diverging errors and recommend `zoom-out`; **SHOULD** map the dependency graph. Divergence alone does not hard-stop execution.

Deep dive: <this-skill-dir>/references/discipline-rules.md
