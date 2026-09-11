---
name: harness-everything
description: "Route software/project work through the Harness kernel: classify Tier 1/2/3, establish mandatory invariants, then let the agent choose tactics and domain skills. Use for software triage, routing, and re-routing; not general Q&A or non-software writing."
license: Apache-2.0
metadata:
  author: Miya Daniel
  version: 0.3.7
---

# Harness Everything

Public/manual Harness kernel entry. Hook-capable hosts should run the kernel before peer/domain skill selection.

## USE FOR:
- Software triage/re-routing, including work that already names or strongly matches another skill.
- Inspecting Tier, invariants, or suggestions.

## DO NOT USE FOR:
- General Q&A or non-software writing.

## Invariants

1. **Route before execution** — establish scope/tier before mutation.
2. **Verify before claim** — completion needs objective evidence.
3. **Re-plan on repetition** — after 3 same-signature failures, stop micro-retrying and use `zoom-out`/fresh diagnosis.

These rails are mandatory; Tier guidance is not a fixed pipeline.

## Workflow

1. Reuse current-turn kernel output, or run `node "<this-skill-dir>/scripts/kernel-router.js" "<prompt summary>"`.
2. Preserve the invariants.
3. Treat suggested skills as advisory: choose, combine, reorder, or omit them as useful.

## Tier Guidance

- **Tier 1:** Prefer direct execution.
- **Tier 2:** TODO tracking, TDD, and verification are common suggestions.
- **Tier 3:** Fable/multi-agent skills are optional when macro planning or delegation helps.

**Rule:** do not enforce workflow order; let the agent orchestrate itself inside the invariants.

Deep dive: <this-skill-dir>/references/triage-and-tiers.md
