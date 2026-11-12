# First pass — blind reading of diagram-only.md (Error Handling, frozen at 33e1ef78)

Stimulus: `evaluation/diagram-only.md` only. The parent README, `nodes.yaml`, issue text and other reviewer notes were not consulted.

## My reading

Labels: **(D)** = established by the drawings themselves, **(I)** = my inference, **(U)** = unclear.

- **(D)** Three Mermaid diagrams. Diagram 1 is titled "View 2 composition" and has two subgraphs, ASSESS and RESPOND. Diagram 2 is titled "View 1" and shows the same letters A–G as blocks. Diagram 3 is titled "expanded from Views 1–2" and details only Action D.
- **(D)** Triage gate (Diagram 1, node `T`): if the item belongs to an *approved tolerate class*, the flow goes to "Retry this operation (max 3)". If the retry does not recover, the step is marked UNVERIFIED and only independent work continues. This branch goes straight to End and never reaches Identify.
- **(D)** Otherwise the reviewer decides "Real problem?". No leads to Dismiss; Unclear leads to an owner decision with the item held; Yes leads to "Blocks current main path?". Both branches of that question lead to C · Identify.
- **(D)** C · Identify asks whether the class/signature exists. Yes records an occurrence in the existing ledger. No asks for owner approval of the definition; pending leads to "Keep pending; no implicit new class", and approval leads to "Define class / signature in existing ledger".
- **(D)** After Identify, "Blocking main path?" No gives "Record only; defer treatment" (End). Yes goes to D · Decide disposition.
- **(D)** D is decided by a chain of gates. Mechanical prevention feasible? Yes asks whether the same class still yields new instances in bounded review; No gives Converge. Otherwise: can the action be dropped or restricted? Yes gives Avoid. Otherwise: owner approves Tolerate? No/pending gives "Keep unresolved; do not bypass required checks"; Yes gives Tolerate.
- **(D)** Converge, Avoid and Tolerate all feed E · Treat (define acceptance first), then F · Deliver relevant context, then G · Accept and retire. G has three outcomes: Converge/Avoid met gives "Accept; retire unneeded lesson"; Tolerate gives "Keep tolerate class active" with cap and escalation recorded; not met or unverified gives "Keep open; report outstanding evidence".
- **(D)** A dotted edge runs from "retire unneeded lesson" back to D, labelled "Later recurrence of same class; re-evaluate".
- **(D)** Diagram 2 has external dependencies as labelled boxes: "Existing Error Ledger · #359" (dotted to C for find/record and to E for mechanism/disposition), "Existing bounded context delivery · #394" (dotted to F for reuse), and "Reviewer / Owner" (dotted to B and D for judgement/approval). G has a dotted "newly observed recurrence" edge back to the INPUT node.
- **(I)** The flow is a triage-and-disposition funnel. Most branches end in End. Only Converge, Avoid and Tolerate proceed to treatment.
- **(U)** Whether the drawings imply an implementation exists is unclear. Nothing in them says a file, command or check already exists. The labels "Existing Error Ledger" and "Existing bounded context delivery" say "existing", but I cannot check that from the drawings.

### How I would find the detail view for "Decide disposition" (no editing)

- **(D)** In Diagrams 1 and 2 the node is written `D · Decide disposition` with the marker «expanded in View 3». The marker is the link. Diagram 3 has the subgraph `D_DETAIL` titled "D · Decide disposition (expanded from Views 1–2)".
- **(I)** So I would search for the string "Decide disposition" or the marker "expanded in View 3" to find the detail. The subgraph title is the detail view's anchor.
- **(I)** Details that should stay stable on a rename or a move:
  - The letter `D` and the sequence A–G. The letters are the only identifiers in the drawings.
  - The marker «expanded in View 3» and the subgraph title. These must change together, or the link breaks.
  - The entry edges, C → D (Diagram 2) and NOW → D (Diagram 1, "Blocking main path? Yes"), and the exit edges to E. A move from RESPOND to another region changes these edges.
  - The node IDs are local to each Mermaid diagram. The letter `D` is only a label, not a stable key. (I could not confirm this is intended.)

