---
id: E-0010
signature: runtime-provenance-packet-local-reference
class: provenance-reference
title: "A runtime trust pin cited an approval path inside a working packet that installed and public consumers cannot follow"
sites:
  - "hooks/scripts/lib/doc-reconciliation-provider.js (OUTLINE_INVENTORY_PIN.rowDomainMappings[].approvalRef)"
  - plugins/harness-everything/hooks/scripts/lib/doc-reconciliation-provider.js
violates: "D6: \"Repoint to a durable record (post the owner decision on #325 and cite the comment URL).\""
scope: in
status: lesson
mechanism_ref: null
episodes:
  - episode: 393-outline-pin-approval-ref
    feature: "#393 pinned outline inventory (merged); D6 fix reviewed on #396"
    date: 2026-10-29
    closed: true
    rounds:
      - round: 0
        change: null
        review: unknown
        result: "Pinned VERI to EVID mapping `approvalRef` pointed to a relative path inside a working packet, not to a repository or durable record"
      - round: 1
        change: "Commit `3732b134`: `approvalRef` repointed to the #325 owner-decision comment `6706805112` (https://github.com/dyphn1/Harness-everything/issues/325#issuecomment-6706805112); inventory digest and mapping semantics unchanged"
        review: review-5
        result: "No D6 finding; review-5 reports successful comment verification. Review-7's comment fetch timed out: inconclusive corroboration, not a new defect or a reversal."
---

## Cue

A runtime trust pin or validator cites an approval or provenance reference that resolves only inside a working packet directory.

## What happened

The VERI to EVID row mapping pinned in the outline inventory cited an approval path relative to a packet. Installed and public consumers cannot follow a path outside the repository. The owner decision was posted on #325, and the reference was repointed to comment `6706805112`. The inventory digest and the mapping semantics did not change.

## Lesson

Pins and validators cite durable references: a public issue or PR comment URL, or a repository-relative path. A working-packet path is a note, not provenance. The existing exact-reference assertion protects this pin only; it does not validate future provenance references. A durable URL shape alone does not prove that the comment records the claimed decision.

## Evidence

- Fix `3732b134` (D6 change within the commit); review-5 found no D6 issue.
- Review-7's comment fetch timed out, so it is inconclusive corroboration only.
- #393 (path merged), #396 (D6 review).
