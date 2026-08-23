---
name: find-skills
description: Search the agent-skills ecosystem (skills.sh / npx skills) when no installed skill fits; verify quality, apply ephemerally via temp cache by default, and install permanently via npx skills add only with explicit user approval 
license: Apache-2.0
metadata:
  author: Miya Daniel | Harness Core Team
  version: 0.3.3
---

# Find Skills (External Skill Discovery)

## 📋 Skill Contract

| Component | Specification |
| :--- | :--- |
| **Trigger / Input** | Request to find an external skill. |
| **Expected Output** | Skill pointer, applied skill, or fallback. |
| **State Mutations** | Temp cache (default); native install opt-in. |
| **Enforcement Gate** | Local first; explicit approval required before applying third-party code; graceful npx failure. |

## Workflow

0. Check local coverage (router registry, `generated[]`) before live installs:
```bash
npx skills list --json          # project scope
npx skills list -g --json       # global scope
```
1. Identify domain/task, check [skills.sh](https://skills.sh/), then search `npx skills find [query] [--owner <owner>]`.
2. Verify: prefer 1K+ installs, official sources; read the unaudited SKILL.md.
3. Present name/source/count; NEVER fetch/apply without explicit approval.
4. Apply ephemerally (default, zero footprint):
```bash
node "<this-skill-dir>/scripts/use-skill.js" <owner/repo[@skill]>
```
Apply the output; OS-temp cache (6h); nothing written to repo or manifest.json.
5. Permanent install ONLY when the user says they will reuse it: `npx skills add <owner/repo[@skill]> --agent <agent> [-g] -y`
6. Nothing exists? Help directly; suggest `npx skills init <name>` if recurring.

Deep dive: references/discovery-flow.md

## USE FOR:
- finding an external skill when none installed fits
- vetting third-party skills before applying them
- ephemeral skill use without permanent installs

## DO NOT USE FOR:
- authoring skills (`skill-creator`)
- installing anything without explicit user approval
