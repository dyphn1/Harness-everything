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
  - "coordinator launcher script (zsh loop)"
  - "agy -p one-shot dispatch command (headless permissions)"
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
  - episode: 2026-11-18-provider-model-retirement
    feature: "tooling (default free runners)"
    date: 2026-11-18
    closed: true
    rounds:
      - round: 0
        change: null
        review: "coordinator pre-dispatch ping"
        result: "The default free runners `opencode/glm-5.3-flash-free` (deprecated) and `nvidia/deepseek-ai/deepseek-v4.1-flash` (end of life 2026-11-16) stopped working; a ping before dispatch caught it, so no dispatch was lost."
  - episode: 394-packets-ask-sandbox-for-ledger-and-gates
    feature: "#394 packets S, HC, HO (PR #501)"
    date: 2026-11-21
    closed: true
    rounds:
      - round: 0
        change: null
        review: "worker reports"
        result: "packet S put .agents/** in a codex workspace-write write-set (sandbox EPERM, a recorded gotcha) → BLOCKED; packets HC/HO asked sandboxed workers to run verify:all --fast (loopback EPERM, >15 min) → both hit the 45-minute dispatch RUN_TIMEOUT."
      - round: 1
        change: "coordinator applied the .agents edits and regenerates the index; continuation packets forbid verify:all for sandboxed workers"
        review: "HC2/HO2/FX reports + coordinator verify:all"
        result: "all completed within budget; coordinator verify:all 13 PASS / 0 FAIL"
  - episode: 453-zsh-launcher-bash-uppercase
    feature: "#453 coordinator dispatch (zsh launcher loop)"
    date: 2026-11-24
    closed: false
    rounds:
      - round: 0
        change: null
        review: coordinator
        result: "A zsh launcher loop used bash-only `${p^^}` (uppercase expansion); zsh failed with \"bad substitution\" and the background launcher silently started no worker, noticed only by the absence of logs."
  - episode: 453-p0-agy-headless-permission-deny
    feature: "#453 packet P0 attempt 1 (agy -p one-shot runner)"
    date: 2026-11-24
    closed: false
    rounds:
      - round: 0
        change: null
        review: coordinator
        result: "`agy -p` exited 0 with no report when headless mode auto-denied the `read_file` permission (`jetski: no output produced — a tool required the \"read_file\" permission that headless mode cannot prompt for, so it was auto-denied.`)."
      - round: 1
        change: "Pass `--settings '{\"permissions\":{\"allow\":[\"command(*)\",\"read_file(*)\"]}}'` to `agy -p`"
        review: unknown
        result: "Settings allowlist applied; exit code 0 is not success — only the report STATUS line counts. No closing review is recorded, so the episode stays open."
  - episode: 516-p516-sandbox-fast-gate-timeout
    feature: "#516 repair packets P516-A / P516-A2 (PR #521)"
    date: 2026-11-25
    closed: false
    rounds:
      - round: 0
        change: null
        review: coordinator
        result: "A Codex (GPT-6-Luna xhigh) repair packet for #516 (P516-A2) ran 65+ minutes; its own `verify:all -- --fast` inside the sandbox did not finish within the 45-minute packet limit, so it reported `STATUS: BLOCKED` although the fix itself was RED->GREEN. The original P516-A also ran ~65 min. Repeats the existing lesson: packets should not ask sandboxed workers to run the full fast gate when the coordinator re-runs it outside the sandbox anyway."
  - episode: 498-sandbox-fast-gate
    feature: "#498 packets P498-A and P498-F (PR #531)"
    date: 2026-11-25
    closed: false
    rounds:
      - round: 0
        change: null
        review: coordinator
        result: "Two packets asked sandboxed Codex workers to run `npm run verify:all -- --fast`; System One tests cannot bind 127.0.0.1 in the sandbox (EPERM). P498-A marked the gate UNCHECKED; P498-F reported `STATUS: BLOCKED` only because of that gate although its fix was RED->GREEN. The coordinator re-ran the gate outside the sandbox (5 PASS / 0 FAIL) in both cases."
  - episode: 553-ponytail-stop-line-after-ready
    feature: "#553 E1 runtime retirement (PR #556)"
    date: 2026-11-27
    closed: false
    rounds:
      - round: 0
        change: null
        review: "dispatch exit status (managed dispatch C8)"
        result: "Packet P1 attempt 1 (codex gpt-6-luna xhigh): a host plugin (ponytail) Stop hook appended a line after the worker's `READY`, so the dispatch exited `12 NOT_READY`."
      - round: 1
        change: "Re-dispatched fresh with the per-run env `PONYTAIL_DEFAULT_MODE=off` (no config change)"
        review: "dispatch exit status"
        result: "`0 DONE`"
  - episode: 553-zsh-unsplit-var-list
    feature: "#553 E1 runtime retirement (PR #556)"
    date: 2026-11-27
    closed: false
    rounds:
      - round: 0
        change: null
        review: coordinator
        result: "2026-11-27: a coordinator-generated `git rm $files` in zsh did not word-split an unquoted `$var` list, so the whole string was treated as one path."
      - round: 1
        change: "Build the list with arrays or python"
        review: coordinator
        result: "2026-11-28: the same unquoted-list failure recurred in a packet list; fixed with arrays / python. No closing check is stated."
  - episode: 552-bash-empty-array-set-u
    feature: "#552 paired-run launcher (PR #559)"
    date: 2026-11-28
    closed: true
    rounds:
      - round: 0
        change: null
        review: coordinator
        result: 'A coordinator runner script for the 24-arm paired run used "${a[@]}" on an empty array under `set -u` in macOS bash 3.2 (`a[@]: unbound variable`); two of three parallel streams (16 arms) never started while the third reported success and the aggregate waiter exited 0. Fixed with ${a[@]+"${a[@]}"} and reran; episode closed. Same class as `553-zsh-unsplit-var-list` (shell array/word-split portability).'
