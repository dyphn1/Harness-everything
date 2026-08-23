---
name: using-git-worktrees
description: Use when starting feature work needing isolation or before implementation plans - ensures an isolated workspace via native tools or git worktree fallback
license: Apache-2.0
metadata:
  author: Miya Daniel | Harness Core Team
  version: 0.3.3
---

# Using Git Worktrees

Native worktree tools first, git fallback.

## 📋 Skill Contract

| Component | Specification |
| :--- | :--- |
| **Trigger / Input** | Isolation-needing feature work; pre-plan setup. |
| **Expected Output** | Isolated workspace plus clean test baseline. |
| **State Mutations** | Creates `.worktrees/<branch>`; updates `.gitignore` if needed. |
| **Enforcement Gate** | Detect existing isolation first; seamless sandbox fallback. |

## Workflow

**Step 0 — Detect existing isolation** (adapt per `environment-detection`):
```bash
git rev-parse --git-dir
git rev-parse --git-common-dir
git branch --show-current
git rev-parse --show-superproject-working-tree
```
Dirs differ and no superproject → already isolated; skip to Step 2; never nest. Superproject → submodule (normal repo). Else honor declared preference or ask consent; declined → in place.

**Step 1 — Create**: native tool (`EnterWorktree`, `/worktree`, `--worktree`) first — raw git creates phantom state. Else verify ignored via `git check-ignore -q .worktrees || git check-ignore -q worktrees`; unignored → add to .gitignore and commit. Then `git worktree add "$path" -b "$BRANCH_NAME"` at declared preference, existing `.worktrees/`/`worktrees/`, or default `.worktrees/`. Sandbox denial → work in place.

**Step 2 — Setup**: npm/cargo/pip/poetry/go.

**Step 3 — Baseline**: run tests (`npm test`/`cargo test`/`pytest`/`go test ./...`); failures → report, ask.

Deep dive: references/workflow-details.md

## USE FOR:
- feature work needing isolation
- pre-implementation-plan setup
- native vs manual `git worktree add`

## DO NOT USE FOR:
- nesting inside an existing worktree
- branch/merge workflows
