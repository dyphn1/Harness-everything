---
id: E-0009
signature: one-shot-sandbox-environment
class: tooling-friction
title: "One-shot sandboxed workers lost time to environment limits rather than the task"
sites:
  - "one-shot dispatch command (codex exec)"
  - ci/mechanism-system-one-provider.test.js
violates: "Shared agent standard: \"Verification includes the CI-equivalent gates ... not only unit tests.\""
scope: in
status: lesson
mechanism_ref: null
episodes:
  - episode: 341-e1-one-shot-dispatch
    feature: "#341 E1 stage 1-2 packets"
    date: 2026-10-29
    closed: true
    rounds:
      - round: 0
        change: null
        review: coordinator
        result: "Every sandboxed fast gate failed only on loopback bind (EPERM) in System One suites; a worker TMPDIR inside the repository made no-Git fixtures find the repository; one reviewer hung on `Reading additional input from stdin`"
      - round: 1
        change: "Worker TMPDIR outside any repository, stdin closed (`< /dev/null`), coordinator reruns `verify:all -- --fast` outside the sandbox"
        review: coordinator
        result: "Later packets reported sandbox-UNCHECKED cleanly; coordinator reruns were 0 FAIL"
---

## Cue

A sandboxed one-shot worker reports FAIL or stalls on loopback, temp-directory or stdin behaviour unrelated to its change.

## Lesson

Dispatch one-shot `codex exec` with a TMPDIR outside every repository and stdin closed; treat loopback-bind failures as sandbox-UNCHECKED and rerun the fast gate outside the sandbox before accepting. A log ending in `Reading additional input from stdin` is a hang, not progress.

## Evidence

- #341 stage 1-2 packet reports.
