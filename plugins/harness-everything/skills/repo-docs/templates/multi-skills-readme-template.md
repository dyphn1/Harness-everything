---
name: "multi-skills-readme-template"
description: "README template for a repository hosting a collection of AI skills. Focuses on design philosophy, quickstart, and categorized skills with workflow dependencies."
---

# {Project Name / Skill Collection}

> {One-line pitch: E.g., A collection of composable, engineering-focused AI skills.}

<!-- Optional: Badges for version, license, status -->
[![License](https://img.shields.io/badge/License-Apache_2.0-blue.svg)](LICENSE)

## Overview & Philosophy

{2–3 paragraphs explaining *why* this collection exists. What common AI coding failures (e.g., verbosity, architectural rot, misalignment) does this pack solve? Explain the design principles behind these skills.}

---

## Quickstart

{How to install or activate the entire pack of skills in the user's environment. E.g., `npx skills@latest add ...` or cloning the repo.}

```bash
{installation command}
```

---

## Core Problem Statements & Solutions

{Identify 2-3 common failure modes when working with AI, and highlight which skills in this repository solve them.}

### Problem: {e.g., The Agent Didn't Do What I Want}
**The Fix**: Use `/{skill-name}` to {briefly describe the solution workflow}.

---

## Skills Directory

{List the skills grouped by their categories. For each category, emphasize workflow dependencies or sequential requirements.}

### {Category 1: e.g., Engineering}

{1-2 sentences summarizing what this category of skills does.}

> **Workflow & Dependencies**:
> - **Required Setup**: {e.g., Run `/setup-project` before using any other skills in this category.}
> - **Suggested Flow**: {e.g., Use `/to-prd` to design -> `/to-issues` to split tasks -> `/tdd` to implement.}

| Skill | Description | Link |
|---|---|---|
| `{skill-name}` | {Description from YAML frontmatter} | [View Skill](./skills/category/{skill-name}/SKILL.md) |
| `{skill-name-2}` | {Description from YAML frontmatter} | [View Skill](./skills/category/{skill-name-2}/SKILL.md) |

### {Category 2: e.g., Productivity}

{1-2 sentences summarizing what this category of skills does.}

| Skill | Description | Link |
|---|---|---|
| `{skill-name}` | {Description from YAML frontmatter} | [View Skill](./skills/category/{skill-name}/SKILL.md) |

---

## Contributing & Authoring

Want to add a new skill to this repository? 
{Provide brief instructions or link to a `/write-a-skill` guideline.}

## License

Apache 2.0 — see [LICENSE](LICENSE) for details.
