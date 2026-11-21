---
id: E-0002
signature: report-missing-terminal-status
class: report-protocol
title: "Eight F4 packet reports ended without a column-zero terminal STATUS line"
sites:
  - F4-I2b report
  - F4-T5 report
  - F4-T6 report
  - F4-T7 report
  - F4-T8 report
  - F4-T9 report
  - F4-T10 report
  - F4-T12 report
violates: "End every report with `STATUS: DONE` or `STATUS: BLOCKED: <reason>`."
scope: in
status: lesson
mechanism_ref: null
episodes:
  - episode: 325-f4-report-status
    feature: "#325 F4 credited reconciliation (PR #358)"
    date: 2026-10-22
    closed: false
    rounds: unknown
  - episode: 341-e1-verdict-addendum
    feature: "#341 E1 stage-1 verdict addendum"
    date: 2026-10-29
    closed: true
    rounds:
      - round: 0
        change: null
        review: coordinator
        result: "An addendum was appended after the verdict's `STATUS: DONE`, leaving the terminal line in the middle of the report"
      - round: 1
        change: "Moved the single `STATUS: DONE` back to the last line"
        review: coordinator
        result: "One column-zero terminal STATUS line"
  - episode: 341-e1-writer-contract-review11
    feature: "#412 E1 writer contract, OpenCode review-11"
    date: 2026-11-07
    closed: false
    rounds:
      - round: 0
        change: null
        review: coordinator
        result: "The reviewer's last line was `` `STATUS: DONE` from reading only; ... `` (leading backtick and trailing prose), so no column-zero STATUS line existed; the run was treated as failed and re-dispatched fresh with the exact last-line format stated as an acceptance condition"
  - episode: 412-review13-label-after-status
    feature: "#412 E1 writer contract, review-13 report"
    date: 2026-11-08
    closed: true
    rounds:
      - round: 0
        change: null
        review: coordinator
        result: "review-13 report had a column-zero `STATUS: DONE` followed by a hidden harness-label line, so STATUS was not the terminal line; cause: the repository AGENTS.md rule 'end each final message with the label line' conflicts with 'STATUS is the last line'"
      - round: 1
        change: "packets state 'its last line must be the column-zero STATUS line, nothing after it'"
        review: coordinator
        result: "fix-class and review-14 ended with STATUS as the last line"
  - episode: 425-review2-label-after-status
    feature: "#425 review round 2, `-o` report"
    date: 2026-11-11
    closed: false
    rounds:
      - round: 0
        change: null
        review: "PR #425 review round 2"
        result: "the `-o` report had a trailing `<!-- harness-label … -->` line after a column-zero `STATUS: DONE`; delivered but not terminal — the same rule conflict as episode 412-review13-label-after-status, recurring in a packet that did not state the terminal-line condition"
  - episode: 430-cycle-a-label-after-status
    feature: "#430 cycle A (EVID-001 ADR), `codex exec -o` review reports"
    date: 2026-11-11
    closed: false
    rounds:
      - round: 0
        change: null
        review: coordinator
        result: "Two `codex exec -o` reports (cycle A final review, cycle A re-check) each ended with a column-zero `STATUS: DONE` followed by a hidden harness-label line: delivered, not terminal. No corrective change happened between them. The packets stated the terminal-line condition, yet it did not hold for `-o` reports, because the `-o` report file is the final message."
  - episode: 431-cycle-b-label-after-status
    feature: "#431 cycle B (ROUTE-001 ADR), `codex exec -o` review reports"
    date: 2026-11-11
    closed: false
    rounds:
      - round: 0
        change: null
        review: coordinator
        result: "Three `codex exec -o` reports (cycle B final review, cycle B re-check, cycle B outline review 1). The first two each ended with a column-zero `STATUS: DONE` followed by a hidden harness-label line: delivered, not terminal. Cycle B outline review 1 ended with a false `STATUS: BLOCKED` citing the label/STATUS rule conflict, then a label line. No corrective change happened between the reports. The packets stated the terminal-line condition, yet it did not hold for `-o` reports, because the `-o` report file is the final message."
  - episode: 442-r1-label-after-status
    feature: "#442 R1 review report"
    date: 2026-11-15
    closed: false
    rounds:
      - round: 0
        change: null
        review: coordinator
        result: "The R1 review report (2026-11-15) ended with a column-zero `STATUS: DONE` followed by a hidden harness-label line, so STATUS was not the terminal line: delivered, not terminal. The same label/STATUS conflict as episodes 412, 425, 430 and 431, in another independent feature."
  - episode: 448-rd1-label-after-status
    feature: "#448 RD1/RD2 disposal review reports"
    date: 2026-11-18
    closed: false
    rounds:
      - round: 0
        change: null
        review: coordinator
        result: "RD1's final message, captured with codex exec -o, ended with a column-zero STATUS: DONE followed by a hidden harness-label line: delivered, not terminal. Same cause as episodes 412, 425, 430, 431 and 442: the -o report file is the final message."
      - round: 1
        change: null
        review: coordinator
        result: "RD2's final message, also captured with codex exec -o, again ended with a column-zero STATUS: DONE followed by an HTML harness-label line, although the packet said the STATUS line must be the last line with nothing after it. Recorded root cause: the Harness turn-label rule ('last line of your final message MUST be the label') conflicts with the packet rule ('STATUS is the last line'), and packet prose does not override the host hook. A mechanism is needed; owner decision pending."
  - episode: 394-468-status-extraction
    feature: "#394 / #468 coordinator report handling (PR #494, PR #493)"
    date: 2026-11-20
    closed: false
    rounds:
      - round: 0
        change: null
        review: coordinator
        result: "The coordinator extracted the status for `npm run report -- write --status` with sed and took the trailing harness-label line as STATUS (P1). Separately, `--from-codex-output` rejected R2's raw output because a blank line sat between STATUS and the host label; worked around with a staged copy. Pass `--status` from `grep '^STATUS:'`; the writer gap is a candidate issue."
  - episode: 501-review-body-quotes-label
    feature: "PR #499 review report through the dispatch CLI"
    date: 2026-11-21
    closed: false
    rounds:
      - round: 0
        change: null
        review: "report-writer via dispatch"
        result: "The reviewer quoted a harness-label line inside the report body as a witness; the writer rejected the report (label marker only once at EOF) and dispatch returned 16 REPORT_INVALID although the review was complete. Packets now say not to quote a label line."
