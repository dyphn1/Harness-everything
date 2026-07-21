---
name: rewrite-commits
description: Cleans, squashes, or rewrites past Git history to comply with Angular Style conventions safely.
---

# Rewrite Commits

## 📋 Skill Contract

| Component | Specification |
| :--- | :--- |
| **Trigger / Input** | User requests cleaning, squashing, or rewriting past Git history to comply with Angular Style conventions. |
| **Expected Output** | A rewritten, Angular-Style-compliant commit history on a temporary branch, confirmed against `git log --oneline` before being treated as final. |
| **State Mutations** | Rewrites local Git history (via `git rebase -i` or equivalent) on a temp branch first — never in place on the target branch. |
| **Enforcement Gate** | If any target commit has already been pushed to `main`/`master`, **MUST** warn the human and get explicit secondary confirmation before executing. A merge conflict during rebase **MUST** stop execution immediately and hand off to the human or `zoom-out` — no forced resolution. |

Triggered when the user requests to clean, squash, or rewrite past Git history to comply with the team's Angular Style conventions.

## 1. Environment Discovery `[Discover]`
- First, execute `git log --oneline -n <num>` to confirm the range of history the user wants to rewrite.
- **Safety Circuit Breaker**: If the modified commits have already been pushed to the remote `main` or `master` branch, you MUST warn the user: "Rewriting pushed history may cause team conflicts", and require secondary human confirmation before executing.

## 2. Execution Process `[Think] & [Try]`
- Create a temporary branch (Temp Branch) to perform history rewriting to avoid breaking the original history.
- Use interactive rebase (`git rebase -i`) paired with environment tools, or aggregate past changes into single/multiple clean Commits.
- The rewritten commit messages MUST fully comply with the Angular Style conventions in the `git-commit` skill.

## 3. Completion and Validation `[Summarize]`
- Once rewriting is complete, execute `git log --oneline` to let the user confirm the new history tree.
- If a Merge Conflict occurs, STOP immediately, hand over to human decision, or trigger `zoom-out` to seek guidance.
