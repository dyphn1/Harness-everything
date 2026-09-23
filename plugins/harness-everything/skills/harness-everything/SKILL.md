---
name: harness-everything
description: "Route software/project work through Harness: classify tier/topology, resolve suggested skills, apply semantic obligations, and keep tactics flexible. Use for software triage/routing/re-routing; not general Q&A or non-software writing."
license: Apache-2.0
metadata:
  author: Miya Daniel
  version: 0.24.0
---

# Harness Everything

Kernel routing entry.

## USE FOR:
- Software/project triage, routing, re-routing, workflow selection.
- Work that names or matches another skill.

## DO NOT USE FOR:
- General Q&A or non-software writing.

## Invariants
1. **Route (MUST)** — establish scope/tier and selected/deferred topology.
2. **Verify (MUST)** — completion claims need objective evidence.
3. **Zoom out (MUST)** — after 3 same-signature failures, use `zoom-out`.
4. **Resolve suggestions (MUST)** — read/evaluate each suggested `SKILL.md`; applicable core contracts MUST run, otherwise retain a flow-grounded reason.
5. **Surface status (MUST)** — non-trivial work renders `### 🚦 Harness Status` with bold `Current`, `Read / Evidence`, `Next`; optional `Risk / Blocked`.
6. **Keep agency** — required obligations are MUST; tactics MAY adapt. Numeric planning values MAY guide, never hard-stop.

## Workflow
1. Reuse kernel output or run `node "<this-skill-dir>/scripts/kernel-router.js" "<prompt summary>"`.
2. Keep the routing checkpoint internal.
3. Resolve each suggestion as `use`, `not-applicable`, or `unresolved`; `use` follows its core contract.
4. Resolve selected-topology required invariants/stages/checks before completion.
5. Tier-3/Fable broad mutation MUST resolve isolation: linked worktree or explicit degraded fallback.

**Rule:** semantic MUST is not hard blocking; only Rule-of-3 reflection and explicit user/host permission boundaries may block.

Deep dive: <this-skill-dir>/references/triage-and-tiers.md
