---
id: DOCS-001
status: accepted
---

# DOCS-001 — Project docs config resolution (D5)

## Decision

- The committed, host-neutral `.agents/harness-everything/project-docs.json` wholly overrides differing host `projectDocs` values.
- `AGENTS.md` is never a configuration source.
- When the project file overrides a differing host value, the resolver reports `project-overrides-host`.

## Context

| Issue | Subject | State |
| --- | --- | --- |
| #325 | Documentation family, PRD/ADR governance and doc-change workflow | OPEN |

- Contract: [document-lifecycle.md § Configuration (D5)](../document-lifecycle.md#configuration-d5).

## Evidence

- Implementation: [project-docs-resolver.js](../../harness-everything/scripts/project-docs-resolver.js) (`project-overrides-host`, around line 390), [doc-check.js](../../harness-everything/scripts/doc-check.js).
- Test: [mechanism-2aw-project-docs-config.test.js](../../ci/mechanism-2aw-project-docs-config.test.js).
- Repo-wide gate, not row-specific: [reference-check.js](../../ci/reference-check.js).
- `AGENTS.md` exclusion is stated in [document-lifecycle.md](../document-lifecycle.md) (configuration table). The resolver has no `AGENTS.md` read path.
- Config in this repo: [project-docs.json](../../.agents/harness-everything/project-docs.json).

## Open gates

- #325 is OPEN as the documentation-family umbrella. Shipped slices do not close it.
