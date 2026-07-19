# Harness OS (AI Agent Operating System)

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
> "Harness is not a static list of prompts. It is an Orchestrated Agent Operating System that executes, guards, and evolves AI reasoning in real-time."

Harness OS is a lightweight, non-intrusive runtime framework that wraps around your AI IDE/CLI sessions (Claude Code, Copilot, Cursor, Codex). It provides reactive hooks, routing, and circuit breakers designed to prevent **infinite trial-and-error loops**, **costly over-engineering**, and **lost-in-the-middle context drift**.

---

## ⚡ Quick Start (Get Protected in 10s)

Harness OS integrates directly into your workspace. There's no heavy daemon, no paid external APIs, and zero configuration required.

```bash
# Install Harness hooks & skills into your current workspace
npx github:prime-radiant-inc/harness-skills install
```

Upon startup, Harness OS automatically bootstraps itself, auditing your OS and Shell environment, and routing tasks seamlessly.

---

## 🤖 Supported AI IDEs & Installation Guides

Harness OS is engineered to augment multiple AI interfaces natively, aligning with their respective hooks or instruction injection files:

| AI Agent Tool | Hook Type / Config Used | Local Target Location | Installation Command / Workflow |
|---|---|---|---|
| **Claude Code** | Native Hooks (`PreToolUse`, `PostToolUse`, `SessionStart`) | `.claude.json` / `~/.claude.json` | `npx github:prime-radiant-inc/harness-skills install` (Configures hooks safely) |
| **Copilot Chat (VS Code)** | Custom Instructions / Prompt Files | `.github/copilot-instructions.md` | Automatically referenced by Copilot for project-local guidelines |
| **Cursor** | Native Project Rules | `.cursorrules` | Appended automatically during installation |
| **Codex CLI / App** | Configuration & Agents | `.codex/config.toml` | Unified instructions matching `~/.codex/config.toml` |

### Platform-Specific Integration Workflows

#### 1. Claude Code
Our installer safely injects the standard hooks directly into your project's `.claude.json`.
*   The `SessionStart` hook fires `bootstrap.js` to restore any previous handoffs.
*   `PreToolUse` fires `rule-of-3.js` and `context-compact.js` to guard tool operations.
*   `PostToolUse` tracks errors via `rule-of-3-tracker.js` and updates the transaction log via `state-persist.js`.

#### 2. Cursor (.cursorrules)
Running `npx github:prime-radiant-inc/harness-skills install` automatically injects Harness Operating System instructions into your project's `.cursorrules`. If Cursor's agent is running commands, it will respect the rule-of-3 circuit breaker and discover active shell properties from `preflight.js` output.

#### 3. Copilot Chat (VS Code)
Copilot automatically ingests `.github/copilot-instructions.md` (and prompts under `.github/prompts/` in advanced setups). To align Copilot with Harness OS rules:
1. Ensure your `.github/copilot-instructions.md` includes:
   ```markdown
   Always consult and execute standard Harness OS commands (e.g. preflight checks via node bin/cli.js) to align with operating system syntax.
   ```

---

## 🏗️ Architecture

Instead of letting the AI blindly execute tasks, Harness OS acts as a system supervisor, organizing the task's life cycle dynamically:

```mermaid
flowchart TD
    subgraph User Session
        U([User Request]) --> Boot[bootstrap.js: Session Start]
    end

    subgraph OS Kernel [Harness OS Engine]
        Boot -->|Check Handoff Checkpoint| Preflight[preflight.js: Environment Audit]
        Preflight --> Router{tier-router.js: Task Triage}
        
        Router -->|Tier 1: Trivial Task| T1[Direct Execution - No Plans]
        Router -->|Tier 2: Standard Task| T2[tdd: Test-Driven Development]
        Router -->|Tier 3: Macro Task| T3[fable-mode: Multi-Agent Spawn]
    end

    subgraph Defense & Safety [Circuit Breakers]
        T1 & T2 & T3 --> Tools[Agent Tool Call]
        Tools -->|PreToolUse| CG[context-compact.js: Bloat Warning]
        Tools -->|PreToolUse| CB{rule-of-3.js: Circuit Breaker}
        
        CB -->|Fails 3x| ZO(zoom-out: Halt & Request Human Help)
        CB -->|Succeeds| Done[Success / Finish]
    end

    subgraph Continuous Learning
        ZO --> Human[Human Intervention & Fix]
        Human --> SE[self-evolve: Deep Reflection]
        Done -->|Complex Breakthrough| SE
        SE --> RunSR[self-regression.js: CI Check]
        RunSR -->|Pass 100%| Mem[(Long-term Memory / RULES.md)]
        Mem -.->|Immunize| Preflight
    end

    style OS Kernel fill:#f9f,stroke:#333,stroke-width:2px
    style Defense & Safety fill:#ff9,stroke:#333,stroke-width:2px
    style Continuous Learning fill:#bbf,stroke:#333,stroke-width:2px
```

