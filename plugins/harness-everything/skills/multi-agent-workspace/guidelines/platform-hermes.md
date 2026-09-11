---
description: "Platform guidelines for generating agent scaffolds targeting Hermes Agent (Nous Research). Covers naming, tool declarations, directory layout, and interaction mechanisms."
---

# Platform Guidelines: Hermes Agent (Nous Research)

## Naming Convention

- Uses `.hermes.md` project-level context file or standard markdown rules files.

## Tools Declaration

Hermes Agent auto-detects CLI capabilities. Use standard tool declarations:

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
| Native Context | `.hermes.md` (project root) |
| Fallback Context | Reads `AGENTS.md` / `CLAUDE.md` / `.cursorrules` if present |

Default target directory is project root (`.hermes.md`).

## User Interaction & Enforcement Mechanism

Hermes Agent loads `.hermes.md` into session context. Like other non-hook platforms, enforcement is **Advisory Only**.
Interactions and question prompting happen in the Hermes terminal or web UI session.
