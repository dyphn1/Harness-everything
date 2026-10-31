---
id: DOCS-002
status: accepted
---

# DOCS-002 — ADR/REQ identity, supersession and generated index (D6.1–D6.4)

## Decision

- ADR IDs are `<DOMAIN>-NNN` (domain 2–10 uppercase alphanumerics, at least 3 digits). The domain must be declared in `domains`.
- `status` is required and uses `proposed` / `accepted` / `rejected` / `superseded`.
- Aliases and `legacy:` references resolve to one document. Self-aliases and collisions are diagnosed.
- A `supersedes` edge takes effect only from an `accepted` ADR to a target already `superseded`. Cycles are diagnosed.
- `conflicts_with` stays a recorded conflict until an effective `supersedes` edge exists.
- The index in `docs/governed-index.md` is generated, not hand-written.

## Context

| Issue | Subject | State |
| --- | --- | --- |
| #325 | Documentation family, PRD/ADR governance and doc-change workflow | OPEN |

- Contract: [document-lifecycle.md § IDs](../document-lifecycle.md#ids-aliases-and-references-d62-d68), [§ Supersession](../document-lifecycle.md#supersession-d63-d64).

## Evidence

- Implementation: [doc-lifecycle.js](../../harness-everything/scripts/doc-lifecycle.js) (`ADR_ID` at line 20; `unknown-domain` at line 1078; `supersede-cycle` at line 1220).
- Test: [mechanism-2ax-doc-lifecycle.test.js](../../ci/mechanism-2ax-doc-lifecycle.test.js).
- Repo-wide gate, not row-specific: [reference-check.js](../../ci/reference-check.js).
- Generator: [governed-index.md](../governed-index.md), produced by `doc-lifecycle.js index` (see `derived` in [project-docs.json](../../.agents/harness-everything/project-docs.json)).

## Open gates

- #325 is OPEN as the documentation-family umbrella. Shipped slices do not close it.
