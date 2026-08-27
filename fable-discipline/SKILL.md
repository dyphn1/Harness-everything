---
name: fable-discipline
description: Enforce fable-mode's context discipline as a shadow guard. Use when running staged multi-agent loops to prevent context bloat, cap per-stage output size, keep each stage within its physical token boundaries, and stop agents from reading files outside the current stage's scope.
license: Apache-2.0
metadata:
  author: Miya Daniel
  version: 0.3.4
---

# Fable Discipline (Macro Task Discipline & Safety Net)

## 📋 Skill Contract

| Component | Specification |
| :--- | :--- |
| **Trigger / Input** | Background shadow for the whole duration `fable-mode` is active — not a standalone one-shot trigger. |
| **Expected Output** | State compaction after milestones; one Git commit per independent logic block; a state manifest at every sub-agent handoff. |
| **State Mutations** | None of its own — constrains how `fable-mode` and `create-agent-launcher` mutate state. |
| **Enforcement Gate** | **HALTS execution immediately** if build errors diverge (more fixes → more breakage); forces `zoom-out` instead of continued patching. |

Shadow guard for `fable-mode`: MUST run in the background for its whole duration.

## USE FOR:
- Long architectural tasks under `fable-mode`
- Compacting state after milestones
- Sub-agent handoffs via `create-agent-launcher`
- Halting on diverging build errors

## DO NOT USE FOR:
- Small tasks where `fable-mode` is not active
- Standalone one-shot invocation (background shadow skill)
- Routine single-file edits

## Core Rules

1. **Anti-context bloat**: After each milestone, compact state and decisions; drop unneeded history. No broad regex without precise conditions; no reading irrelevant files over 1000 lines.
2. **Physical boundaries**: Know your CWD before touching core architecture; one Git commit per independent logic block.
3. **Agent handoff**: Outgoing agents MUST leave a state manifest (completed APIs, expected inputs/outputs); incoming agents MUST verify it first.
4. **Circuit breaker**: If build errors diverge, HALT, call `zoom-out`, and map the error dependency graph for the human.

Deep dive: references/discipline-rules.md
