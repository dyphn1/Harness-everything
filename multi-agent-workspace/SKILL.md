---
name: multi-agent-workspace
description: "Scaffold a verified multi-agent workspace and select bounded specialists from an external agency-agents catalog without vendoring the full roster."
license: Apache-2.0
metadata:
  author: Miya Daniel
  version: 0.3.7
---

# Multi-Agent Workspace

## USE FOR:
- A structured workflow plan selecting `fable-multi-agent-workspace` for durable, multi-session work needing reusable specialists or indexed workspace memory.
- Scaffolding six-zone multi-agent workspaces with a launcher, memory index, and handoff manifest.
- Selecting and delegating bounded specialists from an agency-agents source catalog.

## DO NOT USE FOR:
- A single-agent task, ordinary TDD, or Fable-only orchestration.
- Choosing execution topology from file/line counts; the Harness router owns topology selection.
- Preloading or vendoring an entire external agent body roster.

## Skill Contract

| Component | Specification |
| :--- | :--- |
| **State Mutations** | Writes derived metadata, roles, state, logs, launcher, router, handoff, and memory index under the global workspace-keyed Harness state home; writes decision, domain, and architecture records at resolver-selected committable repository paths. |

## Workflow

1. Confirm the structured workflow plan selects `fable-multi-agent-workspace`; consume only its workspace/role/memory requirements.
2. Discover the target stack, source availability, requested platform, divisions, and agents.
3. Run `node <this-skill-dir>/scripts/scaffold.js --workspace <root>` with explicit selections.
4. Run `node <this-skill-dir>/scripts/consume-workflow-plan.js --plan-file <router-contract.json> --root <root> --run-id <runId>` to correlate the existing `.ai/handoff.json` without replacing selected roles, provenance, or memory index.
5. Verify resolved document paths, indexed memory, selected roles, and the correlated handoff; return that handoff to `fable-mode` for execution and verification.

The workflow-plan consumer does not spawn workers, choose a model, rewrite role selection, or persist arbitrary model output to memory. The source is optional: missing source yields an unavailable-catalog fallback. The resolver records provenance and a resolution kind (`explicit`, `inferred`, or `fallback`). Omitted `--workspace` uses the current repository root; explicit targets are used verbatim. Use `--allow-source-drift` to refresh a catalog at another revision. Read the references for migration and source rules.

Deep dive: <this-skill-dir>/references/orchestration.md
Deep dive: <this-skill-dir>/references/architecture-guide.md
Deep dive: <skills-repo-root>/docs/workflows/multi-agent-workspace.md
