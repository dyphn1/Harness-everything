---
id: E-0034
signature: git-stash-in-active-worker-worktree
class: process
title: "The coordinator ran bare git stash / git stash pop inside an active worker's worktree to run a base control test"
sites:
  - "coordinator base-control testing (git stash / git stash pop in a worker worktree)"
  - "shared git stash stack across worktrees"
violates: unknown
scope: in
status: open
mechanism_ref: null
match:
  actions:
    - tool: shell
      executable: git
      subcommand: stash
episodes:
  - episode: 518-p518-stash-in-worker-worktree
    feature: "#518 packet P518"
    date: 2026-11-25
    closed: false
    rounds:
      - round: 0
        change: null
        review: coordinator
        result: "Ran bare `git stash` / `git stash pop` inside a worktree where a one-shot Codex worker was still editing files, in order to run a base control test. The stash stack is shared by all worktrees; the pop restored the worker's edits (verified by file count), but a concurrent worker write or another session's stash could have been lost."
---

## Cue

You want to run a control test on the base commit while a worker has uncommitted edits in a worktree, and reach for `git stash` / `git stash pop` inside that worktree.

## What happened

During #518 (packet P518), the coordinator ran a bare `git stash` / `git stash pop` inside a worktree where a one-shot Codex worker was still actively editing files, to run a control test on the base. Git's stash stack is repository-wide and shared across all worktrees. Although the pop restored the worker's edits (verified by file count), a concurrent worker write during the stash window or a stash entry from another session could have been overwritten or lost.

## Lesson

- Never run `git stash` or `git stash pop` inside a worker's worktree (especially while a worker is still active).
- Run base-control tests in a separate clone or a fresh worktree created at the base SHA (`git worktree add --detach <path> <base-sha>`).

## Evidence

- #518 packet P518 (2026-11-25).
- Related: E-0014 covers lossy cleanup/disposal (such as `git worktree remove` deleting excluded report directories); this record covers mutating an active worker's worktree and the shared stash stack.
