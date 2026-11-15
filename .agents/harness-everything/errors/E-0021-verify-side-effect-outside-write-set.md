---
id: E-0021
signature: verify-side-effect-outside-write-set
class: write-set-overrun
title: "A worker's verification run regenerated distribution copies outside its write-set"
sites:
  - "plugins/harness-everything/skills/harness-everything/scripts/system-one/provider.js (generated copy)"
  - "plugins/harness-everything/skills/harness-everything/scripts/system-one/router.js (generated copy)"
  - "verification runs beyond the packet's list (npm run verify:all -- --fast)"
violates: 'F13 packet write-set: "Edit only files in the write-set below." (write-set: provider.js scoreLive only, router.js routeLive only, ci/mechanism-system-one-live.test.js, the report)'
scope: in
status: open
mechanism_ref: null
episodes:
  - episode: 442-f13-plugin-copies-regenerated
    feature: "#442 F13 live intent stage"
    date: 2026-11-15
    closed: false
    rounds:
      - round: 0
        change: null
        review: "worker self-disclosure in the F13 report"
        result: "The worker's report attributes the regeneration of the plugins/** copies of provider.js and router.js to the verification runs (npm run test:consistency and npm run verify:all). The report itself says verify:all -- --fast was not in the packet's list. The worker did not hand-edit the copies and reports that they match the canonical files. The packet's write-set excluded plugins/**, and the F13 packet does not assign plugin sync to the coordinator (the F12 packet did). No coordinator disposition is recorded."
---

## Cue

A verification run has a side effect (a generator, a sync step, or a broad gate that rewrites distribution copies) on files outside the worker's write-set.

## What happened

The F13 worker ran verification beyond the packet's list, including `verify:all -- --fast`, which the worker's own report calls out as not in the packet's list. The distribution copies of `provider.js` and `router.js` under `plugins/**` were regenerated. The worker disclosed this and did not hand-edit them. The report does not establish which single command performed the regeneration.

## Lesson

Write-sets must list the generated outputs a verification run produces, or the packet must say who runs the sync. Either the coordinator runs the sync and the worker runs only the gates the packet lists, or the worker restores the excluded paths and reports that it did.

## Evidence

- F13 packet write-set and the F13 report's disclosure section.
- Compare E-0009, whose lesson ("coordinator runs verify:all") covers the sandbox side of the same arrangement. It does not cover writes outside the write-set.
