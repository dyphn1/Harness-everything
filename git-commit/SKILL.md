---
name: git-commit
description: "Generate Angular-style commit messages after verifying the environment, submodules, and staged files; use for explicit commit requests or concluded task phases."
license: Apache-2.0
metadata:
  author: Miya Daniel
  version: 0.3.4
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

1. `git status`; no repo → offer `git init` or skip; submodules changed → commit first per `<this-skill-dir>/guides/SUBMODULES.md`.
2. `git diff --cached`; nothing staged → prompt user / stage targeted files.
3. Format `<type>(<scope>): <subject>` per `<this-skill-dir>/guides/ANGULAR_STYLE.md`. Multiline/Windows → `.git-commit-msg.txt` + `git commit -F`, clean up.
4. `git commit -m "..."`, verify with `git log -1`.

Deep guides:
- `<this-skill-dir>/guides/ANGULAR_STYLE.md` — Conventional structure, scopes
- `<this-skill-dir>/guides/COMMIT_GENERATION.md` — Patterns, diff analysis
- `<this-skill-dir>/guides/LANGUAGE_DETECTION.md` — Subject language rules
- `<this-skill-dir>/guides/MAIN_REPO.md` — Monorepo commits
- `<this-skill-dir>/guides/SUBMODULES.md` — Submodules, nested repos

## USE FOR:
- Commit request from the user
- Formatting conventional commit messages
- Submodule or monorepo commits

## DO NOT USE FOR:
- Staging without user confirmation
- Branching, rebasing, merging, pushing
- Non-git dirs where user declines `git init`

Deep dive: <this-skill-dir>/references/commit-flow.md
