# Error Handling — three-view overview (discussion draft)

> **Discussion only.** This updates the conceptual sketch for [#437](https://github.com/dyphn1/Harness-everything/issues/437) and the first Error Handling subtree [#402](https://github.com/dyphn1/Harness-everything/issues/402). No implementation, CLI, governance policy, hook, or ledger behavior is changed. **The user-confirmed sequence of seven Actions remains unchanged.**

An Overview contains **three distinct views**. Their responsibilities must not be merged into a single linear picture:

| View | Purpose | What it must show |
| --- | --- | --- |
| **1. Overall UML Activity Diagram** | Explain the full Error Handling decision process | Actions, guards, early exits, branches, recurrence and return paths |
| **2. System architecture / composition** | Explain how Actions, sub-activities and existing capabilities fit together | Process grouping, owner/reviewer authority, reuse of existing ledger and delivery |
| **3. Action Flowchart / Timeline** | Explain how one Action actually works | Inputs, decisions, outcomes, and handoff to the next Action |

## View 1 — Overall UML Activity Diagram

**This is the first, large diagram**, not just an A→G list. The Mermaid flowchart is a GitHub-renderable representation using normal UML Activity concepts (Action, Decision, Guard and control flow). The corresponding **PlantUML activity source** is [activity.puml](./activity.puml). Decisions are not additional persistent Actions.

```mermaid
flowchart TD
    S((Start)) --> A["A · Capture"]
    A --> B["B · Triage"]
    B --> T{"Approved tolerate class?"}
    T -->|Yes| R["Retry this operation (max 3)"]
    R --> REC{"Recovered?"}
    REC -->|Yes| RESUME["Resume interrupted work"]
    REC -->|No| UNV["Mark this step UNVERIFIED; report; continue independent work only"]
    RESUME --> Z((End))
    UNV --> Z

    T -->|No| REAL{"Real problem? (reviewer)"}
    REAL -->|No| DISMISS["Dismiss with reason"]
    REAL -->|Unclear| OWNER["Request owner decision; hold this item"]
    DISMISS --> Z
    OWNER --> Z

    REAL -->|Yes| BLOCK{"Blocks the current main path?"}
    BLOCK -->|Yes| C["C · Identify"]
    BLOCK -->|No| C
    C --> KNOWN{"Existing class / signature?"}
    KNOWN -->|Yes| OCC["Record occurrence in existing ledger"]
    KNOWN -->|No| APPROVAL{"Owner approves definition?"}
    APPROVAL -->|No / pending| HOLD["Keep pending; no implicit new class"]
    APPROVAL -->|Yes| DEF["Define class / signature in existing ledger"]
    HOLD --> Z
    OCC --> NOW{"Blocking main path?"}
    DEF --> NOW
    NOW -->|No| DEFER["Record only; defer treatment"]
    DEFER --> Z
    NOW -->|Yes| D["D · Decide disposition"]

    D --> MECH{"Mechanical prevention feasible within budget?"}
    MECH -->|Yes| RECHECK{"Same class still yields new instances in bounded review?"}
    RECHECK -->|No| CONV["Converge"]
    RECHECK -->|Yes| DROP{"Can action be dropped or restricted?"}
    MECH -->|No| DROP
    DROP -->|Yes| AVOID["Avoid"]
    DROP -->|No| TOLAPP{"Owner approves Tolerate?"}
    TOLAPP -->|No / pending| PENDING["Keep unresolved; do not bypass required checks"]
    TOLAPP -->|Yes| TOL["Tolerate"]
    PENDING --> Z

    CONV --> E["E · Treat (define acceptance first)"]
    AVOID --> E
    TOL --> E
    E --> F["F · Deliver relevant context"]
    F --> G["G · Accept and retire"]
    G --> RESULT{"Review the disposition outcome"}
    RESULT -->|Converge / Avoid: met| RETIRE["Accept; retire unneeded lesson"]
    RESULT -->|Tolerate: cap and escalation recorded| KEEP["Keep tolerate class active"]
    RESULT -->|Not met / unverified| OPEN["Keep open; report outstanding evidence"]
    KEEP --> Z
    OPEN --> Z
    RETIRE --> Z
    RETIRE -. "Later recurrence of same class; re-evaluate" .-> D
```

Reading notes:

- The **primary blocking path** keeps exactly `Capture → Triage → Identify → Decide disposition → Treat → Deliver relevant context → Accept and retire`. A non-blocking item is identified/recorded, then deferred; it does not open an immediate fix cycle.
- **B / Triage**: an already-approved tolerate class can have a bounded per-operation retry (up to three); failure leaves that step UNVERIFIED and does not convert mandatory evidence into PASS. A reviewer decides whether a different finding is real; an unclear item goes to the owner.
- **C / Identify**: reuse the existing root-cause class/signature when present. Creating an unknown class requires owner approval. Recording an occurrence is not a new ledger.
- **D / Decide**: Converge / Avoid / Tolerate. The existing #437 budget suggestion is one correction plus one review; there is no global recurrence counter or forced Zoom-out.
- **G / Accept**: Converge or Avoid can be accepted against defined conditions; a Tolerate class records retry/escalation conditions but is **not claimed to be rooted out**. A later observation may trigger re-evaluation. This is conceptual return flow, not an automatic additional PR review round.

## View 2 — System architecture / composition

This is deliberately a **structure/composition view, not a second executable flow specification**. It shows the two process groupings and where existing components or authorities participate. Dotted lines are explanatory associations, not new graph edge types or a second dependency language.

```mermaid
flowchart TB
    INPUT["Agent failure / reviewer finding / later observation"] --> A
    subgraph EH["Error Handling — composed activity"]
        direction TB
        subgraph ASSESS["Assess"]
            direction LR
            A["Capture"] --> B["Triage"] --> C["Identify"]
        end
        subgraph RESPOND["Respond"]
            direction LR
            D["Decide"] --> E["Treat"] --> F["Deliver"] --> G["Accept / retire"]
        end
        C --> D
    end
    REVIEW["Reviewer / Owner"] -. "judgement / approval" .-> B
    REVIEW -. "approval" .-> D
    LEDGER[("Existing Error Ledger · #359")] -. "find / record" .-> C
    LEDGER -. "mechanism / disposition" .-> E
    HOOK["Existing bounded context delivery · #394"] -. "reuse" .-> F
    G -. "newly observed recurrence" .-> INPUT
```

Each Action may later be detailed by its own Activity Diagram, Flowchart or Timeline. This Overview only shows which parts are composed together. Existing Error Ledger [#359](https://github.com/dyphn1/Harness-everything/issues/359) and bounded context delivery [#394](https://github.com/dyphn1/Harness-everything/issues/394) remain the established mechanisms; no new implementations are implied. An unrelated new problem re-enters at Capture, while a recognized recurrence may resume review of the existing disposition.

## View 3 — Action working example (D: Decide disposition)

This **Flowchart is an Action-detail example**, not a replacement for View 1. A different Action may use a Timeline when timing / actor handoff is more important than decision branching.

```mermaid
flowchart TD
    IN["C: identified class + evidence"] --> Q{"Mechanical prevention feasible within budget?"}
    Q -->|Yes| R{"Bounded review still finds new instances?"}
    R -->|No| C["Converge"]
    R -->|Yes| A{"Can action be dropped / restricted?"}
    Q -->|No| A
    A -->|Yes| V["Avoid"]
    A -->|No| T{"Owner approves tolerate class?"}
    T -->|Yes| TOL["Tolerate"]
    T -->|No / pending| WAIT["Unresolved; do not silently waive checks"]
    C --> OUT["E: define acceptance, then treat"]
    V --> OUT
    TOL --> OUT
```

Inputs: an identified error class, evidence, current step, and budget. Output: the selected treatment direction (Converge / Avoid / owner-approved Tolerate) or unresolved decision. `Treat` owns the actual intervention and predeclared acceptance conditions; `Decide` does not silently implement fixes.

## Action identity prototype (unchanged)

See [nodes.yaml](./nodes.yaml) for the same seven identities as in the initial branch commit. **No existing identifier or name is regenerated by redrawing the diagrams.**

- `identifier`: `ERR-YYYYMMDD-UUIDv4` (category at creation / creation date / UUID). Immutable once accepted; GUID supplies collision resistance; date and category are descriptive, not each a uniqueness guarantee.
- `name`: separate human/agent-readable meaning; the diagrams show this instead of UUIDs.
- `status`: separate metadata (`proposed` in this draft), without yet locking a lifecycle transition specification.
- Drawing-local `A`–`G` labels are not persistent identifiers. Ordinary start/end, decision diamonds and arrows do not receive document identities.

## Existing boundaries and decisions

| Action | Responsibility |
| --- | --- |
| A Capture | Collect facts from agent failure, reviewer finding or later discovery |
| B Triage | Judge real issue, permitted tolerance and whether main path is blocked |
| C Identify | Classify root cause and find/create its ledger record |
| D Decide disposition | Select Converge / Avoid / owner-approved Tolerate |
| E Treat | Define completion conditions, apply bounded response |
| F Deliver relevant context | Deliver only relevant lessons that are not already mechanically prevented |
| G Accept and retire | Check outcomes and retire lessons that are no longer required; observe recurrences |

Open for discussion rather than implemented here: final UML notation/rendering choice, whether decision branches/early exits are located correctly, whether the two groupings are useful, what to expand next, and final ID/status lifecycle rules. Do not expand the CLI/schema/governance surface before these diagrams are accepted.
