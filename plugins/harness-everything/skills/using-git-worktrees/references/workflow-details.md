# Using Git Worktrees — Full Workflow Reference

## Decision Flow

```mermaid
flowchart TD
    Start[Trigger: Need Workspace Isolation] --> CheckIso{1. Already in Worktree?}

    CheckIso -- Yes (GIT_DIR != GIT_COMMON) --> Setup[3. Run Project Setup & Dependencies]
    CheckIso -- No (Normal Repo) --> CheckNative{2. Native Worktree Tool Available?}

    CheckNative -- Yes --> RunNative[Use Native Worktree Tool] --> Setup
    CheckNative -- No --> RunGit[Try git worktree add .worktrees/branch]

    RunGit -- Success --> Setup
    RunGit -- Fails / Denied --> WorkInPlace[Fallback: Work in Place in Current Directory] --> Setup

    Setup --> RunBaseline[4. Verify Clean Test Baseline]
    RunBaseline --> Done[Isolated Workspace Ready]
```

## Step 0 detail

**Submodule guard:** `git-dir` differs from `git-common-dir` inside git submodules as well. Before concluding "already in a worktree," verify you are not in a submodule:

```bash
# If this returns a path, you're in a submodule, not a worktree — treat as normal repo
git rev-parse --show-superproject-working-tree
```

Report with branch state:
- On a branch: "Already in isolated workspace at `<path>` on branch `<name>`."
- Detached HEAD: "Already in isolated workspace at `<path>` (detached HEAD, externally managed). Branch creation needed at finish time."

Has the user already indicated their worktree preference in your instructions? If not, ask for consent before creating a worktree:

> "Would you like me to set up an isolated worktree? It protects your current branch from changes."

Honor any existing declared preference without asking. If the user declines consent, work in place and skip to project setup.

## Step 1a detail — native tools

The user has asked for an isolated workspace. Do you already have a way to create a worktree? It might be a tool with a name like `EnterWorktree`, `WorktreeCreate`, a `/worktree` command, or a `--worktree` flag. If you do, use it and skip to setup.

Native tools handle directory placement, branch creation, and cleanup automatically. Using `git worktree add` when you have a native tool creates phantom state your harness can't see or manage.

Only use the git fallback if you have no native worktree tool available.

## Step 1b detail — directory selection priority

Follow this priority order. Explicit user preference always beats observed filesystem state.

1. **Check your instructions for a declared worktree directory preference.** If the user has already specified one, use it without asking.
2. **Check for an existing project-local worktree directory:** Check if `.worktrees/` or `worktrees/` exists using cross-platform file system tools (`read_file` / `list_dir` or native shell test commands). If found, use it. If both exist, `.worktrees` wins.
3. **If there is no other guidance available**, default to `.worktrees/` at the project root.

### Safety verification (project-local directories only)

**MUST verify directory is ignored before creating worktree:**

```bash
git check-ignore -q .worktrees || git check-ignore -q worktrees
```

**If NOT ignored:** Add to .gitignore, commit the change, then proceed.

**Why critical:** Prevents accidentally committing worktree contents to repository.

### Create the worktree

```bash
# Determine path based on chosen location
path="$LOCATION/$BRANCH_NAME"

git worktree add "$path" -b "$BRANCH_NAME"
cd "$path"
```

**Sandbox fallback:** If `git worktree add` fails with a permission error (sandbox denial), tell the user the sandbox blocked worktree creation and you're working in the current directory instead. Then run setup and baseline tests in place.

## Step 2 detail — project setup

Auto-detect and run appropriate setup:

```bash
# Node.js
if [ -f package.json ]; then npm install; fi

# Rust
if [ -f Cargo.toml ]; then cargo build; fi

# Python
if [ -f requirements.txt ]; then pip install -r requirements.txt; fi
if [ -f pyproject.toml ]; then poetry install; fi

# Go
if [ -f go.mod ]; then go mod download; fi
```

## Step 3 detail — baseline report

If tests fail: report failures, ask whether to proceed or investigate. If tests pass:

```
Worktree ready at <full-path>
Tests passing (<N> tests, 0 failures)
Ready to implement <feature-name>
```
