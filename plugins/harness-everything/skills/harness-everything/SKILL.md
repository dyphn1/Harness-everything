---
name: harness-everything
description: "Route software/project work through the Harness kernel: classify Tier 1/2/3, establish mandatory invariants, select the smallest applicable workflow, then let the agent choose tactics inside that workflow. Use for software triage, routing, and re-routing; not general Q&A or non-software writing."
license: Apache-2.0
metadata:
  author: Miya Daniel
  version: 0.8.0
---

# Harness Everything

Kernel routing entry.

## USE FOR:
- Software/project triage, re-routing, workflow selection, and suggested-skill evaluation.
- Work that names or matches another skill.

## DO NOT USE FOR:
- General Q&A or non-software writing.

## Invariants
1. **Route before execution** — establish scope/tier and the smallest applicable workflow.
2. **Verify before claim** — require objective evidence.
3. **Re-plan on repetition** — after 3 same-signature failures, use `zoom-out`.
4. **Evaluate before skip** — read each suggested skill's complete `SKILL.md` before deciding applicability.
5. **Resolve the selected workflow** — once the router selects a topology, execute it to a resolved state; model confidence is not an escape condition.

A tier is not a universal fixed skill pipeline. The selected workflow topology is still mandatory once applicable; flexibility lives inside its stages and in explicit evidence-backed escape for scope the workflow cannot cover.

## Workflow
1. Reuse kernel output, or run `node "<this-skill-dir>/scripts/kernel-router.js" "<prompt summary>"`.
2. Make the **Harness Routing Checkpoint** user-visible.
3. For every suggestion, read its `SKILL.md`; evaluate `USE FOR`, `DO NOT USE FOR`, workflow/basic flow, and hard rules. Name, description, router summary, or "routine/common task" alone cannot justify omission. Read extra material only when explicitly required for applicability.
4. Execute the selected workflow topology to resolution. Individual suggested skills remain conditional on applicability, but the selected topology itself is not advisory.
5. If the selected workflow genuinely cannot represent part of the task, use the explicit workflow escape and record the uncovered scope plus evidence. Do not use "simple", "routine", "already clear", or model confidence as escape reasons.
6. Completion requires the selected workflow's applicable obligations and objective verification to resolve. Unreadable suggestions remain `unresolved/unavailable`; they do not become silently skipped.

**Rule:** mandatory applicable workflow, flexible reasoning/implementation inside the workflow, conditional evidence-backed escape only for uncovered scope.

Deep dive: <this-skill-dir>/references/triage-and-tiers.md
