---
name: rewrite-commits
description: "Rewrite past Git history to comply with Angular Style conventions. Use when cleaning unpushed commits before a PR, squashing fixups, rewording messages, or reordering history safely with abort on conflict."
license: Apache-2.0
metadata:
  author: Miya Daniel | Harness Core Team
  version: 0.2.0
---

# Rewrite Commits

## 📋 Skill Contract

| Component | Specification |
| :--- | :--- |
| **Trigger / Input** | User requests cleaning, squashing, or rewriting past Git history to comply with Angular Style conventions. |
| **Expected Output** | A rewritten, Angular-Style-compliant commit history on a temporary branch, confirmed against `git log --oneline`. |
| **State Mutations** | Rewrites local Git history on a temp branch first — avoiding direct mutations on main/release branches. |
| **Enforcement Gate** | No bare interactive `git rebase -i` (terminal hangs). Use `git reset --soft` or script editors. On conflict, run `git rebase --abort`. |

## USE FOR:
- Cleaning or squashing past Git commit history
- Rewriting old commit messages to Angular Style conventions
- Restructuring unpushed local history before release

## DO NOT USE FOR:
- Creating new commits on current work (use the `git-commit` skill)
- Rewriting history already pushed to `main`/`master` without explicit human confirmation
- Merge conflict resolution beyond aborting a failed rebase

## Workflow

1. `[Discover]` Run `git log --oneline -n <num>` to confirm the range. If commits were already pushed to remote `main`/`master`, warn and require secondary human confirmation.
2. `[Think] & [Try]` Create a temp branch. Never run bare interactive `git rebase -i`; prefer `git reset --soft HEAD~<N>` plus structured commits, or Node.js scripting (no hardcoded `sed -i`). Messages MUST follow Angular Style per the `git-commit` skill.
3. `[Summarize]` Run `git log --oneline` for confirmation. On merge conflict, run `git rebase --abort`, STOP, and hand over to human decision or trigger `zoom-out`.

Deep dive: references/workflow.md
