---
name: git-commit
description: "Generate Angular-style commit messages after verifying the environment, submodules, and staged files; use for explicit commit requests or concluded task phases."
license: Apache-2.0
metadata:
  author: Miya Daniel
  version: 0.19.1
---

# Git Commit (Angular Style)

## 📋 Skill Contract

| Component | Specification |
| :--- | :--- |
| **Trigger / Input** | User requests a commit, or a task phase concludes. Input: staged git diff. |
| **Expected Output** | Clean Angular-style commit via `git commit -m` or temp file (`git commit -F`). |
| **State Mutations** | Git tree updated; working tree becomes clean. |
| **Enforcement Gate** | Run `git status` first; nothing staged → prompt user; non-git repo → offer `git init` or skip. |

## Quick Workflow

1. **MUST** run `git status`; no repo → offer `git init` or skip; submodules changed → commit first per `<this-skill-dir>/guides/SUBMODULES.md`, including its worktree reachability gate.
2. **MUST** inspect `git diff --cached` before committing. Nothing staged → prompt user / stage only user-authorized targeted files. Unrelated concerns **SHOULD** be split unless coupling or explicit user intent justifies one commit.
3. Format `<type>(<scope>): <subject>` per `<this-skill-dir>/guides/ANGULAR_STYLE.md`. Multiline/Windows → `.git-commit-msg.txt` + `git commit -F`, clean up.
4. `git commit -m "..."`, then **MUST** verify the result with `git log -1`.

## USE FOR:
- Commit request from the user
- Formatting conventional commit messages
- Submodule or monorepo commits

## DO NOT USE FOR:
- Staging without user confirmation
- Branching, rebasing, merging, pushing
- Non-git dirs where user declines `git init`

Deep dive: <this-skill-dir>/references/commit-flow.md
