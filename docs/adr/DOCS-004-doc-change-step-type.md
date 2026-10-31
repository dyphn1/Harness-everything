---
id: DOCS-004
status: accepted
---

# DOCS-004 — `doc-change` step type

## Decision

- `doc-change` is an explicit documentation-edit step type.
- It has no implicit TDD binding. Step types are declared in a registry, not inferred.

## Context

| Issue | Subject | State |
| --- | --- | --- |
| #326 | Extract step-type registry and add doc-change step (split from #320 for #325) | CLOSED |
| #328 | Declarative step-type registry with declared-only doc-change (#326) | MERGED |

## Evidence

- Implementation: [step-types.json](../../hooks/scripts/lib/step-types.json) (`"id": "doc-change"`), [workflow-obligations.js](../../hooks/scripts/lib/workflow-obligations.js).
- Test: [mechanism-2az-step-type-registry.test.js](../../ci/mechanism-2az-step-type-registry.test.js).

## Open gates

- None for #326 and #328.
- #325 is OPEN as the documentation-family umbrella (see DOCS-001).
