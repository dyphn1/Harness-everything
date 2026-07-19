---
name: harness-everything
description: The single entry point and dynamic router for the Harness ecosystem. Triage tasks into Tier 1, 2, or 3.
---

# Harness Everything (System Main Entry & Dynamic Router)

This is the single entry point for the entire Harness Skills ecosystem. When you receive a new request from the user and no specific Skill is indicated, you **MUST** prioritize loading this Skill to perform Task Triage.

## 1. Core Rule: Global Underlying OS
Before taking any action, you must awaken and load the principles of `install-cognitive-os`.
No matter how simple the task is, your behavior must comply with the **Discover > Think > Try > Summarize > Record** cognitive loop.
Never rush to act before understanding the environment; establish contextual awareness first.

## 2. Task Triage
To avoid "over-engineering" and maximize efficiency, you must categorize the user's task during the `[Think]` phase and take the corresponding action path.
- **MANDATORY**: Run the Tier Router script before deciding the tier:
  ```bash
  node path/to/harness-everything/scripts/tier-router.js "<Brief summary of the user's prompt>"
  ```
- You MUST follow the `REQUIRED TIER` output by the script.

### Tier 1: Trivial Tasks & Daily Chores
- **Characteristics**: Fixing typos, simple modifications to a single function, asking/explaining code, syntax adjustments. Or simple `git-commit` and `rewrite-commits`.
- **Action Strategy (Direct Execution)**:
  - **PROHIBITED** from writing large plans.
  - **PROHIBITED** from calling `create-agent-launcher` or `fable-mode`.
  - Execute the modification directly based on requirements, or load `git-commit` / `rewrite-commits`. Perform a simple `[Record]` after modifying.

### Tier 2: Standard Tasks & Architectural Review
- **Characteristics**: Adding a single API endpoint, fixing a specific bug, modifications requiring coordination across 2-3 files. Or requiring stress testing and benchmark evaluation for specific designs.
- **Action Strategy (TDD, Deep Context & Domain Expertise)**:
  - **Information Depth Requirement**: Before entering TDD, you MUST perform a deep context trace (find references, call sites, and related interfaces). Superficial fixes that break dependencies are strictly forbidden.
  - **Load Domain Experts (領域專家召喚)**: Based on the tech stack detected in Tier 1, explicitly search for and load the corresponding **Domain Skills** (e.g., `frontend-patterns`, `security-review`, `api-design` from the user's legacy skill library) to inject robust expert knowledge into your context.
  - Development tasks: Automatically load and follow the `tdd` (Test-Driven Development) skill. Write tests first (Red) -> Implement (Green) -> Refactor.
  - Before starting feature work on a busy repository, consider loading `using-git-worktrees` to isolate your workspace and prevent workspace pollution.
  - If the user requests grilling or refactoring a plan, load `grill-me` (pure Q&A) or `improve-codebase-architecture` (deep architectural analysis).
  - If the user requests "scoring" or "benchmark comparison", load `eval-harness` for quantitative scoring and summarization.

### Tier 3: Macro Tasks & Documentation
- **Characteristics**: New project initialization, low-level architecture refactoring, vague and massive requirements (e.g., "Help me write a user login system"). Or lack of global documentation.
- **Action Strategy (Multi-Agent Orchestration & Domain Infusion)**:
  - If initializing a multi-agent system workspace, load `build-multi-agent-system` to scaffold the 6 functional zones, memory relational indexes, and immutable routing laws.
  - If project-level documentation needs to be created, load `repo-docs`.
  - If establishing a large system design, strongly recommend loading `grill-with-docs` first to document decisions (ADR, CONTEXT) before proceeding.
  - **Sub-Agent Specialization**: When calling `create-agent-launcher`, you MUST inject robust Domain Skills into the sub-agent's persona (e.g., passing `database-reviewer` and `backend-patterns` to a Backend Sub-Agent). Do not create generic, empty-shell agents.
  - Development execution: Automatically load `fable-mode` and `fable-discipline`.

## 3. Foolproofing & Circuit Breaker Mechanism
LLMs have a Reasoning Ceiling. To avoid invalid infinite retries, you must strictly obey the following limits:
- **Rule of 3**: If attempting to fix the same Bug or test failure fails 3 times consecutively, **STOP modifying code immediately**.
- **Trigger Circuit Breaker**: Forcefully call the `zoom-out` skill to step back from current details.
- **Seek Human Help**: Report your 3 failed attempts to the Human Partner and ask if there are different architectural directions or logic hints.

## 4. Evolution Loop
- When the circuit breaker is triggered and the problem is ultimately solved with human intervention.
- Or, when you have expended great effort to overcome difficulties and complete a complex task.
- You **MUST** automatically call the `self-evolve` skill to write "human key insights" or "successfully avoided traps" into system memory, ensuring the same blind spots are bypassed next time.
