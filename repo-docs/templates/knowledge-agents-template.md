---
name: "knowledge-agents-template"
description: "Dynamic AGENTS.md template for documentation, knowledge bases, and courseware. Uses conditional {{IF feature}} blocks based on detected capabilities to provide either basic editing rules or strict agentic workflows."
---

# {Project Name} - AI Authoring & Operations Guide

> This document serves as the machine-readable instruction manual for AI agents operating within this documentation/knowledge repository.

## Editing Rules & Formatting

When tasked with generating or modifying content in this repository, strictly adhere to the following rules:

- **Style conventions**: {e.g., Use H2 and H3 for sub-sections. Do not use H1 except for the main title.}
- **Language & Tone**: {e.g., Professional and academic. If the repo is multi-lingual, ensure you modify the correct file.}
- **Structural Integrity**: This repository relies on a specific sequence (e.g., numbered prefixes like `01-`, `02-`). **Do not rename or reorder files** unless explicitly instructed to reorganize the curriculum.

---

{{IF is_agentic_workspace}}
## Agentic Operations & Workflows

This repository is an active Agentic Workspace. You must interact with the established agent ecosystem correctly.

### Workflow & Task Management
- **Task Intake**: New tasks are generally found in `tasks/backlog.json` or as markdown specs in `tasks/specs/`.
- **State Management**: When beginning a task, move it or track its state in the `tasks/active/` directory. Upon completion, log the result in `tasks/completed/`.
- **Logging**: All major generation runs must be documented. Create a timestamped folder in `logs/runs/{timestamp}/` detailing the input prompt, token usage, and output summary.

### Inter-Agent Collaboration
Do not attempt to perform tasks assigned to resident sub-agents.
- If content needs verification, defer to the existing `quality-validator.agent.md` or `fact-check-scout.agent.md`.
- Review the `.github/agents/` folder to understand your peers' capabilities before executing complex multi-step generations.
{{ENDIF}}

---

{{IF has_task_tracking}}
## Status Updates

If you make significant additions to the knowledge base:
- You **MUST** update `STATUS.md` or the corresponding `backlog` file to reflect the completion of the topic.
{{ENDIF}}

---

## Do Not Edit

- `{Generated index files, e.g., _sidebar.md}` (Managed by {tool, e.g., Docsify})
- `logs/runs/` (Append-only. Never modify historical logs.)
