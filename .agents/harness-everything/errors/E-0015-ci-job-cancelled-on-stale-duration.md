---
id: E-0015
signature: ci-job-cancelled-on-stale-duration
class: process
title: "A healthy hosted CI job was cancelled as hung, judged against a remembered duration instead of the job's recent runs"
sites:
  - ".github/workflows/ci.yml (job `self-regression`, windows-latest leg; no `timeout-minutes` on the job)"
  - "coordinator CI monitoring (`gh pr checks` pending waiter)"
violates: "Coordinator rule (2026-11-11): before calling a CI job hung, compare with the same job's duration on the last 3 completed runs (`gh run view <id> --json jobs`)."
scope: in
status: open
mechanism_ref: null
episodes:
  - episode: 430-windows-self-regression-cancelled
    feature: "#430 (Windows self-regression duration)"
    date: 2026-11-11
    closed: false
    rounds:
      - round: 0
        change: null
        review: coordinator
        result: "Windows `self-regression` job cancelled at 41 min as hung. The remembered figure (10-13 min) was stale; the same job had run 38-53 min on recent completed runs and passes. Cost: a rerun (about 40+ min) and corrections posted on #349 and #392."
---

## Cue

A hosted CI job runs longer than a remembered duration, and the coordinator calls it hung and cancels it without checking that job's recent run times.

## What happened

On PR #430 the Windows `self-regression` job was cancelled at 41 minutes. The coordinator judged it stuck against a remembered duration of 10-13 minutes. Recent completed runs show 38-53 minutes for the same job, and it passes. The cancellation forced a rerun of about 40+ minutes, and the coordinator had to post corrections on #349 and #392.

The job has no `timeout-minutes`, so nothing bounds it except the platform limit. #349 tracks the duration and reliability work.

## Lesson

Before calling a CI job hung, compare its elapsed time with the same job's duration on its last 3 completed runs (`gh run view <id> --json jobs`). Judge against that measured range, not a remembered figure.

Wait for a run with `gh run view <id> --json status` until it is `completed`. A waiter that polls `gh pr checks` for `pending` exits early when a run is cancelled.

## Evidence

- PR #430; Windows `self-regression` cancelled at 41 minutes on 2026-11-11, then rerun.
- Corrections posted on #349 (CI duration) and #392 (test-environment watch list).
- `.github/workflows/ci.yml`: the `self-regression` job has no `timeout-minutes` (checked 2026-11-11).
