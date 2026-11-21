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
---

## Cue

A test or fixture relies on `process.kill(pid, 'SIGTERM')`, `signal` in an exit event, or any other POSIX signal behaviour.

## What happened

macOS and Linux passed locally; only the hosted Windows leg showed that a self-SIGTERM is just exit 1 with `signal: null` there.

## Lesson

- Gate signal rows on `process.platform !== 'win32'` (or assert the Windows exit shape separately) when writing them, not after CI.
- Packets that add process-lifecycle tests name this record next to E-0011.

## Evidence

- PR #493: hosted run 44843275644, fix `8da983a0`.
