---
name: fable-mode
description: Plan and execute complex Tier 3 macro tasks by breaking multi-domain requirements into architectural milestones and delegating sub-agents. Use for multi-domain work or major scaffolding; outputs milestone TODO plans, sub-agent briefs, verified gates.
license: Apache-2.0
metadata:
  author: Miya Daniel | Harness Core Team
  version: 0.3.3
---

# Fable Mode (Macro Task Planning & Execution Engine)

## 📋 Skill Contract

| Component | Specification |
| :--- | :--- |
| **Trigger / Input** | Tier 3 Task; multi-domain requirement or scaffolding. |
| **Expected Output** | Breakdown, milestone TODOs, handoffs, verification. |
| **State Mutations** | TODO checklist via `todo-driven-workflow` (`manage_todo_list`, `todo-cli.js`, `tasks/todo.md`). |
| **Enforcement Gate** | Run `harness-everything/scripts/verify-gate.js` or tests at boundaries. |

## Workflow

1. **Plan** with `fable-discipline`: deconstruct into bounded sub-tasks; **Scope Lock**: define the authorized file scope first, block anything outside it.
2. **Track**: load `todo-driven-workflow` (`manage_todo_list` / `todo-cli.js` / `tasks/todo.md`).
3. **Delegate** via `create-agent-launcher` with bounded briefs; persona role-switch if no sub-agent tool.
4. **Verify**: check output against `hooks/scripts/subagent-scope-guard.js`; integration-test at milestones.
5. **Gate**: fan out QA/Security/Performance audits of the Git Diff via `create-agent-launcher`; regress on any `Blocker`.
6. **Transition** to `tdd` for standard features.

## Sub-Skills
`execution-guardrails/`, `fable-haiku/`, `agents/fable-orchestrator` (spawn via Task tool).

## USE FOR:
- "plan this multi-domain feature end to end"
- "break this requirement into milestones"
- "delegate subtasks to agents"
- "orchestrate major scaffolding"

## DO NOT USE FOR:
- Standard Tier 2 features or bugfixes (use `tdd`)
- Single-file edits or small refactors

Deep dive: references/execution-phases.md
