---
name: todo-driven-workflow
description: "Enforce a deliberate step-by-step execution loop for complex multi-step or multi-file tasks (Tier 2/3), one sub-task in-progress at a time. USE FOR: \"track a complex multi-step task as todos\", \"work through a multi-file refactor step by step\". DO NOT USE FOR: \"trivial single-file edits\", \"quick questions without implementation\"."
license: Apache-2.0
metadata:
  author: Miya Daniel
  version: 0.3.4
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
| **Expected Output** | TODO state via the native tracker or markdown. |
| **State Mutations** | Updates the native tracker or `tasks/todo.md`. |
| **Enforcement Gate** | ONE active `in-progress` task at a time. |

## Tool Selection

1. Native TODO tool -> primary tracker; complete items immediately.
2. Otherwise -> markdown checklist (`tasks/todo.md`, `.github/harness-everything/todo.md`).

Parallel sub-agents: one worktree each via `using-git-worktrees`.

## Execution Loop: Think > Try > Summarize > Record

1. [Think] State the goal; break into 3-7 verifiable sub-tasks.
2. [Record] Initialize the native tracker, or create the markdown checklist, before code changes.
3. Per task: mark one item in-progress -> execute -> verify -> mark it complete.
4. On blockers: add a concrete blocked/follow-up item to the same tracker.

Harness no longer ships a todo CLI. The native tracker or a workspace markdown
checklist is the canonical record; this skill does not create a second state
machine or require a process exit code to advance.

Deep dive: references/execution-guide.md
