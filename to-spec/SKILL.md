---
name: to-spec
description: Turn the conversation into a written spec — feature PRD, CLI/API reference, schema doc, or dev doc, whichever fits — and publish it per this repo's projectDocs framework; use when alignment is complete.
license: Apache-2.0
metadata:
  author: Miya Daniel | Harness Core Team
  version: 0.3.4
---

# To Spec

Turns the conversation into one published spec artifact. No interviewing — `grill-me`/`grill-with-docs` run beforehand.

## 📋 Skill Contract

| Component | Specification |
| :--- | :--- |
| **Trigger / Input** | Explicit `/to-spec`; never auto-run. |
| **Expected Output** | One doc from a matching `templates/*.md` skeleton. |
| **State Mutations** | Writes spec doc; updates `projectDocs` in `manifest.json`. |
| **Enforcement Gate** | Outline preview before writing; graceful Exit 1 fallback. |

## Workflow

1. Resolve path via `node "to-spec/scripts/check-project-docs.js" check`; else existing `docs/specs/`, `docs/reference/`, `docs/adr/`, `docs/`, `.scratch/`; else `.claude/`, `.github/`, or `.cursor/harness-everything/specs/<slug>.md`.
2. Zero-trust context: cite `Evidence: <file:line> -> Finding: <meaning>`; blocking forks mean run `grill-me`/`grill-with-docs` first.
3. Mandatory outline preview (closest fit, 10-20 lines + target path); write only after user confirms.
4. Publish to `specs/<feature-slug>.md` (`Status: ready-for-agent`) or `reference/`, `adr/`.
5. Golden Flow: Feature spec needs a Design Audit (`create-agent-launcher`) before `/to-tickets`.

Templates: `templates/feature-spec.md`, `templates/cli-reference.md`, `templates/schema-doc.md`, `templates/dev-doc.md`

Deep dive: references/process.md

## USE FOR:
- conversation into a published PRD or design doc
- document a new CLI command, endpoint, or schema
- publish an ADR once alignment completes

## DO NOT USE FOR:
- interviewing (`grill-me` / `grill-with-docs`)
- auto-running publication
