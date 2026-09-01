---
name: improve-codebase-architecture
description: Discovers and transforms shallow or bloated modules into deep, SRP-compliant ones by splitting oversized objects/functions, extracting seams, and decoupling interfaces.
license: Apache-2.0
metadata:
  author: Miya Daniel
  version: 0.3.6
---

# Improve Codebase Architecture (Deep & SRP Refactoring)

## 📋 Skill Contract

| Component | Specification |
| :--- | :--- |
| **Trigger / Input** | "refactor architecture", "split object/class", "apply SRP", tech debt |
| **Expected Output** | SRP proposal, Characterization Test safety net, TDD-guided extraction. |
| **State Mutations** | Extracts classes/functions/objects; adds characterization tests. |
| **Enforcement Gate** | Scan docs first; Characterization Tests before refactoring untested code; >3 cascading errors → rollback + `zoom-out`. |

## Workflow

1. `[Discover]`: no blind refactoring — scan `CONTEXT.md`, `docs/adr/`, core interfaces first. Targets: SRP violations (>300 lines / >10 complexity), shallow modules, coupled seams.
2. `[Think]`: present the Deepening & SRP proposal (object splitting + seam abstraction) until approved.
3. `[Try]`: launch `tdd`; Characterization Tests first if legacy code lacks tests; extract incrementally, verifying tests after each change.
4. `[Summarize]`/`[Self-Evolve]`: >3 cascading errors → rollback + `zoom-out`; record traps in `self-evolve`.

Guides: `improve-codebase-architecture/guides/DEEPENING.md`, `improve-codebase-architecture/guides/INTERFACE-DESIGN.md`, `improve-codebase-architecture/guides/LANGUAGE.md`, `improve-codebase-architecture/guides/HTML-REPORT.md`.

## USE FOR:
- "refactor this architecture"
- "split this oversized class"
- "apply SRP here"
- "decouple these modules"

## DO NOT USE FOR:
- Features or bugfixes (use `tdd`)
- Style-only cleanups with no structure change

Deep dive: guides/refactoring-workflow.md
