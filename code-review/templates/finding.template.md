# Code Review — <PR or change>

## Scope and evidence

- Repository / PR:
- Base SHA → reviewed HEAD SHA:
- Requirement / PRD / ADR:
- Changed files and relevant callers/consumers:
- CI state and commands observed:
- Counterexample categories covered:
- Risks not examined / evidence limits:

## Findings

### [P1/P2/P3] <Short, specific title>

- **Location:** `<path>:<line or diff anchor> @ <HEAD SHA>`
- **Trigger:** <minimal input, state transition, or interleaving>
- **Behavior → impact:** <observed or source-traced behavior and violated contract>
- **Evidence tier:** <executed/reproduced | source-traced | inconclusive; include exact command/result or preconditions>
- **Minimal correction:** <smallest feasible fix>
- **Regression:** Negative case: <case that fails before fix>; positive control: <valid behavior that remains valid>
- **Disposition:** <blocker | follow-up | owner decision; for re-review, resolved | still open | superseded | inconclusive>

<!-- Duplicate this finding section as needed. Remove headings for which there are no findings. -->

## Summary

- **Scope / reviewed SHA:**
- **CI evidence:**
- **Covered / unexamined risks:**
- **Findings:** <fixed / open / new counts on re-review>
- **Conclusion:** <merge recommendation grounded in evidence; “no actionable findings in examined scope” is not a claim of bug-free code>
