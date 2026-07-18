---
name: "knowledge-readme-template"
description: "Dynamic README template for documentation, knowledge bases, and courseware. Uses conditional {{IF feature}} blocks based on detected repository capabilities (e.g., learning paths, agentic workspaces)."
---

# {Project Name}

> {One-line description summarizing the core subject or purpose of this knowledge base.}

<!-- Optional: badges for version, license, or status -->
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

## Overview & Scope

{2–4 sentences explaining what this repository covers, who it is for, and how the information is structured. Be specific about the domain (e.g., "This repository contains the architectural analysis of OpenClaw...").}

---

{{IF has_learning_path}}
## Start Here / Learning Path

{Provide a brief guide on how a reader should navigate this repository based on the detected `roadmap.md`, `study-guide.md`, or sequential file naming.}

- **[Step 1 Title](./path/to/file.md)**: {Brief description}
- **[Step 2 Title](./path/to/file.md)**: {Brief description}
{{ENDIF}}

---

## Knowledge Directory

{Organize the discovered markdown directories into thematic groups. Do not just print a raw file tree. Group them logically.}

### 📂 {Thematic Group 1: e.g., Core Subsystems}
{1 sentence describing what's in this group.}
- [`{dir_name}/`](./path/) - {Brief description based on contents}
- [`{dir_name}/`](./path/) - {Brief description based on contents}

### 📚 {Thematic Group 2: e.g., Reference Materials}
{1 sentence describing what's in this group.}
- [`{dir_name}/`](./path/) - {Brief description}

---

{{IF is_agentic_workspace}}
## AI Agent Workspace

This repository is an **Agentic Workspace**. It is actively managed and interacted with by AI agents, not just human readers.

### Active Agents
{List the detected agents from `.github/agents/` or `AGENTS.md`.}
- **`{Agent Name}`**: {Briefly describe what this agent does based on its file name/content.}

### Agent Workflows
{Briefly explain how humans interact with the agents in this repo. E.g., "Add a task to `tasks/backlog.json` and the Orchestrator will assign it to a sub-agent. Check `logs/` for execution results."}
{{ENDIF}}

---

{{IF has_task_tracking}}
## Project Status & Tasks

{Describe how progress is tracked in this repository based on `STATUS.md`, `tasks/`, or backlog files.}

- **Current Status**: {Extract key point from STATUS.md if available, else omit}
- **Task Board**: Found in [`tasks/`](./tasks/).
{{ENDIF}}

---

{{PRESERVED_HUMAN_CONTENT}}
<!-- AI AGENT INSTRUCTION: If the original README contained domain-specific teaching materials, tutorials, long-form explanations, or extensive deep-dive sections (e.g., "Performance vs Scalability", "System Architecture", etc.), they MUST be preserved here. Do not discard instructional prose! -->

---

## Contributing

Want to contribute to this knowledge base?
{If `is_agentic_workspace` is true, remind users to check `AGENTS.md` before making massive structural changes. If false, just provide a standard PR message.}

## License

{License name} — see [LICENSE](LICENSE) for details.
