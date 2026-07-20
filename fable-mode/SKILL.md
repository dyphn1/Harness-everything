---
name: fable-mode
description: Macro task planning and execution engine for complex requirements and low-level architecture changes.
---

# Fable Mode (Macro Task Planning & Execution Engine)

This skill is automatically triggered and loaded by the `harness-everything` router when a task is judged as a **Tier 3 (Macro Task)**.
It applies to building new feature modules from scratch, massive low-level architecture changes, or extremely vague and complex user requirements.

## Core Concept: Plan Before Acting

In Fable Mode, you are no longer a simple "typist", but an "Architect" and "Project Manager".
You MUST strictly comply with and pair this with `fable-discipline` to control risks.

## Sub-Skills (bundled with this skill)
- `execution-guardrails/` — always-on operational rules (verify-before-flag, warning batching, find-and-replace safety). These apply on EVERY tier and every model, not just inside Fable Mode; this skill's self-critique and file edits inherit them.
- `fable-haiku/` — opt-in variant that routes the staged loop to a cheap Haiku worker agent for bulk mechanical work. Only use when the user explicitly asks for it.

## Execution Phases:

### 1. Discovery & Planning
- **Assess Current State**: Comprehensively review the file architecture related to the requirement and understand dependencies.
- **Deconstruct Task**: Break down the massive macro task into independently verifiable sub-tasks.
- **Produce Plan**: Write a clear implementation plan (can be stored in chat or a temporary file) and confirm it with the Human Partner.
- **Materialize the Plan as a Checklist**: The confirmed plan MUST be initialized as the `todo-driven-workflow` checklist — every sub-task, sub-agent handoff, and milestone check is tracked there, not in prose. This is the harness's base execution loop.

### 2. Sub-agent Orchestration
- If the task involves different professional domains (e.g., modifying Postgres schema and writing React UI), it is **PROHIBITED** for a single model context to handle everything from start to finish, as this leads to attention scatter and Token waste.
- **Mandatory Call**: Invoke the `create-agent-launcher` skill.
- Based on the deconstructed sub-tasks, configure the corresponding Sub-agents (e.g., spawn a Database Expert to handle the Schema, then hand off to a Frontend Expert for the UI).

### 3. Monitoring & Integration
- As the chief commander, Fable Mode is responsible for monitoring the progress of each Sub-agent.
- Ensure the outputs of various sub-agents can integrate perfectly.
- Upon completing each Milestone, a global test or check MUST be executed.

## Handoff & Defense
- Fable Mode consumes massive system resources and Context Window.
- Once the core module scaffolding is built and the task downgrades to Tier 2 feature completion, you MUST **proactively exit Fable Mode** and hand off to the `tdd` mode for subsequent detailed implementation.
