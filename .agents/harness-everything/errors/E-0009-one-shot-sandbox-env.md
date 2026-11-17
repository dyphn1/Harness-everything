---
id: E-0009
signature: one-shot-sandbox-environment
class: tooling-friction
title: "One-shot sandboxed workers lost time to environment limits rather than the task"
sites:
  - "one-shot dispatch command (codex exec)"
  - "claude -p one-shot dispatch command (prompt directly after -p, flags after it)"
  - "read-only reviewer dispatch (fixture scratch directory and report write)"
  - "coordinator monitor script (zsh loop)"
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
  - episode: 412-workflow-state-eperm
    feature: "#412 E1 writer contract, workflow state under codex workspace-write"
    date: 2026-11-08
    closed: false
    rounds:
      - round: 0
        change: null
        review: coordinator
        result: "fix-p2, fix-f1, fix-class, review-13 and review-14 (codex workspace-write) could not persist workflow plan/start state: its path is outside the writable roots (EPERM); each reported a degraded inline disposition"
  - episode: 341-e1-kit-repin-and-425-w6
    feature: "#341 E1 kit re-pin and #425 W6 workers"
    date: 2026-11-10
    closed: false
    rounds:
      - round: 0
        change: null
        review: coordinator
        result: "`npm run verify:all` (fast and full) could not complete inside `codex exec -s workspace-write`: loopback bind EPERM in System One suites, npm cache EPERM, and workflow-state writes outside the writable roots EPERM; workers reported BLOCKED/UNCHECKED"
      - round: 1
        change: "coordinator ran `verify:all -- --fast` outside the sandbox; packets now say \"coordinator runs verify:all\""
        review: coordinator
        result: "5 PASS / 0 FAIL"
  - episode: 2026-11-12-claude-p-prompt-after-variadic-flag
    feature: unknown
    date: 2026-11-12
    closed: false
    rounds:
      - round: 0
        change: null
        review: coordinator
        result: "A claude -p dispatch lost its prompt because a variadic --add-dir came before it. Rule: the prompt goes directly after -p, and the flags after it."
  - episode: 2026-11-17-codex-log-sweep
    feature: "Codex session-log sweep, 2026-11-10 to 2026-11-15 (all one-shot codex exec runs)"
    date: 2026-11-17
    closed: false
    rounds:
      - round: 0
        change: null
        review: coordinator
        result: "The owner asked whether Codex kept failing on sandbox or Git boundaries. Git was not the problem: 1 of 252 git commands failed, and no worker ran a git write command. Sandbox EPERM persisted: Harness workflow-disposition could not write workflow-obligations under the Harness workspace state dir in 24 sessions (once each, still unfixed since the 2026-11-08 episode); loopback bind in 20 outputs over 9 sessions; `ps` blocked in 14 outputs over 12 sessions; `diff <(...)` process substitution blocked in 4. Workers recorded each as sandbox-UNCHECKED without retrying (max 6 per session)."
  - episode: 2026-11-17-monitor-script-word-split
    feature: "coordinator monitor script"
    date: 2026-11-17
    closed: false
    rounds:
      - round: 0
        change: null
        review: coordinator
        result: 'A coordinator monitor loop `for x in "a b c"; do set -- $x` did not word-split under zsh, so the check hung and was killed.'
      - round: 1
        change: "replaced the loop with a per-agent function"
        review: unknown
        result: "Fixed. No closing review is recorded, so the episode stays open."
---

## Cue

A sandboxed one-shot worker reports FAIL or stalls on loopback, temp-directory or stdin behaviour unrelated to its change. A read-only reviewer cannot create its scratch directory or write its report.

## Lesson

Dispatch one-shot `codex exec` with a TMPDIR outside every repository and stdin closed; treat loopback-bind failures as sandbox-UNCHECKED and rerun the fast gate outside the sandbox before accepting. A log ending in `Reading additional input from stdin` is a hang, not progress.

- Grant the pattern the packet's verification needs (e.g. `Bash(node ci/*)`), not only the listed commands.
- Free reviewer models can stop on quota or end without a report: ping the model first, and after one failed delivery prefer a paid runner over a third free attempt.
- Re-violated 2026-11-08: the stdin rule lives only in prose; a dispatch wrapper that always closes stdin would make it a mechanism (not built).
- Recurred 2026-11-10/11 (#341 kit re-pin and #425 W6): `verify:all` fast and full both remain unrunnable inside `codex exec -s workspace-write`. Dispatch arrangement: packets say "coordinator runs verify:all" and workers report the sandbox-UNCHECKED/BLOCKED disposition instead of retrying inside the sandbox.
- Swept 2026-11-17 (Codex logs 11-10 to 11-15): the workflow-state EPERM recurred in 24 sessions, so it has three episodes now (11-07, 11-08, 11-17) and is a `mechanism` candidate. Either the state dir is a writable root of the dispatch, or workflow-disposition degrades silently under a read-only state dir. `ps` and `diff <(...)` are also blocked in the sandbox; use them only outside it.
- Put the prompt directly after `-p` in `claude -p`, and the flags after it. A variadic `--add-dir` placed before the prompt swallowed the prompt on 2026-11-12. Feature and PR unknown.
- zsh does not word-split unquoted parameter expansions by default (bash does). A coordinator monitor loop `for x in "a b c"; do set -- $x` never split, so the check hung and was killed (2026-11-17); it was replaced with a per-agent function.

## Stage 2 read-only review scratch (#396, 2026-11-07)

Two effects, recorded separately:

- **Reviewer:** the read-only reviewer's fixture `mkdtemp` and report write fail with `EPERM`. The fixture tests cannot run, so there is no execution evidence and no persisted report.
- **Worker:** the workflow-state write fails with `EPERM`. Metadata is not recorded, but implementation and tests stay usable. The report must disclose this degraded disposition.

Smallest prevention (proposed): before dispatch, distinguish "repository read-only" from "no writable filesystem". Verify the authorized scratch and report destinations for a test-running reviewer, and the workflow-state destination for a worker. If scratch writes are unavailable, assign source-only review plus a separate authorized test runner; the coordinator preserves the report from returned text. Do not broaden reviewer repository permissions or bypass a sandbox to make tests run.

After the known permission failure, do not rerun the same fixture commands in the unchanged environment. Keep raw nonzero exits and classify the execution layer as environment-blocked / UNCHECKED, not as a product regression or PASS. Close only when the bounded dispatch arrangement is demonstrated, not because another runner's suite passed.

## Evidence

- #341 stage 1-2 packet reports.
- #396 review-5, review-6 and review-7 reports (repeated observations of one capability).
