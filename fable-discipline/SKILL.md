---
name: fable-discipline
description: Guard fable-mode context, stage scope, handoffs, commit boundaries, and build-divergence signals without adding independent hard stops.
license: Apache-2.0
metadata:
  author: Miya Daniel
  version: 0.4.0
---

# Fable Discipline

## Skill Contract

| Component | Specification |
| :--- | :--- |
| **Trigger / Input** | Background shadow while `fable-mode` is active. |
| **Expected Output** | Compact milestone state, verified handoffs, and commit-boundary guidance. |
| **State Mutations** | None directly. |
| **Enforcement Gate** | Build divergence is a warning signal and does not hard-stop execution; Rule-of-3 owns mandatory reflection. |

## USE FOR:
- staged `fable-mode` work
- context/scope discipline
- handoffs and divergence signals

## DO NOT USE FOR:
- standalone or routine small edits

## Core Rules

1. **MUST** compact state after milestones; **SHOULD** avoid irrelevant broad reads.
2. **MUST** know the CWD. If the user/host has authorized commits, **SHOULD** keep independent logic blocks separate; otherwise leave changes uncommitted.
3. Outgoing agents **MUST** leave a state manifest; incoming agents **MUST** verify it.
4. On divergence, **MUST** surface risk and recommend `zoom-out`; **SHOULD** map dependencies. Do not create a separate hard stop.

Deep dive: <this-skill-dir>/references/discipline-rules.md
