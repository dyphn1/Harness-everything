---
name: skill-creator
description: Author, audit, and refactor SKILL.md files against one quality bar — the Skill Contract format. Use when creating a new skill, refactoring a SKILL.md, checking overlap, or packaging an insight as a dynamic skill.
license: Apache-2.0
metadata:
  author: Miya Daniel
  version: 0.3.4
---

# Skill Creator

SKILL.md authoring and audit.

## USE FOR:
- Create a skill from scratch
- Audit/refactor a SKILL.md; check overlap between skills
- Packaging a session insight as a dynamic skill (self-evolve)

## DO NOT USE FOR:
- Project docs that are not skills — instead use `repo-docs` / `to-spec`
- Third-party skill installs (find-skills)
- Code style outside SKILL.md files

## Skill Contract

| Component | Specification |
| :--- | :--- |
| **Trigger / Input** | New skill; SKILL.md audit; self-evolve packaging. |
| **Expected Output** | SKILL.md passing the Quality Checklist. |
| **State Mutations** | Writes `<skill>/SKILL.md`; updates registry/generated folder. |
| **Enforcement Gate** | Quality Checklist complete before registering. |

## Authoring Workflow

1. Grep the registry for near-duplicates; the when-to-fire sentence becomes the frontmatter description.
2. Draft the Contract table first (forces the Enforcement Gate), then steps/flat reference; push branch-only detail to references/.
3. A/B-test via `create-agent-launcher` subagents; read both transcripts.
4. Run the Quality Checklist; register (static row quotes the description; dynamic below).

## Dynamic Skill Generation Contract

Only generalizable multi-step procedures or enforcement contracts qualify as skills; simple constraints go to `memories/repo/RULES.md`.

- Location: `.claude/harness-everything/skills/generated/<kebab-case-name>/SKILL.md`
- Frontmatter beyond name/description: triggers (3-6 keywords), metadata type: dynamic, generated, source, status: draft.
- Gate: Quality Checklist first.
- Lifecycle: draft → active after firing on a different task; deprecate rather than silently delete; promote once proven general.

Deep dive: references/{authoring-workflow,dynamic-generation-contract,quality-checklist}.md
