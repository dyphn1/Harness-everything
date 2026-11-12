# First pass: blind reading (architect)

Input: only `evaluation/diagram-only.md` (diagrams frozen at 8e76b8d2) and `evaluation/architect.md`. Nothing else was read.

## My reading

**What the drawings establish**
- Diagram 1 has two named partitions. `ASSESS` holds A Capture → B Triage → the reviewer/tolerate/known-class gates → C Identify → the `NOW` blocking gate. `RESPOND` holds D Decide disposition → MECH/RECHECK/DROP/TOLAPP → Converge/Avoid/Tolerate → E Treat → F Deliver context → G Accept and retire → RESULT.
- The only solid edge from ASSESS to RESPOND is `NOW -->|Yes| D`.
- Every exit goes to one shared `Z((End))`: RESUME, UNV, DISMISS, OWNER, HOLD, DEFER, PENDING, RETIRE, KEEP, OPEN.
- The only cycle is a dotted edge, `RETIRE -. "Later recurrence of the SAME known class" .-> D`.
- Diagram 2 covers the same A–G nodes. It states that early exits and decisions are omitted. It adds REVIEW, LEDGER (`Existing Error Ledger · #359`), HOOK (`Existing bounded context delivery · #394`), and two dotted re-entries from G: `G → INPUT` (new problem) and `G → D` (same class recurring).
- Diagram 3 expands only D: MECH → RECHECK → DROP → TOLAPP, with outputs CONV, AVOID and TOL into `E · Treat`. Its input is `C · Identify: class + evidence`. It has no Start and no End.

**What I infer**
- ASSESS is the classify-and-gate stage (should this become work, and does it block the main path?). RESPOND is the act stage (what to do about it). I infer this from node content, not from the subgraph names.
- A–G are the stable actions. The diamonds and the owner/tolerate gates are control nodes. Converge, Avoid and Tolerate are disposition outcomes: they act as decisions and also feed actions.
- Diagram 3 is a sub-activity expansion of D, not a separate workflow.
- The link between the diagrams is textual: shared letters and labels. Diagram 1 says the letters are drawing-local aliases, so the only shared identity is the label text.

## Diagram-to-diagram mapping

| Node | Diagram 1 | Diagram 2 | Diagram 3 |
|---|---|---|---|
| A Capture | ASSESS; entry from Start | ASSESS | none |
| B Triage | ASSESS | ASSESS; REVIEW judgement attaches here | none |
| C Identify | ASSESS, after `REAL = Yes` | ASSESS; `C → D` labelled "blocking only" | IN (input) |
| D Decide disposition | RESPOND; entered from `NOW = Yes` and from RETIRE (dotted) | RESPOND; entered from C (blocking only) and from G (dotted) | expanded here |
| Converge / Avoid / Tolerate | outcomes of MECH, DROP and TOLAPP | not drawn | outputs to E |
| E Treat | RESPOND; "define acceptance first" | RESPOND; LEDGER feeds mechanism/disposition | OUT |
| F Deliver context | RESPOND; no external link | RESPOND; HOOK #394 "reuse" | none |
| G Accept and retire | RESPOND; RESULT branches | RESPOND; two dotted re-entries (INPUT, D) | none |
| Ledger | OCC and DEF only, in ASSESS | find/record at C; mechanism/disposition at E | none |
| Owner approval | APPROVAL (define class), TOLAPP (tolerate) | approval arrows into B and D | TOLAPP |
| New unrelated problem | no edge back into the flow | `G → INPUT → A` | none |

Correspondence checks:
- `C → D` (blocking only) in D2 matches the `NOW` gate in D1. Consistent.
- D2 draws owner approval only into B and D. D1 has a separate owner gate for defining a new class (APPROVAL) that D2 never draws.
- D2 draws the ledger feeding E. D1 never does.
- D1 limits recurrence re-entry to RETIRE. D2 draws it from every G outcome.

## Unclear or potentially misleading

