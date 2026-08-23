---
name: self-evolve
description: "Extract root causes from resolved problems and persist them as defensive memory rules or dynamic skills; use after struggles, zoom-outs, or explicit request."
license: Apache-2.0
metadata:
  author: Miya Daniel | Harness Core Team
  version: 0.3.3
---

# Self Evolve (Self Evolution & Memory Extraction)

Record resolved root causes as rules future sessions follow.

## 📋 Skill Contract

| Component | Specification |
| :--- | :--- |
| **Trigger / Input** | Post-struggle completion or zoom-out recovery; input: root-cause analysis. |
| **Expected Output** | Persisted rule in `MEMORY.md`/`memories/repo/RULES.md` or sub-memory file. |
| **State Mutations** | Updates workspace/platform memory (`.github/harness-everything/memories/RULES.md`). |
| **Enforcement Gate** | **60-Line Rule**: <60 lines append directly; 60+ lines create modular topic file + lazy-load index pointer in primary `MEMORY.md`. |

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
