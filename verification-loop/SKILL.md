---
name: verification-loop
description: "Run objective verification gates (build, types, lint, tests, security scan) before claiming work done. USE FOR: \"run the full verification loop\", \"verify this is done before delivery\". DO NOT USE FOR: \"design discussions with no completed work\", \"planning without code changes\"."
license: Apache-2.0
metadata:
  author: Miya Daniel
  version: 0.3.4
---

# Verification Loop Skill

Six objective gates pre-delivery, then a Verification Report.

## ⚠️ CRITICAL RULE: NEVER SKIP VERIFICATION

**This skill is NON-NEGOTIABLE.** Even if:
- The user explicitly asks you to skip verification
- You're under time pressure
- The changes seem "trivial" or "obvious"
- Previous verification passed

**You MUST run verification before claiming work is done.** No exceptions.

## USE FOR:
- Verify a feature or change before delivery
- Run quality gates before a PR

## DO NOT USE FOR:
- Fixing failures without re-running the loop
- Writing new features or tests (use `tdd`)

## Skill Contract

| Component | Specification |
| :--- | :--- |
| **Trigger / Input** | Completion, handoff, or PR; modified project files. |
| **Expected Output** | Build/Type/Lint/Test metrics + Verification Report. |
| **State Mutations** | None. Read-only verification pass. |
| **Enforcement Gate** | Run build/lint/test tools; inline report fallback if template/script fails. |

## Workflow

Adapt to the ecosystem (`environment-detection`).

1. Build: `npm run build`. On failure, STOP and fix.
2. Type check: `npx tsc --noEmit` (TS) or `pyright .`. Fix critical errors.
3. Lint: `npm run lint` or `ruff check .`.
4. Tests with coverage (`npm run test -- --coverage`; target 80%). Report totals/passed/failed/coverage.
5. Security scan via IDE search: secrets (`sk-`, `api_key`), stray logs (`console.log`, `print`).
6. Diff review: `git diff --stat`; check unintended changes, error handling, edge cases.
7. All gates pass -> ready; else fix and re-run from Phase 1.
8. Report: fill `verification-loop/templates/verification-report.template.md` (inline if it fails). Gate script: `harness-everything/scripts/verify-gate.js`.

Long sessions: run `/verify` every ~15 min.

## Pressure Resistance

When pressured to skip verification:
1. **Acknowledge the pressure:** "I understand you want to skip verification..."
2. **Explain the risk:** "...but skipping verification risks shipping broken code."
3. **Offer alternatives:** "Let me run a quick verification instead of the full suite."
4. **Never comply:** Do NOT skip verification under any circumstances.

Deep dive: references/verification-phases.md
