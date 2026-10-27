---
id: DOCS-003
status: accepted
---

# DOCS-003 — Contract-style PRD revision chain (D6.9)

## Decision

- An effective PRD is a frozen revision chain with an approval record.
- A change creates a new complete revision copied from the current effective revision. The effective snapshot is never edited in place.
- This replaces the D6.1 living-PRD model for PRDs only. ADRs, tickets and other roles are unchanged.

## Context

| Issue | Subject | State |
| --- | --- | --- |
| #325 | Documentation family, PRD/ADR governance and doc-change workflow | OPEN |

- Contract: [document-lifecycle.md § Contract-style PRD revisions (D6.9)](../document-lifecycle.md#contract-style-prd-revisions-d69).

## Evidence

- Implementation: [doc-lifecycle.js](../../harness-everything/scripts/doc-lifecycle.js) (revision identity, approval, immutability and `immutable-revision-modified` diagnostics).
- Test: [mechanism-2ay-prd-revisions.test.js](../../ci/mechanism-2ay-prd-revisions.test.js). Its header cites the D6.9 contract section.

## Open gates

- #325 is OPEN as the documentation-family umbrella. Shipped slices do not close it.
