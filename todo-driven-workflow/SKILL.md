---
name: todo-driven-workflow
description: "Enforce a deliberate step-by-step execution loop for complex multi-step or multi-file tasks (Tier 2/3), one sub-task in-progress at a time. USE FOR: \"track a complex multi-step task as todos\", \"work through a multi-file refactor step by step\". DO NOT USE FOR: \"trivial single-file edits\", \"quick questions without implementation\"."
license: Apache-2.0
metadata:
  author: Miya Daniel
  version: 0.3.5
---

# Todo-Driven Workflow

Single-task milestones prevent context drift in Tier 2/3 work.

## USE FOR:
- Track multi-step, multi-file development tasks
- Enforce exactly one active milestone

## DO NOT USE FOR:
- Trivial single-file edits
- Parallel sub-agent state without worktree isolation (`using-git-worktrees`)

## Skill Contract

| Component | Specification |
| :--- | :--- |
| **Trigger / Input** | Tier 2/3 task with a high-level description. |
| **Expected Output** | Native TODO state or a Markdown checklist with verifiable milestones. |
| **State Mutations** | Host-native TODO state or `<workspace>/tasks/todo.md` / `<workspace>/.github/harness-everything/todo.md`. |
| **Enforcement Gate** | Exactly one milestone is `in-progress`; verify before marking it complete. |

## Execution Loop: Think > Try > Summarize > Record

1. [Think] State the goal and split it into 3-7 checkable milestones.
2. [Record] Initialize the native host tracker before edits; if unavailable, create a Markdown checklist.
3. Start exactly one milestone, execute only its scope, and run its named check.
4. Mark it complete only after evidence passes; then start the next milestone.
5. Record blockers in the checklist and escalate after the applicable circuit-breaker threshold.

Native TODO tools take priority. Markdown is the portable fallback; this skill
does not depend on a repository CLI state machine. See `references/execution-guide.md`.
