---
name: git-commit
description: "Generate Angular-style commit messages after verifying the environment, submodules, and staged files; use only when the user or host workflow has authorized a commit."
license: Apache-2.0
metadata:
  author: Miya Daniel
  version: 0.27.0
---

# Git Commit (Angular Style)

## 📋 Skill Contract

| Component | Specification |
| :--- | :--- |
| **Trigger / Input** | User requests a commit, or the active host/workflow explicitly authorizes committing. A concluded task phase alone is not authorization. Input: staged git diff. |
| **Expected Output** | Clean Angular-style commit via `git commit -m` or temp file (`git commit -F`). |
| **State Mutations** | Authorized commit updates Git history; unrelated working-tree changes remain untouched. |
| **Enforcement Gate** | Require commit authorization first. Then run `git status`; nothing staged → prompt user; non-git repo → offer `git init` or skip. |

## Quick Workflow

1. **MUST** confirm the user or active host/workflow has authorized a commit; task completion alone never grants authorization. Then **MUST** run `git status`; no repo → offer `git init` or skip; submodules changed → commit first per `<this-skill-dir>/guides/SUBMODULES.md`, including its worktree reachability gate.
2. **MUST** inspect `git diff --cached` before committing. Nothing staged → prompt user / stage only user-authorized targeted files. Unrelated concerns **SHOULD** be split unless coupling or explicit user intent justifies one commit.
3. Format `<type>(<scope>): <subject>` per `<this-skill-dir>/guides/ANGULAR_STYLE.md`. Multiline/Windows → `.git-commit-msg.txt` + `git commit -F`, clean up.
4. `git commit -m "..."`, then **MUST** verify the result with `git log -1`.

## USE FOR:
- Commit request from the user
- Formatting conventional commit messages
- Submodule or monorepo commits

## DO NOT USE FOR:
- Autonomous commits merely because a task phase concluded
- Staging without user confirmation
- Branching, rebasing, merging, pushing
- Non-git dirs where user declines `git init`

Deep dive: <this-skill-dir>/references/commit-flow.md