---

## 🛠️ Core OS Modules

Harness OS works through five lightweight cognitive layers:

### 1. Task Triage (`harness-everything` / `tier-router.js`)
Prevents over-engineering. Automatically segments incoming requests into corresponding execution tiers:
*   **Tier 1 (Trivial Task)**: Direct file editing. Inhibits heavy plan writing or expensive sub-agents.
*   **Tier 2 (Standard Task)**: Enforces `tdd` (Test-Driven Development) cycle (Red-Green-Refactor).
*   **Tier 3 (Macro Task)**: Automatically launches the multi-agent orchestration center (`fable-mode` & `create-agent-launcher`).

### 2. Environment Alignment (`environment-detection` / `preflight.js`)
Proactively audits the workspace properties (OS, Terminal Shell, Package Managers, and Sandbox Capabilities) to ensure syntax correctness, eliminating wasted token cycles on Windows path backslash escapades.

### 3. Context Bloat Shield (`hooks/scripts/context-compact.js`)
An informational, non-intrusive warning dashboard that tracks uncommitted diffs and staged file counts. It reminds the agent to compact context and prevents the "Lost in the Middle" reasoning drop before your context window hits the limit.

### 4. Circuit Breaker (`hooks/scripts/rule-of-3.js`)
Tracks repeat failure hashes. If the same error fails to compile or verify 3 times in a row, it forcefully triggers the **`zoom-out`** circuit breaker, halting code generation and requesting human partner insights instead of burning budget.

### 5. Self-Evolution Loop (`self-evolve` / `self-regression.js`)
When an issue is successfully resolved, Harness abstracts the high-level root cause and persists it into workspace memory (`RULES.md`). Before saving, the `self-regression.js` test suite validates all script syntax hermetically to prevent behavior decay.

---

## 📂 Directory Structure

```
harness-skills/
├── bin/
│   └── cli.js                     # CLI main entry
├── harness-everything/
│   └── scripts/
│       ├── bootstrap.js           # Session start check / Handoff recovery
│       └── tier-router.js         # Triages incoming request tiers
├── hooks/
│   └── scripts/
│       ├── rule-of-3.js           # Circuit breaker loop halt
│       ├── context-compact.js     # Strategic context bloat dashboard
│       └── state-persist.js       # Transaction log (WAL) & Handoff persistent state
├── environment-detection/
│   └── scripts/
│       └── preflight.js           # OS/Shell environment audit
├── self-evolve/
│   └── scripts/
│       ├── persist-memory.js      # Long-term RULES writer
│       └── self-regression.js     # System self-test regression CI
├── eval-framework/                # Router trigger verification cases
└── tdd/                           # Standard Tier 2 development flow
```

---

## 🤝 For Contributors & Self-Regression

To contribute to Harness OS or to safely modify any Skill behavior:

```bash
# 1. Run full hermetic static syntax & routing simulations
npm run self-regression
```

Ensure Phase 1 and Phase 2 pass 100% cleanly before pushing changes. All script modifications must run through the `self-regression` suite to keep the OS immunised against behavioral regression.

---
*Harness OS is a non-intrusive cognitive amplifier. It is built to wrap around, notify, and assist, preserving agent creativity while dramatically reducing trial-and-error budgets.*
