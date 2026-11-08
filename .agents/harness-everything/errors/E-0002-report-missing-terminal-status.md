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
