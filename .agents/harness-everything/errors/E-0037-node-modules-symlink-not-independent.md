---
id: E-0037
signature: node-modules-symlink-not-independent
class: process
title: "A RED re-check symlinked a temporary worktree's node_modules to another checkout instead of installing dependencies, so the dependency state was not independent"
sites:
  - "coordinator RED re-check in a temporary worktree"
  - "worktree dependency installation (node_modules)"
violates: "Standing coordinator rule: never symlink a worktree's node_modules to another checkout."
scope: in
status: open
mechanism_ref: null
episodes:
  - episode: 531-red-recheck-symlinked-node-modules
    feature: "PR #531 RED re-check"
    date: 2026-11-25
    closed: false
    rounds:
      - round: 0
        change: null
        review: coordinator
        result: "To re-check a RED, the coordinator symlinked a temporary worktree's `node_modules` to another worktree instead of running a clean install. Lockfiles were identical and the RED reproduced, but the dependency state was not independently established."
---

## Cue

You want to re-check a RED or run a control test in a temporary worktree quickly and consider symlinking its `node_modules` from another checkout.

## What happened

During the PR #531 RED re-check the coordinator symlinked the temporary worktree's `node_modules` to another worktree rather than installing dependencies there. The lockfiles matched and the RED reproduced, so the result looked usable, but the re-check never established its own dependency state. This violates the standing rule against symlinking a worktree's `node_modules` to another checkout.

## Lesson

Install dependencies in the exact worktree or clone you run the control/RED check from. Matching lockfiles do not make a borrowed `node_modules` an independent dependency state: a symlink can hide install-state, platform or resolution differences. Run a clean install so the check establishes its own dependency state.

## Evidence

- PR #531 RED re-check (2026-11-25).
- Related: E-0034 covers `git stash` in an active worker worktree; this record covers borrowed dependency state in a control re-check.
