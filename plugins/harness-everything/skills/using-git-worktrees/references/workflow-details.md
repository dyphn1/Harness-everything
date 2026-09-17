# Using Git Worktrees — Full Workflow Reference

## Decide whether isolation is mandatory

Tier 3 / Fable-class engineering requires Git isolation before the first source
or artifact mutation. Read-only discovery may remain in the bound repository.
Durable multi-agent workspace state is separate: a staged run may need no
multi-agent workspace and still require Git isolation.

Ordinary feature work may honor an explicit preference to stay in place.
Mandatory mode has no in-place fallback for a declined helper, unavailable
native tool, sandbox denial, or creation failure; report `blocked`.

## Detect existing isolation

Inspect absolute Git paths and the registered worktree list:

```bash
git rev-parse --absolute-git-dir
git rev-parse --path-format=absolute --git-common-dir
git rev-parse --show-superproject-working-tree
git worktree list --porcelain
```

Reuse a registered linked checkout of the bound repository; never nest another
worktree inside it. A submodule or unrelated repository is not sufficient proof.
Record the resolved directory and branch (or detached HEAD) in the handoff.

## Create and enter

Honor an existing directory preference. Prefer a host-native worktree facility
when available, then verify that it is backed by a registered Git worktree.
Otherwise use Git:

```bash
git worktree add "<isolated-path>" -b "<task-branch>"
```

For mandatory mode, choose an already-ignored project-local path or an external
sibling path. Verify the exact project-local candidate with `git check-ignore`.
Do not edit/commit the primary tree's ignore file just to permit worktree setup.
If the native facility fails, a permitted Git fallback is valid; if neither can
establish isolation, stop mutable work as blocked.

Set each subsequent tool's working-directory field to the isolated path and
keep artifact targets inside it. Entering a worktree does not authorize an
absolute edit, patch move, or shell target back into the primary checkout.
Resolve symlinks/junctions when verifying target scope.

## Setup and baseline

Install the detected dependencies inside the isolated checkout, then run the
relevant baseline tests/build before implementation. Surface existing failures
with exact output and distinguish them from regressions introduced by the task.
Continue fixing task-relevant failures within the user's authorized scope.

For active Fable workflows, enter the correlated run through the router's
displayed controller before dependency installation or artifact mutation. The
session's `workflow-stages.json` bootstrap file is runtime state; it is not an
exception for source changes.

## Evidence boundary

The workflow gate checks registered Git identity, direct/patch target paths,
known shell side effects, and explicit outside paths. It is not a filesystem
sandbox for arbitrary script bodies or indirect side effects. Preserve the
platform capability boundary and report unsupported hook/metadata paths.