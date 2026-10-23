---
id: E-0004
signature: prep-fingerprint-recapture
class: test-coupling
title: "Fingerprint-only recaptures and constant re-pins consumed housekeeping dispatches"
sites:
  - ci/prep/doc-reconciliation-red.js
  - ci/mechanism-325-f4-trust-boundary.test.js
  - ci/mechanism-325-f4-invariants.test.js
violates: 'owner re-scope: "The prep runtimeFingerprint and the frozen RED hashes become historical evidence, not GREEN gates."'
scope: in
status: open
mechanism_ref: null
episodes:
  - episode: 325-f4-fingerprint-recapture
    feature: "#325 F4 credited reconciliation (PR #358)"
    date: 2026-10-22
    closed: false
    rounds: unknown
---

## Cue

A review, a merge, or a consolidation changes implementation bytes, and a packet re-captures a prep fingerprint or re-pins a fixed digest while adding no behavior scenario. The suite is green, yet the dispatch produced only maintenance.

## What happened

The prep RED baseline hashed whole source files, so byte drift forced FAIL even when the expected gap outcomes still matched. Recaptures in three dispatches retained the same six expected gaps with no new behavior case; a fourth re-pinned the checker constant after branches merged. Four of 36 F4 dispatches were assigned as housekeeping-only, three stayed so in their reports. Because the constant moved, a later packet had to separate pin drift from an invariant failure. Test lines grew 7.25:1 against product lines, and much of the growth was this maintenance.

## Lesson

Treat review-time fingerprints and frozen RED hashes as historical evidence, and assert desired outcomes plus named still-open limits in the active gate. A recapture or re-pin is a maintenance round, not new coverage: record it as a round of this class instead of counting it as behavior work. Keep the owning behavior assertion stable and let byte pins and mutation recipes be replaceable test implementation.

## Evidence

- PR #358 (F4 credited reconciliation); issue #359 (error ledger and per-site ownership proposal).
- Commit `c271249` re-pins the checker constant after the stack merge; F4 head `0308386`.
