---
description: "Platform guidelines for generating agent scaffolds targeting GitHub Copilot (VS Code). Covers naming, tool declarations, directory layout, and interaction mechanisms."
---

# Platform Guidelines: GitHub Copilot (VS Code)

## Naming Convention

- Agent names are **flexible** — spaces, Chinese characters, and mixed case are allowed.
- Recommended style: Title Case with spaces (e.g., `Requirement Analyzer`, `Backend Developer`).
- File names use kebab-case (e.g., `requirement-analyzer.agent.md`).

## Tools Declaration

Use the VS Code-encapsulated permission names as a YAML array:

```yaml
tools: [read, edit, search, execute]
```

When generating agent files from templates, substitute the placeholders as follows:
- `{{TOOLS_ARRAY_DECLARATION}}`: `tools: [read, edit, search, execute]` (exclude `execute` for Requirement Analyzer)
- `{{READ_TOOL_NAME}}`: `read`
- `{{EDIT_TOOL_NAME}}`: `edit`
- `{{SEARCH_TOOL_NAME}}`: `search`
- `{{EXECUTE_TOOL_NAME}}`: `execute`

## Directory Layout

| Artifact | Path |
|----------|------|
| Agent definitions | `<target_dir>/agents/*.agent.md` |
| Orchestrator instructions | `<target_dir>/instructions/orchestrator.instructions.md` |
| Skill entry point | `<target_dir>/skills/agent-launcher/SKILL.md` |
| System prompt | `.github/copilot-instructions.md` |
| Global config | `~/.config/github-copilot/` |

Default `<target_dir>` is `.github/`.

## User Interaction Mechanism

Use the `vscode_askQuestions` tool to pause the workflow and prompt the user for decisions.

```json
[{
  "header": "unique_key",
  "question": "Your question here?",
  "options": [
    { "label": "Option A", "recommended": true },
    { "label": "Option B" }
  ],
  "allowFreeformInput": true
}]
```

This renders as a dropdown or input box in the VS Code window.

## System Prompt / Instructions File

After generating agents, ensure `.github/copilot-instructions.md` contains the `## 🤖 State Machine Orchestrator Instructions` block. If the file does not exist, create it.

## Agent File Format

Standard `.agent.md` file with YAML frontmatter:

```yaml
---
name: "Requirement Analyzer"
description: "Use when: ..."
tools: [read, edit, search]
---
```

All files MUST include a YAML frontmatter `description` field for context optimization.
