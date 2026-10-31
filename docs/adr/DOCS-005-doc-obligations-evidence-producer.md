---
id: DOCS-005
status: accepted
---

# DOCS-005 — Doc obligations and trusted evidence producer (phase 3a)

## Decision

- Documentation MUST obligations fail closed: missing or untrusted evidence yields a failing result, never a pass.
- Evidence is produced by a trusted producer. Baseline-bound evidence is refused when the baseline has no whole-baseline digest.

## Context

| Issue | Subject | State |
| --- | --- | --- |
| #334 | Phase 3a doc-change obligation derivation and evidence producer (#325) | MERGED |
| #335 | Bind deleted and renamed paths to baseline evidence | CLOSED |
| #342 | Read baseline and destination identities exactly once (fix for #335) | MERGED |

## Evidence

- Implementation: [doc-obligations.js](../../harness-everything/scripts/doc-obligations.js), [doc-evidence.js](../../harness-everything/scripts/doc-evidence.js) (digest refusal near line 165), [doc-evidence-capture.js](../../harness-everything/scripts/doc-evidence-capture.js).
- Tests: [mechanism-325-3a-doc-obligations.test.js](../../ci/mechanism-325-3a-doc-obligations.test.js), [mechanism-325-3a-doc-evidence.test.js](../../ci/mechanism-325-3a-doc-evidence.test.js), [mechanism-335-baseline-evidence.test.js](../../ci/mechanism-335-baseline-evidence.test.js).

## Open gates

- None specific to #334, #335 or #342.
- #325 is OPEN as the documentation-family umbrella (see DOCS-001).
