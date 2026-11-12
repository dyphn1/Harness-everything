# Second pass — differences from first-pass.md

Read after `first-pass.md` was written: `README.md` and `nodes.yaml`. `first-pass.md` is not edited. Only the differences are listed here.

## 1. Correction: view-to-diagram mapping

My first-pass mapping table was wrong. The README defines the views, and the correct mapping is:

| Diagram | View (per README) |
|---|---|
| Diagram 1 (flowchart with ASSESS and RESPOND subgraphs) | **View 1** — Overall UML Activity Diagram |
| Diagram 2 (composed activity) | **View 2** — System architecture / composition |
| Diagram 3 (D expansion) | **View 3** — Action Flowchart / Timeline |

- The first pass labelled Diagram 1 "View 2" and Diagram 2 "View 1". That followed the in-diagram text, which says the ASSESS/RESPOND blocks "correspond to View 2" and that Diagram 2's block is "View 1". Those strings refer to the shared regions, not to the diagrams' own view numbers.
- Diagram 2 is "deliberately a structure/composition view, not a second executable flow specification". My first-pass claim that Diagram 2 is "a summary of Diagram 1's main path" is therefore the wrong frame. Its solid arrow C→D is a composition association, not a flow claim.

## 2. Items the README resolves

| First-pass item | Resolution from README |
|---|---|
| "View N" meaning unknown | View 1 = overall activity; View 2 = composition (owner/reviewer authority, reuse of ledger and delivery); View 3 = Action detail. |
| Diagram 3 is a sub-activity or a separate workflow (I5, I6) | **Sub-activity of D, confirmed.** "This Flowchart is an Action-detail example... refines the D Action." A Timeline may be used for other Actions. |
| Interpretation I2: ASSESS is a gate, RESPOND only for blocking items | **Supported.** README: "primary blocking path keeps exactly Capture → Triage → Identify → Decide → Treat → Deliver → Accept"; "a non-blocking item is identified/recorded, then deferred." |
| Tolerate reached by retry (I7) | **Partly intended.** README B: "an already-approved tolerate class can have a bounded per-operation retry (up to three)." So T Yes → Retry is the author's intent. It is not a mislabel. |
| "max 3" is only text (item 3) | **Confirmed by design.** README: "there is no global recurrence counter or forced Zoom-out." The bound is per-operation text. |
| Owner / Reviewer merged in View 2 (item 11) | **Resolved.** View 1 separates them: reviewer decides "real problem"; unclear items go to owner; owner approves a new class (APPROVAL) and tolerate (TOLAPP). View 2 merges them as "owner/reviewer authority" by design. |
| "Stable Actions" are the lettered nodes | **Corrected.** README and nodes.yaml: A–G are drawing-local aliases, "NOT identity or ordered numbering." The persistent identities are the seven `ERR-20261112-…` IDs in nodes.yaml, with status `proposed`. |
| Is the correlation textual, logical or executable? | **Textual / logical, not executable.** README: no "clickable links, custom graph edges, new IDs, or dependencies"; "no `viewRef` field"; correlation by "grouping and the Action's existing name/identifier". |
| Dotted edges may be control flow (item 10 / open) | **Confirmed not control flow.** README: "Dotted lines are explanatory associations, not new graph edge types." |
| Diagram 3 entered unconditionally from C | **Not a contradiction.** Diagram 3 shows the Action's internal flow. Its inputs are "an identified error class, evidence, current step, and budget." The gate that decides whether D runs lives in View 1 (NOW). |
| Whether the existing #359 / #394 mechanisms exist | **Asserted by README, not verifiable from the diagrams.** README calls them "established mechanisms". I still cannot verify that from the stimulus. |

## 3. New finding: recurrence re-entry point conflicts inside View 2

- View 2 draws `G -. "newly observed recurrence" .-> INPUT`, and INPUT feeds A (Capture). So a recurrence re-enters at Capture.
- View 2's text says: "An unrelated new problem re-enters at Capture, while a **recognized** recurrence may resume review of the existing disposition." A recognized recurrence therefore goes to D, not A.
- View 1 agrees with the text: `RETIRE -. "Later recurrence of same class; re-evaluate" .-> D`.

So "newly observed recurrence" in the View 2 diagram is ambiguous. It could mean a known class (text: D) or a new instance of a known class (diagram: A). This is a real inconsistency between the diagram and the text in View 2, and it affects the re-entry node.

## 4. New finding: "Tolerate" is used in two senses

- B (View 1): `Approved tolerate class → bounded retry (max 3)`, a per-operation tolerance for a step.
- D (View 1 and View 3): `Tolerate` is a disposition in which the class stays active, with cap and escalation recorded, and "is not claimed to be rooted out".

The same word covers a retry allowance and a treatment disposition. A new architect could easily conflate them. The label is therefore potentially misleading. It is not a flow error.

## 5. Updated interpretations

| # | Interpretation | First pass | Second pass |
|---|---|---|---|
| I1 | Every item runs A→G | Unsupported | **Unsupported** (unchanged) |
| I2 | ASSESS gates RESPOND | Ambiguous | **Supported** by View 1; View 2 is not a flow spec, so it does not contradict this |
| I3 | Recurrence re-enters at A | Ambiguous | **Partly supported.** Used for a new unrelated problem, per View 2 text. For a recognized recurrence the text and View 1 say D |
| I4 | Recurrence re-enters at D | Ambiguous | **Supported** for a recognized recurrence (View 2 text, View 1 RETIRE edge) |
| I5 | Diagram 3 is a separate workflow | Unsupported | **Unsupported** (unchanged) |
| I6 | Diagram 3 is a sub-activity of D | Supported | **Supported** (unchanged), now confirmed by README |
| I7 | Tolerate is reached by retry | Unsupported | **Unsupported as a reading of D's Tolerate.** The B-level retry allowance is intended. The two senses of "tolerate" must be kept apart |
| I8 | Correlation is executable | Unsupported | **Unsupported** (unchanged) |
| I9 | Correlation is textual or logical | Supported | **Supported** (unchanged) |
| I10 | "max 3" is enforced by the flow | Unsupported | **Unsupported** (unchanged). README confirms the bound is per-operation text |

## 6. Remaining open points (README says the author leaves these open)

- "whether decision branches/early exits are located correctly" — the author flags this for discussion, so exit placement is not settled.
- Final UML notation and whether the two groupings are useful.
- The README does not say where work goes after an UNVERIFIED step ("continue independent work only"). The drawing still ends at Z.
- The README does not define BLOCK separately. Its effect is only that non-blocking items are recorded and deferred at NOW. The BLOCK decision in the drawing has no separate effect on the flow.

## Revised confidence

**4** (first pass: 3). The README resolves the view definitions and the sub-activity relation, and confirms the logic of the main path. The remaining reasons for not going higher are the View 2 recurrence conflict (section 3), the overloaded word "tolerate" (section 4) and the open exit placement the author has flagged.

STATUS: DONE
