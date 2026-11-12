# Second pass: differences from the first pass

Read after `first-pass.md` was written. `first-pass.md` is unchanged. This file lists only what the README and nodes.yaml add or change.

## Differences

1. **Recurrence re-entry is resolved by prose, not by the diagrams.** README View 2 says: "An unrelated new problem re-enters at Capture, while a recognized recurrence may resume review of the existing disposition." So Diagram 1's RETIRE -. D (recognized recurrence → Decide) matches the prose. Diagram 2's G -. "newly observed recurrence" .-> INPUT matches only the unrelated-new-problem case. My first pass flagged this as a conflict. The prose confirms the conflict is in the drawing labels, not in the intent. Case 3 (reading b) therefore re-enters at D, and an unrelated problem re-enters at A.

2. **Dotted edges are explanatory, not mandatory flow.** README View 2: "Dotted lines are explanatory associations, not new graph edge types." This answers my open question about whether RETIRE -. D and G -. INPUT are mandatory. Neither is a required step in the flow.

3. **Retry budget scope.** README View 1, B/Triage: "an already-approved tolerate class can have a bounded per-operation retry (up to three); failure leaves that step UNVERIFIED and does not convert mandatory evidence into PASS." So "max 3" is per operation, not per recurrence. The diagram still draws no loop back from REC=No to R, so my point 6 (not drawn as a loop) still holds. Case 1 is unchanged.

4. **The retry lane and the blocking check.** README B/Triage says Triage judges "whether main path is blocked". That confirms the BLOCK node belongs to B. It does not say whether the retry lane (T=Yes) should check blocking. My point 5 stands: T=Yes goes to R without any BLOCK or NOW check. The README is silent on this, so it stays unclear.

5. **BLOCK and NOW are both kept on purpose, but the README does not explain the double check.** README says: "A non-blocking item is identified/recorded, then deferred; it does not open an immediate fix cycle." That confirms DEFER for non-blocking items, so Case 2 is unchanged. It does not explain why both BLOCK (after REAL) and NOW (after OCC/DEF) exist. My point 4 stays open.

6. **Held or deferred items have no re-entry.** README: "Recording an occurrence is not a new ledger." and "Creating an unknown class requires owner approval." These confirm HOLD (Case 4) and occurrence recording (Case 2). Still no README statement says how a held or deferred item is re-triaged. Cases 2 and 4 keep their "cannot determine" entries.

7. **Diagram 2 is not a flow specification.** README View 2: "deliberately a structure/composition view, not a second executable flow specification." So my point 1 (Diagram 2 looks linear and hides exits) is a reading risk the author already intends to avoid, not a contradiction. I still count it as misleading for a reader who skips the README.

8. **The views are now identified.** View 1 = overall UML activity (Diagram 1). View 2 = composition (Diagram 2). View 3 = D Action detail (Diagram 3). The README says: "Decisions are not additional persistent Actions." My earlier "What I could not determine" entry about View numbering is resolved.

9. **Unexplained references are now explained.** #359 is the existing Error Ledger. #394 is the existing bounded context delivery. README: "no new implementations are implied." Neither changes a branch in the three cases.

10. **D budget.** README View 1, D: "The existing #437 budget suggestion is one correction plus one review; there is no global recurrence counter or forced Zoom-out." So Case 3's MECH check has a fixed one-correction-plus-one-review budget, and there is no counter across recurrences. This is a new fact for Case 3. It explains why a recurring class re-enters at D with no counter.

11. **Tolerate and escalation.** README View 1, G: a Tolerate class "records retry/escalation conditions but is **not claimed to be rooted out**. A later observation may trigger re-evaluation." This matches RESULT → KEEP. The README adds that re-evaluation is "not an automatic additional PR review round." So Case 3's KEEP outcome is an active class, not a resolved one. My "cannot be declared" entry for Case 3 is confirmed.

12. **WAIT (Diagram 3) is a stated output.** README View 3: "Output: the selected treatment direction (Converge / Avoid / owner-approved Tolerate) or unresolved decision." So the WAIT dead end is intended as the "unresolved" output. My point 13 (no outgoing edge, unlike PENDING going to End) is a drawing inconsistency, not a missing behaviour.

13. **Diagram 3's node ID `C` clash is confirmed.** README's Action table lists C = Identify and D = Decide. Diagram 3 draws "C · Converge" with ID `C`. The README does not address this. My point 3 stands.

14. **Owner gates match the README.** README View 1 and the Action table: Converge or Avoid can be accepted against defined conditions; owner approval is required for Tolerate (TOLAPP and Diagram 3 T) and for creating an unknown class (APPROVAL). This matches my inferred owner gates.

15. **nodes.yaml adds identifiers only.** It maps A–G to seven `ERR-20261112-<uuid>` identifiers with `status: proposed`. It has no flow, branch or actor data. It changes none of the case answers.

## Impact on the four cases

| Case | Changed by the second pass? |
|---|---|
| 1. Approved transient failure, 3 attempts | No. Retry is per operation (README), so the 3-attempt wording is confirmed; no loop is drawn. |
| 2. Real non-blocking defect | No. DEFER is confirmed; held and deferred re-entry is still undetermined. |
| 3. Known blocking error after successful treatment | Yes. Recognized recurrence re-enters at D (README), with a fixed budget and no recurrence counter. The G → INPUT label is inconsistent with the prose. |
| 4. Suspected new class, no owner approval | No. HOLD is confirmed ("creating an unknown class requires owner approval"). The NOW check is still skipped. |

## Still unclear after the second pass

- Who acts at each node (agent, reviewer, owner or tool).
- What "resume", "report" and "independent work" mean operationally.
- Whether BLOCK (after REAL) and NOW (after OCC/DEF) are both needed, and whether the retry lane checks blocking.
- How held (HOLD) and deferred (DEFER) items are re-triaged, and by what trigger.
- Whether "Not met / unverified" (OPEN) leads to a new retry, escalation or nothing.

## Confidence after the second pass

**3/5, unchanged.** The README resolves two of my cross-diagram conflicts (recurrence re-entry and the views). It also confirms the intended owner gates and the D budget. It does not state actors or resumption triggers, and it leaves the BLOCK and retry-lane questions open. Those gaps are what keep my confidence at 3.

STATUS: DONE
