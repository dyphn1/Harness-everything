# Second pass — differences from first pass

The parent README confirms the three-view mapping inferred in the first pass: Views 1 and 2 group the same Actions under ASSESS and RESPOND, and D in both is refined by View 3. It clarifies that these groupings organize the presentation and do not change control flow. View 2 is specifically a composition view, not another executable flow specification.

The README and `nodes.yaml` resolve the identity question left open in the first pass:

- `identifier` is the proposed persistent identity for an Action. It uses category, creation date, and UUIDv4; it is immutable once accepted. Redrawing, renaming, or moving an Action does not regenerate it.
- `name` is the human- and agent-readable label and may change independently. The diagrams display names; their A–G labels remain drawing-local aliases.
- `status` is separate metadata. The seven entries in `nodes.yaml` are marked `proposed`; the README says lifecycle transitions are not yet specified.

The diagrams do not imply that a separate file already exists for every Action. The README says each Action may later be detailed by its own activity diagram, flowchart, or timeline. It describes this overview as discussion only and says no implementation is changed. The README references `activity.puml` as a corresponding source for View 1, but I did not inspect that file, so its existence or contents are not established by this second pass.

The README clarifies which drawn links are explanatory. In View 2, dotted links from Reviewer / Owner to B and D, from the ledger to C and E, and from the context-delivery mechanism to F are associations showing authority or reuse, not new graph edge types or a dependency language. The dotted G links are conceptual return paths: an unrelated new problem re-enters at Capture, while a same-class recurrence may re-enter disposition review. The README explicitly says the latter is not an automatic extra PR review round. The cross-view expansion references also do not create a `viewRef` field or extra UML relation. The drawings remain visual descriptions; the README says no implementation or CLI behavior is changed.

STATUS: DONE
