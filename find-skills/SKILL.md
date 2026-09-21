---
name: find-skills
description: Search the agent-skills ecosystem (skills.sh / npx skills) when no installed skill fits; verify quality, apply ephemerally via temp cache by default, and install permanently via npx skills add only with explicit user approval 
license: Apache-2.0
metadata:
  author: Miya Daniel
  version: 0.19.1
---

# Find Skills

## Skill Contract

| Component | Contract |
| :--- | :--- |
| **Input** | No installed skill fits, or user asks to find one. |
| **Output** | Vetted skill pointer, approved application, or fallback. |
| **State** | Temp cache by default; permanent install is opt-in. |
| **Gate** | Third-party fetch/apply/install requires explicit approval. |

## Workflow

1. Check local coverage first: `npx skills list --json` and `npx skills list -g --json`.
2. If uncovered, search skills.sh / `npx skills find [query] [--owner <owner>]`.
3. Official/1K+ sources **SHOULD** rank first; **MUST** read the unaudited `SKILL.md`.
4. Present name/source/count; **MUST** get explicit approval before fetching or applying third-party code.
5. Ephemeral use is default: `node "<this-skill-dir>/scripts/use-skill.js" <owner/repo[@skill]>`. Treat its output as binding for this request.
6. Permanent install **MUST** be explicitly requested: `npx skills add <owner/repo[@skill]> --agent <agent> [-g] -y`.
7. No match: help directly; `npx skills init <name>` **MAY** be suggested for recurring needs.

## USE FOR:
- external skill discovery/vetting
- approved ephemeral use

## DO NOT USE FOR:
- skill authoring (`skill-creator`)
- unapproved third-party application/install

Deep dive: <this-skill-dir>/references/discovery-flow.md
