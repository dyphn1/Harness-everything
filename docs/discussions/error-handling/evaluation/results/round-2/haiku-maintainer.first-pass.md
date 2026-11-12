# First pass — blind reading (maintainer)

Stimulus read: `evaluation/diagram-only.md` (diagrams 1–3, source commit 8e76b8d2) and `evaluation/maintainer.md` (instructions only). Nothing else was opened.

## My reading

**(1) What the drawings themselves establish**

- Three diagrams. View 1 is the full decision graph with two subgraphs, ASSESS and RESPOND. View 2 is a summary of the same activity as a chain (A → B → C in ASSESS, D → E → F → G in RESPOND), with external actors and links. View 3 expands only node D.
- Entry is `Start → A · Capture → B · Triage`. The first decision is `Already-approved tolerate class?`.
  - Yes → `Retry this operation (max 3)` → `Recovered?` → Yes: `Resume interrupted work`; No: `Mark step UNVERIFIED; report; continue independent work only`. Both end the diagram.
  - No → `Real problem? (reviewer)`:
    - No → `Dismiss with reason` (ends)
    - Unclear → `Request owner decision; hold item` (ends)
    - Yes → `C · Identify`
- `C · Identify` → `Existing class / signature?`:
  - Yes → `Record occurrence in existing ledger`
  - No → `Owner approves definition?` → No/pending: `Keep pending; no implicit new class` (ends); Yes: `Define class / signature in existing ledger`
- Both C paths reach `Blocking main path?`. No → `Record only; defer treatment` (ends). Yes → `D · Decide disposition`.
- `D` (View 1 and View 3, same logic):
  - `Mechanical prevention feasible within budget?` Yes → `bounded review still finds new instances?` No → **Converge**.
  - Yes (still new instances), or No from the mechanical question → `Can action be dropped / restricted?` Yes → **Avoid**.
  - No → `Owner approves tolerate class?` Yes → **Tolerate**; No/pending → **Unresolved / pending** (ends, no path to E).
- Converge, Avoid and Tolerate all go to `E · Treat`, then `F · Deliver relevant context`, then `G · Accept and retire`.
- `G` result:
  - Converge/Avoid met → Accept; retire unneeded lesson
  - Tolerate → cap and escalation recorded → keep tolerate class active
  - Not met / unverified → keep open; report outstanding evidence
- Dotted back-edges: retired class recurring → re-evaluate at `D`. Unrelated new problem (View 2 only) → re-enter at `INPUT` (Capture).
- View 2 external links (dotted, no arrow semantics given): Reviewer/Owner → B (judgement) and D (approval); `Existing Error Ledger · #359` → C (find/record) and E (mechanism/disposition); `Existing bounded context delivery · #394` → F (reuse).

**(2) What I infer (not drawn as fact)**

- A–G are the same seven steps in all views. Each view is a different zoom level of one process, not three processes.
- "Retry (max 3)" is a bounded loop for transient operations; the approved tolerate class is a pre-decided exemption that skips the full disposition.
- "Ledger" is a shared store for classes, signatures and occurrences; #359 is its issue or artifact.
- Converge and Avoid remove the need for further treatment; Tolerate keeps the class alive under a cap.

**(3) What is unclear**

- Whether "Existing Error Ledger" is a file, a service or a convention. The box name alone does not say.
- What the reviewer and owner nodes are physically (person, bot, tool).
- What `#359` and `#394` are. They appear only as labels.

## Diagram-to-diagram mapping

| Element | View 1 (full graph) | View 2 (chain summary) | View 3 (D detail) |
|---|---|---|---|
| A Capture, B Triage | ASSESS subgraph | ASSESS chain | not shown |
| C Identify | ASSESS; "Existing class?" branch | ASSESS chain | input node `IN` ("class + evidence") |
| D Decide disposition | RESPOND; marked «expanded in View 3» | RESPOND; same marker | subgraph `D_DETAIL`, the only expansion |
| E Treat | RESPOND | chain | `OUT` ("define acceptance, then act") |
| F Deliver context | RESPOND | chain; #394 link | not shown |
| G Accept and retire | RESPOND; three result branches | chain; re-entry dotted links | not shown |
| Early exits (dismiss, defer, hold, pending, unverified) | yes | "omitted; see View 1" | partly (PENDING only) |

Wording differences across views (same meaning): View 1 "Same class still yields new instances in bounded review?" vs View 3 "Bounded review still finds new instances?"; View 1 "Keep unresolved; do not bypass required checks" vs View 3 "Unresolved; do not silently waive checks".

## Unclear or potentially misleading

- **Retry scope.** `Retry this operation (max 3)` does not say which operation or whether the count is per class, per step or per run.
- **Tolerate in two places.** Triage checks `Already-approved tolerate class?` before the full process, and D offers `Tolerate` after review. The diagrams do not show how an approved class is recorded, so the two paths are not obviously linked.
- **Tolerate cap.** `cap and escalation recorded` appears in G, but no cap value or store is drawn.
- **"Resume interrupted work" ends at Z.** No edge says what resume means or what happens after it.
- **"Continue independent work only" ends at Z.** The diagram shows this as a terminal state, although the label says work continues.
- **Ledger writes are not shown in RESPOND.** Only the ASSESS side records to the ledger, and View 2 adds a dotted `mechanism / disposition` link from the ledger to E. This is visual only; nothing shows E writing to the ledger.
- **Deferred items.** `Record only; defer treatment` goes to End with no revisit path, so the deferral is not visibly tracked.
- **Reviewer judgement path.** The `Real problem? (reviewer)` decision is in View 1 only. View 2 shows the reviewer attached to B, which may suggest triage is the judgement point, not this branch.
- **Ambiguous dotted lines.** The dotted edges in View 2 (for example `G → INPUT`) carry labels but no solid arrows, so it is unclear whether they are control flow or information flow.
- **Two "Converge" gates.** Converge needs both `Mechanical` and `RECHECK = No`, but a `Mechanical = No` path skips straight to `DROP`. The diagram gives no path to Converge without the mechanical prevention, which is consistent but easy to misread.

## What I could not determine

- How to find the detail view for D from the diagrams alone. My answer, from the drawings: the marker «expanded in View 3» on node D in Views 1 and 2 points to View 3, whose subgraph title is "D · Decide disposition (expanded from Views 1–2)". The view is found by text match, not by an identifier.
- Which details should stay stable if D is renamed or moved to another region. The drawings suggest: (a) the letter D (drawing-local alias, not persistent, so a rename does not break ids); (b) the marker text «expanded in View 3» and the subgraph title, which must be changed together with the name; (c) the outcome names Converge, Avoid, Tolerate and Pending, which E and G reference; (d) the entry from C and the exit to E. Moving D to another region changes only the subgraph it sits in; its outgoing edges to E and incoming edge from C are what the reader depends on. Stated as inference, not as drawn fact.
- Whether each Action has a file or artifact that already exists. The diagrams show no artifacts, paths or file names, so this is **unknown**.
- Whether #359 (ledger) and #394 (context delivery) exist as implemented things.
- What a "step" is in `Mark step UNVERIFIED`.
- Who the Owner is when more than one could approve.

## Confidence 0–5 with reasons

**3 / 5.** The graph is internally consistent. D has a clear detail view, and the terminal outcomes are all drawn. But many nodes depend on undefined artifacts (#359, #394, "ledger", "step"), the retry scope and tolerate cap are missing, and several terminal states contradict their own labels ("continue independent work" ends the diagram). I can answer structure questions from the drawings, but not questions about what is implemented or where data is stored.

STATUS: DONE
