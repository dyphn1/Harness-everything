---
name: using-git-worktrees
description: Use when starting feature work needing isolation or before implementation plans - recommends an isolated workspace via native tools or git worktree fallback
license: Apache-2.0
metadata:
  author: Miya Daniel
  version: 0.8.1
---

# Using Git Worktrees

Use native worktree support first; raw Git is the fallback.

## Contract

- **Major workflow guidance** — Tier 3 / Fable-class engineering is safer in a linked worktree before broad source/artifact mutation. Reuse one or create one when practical.
- **Ordinary mode** — isolation-needing feature work may honor an explicit user preference to stay in place.
- Never nest a worktree inside an already isolated worktree.

## Workflow

**Step 0 — Detect isolation** (adapt per `environment-detection`):
```bash
git rev-parse --git-dir
git rev-parse --git-common-dir
git branch --show-current
git rev-parse --show-superproject-working-tree
```
Different git/common dirs and no superproject => already isolated; continue to Step 2. A submodule is a normal repo for this check.

**Step 1 — Create/enter**: prefer native `EnterWorktree`, `/worktree`, or `--worktree`. Otherwise use `git worktree add "$path" -b "$BRANCH_NAME"`. Prefer an already-ignored or external/sibling path. If creation/entry fails, report it and continue only with explicit awareness of the isolation risk.

**Step 2 — Setup**: install project dependencies as needed.

**Step 3 — Baseline**: run relevant tests/build before implementation when useful; surface existing failures before relying on the baseline.

Deep dive: <this-skill-dir>/references/workflow-details.md

## USE FOR:
- Tier 3 / Fable-class mutable engineering
- feature work needing isolation
- pre-implementation-plan setup

## DO NOT USE FOR:
- nesting inside an existing worktree
- read-only analysis with no mutation
- branch/merge workflows unrelated to workspace isolation
