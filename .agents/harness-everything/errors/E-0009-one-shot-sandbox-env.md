---
id: E-0009
signature: one-shot-sandbox-environment
class: tooling-friction
title: "One-shot sandboxed workers lost time to environment limits rather than the task"
sites:
  - "one-shot dispatch command (codex exec)"
  - "read-only reviewer dispatch (fixture scratch directory and report write)"
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
  - episode: 341-e1-stage2-haiku-allowlist
    feature: "#412 E1 stage-2 one-shot workers"
    date: 2026-11-07
    closed: false
    rounds:
      - round: 0
        change: null
        review: coordinator
        result: "one-shot `claude -p` workers had an allowlist of only the packet's named commands; mid-run every other `node ci/*` regression suite required approval, so three consecutive packets reported provider-loading regressions as not run; the coordinator ran 7, 7 and 15 suites afterwards (all exit 0)"
  - episode: 412-free-reviewer-delivery
    feature: "#412 E1 writer contract, OpenCode free-model review-11"
    date: 2026-11-08
    closed: false
    rounds:
      - round: 0
        change: null
        review: coordinator
        result: "Three review-11 attempts on free models delivered no accepted report: no column-zero STATUS line (E-0002), `Free usage limit reached` mid-run, then a run that exited 0 without writing the report; the coordinator stopped after three and parked the review for a paid runner"
  - episode: 341-e1-stage2-readonly-review-scratch
    feature: "#396 E1 stage 2 reviewer and worker dispatch"
    date: 2026-11-07
    closed: false
    rounds:
      - round: 0
        change: null
        review: "review-5, review-6, review-7"
        result: "Read-only reviewer: fixture `mkdtemp` and report write failed with EPERM, so the fixture tests were unrunnable (review-5/6/7 are repeated observations of this one missing capability). Worker: workflow-state write failed with EPERM, so metadata was not recorded; implementation and tests remained usable."
  - episode: 412-review11d-stdin-hang
    feature: "#412 review-11d (codex exec luna)"
    date: 2026-11-08
    closed: true
    rounds:
      - round: 0
        change: null
        review: coordinator
        result: "review-11d was launched without `< /dev/null`; the log ended at `Reading additional input from stdin...` and the run hung about 6 hours with no report (the stdin lesson from episode 1 was re-violated)"
      - round: 1
        change: "re-dispatched fresh as review-11e with `< /dev/null`"
        review: coordinator
        result: "review-11e delivered in 15 minutes with `STATUS: DONE`"
---

## Cue

A sandboxed one-shot worker reports FAIL or stalls on loopback, temp-directory or stdin behaviour unrelated to its change. A read-only reviewer cannot create its scratch directory or write its report.

## Lesson

Dispatch one-shot `codex exec` with a TMPDIR outside every repository and stdin closed; treat loopback-bind failures as sandbox-UNCHECKED and rerun the fast gate outside the sandbox before accepting. A log ending in `Reading additional input from stdin` is a hang, not progress.

- Grant the pattern the packet's verification needs (e.g. `Bash(node ci/*)`), not only the listed commands.
- Free reviewer models can stop on quota or end without a report: ping the model first, and after one failed delivery prefer a paid runner over a third free attempt.
- Re-violated 2026-11-08: the stdin rule lives only in prose; a dispatch wrapper that always closes stdin would make it a mechanism (not built).

## Stage 2 read-only review scratch (#396, 2026-11-07)

Two effects, recorded separately:

- **Reviewer:** the read-only reviewer's fixture `mkdtemp` and report write fail with `EPERM`. The fixture tests cannot run, so there is no execution evidence and no persisted report.
- **Worker:** the workflow-state write fails with `EPERM`. Metadata is not recorded, but implementation and tests stay usable. The report must disclose this degraded disposition.

Smallest prevention (proposed): before dispatch, distinguish "repository read-only" from "no writable filesystem". Verify the authorized scratch and report destinations for a test-running reviewer, and the workflow-state destination for a worker. If scratch writes are unavailable, assign source-only review plus a separate authorized test runner; the coordinator preserves the report from returned text. Do not broaden reviewer repository permissions or bypass a sandbox to make tests run.

After the known permission failure, do not rerun the same fixture commands in the unchanged environment. Keep raw nonzero exits and classify the execution layer as environment-blocked / UNCHECKED, not as a product regression or PASS. Close only when the bounded dispatch arrangement is demonstrated, not because another runner's suite passed.

## Evidence

- #341 stage 1-2 packet reports.
- #396 review-5, review-6 and review-7 reports (repeated observations of one capability).
