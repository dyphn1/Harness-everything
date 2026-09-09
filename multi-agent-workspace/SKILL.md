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

## Workflow

1. Discover the target stack, source availability, requested platform, divisions, and agents.
2. Run `node <this-skill-dir>/scripts/scaffold.js --workspace <root>` with explicit selections.
3. Read the installed skill/indexer and the global manifest/handoff before delegating.
4. Verify resolved document paths, the indexed memory, and selected roles.
5. Record the handoff and continue through `fable-mode` verification gates.

The source is optional: missing source yields an unavailable-catalog fallback. The resolver records provenance and a resolution kind (`explicit`, `inferred`, or `fallback`). Omitted `--workspace` uses the current repository root; explicit targets are used verbatim. Use `--allow-source-drift` to refresh a catalog at another revision. Read the references for migration and source rules.

Deep dive: <this-skill-dir>/references/orchestration.md
Deep dive: <this-skill-dir>/references/architecture-guide.md
Deep dive: <skills-repo-root>/docs/workflows/multi-agent-workspace.md
