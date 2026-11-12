# First pass — blind reading of diagram-only.md (Error Handling, round 2)

Stimulus read: `evaluation/operator.md`, `evaluation/diagram-only.md` only. Parent README and `second-pass-material/` not opened.

## My reading

**Drawn facts (1): what the drawings establish**

- View 1 has two subgraphs, ASSESS (A Capture → B Triage → branches) and RESPOND (D Decide disposition → E Treat → F Deliver context → G Accept and retire → RESULT).
- View 1 has four decision points before any treatment: tolerate-class check (T), real-problem check (REAL), known-class check (KNOWN), owner-approval check for a new definition (APPROVAL). Then NOW ("Blocking main path?") gates entry to D.
- Only items that are real, blocking, and known or approved are drawn going into D. Non-blocking real items end at DEFER ("Record only; defer treatment").
- RESPOND decides disposition in order: Converge (needs mechanical prevention plus a clean bounded recheck), Avoid (action can be dropped or restricted), Tolerate (needs owner approval), or PENDING (no approval, not bypassed).
- After E, F, G, the result is Accept/retire (Converge, Avoid), Keep active (Tolerate, with "cap and escalation recorded"), or Open (not met / unverified).
- A dotted edge from RETIRE back to D says a later recurrence of the same known class re-evaluates disposition. View 2 draws the same edge from G.
- View 2 draws an extra dotted edge from G back to INPUT ("unrelated NEW problem: re-enter at Capture"). View 1 does not draw it.

**Inference (2)**

- The tolerate path (T = Yes) is meant for pre-approved transient issues. It loops retries (max 3), then either resumes or marks the step UNVERIFIED and reports.
- A new class is not created without owner approval (APPROVAL → HOLD, "no implicit new class").
- Owner and reviewer judgement enter at a few places (REAL = Unclear, APPROVAL, TOLAPP) and never as automatic acceptance.

**Unclear (3)**

- The drawings do not say how "already-approved tolerate class" membership is established or stored.
- "Blocking main path?" has no definition.
- The retry budget ("max 3") is not defined for the attempt count, and nothing states whether it counts the first attempt.
- "Mechanical prevention feasible within budget?" names a budget that is never defined.
- "cap" in Tolerate is not defined.

## Diagram-to-diagram mapping

| Concept | View 1 | View 2 | View 3 |
|---|---|---|---|
| Capture / Triage / Identify | A, B, C (ASSESS) | A, B, C (LR chain) | Entry at C only |
| Decide disposition | D (expanded in View 3) | D | D_DETAIL (MECH, RECHECK, DROP, TOLAPP) |
| Retry / resume / UNVERIFIED | T=Yes branch: R, REC, RESUME, UNV | Omitted ("early exits omitted") | Absent |
| Ledger record | OCC (known), DEF (approved new) | LEDGER → C "find/record", LEDGER → E "mechanism/disposition" | Absent |
| Context reuse | F (no detail) | HOOK #394 → F "reuse" | Absent |
| Recurrence re-evaluation | RETIRE -.-> D | G -.-> D | Absent |
| Unrelated new problem | Absent | G -.-> INPUT | Absent |

Mismatches and gaps between the views:

