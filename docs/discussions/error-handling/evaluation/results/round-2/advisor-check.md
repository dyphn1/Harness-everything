# Advisor answer 1 — #437 readability

- **Evidence:** source-traced; reviewed `8e76b8d2^ → 8e76b8d2` and clean worktree HEAD `20066a84fc9925b2786201570185ae3a31357b42`. README line references below are at that HEAD.
- **Scope / workflow:** six-question review → answer → file verification; required bindings: question packet and its named sources, then answer-format checks. Code Review skill used; workflow recorded inline because the packet permits no other file writes. No readiness decision or new design requirement.
- **Ledger:** read README and all E-0001–E-0016; applied E-0001/E-0007 (classify against the scope anchor, avoid instance-by-instance expansion), E-0002 (terminal STATUS), E-0014 (inspect what removal loses), E-0016 (cover every requested question). No repeat of those errors identified.

## 1. Changes 1–5

**in-scope — source-traced.** Titles, prior-approval wording, the blocking-only annotation/omitted-exits note, local node renames and alias note clarify existing meaning. Controls: the seven Actions, decision destinations, approval requirement and non-blocking deferral remain unchanged; `nodes.yaml` already calls A–G drawing-local aliases.

## 2. Change 6: recurrence associations

**in-scope — source-traced.** The new dotted association makes the pre-existing README prose (now line 126) visible; View 1 already returned a known-class recurrence to D. Control: unrelated problems still enter at Capture; line 98 defines dotted lines as explanatory associations, so this does not introduce a new executable route or design obligation.

## 3. Change 7: removal of BLOCK

**CHANGES — source-traced; violates: “把文字釐清” / the accepted text-only, no-restructure boundary.** Witness: before the edit, either BLOCK answer reached C; expected scope preserves the decision structure while clarifying text, but the edit deletes the pre-Identify judgment. Control: NOW still preserves blocking/non-blocking treatment outcomes and A–G order; that equivalence does not make node deletion text-only. Acceptance of this structural cleanup belongs to the owner.

## 4. Remaining prose/diagram mismatch

**CHANGES — source-traced; same scope clause as Q3.** README **line 168** still assigns “whether main path is blocked” to **B Triage**, but after removing BLOCK the only explicit blocking judgment is NOW **after C/occurrence recording** (lines 35–43). Expected: preserve the stated Triage responsibility; actual: its drawn judgment disappears. Control: line 90's identify/record-then-defer behavior still matches NOW; this is the consequence of Q3, not an additional design request.

## 5. Unchanged activity.puml

**out-of-scope — known limit, source-traced.** Record its pre-Identify blocking decision and broader repeat loop; round 1 explicitly excluded this file, so unchanged PlantUML does not invalidate a round-1/round-2 Mermaid readability comparison. README line 17's “corresponding” source must not be taken as proof of structural parity; no synchronization requirement follows from the owner anchor.

## 6. Round 1 grouping

**CHANGES — source-traced, limited to qualifying the summary's claim.** The five label-induced readings belong in readability; recurrence routing ambiguity there is distinct from proposing occurrence writes or hold re-entry, which remain design questions. However, “a Tolerate cap has nothing to count” is **unresolved**, not an established defect: the operation-local retry bound does not require a ledger counter (README line 91; rubric item 5; Haiku reviewer first-pass items 5–6 distinguish observation from inference). Control: missing ledger writes are observable; the need for a cross-operation cap has no matching owner clause. Do not turn that inference into another fix requirement.

Verification limits: source review only; no rendering, new blind runs, rescoring or CI gates executed. Only this answer file is written; repository verification remains with the coordinator. Owner retains readiness and further-round decisions.

STATUS: DONE
