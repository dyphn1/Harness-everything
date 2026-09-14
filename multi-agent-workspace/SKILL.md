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
- A structured plan selecting `fable-multi-agent-workspace` for durable multi-session work with reusable specialists or indexed memory.
- Scaffolding bounded specialist roles, launcher, memory index, and handoff metadata.

## DO NOT USE FOR:
- Single-agent/TDD/Fable-only work.
- Choosing topology from file or line counts; the Harness router owns that decision.
- Vendoring an entire external agent roster.

## Skill Contract

| Component | Specification |
| :--- | :--- |
| **State Mutations** | Runtime roles, state, logs, handoff, and memory index stay under the workspace-keyed Harness state home; authored decision/domain/architecture docs stay at resolver-selected repository paths. |

## Workflow

1. Require `strategy=fable-multi-agent-workspace` and `workspace.required=true`.
2. Run `node <this-skill-dir>/scripts/scaffold.js --workspace <root>` with explicit selections.
3. Run `node <this-skill-dir>/scripts/consume-workflow-plan.js --plan-file <router-contract.json> --root <root> --run-id <runId>`.
4. Verify selected roles, provenance, memory index, and `<workspace>/.ai/handoff.json`; return the handoff to Fable for execution.

The consumer adds plan/run correlation only. It does not spawn workers, choose models, replace role provenance, or add a new memory-write path. Missing source uses the existing unavailable-catalog fallback.

Deep dive: <this-skill-dir>/references/orchestration.md
Deep dive: <this-skill-dir>/references/architecture-guide.md
Deep dive: <skills-repo-root>/docs/workflows/multi-agent-workspace.md
