# Error Handling — lightweight layer registry (discussion prototype)

> **P2-2 decision for #437:** use a small registry that maps existing nodes, documents, and layer references **table to table**. This is a document lookup, not a workflow engine or a second graph. No runtime loader, CLI, enforcement, schema migration, or generated document pipeline is introduced here.
>
> **P2-1 intentionally unchanged:** whether agents confuse View and Level is **not an established defect**. The owner will validate it experimentally. Do not preemptively relabel or rewrite the previously tested Level 1 diagrams to address an unproven issue.

## Identity source — reuse the existing Action table

The [Action identity registry](./nodes.yaml) is the only proposed source for the seven existing Action identities. Their UUIDs and names are **not copied into this file**, so edits to Action identity do not require changing two registries. A–G are drawing-local aliases, never global identifiers.

## Table A — document registry (where to look)

| Local reference | Layer / role | Document | Purpose |
| --- | --- | --- | --- |
| `EH-overview` | Level 1 · process / three Views | [README.md](./README.md) | The canonical error-occurrence lifecycle, branches, guards and Action relationships |
| `EH-activity-source` | Level 1 · diagram representation | [activity.puml](./activity.puml) | UML activity representation of the **same** Level 1 route; not an independent controller |
| `E0002-actions` | Level 2 · context-specific behavior blocks | [actions/e0002-action-map.md](./actions/e0002-action-map.md) | E-0002 lens over ASSESS / RESPOND; what the Agent should do |
| `E0002-capture` | Level 3 · evidence reference | [details/e0002-capture-evidence.md](./details/e0002-capture-evidence.md) | Source and artifact preservation details, read only if relevant |
| `E0002-writer` | Level 3 · Script/CLI reference | [details/e0002-report-writer.md](./details/e0002-report-writer.md) | `-o` handling, input/output, return codes and mechanical checks; shipped as `scripts/report-writer.js` (`npm run report`, #462) |
| `E0002-ledger` | Existing external source · error history | [E-0002 ledger](../../.agents/harness-everything/errors/E-0002-report-missing-terminal-status.md) | Existing class/signature and history, **not** a new Level 3 state store |
| `C1-actions` | Level 2 · C1 split decision | [actions/c1-action-map.md](./actions/c1-action-map.md) | One authority per named decision; consumer inventory |
| `C1-detail` | Level 3 · C1 conformance design | [details/c1-authority-conformance.md](./details/c1-authority-conformance.md) | Conformance-test design; mechanism stays a follow-up until a target is pinned |
| `C2-actions` | Level 2 · C2 test oracle | [actions/c2-action-map.md](./actions/c2-action-map.md) | Test-root containment on Unix and Windows |
| `C2-detail` | Level 3 · C2 path predicate | [details/c2-test-root-containment.md](./details/c2-test-root-containment.md) | Predicate and matrix in `ci/mechanism-397-cycle-import.test.js` |
| `C3-actions` | Level 2 · C3 machine state | [actions/c3-action-map.md](./actions/c3-action-map.md) | Routing tests own their System One mode |
| `C3-detail` | Level 3 · C3 mode ownership | [details/c3-mode-ownership.md](./details/c3-mode-ownership.md) | Env builder in the routing fixtures (#449) |
| `C5-actions` | Level 2 · C5 host protocol | [actions/c5-action-map.md](./actions/c5-action-map.md) | Pin one host protocol at its real boundary |
| `C5-detail` | Level 3 · C5 replay contract | [details/c5-host-replay-contract.md](./details/c5-host-replay-contract.md) | Replay contract and the missing retained payload |
| `C6-actions` | Level 2 · C6 briefing | [actions/c6-action-map.md](./actions/c6-action-map.md) | A packet carries its own authoritative values |
| `C6-detail` | Level 3 · C6 briefing walkthrough | [details/c6-packet-briefing.md](./details/c6-packet-briefing.md) | Walkthroughs and the report-writer dependency |
| `C6-template` | Template · packet briefing | [templates/packet-briefing.md](./templates/packet-briefing.md) | Copy per packet; every field filled or `N/A: <reason>` |
| `C7-actions` | Level 2 · C7 write-set | [actions/c7-action-map.md](./actions/c7-action-map.md) | Did the slice stay inside its write-set |
| `C7-detail` | Level 3 · C7 checker | [details/c7-write-set-check.md](./details/c7-write-set-check.md) | `scripts/check-packet-write-set.js`, run by the coordinator before accepting a slice |

`Local reference` values are **table-local lookup keys only**, not new stable Action IDs, graph node identities, persistent state, or workflow instructions.

## Table B — relationship registry (when to follow a reference)

| From | To | Relation / relevance | Expected reading behavior |
| --- | --- | --- | --- |
| `EH-overview` | `EH-activity-source` | Same Level 1 representation | Open when UML source/notation is needed; not a new Level |
| `EH-overview` | `E0002-actions` | Context-specific expansion: **E-0002** | Open when handling this Error Class/context, rather than loading all Action Maps |
| `E0002-actions` | `E0002-capture` | Detail supporting Capture / evidence | Read when raw evidence/provenance is required |
| `E0002-actions` | `E0002-writer` | Detail supporting Treat / Report CLI | Read when producing or validating a report through the proposed script |
| `E0002-actions` | `E0002-ledger` | Existing class evidence / history | Read for Identify/history relevance; do not copy or reclassify the ledger |

**Maintenance contract (lightweight):** when a document moves, update its **Table A path**; Table B continues to refer to the same local key. When a new Level 2 behavior block or Level 3 reference is added, add only the relevant row and reference. Removing an obsolete procedure removes its registry relationship without rewriting Level 1. **Do not re-encode Mermaid/PlantUML execution arrows as registry edges**: the source diagrams own flow semantics, while the tables own *navigation/lookup*.

## P2-3 — no mandatory input/output contract for every Action

**Action / behavior block:** expresses the relevant behavior and keeps the Agent free to select appropriate means; no universal form of `input`, `output`, `precondition`, `postcondition` or handoff schema is imposed. Required lifecycle gates already belong to Level 1.

**Concrete technical boundary (Script, CLI, API, structured output):** document machine-checkable inputs/outputs, return code, errors, and any necessary validation in **the relevant Level 3 contract**. For E-0002, [Report Writer](./details/e0002-report-writer.md) already serves this purpose. A script can reject invalid data; it cannot fabricate approvals or declare the whole task done.

## State of validation

- The owner will run **View vs Level comprehension tests**; P2-1 is **not** a presumed flaw or a reason to modify diagram text now.
- This registry is a **minimal design mapping** only. It has not been proven to improve Agent comprehension, navigation cost or runtime recurrence.
- Effectiveness and cost evaluation of Error Handling still requires complete Error Handling + Script + Hook/Skill integration, followed by real execution evidence.
