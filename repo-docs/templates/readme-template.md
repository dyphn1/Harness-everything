---
name: "readme-template"
description: "Canonical README.md template with archetype-aware section selection."
---

# README.md Template

Use this as a structural guide. Omit sections gracefully when info isn't available.
Write in prose — avoid excessive bullets.

---

## Archetype-Aware Section Selection

Choose the section set that matches the repository archetype (from Step 0 of the skill
workflow). Never leave empty section headings — skip sections that don't apply.

| Archetype | Include | Skip |
|---|---|---|
| **`code`** | All sections in the full template below | — |
| **`product`** | See [`product-readme-template.md`](product-readme-template.md) for full layout (Overview, Getting Started, Workflow, FAQ, etc.) | Build, Test, Debugging, Packaging (moved to AGENTS.md) |
| **`single-skill`**| See [`single-skill-readme-template.md`](single-skill-readme-template.md) for full layout (Usage, Workflow, Constraints, Resources) | Installation, Build, Test, Debugging |
| **`multi-skills`**| See [`multi-skills-readme-template.md`](multi-skills-readme-template.md) for full layout (Philosophy, Categorized Directory, Workflows) | Installation, Build, Test, Debugging, Packaging |
| **`courseware`** | Title, Overview, Course Structure, Prerequisites, How to Run Exercises, Contributing, License | Build, Debugging, Packaging |
| **`docs`** | Title, Overview, Documentation Structure, How to Contribute Docs, Build / Publish (if applicable), License | Test, Debugging, Packaging |
| **`hybrid`** | Combine applicable columns; add a "What's in this Repo" orientation section first | Empty sections |

### Non-code section templates

**Skills Index** — for `skills` repos:
```markdown
## Skills

| Name | Description |
|---|---|
| `{skill_name}` | {description from frontmatter} |
```

**Course Structure** — for `courseware` repos:
```markdown
## Course Structure

| Section | Exercises |
|---|---|
| `{XX}-{section-name}` | {exercise names} |
```

**Documentation Structure** — for `docs` repos:
```markdown
## Documentation Structure

{abbreviated page tree — top-level sections with one-line descriptions}
```

---

## Full Template (code archetype)

```markdown
# {project_name}

> {one_line_description}

<!-- Optional: badges for language, license, CI status -->
[![License](https://img.shields.io/badge/License-Apache_2.0-blue.svg)](LICENSE)

## Overview

{2–4 sentences explaining what the project does, who it's for, and what problem
it solves. Write this as a human would, not a spec sheet.}

## Prerequisites

- {Runtime}: {version} (e.g., Node.js ≥ 20, Python ≥ 3.11)
- {Any other hard requirements}

## Installation

```bash
{package_manager} install
# or: pip install -e .
```

## Usage

```bash
{primary run command}
```

{One-paragraph description of basic usage, or a short example if helpful.}

## Project Structure

```
{abbreviated tree — top-level dirs only, one-line description each}
```

## Development

### Running tests

```bash
{test command}
```

### Linting & formatting

```bash
{lint command}
{format command}
```

### Building

```bash
{build command}
```

## Contributing

{Brief note or link to CONTRIBUTING.md. One or two sentences is enough.}

## License

{License name} — see [LICENSE](LICENSE) for details.
```

---

## Style notes

- Use `##` for top-level sections (not `#`)
- Code blocks must specify language: ` ```bash `, ` ```ts `, etc.
- Don't add sections you can't populate — an empty section is worse than no section
- Keep the Overview honest — don't oversell
- Version numbers must match what's in the config files exactly
