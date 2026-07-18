---
name: "skills-agents-template"
description: "AGENTS.md template acting as a Meta-Authoring Guide for AI agents working within a single-skill or multi-skills repository. Enforces structure, frontmatter schemas, and extension rules."
---

# {Project Name} - AI Authoring Guide

> This repository hosts AI skills. This document serves as a Meta-Authoring Guide, dictating how AI agents should scaffold, modify, or extend these skills without breaking the project's structure.

## Directory Structure & Taxonomy

Respect the semantic boundaries of the following directories:

| Directory | Purpose / Rules |
|---|---|
| `{skills_dir}/` | **(For Multi-Skills only)** Every skill MUST live in its own dedicated subfolder under a specific category (e.g., `skills/engineering/new-skill/`). Do not place `SKILL.md` directly in the root of `skills/`. |
| `examples/` | Supplementary markdown files providing few-shot examples or expected outputs for the agent. **Do not put executable code here.** |
| `guidelines/` | Rules or boundaries that constrain the AI's behavior when executing the skill. |
| `scripts/` | Utility scripts for linting, testing, or packing the skills. |

## How to Extend (Scaffolding a New Skill)

When asked by the user to create or add a new skill to this repository, you **MUST strictly follow this procedure**:

### 1. Determine Location
- **Single-Skill Repo**: You are likely modifying the root `SKILL.md`.
- **Multi-Skills Repo**: Choose an existing category folder (e.g., `engineering/` or `productivity/`) and create a new kebab-case folder for the skill: `mkdir skills/{category}/{new-skill-name}`.

### 2. Write `SKILL.md`
Generate the core file. It MUST include:
- A YAML frontmatter block (see schema below).
- A `## Core Rules` or `## Constraints` section.
- A `## Workflow` section detailing the exact execution steps.

### 3. Provide Resources (Optional but Recommended)
If the skill is complex, do not stuff everything into `SKILL.md`. 
- Create an `examples/{scenario}.md` file to show what good output looks like.
- Reference this file in the `SKILL.md` prompt.

### 4. Post-processing
If the repository contains an index-generation script (e.g., `scripts/list-skills.sh` or `scripts/link-skills.sh`), execute it after saving your files to ensure the README remains up to date.

---

## Frontmatter Schema

Every `SKILL.md` MUST begin with this exact YAML structure:

```yaml
---
name: "{skill-name}"       # Must be kebab-case, matching the folder name (if applicable).
description: >             # A 1-2 sentence description including the trigger phrase or exact use case.
  Use when ...
---
```

## Constraints & Gotchas

- **Variables**: Never use single braces `{}` for variables in prompts, as they might conflict with code snippets. Always use double braces `{{VARIABLE}}`.
- **Formatting**: Keep instructions terse and directive. Use bullet points and bold text for emphasis. Do not use marketing language.
