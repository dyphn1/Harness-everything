---
id: E-0025
signature: skill-token-trim-hits-locked-text
class: test-coupling
title: "Trims to keep a SKILL.md within 500 tokens twice hit text that another test locks verbatim"
sites:
  - fable-mode/SKILL.md
  - ci/fable-mode-test.js
  - ci/mechanism-2at-fable-execution-phases.test.js
  - "waza token budget (skill-quality job, waza:check)"
violates: "AGENTS.md Change Rule 1: Every canonical SKILL.md keeps ≤ 500 tokens (CI gate)"
scope: in
status: open
mechanism_ref: null
episodes:
  - episode: 476-fable-skill-token-trim
    feature: "PR #476 fable-mode Codex handoff wording"
    date: 2026-11-19
    closed: true
    rounds:
      - round: 0
        change: null
        review: "hosted CI run 44495035847"
        result: "The PR removed the quotes from the fable-mode `description:` (keeping the file at 500 tokens). `ci/fable-mode-test.js:47` requires the quoted form, so runtime-floor and self-regression failed on all three OSes."
      - round: 1
        change: "W1 restored the quotes (501 tokens); W2, following the coordinator packet, dropped a serial comma in `## USE FOR:`"
        review: coordinator
        result: "waza back to 500, but `ci/mechanism-2at-fable-execution-phases.test.js:62` locks the `## USE FOR:` block verbatim, so self-regression failed. The packet named the trim site without grepping for assertions on it."
      - round: 2
        change: "Coordinator grepped ci/ for assertions; W3 dropped a serial comma in Workflow step 2, which no test asserts"
        review: coordinator
        result: "fable-mode-test, mechanism-2at, waza:check, test:consistency and verify:all --fast pass; pushed as `7935939f`"
---

## Cue

A SKILL.md sits at or near the 500-token budget and a change adds wording, so something has to be trimmed.

## What happened

Two trims on PR #476 each removed one token from text that a different test pins verbatim: first the quotes on the frontmatter `description:`, then a comma in the `## USE FOR:` block. Each passed waza and failed self-regression. Only after grepping `ci/` for every assertion on the file was an unasserted line found.

## Lesson

- Before trimming a SKILL.md for budget, list the lines that tests pin (`grep -rn` the file's phrases in `ci/`, or read the skill's mechanism test) and trim only outside them.
- A packet that prescribes a trim site states that it checked the site is unasserted.
- Mechanism candidate: a check that reports which SKILL.md lines are pinned by tests, so trims pick free lines.

## Evidence

- PR #476: hosted CI run 44495035847 (round 0), fix commit `7935939f` (round 2).
