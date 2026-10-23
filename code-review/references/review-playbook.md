# Review Playbook

Use this checklist for the applicable risks; do not force irrelevant categories.

## Establish scope and evidence

- [ ] Pin repository, PR, base/head SHA, user requirement or PRD/ADR, changed files, relevant callers/callees, and current CI state. Avoid unrelated checkout areas.
- [ ] Quote the acceptance clauses and owner bounds verbatim, with their source. Keep them apart from the chosen implementation (designs, existing tests) and the evidence: a design choice or a test expectation is not a requirement.
- [ ] Make an independent pass. Treat author explanations and tests as leads, not proof; derive expected behavior from contracts and source.
- [ ] Label evidence honestly: **executed/reproduced** (command, result, environment, SHA); **source-traced** (concrete path and preconditions); **inconclusive** (missing facts or ambiguous semantics; do not present as a proven blocker).
- [ ] Inventory user-facing entry points and configuration handoffs (CLI flags, cwd, path spellings, config loading). Exercise them end-to-end, not only the recently edited internals.
- [ ] Reproduce a candidate finding against the PR base before classifying it as new. Pre-existing defects are follow-ups, not new blockers.

## Try applicable counterexamples

- [ ] Missing, null, malformed input; old persisted state; base-to-candidate transitions; tenant/scope boundaries.
- [ ] Missing or broken dependencies: enumerate every entry point, including help, recovery, and stop paths; inspect fallback behavior.
- [ ] OS/shell differences; concurrency, crash, retry; user paths and symlinks; API/migration compatibility; downstream or generated views.
- [ ] Follow each important diagnostic/fact through every consumer and ancestor. Check whether required facts are computed before derived authority, indexes, or output.
- [ ] Compare new rules with previously accepted rules and controls. Separate display severity from safety prerequisites.

## Check tests and output

- [ ] Ask whether each test still passes if the behavior is disabled, bypassed, or broken (mutation thought experiment). Confirm the test is included in CI.
- [ ] When output text changes, compare the intended changed lines with literal templates; do not exclude changed lines from assertions.
- [ ] Dedupe findings. Use P1 for severe merge blockers, P2 for meaningful correctness/contract defects, P3 for low-risk issues; avoid speculation.
- [ ] For each finding, include exact path:line or diff anchor at HEAD SHA, trigger, observed behavior, violated contract and impact, evidence tier, smallest fix, negative regression, positive control, and disposition.
- [ ] Name the exact acceptance clause each finding violates, with a witness (starting state, input, expected result, actual result) and the trust assumption. A finding that maps to no clause gets scope `unresolved` for the owner; do not drop it, and do not present it as a blocker. Record severity and scope separately.

## Re-review and conclude

- [ ] Pin the new HEAD. Disposition every prior finding separately: resolved, still open, superseded, or inconclusive. Then inspect fix-induced side effects and new changes.
- [ ] Re-trace one normal acceptance path end to end plus the consumers the fix affects, even when the request names only the last fix. A diff-only re-review misses unchanged sites that make the same decision.
- [ ] If this round and the previous one each found new defects in the same decision class, say so and recommend `zoom-out` (site inventory against the violated clause) before another point fix.
- [ ] Stay read-only unless the user/workflow explicitly authorizes action. Do not edit, comment, label, or merge on review authority alone.
- [ ] Summarize scope/SHA, CI, covered and unexamined risks, fixed/open/new counts, and evidence-grounded merge recommendation. “No actionable findings in examined scope” does not mean “bug-free.” Distinguish repository tests from live-host evidence.

## Per-finding format

`[P1/P2/P3] Title` — `path:line @ <HEAD SHA>`

**Trigger** → **behavior** → **contract violation / impact**. **Evidence:** executed / source-traced / inconclusive. **Minimal correction:** … **Regression:** negative case …; positive control … **Disposition:** blocker / follow-up / owner decision.

Use `<this-skill-dir>/templates/finding.template.md` for the complete findings and summary form.
