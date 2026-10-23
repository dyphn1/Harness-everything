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
status: open
mechanism_ref: null
episodes:
  - episode: 325-f4-report-status
    feature: "#325 F4 credited reconciliation (PR #358)"
    date: 2026-10-22
    closed: false
    rounds: unknown
---

## Cue

A dispatched packet's report ends without a plain column-zero `STATUS: DONE` or `STATUS: BLOCKED: <reason>` line, so the coordinator cannot tell a finished run from one that stopped early or mangled its own text.

## What happened

Eight retained F4 packet reports (F4-I2b, F4-T5, F4-T6, F4-T7, F4-T8, F4-T9, F4-T10, F4-T12) do not end with a column-zero STATUS line. Some carried a status earlier in the body or inside Markdown formatting. F4-T10 closed as DONE while recording a coverage regression, and a later packet treated a T12 BLOCKED result as a completed RED phase, so the missing terminal line left completion ambiguous.

## Lesson

Every report ends with one plain column-zero `STATUS: DONE` or `STATUS: BLOCKED: <reason>` line. Keep "RED packet completed" and "product GREEN" as separate acceptance criteria rather than overriding the status ad hoc.

## Evidence

- PR #358 (F4), issue #359 (error ledger and per-site ownership proposal); F4 revision `0308386058ad942e2764475d48fd65a013910e1e`.
- Process review of F4 observes the eight reports and the resulting completion ambiguity.
