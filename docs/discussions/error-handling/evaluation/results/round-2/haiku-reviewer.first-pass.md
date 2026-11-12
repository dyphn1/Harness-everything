# First pass (blind) — Error Handling diagrams, source commit 8e76b8d2

Stimulus: `evaluation/diagram-only.md` only (View 1 = Diagram 1, View 2 = Diagram 2, View 3 = Diagram 3). No other file was read.

## My reading

**(1) What the drawings themselves establish**

- The flow has two swimlane-like groups: ASSESS (A Capture → B Triage → C Identify) and RESPOND (D Decide disposition → E Treat → F Deliver context → G Accept and retire).
- Triage branches on "Already-approved tolerate class?". Yes → `Retry this operation (max 3)` → Recovered? Yes → Resume; No → `Mark step UNVERIFIED; report; continue independent work only`.
- Triage No → "Real problem? (reviewer)": No → Dismiss with reason; Unclear → Request owner decision, hold item; Yes → C.
- At C: known class → Record occurrence in existing ledger; unknown class → "Owner approves definition?": No/pending → Keep pending, no implicit new class; Yes → Define class in existing ledger.
- After C/record: "Blocking main path?" No → Record only, defer treatment (End). Yes → D.
- D: "Mechanical prevention feasible within budget?" Yes → "Same class still yields new instances in bounded review?" No → Converge; Yes → DROP check. Mechanical No → DROP check.
- DROP check: Yes → Avoid; No → "Owner approves Tolerate?" Yes → Tolerate; No/pending → Keep unresolved, do not bypass required checks.
- Converge / Avoid / Tolerate all → E Treat (define acceptance first) → F → G Accept and retire.
- After G: Converge/Avoid met → Accept, retire lesson; Tolerate with "cap and escalation recorded" → Keep tolerate class active; Not met/unverified → Keep open, report outstanding evidence.
- Dashed edge: retired lesson → "later recurrence of the SAME known class" → back to D.
- View 2 (composed, early exits omitted): Input → A→B→C; `C -->|blocking only| D`; D→E→F→G; G dashed → INPUT "unrelated NEW problem: re-enter at Capture"; G dashed → D "recurrence of the SAME known class: re-evaluate". Reviewer/Owner attach to B (judgement) and D (approval). Ledger attaches to C (find/record) and E (mechanism/disposition). #394 attaches to F (reuse).
- View 3 (D expanded): same MECH / RECHECK / DROP / TOLAPP structure as View 1; `TOLAPP No / pending → PENDING "Unresolved; do not silently waive checks"`; outputs to `E · Treat: define acceptance, then act`.

**(2) What I infer (not drawn)**

- The "Retry" branch is the only place in the drawing where a step is explicitly marked UNVERIFIED; I infer the authors intend UNVERIFIED to be the signal for "no evidence yet".
- "Converge" means the mechanism worked and recheck is clean; "Avoid" means the action was removed; "Tolerate" means a known residual risk was accepted under an owner approval. These meanings come from the labels only.
- "Recurrence" means a later occurrence whose class matches a retired lesson.

**(3) What is unclear**

