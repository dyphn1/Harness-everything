---
id: E-0019
signature: windows-cross-drive-relative-path
class: test-coupling
title: "A test treated path.relative starting with '..' as outside the repository, but on Windows a temp dir on another drive returns an absolute path"
sites:
  - ci/mechanism-2ao-plugin-sync.test.js
  - "ci/mechanism-397-cycle-import.test.js (PR #448 branch; not on main at bd986013)"
violates: 'AGENTS.md: "CI runs Node.js 24 on Ubuntu/Windows/macOS"'
scope: in
status: open
mechanism_ref: null
episodes:
  - episode: 448-cross-drive-temp-dir
    feature: "#448 cycle-import test (Windows self-regression)"
    date: 2026-11-15
    closed: false
    rounds:
      - round: 0
        change: null
        review: "hosted CI self-regression (windows-latest) on PR #448"
        result: "All 3 cases failed. The test asserted path.relative(ROOT, dir).startsWith('..'). The temp dir sits on another drive, so path.relative returns an absolute path, which does not start with '..'."
      - round: 1
        change: "Commit f1f680e9: assert startsWith('..') || path.isAbsolute(rel), plus a path.win32 self-check that runs on every OS"
        review: unknown
        result: "Fixed on the branch. No closing hosted run is recorded. The house pattern already existed in ci/mechanism-2ao-plugin-sync.test.js:24."
---

## Cue

A test (or product code) decides whether a path is inside the repository by checking `path.relative(...)` for a leading `..`, and runs on Windows with a temp directory on another drive.

## What happened

On PR #448 the Windows `self-regression` job failed all three cases in `ci/mechanism-397-cycle-import.test.js`. That test checked `path.relative(ROOT, dir).startsWith('..')`. On Windows the temp directory is on a different drive from the repository, so `path.relative` returns an absolute path. The fix (`f1f680e9`) adds `path.isAbsolute(rel)` to the same check and a `path.win32` self-check.

This is a different failure from E-0011. There the cause was 8.3 short names from `fs.realpathSync`; here it is the cross-drive result of `path.relative`.

## Lesson

To test whether a path is inside a root, use `!rel.startsWith('..') && !path.isAbsolute(rel)`. Do not use `startsWith('..')` alone. Check Windows cases with `path.win32` on every OS, so the logic is exercised without a Windows host.

## Mechanism candidate (not decided)

A portability lint that flags `path.relative(...).startsWith('..')` without an `isAbsolute` check. The owner has not chosen it.

## Evidence

- PR #448, hosted `self-regression (windows-latest)`, failing before `f1f680e9`.
- Fix `f1f680e9` (2026-11-15), on the PR #448 branch; not yet on `origin/main` at `bd986013`.
