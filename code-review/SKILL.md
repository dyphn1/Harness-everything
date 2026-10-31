---
name: code-review
description: "Independently review a PR, diff or finished implementation for correctness, contract and negative-path defects, with source-anchored findings labelled executed, source-traced or inconclusive; read-only by default. USE FOR: \"review this PR before merge\", \"re-review the fix at the new HEAD\". DO NOT USE FOR: \"security threat modeling\", \"implementing or fixing the code\"."
license: Apache-2.0
metadata:
  author: Miya Daniel
  version: 0.40.0
---

# Code Review

Independently review completed changes for correctness, contract violations, and negative-path defects. Default to read-only.

## 📋 Skill Contract

| Component | Specification |
| :--- | :--- |
| **Trigger / Input** | Requested review of a PR, diff, implementation, or revised HEAD. |
| **Expected Output** | Source-anchored findings and an evidence-qualified summary. |
| **State Mutations** | None unless the user explicitly authorizes an action. |
| **Enforcement Gate** | Apply the checklist in `<this-skill-dir>/references/review-playbook.md`. |

## USE FOR:
- Review a PR / diff / finished implementation before merge
- Re-review a revised HEAD: prior-finding disposition + new risks

## DO NOT USE FOR:
- Security-only threat modeling / secrets / OWASP (use `security-review`)
- Design or plan stress-testing (use `grill-me`); running gates (use `verification-loop`); writing the fix (use `tdd`)

## Workflow

1. Pin repository, verbatim acceptance contract, base/head, changed scope, and CI state; inspect relevant callers and consumers.
2. Independently trace behavior and test applicable counterexamples. Separate severity from safety conditions.
3. Report only supported findings with evidence tier, smallest correction, regression, and positive control. Use `<this-skill-dir>/templates/finding.template.md`.
4. On re-review, disposition every prior finding at the new HEAD, re-trace the acceptance path, then inspect for regressions.
5. Keep review read-only unless explicitly authorized. Do not claim “bug-free.”

In the interim, bind explicitly on an existing review step: `{"stepType":"review","optionalBindings":["code-review"]}`.

Deep dive: <this-skill-dir>/references/review-playbook.md
