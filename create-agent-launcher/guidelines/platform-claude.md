---
description: "Platform guidelines for generating agent scaffolds targeting Claude Code (Anthropic CLI). Covers naming, tool declarations, directory layout, and interaction mechanisms."
---

# Platform Guidelines: Claude Code (Anthropic CLI)

## Naming Convention

- Agent names must use **lowercase with hyphens** (e.g., `requirement-analyzer`, `backend-developer`).
- No spaces allowed in agent names or identifiers.
- File names follow the same convention (e.g., `requirement-analyzer.md`).

## Tools Declaration

Use Claude Code's exact tool name strings as a YAML array:

```yaml
tools: ["Read", "Edit", "Glob", "Grep", "Bash", "AskUserQuestion"]
```

When generating agent files from templates, substitute the placeholders as follows:
- `{{TOOLS_ARRAY_DECLARATION}}`: `tools: ["Read", "Edit", "Glob", "Grep", "Bash", "AskUserQuestion"]` (exclude `"Bash"` for Requirement Analyzer)
- `{{READ_TOOL_NAME}}`: `"Read"`
- `{{EDIT_TOOL_NAME}}`: `"Edit"`
- `{{SEARCH_TOOL_NAME}}`: `"Glob" and "Grep"`
- `{{EXECUTE_TOOL_NAME}}`: `"Bash"`

> **CRITICAL RULE — AskUserQuestion is MANDATORY**: When generating a **restricted** tool list (i.e., any list that does not include all tools), you MUST always include `"AskUserQuestion"` in the array. If this tool is omitted, the agent will lose the ability to ask clarifying questions and will enter a **deadlock state** — unable to proceed or request help.

## Directory Layout

| Artifact | Path |
|----------|------|
| Agent definitions | `.claude/agents/*.md` |
| Output styles | `.claude/output-styles/` |
| System prompt | `CLAUDE.md` (project root) |
| Global config | `~/.claude/output-styles/` |

Default target directory is `.claude/`.

## User Interaction Mechanism

Use the built-in `AskUserQuestion` tool to pause the agent loop and prompt the user:

```
AskUserQuestion(
  question: "Where should the agent scaffold be created?",
  options: [".claude/ (default)", "Custom path"]
)
```

This renders as an interactive prompt in the CLI terminal, blocking execution until the user responds.

## System Prompt / Instructions File

After generating agents, ensure `CLAUDE.md` at the project root contains the orchestrator rules. If `CLAUDE.md` does not exist, create it with the State Machine block.

## Agent File Format

Plain Markdown files under `.claude/agents/`:

```markdown
# requirement-analyzer

**Role**: Requirement Analyzer  
**Tools**: Read, Edit, Glob, Grep, AskUserQuestion

You are an expert AI Architect...

## Constraints
...

## Approach
...
```

YAML frontmatter is optional in Claude agents; use a `# heading` and `**field**:` pattern instead if preferred.
