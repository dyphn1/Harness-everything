---
id: E-0028
signature: posix-signal-test-on-windows
class: portability
title: "A test row that expects a process to die by signal ran on Windows, which has no POSIX signals"
sites:
  - ci/mechanism-468-dispatch-cli.test.js
  - ci/fixtures/468-dispatch/runner.js
violates: "AGENTS.md: CI runs Node.js 24 on Ubuntu/Windows/macOS"
scope: in
status: open
mechanism_ref: null
episodes:
  - episode: 493-signal-readiness-row
    feature: "#468 dispatch CLI readiness signal row (PR #493)"
    date: 2026-11-21
    closed: true
    rounds:
      - round: 0
        change: null
        review: "hosted Windows self-regression, run 44843275644"
        result: "The fixture runner sent itself SIGTERM to test the signal outcome; Windows reports exit 1 with no signal, so the row failed."
      - round: 1
        change: "`8da983a0` runs the signal row only where POSIX signals exist"
        review: "hosted CI green on three OSes; owner merge"
        result: "episode closed"
  - episode: 552-posix-fixture-hook-on-windows
    feature: "#552 ledger-pairs fixture hook (PR #559)"
    date: 2026-11-28
    closed: true
    rounds:
      - round: 0
        change: null
        review: "hosted Windows self-regression, run 46114230887"
        result: "The `prepared-commit driver accepts and rejects through the fixture hook` case in `ci/mechanism-552-ledger-pairs.test.js` drives a POSIX shell husky hook and commitlint shim; on hosted Windows `self-regression` the accept case returned `accepted: false` (run 46114230887), the only red job of PR #559."
      - round: 1
        change: "Skip that one case on win32 with a `shortcut:` comment (commit `5a0134ba`); the paired run is macOS-only evidence tooling"
        review: "hosted CI"
        result: "Windows job green; episode closed."
---

## Cue

A test or fixture relies on `process.kill(pid, 'SIGTERM')`, `signal` in an exit event, or any other POSIX signal behaviour.

## What happened

macOS and Linux passed locally; only the hosted Windows leg showed that a self-SIGTERM is just exit 1 with `signal: null` there.

## Lesson

- Gate signal rows on `process.platform !== 'win32'` (or assert the Windows exit shape separately) when writing them, not after CI.
- A test that runs a repository shell hook end to end is POSIX-only unless it ports the hook; mark it at authoring time (gate it on `process.platform !== 'win32'`) instead of discovering it on hosted Windows.
- Packets that add process-lifecycle tests name this record next to E-0011.

## Evidence

- PR #493: hosted run 44843275644, fix `8da983a0`.
- PR #559 / #552 (2026-11-28): the ledger-pairs fixture-hook accept case returned `accepted: false` on hosted Windows `self-regression` (run 46114230887); commit `5a0134ba` skips the case on win32 with a `shortcut:` comment.
