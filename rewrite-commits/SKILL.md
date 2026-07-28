---
name: rewrite-commits
description: Cleans, squashes, or rewrites past Git history to comply with Angular Style conventions safely.
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
| **Enforcement Gate** | Avoid bare interactive `git rebase -i` without non-interactive script editors to prevent terminal hangs. Use `git reset --soft` or automated script editors. On rebase conflict, run `git rebase --abort` to restore clean state. |

Triggered when the user requests to clean, squash, or rewrite past Git history to comply with the team's Angular Style conventions.

## 1. Environment Discovery `[Discover]`
- First, execute `git log --oneline -n <num>` to confirm the range of history the user wants to rewrite.
- **Safety Circuit Breaker**: If the modified commits have already been pushed to the remote `main` or `master` branch, you MUST warn the user: "Rewriting pushed history may cause team conflicts", and require secondary human confirmation before executing.

## 2. Execution Process `[Think] & [Try]`
- Create a temporary branch (Temp Branch) to perform history rewriting to avoid breaking the original history.
- **Non-interactive Execution (Avoid Terminal Hangs)**:
  - Do NOT execute interactive `git rebase -i` without non-interactive script editors configured; bare interactive prompts will freeze the automated terminal indefinitely.
  - Prefer non-interactive history restructuring strategies, such as `git reset --soft HEAD~<N>` followed by structured commits, or cross-platform Node.js scripting for sequence edits (avoid hardcoded `sed -i` commands which fail on Windows).
- The rewritten commit messages MUST fully comply with the Angular Style conventions in the `git-commit` skill.

## 3. Completion and Validation `[Summarize]`
- Once rewriting is complete, execute `git log --oneline` to let the user confirm the new history tree.
- If a Merge Conflict occurs, execute `git rebase --abort` immediately to restore a clean workspace, then STOP and hand over to human decision or trigger `zoom-out`.