---

## Cue

A sandboxed one-shot worker reports FAIL or stalls on loopback, temp-directory or stdin behaviour unrelated to its change. A read-only reviewer cannot create its scratch directory or write its report.

## Lesson

Dispatch one-shot `codex exec` with a TMPDIR outside every repository and stdin closed; treat loopback-bind failures as sandbox-UNCHECKED and rerun the fast gate outside the sandbox before accepting. A log ending in `Reading additional input from stdin` is a hang, not progress.

- Grant the pattern the packet's verification needs (e.g. `Bash(node ci/*)`), not only the listed commands.
- Free reviewer models can stop on quota or end without a report: ping the model first, and after one failed delivery prefer a paid runner over a third free attempt. A default free model can also be retired; the same pre-dispatch ping catches that (episode 11).
- Re-violated 2026-11-08: the stdin rule lives only in prose; a dispatch wrapper that always closes stdin would make it a mechanism (not built).
- Recurred 2026-11-10/11 (#341 kit re-pin and #425 W6): `verify:all` fast and full both remain unrunnable inside `codex exec -s workspace-write`. Dispatch arrangement: packets say "coordinator runs verify:all" and workers report the sandbox-UNCHECKED/BLOCKED disposition instead of retrying inside the sandbox.
- Swept 2026-11-17 (Codex logs 11-10 to 11-15): the workflow-state EPERM recurred in 24 sessions, so it has three episodes now (11-07, 11-08, 11-17) and is a `mechanism` candidate. Either the state dir is a writable root of the dispatch, or workflow-disposition degrades silently under a read-only state dir. `ps` and `diff <(...)` are also blocked in the sandbox; use them only outside it.
- Put the prompt directly after `-p` in `claude -p`, and the flags after it. A variadic `--add-dir` placed before the prompt swallowed the prompt on 2026-11-12. Feature and PR unknown.
- zsh does not word-split unquoted parameter expansions by default (bash does). A coordinator monitor loop `for x in "a b c"; do set -- $x` never split, so the check hung and was killed (2026-11-17); it was replaced with a per-agent function.
- Avoid bash-only parameter expansions such as `${p^^}` in coordinator zsh launcher scripts (use zsh `${(U)p}` or `tr`); a "bad substitution" error in a background launcher silently starts no worker. Verify that the expected worker log appears right after launch.
- For headless `agy -p` one-shot runs, pass `--settings '{"permissions":{"allow":["command(*)","read_file(*)"]}}'` so required tools are not auto-denied. Treat exit code 0 without a report as a failed run; only the report's terminal `STATUS:` line counts (see also E-0002, E-0024).
- A host plugin can append a line after a one-shot's readiness line or terminal line. Launch one-shots with the host plugin's output mode off for that run only, through the per-run env (for example `PONYTAIL_DEFAULT_MODE=off`), not through config. Related: E-0002 (a host line after the terminal STATUS).
- A multi-stream runner must count expected vs finished units, not trust the aggregate waiter's exit code: an empty-array expansion under `set -u` stopped two of three streams while the third reported success and the waiter exited 0. Same class as the zsh unsplit-var-list episode (shell array/word-split portability).

## Stage 2 read-only review scratch (#396, 2026-11-07)

Two effects, recorded separately:

- **Reviewer:** the read-only reviewer's fixture `mkdtemp` and report write fail with `EPERM`. The fixture tests cannot run, so there is no execution evidence and no persisted report.
- **Worker:** the workflow-state write fails with `EPERM`. Metadata is not recorded, but implementation and tests stay usable. The report must disclose this degraded disposition.

Smallest prevention (proposed): before dispatch, distinguish "repository read-only" from "no writable filesystem". Verify the authorized scratch and report destinations for a test-running reviewer, and the workflow-state destination for a worker. If scratch writes are unavailable, assign source-only review plus a separate authorized test runner; the coordinator preserves the report from returned text. Do not broaden reviewer repository permissions or bypass a sandbox to make tests run.

After the known permission failure, do not rerun the same fixture commands in the unchanged environment. Keep raw nonzero exits and classify the execution layer as environment-blocked / UNCHECKED, not as a product regression or PASS. Close only when the bounded dispatch arrangement is demonstrated, not because another runner's suite passed.

## Evidence

- #341 stage 1-2 packet reports.
- #396 review-5, review-6 and review-7 reports (repeated observations of one capability).
- #553 P1 attempt 1 (2026-11-27, PR #556): ponytail Stop hook line after `READY` gave `12 NOT_READY`; relaunch with `PONYTAIL_DEFAULT_MODE=off` gave `0 DONE`.
- #553 (2026-11-27/28, PR #556): unquoted zsh `$var` list did not word-split, twice; fixed with arrays / python. Repeat of 2026-11-17-monitor-script-word-split.

## Episode 11 (2026-11-18, tooling)

The default free runners `opencode/glm-5.3-flash-free` (deprecated) and `nvidia/deepseek-ai/deepseek-v4.1-flash` (end of life 2026-11-16) stopped working. A ping before dispatch caught it, so no run was lost. Different shape from sandbox EPERM: the runner itself was retired; the existing "ping the model first" lesson covers it. E-0020 covers concurrency on a shared key, not provider retirement.
- PR #501 (2026-11-21): S BLOCKED report and HC/HO RUN_TIMEOUT; continuation packets HC2/HO2.
- #453 (2026-11-24): coordinator zsh launcher failed with "bad substitution" on bash-only `${p^^}` and silently started no worker.
- #453 packet P0 attempt 1 (2026-11-24): `agy -p` exited 0 with no report after headless auto-deny on `read_file`; fixed with `--settings '{"permissions":{"allow":["command(*)","read_file(*)"]}}'`.
- PR #521 (merged as `ae7a0260`, 2026-11-25): #516 packets P516-A and P516-A2 each ran ~65+ min because P516-A2 ran `verify:all -- --fast` inside the sandbox past the 45-minute limit and reported `STATUS: BLOCKED` despite the fix being RED->GREEN.
- #498 packets P498-A/P498-F (2026-11-25): sandbox fast-gate loopback EPERM again; coordinator re-ran it outside the sandbox, 5 PASS / 0 FAIL in both cases.
- PR #559 / #552 (2026-11-28): an empty-array `"${a[@]}"` under `set -u` in macOS bash 3.2 stopped two of three parallel streams (16 arms) while the waiter exited 0; fixed with the `${a[@]+"${a[@]}"}` form and rerun.
