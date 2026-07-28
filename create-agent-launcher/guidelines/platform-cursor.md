---
description: "Platform guidelines for generating agent scaffolds targeting Cursor. Covers naming, tool declarations, directory layout, and interaction mechanisms."
---

# Platform Guidelines: Cursor

## Naming Convention

- Agent/Rule names use lower-kebab-case (e.g., `requirement-analyzer`, `backend-developer`).
- File names follow `.cursorrules` or `.cursor/rules/*.mdc` depending on project structure.

## Tools Declaration

Cursor manages tool permissions natively through its IDE setting UI. Use standard tool intent categories:

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
| Native Project Rules | `.cursorrules` (project root) |
| Modular Rule Definitions | `.cursor/rules/*.mdc` |
| System Prompt | `.cursorrules` |

Default target directory is `.cursor/`.

## User Interaction & Enforcement Mechanism

Cursor does not provide lifecycle hooks or exit code interception. All rule files operate as **Advisory Context** injected into the model prompt.
Ask questions directly in chat or request user confirmation before major file modifications.
