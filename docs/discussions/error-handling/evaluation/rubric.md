# Cross-role evaluation rubric — coordinator-only (NOT for blind reviewers)

> This is an assessment protocol, **not a report of completed sub-agent reviews**. Last verified source commit: `33e1ef7842d1fdaf4aad29d7e8b38eb53cb17d31`. Keep this file hidden until each independent review has already produced its first-pass artifact.

## Acceptance reference (from current proposed design; not undisputed implementation truth)

1. Main blocking path follows Capture → Triage → Identify → Decide disposition → Treat → Deliver relevant context → Accept and retire.
2. Diagram 1 is the full Activity with decisions, early exits, recurrence; Diagram 2 groups the same Actions by ASSESS / RESPOND and shows existing supporting actors/capabilities; Diagram 3 expands the D Action only.
3. Diagram-local A–G / decision-diamond labels are not durable IDs. `identifier` is independent of `name` and `status`; `ERR-YYYYMMDD-UUIDv4` is a proposal. Redrawing does not regenerate IDs.
4. Non-blocking real problem: identify/record first, defer immediate treatment. Unknown class: request owner approval rather than silently creating a new category.
5. A class already approved as Tolerate may use an at-most-three **operation-local** retry, ending UNVERIFIED on failure; not a global recurrence count and not proof of required verification PASS.
6. D chooses Converge / Avoid / proposed Tolerate (owner approval required). G does not claim that a tolerated class is rooted out, and recurrence is not an automatic CI gate.
7. #359 Ledger and #394 delivery are **existing mechanisms**. These drawings neither implement a new hook nor modify those mechanisms.
8. The cross-view association is through named partitions and Action D expansion, **not** literal clickable links or a new edge ontology.

## Review scoring (per reviewer)

- 0 = cannot reconstruct intended flow; 1 = major false readings; 2 = reconstructs part with serious uncertainty; 3 = core understanding but one material ambiguity; 4 = reconstructs role-specific behavior with minor ambiguity; 5 = precise intended interpretation, clear limits and no invented guarantees.
- Evaluate *first pass only* for clarity. The parent README may disambiguate in second pass, but should **not** retroactively boost the blind-read score.
- Record exact false inference, the diagram or label that induced it, and smallest edit that would prevent it.

## Initial structural cautions to test, not pre-label as independent findings

- Diagram 1 sends **known-class recurrence** from G to D; Diagram 2 sends **newly observed recurrence** from G to INPUT/Capture. Might be read as conflicting; scope the distinction explicitly.
- PlantUML activity source is a second rendering of Diagram 1 but may elide some final disposition branches. Compare separately after the blind Mermaid pass.
- Diagram 1 uses many exits and cross-partition paths; a visually large chart may be logically correct yet difficult to scan.
- View 2 looks like a sequential process although labeled composition; check whether readers confuse a schematic structure view with a second execution specification.

## Results (not yet executed independently)

| Reader | First-pass report | Second-pass delta | Score | Status |
|---|---|---|---|---|
| 1 Execution | — | — | — | NOT EXECUTED |
| 2 Architect | — | — | — | NOT EXECUTED |
| 3 Maintainer | — | — | — | NOT EXECUTED |
| 4 Adversarial | — | — | — | NOT EXECUTED |

A score or U5 verdict must not be assigned without actual, separately captured agent outputs.
