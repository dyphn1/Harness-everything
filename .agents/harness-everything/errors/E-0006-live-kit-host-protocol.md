---
id: E-0006
signature: live-kit-host-protocol-mismatch
class: live-harness
title: "Operator live-run kits repeatedly mismatched the real host and provider protocol"
sites:
  - "live operator kit (watcher, run script, prompts, agent definitions)"
  - hooks/scripts/lib/doc-reconciliation-provider.js
  - "opencode-plugin/index.mjs (OpenCode V2 event loop and router runtime, #397)"
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
  - episode: 397-opencode-v2-host-shape
    feature: "#397 OpenCode V2 observation (fix/397-opencode-router-node)"
    date: 2026-11-15
    closed: false
    rounds:
      - round: 0
        change: null
        review: live-run
        result: "Live O1 attempt on OpenCode 2.1.4 produced 0 host records. Traced to the router spawn using process.execPath, which is the opencode binary under Bun (O2)."
      - round: 1
        change: "O2 (input 2fa9d6d4): harnessRuntime() runs the router with node when process.versions.bun is set"
        review: unknown
        result: "Next host shape: V2 sends no session.idle. The turn ends on session.execution.succeeded, with the id at data.sessionID (O3)."
      - round: 2
        change: "O3 (input f7addfc0): the V2 loop resolves the session id from data.sessionID and treats session.execution.succeeded as a turn end"
        review: unknown
        result: "Next host shape: V2 context messages use type and content[], not role and parts (O4)."
      - round: 3
        change: "O4 rev 2 (input 9051c28e): assistantTextForCurrentTurn reads V2 type and content[] text items"
        review: unknown
        result: "The point rounds ended once a key-only trace of the real V2 shapes was recorded (per the 2026-11-15 test-oracle lesson). That trace is not a closing review and the packet sources do not re-record it, so the episode stays closed false."
---

## Cue

A live host run fails or stalls on something the product handled correctly: a path, an ordering assumption, which binary a command invokes, a coordinator tool call, or evidence a reviewer was never shown.

## What happened

Roughly eight live Claude Code runs of the row-17 feasibility cycle were consumed by kit defects, each a different signature, before the product's own blockers were isolated. A dry check without the host could not see any of them because they depend on real hook ordering, permission rules, provider registration and reviewer context.

## Lesson

Before spending a live run, preflight the kit against the shipped consumers: resolve every planned command with `resolveDocCheckInvocation`, validate commit messages with commitlint, confirm each referenced path exists, and wait on correlated host events rather than the first one. Give reviewers the authoritative provenance they need to verify claims. The coordinator in a live session uses only tools whose writer classification is known.

## Evidence

- #341, PR #393; stage-1 verdict run 11 (FEASIBLE) after runs 1-10.

## Episode 2 (2026-11-15, #397)

Three host-shape findings after discovery: the router runtime under Bun, the V2 turn-end event, and the V2 message shape. The lesson above applies as written. Record one live trace of the real shapes before writing the fix packet.
