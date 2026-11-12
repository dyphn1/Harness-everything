# Blind second pass — reviewer 4 (differences from first pass only)

Stimulus added: `second-pass-material/README.md` (parent README, discussion draft) and `second-pass-material/nodes.yaml`. Diagrams themselves are unchanged from the first pass; everything below is deltas, not a re-review.

## Confirmed / resolved by the parent README

1. **Retry cap scope (first-pass item 1, question a) — resolved as operation-local.** Reading note on B/Triage: "an already-approved tolerate class can have a bounded **per-operation** retry (up to three)"; the D note adds "there is **no global recurrence counter**". My global-budget counterexample is excluded by stated intent. Residual (unchanged): whether a *later recurrence* of the same operation gets a fresh count of three is still not stated anywhere.
2. **Safe outcome on retry failure (question b) — strengthened.** The note makes the safe outcome explicit: failure "leaves that step UNVERIFIED and **does not convert mandatory evidence into PASS**". This is the failure mode I worried a misreader could commit; the README names it as forbidden.
3. **"Cap and escalation" (first-pass item 7) — partially clarified.** "A Tolerate class records retry/escalation conditions" — so it is recorded *conditions*, not a numeric cap, and Tolerate "is **not claimed to be rooted out**". The concrete conditions are still undefined, but the claim is now explicitly modest, which removes the risk of a reader inferring eradication.
4. **Recurrence re-evaluation is conceptual, not automatic (first-pass item 4, partially).** "This is conceptual return flow, **not an automatic additional PR review round**." That bounds the dashed RETIRE→D edge, but does **not** resolve my two-path conflict (below).
5. **View roles (first-pass item 5, partially).** View 3 is declared "an Action-detail example, **not a replacement for View 1**". A reader warned of this is less likely to misapply it, but the missing blocking gate in View 3 is still drawn (see remaining findings).
6. **No machinery implied.** "No implementation, CLI, governance policy, hook, or ledger behavior is changed" — consistent with my decision not to assume any drawn box corresponds to working mechanisms. My "what I could not determine" items about mechanisms are now confirmed as genuinely unspecified (discussion draft, statuses all `proposed`, schema `concept-v0`), not hidden.
7. **Identity clarification (new, low impact).** nodes.yaml shows A–G are drawing-local aliases and the seven persistent identities are `ERR-YYYYMMDD-UUIDv4`. I had treated A–G as aliases already; no change to my reading, but it closes a possible reader error (treating `A`…`G` as stable cross-document IDs or as an ordering).

## Unchanged findings (diagrams still exhibit them)

- **Recurrence routing conflict (first-pass item 4).** Still ambiguous whether a recurrence of a tolerated class is triaged via B's T gate (→ retry → UNV) or re-enters directly at D per the dashed edge (→ re-evaluate disposition). The README's B note ("permitted tolerance" judged in Triage) *hints* at the T-gate path, but the dashed edge remains drawn from RETIRE/G to D with no precedence rule. Two defensible readings with different outcomes persist.
- **Converge vs Avoid not distinct at outcome level (first-pass item 3, question c).** README still lumps them: "Converge or Avoid can be accepted against defined conditions"; RESULT still merges "Converge / Avoid: met". What "met" means for an Avoided class remains undefined.
- **View 3 missing blocking gate (first-pass item 5, question d).** View 3 still feeds `IN` straight to MECH; the View-1 rule "non-blocking item is identified/recorded, then deferred; it does not open an immediate fix cycle" appears only in prose, not in View 3's drawing.
- **OWNER drawn as terminal (first-pass item 6).** View 1 still ends the Unclear branch at OWNER with no return edge; View 2's REVIEW -.→ B still contradicts the terminal reading.
- **"Not met / unverified" terminal (first-pass item 8).** No loop back to E/D drawn; README's G note ("observe recurrences") still doesn't say unmet acceptance re-enters treatment.
- **Retry path records no ledger occurrence (first-pass item 2).** README confirms "Recording an occurrence is not a new ledger" but says nothing about recording occurrences on the tolerate-retry path; the visibility gap for re-occurrence frequency remains.
- **HOLD / PENDING / DEFER / OPEN have no drawn re-entry (first-pass "could not determine").** README lists "whether decision branches/early exits are located correctly" as open for discussion — the dead-end states are acknowledged as unresolved design, not resolved.

## New observations from the second-pass material

- The budget question is now anchored: the "#437 budget suggestion is one correction plus one review". I had not flagged this as undetermined, but it resolves what "within budget" in the MECH node means.
- The README is explicit that dotted lines in View 2 are "explanatory associations, not new graph edge types" and decisions "are not additional persistent Actions" — this defuses a misreading I did not make but that the diagram invites (treating View 2's dotted edges as a second control flow parallel to View 1).
- All seven identities have status `proposed` with "without yet locking a lifecycle transition specification" — consistent with my finding that no outcome state (RETIRE/KEEP/OPEN/PENDING/HOLD) has a defined follow-up.

## Updated confidence

**4** (was 3).

- +: The operation-local retry cap, the forbidden UNVERIFIED→PASS conversion, the modest Tolerate claim, and the no-implementation scope are now stated in prose, removing the most consequential misreading risks from my first pass.
- −: The diagram-level defects remain because the diagrams were not changed: the recurrence two-path conflict, the merged Converge/Avoid outcome, View 3's missing blocking gate, and terminal-looking HOLD/PENDING/OWNER/OPEN states. A reader of the diagrams alone (the declared round-2 stimulus) can still reach the divergent paths I described; the prose mitigations live outside the drawings.

STATUS: DONE
