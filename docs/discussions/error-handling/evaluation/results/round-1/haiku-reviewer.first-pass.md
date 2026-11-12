# First pass — blind diagram review (reviewer 4)

Stimulus: `diagram-only.md` (diagrams frozen at `33e1ef78`). Files read before this pass: `reviewer.md`, `diagram-only.md`. Nothing else was opened.

Labels: **[D]** = drawn in the diagrams, **[I]** = my inference, **[U]** = unclear. "Diagram 1" = View 2 composition (ASSESS/RESPOND subgraphs), "Diagram 2" = View 1 composed activity, "Diagram 3" = View 3 expansion of D.

## My reading

- **[D]** One loop with two halves. ASSESS: A Capture → B Triage → C Identify → NOW gate ("Blocking main path?"). RESPOND: D Decide disposition → MECH / RECHECK / DROP / TOLAPP → Converge, Avoid, or Tolerate → E Treat → F Deliver → G Accept → RESULT.
- **[D]** Three disposition outcomes are drawn: Converge (mechanical prevention feasible and bounded review finds no new instance), Avoid (action dropped or restricted), Tolerate (owner approves). Unresolved or stop outcomes are HOLD, OWNER, DEFER, PENDING, WAIT, UNV, OPEN, DISMISS, RESUME. Every one of them ends at the same `End` node (Diagram 1, lines 62–71).
- **[D]** Retry exists only on the approved-tolerate branch: `T -->|Yes| R["Retry this operation (max 3)"]`. On failure the step is marked UNVERIFIED and the agent continues "independent work only".
- **[D]** Recurrence after retirement is a dashed edge `RETIRE -. "Later recurrence of same class; re-evaluate" .-> D`.
- **[I]** This is a decision model of error handling, not a description of running tooling. The drawings do not show that a ledger, hook or CLI exists.
- **[I]** The owner is the only approval authority for new classes, tolerate, and unclear real problems.

## Diagram-to-diagram mapping