- Whether "max 3" is per operation or a global counter across operations. The label says "this operation" but no counter node exists.
- What "Recovered?" tests (operation exit status, or the step's acceptance check).
- What "budget" means, and what happens when mechanical prevention is merely over budget.
- What "bounded review" is, and who runs it.
- What "met" means for Converge and Avoid at G.
- Where a held / pending item is stored: "Keep pending", "hold item", "Keep unresolved", and "Keep open" all end at Z with no ledger record drawn.

## Diagram-to-diagram mapping

| Concept | View 1 (Diagram 1) | View 2 (Diagram 2) | View 3 (Diagram 3) | Consistent? |
|---|---|---|---|---|
| Owner approves a new class definition | Explicit node `APPROVAL` before `DEF` | Not drawn; the only owner edge goes to D (approval) | Not drawn | **No.** View 2 and View 3 omit the definition approval that View 1 requires. |
| Owner approves Tolerate | `TOLAPP` at DROP check | Owner approval edge to D | `TOLAPP`, Yes → Tolerate | Yes, in substance. |
| Non-blocking real problem | `NOW No → DEFER → End` | `C -->|blocking only| D`; the non-blocking edge is absent (stated as "early exits omitted") | Not present (View 3 starts at C → MECH) | Partly. View 3 has no blocking test at all. |
| Recurrence of a retired class | Dashed RETIRE → D, skipping A/B/C | Dashed G → D | Not present | Yes, but View 1 and View 2 both skip Identify on recurrence. |
| New unrelated problem | Not drawn (only Start → A) | Dashed G → INPUT, re-enter at Capture | Not present | **Gap.** View 1 has no edge for a new problem after G. |
| Ledger | Not drawn | `LEDGER` at C and at E | Not drawn | View 2 only. |
| Define acceptance before treat | E label "(define acceptance first)" | E label only "Treat" | `OUT` label "define acceptance, then act" | Wording differs; View 2 drops the precondition. |
| Tolerate-pending wording | "Keep unresolved; do not bypass required checks" | Not drawn | "Unresolved; do not silently waive checks" | Same meaning, different wording. |
| Bounded review recheck | "Same class still yields new instances in bounded review?" | Not drawn | "Bounded review still finds new instances?" | Same node, different wording. |
| Retry | Only under "Already-approved tolerate class? Yes" | Not drawn | Not drawn | View 1 only. |

## Unclear or potentially misleading

1. **Retry scope and cap (View 1, Retry node).** `Retry this operation (max 3)` reads as per operation. Counterexample: three operations, each approved as tolerate, each retried three times → nine attempts. The drawing cannot say whether a global cap exists. Mistaken path: the reader assumes a global counter exists and stops after three total. Consequence: unbounded retries across operations, or the reverse. Unknown from the drawing.

2. **Retry only for approved tolerate classes (View 1, triage).** A first-time failure of an operation that is not yet an approved tolerate class does not enter Retry. A reader of View 2 (which does not draw triage's branch) may think every failure is retried. Mistaken path: first-time transient failure → reader expects retry → diagram routes to Real problem? → owner or dismiss. Consequence: transient failures get no retry until someone approves a class.

3. **"Recovered" is not defined as verified (View 1).** Counterexample: retry exits 0 but produces wrong output. `Recovered? Yes → Resume interrupted work` has no verification node before Resume. The word "Recovered" can be read as "check passed". Mistaken path: reader assumes step verified. Consequence: an unverified step resumes. Only the No branch writes `UNVERIFIED`.

4. **Asymmetric end-state markers (View 1, all End paths).** Only `Mark step UNVERIFIED` (retry failure) marks a verification state. These other ends carry no marker: HOLD ("Keep pending; no implicit new class"), PENDING ("Keep unresolved"), DEFER ("Record only"), DISMISS, OWNER ("hold item"), and OPEN ("Keep open"). Counterexample: a blocking finding with an unknown class and approval pending → `APPROVAL No/pending → HOLD → Z`. The required check that found it is never marked UNVERIFIED. Mistaken path: a reader who sees "End" without an UNVERIFIED mark assumes the required check passed. Consequence: a required check looks passed. The drawing does not say the main path stops at HOLD; "Blocking main path?" is evaluated before C's approval only in the NOW branch, which HOLD skips.

5. **Avoid retires a lesson without owner approval (View 1, DROP → Avoid → G → RETIRE).** Converge and Avoid both reach `Accept; retire unneeded lesson` with no approval node. Only Tolerate requires owner approval. Counterexample: a required safety check; mechanical prevention is over budget (MECH No) → DROP Yes → Avoid → G → lesson retired. Mistaken path: a reader treats "over budget" as "not needed". Consequence: a required check is dropped and its lesson retired with no owner decision. Whether "dropping an action" is allowed for a required check is not drawn.

6. **Tolerate has no drawn outcome without a cap record (View 1, RESULT).** RESULT has three edges: Converge/Avoid met; Tolerate with "cap and escalation recorded"; Not met/unverified. Counterexample: Tolerate accepted, cap not recorded. No edge matches. Mistaken path: reader assumes it falls to "Not met" or to KEEP. Consequence: an accepted tolerate can stay active with no cap.

7. **Recurrence skips Identify (View 1 dashed edge; View 2 dashed G → D).** After retirement, a recurrence goes straight to D. C, where "Existing class / signature?" is checked, is skipped. Counterexample: retired class "missing lock" recurs with a different cause. Path: G → D → MECH Yes → RECHECK No → Converge again. The diagram gives no criterion for "SAME" and no step that re-matches the signature. Mistaken path: a reader treats a new cause as the same class. Consequence: a new problem is closed under a retired disposition. View 2's dashed "unrelated NEW problem → re-enter at Capture" is the only drawn separator, and View 1 does not draw it.

8. **Converge is not labelled as verified (View 3, MECH → RECHECK No → Converge).** "Converge" appears after a bounded review that found no new instances. Counterexample: the bounded review was never run (budget exhausted, nothing drawn for "not run"). Mistaken path: reader reads Converge as "verified clean". The drawing has no "not run" exit from RECHECK.

9. **View 2 drops the define-acceptance precondition (View 2, E label).** View 1 and View 3 say define acceptance first (or then act). View 2's E label is just "Treat". Counterexample: a reader using only View 2 treats a Tolerate or Avoid without acceptance criteria. Mistaken path: reader implements E directly. Consequence: acceptance is undefined when G checks "met".

10. **View 2 implies every input reaches D.** `C -->|blocking only| D` is the only exit from ASSESS; DISMISS, OWNER, HOLD, DEFER, and the new-class approval are not drawn. The note "early exits and decisions are omitted" makes this a stated simplification, but a reader who takes View 2 alone can conclude that non-blocking findings are silently dropped.

11. **Owner approval edges differ (View 2 vs View 1).** View 2 has `REVIEW -. approval .-> D`. View 1 has the approval for a new class definition at APPROVAL (before DEF, outside D). A reader of View 2 alone can think the only owner approval is the tolerate decision in D. Mistaken path: new-class definition goes through without approval. Consequence: an implicit new class in the ledger, which View 1 forbids.

12. **Ambiguous "Real problem? (reviewer)" (View 1, triage).** The label says the reviewer decides. Nothing drawn says whether the reviewer is an agent, a human, or the same agent that caused the failure. Counterexample: an agent's own failure is judged "No" → Dismiss. Mistaken path: the failing agent dismisses its own failure. Consequence: unverifiable dismissal. The drawing does not say who may dismiss.

## What I could not determine

- Whether `max 3` is per operation or global.
- Whether "Recovered" means the step's acceptance check passed.
- The size of "budget" and what happens at budget exhaustion beyond the MECH No branch.
- What "bounded review" consists of and whether it can be skipped.
- Whether Avoid requires owner approval.
- What "met" means for Converge and Avoid.
- Where pending items and held items are stored (no ledger record is drawn on any pending or hold path).
- Whether View 1, View 2 and View 3 are all normative or whether View 2 and View 3 are simplifications of View 1.
- Whether a new unrelated problem after G (View 2's dashed edge) is also handled in View 1.
- Who "reviewer" is at the Real problem? node.

Actual conflicts (not lack of information):
- Owner approval of a new class definition: View 1 has it; Views 2 and 3 do not.
- New unrelated problem after G: View 2 has it; View 1 does not.
- Define-acceptance precondition: View 1 and 3 have it; View 2 does not.

Lack of information (not conflicts): cap scope, the meaning of "Recovered", "budget", "bounded review", "met".

## Confidence 0–5 with reasons

**2 / 5.** The three views share one node set and mostly agree, so the structure is readable. But four terms that decide outcomes are undefined (cap scope, Recovered, budget, bounded review), the End states do not mark verification status except for one branch, and there are three concrete view-to-view conflicts (definition approval, new-problem re-entry, define-acceptance precondition). I can state concrete counterexamples for each, so my reading is not uncertain about where the risk is, only about the intended meaning of several labels.

STATUS: DONE
