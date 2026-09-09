---
name: multi-agent-workspace
description: "Scaffold a verified multi-agent workspace and select bounded specialists from an external agency-agents catalog without vendoring the full roster."
license: Apache-2.0
metadata:
  author: Miya Daniel
  version: 0.3.6
---

# Multi-Agent Workspace

## USE FOR:
- Scaffolding six-zone multi-agent workspaces with a launcher, memory index, and handoff manifest.
- Selecting and delegating bounded specialists from an agency-agents source catalog.

## DO NOT USE FOR:
- A single-agent task, ordinary TDD, or Fable-only orchestration.
- Preloading or vendoring an entire external agent body roster.

## Skill Contract

| Component | Specification |
| :--- | :--- |
| **Trigger / Input** | Tier 3 workspace scaffold or specialist-selection request; optional `--agency-source`. |
| **Expected Output** | Global runtime manifest/handoff, resolved document paths, selected-agent catalog, launcher, and indexed memory. |
| **State Mutations** | Writes runtime state under the global workspace key; only resolved decision/domain/architecture folders are repository-local. |
| **Enforcement Gate** | Run `scripts/scaffold.js`; it validates source metadata, conflicts, revision drift, and generated artifacts. |

## Workflow

1. Discover the target stack, source availability, requested platform, divisions, and agents.
2. Run `node multi-agent-workspace/scripts/scaffold.js --workspace <root>` with explicit selections.
3. Read the installed skill/indexer and the global manifest/handoff before delegating.
4. Verify resolved document paths, the indexed memory, and selected roles.
5. Record the handoff and continue through `fable-mode` verification gates.

The source is optional: missing source produces an explicit unavailable-catalog fallback, never a fake complete roster. The resolver records detailed provenance (`CONTEXT-MAP`, `projectDocs`, inference, or fallback) plus normalized resolution kind (`explicit`, `inferred`, or `fallback`). An omitted `--workspace` means the repository root from the current directory; an explicit target is used verbatim. `--allow-source-drift` is required to refresh an existing catalog at a different source revision. See `references/orchestration.md` and `references/agency-agents.md` for migration and source rules.

Deep dive: [references/orchestration.md](references/orchestration.md) + [references/architecture-guide.md](references/architecture-guide.md). Workflow: [docs/workflows/multi-agent-workspace.md](../docs/workflows/multi-agent-workspace.md)
