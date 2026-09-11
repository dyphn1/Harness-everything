---
name: harness-everything
description: "Route software/project work through the Harness kernel: classify Tier 1/2/3, establish mandatory invariants, then let the agent choose tactics and domain skills. Use for software triage, routing, and re-routing; not general Q&A or non-software writing."
license: Apache-2.0
metadata:
  author: Miya Daniel
  version: 0.3.7
---

# Harness Everything

Public/manual entry point to the Harness kernel. On hook-capable hosts, the kernel should run before peer/domain skill selection.

## USE FOR:
- Triage or re-route software work, including work that already names or strongly matches another skill.
- Inspect the current Tier, invariants, and suggested skills.

## DO NOT USE FOR:
- Chat or general Q&A.
- Non-software writing.

## Skill Contract

| Component | Specification |
| :--- | :--- |
| **Input** | Software/project work. |
| **Output** | Tier + rationale, required invariants, advisory skill suggestions. |
| **State** | Routing itself mutates nothing. |
| **Gate** | Run `<this-skill-dir>/scripts/kernel-router.js` before software mutation unless the host already injected its output. |

## Invariants

1. **Route before execution** — establish scope/tier before mutation.
2. **Verify before claim** — completion needs objective evidence.
3. **Re-plan on repetition** — after three same-signature failures, stop micro-retrying and use `zoom-out`/fresh diagnosis.

These rails are mandatory; Tier guidance is not a fixed pipeline.

## Workflow

1. Reuse current-turn kernel output, or run `node "<this-skill-dir>/scripts/kernel-router.js" "<prompt summary>"`.
2. Preserve the invariants.
3. Treat routed skills as advisory: choose, combine, reorder, or omit them as useful.
4. Follow named `[Self-Heal]` actions when emitted.

## Tier Guidance

- **Tier 1:** Prefer direct execution.
- **Tier 2:** TODO tracking, TDD, and verification are common suggestions.
- **Tier 3:** Fable and multi-agent skills are optional when macro planning/delegation helps.

**Architecture rule:** do not enforce workflow order. Enforce invariants, then let the agent orchestrate itself.

Deep dive: <this-skill-dir>/references/triage-and-tiers.md
