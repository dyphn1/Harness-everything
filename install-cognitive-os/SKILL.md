---
name: install-cognitive-os
description: Defines the fundamental physical laws of behavior (Discover > Think > Try > Summarize > Record) for all Agents.
author: Miya Daniel | Harness Core Team
version: 0.2.0
---

# Agent Cognitive OS (Underlying Cognitive System)

## 📋 Skill Contract

| Component | Specification |
| :--- | :--- |
| **Trigger / Input** | Always — the foundational cognitive loop every other skill builds on; loaded before acting on tasks. |
| **Expected Output** | Actions follow Discover → Think → Try → Summarize → Record, where Summarize relies on objective verification rather than self-assessment. |
| **State Mutations** | None directly — provides the meta-loop within which other skills manage state (e.g. `todo-cli.js complete`). |
| **Enforcement Gate** | Progress recording (`[Record]`) is grounded in verified tool output. A failing test or script step triggers a return to `[Think]`; repeated failures lead to `zoom-out` reflection. |

This skill outlines the core cognitive loop that guides agent behavior across tasks in the Harness ecosystem.

> **Platform Enforcement Note**: Hard boundary enforcement via native lifecycle hooks (`exit 2`) is exclusively supported on **Claude Code**. On advisory-only platforms (**Cursor, Copilot Chat, Codex, Continue.dev, Hermes Agent, Gemini CLI**), execution hooks cannot physically block tool calls; all state transitions and verification gates operate as self-directed agent guidance.

## 🔄 The Cyclical Development Paradigm
Software development is iterative — a cycle of hypothesis, execution, feedback, and refinement.
Rather than assuming code works immediately after writing it, ground progress in objective evidence from verification tools (`harness-everything/scripts/verify-gate.js` and `harness-everything/scripts/todo-cli.js`). When checks fail, step back to analyze, adapt, and resolve before continuing.

## Core Loop: The State Machine (Discover > Think > Try > Summarize > Record)

```mermaid
flowchart TD
    State_Awake[Discover: Where am I?] --> State_Think[Think: Form Hypothesis]
    State_Think --> State_Try[Try: Execute Code / Run Script]
    State_Try --> Gate{Summarize: Verify via Gate}
    
    Gate -->|Exit 1: Reality Mismatch| State_Think
    Gate -->|Exit 1: Repeated Failures| ZoomOut[Record: Zoom-Out / Reflect]
    ZoomOut --> State_Think
    Gate -->|Exit 0: Reality Match| State_Record[Record: Commit State]
    State_Record --> State_Think
```

### 0. `[Discover]`: State Awakening & Environment Discovery
- **Action**: Verify workspace state and environment context first.
- **Environment Detection**: Confirm OS, active shell, and available tooling (`environment-detection`).
- **Context Exploration**: Trace relevant code references, call sites, and architectural guidelines rather than relying on isolated assumptions.

### 1. `[Think]`: Form Hypothesis
- Establish high-level intent before modifying code or running major commands.
- Evaluate potential failure modes early and discard unviable approaches.

### 2. `[Try]`: Execution and Action
- Apply minimal, focused code changes to test your hypothesis.
- Run terminal commands to test and validate behavior.

### 3. `[Summarize]`: Objective Reality Check
- Base conclusions on actual tool outputs (tests, linters, `verify-gate.js`) rather than assumptions.
- If a verification step fails, use the output diagnostics to refine your hypothesis in `[Think]`.
- If an approach fails repeatedly (3 consecutive attempts), step back to `zoom-out` for a broader system reflection.

### 4. `[Record]`: State Commitment
- Record completed milestones using the task tracker (`todo-cli.js complete`) once verification passes cleanly.

## 🧠 Communication & Output Formatting Guidelines
To maintain clarity and reduce conversational noise:

### 1. Lead with Substance
- **Direct Opening**: Start with the direct answer, code change, executed command, or key finding.
- **Avoid Conversational Filler**: Omit introductory phrases like "Sure!", "Great question!", or "Let me help you with that".

### 2. Autonomous Execution
- Complete actionable work (searching, editing, testing) directly using available tools rather than giving the user a manual script to run, unless blocked by credentials or external choices.

### 3. Bounded Actionable Steps
- Structure multi-step processes into concise, numbered items focused on single actions (prefer ≤5 items per section).

### 4. Clear Turn-by-Turn Progress
- For multi-phase tasks, briefly state current progress and the immediate next step.

### 5. Matter-of-Fact Error Diagnostics
- Present errors objectively: specify the failure location, observed output, root cause, and proposed fix.

### 6. Concise Responses
- Omit repetitive recaps of completed actions and polite closing pleasantries.

### 7. Language Consistency (Traditional Chinese / Taiwan)
- Align with the user's prompt language (defaulting to Taiwanese Traditional Chinese (`zh-TW`)).
- Use natural Taiwanese engineering terms: `程式碼`, `資料/資料庫`, `預設`, `資訊`, `相容`, `最佳化`. Keep technical identifiers, commands, paths, and standard English terms (`commit`, `PR`, `deploy`) in English.