- View 2 draws G → INPUT ("unrelated NEW problem"). View 1 has no such edge. It is not clear whether an accepted item can re-enter at Capture from G in View 1.
- View 2 places reviewer judgement at B (Triage). View 1 places the reviewer question (REAL) after the tolerate check, so the reviewer's role differs between the views.
- View 2 says ledger writes happen at C and E. View 1 writes only at OCC and DEF, and not on the retry branch.
- The HOOK (#394) and LEDGER (#359) appear only in View 2. Nothing in View 1 or View 3 shows what these components do.

## Case-by-case

**Case 1: intermittent, already-approved transient failure in the active step, still failing after three attempts.**

- Branch: Start → A → B → T = Yes (approved tolerate class) → R "Retry (max 3)" → REC = No → UNV.
- Next activity: UNV "Mark step UNVERIFIED; report; continue independent work only."
- Resume / pause / record: The step is not resumed (RESUME is only on REC = Yes). It is marked UNVERIFIED and reported. Independent work continues. Nothing is recorded in a ledger on this path, because OCC/DEF are not reached.
- Cannot be declared: the step as done or verified. The retry does not reach D, so Tolerate's "cap and escalation recorded" never happens on this path.
- Unclear: where UNVERIFIED is recorded, what "independent" work means, and whether the failing step's dependents also stop.

**Case 2: a reviewer finds a real defect that does not block the current main work.**

- Branch: Start → A → B → T = No → REAL = Yes → C → KNOWN:
  - Known: OCC "record occurrence in existing ledger" → NOW = No → DEFER "record only; defer treatment" → End.
  - New, owner pending: APPROVAL = No → HOLD "keep pending" → End (the item is held, not deferred).
  - New, owner approves: APPROVAL = Yes → DEF "define class in existing ledger" → NOW = No → DEFER → End.
- Next activity: record the occurrence (or define the class once approved), defer treatment. No D/E/F/G runs.
- Resume / pause / record: main work is not paused by this item; the defect is recorded in the existing ledger.
- Cannot be declared: that the defect is fixed or treated. The drawings do not give a revisit trigger for the deferred record.
- Unclear: where DEFER records to (the diagram says only "Record only"), and whether a held (HOLD) item and a deferred item have different owners.

**Case 3: a known, blocking error returns after a previously successful treatment.**

- Branch (most likely): Start → A → B → T = No → REAL = Yes → C → KNOWN = Yes → OCC → NOW = Yes → D → MECH → RECHECK …
- The "previously successful treatment" implies the earlier item went through G and reached RETIRE. RETIRE has a dotted edge back to D ("later recurrence of the SAME known class: re-evaluate disposition").
- Next activity: D decides again (Converge, Avoid, Tolerate, or PENDING), then E Treat (define acceptance first), F, G, and RESULT.
- Resume / pause / record: OCC records the occurrence in the ledger. The blocking item is not deferred.
- Cannot be declared: resolved from the earlier success. The recurrence needs fresh disposition and treatment. RETIRE's "accept" does not carry over.
- Unclear and potentially misleading:
  - The RETIRE → D edge jumps past ASSESS, so the recurrence is not re-classified or re-checked for blocking status. It is not drawn whether this is intentional.
  - If the earlier item had ended in KEEP (Tolerate) or OPEN, no recurrence edge is drawn. The "previously successful" wording can not be mapped onto that case.
  - If the blocking error falls in the approved tolerate class (T = Yes), the flow goes to retry, not to D. The drawings do not say which of the two routes is correct for a blocking error.

**Case 4: a new class is suspected, but owner approval has not been given.**

- Branch: Start → A → B → T = No → REAL = Yes (assumed; REAL = No would dismiss, Unclear would hold) → C → KNOWN = No → APPROVAL = No/pending → HOLD "keep pending; no implicit new class" → End.
- Next activity: nothing is defined or treated. The item is held.
- Resume / pause / record: the item is paused in HOLD. No ledger entry is written, since DEF is not reached.
- Cannot be declared: a class exists or the item is classified. The flow never reaches D, so no disposition is decided.
- Unclear and potentially misleading:
  - HOLD ends before NOW ("Blocking main path?") is checked. If the suspected class is blocking, the drawings do not say the main path must stop.
  - REAL is not drawn as Yes for this case. The diagram doesn't say what happens if the reviewer is not sure the item is real.
  - Two different "hold" labels exist: REAL = Unclear → "Request owner decision; hold item" (OWNER) and APPROVAL = pending → "Keep pending" (HOLD). They look equivalent but are not drawn identically.

## What I could not determine

- How tolerate-class membership or owner approval is recorded, and where.
- The definition of "blocking main path" and whether it is evaluated for held items.
- The meaning and size of the "budget" and "cap".
- The retry attempt count (whether "max 3" includes the first attempt).
- Whether recurrence re-enters at D without re-triage.
- Where the ledger is, and what #359 and #394 actually do.
- What "resume interrupted work" and "continue independent work" mean in practice.
- Whether any outcome can be declared verified from the diagrams alone. None can.

## Confidence 0–5 with reasons

**3 / 5.** The branch structure is clear and consistent between the views for the main Converge/Avoid/Tolerate/PENDING flow. Confidence is lower on the operational meaning of the terms: budget, cap, blocking, class registry and the retry count. The views also disagree on where reviewer judgement and ledger writes happen (see the mapping section), and View 2 has a re-entry edge that View 1 lacks.

STATUS: DONE
