---
name: skill-style
description: Apply Harness style guidelines when writing or refactoring SKILL.md files. Use when creating a new skill, reviewing skill structure, enforcing naming and frontmatter conventions, or standardizing tone, formatting, and progressive disclosure across the skill catalog.
license: Apache-2.0
metadata:
  author: Miya Daniel
  version: 0.3.6
---

# Skill Style

Apply the Harness writing standard when creating or refactoring `SKILL.md` files.

## Skill Contract

| Component | Specification |
| :--- | :--- |
| **Trigger / Input** | Creating, reviewing, or refactoring a Harness `SKILL.md`. |
| **Expected Output** | A concise, complete, non-overlapping `SKILL.md`. |
| **State Mutations** | None; this is a writing and review standard. |
| **Enforcement Gate** | `npm run test:consistency` plus style-guide review. |

## USE FOR:
- Creating a new SKILL.md file
- Refactoring or reviewing an existing SKILL.md
- Deciding tone, structure, or enforcement style for skills
- Checking whether a skill overlaps an existing OS/domain skill

## DO NOT USE FOR:
- Interviewing intent, drafting, or testing a skill against real prompts (load `<skills-repo-root>/skill-creator/SKILL.md`)
- Routing rules for dynamically generated mid-session skills owned by `self-evolve`
- Non-Harness skill formats outside `harness-everything`

## Core Rules

1. MUST keep frontmatter accurate and the description routeable.
2. MUST include, in order: title, introduction, Skill Contract, usage, and actionable rules.
3. MUST use imperative language and name the enforcing command or gate.
4. MUST avoid overlap with OS-layer routing or domain expertise.
5. For intent interviews, drafting, and prompt tests, load `<skills-repo-root>/skill-creator/SKILL.md`.

Deep dive: `<this-skill-dir>/references/style-guide.md`
