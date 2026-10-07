---
name: git-commit
description: "Generate Angular-style commit messages after verifying repo state, submodules, and staged files. Use only for a user-requested or host/workflow-authorized commit; task completion alone is not authorization."
license: Apache-2.0
metadata:
  author: Miya Daniel
  version: 0.27.0
---

# Git Commit (Angular Style)

## 📋 Skill Contract

| Component | Specification |
| :--- | :--- |
| **Trigger / Input** | User requests a commit, or the active host/workflow explicitly authorizes one. A concluded task phase alone is not authorization. |
| **Expected Output** | Clean Angular-style commit via `git commit -m` or temp file (`git commit -F`). |
| **State Mutations** | Authorized Git history update; unrelated working-tree changes remain untouched. |
| **Enforcement Gate** | **MUST** confirm commit authorization first, then run `git status`; nothing staged → prompt user. |

## Quick Workflow

1. **MUST** confirm authorization and run `git status`; no repo → offer `git init` or skip; submodules changed → follow `<this-skill-dir>/guides/SUBMODULES.md`.
2. **MUST** inspect `git diff --cached` before committing. Nothing staged → prompt user / stage only authorized targeted files. Unrelated concerns **SHOULD** be split unless coupling or explicit intent justifies one commit.
3. Format `<type>(<scope>): <subject>` per `<this-skill-dir>/guides/ANGULAR_STYLE.md`. Multiline/Windows → temp file + `git commit -F`.
4. Commit, then **MUST** verify with `git log -1`.

## USE FOR:
- User-requested or host/workflow-authorized commits
- Conventional commit formatting
- Submodule or monorepo commits

## DO NOT USE FOR:
- Autonomous commits merely because a phase concluded
- Staging without authorization
- Branching, rebasing, merging, or pushing

Deep dive: <this-skill-dir>/references/commit-flow.md
