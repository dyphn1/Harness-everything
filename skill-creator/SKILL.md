---
name: skill-creator
description: Author, audit, and refactor SKILL.md files against one quality bar — the Skill Contract format. Use when creating a new skill, refactoring a SKILL.md, checking overlap, or packaging an insight as a dynamic skill.
license: Apache-2.0
metadata:
  author: Miya Daniel
  version: 0.3.6
---

# Skill Creator

SKILL.md authoring and audit.

## USE FOR:
- Create a skill from scratch
- Audit/refactor a SKILL.md; check overlap between skills
- Packaging a session insight as a dynamic skill

## DO NOT USE FOR:
- Non-skill project docs — use `repo-docs`/`to-spec`
- Third-party skill installs (find-skills)
- Code style outside SKILL.md files

## Skill Contract

| Component | Specification |
| :--- | :--- |
| **Trigger / Input** | New skill; SKILL.md audit; self-evolve packaging. |
| **Expected Output** | SKILL.md passing the Quality Checklist. |
| **State Mutations** | Writes `<skill>/SKILL.md`; updates registry/generated folder. |
| **Enforcement Gate** | Quality Checklist before registering, incl. USE FOR/DO NOT USE FOR (`<skills-repo-root>/ci/consistency-check.js`). |

## Authoring Workflow

1. Grep the registry for near-duplicates; the when-to-fire sentence becomes the description.
2. Draft the Contract table first (forces the Enforcement Gate), then `## USE FOR:`/`## DO NOT USE FOR:`, then steps/flat reference; push branch-only detail to references/.
3. A/B-test via `multi-agent-workspace` subagents; read both transcripts.
4. Run the Quality Checklist; register (static quotes the description; dynamic below).

## Dynamic Skill Generation Contract

Only generalizable procedures/enforcement contracts qualify; simple constraints go to `memories/repo/RULES.md`.

- Location: `.claude/harness-everything/skills/generated/<kebab-case-name>/SKILL.md`
- Frontmatter: triggers (3-6 keywords), metadata type/generated/source/status: draft.
- Gate: Quality Checklist first.
- Lifecycle: draft → active after firing elsewhere; deprecate, don't delete; promote once proven general.

Deep dive: references/*.md
