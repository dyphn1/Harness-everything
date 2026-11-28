---
id: E-0030
signature: stale-checkout-runs-merged-tool
class: tooling-friction
title: "A tool fix was merged but the coordinator ran the tool from a checkout that had not pulled it"
sites:
  - scripts/dispatch.js
violates: "AGENTS.md: Never report \"it works\" from code reading. Name the evidence layer"
scope: in
status: open
mechanism_ref: null
episodes:
  - episode: 499-dispatch-effort-before-pull
    feature: "#394 packets HC2/HO2 dispatched after PR #499 merged"
    date: 2026-11-21
    closed: true
    rounds:
      - round: 0
        change: null
        review: dispatch CLI
        result: "Both dispatches returned 10 INVALID_INPUT (unknown option --effort): the main checkout was still on the pre-#499 commit."
      - round: 1
        change: "git pull --ff-only, then re-dispatch"
        review: dispatch CLI
        result: "both runs 0 DONE"
  - episode: 1125-clone-local-stale-main
    feature: "stage-close ledger packet errors-1125 (after PRs #519-#521 merged)"
    date: 2026-11-25
    closed: true
    rounds:
      - round: 0
        change: null
        review: coordinator inspection of the clone
        result: "A throwaway clone made with `git clone --local` of the main checkout used `origin/main`, which in the clone is the source checkout's local `main` branch (not yet pulled, three merges behind GitHub); the worker started without E-0031/E-0032."
      - round: 1
        change: "killed the worker; recreated the clone on the explicit SHA of the source checkout's `origin/main` after `git fetch`"
        review: coordinator inspection
        result: "worker saw E-0001..E-0032 and completed"
  - episode: 553-clone-origin-stale-local-main
    feature: "#553 E1 runtime retirement (PR #556)"
    date: 2026-11-27
    closed: false
    rounds:
      - round: 0
        change: null
        review: "G3 gate"
        result: "Local clones of the main checkout had `origin` set to the stale local main, so the first G3 gate ran on the wrong base."
      - round: 1
        change: "Fetch the GitHub URL explicitly or pin the SHA, then re-run G3"
        review: unknown
        result: unknown
---

## Cue

You just merged a PR that changes a tool you are about to use.

## Lesson

Pull the checkout you run the tool from (or run it from the merged worktree) before the next use.

## Evidence

- PR #499 merge `8fc5205c`; HC2/HO2 first dispatch logs (local).
- Episode 2026-11-25: in a `git clone --local` throwaway clone, `origin/main` is the source checkout's local `main`, not the remote. Base worker clones on an explicit fetched SHA (`git -C <source> rev-parse origin/main` after `git fetch`).
- #553 (2026-11-27): second occurrence after episode 1125-clone-local-stale-main. Local clones of the main checkout had a stale `origin`, so the first G3 gate ran on the wrong base. Round 1 fetches the GitHub URL explicitly or pins the SHA, then re-runs G3.
