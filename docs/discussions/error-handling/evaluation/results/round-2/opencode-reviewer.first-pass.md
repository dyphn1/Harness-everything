# Blind first pass — reviewer 4

Stimulus: `evaluation/diagram-only.md` only (round 2 diagrams, frozen at `8e76b8d2`). No README, no nodes.yaml, no other reviewers' material.

## My reading

Two stages — ASSESS (A Capture → B Triage → C Identify) and RESPOND (D Decide disposition → E Treat → F Deliver context → G Accept and retire) — with early exits from triage and a gate before D.

What the drawings establish:

- **Triage (B).** Every item is first checked against an "Already-approved tolerate class". Yes → retry *this operation* (max 3) → recovered: resume interrupted work; not recovered: mark the step UNVERIFIED, report, continue independent work only. No → "Real problem?" as judged by a reviewer: No → dismiss with reason; Unclear → request owner decision and hold the item; Yes → C.
- **Identify (C).** Match against existing class/signature. Yes → record an occurrence in the existing ledger. No → owner must approve a new definition; No/pending → keep pending, no implicit new class; Yes → define class/signature in the ledger. Both occurrence and definition then hit "Blocking main path?" — No → record only and defer; Yes → D.
- **Decide (D, expanded in View 3).** Mechanical prevention feasible within budget? Yes → re-check whether the same class still yields new instances in bounded review: No → **Converge**; Yes → can the action be dropped/restricted? No → owner approves Tolerate: Yes → **Tolerate**; No/pending → keep unresolved, do not bypass required checks. Mechanical prevention infeasible → drop/restrict question directly. All three dispositions flow to E (define acceptance first, then act) → F → G → an outcome evaluation: "Converge / Avoid: met" → accept and retire the unneeded lesson; "Tolerate: cap and escalation recorded" → keep tolerate class active; "Not met / unverified" → keep open and report outstanding evidence.
- **Re-entry.** A later recurrence of the *same* known class re-enters at D for re-evaluation; an unrelated *new* problem re-enters at Capture (View 2). Recurring failures reuse an existing ledger (#359) and context delivery (#394) rather than new machinery.
- **Safety posture the diagrams assert:** pending/unresolved states explicitly forbid bypassing required checks and forbid implicit new classes; unresolved tolerance never silently waives checks.

## Diagram-to-diagram mapping

| View 1 | View 2 | View 3 |
|---|---|---|
| A, B, C (TB inside ASSESS) | A → B → C (LR inside ASSESS) | C is the entry node ("class + evidence") |
| T, REAL, OWNER decision branches | omitted ("early exits and decisions … see View 1") | not present |
| C → KNOWN → OCC/DEF → NOW gate | `C -->|"blocking only"| D` | **no blocking gate at all** — `IN` goes straight to MECH |
| NOW →\|No\| DEFER | omitted | omitted |
| D expanded via «expanded in View 3» | D expanded via same label | the expansion itself |
| D → E → F → G (TB) | D → E → F → G (LR) | not shown (ends at E) |
| REC retry loop, UNV exit | omitted | omitted |
| unnamed "existing ledger" | named: Error Ledger #359, bounded delivery #394 | — |
| RETIRE -.recurrence.→ D | G -.recurrence.→ D (same edge, drawn from G) | — |
| no new-problem re-entry loop | G -.new problem.→ INPUT → A | — |

The three views are consistent on the D/E logic (MECH → RECHECK → DROP → TOLAPP is identical in Views 1 and 3, question wording differs trivially: "same class still yields new instances" vs "bounded review still finds new instances" — same meaning). They differ in coverage, not in logic — except the missing blocking gate in View 3 (below).

## Unclear or potentially misleading

1. **Retry cap scope (reviewer question a).** The node reads "Retry this operation (max 3)". The wording *suggests* an operation-local cap, but nothing drawn shows the counter's scope, when it resets, or whether "max 3" counts retries or attempts. Counterexample: an agent hits failures on steps X and Y. If a reader treats "max 3" as a global agent budget, step Y is denied retries because X consumed them → Y wrongly marked UNVERIFIED and reported, though the diagram's wording permits three fresh retries. Conversely, a reader could treat each *recurrence* of the same operation as resetting the counter, turning a bounded retry into an unbounded one. The diagram cannot settle either reading; the safe-looking outcome (UNV) is reached by the wrong route in the first case.
2. **Retry path never touches the ledger.** The T=Yes branch (approved tolerate class → retry → UNV on failure) records no occurrence anywhere; `OCC` is reachable only through C via the KNOWN=Yes branch, which requires REAL=Yes. Counterexample input: a tolerated class recurs and retries fail. Path: T→R→REC=No→UNV→End. Consequence: the recurrence is marked UNVERIFIED but never recorded in the ledger — a reader cannot tell whether that is intended (tolerate-class occurrences are tracked elsewhere) or a gap that hides re-occurrence frequency from the "Tolerate: cap and escalation" evaluation later.
3. **Converge and Avoid are not distinct at the outcome level (reviewer question c).** Both dispositions flow to the same E, and RESULT lumps them: "Converge / Avoid: met" → retire. The distinction exists only in the entry condition (mechanism prevented vs action dropped). Counterexample: a reader reporting outcomes sees "retired" and cannot classify whether the class was converged (mechanically prevented) or avoided (dropped/restricted) — a finding could be misreported as "we fixed the mechanism" when the action was merely dropped. Also, what "met" means for an *Avoided* class is undefined: acceptance was defined in E for the class, but after dropping the action, does bounded review re-check anything?
4. **Recurrence routing is ambiguous — re-occurrence vs new problem.** View 1's dashed edge sends recurrence of the same known class to D ("re-evaluate disposition"), while triage's own T gate ("Already-approved tolerate class?") routes such an item to *retry*. Counterexample input: a tolerated class recurs. Reader path A: re-enter at D per the dashed edge → possibly Tolerated again without the retry check. Reader path B: hit T=Yes at triage → retry → UNV. These lead to different outcomes (disposition re-evaluation vs UNVERIFIED marking), and the diagrams don't say which applies when. This is exactly where a re-occurrence could be confused with a new problem or vice versa.
5. **View 3 implies non-blocking items get dispositions (reviewer question d).** View 1 gates D behind "Blocking main path?" (No → defer); View 2 restates it ("blocking only"); View 3 omits the gate entirely and feeds C's output straight to MECH. Counterexample: a reviewer working from View 3 alone takes a non-blocking finding through MECH→…→Tolerate, while the View-1 rule says record-and-defer. Same input, two different dispositions depending on which view the reader trusts.
6. **OWNER drawn as terminal vs reviewer as a live input.** View 1 ends the Unclear branch at OWNER ("request owner decision; hold item") — an exit. View 2 draws REVIEW -.→ B as an ongoing input. A reader of View 1 alone could conclude the owner decision terminates the process rather than feeding back into triage; nothing in View 1 shows re-entry after an owner reply.
7. **"Cap and escalation recorded" is unverifiable.** The Tolerate outcome requires a cap and escalation, but no diagram defines what the cap is, where it is recorded, or what escalation looks like. A reader could mark the Tolerate box "cap recorded" without any mechanism existing (the stimulus explicitly warns not to assume machinery exists because a box mentions it).
8. **"Not met / unverified" is terminal.** RESULT=Not met → OPEN ("keep open; report outstanding evidence") ends the flow. Whether it loops back to E or D is not drawn; a reader could believe an unmet acceptance is simply reported and dropped rather than re-treated.

## What I could not determine

- Whether the retry counter is per-operation, per-class, or global; whether it resets between recurrences; whether retries or attempts are counted.
- What "continue independent work only" concretely excludes (does the agent still touch the failed component?).
- What happens to a HELD item (owner decision) or a PENDING item (tolerate approval pending) after the decision arrives — no re-entry edge is drawn from those states; whether they can sit unresolved indefinitely.
- Whether Converge and Avoid have any distinct post-E behaviour, or what "met" means for Avoid.
- What the tolerate class's cap is, and who/what escalates.
- Whether the KNOWN=Yes recurrence path (record occurrence) and the dashed re-evaluation path (skip A–C, go to D) are alternatives for the same event — if both apply, which wins.
- Whether DEFERred (non-blocking) items are ever revisited; no edge returns to them.
- Whether any of the drawn boxes correspond to working mechanisms; the diagrams alone cannot show this and I do not assume it.

## Confidence 0–5 with reasons

**3.**

- +: The core A→G flow, the disposition decision tree, and the explicit safety posture (no bypass, no implicit classes, no silent waivers) are readable and internally consistent between Views 1 and 2.
- −: The retry-cap scope is genuinely ambiguous despite suggestive wording; Converge vs Avoid are indistinguishable at the outcome level; the recurrence routing (dashed edge to D vs triage's T gate) gives two defensible readings with different consequences; View 3's missing blocking gate makes the three views non-interchangeable despite the "expanded from Views 1–2" label.
- −: Several outcome conditions ("met", "cap and escalation recorded") are named but never defined, so I cannot verify any disposition actually completes as drawn.

STATUS: DONE
