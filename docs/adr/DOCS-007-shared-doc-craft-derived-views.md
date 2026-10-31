---
id: DOCS-007
status: accepted
---

# DOCS-007 — Shared doc craft and derived-view regeneration (F2/F3)

## Decision

- Each declared derived view in `derived` MUST be regenerated and must match its source when its inputs change (`derived-regenerate`).
- Doc-skill craft guidance is shared from one place under `references/documentation/_shared/`, not copied into each skill.

## Context

| Issue | Subject | State |
| --- | --- | --- |
| #356 | Share documentation craft across doc skills (#325) | MERGED |
| #357 | Check derived views with regenerate-equals (#325) | MERGED |

- #325 is OPEN as the documentation-family umbrella (see DOCS-001). It is the commit-title parent of both merged PRs.

## Evidence

- Implementation: [doc-obligations.js](../../harness-everything/scripts/doc-obligations.js) (`derived-regenerate` capability at line 10), [writing-craft.md](../../harness-everything/references/documentation/_shared/writing-craft.md), [maintenance.md](../../harness-everything/references/documentation/_shared/maintenance.md).
- Tests: [mechanism-325-f3-derived-views.test.js](../../ci/mechanism-325-f3-derived-views.test.js), [mechanism-325-f2-doc-craft.test.js](../../ci/mechanism-325-f2-doc-craft.test.js).
- Repo-wide gate, not row-specific: [reference-check.js](../../ci/reference-check.js).

## Open gates

- None specific to #356 or #357.
- #325 is OPEN as the documentation-family umbrella (see DOCS-001).
