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
---

## Cue

You just merged a PR that changes a tool you are about to use.

## Lesson

Pull the checkout you run the tool from (or run it from the merged worktree) before the next use.

## Evidence

- PR #499 merge `8fc5205c`; HC2/HO2 first dispatch logs (local).
