---
name: create-agent-launcher
description: "Spawn specialized sub-agents or scaffold multi-agent infrastructure when tasks span multiple domains beyond one context window. Use for Tier 3 delegation from fable-mode or building permanent agent manifests; output is a scoped sub-agent, inline persona fallback, or platform manifests."
license: Apache-2.0
metadata:
  author: Miya Daniel
  version: 0.3.4
---

# Create Agent Launcher

Orchestrate and scaffold multi-agent workflows with specialized division of labor.

## 📋 Skill Contract

| Component | Specification |
| :--- | :--- |
| **Trigger / Input** | Invoked by `fable-mode` for Tier 3 tasks needing domain division of labor, or when scaffolding new multi-agent teams. |
| **Expected Output** | Sub-agent spawned via native subagent tool, or inline persona role-switch fallback with isolated task scope. |
| **State Mutations** | Updates the session's delegation state (active sub-agents and assigned boundaries). |
| **Enforcement Gate** | Sub-agents return a structured handoff report. Avoid sub-agents for simple tasks (≤2 files / ≤300 lines) — handle directly under `tdd`. |

## Core Workflow

1. **Scope check**: task spans distinct domains (e.g. DB schema + API + frontend UI) or exceeds one context window → delegate; else handle directly.
2. **Delegate**: spawn a sub-agent via native subagent tool with focused persona, isolated file scope, model tier matched to complexity; require a handoff summary. Monitored by `hooks/scripts/subagent-scope-guard.js`. No tool → assume the persona inline.
3. **Scaffold permanent infrastructure**: run phases in order — `create-agent-launcher/workflows/01-init.md` → `02-analysis.md` → `03-generation.md` → `04-launcher.md`.

## USE FOR:
- Delegating Tier 3 tasks across multiple tech domains
- Spawning isolated sub-agents for context-heavy work
- Scaffolding permanent multi-agent manifests in a repo
- Sub-agent spawn vs inline persona fallback choice
- Version-control operations

## DO NOT USE FOR:
- Simple tasks of ≤2 files / ≤300 lines (handle directly under `tdd`)
- Single-domain work fitting one context window

Deep dive: references/orchestration.md
