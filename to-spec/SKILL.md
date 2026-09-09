---
name: to-spec
description: "Turn the conversation into a written spec — feature PRD, CLI/API reference, schema doc, or dev doc, whichever fits — and publish it per this repos projectDocs framework; use when alignment is complete."
license: Apache-2.0
metadata:
  author: Miya Daniel
  version: 0.3.6
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

1. Resolve path via the shared `<skills-repo-root>/multi-agent-workspace/scripts/project-docs-resolver.js` contract and `node "<this-skill-dir>/scripts/check-project-docs.js" check`; use explicit projectDocs, CONTEXT-MAP, inferred docs, then committable fallback.
2. Zero-trust context: cite `Evidence: <file:line> -> Finding: <meaning>`; blocking forks mean run `grill-me`/`grill-with-docs` first.
3. Mandatory outline preview (closest fit, 10-20 lines + target path); write only after user confirms.
4. Publish to `specs/<feature-slug>.md` (`Status: ready-for-agent`) or `reference/`, `adr/`.
5. Golden Flow: Feature spec needs a Design Audit (`multi-agent-workspace`) before `/to-tickets`.

Deep dive: <this-skill-dir>/references/process.md

## USE FOR:
- conversation into a published PRD or design doc
- document a new CLI command, endpoint, or schema
- publish an ADR once alignment completes

## DO NOT USE FOR:
- interviewing (`grill-me` / `grill-with-docs`)
- auto-running publication
