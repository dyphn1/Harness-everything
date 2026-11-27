---
id: E-0039
signature: windows-file-id-number-precision
class: portability
title: "File identity compared with Number dev/ino lost precision on Windows, so distinct files looked identical"
sites:
  - scripts/report-writer.js
  - scripts/errors-sync.js
  - error-ledger-bootstrap/scripts/promote.js
  - "doc-check.js (earlier fix 8bc3ddba)"
  - "error-ledger-oracle.js (already bigint)"
violates: 'Issue #548: "every dev/ino identity comparison uses bigint stats" (Windows 64-bit file IDs can exceed Number.MAX_SAFE_INTEGER).'
scope: in
status: mechanism
mechanism_ref: ci/mechanism-548-bigint-identity.test.js
episodes:
  - episode: 548-pr550-bigint-file-identity
    feature: "#548 / PR #550"
    date: 2026-11-26
    closed: true
    rounds:
      - round: 0
        change: null
        review: "hosted Windows self-regression on PR #546 (run 45837690781)"
        result: "`report-writer: output aliases an input file` failed on two distinct files (`raw.txt` vs `report.md`); `fs.statSync()` without `{ bigint: true }` returns `ino` as a Number and Windows 64-bit IDs can exceed the safe integer range. Issue #548 source-traced report-writer, errors-sync and promote as remaining Number-ino sites; doc-check.js had been fixed in 8bc3ddba and the oracle already used bigint."
      - round: 1
        change: "d3cd874b: report-writer, errors-sync and promote compare dev/ino from bigint stats; guard test rejects new Number-ino identity comparisons"
        review: "advisor review r548 f3"
        result: "A positive-inode condition skipped alias rejection, so a parent-directory alias could overwrite the raw input."
      - round: 2
        change: "3c31063d: keep alias rejection when the inode is zero"
        review: "hosted CI and PR #550 merge"
        result: "Merged as PR #550 and issue #548 closed on 2026-11-26. Episode closed."
---

## Cue

A Windows CI row reports two different files as aliases of each other, or an identity check passes locally but fails only on Windows.

## What happened

On PR #546's hosted Windows `self-regression` (run 45837690781), `ci/mechanism-report-writer.test.js:185` failed on the second write: `report-writer: output aliases an input file` for two different files. `fs.statSync()` without `{ bigint: true }` returns `ino` as a Number; Windows 64-bit file IDs can exceed `Number.MAX_SAFE_INTEGER`, so distinct files compared equal. The fix covered report-writer, errors-sync and promote; a guard test now fails on a new Number-ino identity comparison.

## Lesson

Compare file identity from `{ bigint: true }` stats at every `dev`/`ino` site, and keep a guard that rejects a new Number-ino comparison. Distinct Windows IDs are not safe integers. Different failure from E-0011 (8.3 short names from `fs.realpathSync`) and E-0019 (cross-drive `path.relative`): both lose information in path spelling, this one loses it in the numeric file ID.

## Evidence

- Issue #548 (source-traced class, closed); PR #550 (merged 2026-11-26): `d3cd874b`, `3c31063d`.
- Guard test `ci/mechanism-548-bigint-identity.test.js`; earlier bigint fix in `doc-check.js` (`8bc3ddba`).
