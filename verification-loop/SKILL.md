---
name: verification-loop
description: "Run objective verification gates (build, types, lint, tests, security scan) before claiming work done. USE FOR: \"run the full verification loop\", \"verify this is done before delivery\". DO NOT USE FOR: \"design discussions with no completed work\", \"planning without code changes\"."
license: Apache-2.0
metadata:
  author: Miya Daniel
  version: 0.3.6
---

# Verification Loop

Run objective quality gates before claiming a change is ready.

## Skill Contract

| Component | Specification |
| :--- | :--- |
| **Trigger / Input** | Completed implementation or change awaiting delivery. |
| **Expected Output** | Evidence-backed verification report and delivery decision. |
| **State Mutations** | Fills a report from `<this-skill-dir>/templates/verification-report.template.md`. |
| **Enforcement Gate** | Build, type, lint, test, security, and diff gates all pass. |

## USE FOR:

- Verify a feature or change before delivery
- Run quality gates before a PR

## DO NOT USE FOR:

- Fixing failures without re-running the loop
- Writing new features or tests (use `tdd`)

## Workflow

Never claim completion until every applicable gate passes. On failure, fix the cause
and rerun from the first affected gate.

1. Build: `npm run build`.
2. Types: `npx tsc --noEmit` or `pyright .`.
3. Lint: `npm run lint` or `ruff check .`.
4. Tests and coverage: `npm run test -- --coverage`.
5. Security scan: secrets and stray logs.
6. Diff review: `git diff --stat` and unintended-change checks.
7. Fill `<this-skill-dir>/templates/verification-report.template.md` with evidence.

Deep dive: `<this-skill-dir>/references/verification-phases.md`
