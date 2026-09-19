---
name: skill-creator
description: Author, audit, and refactor SKILL.md files against one quality bar — the Skill Contract format. Use when creating a new skill, refactoring a SKILL.md, checking overlap, or packaging an insight as a dynamic skill.
license: Apache-2.0
metadata:
  author: Miya Daniel
  version: 0.4.0
---

# Skill Creator

## USE FOR:
- Create a skill from scratch.
- Audit/refactor SKILL.md or check overlap.
- Package a reusable session insight as a dynamic skill.

## DO NOT USE FOR:
- Non-skill project docs — use `repo-docs`/`to-spec`.
- Third-party skill installs — use `find-skills`.
- Code style outside SKILL.md files.

## Skill Contract

| Component | Specification |
| :--- | :--- |
| **Trigger / Input** | New skill, SKILL.md audit, or self-evolve packaging. |
| **Expected Output** | SKILL.md passing the Quality Checklist. |
| **State Mutations** | Writes the skill and updates its registry/generated location. |
| **Enforcement Gate** | Quality Checklist plus `<skills-repo-root>/ci/consistency-check.js`. |

## Authoring Workflow

1. Check the registry for near-duplicates; make the when-to-fire sentence the description.
2. Draft the Contract table, `USE FOR`/`DO NOT USE FOR`, then concise steps; move branch-only detail to references.
3. A/B-test with bounded `multi-agent-workspace` workers and inspect both transcripts.
4. Run the Quality Checklist before registering or generating the skill.

Dynamic skills are only for generalizable procedures or enforcement contracts; simple constraints belong in `<workspace>/memories/repo/RULES.md`. New dynamic skills start as draft under `<workspace>/.claude/harness-everything/skills/generated/` and follow the lifecycle in the generation contract.

Deep dive: <this-skill-dir>/references/quality-checklist.md
Deep dive: <this-skill-dir>/references/authoring-workflow.md
Deep dive: <this-skill-dir>/references/testing-workflow.md
Deep dive: <this-skill-dir>/references/quality-principles.md
Deep dive: <this-skill-dir>/references/dynamic-generation-contract.md
