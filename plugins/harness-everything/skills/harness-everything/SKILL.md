---
name: harness-everything
description: "Route software/project work through the Harness kernel: classify Tier 1/2/3, establish mandatory invariants, then let the agent choose tactics and domain skills. Use for software triage, routing, and re-routing; not general Q&A or non-software writing."
license: Apache-2.0
metadata:
  author: Miya Daniel
  version: 0.7.0
---

# Harness Everything

Kernel entry for software/project routing.

## USE FOR:
- Software triage/re-routing, including work that already names or strongly matches another skill.
- Inspecting Tier, invariants, or suggestions.

## DO NOT USE FOR:
- General Q&A or non-software writing.

## Invariants

1. **Route before execution** — establish scope/tier before mutation.
2. **Verify before claim** — completion needs objective evidence.
3. **Re-plan on repetition** — after 3 same-signature failures, stop micro-retrying and use `zoom-out`/fresh diagnosis.
4. **Evaluate before skip** — read every suggested skill's complete `SKILL.md` entry before omission.

These rails are mandatory; Tier guidance is not a fixed pipeline.

## Workflow

1. Reuse current-turn kernel output, or run `node "<this-skill-dir>/scripts/kernel-router.js" "<prompt summary>"`.
2. Ensure the emitted **Harness Routing Checkpoint** is user-visible.
3. Preserve the invariants.
4. For every suggested skill, read its complete `SKILL.md` entry before deciding to skip it. Evaluate its `USE FOR`, `DO NOT USE FOR`, workflow/basic flow, and hard rules. Do not reject a suggestion from only its name, description, router summary, or "routine/common task". Read extra material only when the entry explicitly requires it to decide applicability.
5. Execution remains advisory after evaluation. Unreadable suggestions are `unresolved/unavailable`, not silently skipped. Using one suggestion does not waive read-before-skip for other skipped suggestions. If all suggestions are skipped, state one brief reason grounded in the evaluated flows.

## Tier Guidance

- **Tier 1:** Prefer direct execution.
- **Tier 2/3:** Evaluate suggested skills before omission; execute only those that add value.

**Rule:** mandatory evaluation, advisory execution; no fixed workflow order.

Deep dive: <this-skill-dir>/references/triage-and-tiers.md
