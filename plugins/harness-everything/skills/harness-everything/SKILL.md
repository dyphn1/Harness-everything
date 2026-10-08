---
name: harness-everything
description: "Route software/project work through Harness: classify tier/topology, compose active-step knowledge bindings, apply semantic obligations, and keep tactics flexible. Use for software triage/routing/re-routing; not general Q&A or non-software writing."
license: Apache-2.0
metadata:
  author: Miya Daniel
  version: 0.30.6
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
4. **Bind knowledge by step (MUST)** — declare required/optional skills and references on ordered steps; disclose and resolve only the active step's bindings.
5. **Surface status (MUST)** — non-trivial work renders `### 🚦 Harness Status` with bold `Current`, `Read / Evidence`, `Next`; `Risk / Blocked` optional.
6. **Keep agency** — required obligations are MUST; tactics MAY adapt. Numeric planning MAY guide, never hard-stop; only Rule-of-3 reflection and explicit user/host permission boundaries may block.
7. **Windows PowerShell (MUST)** — `Get-Content -Encoding UTF8 -Raw`; npm `.cmd` shims (`npx.cmd`); never weaken `ExecutionPolicy`.

## Workflow
1. Reuse kernel output or run `node "<this-skill-dir>/scripts/kernel-router.js" "<prompt summary>"`.
2. Keep the routing checkpoint internal; treat knowledge signals as planning inputs, never document selectors.
3. Decompose ordered requirement steps before execution; declare each step's required/optional bindings.
4. Load only active-step bindings. A required binding and its applicable core contract MUST resolve before the step passes; unknown/unavailable remains visible and unresolved.
5. Complete selected-topology invariants/stages/checks. Fable exposes bindings only for dependency-ready stages.
6. Tier-3/Fable broad mutation MUST use a linked worktree or explicit degraded fallback.

Deep dive: <this-skill-dir>/references/triage-and-tiers.md
