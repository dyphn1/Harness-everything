---
name: verification-loop
description: "Run objective verification gates (build, types, lint, tests, security scan) before claiming work done. USE FOR: \"run the full verification loop\", \"verify this is done before delivery\". DO NOT USE FOR: \"design discussions with no completed work\", \"planning without code changes\"."
license: Apache-2.0
metadata:
  author: Miya Daniel
  version: 0.26.0
---

# Verification Loop

Run objective gates before claiming delivery readiness.

## Skill Contract

| Component | Specification |
| :--- | :--- |
| **Trigger / Input** | Completed change awaiting delivery. |
| **Expected Output** | Evidence-backed verification report. |
| **State Mutations** | Fills `<this-skill-dir>/templates/verification-report.template.md`. |
| **Enforcement Gate** | Every applicable gate passes. |

## USE FOR:
- Verify a completed change
- Run quality gates before delivery/PR

## DO NOT USE FOR:
- Fixing failures without re-running verification
- New feature/test implementation (use `tdd`)

## Workflow

1. Run applicable build, type, lint, test/coverage, security, and diff gates.
2. Reconcile cited REQ/ADR/spec lineage with `<this-skill-dir>/scripts/contract-integrity-audit.js`; stale/failed/audit-only evidence is not ready.
3. For project-declared/discovered mechanical gates, follow `<this-skill-dir>/references/project-verification-contract.md`.
4. On failure, fix and rerun from the first affected gate.
5. Fill `<this-skill-dir>/templates/verification-report.template.md` with actual evidence.

Deep dive: `<this-skill-dir>/references/verification-phases.md`
