---
name: repo-docs
description: Generate or update precise, reader-oriented README.md and AGENTS.md based on actual project scans and smart merging of existing files. Use when a project lacks documentation or needs refreshed agent onboarding docs.
license: Apache-2.0
metadata:
  author: Miya Daniel
  version: 0.3.4
---

# Repo Docs (Automated Project Documentation Generation & Smart Merging)

Merges codebase scan facts and bespoke notes into `README.md`/`AGENTS.md`.

## USE FOR:
- Generate README.md for undocumented projects
- Update AGENTS.md after structural changes
- Merge legacy notes into refreshed docs

## DO NOT USE FOR:
- Marketing copy not grounded in codebase scans
- Fabricating docs without scanning the repo
- Non-repository documents (wikis)

## Skill Contract

| Component | Specification |
| :--- | :--- |
| **Trigger / Input** | Missing docs; request to update `README.md`/`AGENTS.md`. |
| **Expected Output** | `README.md`/`AGENTS.md` merging scan facts + bespoke notes. |
| **State Mutations** | Updates `README.md`/`AGENTS.md` or fallbacks; preserves human docs. |
| **Enforcement Gate** | Inspect existing docs first; preserve bespoke notes while upgrading structure. |

## Workflow

1. [Discover] Scan configs (`package.json`, `Cargo.toml`) as Source of Truth. Never fabricate.
2. Read existing docs fully first; extract bespoke notes (env vars, URLs, gotchas); never overwrite blindly.
3. Pick a template below; else built-in structure.
4. Draft: `README.md` = user journey; `AGENTS.md` = conventions, build/test commands.
5. [Summarize] Verify commands run; mark doubts `// TODO: Pending confirmation`; ask (`grill-me`).
6. Write to root; if protected, `.github/AGENTS.md`/`docs/README.md`.

## `repo-docs/templates/`

readme-template.md · product-readme-template.md · multi-skills-readme-template.md · single-skill-readme-template.md · knowledge-readme-template.md · agents-template.md · product-agents-template.md · skills-agents-template.md · knowledge-agents-template.md · manual-recon.md

Deep dive: references/process-guide.md
