---
name: git-commit
description: "Generate Angular-style commits after inspecting repo state and staged changes; use only when the user or host workflow has authorized a commit."
license: Apache-2.0
metadata:
  author: Miya Daniel
  version: 0.27.0
---

# Git Commit

## Skill Contract

| Component | Specification |
| :--- | :--- |
| **Trigger / Input** | User requests a commit or the active host/workflow authorizes one. A task phase alone is not authorization. |
| **Expected Output** | Verified Angular-style commit. |
| **State Mutations** | Authorized Git history update only. |
| **Enforcement Gate** | Require commit authorization first; then inspect repo/staged state. |

## Quick Workflow

1. **MUST** confirm authorization, then run `git status`.
2. **MUST** inspect `git diff --cached`; stage only user-authorized targeted files.
3. Unrelated concerns **SHOULD** split unless coupling or explicit user intent justifies one commit; format `<type>(<scope>): <subject>`.
4. Commit, then **MUST** verify with `git log -1`.

## USE FOR:
- authorized commit requests
- conventional commit formatting
- submodule/monorepo commits

## DO NOT USE FOR:
- autonomous commits when a phase concludes
- unauthorized staging
- branching, rebasing, merging, or pushing

Deep dive: <this-skill-dir>/references/commit-flow.md
