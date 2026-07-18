# Harness Skills (The Agentic Operating System)

> "Don't use a cannon to kill a mosquito; break through the reasoning ceiling."

Harness Skills is a dynamic routing and self-defense system built specifically for AI Agents. Inspired by the powerful designs of ECC and Superpowers, this system aims to solve the two most common pain points for AI in daily development:
1. **Over-engineering**: Writing long-winded plans or generating unnecessary sub-agents for simple typo fixes.
2. **Reasoning Ceiling & Infinite Loops**: Falling into invalid infinite retry loops when encountering complex algorithms beyond the model's capabilities.

## What Makes Harness Skills Different?
1. **Task Decomposition for High Accuracy**: Smartly breaks down tasks based on complexity (Tiers) to ensure agents do exactly what is needed without overcomplicating.
2. **Deep Information Exploration**: Overcomes the common "shallow context" AI trap. Enforces multi-hop dependency tracing and impact radius assessment before any code is written, ensuring the agent sees the whole forest, not just one tree.
3. **Reflection Over Repetition**: After consecutive failures, agents are trained to stop, step back, and deeply reflect on the problem rather than getting stuck in loops of repeated, futile verification.
4. **Self-Evolution via Dynamic Skills**: Uses reflection to summarize session experiences (hard boundaries) and packages frequently repeated actions into new, dynamic skill packages (akin to the Hermes agent). These generated skills possess a lifecycle and can be continuously optimized or replaced.
5. **Strict Environment Detection**: Solves the common agent failure of misjudging tool properties (e.g., mistaking Git Bash for PowerShell on Windows). It enforces proactive detection of OS, shell environments, and tech stacks before taking action.

## Core Design Philosophy: Single Entry & Circuit Breaker Architecture

This Skills system does not require humans to manually choose which Skill to activate. You only need a single entry point: **`harness-everything`**.

### 1. Task Triage
When a task enters `harness-everything`, the Agent automatically categorizes the task:
*   **Tier 1 (Trivial Task)**: Direct execution. Prohibited from writing plans or calling sub-agents.
*   **Tier 2 (Standard Task)**: Automatically switches to `tdd` (Test-Driven Development) mode.
*   **Tier 3 (Macro Task)**: Automatically loads `fable-mode` and `create-agent-launcher`, assembling specialized Sub-agents to handle complex architectures.

```mermaid
flowchart TD
    Start([User Request]) --> Router{harness-everything}
    Router -->|Tier 1: Trivial| Exec[Direct Execution]
    Router -->|Tier 2: Standard| TDD[TDD Mode]
    Router -->|Tier 3: Macro| Fable[Fable Mode]
    Fable --> Launcher[create-agent-launcher]
    Launcher --> Sub1[Sub-Agent: Backend]
    Launcher --> Sub2[Sub-Agent: Frontend]
```

### 2. The Global OS
Regardless of the Tier, all Agents must obey the cognitive loop defined by `install-cognitive-os`: **Discover > Think > Try > Summarize > Record**.

```mermaid
flowchart LR
    D[Discover] -->|Context| Th[Think]
    Th -->|Intent| Tr[Try]
    Tr -->|Evidence| S[Summarize]
    S -->|Persist| R[Record]
    R -.->|Next Loop| D
```

### 3. Circuit Breaker, Reflection & Self-Evolve
*   **Rule of 3**: If fixing the same error fails 3 times, forcefully trigger the `zoom-out` circuit breaker. The Agent must stop writing code, reflect on the failure, and seek human help.
*   **Feedback & Dynamic Skills**: When human intervention resolves the blind spot, forcefully trigger `self-evolve`, abstract the solution through reflection, and write it to long-term memory. If it's a recurring workflow, the agent will package it into a dynamic, lifecycle-managed skill to ensure continuous self-updating and evolution.

```mermaid
flowchart TD
    A[Agent Execution] -->|Error/Fail| B{Try Count >= 3?}
    B -->|No, Try Again| A
    B -->|Yes, Micro-loop detected| C(zoom-out: Halt & Escalate)
    C --> D((Human Intervention))
    D -->|Provides Insight| E(self-evolve)
    E --> F[(Long-term Memory)]
    F -.->|Protects Future 'Discover' phase| A
```

## Directory Structure
- `harness-everything/`: System main entry and routing center
- `install-cognitive-os/`: Underlying cognitive loop OS
- `skill-style/`: Skills writing and design guidelines
- `tdd/`: Standard task development mode
- `fable-mode/` & `fable-discipline/`: Macro task and multi-agent orchestration architecture
- `create-agent-launcher/`: Sub-agent generator
- `zoom-out/`: Circuit breaker and global perspective
- `self-evolve/`: Memory compression and self-evolution
- And other integrated tools (e.g., `git-commit`, `grill-me`, etc.)

---
*Generated for seamless integration into any AI IDE (VS Code Copilot, Claude Code, Cursor, etc.).*
