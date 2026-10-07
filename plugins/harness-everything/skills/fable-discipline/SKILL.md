---
name: fable-discipline
description: Enforce fable-mode's context discipline as a shadow guard. Use when running staged multi-agent loops to prevent context bloat, cap per-stage output size, keep each stage within its physical token boundaries, and stop agents from reading files outside the current stage's scope.
license: Apache-2.0
metadata:
  author: Miya Daniel
  version: 0.4.0
---

# Fable Discipline (Macro Task Discipline & Safety Net)

## 📋 Skill Contract

| Component | Specification |
| :--- | :--- |
| **Trigger / Input** | Background shadow for the whole duration `fable-mode` is active — not a standalone one-shot trigger. |
| **Expected Output** | State compaction after milestones; commit-boundary guidance when commits are authorized; a state manifest at every sub-agent handoff. |
| **State Mutations** | None of its own — constrains how `fable-mode` and `multi-agent-workspace` mutate state. |
| **Enforcement Gate** | Build-error divergence is a warning signal: surface the regression and recommend `zoom-out`. It does not hard-stop execution; mandatory reflection remains owned by Rule-of-3 or explicit user/host permission boundaries. |

Shadow guard for `fable-mode`: MUST run in the background for its whole duration.

## USE FOR:
- Long architectural tasks under `fable-mode`
- Compacting state after milestones
- Sub-agent handoffs via `multi-agent-workspace`
- Surfacing diverging build errors and recommending reassessment

## DO NOT USE FOR:
- Small tasks where `fable-mode` is not active
- Standalone one-shot invocation (background shadow skill)
- Routine single-file edits

## Core Rules

1. **Anti-context bloat**: After each milestone, compact state and decisions; drop unneeded history. No broad regex without precise conditions; no reading irrelevant files over 1000 lines.
2. **Physical boundaries**: Know your CWD before touching core architecture. If the user/host has authorized commits, keep each independent logic block in its own commit; otherwise leave changes uncommitted and surface the suggested boundary.
3. **Agent handoff**: Outgoing agents MUST leave a state manifest (completed APIs, expected inputs/outputs); incoming agents MUST verify it first.
4. **Divergence signal**: If build errors diverge, surface the regression, recommend `zoom-out`, and map the error dependency graph for the human. Do not create a separate hard stop; Rule-of-3 owns mandatory reflection after repeated same-signature failures.

Deep dive: <this-skill-dir>/references/discipline-rules.md
