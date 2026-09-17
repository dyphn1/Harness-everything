---
name: harness-everything
description: "Route software/project work through the Harness kernel: classify Tier 1/2/3, establish mandatory invariants, then let the agent choose tactics and domain skills. Use for software triage, routing, and re-routing; not general Q&A or non-software writing."
license: Apache-2.0
metadata:
  author: Miya Daniel
  version: 0.7.0
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
4. **Evaluate before skip** — when the router suggests a skill, read that skill's complete `SKILL.md` entry/basic flow before omitting it.

These rails are mandatory; Tier guidance is not a fixed pipeline.

## Workflow

1. Reuse current-turn kernel output, or run `node "<this-skill-dir>/scripts/kernel-router.js" "<prompt summary>"`.
2. Ensure the emitted **Harness Routing Checkpoint** is user-visible: reuse a host-visible rendering or include it in the first progress/update message.
3. Preserve the invariants.
4. For every suggested skill, read its complete `SKILL.md` entry before deciding to skip it. Evaluate its `USE FOR`, `DO NOT USE FOR`, workflow/basic flow, and hard rules. Do not reject a suggestion from only its name, description, router summary, or a generic judgement such as "routine/common task". If the entry explicitly requires another document to decide applicability, read that required material; ordinary deep-dive/reference links remain optional.
5. After that evaluation, execution remains advisory: choose, combine, reorder, or skip skills as useful. A suggestion that cannot be resolved/read is `unresolved/unavailable`, not silently skipped. Using one suggestion does not waive read-before-skip for other skipped suggestions. If all suggestions are skipped, state one brief reason grounded in the evaluated flows with the visible checkpoint/progress update.

## Tier Guidance

- **Tier 1:** Prefer direct execution.
- **Tier 2:** TODO tracking, TDD, and verification are common suggestions; suggested skills must be evaluated before omission.
- **Tier 3:** Fable/multi-agent skills are optional to execute when macro planning or delegation helps, but suggested entries must still be evaluated before omission.

**Rule:** enforce checkpoint visibility, workflow invariants, and mandatory suggestion evaluation — not workflow order. Suggested-skill execution remains agent-controlled after evaluation.

Deep dive: <this-skill-dir>/references/triage-and-tiers.md
