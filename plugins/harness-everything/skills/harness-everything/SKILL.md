---
name: harness-everything
description: "Route software/project work through the Harness kernel: classify Tier 1/2/3, surface planning guidance and applicable skills, then let the agent choose tactics. Use for software triage, routing, and re-routing; not general Q&A or non-software writing."
license: Apache-2.0
metadata:
  author: Miya Daniel
  version: 0.18.0
---

# Harness Everything

Kernel routing entry.

## USE FOR:
- Software/project triage, routing, re-routing, and workflow selection.
- Work that names or matches another skill.

## DO NOT USE FOR:
- General Q&A or non-software writing.

## Invariants
1. **Route before execution** — establish scope/tier and useful workflow guidance.
2. **Verify before claim** — seek objective evidence before saying work is done.
3. **Zoom out on repetition** — after 3 same-signature failures, use `zoom-out`.
4. **Evaluate before omission** — read each suggested skill's `SKILL.md` before deciding applicability.
5. **Surface status** — non-trivial work MUST use one `Harness Status`: `Current`, `Read/Evidence`, `Next`, optional `Blocked/Risk`, at major phase/direction boundaries.
6. **Keep agency** — workflow state and numeric limits guide; they do not hard-stop execution.

## Workflow
1. Reuse kernel output, or run `node "<this-skill-dir>/scripts/kernel-router.js" "<prompt summary>"`.
2. Use the **Harness Routing Checkpoint** to populate the first Harness Status; it is not a second progress format.
3. Read each suggested `SKILL.md`; evaluate `USE FOR`, `DO NOT USE FOR`, workflow/basic flow, and hard rules.
4. Use the selected topology as planning guidance. Choose, combine, reorder, or skip steps when evidence supports doing so.
5. Prefer worktree isolation for broad/Tier-3 mutation and objective verification before completion.
6. If guidance is not useful, explain the reason briefly and continue; no Harness reset is required.

**Rule:** guidance may become louder when evidence is weak, but only Rule-of-3 reflection and explicit user/host permission boundaries may block.

Deep dive: <this-skill-dir>/references/triage-and-tiers.md