1. **D2 contradicts its own gate.** D2 says only blocking items enter D (`C -->|blocking only| D`). The dotted recurrence `G → D` skips that gate. D1 draws the same dotted edge from RETIRE, which also skips the `NOW` gate. A non-blocking, retired class that recurs goes straight to disposition, which contradicts the gate.
2. **Two routes to D for the same recurrence.** A known-class recurrence can go `C → KNOWN(Yes) → OCC → NOW → D` (solid, passing Triage and reviewer judgement) or `RETIRE -.-> D` (dotted, skipping ASSESS). The drawing does not say which applies.
3. **Kept tolerate class has no edge back to D.** KEEP goes only to Z. Its next occurrence can only be handled by `T: Already-approved tolerate class?` → Retry, which skips D, E, F and G. An approved tolerate is therefore never re-dispositioned in the drawing.
4. **"Retry (max 3)" is text only.** R → REC, and "No" → UNV. There is no back edge and no counter, so the bound cannot be checked.
5. **Held items have no re-entry.** OWNER ("Request owner decision; hold item"), HOLD ("Keep pending") and PENDING ("Keep unresolved") all go to End. No edge brings a later owner decision back into REAL, APPROVAL or TOLAPP.
6. **"Continue independent work only" has no successor.** UNV → Z. The reader cannot tell whether the activity keeps running after an unverified step.
7. **RESUME → End.** "Resume interrupted work" has no drawn work after it.
8. **RESULT is incomplete.** Converge/Avoid "met" → RETIRE. Tolerate "cap and escalation recorded" → KEEP. "Not met / unverified" → OPEN, one generic node. A tolerate that fails its cap, or a Converge that is not met, is drawn only as the generic OPEN.
9. **RECHECK timing is ambiguous.** RECHECK ("same class still yields new instances in bounded review?") sits before E Treat, so no treatment has yet happened. Its Yes branch leads to DROP, never back to MECH. The reader cannot tell whether it measures earlier treatment or only pre-treatment history.
10. **Mechanical prevention is a feasibility check only.** No node is drawn that performs prevention. E Treat is the only candidate, and it is not labelled as prevention.
11. **Shared End hides outcome.** RETIRE, KEEP, OPEN and PENDING all go to Z. Success cannot be told apart from waiting.
12. **D2 reads as a line when used alone.** It states that early exits are omitted. Read on its own, it looks like a plain A→B→C→D→E→F→G pipeline.
13. **Undefined terms.** "within budget", "bounded review", "cap", "define acceptance first" (E), "reviewer" and "owner" (who they are, and whether they are the same person), and the meaning of Converge, Avoid and Tolerate beyond their labels.
14. **Diagram 3 is partial.** It has no Start, and PENDING has no outgoing edge. Diagram 1 has PENDING → End, so the two are not identical.
15. **External labels.** "#359" and "#394" appear only as labels. Their referents cannot be resolved from the drawings.

## Interpretation checks

Partitions:
- ASSESS = classify and gate; RESPOND = act. **Supported** by node membership. The subgraph names alone would not establish it.

Relationship of Diagram 1 and Diagram 2:
- D2 condenses D1: A–C from ASSESS, D–G from RESPOND, with the blocking-only edge matching `NOW`. **Supported** for the main path. D2 does not fully render D1.

Diagram 3:
- A separate workflow? **Unsupported.** It has no Start or End, and it is labelled as an expansion of D.
- A sub-activity of D? **Supported** by its title "expanded from Views 1–2" and by the "expanded in View 3" note on D.
- Mere cross-reference? Partly. Its logic repeats D1's D-region, so it adds no new branches.

Stable Actions versus control nodes:
- Stable actions: A–G.
- Action leaves: Retry, Resume, Mark UNVERIFIED, Dismiss, Request owner decision, Record occurrence, Define class, Record only, Retire, Accept.
- Control nodes: T, REAL, KNOWN, APPROVAL, NOW, REC, MECH, RECHECK, DROP, TOLAPP, RESULT.
- Hybrid: Converge, Avoid, Tolerate.
- **Ambiguous**: Hold, Keep pending and Keep open read as states, not actions.

Correlation type:
- Textual (shared labels and letters).
- Logical for `C → D` and `NOW → D`.
- Executable: **Unsupported**. The drawings have no IDs, no state fields and nothing runnable. Diagram 1's note says node ids are local to each diagram.

Recurrence and exits:
- **Ambiguous**, partly compatible. Both diagrams send a recurrence to D, but D2 sends it from every G outcome and D1 only from RETIRE.
- D2's `G → INPUT` (new problem re-enters at Capture) has no D1 counterpart.
- KEEP has no recurrence edge in D1.

Interpretations:
- I1. One pass per item, Start → End, with recurrence as a later event. **Supported** by the single Start and the dotted edge's "Later recurrence" label.
- I2. Retry runs up to three times. **Unsupported**: no back edge, no counter.
- I3. The blocking gate also applies to recurrences. **Unsupported**: the dotted edges bypass `NOW`, and D2 contradicts its own gate.
- I4. An owner decision on a held item re-enters the flow. **Unsupported**: no edge.
- I5. Diagram 3 is a sub-activity of D. **Supported**.
- I6. A recurring tolerate class is handled by ASSESS retry, not by disposition. **Ambiguous**: the edge exists, but the drawing does not define what Tolerate means.

## What I could not determine

- What #359 and #394 refer to, and whether the ledger and the bounded context delivery are files, services or processes.
- Who the "reviewer" and "owner" are, and whether they are one person.
- The meaning of "budget", "bounded review", "cap" and "define acceptance first".
- Whether Retry is carried out by the system or by an agent.
- Whether End means the item is finished or only that this pass stopped.
- Whether the activity runs once per item or continuously.
- What "Mark step UNVERIFIED" records, and where.

## Confidence 0–5 with reasons

**3.** The nodes and edges are legible, and the A–G mapping is consistent between the diagrams. Against that: key terms are undefined, D2 and D1 disagree on recurrence routing, and the re-entry of held or owner-decided items is not drawn at all. I cannot reconstruct the lifecycle from the drawings alone.

STATUS: DONE
