---
id: E-0005
signature: review-evidence-format-reachability
class: report-protocol
title: "A read-only reviewer could not produce the review evidence format the gate requires"
sites:
  - hooks/scripts/lib/doc-reconciliation-provider.js
  - hooks/scripts/lib/doc-reconciliation-pilot.js
  - docs/doc-workflow-reconciliation.md
  - harness-everything/references/doc-check.md
violates: "#325 F4 acceptance: Pilot ON credits valid evidence (no false PASS)"
scope: in
status: open
mechanism_ref: null
episodes:
  - episode: 325-f4-l3-review-format
    feature: "#325 F4 normal-session credit (PR #358), input 0308386"
    date: 2026-10-23
    closed: false
    rounds:
      - round: 0
        change: null
        review: "Live review-step refusal and read-only diagnosis at 0308386; advisor selects reachable delegation contract"
        result: "Independent Read-only reviewer returned bold approval without artifact digest; review step refused. Plain verdict plus current digest accepted in replay. Delegation fix and closing review unknown."
---

## Cue

A gate accepts evidence only in a structured format, and the agent expected to produce it has neither the format nor the means (for example a shell to hash a file).

## What happened

In the first live normal-session credit run, the independent doc reviewer had Read access only. It returned `**Review verdict: APPROVE**` with a summary and an absolute path. The parser expects a plain `Review verdict:` line and one `Reviewed artifact: <path> sha256:<hex>` line per path, so the verdict was null and the workflow review step was refused. Nothing on the delegation path told the reviewer that format, and it could not compute the digest.

## Lesson

When a gate demands structured evidence, check that the normal producer can reach it: who supplies the format, and who can compute each field. Prefer giving the producer the inputs (the parent computes the digest after the edit and hands over path, digest and the required lines) over loosening the parser or having a hook fill the field in.

## Evidence

- PR #358 (F4), input `0308386`; issue #325 (acceptance), issue #359 (ledger).
