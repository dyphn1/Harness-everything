# build-multi-agent-system - AI Authoring Guide

> This repository hosts a single, complex AI skill designed to deploy a multi-agent architecture. This document serves as a Meta-Authoring Guide, dictating how AI agents should interact with, modify, or extend this skill without breaking its core rules.

## Directory Structure & Taxonomy

Respect the semantic boundaries of this repository:

| Directory/File | Purpose / Rules |
|---|---|
| `SKILL.md` | The core AI instruction file. Contains the environment audit, scaffolding rules, memory implementation, and router logic. |
| `LICENSE` | The open-source license. Do not modify. |

## How to Extend (Modifying the Skill)

When asked by the user to update or extend the `build-multi-agent-system` skill, you **MUST strictly follow this procedure**:

### 1. Locate and Read
- Read the root `SKILL.md` to understand the existing execution pipeline, phase logic, and strict constraints.
- Understand the "6 Functional Zones" and the "Bootstrap Protocol".

### 2. Modify `SKILL.md`
When updating the file, it MUST retain:
- The YAML frontmatter block containing the `name` and `description`.
- The `## Core Principles` section enforcing the cognitive loop (Think > Try > Summarize > Record).
- The `## [State Checkpoint]` validating the working directory.
- Sequential workflow phases (`[Discovery Phase...]`, `[Execution Phase...]`, `[Verification Phase]`).

### 3. Provide Resources
If adding complex features (e.g., a new fallback memory indexer script language), avoid bloating `SKILL.md`. Consider introducing an `examples/` directory to store reference code, though prefer keeping the core logic concise.

---

## Frontmatter Schema

The `SKILL.md` MUST always begin with this exact YAML structure:

```yaml
---
name: "build-multi-agent-system"
description: >
  Deploy a universal, self-adapting Multi-Agent Architecture into any project. It dynamically analyzes the tech stack to scaffold a token-efficient workspace with strict physical boundaries, hybrid SQLite memory, and isomorphic alignment protocols.
---
```

## Constraints & Gotchas

- **Cognitive Loop Integrity**: Any new steps added to the skill must align with the Think > Try > Summarize > Record methodology.
- **Isomorphism**: When adding tech-stack-specific scaffolding logic, do not break support for general repositories. The skill must remain polyglot.
- **Variables**: Never use single braces `{}` for variables in prompts; use double braces `{{VARIABLE}}`. Keep instructions terse and directive.
