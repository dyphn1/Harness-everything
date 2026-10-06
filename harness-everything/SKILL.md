---
name: harness-everything
description: "Route software/project work through Harness: classify tier/topology, resolve suggested skills, apply semantic obligations, and keep tactics flexible. Use for software triage/routing/re-routing; not general Q&A or non-software writing."
license: Apache-2.0
metadata:
  author: Miya Daniel
  version: 0.30.3
---

# Harness Everything

## USE FOR:
- Software/project triage, routing, re-routing, workflow selection.
- Work naming or matching another skill.

## DO NOT USE FOR:
- General Q&A or non-software writing.

## Invariants
1. **Route (MUST)** — scope/tier plus selected/deferred topology.
2. **Verify (MUST)** — objective evidence via `verify-gate.js --json`.
3. **Zoom out (MUST)** — after 3 same-signature failures, use `zoom-out`.
4. **Resolve suggestions (MUST)** — evaluate each suggested `SKILL.md`; run applicable core contracts or retain a flow-grounded reason.
5. **Surface status (MUST)** — non-trivial work renders `### 🚦 Harness Status` with bold `Current`, `Read / Evidence`, `Next`; `Risk / Blocked` optional.
6. **Keep agency** — semantic MUST is not a hard block; tactics MAY adapt; numeric planning never hard-stops. Only Rule-of-3 reflection or explicit user/host permission may block.
7. **Windows PowerShell (MUST)** — `Get-Content -Encoding UTF8 -Raw`; npm `.cmd` shims (`npx.cmd`); never weaken `ExecutionPolicy`.

## Workflow
1. Reuse kernel output or run `node "<this-skill-dir>/scripts/kernel-router.js" "<prompt summary>"`.
2. Keep the routing checkpoint internal.
3. Resolve suggestions as `use`, `not-applicable`, or `unresolved`; `use` follows its core contract.
4. Complete selected-topology invariants/stages/checks.
5. Tier-3/Fable broad mutation MUST use a linked worktree or explicit degraded fallback.

Deep dive: <this-skill-dir>/references/triage-and-tiers.md
