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

Boundary: the host agent supplies evidence and a generalized root cause; this skill classifies and persists it, and never scans host transcripts.

Load `references/memory-resolution.md` on demand for the decision matrix, fallback paths, and dynamic-skill details.

## 📋 Skill Contract

| Component | Specification |
| :--- | :--- |
| **Trigger / Input** | Resolved struggle, zoom-out recovery, or explicit request. |
| **Expected Output** | Persisted rule in existing memory or registered dynamic skill. |
| **State Mutations** | Updates the selected workspace memory or generated-skill manifest. |
| **Enforcement Gate** | `persist-memory.js`'s dedup + quality-score gate for simple rules; `self-regression.js` for dynamic-skill registration only. |

## Core Workflow

1. Prefer existing `MEMORY.md`/`RULES.md`/`CLAUDE.md`/`AGENTS.md`.
2. Route the lesson:
   - Simple rule (constraint/tip) → run `node "<this-skill-dir>/scripts/persist-memory.js" "<generalized rule>"`. Appends to `memories/repo/RULES.md` (else `.github/harness-everything/memories/RULES.md`), self-gated on dedup + quality score.
   - Reusable procedure → follow `skill-creator/SKILL.md`, then register via `register-dynamic-skill.js`.
3. Inside this repo only, run `self-regression.js` (`npm test`) before registering a dynamic skill or editing this repo's own files — irrelevant to a host workspace.

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
