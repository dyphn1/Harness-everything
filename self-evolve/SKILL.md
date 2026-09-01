---
name: self-evolve
description: "Extract root causes from resolved problems and persist them as defensive memory rules or dynamic skills; use after struggles, zoom-outs, or explicit request."
license: Apache-2.0
metadata:
  author: Miya Daniel
  version: 0.3.6
---

# Self Evolve (Self Evolution & Memory Extraction)

Record resolved root causes as rules future sessions follow.

Boundary: the host agent supplies relevant session evidence and root-cause analysis; this skill does not scan host transcripts.

## 📋 Skill Contract

| Component | Specification |
| :--- | :--- |
| **Trigger / Input** | Post-struggle completion or explicit request; caller supplies evidence and root-cause analysis. |
| **Expected Output** | Persisted rule in `MEMORY.md`/`memories/repo/RULES.md` or sub-memory file. |
| **State Mutations** | Updates the selected workspace memory or generated-skill manifest. |
| **Enforcement Gate** | Quality/deduplication checks, self-regression, and the 60-line routing rule pass before persistence. |

## Responsibility Boundary

The host agent reads the session context it is allowed to access, selects relevant evidence, and writes a generalized root cause. `self-evolve` classifies and persists that result; it MUST NOT fetch global host transcripts or act as a transcript daemon.

## Core Workflow

1. Prefer existing `MEMORY.md`/`RULES.md`/`CLAUDE.md`/`AGENTS.md` over new parallel structures.
2. Route the lesson:
   - Simple rule (constraint/tip) → `memories/repo/RULES.md`, else `.github/harness-everything/memories/RULES.md`; prefer `node "<this-skill-dir>/scripts/persist-memory.js" "<rule>"`.
   - Reusable pattern (generalizable procedure) → dynamic skill via `skill-creator/SKILL.md` Dynamic Skill Generation Contract; register via `node "<this-skill-dir>/scripts/register-dynamic-skill.js"` into every platform's `manifest.json`.
3. Validate before persisting: hermetic self-regression (`node "<this-skill-dir>/scripts/self-regression.js"`); never persist without it.

## USE FOR:
- Lesson after hard debugging recovery
- Defensive rule found mid-task
- Reusable pattern packaged as dynamic skill
- Post-zoom-out rule extraction

## DO NOT USE FOR:
- One-off notes that won't recur
- Lessons already captured
- Secrets in memory files
- Static repo skills (use `skill-creator`)

Deep dive: references/memory-resolution.md
