---
name: self-evolve
description: "Extract root causes from resolved problems and persist them as defensive memory rules or dynamic skills; use after struggles, zoom-outs, or explicit request."
license: Apache-2.0
metadata:
  author: Miya Daniel
  version: 0.3.6
---

# Self-evolve

Record reusable root causes from resolved work.

Boundary: the host agent supplies authorized evidence and a generalized root cause. This skill classifies and persists it; it does not scan host transcripts.

Load `references/memory-resolution.md` on demand for the decision matrix, fallback paths, lazy-loading rules, and dynamic-skill details.

## 📋 Skill Contract

| Component | Specification |
| :--- | :--- |
| **Trigger / Input** | Resolved struggle, zoom-out recovery, or explicit request; caller supplies evidence and root cause. |
| **Expected Output** | Persisted rule in existing memory or registered dynamic skill. |
| **State Mutations** | Updates the selected workspace memory or generated-skill manifest. |
| **Enforcement Gate** | Deduplication, self-regression, and the 60-line routing rule pass before persistence. |

## Core Workflow

1. Prefer existing `MEMORY.md`/`RULES.md`/`CLAUDE.md`/`AGENTS.md`.
2. Route the lesson:
   - Simple rule (constraint/tip) → `memories/repo/RULES.md`, else `.github/harness-everything/memories/RULES.md`; use `persist-memory.js`.
   - Reusable procedure → follow `skill-creator/SKILL.md`, then register with `register-dynamic-skill.js` in every platform `manifest.json`.
3. Run `self-regression.js` before persisting. Never persist without it.

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
