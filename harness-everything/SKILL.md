---
name: harness-everything
description: "Route software/project work through the Harness kernel: classify Tier 1/2/3, establish mandatory invariants, then let the agent choose tactics and domain skills. Use for software triage, routing, and re-routing; not general Q&A or non-software writing."
license: Apache-2.0
metadata:
  author: Miya Daniel
  version: 0.13.0
---

# Harness Everything

Kernel routing entry.

## USE FOR:
- Software/project triage, routing, re-routing, and workflow selection.
- Work that names or matches another skill.

## DO NOT USE FOR:
- General Q&A or non-software writing.

## Invariants
1. **Route before execution** — establish scope/tier and the smallest applicable workflow.
2. **Verify before claim** — require objective evidence.
3. **Re-plan on repetition** — after 3 same-signature failures, use `zoom-out`.
4. **Evaluate before omission** — read each suggested skill's `SKILL.md` before deciding applicability.
5. **Resolve selected workflow** — model confidence is not an escape condition.

## Workflow
1. Reuse kernel output, or run `node "<this-skill-dir>/scripts/kernel-router.js" "<prompt summary>"`.
2. Surface the **Harness Routing Checkpoint**.
3. Read each suggested `SKILL.md`; evaluate `USE FOR`, `DO NOT USE FOR`, workflow/basic flow, and hard rules. "Simple", "routine", names, or summaries alone cannot justify omission.
4. Execute the selected workflow topology to resolution. Suggested skills are conditional on applicability; the selected topology is not advisory.
5. If the workflow genuinely cannot represent part of the task, use the explicit escape with uncovered scope + evidence. Covered obligations remain mandatory.
6. Complete only after applicable workflow obligations and objective verification resolve.

**Rule:** mandatory applicable workflow; flexible reasoning/implementation inside it; evidence-backed escape only for uncovered scope.

Deep dive: <this-skill-dir>/references/triage-and-tiers.md
