---
name: to-tickets
description: Break a to-spec feature-spec, a plan, or a conversation into tracer-bullet tickets with declared blocking edges — one file per ticket locally or issues on a real tracker via projectDocs. Use when an approved spec needs dependency-aware ordering.
license: Apache-2.0
metadata:
  author: Miya Daniel | Harness Core Team
  version: 0.3.4
---

# To Tickets

Cuts a plan or spec into tracer-bullet vertical slices, each declaring its blockers.

## USE FOR:
- Break a spec or settled plan into tracer-bullet vertical slices
- Declaring blocking edges and dependency order
- Publishing tickets to local files or a tracker

## DO NOT USE FOR:
- Writing the feature spec itself — instead use `to-spec`
- Trivial single-edit tasks needing no breakdown
- Closing parent tracker issues

## Skill Contract

| Component | Specification |
| :--- | :--- |
| **Trigger / Input** | Explicit /to-tickets only; input: spec reference or plan in context. |
| **Expected Output** | Tickets with What-to-build, Blocked-by, criteria — per projectDocs/convention/fallback. |
| **State Mutations** | None to manifest.json (reads only); writes tickets at resolved location. |
| **Enforcement Gate** | Run `node "to-spec/scripts/check-project-docs.js" check` if available; never block on Exit 1; MUST get user approval before publishing. |

## Process

1. Resolve path: script check (Exit 0 = configured location) → workspace convention dirs → platform fallback (`.claude`/`.github`/`.cursor` + `/harness-everything/tickets/`).
2. Gather context: prefer a referenced to-spec spec — design-audit verification MANDATORY first, else refuse; no spec is fine.
3. Explore codebase (optional): evidence-cited findings only; prefactor first.
4. Draft vertical slices: complete path through every layer, demoable alone, one context window each; declare blocking edges.
5. Quiz the user on granularity and edges until approved (MANDATORY gate).
6. Publish per ticket: one `<NN>-<slug>.md` file or tracker issue, dependency order, ready-for-agent, blocking links. Work the frontier; never close parents.

Deep dive: references/publishing-and-templates.md
