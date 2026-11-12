# Error Handling — blind diagram stimulus

> Read **only the diagrams** below on your first pass. Do not read the parent README, Issue #437 / #402, previous comments, the evaluation rubric, or the other reviewer assignments. Diagrams are round 2, revised after round 1; source diagrams frozen at `8e76b8d24688148145437034a7995f3454837db1`.

## View 1 (Diagram 1)

```mermaid
flowchart TD
    S((Start))

    subgraph ASSESS["ASSESS"]
        direction TB
        A["A · Capture"] --> B["B · Triage"]
        B --> T{"Already-approved tolerate class?"}
        T -->|Yes| R["Retry this operation (max 3)"]
        R --> REC{"Recovered?"}
        REC -->|Yes| RESUME["Resume interrupted work"]
        REC -->|No| UNV["Mark step UNVERIFIED; report; continue independent work only"]

        T -->|No| REAL{"Real problem? (reviewer)"}
        REAL -->|No| DISMISS["Dismiss with reason"]
        REAL -->|Unclear| OWNER["Request owner decision; hold item"]
        REAL -->|Yes| C["C · Identify"]
        C --> KNOWN{"Existing class / signature?"}
        KNOWN -->|Yes| OCC["Record occurrence in existing ledger"]
        KNOWN -->|No| APPROVAL{"Owner approves definition?"}
        APPROVAL -->|No / pending| HOLD["Keep pending; no implicit new class"]
        APPROVAL -->|Yes| DEF["Define class / signature in existing ledger"]
        OCC --> NOW{"Blocking main path?"}
        DEF --> NOW
        NOW -->|No| DEFER["Record only; defer treatment"]
    end

    subgraph RESPOND["RESPOND"]
        direction TB
        D["D · Decide disposition<br/>«expanded in View 3»"] --> MECH{"Mechanical prevention feasible within budget?"}
        MECH -->|Yes| RECHECK{"Same class still yields new instances in bounded review?"}
        RECHECK -->|No| CONV["Converge"]
        RECHECK -->|Yes| DROP{"Can action be dropped or restricted?"}
        MECH -->|No| DROP
        DROP -->|Yes| AVOID["Avoid"]
        DROP -->|No| TOLAPP{"Owner approves Tolerate?"}
        TOLAPP -->|No / pending| PENDING["Keep unresolved; do not bypass required checks"]
        TOLAPP -->|Yes| TOL["Tolerate"]
        CONV --> E["E · Treat (define acceptance first)"]
        AVOID --> E
        TOL --> E
        E --> F["F · Deliver relevant context"]
        F --> G["G · Accept and retire"]
        G --> RESULT{"Review disposition outcome"}
        RESULT -->|Converge / Avoid: met| RETIRE["Accept; retire unneeded lesson"]
        RESULT -->|Tolerate: cap and escalation recorded| KEEP["Keep tolerate class active"]
        RESULT -->|Not met / unverified| OPEN["Keep open; report outstanding evidence"]
    end

    S --> A
    NOW -->|Yes| D
    RETIRE -. "Later recurrence of the SAME known class: re-evaluate disposition" .-> D

    RESUME --> Z((End))
    UNV --> Z
    DISMISS --> Z
    OWNER --> Z
    HOLD --> Z
    DEFER --> Z
    PENDING --> Z
    RETIRE --> Z
    KEEP --> Z
    OPEN --> Z
```

A–G are drawing-local aliases, not persistent identifiers; node ids are local to each diagram.

## View 2 (Diagram 2)

```mermaid
flowchart TB
    INPUT["Agent failure / reviewer finding / later observation"] --> A
    subgraph EH["Error Handling — composed activity"]
        direction TB
        subgraph ASSESS["ASSESS"]
            direction LR
            A["A · Capture"] --> B["B · Triage"] --> C["C · Identify"]
        end
        subgraph RESPOND["RESPOND"]
            direction LR
            D["D · Decide disposition<br/>«expanded in View 3»"] --> E["E · Treat"] --> F["F · Deliver relevant context"] --> G["G · Accept and retire"]
        end
        C -->|"blocking only"| D
    end
    REVIEW["Reviewer / Owner"] -. "judgement / approval" .-> B
    REVIEW -. "approval" .-> D
    LEDGER[("Existing Error Ledger · #359")] -. "find / record" .-> C
    LEDGER -. "mechanism / disposition" .-> E
    HOOK["Existing bounded context delivery · #394"] -. "reuse" .-> F
    G -. "unrelated NEW problem: re-enter at Capture" .-> INPUT
    G -. "recurrence of the SAME known class: re-evaluate" .-> D
```

Early exits and decisions are omitted in this view; see View 1.

## View 3 (Diagram 3)

```mermaid
flowchart TD
    IN["C · Identify: class + evidence"] --> MECH
    subgraph D_DETAIL["D · Decide disposition (expanded from Views 1–2)"]
        direction TB
        MECH{"Mechanical prevention feasible within budget?"}
        MECH -->|Yes| RECHECK{"Bounded review still finds new instances?"}
        RECHECK -->|No| CONV["Converge"]
        RECHECK -->|Yes| DROP{"Can action be dropped / restricted?"}
        MECH -->|No| DROP
        DROP -->|Yes| AVOID["Avoid"]
        DROP -->|No| TOLAPP{"Owner approves tolerate class?"}
        TOLAPP -->|Yes| TOL["Tolerate"]
        TOLAPP -->|No / pending| PENDING["Unresolved; do not silently waive checks"]
    end
    CONV --> OUT["E · Treat: define acceptance, then act"]
    AVOID --> OUT
    TOL --> OUT
```
