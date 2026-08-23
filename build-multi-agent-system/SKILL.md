---
name: build-multi-agent-system
description: Deploy a universal, self-adapting Multi-Agent Architecture into any project. It dynamically analyzes the tech stack to scaffold a token-efficient workspace with strict physical boundaries, hybrid SQLite memory, and isomorphic alignment protocols.
license: Apache-2.0
metadata:
  author: Miya Daniel | Harness Core Team
  version: 0.3.3
---

# Universal Multi-Agent Workspace Installer

Deploys a self-adapting multi-agent workspace: 6 functional zones, hybrid SQLite/markdown memory, immutable `AGENTS.md` router.

## USE FOR:
- Scaffold a multi-agent workspace from scratch
- Initialize an agent team with dynamically deduced roles
- Set up shared agent memory (SQLite indexer or markdown index)
- Create an immutable AGENTS.md router

## DO NOT USE FOR:
- Single-agent tasks or simple one-off edits
- Editing AGENTS.md without a scaffolding request
- Generating project documentation (`repo-docs`)

## Skill Contract

| Component | Specification |
| :--- | :--- |
| **Trigger / Input** | Tier 3 task; explicit request to scaffold a multi-agent workspace. |
| **Expected Output** | 6-zone structure; `index_memory` script or `memory-index.md` fallback; immutable `AGENTS.md` router (< 50 lines). |
| **State Mutations** | Rewrites `AGENTS.md`; creates zone directories; writes `memory.db` or `memory-index.md`. |
| **Enforcement Gate** | Run indexer; fall back to markdown on failure. `AGENTS.md` forbids sub-agent modification. |

## Workflow

1. [Checkpoint] Verify CWD is target root with read/write access.
2. [Discovery] Audit stack (`package.json`, `pyproject.toml`); deduce roles; PM + Challenger mandatory.
3. [Scaffold] Map the 6 Functional Zones ([State], [Logs], [Decisions], [Domain], [Architecture], [Roles]).
4. [Memory] Generate `index_memory` building `memory.db`; else markdown index fallback.
5. [Router] Rewrite `AGENTS.md` (< 50 lines): bootstrap protocol, cognitive metabolism, adaptive alignment, non-blocking release.
6. [Verify] Run `index_memory` once cleanly; summarize architecture and roles.

Deep dive: references/architecture-guide.md
