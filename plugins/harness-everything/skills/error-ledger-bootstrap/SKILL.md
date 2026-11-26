---
name: error-ledger-bootstrap
description: "Bootstrap a local error ledger for an existing repository by inventorying candidate lessons, obtaining item-level owner approval, and promoting approved entries."
license: Apache-2.0
metadata:
  author: Miya Daniel
  version: 1.2.0
---

# Error Ledger Bootstrap

## Skill Contract

| Component | Specification |
| --- | --- |
| Trigger / Input | An existing repository that needs an initial error-ledger inventory. |
| Expected Output | A local candidate report and, after approval, ledger records plus index. |
| Mutation | Inventory is read-only; write only owner-approved items. |
| Privacy | Keep memory, instructions, and reports local; never upload them. |

## USE FOR:
- Inventory candidate lessons for an existing repository's error ledger.
- Promote individually owner-approved candidates into that repository's ledger.

## DO NOT USE FOR:
- Persisting one lesson after a fix (use `self-evolve`).
- Explaining or changing the general Error Handling map or A–G flow.

## Workflow

Scan → classify candidates locally (`UNVERIFIED` when uncertain) → obtain owner approval per item → promote → index.

Deep dive: <this-skill-dir>/references/workflow.md
