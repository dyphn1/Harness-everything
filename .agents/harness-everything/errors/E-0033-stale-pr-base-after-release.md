---
id: E-0033
signature: stale-pr-base-after-release
class: process
title: "A semantic-release commit landed on main while an open PR stayed on the previous base, making doc-governance flag package.json as REVIEW_REQUIRED"
sites:
  - "package.json (trustSurface path)"
  - "doc-governance CI job"
  - "open PR branches after a merge or semantic-release commit on main"
violates: "Standing coordinator lesson: anything merges to main, including a semantic-release chore(release) commit -> re-check open PRs."
scope: in
status: open
mechanism_ref: null
episodes:
  - episode: 520-release-commit-stale-pr-base
    feature: "PR #520 (doc-governance check after chore(release): 1.0.0)"
    date: 2026-11-25
    closed: true
    rounds:
      - round: 0
        change: null
        review: "hosted CI doc-governance job on PR #520"
        result: "A semantic-release commit (`chore(release): 1.0.0`, `a4a25194`) landed on main while PR #520's branch was still based on the previous main. `doc-governance` compared the stale branch against the new base, saw `package.json` (a trustSurface path) with its version going backwards, and returned `REVIEW_REQUIRED`."
      - round: 1
        change: "Merged `origin/main` into PR #520's branch"
        review: "hosted CI doc-governance job on PR #520"
        result: "Next run passed; PR #520 merged as `687909c7`."
---

## Cue

An open PR unexpectedly fails `doc-governance` with `REVIEW_REQUIRED` on `package.json` (or another `trustSurface` path) right after a merge or `semantic-release` `chore(release)` commit lands on `main`, even though the PR itself did not edit that file.

## What happened

While PR #520 was open, a `semantic-release` commit (`chore(release): 1.0.0`, `a4a25194`) landed on `main` and bumped `package.json`. Because PR #520's branch stayed on the previous `main`, the `doc-governance` job diffed the stale branch against the new base, saw `package.json` (a `trustSurface` path) reverting to the older version, and returned `REVIEW_REQUIRED`. Merging `origin/main` into the branch resolved the false diff and the next run passed.

## Lesson

- Whenever anything lands on `main` — including an automated `semantic-release` `chore(release)` commit — re-check open PRs and merge `origin/main` into any branch whose base is now behind `main`.
- When `doc-governance` flags `package.json` (or another release-touched `trustSurface` path) on a PR that did not touch it, check whether `main` moved forward before investigating a governance defect.

## Evidence

- PR #520 (merged as `687909c7`); `chore(release): 1.0.0` (`a4a25194`).
- Related: E-0030 covers a stale local checkout running a merged CLI tool; this record covers a stale open PR base after a commit lands on `main`.