---

## Cue

A dispatched packet's report ends without a plain column-zero `STATUS: DONE` or `STATUS: BLOCKED: <reason>` line, so the coordinator cannot tell a finished run from one that stopped early or mangled its own text.

## What happened

Eight retained F4 packet reports (F4-I2b, F4-T5, F4-T6, F4-T7, F4-T8, F4-T9, F4-T10, F4-T12) do not end with a column-zero STATUS line. Some carried a status earlier in the body or inside Markdown formatting. F4-T10 closed as DONE while recording a coverage regression, and a later packet treated a T12 BLOCKED result as a completed RED phase, so the missing terminal line left completion ambiguous.

## Lesson

Every report ends with one plain column-zero `STATUS: DONE` or `STATUS: BLOCKED: <reason>` line. Keep "RED packet completed" and "product GREEN" as separate acceptance criteria rather than overriding the status ad hoc.

When a host rule also requires a trailing line, the packet must state which line is terminal.

## Evidence

- PR #358 (F4), issue #359 (error ledger and per-site ownership proposal); F4 revision `0308386058ad942e2764475d48fd65a013910e1e`.
- Process review of F4 observes the eight reports and the resulting completion ambiguity.

## Episode 2 (2026-10-29, #341)

The coordinator itself, not a dispatched agent, broke the rule by appending a section after an existing terminal `STATUS:` line. Lesson: an addendum is inserted before the STATUS line, never appended to the file. Point-of-action injection is proposed in #394.

## Episode 3 (2026-11-11, #430/#431)

Five `codex exec -o` reports ended with a harness-label line after the terminal `STATUS:` line. They form two independent episodes on the same day with the same cause, one per feature, because each feature is an independent occurrence (see the README): cycle A (#430, 2 reports) and cycle B (#431, 3 reports). Each episode is recorded as a single round 0 because no corrective change happened between its reports. One cycle B report also carried a false `STATUS: BLOCKED`. The owner ruling is recorded in `docs/adr/ROUTE-001-error-lesson-delivery.md`: a report file ends with the raw STATUS line, and the turn message ends with the label. The rule change to AGENTS.md and `docs/routing.md` is a follow-up, so both episodes stay open.

## Episode 4 (2026-11-15, #442)

The R1 review report ended with a harness-label line after its column-zero `STATUS: DONE`. Same label/STATUS conflict as episodes 412, 425, 430 and 431, in another independent feature.

## Episode 5 (2026-11-18, PR #448)

RD1's final message (captured with `codex exec -o`) ended with a harness-label line after its column-zero `STATUS: DONE`. Same label/STATUS conflict as episodes 412, 425, 430, 431 and 442.

## Episode 5, round 1 (2026-11-18, PR #448)

RD2's final message (also captured with `codex exec -o`) again ended with an HTML harness-label line after `STATUS: DONE`, even though the packet stated "nothing after it" — a further occurrence of the same episode, not a new one. Recorded root cause: the Harness turn-label rule ("last line of your final message MUST be the label") conflicts with the packet rule ("STATUS is the last line"); packet prose does not override the host hook. A mechanism is needed; owner decision pending, so the episode stays open.

## Owner direction (2026-11-18)

Owner, verbatim: "我是覺得應該用腳本化 / 回報的時候 / 用腳本 / 例如 / report-cli --context \"xxxxx\" --status \"0\" (success) --error \"xxx\" / 類似這樣 / 讓腳本去產生正規的報表".

Treatment: replace hand-written terminal lines with a script that writes and checks the report (agent supplies body and status; the script adds the single terminal STATUS line, rejects labels or conflicting STATUS lines, and routes `codex exec -o` raw output through the same writer). The proposed contract is drafted in the #437 discussion branch (`docs/discussions/error-handling/details/e0002-report-writer.md` on `discussion/437-e0002-capture-level2`); implementation belongs to #402 / #441.
- #394 / #468 (2026-11-20): sed took the label as STATUS; writer rejected a blank line before the host label (R2, staged-copy workaround).
- PR #499 review (2026-11-21): a quoted label in the body made the writer reject a valid review.
