# Second pass — differences from the blind first pass

## Clarifications from the parent README

- The three diagrams are explicitly **View 1: overall UML Activity Diagram**, **View 2: system architecture/composition**, and **View 3: Action Flowchart / Timeline**. The “View 2 composition” labels inside Diagram 1 identify the corresponding groupings in View 2; they do not make Diagram 1 the composition view. Diagram 3 is the D Action’s detail view, not an independent workflow.
- I revise “A–G are stable, named action steps” to distinguish the concepts from the labels: the seven Actions are the proposed identities, but A–G are drawing-local aliases, not persistent IDs or ordered numbering. `nodes.yaml` assigns each a proposed identifier and a separate name; names may change independently. Decisions and ordinary arrows do not receive identities.
- Cross-view correlation is by shared action names/identifiers and repeated groupings within one action hierarchy. The visual cues do not define clickable links, custom graph edges, IDs, or dependencies. Diagram 2’s dotted associations are explanatory, not executable mechanisms.
- The recurrence intent is clarified: recurrence is conceptual, not an automatic PR review. An unrelated new problem enters at Capture; a recognized recurrence may resume review of its existing disposition. This makes Diagram 1’s RETIRE-to-D link and Diagram 2’s G-to-INPUT link compatible as a high-level depiction, though Diagram 2 does not draw the distinction or return point precisely.
- “Bounded review” has a proposed budget context of one correction plus one review, with no global recurrence counter or forced Zoom-out. This is discussion guidance, not implemented behavior. Treat (E) owns the intervention and predeclared acceptance conditions; Decide (D) selects the treatment direction.

## Confidence update

The added context raises confidence in the view mapping and identity interpretation to **5/5**. Recurrence’s intent is clearer, but the composition diagram leaves its exact return point visually underspecified.

STATUS: DONE
