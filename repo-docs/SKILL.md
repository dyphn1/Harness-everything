---
name: repo-docs
description: Automatically generates precise, reader-oriented README.md and AGENTS.md based on actual project scans.
---

# Repo Docs (Automated Project Documentation Generation)

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
