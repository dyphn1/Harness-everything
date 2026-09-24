---
name: using-git-worktrees
description: Use when work needs isolation or before major implementation plans - resolves workspace isolation via native tools or git worktree fallback, with an explicit degraded fallback when isolation is unavailable
license: Apache-2.0
metadata:
  author: Miya Daniel
  version: 0.25.1
---

# Using Git Worktrees

Use native worktree support first; raw Git is fallback.

## Contract

- **Tier 3 / Fable (MUST resolve)** — isolate before broad mutation. If unavailable or explicitly declined, MUST report an explicit degraded fallback/risk.
- **Ordinary mode SHOULD** isolate when it materially reduces collision/risk.
- **MUST NOT** nest a worktree inside an isolated worktree.

## Workflow

**Step 0 — Detect**:
```bash
git rev-parse --git-dir
git rev-parse --git-common-dir
git branch --show-current
git rev-parse --show-superproject-working-tree
git submodule status --recursive
```
Different git/common dirs and no superproject => already isolated. If submodules exist, **MUST** read `<this-skill-dir>/references/submodules-in-worktrees.md` before committing inside them.

**Step 1 — Create/enter**: use native `EnterWorktree`, `/worktree`, or `--worktree`; otherwise `git worktree add "$path" -b "$BRANCH_NAME"`. On failure, MUST surface the degraded disposition.

**Step 2 — Setup**: install dependencies as needed.

**Step 3 — Baseline**: run relevant tests/build when useful; surface existing failures.

Deep dive: <this-skill-dir>/references/workflow-details.md

## USE FOR:
- Tier 3 / Fable mutable engineering
- feature work needing isolation
- pre-implementation-plan setup

## DO NOT USE FOR:
- nesting inside an existing worktree
- read-only analysis
- unrelated branch/merge workflows
