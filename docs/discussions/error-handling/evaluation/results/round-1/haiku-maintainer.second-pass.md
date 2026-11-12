# Second pass — differences from first-pass.md, checked against README.md and nodes.yaml

`first-pass.md` is unchanged. Labels: **executed** = I read it in the file; **source-traced** = I followed it through the drawings or text. No behaviour was run.

## Differences from first pass

1. **Persistent identity was wrong (correction).** The first pass said the letter `D` was the only identifier. `nodes.yaml` says `A`–`G` are "drawing-local aliases, NOT identity or ordered numbering", and the persistent identifiers are the `ERR-20261112-<uuid>` values. README: "Drawing-local `A`–`G` labels are not persistent identifiers." *(executed, nodes.yaml lines 2 and 8–32; README line 158)*

2. **View numbers are swapped between the diagram titles and the README (new finding).** Diagram 1's subgraph says "View 2 composition", and Diagram 2's subgraph says "composed activity (View 1)". The README's table says View 1 is the Overall UML Activity Diagram and View 2 is the system composition. So Diagram 1 is View 1 and Diagram 2 is View 2, and the titles inside the drawings are the wrong way round. My first pass mapped the titles without flagging the swap. *(executed, README lines 7–10 and 17–19, 96–100; diagram-only lines 11 and 40)*

3. **Diagram 2 has no decision gates. README says that is intended.** I called the plain edge C → D a gap and said the drawings disagree. The README says View 2 "is deliberately a structure/composition view, not a second executable flow specification." So this is an abstraction, not a contradiction. The gates still exist in View 1, which is the reader's risk. *(source-traced, README line 98)*

4. **The approval split for Tolerate is answered.** The first pass asked whether approval comes before or after triage. README line 91: triage applies to an "**already-approved** tolerate class" with bounded retry (up to three). Owner approval for a new tolerate class is decided at D. *(executed, README line 91)*

5. **The re-evaluation loop has a stated budget.** The first pass said nothing bounded the RETIRE → D loop. README line 93: the budget is "one correction plus one review", and "there is no global recurrence counter or forced Zoom-out." The question of how a re-entry is counted is still open, because the README gives no counter. *(executed, README lines 93–94)*

6. **The redundant BLOCK branch is confirmed.** README line 90: "A non-blocking item is identified/recorded, then deferred." Both branches of `Blocks current main path?` lead to C, so the decision does not change control flow. I stand by the first pass on this. *(executed, README line 90; diagram-only line 24–25)*

7. **Ledger and #394 are named as existing mechanisms, but the drawings do not show them as files.** The first pass marked "existing" as unverifiable. README line 123 names them as "the established mechanisms; no new implementations are implied", and links #359 and #394 to GitHub issues. Whether the mechanisms exist as code is still unchecked here. *(source-traced, README lines 117, 123)*

8. **The "no End node" note in Diagram 2 is by design.** The first pass said Diagram 2 never shows an exit. README line 123 says an unrelated problem re-enters at Capture, and a recognised recurrence resumes review, which is the G → INPUT edge. *(source-traced)*

9. **The dead end at WAIT is not addressed.** README does not mention Diagram 3's `WAIT` node. Diagram 1 wires the equivalent PENDING node to End; Diagram 3 does not. The first-pass point stands. *(executed by absence; README lines 149–170)*

10. **Cross-diagram ID collisions stand.** The README does not address the reuse of `A`, `C` and `T` in Diagram 3. *(executed, diagram-only lines 103–142)*

## Second-pass checks (from maintainer.md)

**`identifier`, `name`, `status` responsibilities** *(executed, nodes.yaml; README lines 155–157)*
- `identifier`: the persistent key, format `ERR-YYYYMMDD-UUIDv4`. The README says "Immutable once accepted". The date part is descriptive, not a uniqueness guarantee. All seven are `proposed` and created 2026-11-12. The drawings do not show identifiers.
- `name`: human- or agent-readable. The drawings show names, not UUIDs. `nodes.yaml` says "Names can change independently."
- `status`: metadata only. All seven are `proposed`. The README says it does not "yet lock a lifecycle transition specification."

**Stable details if an Action is renamed or moved** *(source-traced)*
- Renaming changes only `name`, and the drawing label. The `identifier` stays, so correlation holds.
- Moving an Action changes the edges and the grouping, not the identifier. The drawing letter is not stable across moves, because it is a local alias.
- The «expanded in View 3» marker and the `D_DETAIL` subgraph title must be changed together if D is renamed.

**Do the diagrams imply files exist for each Action?** *(source-traced)*
- No. None of the drawings says a file exists for A–G.
- The README's only file references are: [activity.puml](./activity.puml), which is the PlantUML source, and `nodes.yaml`. **`activity.puml` is not in this directory.** The directory listing shows only `README.md`, `nodes.yaml`, `packet.md`, `run.log` and `evaluation/`. I could not check it, and the packet keeps me inside this directory. This is a missing-link finding.
- The README claims `#359` and `#394` are "established mechanisms". That is a claim, not a file I could check here.

**Visual links versus physical links** *(source-traced, README lines 13, 98, 123)*
- Visual only:
  - the «expanded in View 3» marker, and the ASSESS / RESPOND blocks. The README says these are "decomposition cues, not clickable links, custom graph edges, new IDs, or dependencies."
  - all dotted edges in Diagram 2. The README calls them "explanatory associations, not new graph edge types."
  - the RETIRE → D dotted loop. The README calls this a "conceptual return flow, not an automatic additional PR review round."
  - the drawing letters `A`–`G`.
- Physical:
  - the seven `identifier` values in `nodes.yaml`, the only proposed persistent identities.
  - the relative link to `activity.puml`, which is missing here.
  - the GitHub links to #359 and #394. These are real links in the README, but the drawings show them only as labels.

## Confidence on this pass

- Executed: nodes.yaml contents, README contents, the file listing.
- Source-traced: the mapping of drawings to README views, and the visual / physical split.
- Inconclusive: whether #359 and #394 exist as working code, and the contents of `activity.puml`. Neither could be checked from this directory.

STATUS: DONE
