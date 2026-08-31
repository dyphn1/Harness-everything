---
description: "Platform guidelines for generating agent scaffolds targeting Codex / Custom API environments. Covers naming, OpenAI Tool Spec / JSON Schema format, directory layout, and custom ask_user function calling."
---

# Platform Guidelines: Codex / Custom API Environment

## Naming Convention

- Follow system variable / key-value naming conventions (e.g., `requirement_analyzer`, `backend_developer`).
- Use lowercase with underscores or hyphens; avoid spaces.
- Names serve as JSON object keys — they must be valid identifiers in most languages.

## Tools Declaration

There are **no built-in tools**. All tools must be defined using the **OpenAI Tool Spec (JSON Schema)** format and implemented in your local orchestrator code.

When generating agent files from templates (if not using pure JSON), substitute the placeholders as follows:
- `{{TOOLS_ARRAY_DECLARATION}}`: *(Leave empty in Markdown, handled via JSON configuration)*
- `{{READ_TOOL_NAME}}`: `read_file`
- `{{EDIT_TOOL_NAME}}`: `write_file`
- `{{SEARCH_TOOL_NAME}}`: `search`
- `{{EXECUTE_TOOL_NAME}}`: `execute_command`

Each agent definition includes a `tools` array of JSON Schema objects:

```json
{
  "agents": {
    "requirement_analyzer": {
      "name": "requirement_analyzer",
      "description": "Analyzes user requirements and creates implementation documents.",
      "tools": [
        {
          "type": "function",
          "function": {
            "name": "read_file",
            "description": "Read a file from the project.",
            "parameters": {
              "type": "object",
              "properties": {
                "path": { "type": "string", "description": "File path to read." }
              },
              "required": ["path"]
            }
          }
        },
        {
          "type": "function",
          "function": {
            "name": "ask_user",
            "description": "Pause the agent loop and ask the user a question.",
            "parameters": {
              "type": "object",
              "properties": {
                "question": { "type": "string" },
                "options": {
                  "type": "array",
                  "items": { "type": "string" }
                }
              },
              "required": ["question"]
            }
          }
        }
      ]
    }
  }
}
```

## Directory Layout

All paths are **custom** — defined by the local orchestrator implementation:

| Artifact | Suggested Path |
|----------|---------------|
| Agent definitions | `config/agents/*.json` or `config/agents.json` |
| System prompt | `config/system_prompt.txt` |
| Tool schemas | `config/tools/*.json` |
| Global config | `~/.config/myapp/` or as defined by your app |

Default target directory is `config/`.

## User Interaction Mechanism

There is **no built-in confirmation mechanism**. Implement a custom `ask_user` function tool that follows the OpenAI Function Calling / Tool Use pattern:

1. The agent calls `ask_user` with a `question` and optional `options`.
2. The API returns the function call in its response.
3. Your **local orchestrator code** intercepts the call, renders the UI (terminal prompt, web form, etc.), and submits the user's answer back as a tool result.
4. The agent resumes execution.

The `ask_user` schema should mirror `vscode_askQuestions` for portability:

```json
{
  "type": "function",
  "function": {
    "name": "ask_user",
    "description": "Ask the user a question and wait for their response before continuing.",
    "parameters": {
      "type": "object",
      "properties": {
        "header": { "type": "string", "description": "Short identifier for the question." },
        "question": { "type": "string", "description": "The question to ask." },
        "options": {
          "type": "array",
          "items": {
            "type": "object",
            "properties": {
              "label": { "type": "string" },
              "recommended": { "type": "boolean" }
            },
            "required": ["label"]
          }
        },
        "allowFreeformInput": { "type": "boolean", "default": true }
      },
      "required": ["header", "question"]
    }
  }
}
```

## System Prompt / Instructions File

The system prompt format is fully custom. Suggested location: `config/system_prompt.txt` or `config/system_prompt.md`. Include the orchestrator rules adapted for your API loop implementation.

## Agent File Format

Agent definitions are typically JSON objects:

```json
{
  "name": "requirement_analyzer",
  "description": "Analyzes requirements and creates implementation documents.",
  "system_prompt": "You are an expert AI Architect...",
  "tools": ["read_file", "edit_file", "ask_user"],
  "constraints": [
    "DO NOT implement features yourself.",
    "ALWAYS create a structured implementation document first."
  ]
}
```

Implement `read_file`, `edit_file`, and all other tools referenced in `tools` arrays in your orchestrator's backend code.
