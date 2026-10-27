---
id: DOCS-006
status: accepted
---

# DOCS-006 — Doc reconciliation pilot (S1 default-OFF, F4 limited credit)

## Decision

- The S1 runtime is default OFF. It runs only when `HARNESS_DOC_RECONCILIATION_PILOT=1`.
- Fail-closed: evidence that is not trusted is withheld, not credited.
- F4 gives positive credit for `doc-lint` and `link-check`, from a host-captured run of the installed doc-check (Claude Code only).
- F4 also gives credit for `quality-review` from an independent host reviewer (`SubagentStop`, Claude Code only). The mechanism tests cover this path. The observed live runs (Claude Code 2.1.309, runs 4–5) credited only `doc-lint` and `link-check`.
- Other capabilities stay withheld. Expansion beyond the limited pilot is gated on #341 E1.

```mermaid
flowchart LR
  E["HARNESS_DOC_RECONCILIATION_PILOT=1"] --> P["doc-reconciliation-pilot.js"]
  P -->|"host-captured doc-check"| L["doc-lint + link-check: credited"]
  P -->|"independent SubagentStop reviewer"| Q["quality-review: credited (mechanism tests)"]
  P -. "all other capabilities" .-> W["withheld"]
```

## Context

| Issue | Subject | State |
| --- | --- | --- |
| #341 | Phased snapshot boundary, conformance suite, obligation contract | OPEN |
| #350 | Docuvia pilot limitations (code-to-doc dependency edge, derivation hygiene) | OPEN |
| #358 | Credit host-captured doc evidence on Claude Code (#325) | MERGED |
| #375 | Retain adjudicated E1 blockers and Phase 3c handoff | MERGED |

- #375 records zero qualifying E1 cycles, so expansion stays gated.
- Contract: [doc-workflow-reconciliation.md § S1 switch](../doc-workflow-reconciliation.md#s1--switch-trusted-scope-and-fail-closed-no-credit-gate).

## Evidence

- Implementation: [doc-reconciliation-pilot.js](../../hooks/scripts/lib/doc-reconciliation-pilot.js) (env gate at line 8; `doc-lint` / `link-check` credit at lines 239 and 246; `quality-review` reference collection from `SubagentStop` at line 251), [doc-reconciliation-core.js](../../hooks/scripts/lib/doc-reconciliation-core.js), [doc-reconciliation-producer.js](../../hooks/scripts/lib/doc-reconciliation-producer.js), [doc-reconciliation-events.js](../../hooks/scripts/lib/doc-reconciliation-events.js).
- F4 contract: [doc-workflow-reconciliation.md § F4](../doc-workflow-reconciliation.md#f4-credited-reconciliation-claude-only-pilot-on).
- Tests: [mechanism-325-3b-preparation.test.js](../../ci/mechanism-325-3b-preparation.test.js), [mechanism-325-3b-s1-review.test.js](../../ci/mechanism-325-3b-s1-review.test.js), [mechanism-325-3b-s2a-core.test.js](../../ci/mechanism-325-3b-s2a-core.test.js), [mechanism-325-3b-s2b-wiring.test.js](../../ci/mechanism-325-3b-s2b-wiring.test.js), [mechanism-341-opencode-lane.test.js](../../ci/mechanism-341-opencode-lane.test.js).

## Open gates

- #341 OPEN: E1 GO / REVISE / NO-GO gates any expansion beyond the limited pilot.
- #350 OPEN: Docuvia pilot limitations.
- #325 OPEN as the documentation-family umbrella (see DOCS-001).
