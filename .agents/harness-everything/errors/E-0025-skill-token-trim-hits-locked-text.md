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
  - episode: 476-p2-handoff-reference-budget
    feature: "PR #476 owner U5 P2 (explicit Codex handoff references), owner option A"
    date: 2026-11-19
    closed: false
    rounds:
      - round: 0
        change: null
        review: "advisor answer 1 (pr476), waza tokens count"
        result: "Baseline 498 tokens; the P2 asks to restore the baseline table and model-matrix line and add two full reference paths (est. 568). Owner approved compressing Workflow steps 2 and 3 into reference pointers."
      - round: 1
        change: "W4 (Luna) applied the approved compression and both full references"
        review: worker gates
        result: "510 tokens; the reference checker also rejected the bare `references/execution-phases.md` in step 2 (needs `<this-skill-dir>/`)."
      - round: 2
        change: "Coordinator measured nine wordings in scratch; W5 (haiku) applied the 500-token one"
        review: worker gates
        result: "`ci/prompt-contract-regressions.test.js:21-22` require `advisory replan` and `Rule-of-3` in fable-mode/SKILL.md; the approved compression had moved both into the reference. Keeping them measures 516. Third pin collision in the same class; parked for the owner (PR #476 comment 7014361656)."
  - episode: 394-r3b-fable-discipline-pin
    feature: "#394 R3b fable-discipline wording (PR #494)"
    date: 2026-11-20
    closed: true
    rounds:
      - round: 0
        change: null
        review: "ci/prompt-contract-regressions.test.js:42"
        result: "R3b rewrote fable-discipline/SKILL.md and dropped the test-pinned phrase \"divergence is a warning signal\" although the packet said to enumerate pins first."
      - round: 1
        change: "Pinned phrase restored before the R3b merge into the integration branch"
        review: "prompt-contract-regressions + verify:all --fast"
        result: "episode closed; third episode of the class, so a pinned-line report check is now the mechanism candidate"
---

## Cue

A SKILL.md sits at or near the 500-token budget and a change adds wording, so something has to be trimmed.

## What happened

Two trims on PR #476 each removed one token from text that a different test pins verbatim: first the quotes on the frontmatter `description:`, then a comma in the `## USE FOR:` block. Each passed waza and failed self-regression. Only after grepping `ci/` for every assertion on the file was an unasserted line found.

## Lesson

- Before trimming a SKILL.md for budget, list the lines that tests pin (`grep -rn` the file's phrases in `ci/`, or read the skill's mechanism test) and trim only outside them.
- A packet that prescribes a trim site states that it checked the site is unasserted.
- Mechanism candidate: a check that reports which SKILL.md lines are pinned by tests, so trims pick free lines.
- Before asking the owner to approve a compression, run every test that reads the file (`grep -rln <skill>/SKILL.md ci/`) against the measured candidate, not only the skill's own mechanism test (episode 2: the approval itself hit a third pin).

## Evidence

- PR #476: hosted CI run 44495035847 (round 0), fix commit `7935939f` (round 2).
- Episode 2: PR #476 comments 7013241296 (owner approval) and 7014361656 (parked); packets `.worktrees/packets/pr476/W4*`, `W5*` (local).
- PR #494 (2026-11-20): R3b dropped a pinned fable-discipline phrase.
