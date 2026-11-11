---
id: E-0016
signature: adr-draft-omits-approved-outline-row
class: draft-omission
title: "A cycle-B ADR draft omitted a reading-list row from its approved outline; the independent final review caught it"
sites:
  - docs/adr/ROUTE-001-error-lesson-delivery.md
  - "approved outline (commit 4320fce8)"
  - docs/workflows/harness-everything.md
violates: "Blocker class: the positive path cannot deliver the agreed scope; a required requirement or evidence is missing (issue #421, comment 6785927033, section 5)."
scope: in
status: open
mechanism_ref: null
episodes:
  - episode: 431-route-001-outline-row-omitted
    feature: "#431 cycle B (ROUTE-001 ADR draft)"
    date: 2026-11-11
    closed: true
    rounds:
      - round: 0
        change: null
        review: "PR #431 independent final review"
        result: "Blocker: the draft at commit 171bc079 left out the reading-list row for docs/workflows/harness-everything.md that the approved outline (4320fce8) contained. Nothing compared the draft against the approved outline. The review at 27e0a6ff reported this as its one blocker: the reading list was incomplete for Rule-of-3 contract sources."
      - round: 1
        change: "Commit 6a997cc9: reading-list row restored and the Rule-of-3 host boundary stated in route-001"
        review: "PR #431 targeted re-check"
        result: "Closed: the reading-list row is present"
---

## Cue

A draft is written from an approved outline, and a row the outline enumerates (a reading-list entry, a section) is missing from the draft. Nothing compares the two before the final review.

## What happened

On 2026-11-11 the cycle-B worker wrote the ROUTE-001 ADR draft (commit `171bc079`). The draft omitted the reading-list row for `docs/workflows/harness-everything.md`, which the approved outline (`4320fce8`) contained. No step compared the draft's rows with the outline's rows. The independent final review (`27e0a6ff`) caught it as its one blocker, because the reading list was incomplete for the Rule-of-3 contract sources. The fix is commit `6a997cc9`, and a targeted re-check closed it.

## Lesson

When a draft is produced from an approved outline, compare the outline's enumerated rows (reading list, sections) with the draft mechanically, or as a named review step, before the final review. Do not rely on the final review to find omissions.

Class difference from E-0014: E-0014 is a deletion during cleanup under a fuzzy equality rule; this is an omission during generation, with no deletion and no equality rule involved.

## Evidence

- PR #431 (cycle B, ROUTE-001 ADR): draft `171bc079`, independent final review at `27e0a6ff`, fix `6a997cc9`, targeted re-check closed it.
- Approved outline `4320fce8`; issue #421, comment 6785927033 (the blocker-class definition).
