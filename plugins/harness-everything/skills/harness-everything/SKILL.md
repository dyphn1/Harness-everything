---
name: harness-everything
description: "Route software/project work through the Harness kernel: classify Tier 1/2/3, establish mandatory invariants, then let the agent choose tactics and domain skills. Use for software triage, routing, and re-routing; not general Q&A or non-software writing."
license: Apache-2.0
metadata:
  author: Miya Daniel
  version: 0.8.0
---

# Harness Everything

Kernel routing entry.

## USE FOR:
- Software/project triage, re-routing, and suggested-skill evaluation.
- Work that names or matches another skill.

## DO NOT USE FOR:
- General Q&A or non-software writing.

## Invariants
1. **Route before execution** — establish scope/tier.
2. **Verify before claim** — require objective evidence.
3. **Re-plan on repetition** — after 3 same-signature failures, use `zoom-out`.
4. **Evaluate before skip** — read each suggested skill's complete `SKILL.md`.

Tier guidance is not a fixed pipeline.

## Workflow
1. Reuse kernel output, or run `node "<this-skill-dir>/scripts/kernel-router.js" "<prompt summary>"`.
2. Make the **Harness Routing Checkpoint** user-visible.
3. For every suggestion, read its `SKILL.md`; evaluate `USE FOR`, `DO NOT USE FOR`, workflow/basic flow, and hard rules. Name, description, router summary, or "routine/common task" alone cannot justify skip. Read extra material only when explicitly required for applicability.
4. Execution is advisory after evaluation. Unreadable suggestions are `unresolved/unavailable`. Using one suggestion does not waive evaluation of others. If all are skipped, give one brief flow-grounded reason.

**Rule:** mandatory evaluation, advisory execution; no fixed workflow order.

Deep dive: <this-skill-dir>/references/triage-and-tiers.md
