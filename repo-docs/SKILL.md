---
name: repo-docs
description: Automatically generates precise, reader-oriented README.md and AGENTS.md based on actual project scans.
---

# Repo Docs (Automated Project Documentation Generation)

## 📋 Skill Contract

| Component | Specification |
| :--- | :--- |
| **Trigger / Input** | Project lacks documentation, or the user requests a `README.md` / `AGENTS.md` / architectural guideline be generated. |
| **Expected Output** | A reader-journey-oriented `README.md` and/or agent-oriented `AGENTS.md`, built from the appropriate template in `repo-docs/templates/`. |
| **State Mutations** | Creates/overwrites `README.md`, `AGENTS.md`, or other doc files at the target path. |
| **Enforcement Gate** | **MUST NOT** be written from training-data assumptions — every claim (language, framework, test/build commands) **MUST** come from actually scanning the project. Uncertain parts **MUST** be marked `// TODO: Pending confirmation` and raised to the human, not guessed. |

Triggered when a project lacks documentation, the user requests to create a `README.md`, or needs to define architectural guidelines in `AGENTS.md`.

## 1. Reconnaissance & Environment Discovery `[Discover]`
- **Fabrication Prohibited**: You absolutely MUST NOT rely on the model's historical training data to write documentation.
- Call scripts or use `grep_search`, `read_file` to scan project directories, dependency files like `package.json`, `Cargo.toml`, etc.
- Confirm the project's language, framework, test commands, and deployment methods.

## 2. Organization & Writing `[Think] & [Try]`
- **Reader-Oriented**: If generating a `README.md`, the content MUST focus on the "User Journey": what this product does, how to install it, how to use core features.
- If generating `AGENTS.md` or developer guidelines: The content MUST focus on "architectural conventions, build commands, test commands" for future AI Agents (or human developers) to read.
- **Combine with Cognitive Loop**: When writing, obey the `install-cognitive-os` rules, predict the chapter structure of the document first, generate it in one go, and leave room for future expansion.

## 3. Verification & Alignment `[Summarize]`
- After generating the document, you MUST ensure the installation or test commands within the document are **actually executable**.
- If there are uncertain parts, leave `// TODO: Pending confirmation` markers in the document and ask the human questions (`grill-me` mode).

## Deep Reference Templates
To ensure professional quality, you MUST use the appropriate template from `repo-docs/templates/`:
- `repo-docs/templates/readme-template.md` — Standard project documentation template
- `repo-docs/templates/product-readme-template.md` — Product archetype user-journey template
- `repo-docs/templates/multi-skills-readme-template.md` — Large project with multiple skills/modules
- `repo-docs/templates/knowledge-readme-template.md` — Information-heavy/knowledge-base template
- `repo-docs/templates/agents-template.md` — Standard agent onboarding instructions template
- `repo-docs/templates/product-agents-template.md` — Agent instructions for product repositories
- `repo-docs/templates/skills-agents-template.md` — Agent instructions for skills repositories
- `repo-docs/templates/knowledge-agents-template.md` — Agent instructions for knowledge/research projects
- `repo-docs/templates/manual-recon.md` — Methodology for manual repo scanning and classification