## Diagram-to-diagram mapping

| Concept | Diagram 1 (View 2) | Diagram 2 (View 1) | Diagram 3 (D detail) |
|---|---|---|---|
| Capture / Triage | A, B | A, B (ASSESS block) | not shown |
| Identify | C | C | IN node "C · Identify" (input only) |
| Decide disposition | D (gates: MECH, RECHECK, DROP, TOLAPP, RESULT) | D | D_DETAIL: Q, R, A, T |
| Converge / Avoid / Tolerate | CONV / AVOID / TOL | not shown | C, V, TOL |
| Treat / Deliver / Accept | E → F → G | E → F → G | OUT: "E · Treat" |
| Unresolved | PENDING; OPEN; HOLD | not shown | WAIT |
| External deps | none | Ledger #359; #394; Reviewer/Owner | none |

- **(D)** Diagram 2 is the only one that shows the ledger and #394 dependencies.
- **(D)** Diagram 3 is the only one that shows the detail of D.
- **(D)** Diagram 2 has C → D with no gates in between. Diagram 1 has the gates "Blocking main path?" and NOW between C and D.

## Unclear or potentially misleading

1. **Cross-diagram ID collisions.** In Diagram 3, `C` is the Converge node, `A` is the "can be dropped" gate, and `T` is the owner-tolerate gate. In Diagram 1, `C` is Identify, `A` is Capture and `T` is "Approved tolerate class?". Anyone matching by ID will get the wrong node.
2. **Redundant branch.** In Diagram 1, "Blocks current main path?" sends both branches to C. The decision has no effect on the flow.
3. **Dead end in Diagram 3.** `WAIT` ("Unresolved; do not silently waive checks") has no outgoing edge and is not wired to End. Diagram 1 wires the equivalent PENDING node to End. Diagram 3 never shows what happens to an unresolved item.
4. **Gap between Diagram 2 and Diagram 1.** Diagram 2 has C → D as a plain edge. Diagram 1 has three gates between them (Real problem, Blocks main path, Existing class). The drawings disagree about whether those gates sit inside ASSESS or are skipped.
5. **Tolerate handling is split.** Triage (Diagram 1, `T`) retries "Approved tolerate class" items, while RESPOND (Diagram 1, `TOLAPP`) and Diagram 3 (`T`) decide tolerate from owner approval. The drawings do not say whether a tolerate class is approved before or after it reaches triage.
6. **"Retry (max 3)" bound.** The limit is written only on the edge label. The drawings do not say where the retry count is kept.
7. **Dotted "re-evaluate" loop.** The loop from RETIRE back to D has no condition on which D gate it re-enters. A recurrence could repeat the whole gate chain.
8. **Diagram 2 has no End node** and shows only the INPUT → A entry and the G → INPUT recurrence, so the drawing never shows an exit to End. Diagram 1 does.
9. **Labels such as "#359" and "#394"** point to outside work I cannot resolve from the drawings.

## What I could not determine

- What "tolerate class", "class / signature", "ledger", "budget" and "bounded review" mean in practice. The drawings name them but do not define them.
- What View 1, 2 and 3 are as documents. I inferred the mapping only from the titles inside the diagrams.
- Whether any of the referenced artifacts (ledger, #394 hook, owner approval record) exist as files.
- Who the Reviewer and Owner roles are beyond their edges.
- Whether the drawings are complete. Only three diagrams were given, and the text of the other views is not available.
- What the stable identifier is for each Action. The drawings use only letters, and the letters are local to each diagram.

## Confidence 0–5 with reasons

**Confidence: 3 / 5.**

- **+** Each diagram is internally clear, and the flow is traceable node by node.
- **+** Diagram 3 cleanly isolates the D detail.
- **−** Node IDs repeat across diagrams with different meanings (see item 1), so mapping by ID is error-prone.
- **−** Several definitions are missing (tolerate class, ledger signature, budget), so the decisions cannot be judged.
- **−** Diagram 2 and Diagram 1 disagree about what sits between C and D.
- **−** Three of the labels point to outside work I could not check.

STATUS: DONE