| Concept | Diagram 1 (View 2) | Diagram 2 (View 1) | Diagram 3 (View 3) | Status |
|---|---|---|---|---|
| Does identified work reach disposition unconditionally? | No. `C → KNOWN → … → NOW`; only `NOW -->|Yes| D` (line 59) reaches D. `NOW -->|No|` → DEFER → End. | Yes: `C --> D` (line 89). | Yes: `IN["C · Identify"] --> Q` (line 103). | **Conflict** |
| Where a recurrence goes after retirement | `RETIRE -.-> D` (line 60): skips A, B, C, KNOWN/OCC, APPROVAL. | `G -.-> INPUT` (line 96): full restart at A. | Not drawn. | **Conflict** |
| Retry on failure | Yes, only on `T=Yes` (tolerate-approved). | Absent. | Absent. | Coverage gap |
| Converge / Avoid / Tolerate | All three drawn; each → E. | Absent (linear C → D → E → F → G). | All three → OUT. | Consistent in names |
| Downstream outcome of Converge vs Avoid | Both → G → `RESULT` "met" → RETIRE. Identical. | Absent. | Ends at OUT. | Not distinguishable downstream |
| Tolerate cap and escalation | `RESULT` requires "cap and escalation recorded" → KEEP. Cap value not stated. | Absent. | `TOL → OUT`; no cap. | Presentation mismatch |
| New class not yet approved | `APPROVAL -->|No / pending| HOLD` → End. | Absent (only the ledger edge). | Absent; starts from a known class. | Coverage gap |
| Unresolved tolerate | `PENDING`: "do not bypass required checks" → End. | Absent. | `WAIT`: "do not silently waive checks" → end, no exit. | Same meaning, different wording |
| Owner approval | Dashed-ish in the form of diamonds: REAL=Unclear, APPROVAL, TOLAPP, plus retry-tolerate class. | Dashed `REVIEW → B` and `REVIEW → D`. | `T` diamond. | Broadly consistent |
| Ledger | OCC and DEF only. | `LEDGER → C` and `LEDGER → E` (mechanism/disposition at Treat). | Absent. | Partial: View 1 uses the ledger at Treat, Diagram 1 does not |
| Delivery hook (#394) | Absent. | `HOOK → F` ("reuse"). | Absent. | Only View 1 claims it |

## Unclear or potentially misleading

1. **[D] Blocking is asked twice.** Diagram 1 line 23 (`BLOCK`) sends both branches to C, so the first diamond does nothing. A reader would take it as a filter before Identify. It is not one. Only the second check (NOW) has an effect.

2. **[D] Non-blocking items are treated differently by view.**
   - Input: a reviewer finding that is a real problem, does not block the main path, and matches a known class. Path in Diagram 1: `REAL=Yes → BLOCK=No → C → KNOWN=Yes → OCC → NOW=No → DEFER → End`.
   - Diagram 2 reads it as `C → D → E → F → G`, so the reader expects a disposition and a treatment. Consequence: the reader expects a Converge/Avoid verdict that the reviewer-facing path never reaches, or the reverse. This is an actual conflict.

3. **[D] Recurrence after retirement has two targets.**
   - Diagram 1: `RETIRE → D`. This skips Capture, Triage, Identify, and the ledger occurrence record.
   - Diagram 2: `G → INPUT`, a full pass from A.
   - Counterexample: a retired class (signature S1) recurs. Via Diagram 1 the path lands directly in D with no occurrence record. A new finding with signature S2 that the reviewer wrongly marks as "same class" also goes to D, and the `APPROVAL` gate ("Owner approves definition?") is never reached. Via Diagram 2 the same input goes through `KNOWN` and `APPROVAL`.
   - Consequence: a different signature can bypass the owner's definition gate, and recurrence counts are not written. This is the "re-occurrence vs new problem" confusion the packet asks about. Actual conflict in the drawings.

4. **[D] Converge and Avoid share one outcome.** Both go to `E → F → G → RESULT "met" → RETIRE`. Converge is reached when bounded review finds no new instance. Avoid can also be reached when `RECHECK=Yes` (Diagram 1 line 41–43). So a class that bounded review still shows recurring can be retired after Avoid.
   - Counterexample: class K, `RECHECK=Yes`, `DROP=Yes` → Avoid → RESULT met → RETIRE. The lesson is retired while the review just showed the class still occurs.
   - Retirement only resumes on a later recurrence. [U] Whether that is intended.

5. **[D] Retry "max 3" is ambiguous and has no counter.**
   - [U] Three total attempts, or three retries after the first failure?
   - [D] The label says "this operation", so the cap is operation-local. No counter is drawn anywhere.
   - Counterexample: approved class X fails in operations O1…O20, three times each. Every operation goes `R → REC=No → UNV → continue independent work only → End`. Nothing in the drawings counts across operations or escalates. This is an absence, not a contradiction.

6. **[D] A recovered retry leaves no trace.** `REC=Yes → RESUME → End` has no edge to OCC or the ledger. The Tolerate RESULT says "cap and escalation recorded", but nothing drawn records the occurrences that a cap would count. [I] The tolerate cap can never trip.

7. **[D] An approved-tolerate class skips the reality checks.** `T=Yes → Retry` never passes through "Real problem?" or "Blocks main path?". Counterexample: class X is tolerated for a warning-level problem. A new occurrence blocks the main path. Retry fails three times → UNV → "continue independent work only" → End. [U] Whether dependent downstream work halts, and whether the blocking nature is recorded anywhere. Neither is drawn.

8. **[D] Held and pending items look like terminal success.** All hold and pending states end at the same `End` as DISMISS and RETIRE. Counterexample: a blocking reviewer finding with a new signature and no owner reply. Path: `REAL=Yes → BLOCK=Yes → C → KNOWN=No → APPROVAL pending → HOLD → End`. No edge connects HOLD to NOW, D, or any stop. [U] Whether the blocked main path halts. A reader can assume it does, or that it doesn't. Safe outcome for the item is drawn (no implicit new class). Safe outcome for the main path is not.

9. **[D] Pending decisions have no re-entry edge.** `TOLAPP → PENDING → End`, `WAIT → (no exit)`, `APPROVAL → HOLD → End`, and `RESULT → OPEN → End`. When the owner later approves, no drawn edge brings the flow back to the decision. The only re-entry is `RETIRE → D` on recurrence (see point 3).

10. **[D] Two different "tolerate" questions.** `T: Approved tolerate class?` asks whether a class was approved before. `TOLAPP: Owner approves Tolerate?` asks whether the owner approves now. Similar names, different meanings; a reader can conflate them.

11. **[D] "Existing" labels are assertions.** Diagram 2 says "Existing Error Ledger · #359" and "Existing bounded context delivery · #394". The drawing cannot establish that either exists. [U] Whether either is implemented. I am not assuming it is.

12. **[D] Undefined terms that carry the logic.** "budget" (MECH in Diagrams 1 and 3), "bounded review" (RECHECK, R), "met" (RESULT), "restricted" (DROP), "required checks" (PENDING), "cap" (Tolerate), "define acceptance first" (E). No node defines any of them.

13. **[D] Diagram 3 says it expands Views 1–2 but omits the gate.** Diagram 1 has NOW between C and D. Diagram 3 goes straight from `C` to `Q`. Diagram 2 also goes straight from C to D. So Diagram 3 matches Diagram 2 and not Diagram 1 on this point (see table row 1).

14. **[D] Wording differences in unresolved outcomes.** PENDING: "do not bypass required checks". WAIT: "do not silently waive checks". Same intent; different strength of wording. Minor.

## What I could not determine

- Whether a held blocking item halts the main path (point 8).
- Whether "max 3" means attempts or retries, and whether the cap is per operation or total (point 5).
- Which recurrence target is intended, D (Diagram 1) or INPUT (Diagram 2) (point 3).
- Whether DEFER items are ever treated later. No re-entry is drawn (point 9).
- What "met", "budget", "bounded review", "restricted" and "required checks" mean operationally (point 12).
- Whether Tolerate's cap is the same as Retry's max 3 (table row "Tolerate cap").
- Whether the ledger and the #394 hook exist (point 11).
- Who acts on an UNVERIFIED report, and what happens to the step that stays unverified (point 7).
- Which view governs when they disagree. Diagram 3 says it expands Views 1–2, but no view is marked authoritative.

## Confidence 0–5 with reasons

**3.**
- The structure is readable and the node labels are specific, so the main loop is clear.
- Several conflicts are drawn facts I can point to by line: the gate before D, the recurrence target, and Converge/Avoid merging. These are not guesses.
- Confidence is held down because several decisive terms are undefined (budget, bounded review, met, cap), the cap is ambiguous, and existence claims ("Existing") cannot be checked from drawings.
- I have not executed anything. This is a reading of the drawings only, so every point is source-traced from the diagrams, not executed.

STATUS: DONE
