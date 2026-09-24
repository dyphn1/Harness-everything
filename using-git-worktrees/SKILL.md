---
name: using-git-worktrees
description: Use when work needs isolation or before major implementation plans - resolves workspace isolation via native tools or git worktree fallback, with an explicit degraded fallback when isolation is unavailable
license: Apache-2.0
metadata:
  author: Miya Daniel
  version: 0.19.1
---

# Using Git Worktrees

Use native worktree support first; raw Git is the fallback.

## Contract

- **Tier 3 / Fable (MUST resolve)** — before broad source/artifact mutation, reuse/create a verified linked worktree. If isolation is unavailable or the user explicitly chooses to stay in place, MUST report an explicit degraded fallback/risk before continuing.
- **Ordinary mode (SHOULD)** — use isolation when it materially reduces collision/risk; explicit user preference may keep work in place.
- **MUST NOT** nest a worktree inside an already isolated worktree.

## Workflow

**Step 0 — Detect isolation** (adapt per `environment-detection`):
```bash
git rev-parse --git-dir
git rev-parse --git-common-dir
git branch --show-current
git rev-parse --show-superproject-working-tree
git submodule status --recursive
```
Different git/common dirs and no superproject => already isolated; continue to Step 2. A submodule is a normal repo for this check. If submodules exist, **MUST** read `<this-skill-dir>/references/submodules-in-worktrees.md` before committing inside them.

**Step 1 — Create/enter**: use native `EnterWorktree`, `/worktree`, or `--worktree` first; otherwise use `git worktree add "$path" -b "$BRANCH_NAME"`. Use an already-ignored or external/sibling path when possible. If creation/entry fails, MUST surface the degraded isolation disposition before continuing.

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
