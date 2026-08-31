---
description: "Platform guidelines for generating agent scaffolds targeting Continue.dev. Covers naming, tool declarations, directory layout, and interaction mechanisms."
---

# Platform Guidelines: Continue.dev

## Naming Convention

- Rule files use kebab-case (e.g., `harness.md`, `backend-developer.md`).

## Tools Declaration

Continue manages tool execution permissions at the extension level. Use standard intent names:

```yaml
tools: [read, edit, search, execute]
```

When generating agent files from templates, substitute the placeholders as follows:
- `{{TOOLS_ARRAY_DECLARATION}}`: `tools: [read, edit, search, execute]`
- `{{READ_TOOL_NAME}}`: `read`
- `{{EDIT_TOOL_NAME}}`: `edit`
- `{{SEARCH_TOOL_NAME}}`: `search`
- `{{EXECUTE_TOOL_NAME}}`: `execute`

## Directory Layout

| Artifact | Path |
|----------|------|
| Native Project Rules | `.continue/rules/*.md` (project) / `~/.continue/rules/*.md` (global) |
| System Prompt | `.continue/rules/harness.md` (with YAML frontmatter `alwaysApply: true`) |

Default target directory is `.continue/rules/`.

## User Interaction & Enforcement Mechanism

Continue.dev does not provide lifecycle execution hooks. Rules are loaded with `alwaysApply: true` frontmatter and act as **Advisory Guidance**.
Ask clarifying questions directly within the Continue Chat interface.
