---
name: todo-driven-workflow
description: "Enforce a deliberate step-by-step execution loop for complex multi-step or multi-file tasks (Tier 2/3), one sub-task in-progress at a time. USE FOR: \"track a complex multi-step task as todos\", \"work through a multi-file refactor step by step\". DO NOT USE FOR: \"trivial single-file edits\", \"quick questions without implementation\"."
license: Apache-2.0
metadata:
  author: Miya Daniel | Harness Core Team
  version: 0.3.3
---

# Todo-Driven Workflow

Single-task milestones prevent context drift (Tier 2/3).

## USE FOR:
- Track multi-step, multi-file development tasks
- Enforce single-task execution discipline

## DO NOT USE FOR:
- Trivial single-file edits
- Parallel sub-agent state without worktree isolation (`using-git-worktrees`)

## Skill Contract

| Component | Specification |
| :--- | :--- |
| **Trigger / Input** | Tier 2/3 task; high-level description. |
| **Expected Output** | TODO state via native tool, CLI, or markdown. |
| **State Mutations** | Updates `.claude/harness-state/todo-state.json` or `tasks/todo.md`. |
| **Enforcement Gate** | ONE active `in-progress` task at a time. |

## Tool Selection

1. Native TODO tool -> primary tracker; complete items immediately.
2. Else Node.js works -> `node "<this-skill-dir>/scripts/todo-cli.js"`.
3. Neither -> markdown checklist (`tasks/todo.md`, `.github/harness-everything/todo.md`).

Parallel sub-agents: one worktree each via `using-git-worktrees`.

## Execution Loop: Think > Try > Summarize > Record

1. [Think] State the goal; break into 3-7 verifiable sub-tasks.
2. [Record] Init before code changes:
   `node "<this-skill-dir>/scripts/todo-cli.js" init "Task 1" "Task 2"`
3. Per task: `todo-cli.js start <id>` -> execute -> verify -> `complete <id>`.
4. On blockers: `node "<this-skill-dir>/scripts/todo-cli.js" add "Fix specific error"`

Deep dive: references/execution-guide.md
