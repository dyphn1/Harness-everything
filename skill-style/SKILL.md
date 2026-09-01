---
name: skill-style
description: Apply Harness style guidelines when writing or refactoring SKILL.md files. Use when creating a new skill, reviewing skill structure, enforcing naming and frontmatter conventions, or standardizing tone, formatting, and progressive disclosure across the skill catalog.
license: Apache-2.0
metadata:
  author: Miya Daniel
  version: 0.3.6
---

# Skill Style (Harness Ecosystem Skill Development Guidelines)

When creating or refactoring a Skill, strictly follow the writing style in this document so all Skills integrate into the `harness-everything` routing system and are mathematically enforced by scripts.

## Skill Contract

| Component | Specification |
| :--- | :--- |
| **Trigger / Input** | Creating, reviewing, or refactoring a Harness `SKILL.md`. |
| **Expected Output** | A concise, structurally complete, non-overlapping `SKILL.md`. |
| **State Mutations** | None; this is a writing and review standard. |
| **Enforcement Gate** | `npm run test:consistency` plus style-guide review. |

## USE FOR:
- Creating a new SKILL.md file
- Refactoring or reviewing an existing SKILL.md
- Deciding tone, structure, or enforcement style for skills
- Checking whether a skill overlaps an existing OS/domain skill

## DO NOT USE FOR:
- Interviewing intent, drafting, or testing a skill against real prompts (load `skill-creator/SKILL.md`)
- Routing rules for dynamically generated mid-session skills owned by `self-evolve`
- Non-Harness skill formats outside `harness-everything`

## Required Structure
Every SKILL.md MUST contain, in order:

1. **Title & Introduction** — state the purpose.
2. **📋 Skill Contract (CRITICAL)** — strict Markdown table: Trigger/Input, Expected Output, State Mutations, Enforcement Gate. Exact shape in Deep dive below.
3. **Triggers / Usage** — when this skill applies.
4. **Core Rules / Action List** — actionable commands tied to terminal scripts; no vague suggestions.

## Tone & Voice
- Anti-prose: no long paragraphs; map actions to specific commands.
- Absolute imperatives: "MUST", "MUST NOT", "ALWAYS" — never "suggest".
- Script-driven enforcement: write "You MUST run `node harness-everything/scripts/verify-gate.js`. If Exit Code 1, you MUST reflect and retry." — never "You should check your code".

Avoid overlap between the OS layer (routes and constrains behavior) and the Domain layer (deep technical expertise).

For the fuller authoring & quality workflow (intent interviewing, drafting, prompt-testing, pruning duplication/no-op/sprawl), load `skill-creator/SKILL.md` instead.

Deep dive: references/style-guide.md
