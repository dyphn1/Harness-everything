---
name: improve-codebase-architecture
description: Discovers and transforms shallow modules into deep ones to improve testability and AI navigability.
author: Miya Daniel | Harness Core Team
version: 0.2.0
---

# Improve Codebase Architecture (Deep Architectural Optimization)

## 📋 Skill Contract

| Component | Specification |
| :--- | :--- |
| **Trigger / Input** | Project shows tech debt, overly coupled modules, or the user requests to "refactor / improve architecture quality". |
| **Expected Output** | A "Deepening Opportunities" report naming shallow modules and improperly coupled seams, followed (after human approval) by `tdd`-guarded refactoring. |
| **State Mutations** | Refactors module boundaries/interfaces; may add Characterization Tests before touching legacy code that has no existing coverage. |
| **Enforcement Gate** | Blind refactoring is **PROHIBITED** — must scan `CONTEXT.md`/ADRs/interfaces first. Refactoring code with no test safety net **MUST** start with Characterization Tests. More than 3 cascading compile errors **MUST** trigger `zoom-out` and rollback, not continued patching. |

Triggered when a project is full of "Tech Debt", modules are overly coupled, or the user requests to "refactor / improve architecture quality". This skill aims to transform "Shallow" modules into "Deep" modules to enhance testability and AI navigability.

## 1. Architectural Exploration & Discovery `[Discover]`
- **Blind Refactoring Prohibited**: Before proposing any modification suggestions, you MUST first scan `CONTEXT.md`, `docs/adr/`, and core interface definitions (Interfaces/Types).
- Identify "Shallow Modules" (interfaces that are complex but have very little internal implementation).
- Identify improperly coupled boundaries (Seams).

## 2. Analysis & Proposal `[Think]`
Use consistent domain terminology (Module, Interface, Implementation, Depth, Seam, Adapter) to communicate with the human.
- Submit a "Deepening Opportunities" report to the user.
- Explicitly point out which modules should be encapsulated and which boundaries (Seams) should be extracted into Adapters.

## 3. Implementation Refactoring `[Try]`
- After gaining human approval, launch `tdd` mode.
- **Iron Rule of Refactoring**: MUST be done under the safety net of test coverage. If there are no tests, the first step MUST be to "write Characterization Tests for the legacy code" before modifying the architecture.

## 4. Circuit Breaker & Evolution `[Summarize] & [Self-Evolve]`
- If refactoring triggers more than 3 cascading compilation errors that cannot be fixed immediately, trigger the `zoom-out` circuit breaker and Rollback.
- Write the discovered coupling traps into `self-evolve` memory, ensuring future newly generated code does not repeat the same mistakes.

## Deep Reference Guides
For precise architectural paradigms and deep module analysis, refer to:
- `improve-codebase-architecture/guides/DEEPENING.md` — Deepening opportunities & modular depth rules
- `improve-codebase-architecture/guides/INTERFACE-DESIGN.md` — Principles of interface design and seams
- `improve-codebase-architecture/guides/LANGUAGE.md` — Language-specific refactoring and pattern guidelines
- `improve-codebase-architecture/guides/HTML-REPORT.md` — Creating visual reports with Mermaid diagrams
