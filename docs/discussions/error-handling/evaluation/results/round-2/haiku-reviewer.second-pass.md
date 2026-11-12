# Second pass — differences from first pass only

Stimulus added: `second-pass-material/README.md` (parent README) and `second-pass-material/nodes.yaml`. `first-pass.md` is unchanged. Items below are listed against the first pass's numbering or sections.

## Resolved or narrowed by the parent README (text, not drawing)

1. **Retry cap scope (first pass, unclear item 1).** README says retry is "a bounded per-operation retry (up to three)" and that there is "no global recurrence counter". My "unknown" is now answered by the README. The diagram itself still shows only the label `max 3`, so a reader of the diagram alone still cannot tell. Residual risk: the answer lives outside the diagram.
2. **Budget (first pass, unclear item 3 / "What I could not determine").** README says the budget suggestion is "one correction plus one review". This narrows "budget" but does not define what happens on budget exhaustion. My MECH No → DROP → Avoid counterexample (item 5) still applies: README does not say whether over-budget is a reason to drop a check.
3. **Non-blocking path (first pass, mapping table and item 10).** README states that a non-blocking item "is identified/recorded, then deferred" and that View 2 omits early exits on purpose. I had called View 2 "implies every input reaches D" a misleading reading. With the README it is a stated simplification. Downgrade item 10 from "misleading" to "documented, but only in the README; the View 2 diagram alone still drops the non-blocking exit."
4. **Retry and UNVERIFIED (first pass, items 3 and 4).** README says a failed retry "leaves that step UNVERIFIED and does not convert mandatory evidence into PASS". This answers the retry branch only. The README does not extend the UNVERIFIED rule to HOLD, PENDING, DEFER, DISMISS, OWNER or OPEN, so item 4 (asymmetric end markers) stands.
5. **Recurrence target (first pass, item 7).** README: "a recognized recurrence may resume review of the existing disposition." This confirms the recurrence edge goes to D. It does not say who recognizes a recurrence, so the "SAME class" criterion is still undefined and the Identify step is still skipped. Item 7 stands.
6. **Define acceptance (first pass, item 9).** README: "`Treat` owns the actual intervention and predeclared acceptance conditions." This confirms the precondition is part of Treat's contract. View 2's E label still omits it, so the diagram-level mismatch stands and is stronger.

## New or confirmed by the parent README (conflicts or gaps between views)

7. **README's own View 1 spec omits a return path (confirms first-pass conflict on "new unrelated problem").** The README's responsibilities table says View 1 "must show … recurrence and return paths". View 2 draws `G → INPUT` ("unrelated NEW problem: re-enter at Capture") and View 1 does not. So the gap is not just my reading: it breaks the README's own View 1 requirement.
8. **README confirms definition approval is a rule (confirms first-pass conflict on owner approval).** README: "Creating an unknown class requires owner approval." View 1 draws this (`APPROVAL`). Views 2 and 3 do not draw it, and View 2 only shows owner approval at D. So the drawings do not reflect the README's own rule. Mapping-table row "Owner approves a new class definition" stands as an actual conflict.
9. **README's D output lists Avoid without owner approval (confirms first-pass item 5).** View 3 text: "the selected treatment direction (Converge / Avoid / owner-approved Tolerate)". Only Tolerate is marked owner-approved, so the README intends Avoid to be selectable without approval. My counterexample (over-budget required check dropped, lesson retired with no owner decision) is therefore an intended path, not a drawing error. The residual question is whether a required check may be dropped at all. The README does not address that, so the counterexample now reads as a policy gap, not a readability error.
10. **Reviewer identity (first pass, item 12).** README: "A reviewer decides whether a different finding is real." It still does not say the reviewer is independent of the agent whose failure is being judged. The "failing agent dismisses its own failure" counterexample stands.
11. **Blocking main path (first pass, item 4 detail).** README: "The primary blocking path keeps exactly Capture → Triage → Identify → Decide → Treat → Deliver → Accept." HOLD (new class, approval pending, blocking) ends at `Z` without reaching D. The README does not say what the main path does when it is blocked by a pending approval. The concrete risk stands: a blocking item can end at HOLD with no UNVERIFIED mark.
12. **nodes.yaml (no reading change).** The seven names match the seven diagram Actions (Capture, Triage, Identify, Decide disposition, Treat, Deliver relevant context, Accept and retire). The identifiers are of the form `ERR-YYYYMMDD-<uuid>`, matching the README's format. No conflict and nothing new for diagram readability; A–G are still drawing-local, as both files say.

## Net effect on my reading

- Items answered by the README (cap scope, budget size, non-blocking exit, retry UNVERIFIED, recurrence target) are now "answered in prose, not in the drawing". A reader of the diagram alone still hits them.
- Items confirmed as conflicts between views: owner approval of a new class (View 2/3 omit it); new-problem return (View 1 omits it, despite the README requiring return paths in View 1); define-acceptance precondition (View 2 omits it).
- Items unchanged: Avoid retiring a lesson without approval (now a policy question, not a misreading); HOLD and PENDING with no verification marker; recurrence skipping Identify; "Recovered" not meaning verified; reviewer identity; Tolerate with no recorded cap has no drawn exit.

## Confidence

**Confidence 3 / 5 (second pass; first pass was 2 / 5).** The README resolves the two terms that most affected my first-pass confidence (per-operation cap, budget as "one correction plus one review"). The remaining issues are structural in the drawings: three view-to-view conflicts, two End states without a verification mark, and one return path missing from View 1. These are concrete and reproducible from the diagrams and the README.

STATUS: DONE
