---
name: using-git-worktrees
description: Use when starting feature work needing isolation or before implementation plans - ensures an isolated workspace via native tools or git worktree fallback
license: Apache-2.0
metadata:
  author: Miya Daniel
  version: 0.4.0
---

# Using Git Worktrees

Use native worktree support first; raw Git is the fallback.

## Contract

- **Major workflow mode** — Tier 3 / Fable-class engineering must be isolated before source/artifact mutation. Reuse an existing linked worktree or create one. If isolation cannot be established, stop `BLOCKED`; never fall back to the primary working tree.
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

**Step 1 — Create/enter**: prefer native `EnterWorktree`, `/worktree`, or `--worktree`. Otherwise use `git worktree add "$path" -b "$BRANCH_NAME"`. For major mode, choose an already-ignored or external/sibling path so setup does not require modifying the primary tree first. Creation/entry failure => `BLOCKED`. Only ordinary mode may continue in place after an explicit decline/unsupported environment.

**Step 2 — Setup**: install project dependencies as needed.

**Step 3 — Baseline**: run the relevant tests/build in the isolated tree before implementation; existing failures must be surfaced before mutation proceeds.

Deep dive: <this-skill-dir>/references/workflow-details.md

## USE FOR:
- Tier 3 / Fable-class mutable engineering
- feature work needing isolation
- pre-implementation-plan setup

## DO NOT USE FOR:
- nesting inside an existing worktree
- read-only analysis with no mutation
- branch/merge workflows unrelated to workspace isolation
