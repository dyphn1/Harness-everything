---
id: DOCS-008
status: accepted
---

# DOCS-008 — #320 obligation abstraction as a bounded doc consumer

## Decision

- The doc workflow reconciliation consumes the workflow obligation abstraction in a bounded way: the documentation path only, under the DOCS-006 gate.
- Broad promotion of the abstraction to generic workflow use is not approved. It is gated on the Phase 3c H1–H4 paired-task evidence and owner sign-off.

## Context

| Issue | Subject | State |
| --- | --- | --- |
| #320 | Compile workflow/skill metadata into a dynamic decision graph | OPEN |

- Phase 3c is planned, not shipped: [document-lifecycle.md § Phase 3c](../document-lifecycle.md#phase-3c--architecture-promotion-gate-for-320-planned-not-shipped).

## Evidence

- Implementation: [doc-reconciliation-core.js](../../hooks/scripts/lib/doc-reconciliation-core.js), [doc-obligations.js](../../harness-everything/scripts/doc-obligations.js) (the obligation table consumed by the doc path).
- Consumer tests (exercise `doc-reconciliation-core.js` consuming `deriveDocObligations`): [mechanism-325-3b-s2a-core.test.js](../../ci/mechanism-325-3b-s2a-core.test.js), [mechanism-325-3b-s2b-wiring.test.js](../../ci/mechanism-325-3b-s2b-wiring.test.js).
- Fail-closed controls (not evidence of the consumer): [mechanism-325-3b-preparation.test.js](../../ci/mechanism-325-3b-preparation.test.js), [mechanism-325-3b-s1-review.test.js](../../ci/mechanism-325-3b-s1-review.test.js), [mechanism-341-opencode-lane.test.js](../../ci/mechanism-341-opencode-lane.test.js).

## Open gates

- #320 OPEN. Its own promotion gate is unmet: H1–H4 paired-task evidence has not been collected.
- Pilot gate (#341 E1) applies, see DOCS-006.
