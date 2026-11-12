# First pass — blind diagram review (maintainer role)

Source stimulus: `evaluation/diagram-only.md` only (diagrams frozen at `33e1ef7842d1fdaf4aad29d7e8b38eb53cb17d31`). I did not read the parent README, nodes.yaml, other reviews, or any history before writing this.

## My reading

The drawings describe an error-handling process as a composed activity with two blocks, ASSESS and RESPOND, each lettered as steps A–G:

- **ASSESS**: A · Capture → B · Triage → (a decision "Approved tolerate class?") and C · Identify (with its own decision chain).
- **RESPOND**: D · Decide disposition («expanded in View 3») → E · Treat → F · Deliver relevant context → G · Accept and retire.

What the drawings establish:

1. **Diagram 2 is the top-level (View 1) composition.** An input ("Agent failure / reviewer finding / later observation") enters ASSESS at A; the flow goes A → B → C inside ASSESS, then C → D crossing into RESPOND, then D → E → F → G. Two dashed (non-solid) inputs come from outside the activity: a "Reviewer / Owner" node sends "judgement / approval" to B and "approval" to D; an "Existing Error Ledger · #359" is touched by C ("find / record") and E ("mechanism / disposition"); an "Existing bounded context delivery · #394" is reused by F. G emits "newly observed recurrence" back to the INPUT node, i.e. the loop re-enters at A.
2. **Diagram 1 is an expanded composition (View 2) of the same two blocks.** It expands B's triage into branches: if the failure is an approved tolerate class, retry the operation (max 3); if recovered, resume interrupted work; if not recovered, mark the step UNVERIFIED, report, and continue independent work only. If not an approved tolerate class, a reviewer asks "Real problem?" — No → dismiss with reason; Unclear → request owner decision and hold the item; Yes → "Blocks current main path?" and then C · Identify. Inside C, ask "Existing class / signature?" — Yes → record an occurrence in an existing ledger; No → owner must approve a new class definition before it is defined in the existing ledger (pending → keep pending, no implicit new class). After recording/defining, ask "Blocking main path?" — No → record only and defer treatment; Yes → go to D.
3. **Diagram 3 is the detail view of D** (its label says "expanded from Views 1–2", and Diagram 1's D carries the marker «expanded in View 3»). D is a decision ladder: (a) is mechanical prevention feasible within budget? If yes, (b) does a bounded review still find new instances? If no → Converge; if yes → (c) can the action be dropped/restricted? If (a) is no, go straight to (c). If (c) yes → Avoid; if no → owner approves a tolerate class? Yes → Tolerate; no/pending → stay unresolved and do not silently waive checks. Converge / Avoid / Tolerate all flow to "E · Treat: define acceptance, then act".
4. **Diagram 1's RESPOND tail.** After E and F, G · Accept and retire leads to a "Review disposition outcome" decision: Converge/Avoid met → accept and retire the unneeded lesson; Tolerate with cap and escalation recorded → keep the tolerate class active; not met / unverified → keep open and report outstanding evidence. There is also a dashed feedback arrow: "Later recurrence of same class; re-evaluate" from the retire outcome back to D.

Two exit paths bypass RESPOND entirely (from within ASSESS): the recovered-retry path (RESUME) and the unverified path (UNV), plus early exits DISMISS, OWNER (hold), HOLD, DEFER. All of those go to an End node. So the process can end without ever reaching D.

**How I would find the detail view for the 'Decide disposition' Action (without editing anything):** the RESPOND node D in both Diagram 1 and Diagram 2 carries the annotation «expanded in View 3», and Diagram 3's subgraph is titled "D · Decide disposition (expanded from Views 1–2)". So the pointer is by the Action's name/letter: the box that says it is expanded elsewhere names the view, and the expanded view names the same step back ("D · Decide disposition"). Mechanically: find the D box, read its «expanded in …» marker, go to that view, and confirm the reverse reference ("expanded from Views 1–2"). If a step had no such marker, its detail view would be unknown from the drawings alone.

**What should remain stable if you rename an Action or move it to another region:** the drawings tie identity to a stable letter-plus-name pair (D · Decide disposition) and to the edges, not to layout. Renaming the label or moving D to another subgraph should not change: (a) its position in the flow — in ASSESS→RESPOND order, entered from C (or from ASSESS's "Blocking main path?" branch) and exiting to E; (b) its inputs and outputs — what feeds it (identified class/evidence, owner approval, recurrence re-evaluation) and what it feeds (E · Treat, plus the Converge/Avoid/Tolerate branches); (c) its internal decision ladder in the detail view (Diagram 3's Q/R/A/T ladder and its outcomes), which is what «expanded in View 3» points to; (d) the dashed external interactions (owner "approval" into D, recurrence feedback into D). A rename should only relabel the name part; the expansion marker and the step's connections must survive. Layout (TD vs LR direction, node coordinates) is clearly not stable — Diagram 1 and Diagram 2 draw the same blocks in different directions.

## Diagram-to-diagram mapping

- **Diagram 2 (View 1) ↔ Diagram 1 (View 2):** both contain subgraphs labelled `ASSESS` and `RESPOND` with the same step letters A–G and the same D annotation «expanded in View 3». Diagram 1 expands the decision points that Diagram 2 leaves collapsed inside B and C (Diagram 2 shows only the linear A→B→C), and adds the full ASSESS exit paths (retry/resume, unverified, dismiss, owner hold, defer) that View 1 does not show at all.
- **Discrepancy to flag:** in Diagram 2 (View 1), C → D is drawn as a direct edge with no intermediate decision; in Diagram 1 (View 2), the path from the C region to D passes through a "Blocking main path?" decision, with a "record only; defer treatment" exit. These are compatible if View 1 simply elides the gate, but the drawings themselves do not say which is authoritative.
- **Diagram 3 (View 3) ↔ Diagram 1's RESPOND head:** the decision ladder is the same structure and same branch order — mechanical-prevention-first (Q), bounded-review check (R in D3 = RECHECK in D1), drop/restrict (A in D3 = DROP in D1), owner-approved tolerate (T in D3 = TOLAPP in D1), with Tolerate/Avoid/Converge all exiting to E. Node letters inside Diagram 3 (Q, R, A, C, V, T, TOL) are *local* and collide with the global step letters: Diagram 3's "C" node is "Converge", unrelated to the step "C · Identify" in ASSESS. That is a naming hazard the drawings create but do not resolve.
- **Diagram 3 omits** things Diagram 1's RESPOND shows after E: F, G, the "Review disposition outcome" node and its three outcomes, and the dashed recurrence feedback. That is consistent with View 3 being scoped to D only, but it means View 3 alone does not tell you what happens after D's disposition is chosen beyond "go to E".
- **External nodes appear only in Diagram 2:** Reviewer/Owner, Existing Error Ledger · #359, Existing bounded context delivery · #394. Diagram 1 mentions owners and "existing ledger" in labels but never draws the ledger or the context-delivery mechanism as nodes; the `#359` / `#394` identifiers exist only in View 1.
- **Diagram 1 is the only drawing of the ASSESS internals and the outcome/retirement logic; Diagram 3 is the only drawing of D's internals.** The three views are complementary, not redundant.

## Unclear or potentially misleading

1. **"View 2 composition" / "same block in View 1" labels are never grounded.** Diagram 1's subgraph titles say "View 2 composition" and Diagram 2's say "same block in View 1", but no drawing labelled "View 1" or "View 2" as a whole is given beyond these two — the reader must deduce that Diagram 2 *is* View 1 and Diagram 1 *is* View 2. It works, but only by convention.
2. **Letter collision inside Diagram 3** (noted above): local letters C, A, R, T reuse the global step letters (C · Identify, A · Capture, D-region decisions). A reader skimming could mistake Diagram 3's "C" (Converge) for step C.
3. **"Approved tolerate class?" (Diagram 1, B) vs "Owner approves Tolerate?" (D1 RESPOND) vs "Owner approves tolerate class?" (D3).** Three tolerate-related gates at different points. It is not clear from the drawings whether the B gate checks membership in an *already-approved* class while the D gates seek *new* approval, or whether they are the same check revisited. The wording difference suggests but does not establish the former.
4. **The dashed "Later recurrence … re-evaluate" arrow leaves from RETIRE** ("Accept; retire unneeded lesson") back to D. It is drawn from the retire outcome, but "later recurrence" logically originates from G's loop in Diagram 2 ("newly observed recurrence" → INPUT → A). Diagram 1's dashed arrow bypassing INPUT/A is a different-looking loop; whether re-evaluation re-enters at A (full re-triage) or directly at D (disposition only) is inconsistent between the two drawings as drawn.
5. **Edge styles carry meaning that is never defined.** Solid arrows are used for both the main flow and things like A→B; dashed arrows connect external actors and the recurrence loop. The drawings never state the convention (dashed = external/informational? non-blocking?), so a reader must infer it.
6. **"Retry this operation (max 3)"** — max 3 of what (attempts? occurrences?) and what happens after the third failure is not drawn; the retry branch only shows recovered/not-recovered, so presumably not-recovered is the third-failure outcome, but that is an inference.
7. **Diagram 1 shows BLOCK →|Yes| C and BLOCK →|No| C** — both branches go to C, so the "Blocks current main path?" decision appears to have no divergent consequence at that point (its effect resurfaces later at NOW). As drawn, the question is redundant at that position, which may mislead a reader into looking for a difference between the two branches.

## What I could not determine

- **What any of this runs on.** Nothing in the drawings establishes whether there are working CLI commands, document-generation machinery, hooks, or live enforcement of any "required checks" (e.g. "do not bypass required checks", "do not silently waive checks"). These are drawn as prose in boxes only. I do not infer tooling from box labels: **unknown**.
- **What the Error Ledger (#359) and bounded context delivery (#394) actually are**, beyond "existing" things C/E find-and-record into and F reuses. Their format, storage, ownership: **unknown**.
- **Who the "reviewer" is concretely** and how the "Reviewer / Owner" dashed approvals are obtained: **unknown**.
- **What E · Treat does beyond "define acceptance first"** — the act itself (a fix? a test? a doc change?) is never drawn: **unknown**.
- **Whether "status" concepts (UNVERIFIED, pending, unresolved, retired, keep open) map to any recorded state** anywhere outside the boxes: **unknown**.
- **Entry conditions:** whether every "Agent failure / reviewer finding / later observation" must start at A, or whether some classes skip triage (Diagram 1's T gate implies pre-existing approved classes exist before this run, but how they got approved initially is not drawn — presumably via D3's T gate, which is inference): **partially unknown**.
- **Whether the numbered "#437 / #359 / #394" refer to issues, ledger IDs, or something else:** the diagrams give no key. **Unknown.**

## Confidence 0–5 with reasons

- View structure (V1 = Diagram 2 composition, V2 = Diagram 1 composition, V3 = Diagram 3 = D detail): **4.5** — the labels say it explicitly; only the cross-view "Blocking main path?" elision keeps it from 5.
- ASSESS branch logic and exit paths: **4** — clearly drawn in Diagram 1; the redundant-looking BLOCK both-branches-to-C node lowers confidence slightly.
- D's decision ladder and its stability under rename/move: **4.5** — drawn twice (D1 RESPOND head, D3) in agreement; local letter collision noted.
- Post-G outcome logic (retire / keep tolerate / keep open): **4** — drawn once, in Diagram 1 only.
- External actors and reuse targets (#359, #394): **2.5** — present as nodes and labels, nature unknown.
- Existence of any runnable machinery (CLI, hooks, checks): **0.5** — nothing in the drawings supports it; near-unknown, kept above 0 only because some boxes name mechanisms that plausibly exist somewhere.
- Overall document (as a *drawing*, not as a system): **4** — internally mostly consistent, readable, but with the elision, letter-collision, and undefined edge-style conventions noted above.

STATUS: DONE
