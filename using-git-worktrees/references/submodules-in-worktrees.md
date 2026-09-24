# Submodules inside linked worktrees

A linked worktree of a superproject does **not** share the primary checkout's submodule object store. After `git submodule update --init`, each submodule normally uses a worktree-specific git dir such as:

```text
<super>/.git/worktrees/<worktree-id>/modules/<submodule>
```

The primary checkout uses:

```text
<super>/.git/modules/<submodule>
```

A superproject gitlink records only a commit SHA. It does not publish or copy that commit into the primary checkout. Therefore a submodule commit made only on detached HEAD in a linked worktree can become unreachable when that worktree is removed.

## Required rules

1. **MUST use a named branch before committing in the submodule.** `git submodule update` normally leaves the submodule detached.
2. **MUST make the new submodule commit reachable outside the linked worktree before treating the superproject gitlink bump as deliverable.** Publish it to the submodule remote, or fetch it into the primary checkout's submodule repository.
3. **MUST verify external reachability before removing the linked worktree.** A branch that exists only inside the linked worktree is not sufficient publication evidence.

## Detect the situation

From the superproject worktree:

```bash
git rev-parse --git-dir
git rev-parse --git-common-dir
git submodule status --recursive
git -C <submodule> rev-parse --absolute-git-dir
git -C <submodule> branch --show-current
```

A linked superproject has different git/common dirs. A blank submodule branch means detached HEAD.

PowerShell uses the same Git commands; quote paths containing spaces:

```powershell
git -C "<submodule>" rev-parse --absolute-git-dir
git -C "<submodule>" branch --show-current
```

## Prevent the problem

Before editing or committing in the submodule:

```bash
git -C <submodule> switch -c <task-branch>
# edit + verify
git -C <submodule> add <paths>
git -C <submodule> commit -m "<message>"
SUB_SHA=$(git -C <submodule> rev-parse HEAD)
```

PowerShell:

```powershell
git -C "<submodule>" switch -c "<task-branch>"
# edit + verify
git -C "<submodule>" add <paths>
git -C "<submodule>" commit -m "<message>"
$SubSha = git -C "<submodule>" rev-parse HEAD
```

## Publish before the gitlink is considered deliverable

Preferred path when the submodule has a remote:

```bash
git -C <submodule> push -u origin <task-branch>
git -C <submodule> branch -r --contains "$SUB_SHA"
```

```powershell
git -C "<submodule>" push -u origin "<task-branch>"
git -C "<submodule>" branch -r --contains $SubSha
```

If pushing is not appropriate, copy the commit into the primary checkout's submodule repository. From the linked worktree first give a detached commit a name if necessary:

```bash
git -C <worktree>/<submodule> branch -f <task-branch> <sha>
git -C <primary>/<submodule> fetch <worktree>/<submodule> <task-branch>:<task-branch>
git -C <primary>/<submodule> cat-file -e <sha>^{commit}
```

```powershell
git -C "<worktree>/<submodule>" branch -f "<task-branch>" "<sha>"
git -C "<primary>/<submodule>" fetch "<worktree>/<submodule>" "<task-branch>:<task-branch>"
git -C "<primary>/<submodule>" cat-file -e "<sha>^{commit}"
```

After the commit is externally reachable, stage the gitlink in the superproject:

```bash
git add <submodule>
git diff --cached --submodule=log
```

## Recovery after an unpublished gitlink was already committed

Do **not** remove the linked worktree. Recover the referenced SHA while its submodule object store still exists:

```bash
git -C <worktree>/<submodule> branch -f <task-branch> <sha>
git -C <primary>/<submodule> fetch <worktree>/<submodule> <task-branch>:<task-branch>
git -C <primary>/<submodule> cat-file -e <sha>^{commit}
git -C <primary> submodule update
```

The PowerShell form is identical except paths/refs should be quoted as shown above.

## Pre-removal check

For every changed gitlink SHA, prove at least one external home exists:

```bash
git -C <submodule> branch -r --contains <sha>
# OR, from the primary checkout:
git -C <primary>/<submodule> cat-file -e <sha>^{commit}
```

If neither succeeds, **MUST NOT** remove the linked worktree yet.

## Handoff checklist

For each changed submodule record:

- submodule path
- commit SHA
- branch name
- publication location: remote-tracking ref or primary checkout object store
- superproject gitlink staged/committed state
- reachability check result before worktree removal
