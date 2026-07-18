---
description: "Platform guidelines for generating agent scaffolds targeting Gemini (Google). Covers strict naming rules, tool declarations via config.yaml, directory layout, and interaction mechanisms."
---

# Platform Guidelines: Gemini (Google)

## Naming Convention

> **STRICT RULE — Naming validation regex**: `^[a-zA-Z0-9_-]{1,64}$`

- **No spaces allowed.** Any space in an agent name will cause a **parse error**.
- **No Chinese or special characters** — only letters, digits, underscores, and hyphens.
- Use `snake_case` or `kebab-case` (e.g., `requirement_analyzer`, `backend-developer`).
- Maximum 64 characters.

| ❌ Invalid | ✅ Valid |
|-----------|---------|
| `Requirement Analyzer` | `requirement_analyzer` |
| `Backend Developer` | `backend-developer` |
| `Task Verifier` | `task_verifier` |

## Tools Declaration

Tools are declared in `.gemini/config.yaml`, not directly in agent files. Gemini supports MCP (Model Context Protocol) tool servers.

When generating agent files from templates, substitute the placeholders as follows:
- `{{TOOLS_ARRAY_DECLARATION}}`: *(Leave completely empty. Do not write `tools: []`)*
- `{{READ_TOOL_NAME}}`: `read_file`
- `{{EDIT_TOOL_NAME}}`: `edit_file`
- `{{SEARCH_TOOL_NAME}}`: `search_codebase`
- `{{EXECUTE_TOOL_NAME}}`: `run_in_terminal`

```yaml
# .gemini/config.yaml
tools:
  - name: read_file
    type: builtin
  - name: edit_file
    type: builtin
  - name: search_codebase
    type: builtin
  - name: my_mcp_server
    type: mcp
    server: "npx -y @my-org/mcp-server"
```

Note: Code modification tools (like `edit_file`) are subject to Google's safety review layer.

## Directory Layout

| Artifact | Path |
|----------|------|
| Agent definitions | `.gemini/agents/*.md` |
| Tool config | `.gemini/config.yaml` |
| System prompt / style guide | `.gemini/styleguide.md` |
| Global config | `~/.config/google-gemini/` |

Default target directory is `.gemini/`.

## User Interaction Mechanism

Gemini uses a built-in **block/confirmation mechanism** that pauses agent execution in the IDE Chat or terminal until the user responds.

When making a workflow decision, output a clearly structured question block and wait for the user reply before proceeding:

```
[CONFIRMATION REQUIRED]
Question: Which AI platform are you targeting?
Options:
  1. GitHub Copilot (VS Code)
  2. Claude Code (Anthropic CLI)
  3. Gemini (Google)
  4. Codex / Custom API
Please reply with the option number or your answer.
```

Do not proceed with file generation until the user has responded.

## System Prompt / Instructions File

After generating agents, ensure `.gemini/styleguide.md` contains the orchestrator rules and `.gemini/config.yaml` exists with tool declarations.

## Agent File Format

Markdown files under `.gemini/agents/`, using snake_case filenames:

```markdown
# requirement_analyzer

**Role**: Requirement Analyzer

You are an expert AI Architect...

## Constraints
...

## Approach
...
```

Combine with `.gemini/config.yaml` entries to declare which tools each conceptual agent can use.
