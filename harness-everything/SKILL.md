---
name: harness-everything
description: "Route software/project work through the Harness kernel: classify Tier 1/2/3, surface semantic obligations and applicable skills, then let the agent choose tactics inside the contract. Use for software triage, routing, and re-routing; not general Q&A or non-software writing."
license: Apache-2.0
metadata:
  author: Miya Daniel
  version: 0.18.1
---

# Harness Everything

Kernel routing entry.

## USE FOR:
- Software/project triage, routing, re-routing, and workflow selection.
- Work that names or matches another skill.

## DO NOT USE FOR:
- General Q&A or non-software writing.

## Invariants
1. **Route before execution (MUST)** — establish scope/tier and the selected/deferred topology.
2. **Verify before claim (MUST)** — completion needs objective evidence.
3. **Zoom out on repetition (MUST)** — after 3 same-signature failures, use `zoom-out`.
4. **Resolve suggestions (MUST)** — read/evaluate each suggested `SKILL.md`; applicable core contracts MUST run, otherwise keep a flow-grounded reason.
5. **Surface status (MUST)** — non-trivial work renders `### 🚦 Harness Status` with bold `Current`, `Read / Evidence`, `Next`; optional `Risk / Blocked`.
6. **Keep agency** — required obligations are MUST; tactics MAY adapt. Numeric planning values MAY guide but never hard-stop execution.

## Workflow
1. Reuse kernel output, or run `node "<this-skill-dir>/scripts/kernel-router.js" "<prompt summary>"`.
2. Keep the **Harness Routing Checkpoint** internal; never render it separately.
3. Read each suggested `SKILL.md`; resolve `use`, `not-applicable`, or `unresolved`. `use` means follow its core contract; `not-applicable` needs a flow-grounded reason.
4. Resolve the selected topology's required invariants/stages/checks before completion. Implementation technique and local ordering MAY adapt where the contract allows.
5. Tier-3/Fable broad mutation MUST resolve isolation: verified linked worktree or explicit degraded fallback. Verification-before-claim remains MUST.
6. Missing runtime evidence may trigger reminders, not a Harness reset or persistent lock.

**Rule:** semantic MUST does not mean hard blocking; only Rule-of-3 reflection and explicit user/host permission boundaries may block.

Deep dive: <this-skill-dir>/references/triage-and-tiers.md
