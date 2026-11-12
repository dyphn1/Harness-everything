# Second pass — differences from the blind reading

## What the parent files clarify

- **View 2 route:** My first pass treated View 2’s `C → D` as a possible control-flow conflict with View 1’s nonblocking `DEFER` path. The README says View 2 is a structure/composition view, not a second executable flow specification. So this is not an intended route conflict: the composition arrow shows grouping, while View 1 owns the guards. The diagrams alone still leave room for the literal reading I described.
- **G and recurrence:** My first pass considered View 2’s `G → INPUT` recurrence loop unclear. The README clarifies that an unrelated new problem re-enters at A, while a recognized recurrence may resume review of the existing disposition. It also says a tolerated class is not claimed to be rooted out. That resolves the intended distinction, though View 2’s edge label alone does not spell it out.
- **Retry scope:** The README explicitly calls the retry bounded and per-operation, up to three. This confirms the operation-local reading and rules out treating the cap as a global agent counter. It says there is no global recurrence counter or forced Zoom-out. It still does not define whether “up to three” counts retries after the original attempt or total executions, or when a later recurrence resets the operation’s count.
- **Existing components:** The README identifies Error Ledger #359 and bounded context delivery #394 as established mechanisms to reuse. My first pass could only report that the diagrams represented them as existing. The README confirms that intent, but also says this is a discussion draft that changes no implementation or behavior and implies no new implementation. These files do not demonstrate live behavior.
- **Action identity:** `nodes.yaml` confirms A–G are drawing-local aliases for seven proposed actions, not persistent IDs or proof of an implemented workflow. Their statuses are `proposed`; the README says redrawing does not regenerate them. This reduces the risk of treating the flow labels as established runtime identifiers.

## Concerns that remain

- The README confirms that a nonblocking item is identified/recorded and deferred, and that the immediate fix cycle is for the blocking path. It does not explain why Diagram 1 has both `Blocks current main path?` and the later `Blocking main path?` decisions when both branches of the first decision lead to C. The duplicate gate can still confuse readers about which decision controls deferral.
- The README supplies the intended interpretation of Diagram 2’s composition and recurrence edge, but the diagram itself does not label `C → D` as non-control-flow or distinguish a new problem from a recognized recurrence. A reader viewing the diagrams without the prose could still mistake the route or recurrence.
- The parent files still do not specify approval evidence, the criteria for “Recovered?”, the counting boundary for three retries, or what evidence satisfies acceptance. Those are unstated details, not evidence of an unsafe implemented behavior.

STATUS: DONE
