---
id: E-0006
signature: live-kit-host-protocol-mismatch
class: live-harness
title: "Operator live-run kits repeatedly mismatched the real host and provider protocol"
sites:
  - "live operator kit (watcher, run script, prompts, agent definitions)"
  - hooks/scripts/lib/doc-reconciliation-provider.js
violates: "Advisor answer 13: \"Checks, final quality review, reconciliation and Stop | Execute and capture through the real host and shipped consumers.\""
scope: in
status: lesson
mechanism_ref: null
episodes:
  - episode: 341-e1-row17-live-kit
    feature: "#341 E1 row-17 live feasibility cycles (PR #393)"
    date: 2026-10-29
    closed: true
    rounds:
      - round: 0
        change: null
        review: live-run
        result: "Inventory path off by one directory; the watcher crashed before B"
      - round: 1
        change: "Path fixed"
        review: live-run
        result: "Watcher judged reviews at SubagentStop, 50-120 ms before the correlated Agent PostToolUse, so acceptance depended on timing"
      - round: 2
        change: "Wait for SubagentStop and the correlated Agent result"
        review: live-run
        result: "Checks invoked the repository copy of doc-check; the provider correctly rejected them as `implementation-not-installed`"
      - round: 3
        change: "Checks call the installed plugin's doc-check"
        review: live-run
        result: "Three separate check calls produced duplicate doc-lint/link-check events (`event-conflict`) and the final review bound ADR plus index (`scope-mismatch`)"
      - round: 4
        change: "One combined check; ADR-only review binding"
        review: live-run
        result: "Coordinator ran `find` for a mis-stated skill path; an unclassified coordinator shell counted as writer activity (`outline-writer-activity-ambiguous`)"
      - round: 5
        change: "Coordinator limited to Read and Agent; exact skill path supplied"
        review: live-run
        result: "Run 11 FEASIBLE; later the outline reviewer lacked the owner VERI-to-EVID provenance, fixed by giving it the decision text and pinned mapping"
---

## Cue

A live host run fails or stalls on something the product handled correctly: a path, an ordering assumption, which binary a command invokes, a coordinator tool call, or evidence a reviewer was never shown.

## What happened

Roughly eight live Claude Code runs of the row-17 feasibility cycle were consumed by kit defects, each a different signature, before the product's own blockers were isolated. A dry check without the host could not see any of them because they depend on real hook ordering, permission rules, provider registration and reviewer context.

## Lesson

Before spending a live run, preflight the kit against the shipped consumers: resolve every planned command with `resolveDocCheckInvocation`, validate commit messages with commitlint, confirm each referenced path exists, and wait on correlated host events rather than the first one. Give reviewers the authoritative provenance they need to verify claims. The coordinator in a live session uses only tools whose writer classification is known.

## Evidence

- #341, PR #393; stage-1 verdict run 11 (FEASIBLE) after runs 1-10.
