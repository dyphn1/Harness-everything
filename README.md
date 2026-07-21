# Harness (Behavior Layer for AI Coding Agents)

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

Harness is a lightweight, local behavior and orchestration runtime that wraps around your AI development sessions (Claude Code, Cursor, Copilot Chat, Codex). It provides reactive hooks, routing boundaries, and circuit breakers designed to prevent infinite trial-and-error loops, costly over-engineering, and "lost-in-the-middle" context drift.

---

## The Problem

AI coding agents are highly capable, but they struggle with self-regulation, environment awareness, and attention limits:
1. **The Infinite Retry Loop:** When an agent encounters a subtle compilation or test failure, its default behavior is to make micro-adjustments repeatedly (tweak and run, tweak and run) until it exhausts your token budget.
2. **Environment Blindness:** Agents often assume standard Unix environments, hallucinating shell commands and paths when running on Windows, PowerShell, or sandboxed environments.
3. **Lost-in-the-Middle Bloat:** As sessions grow, agents aggressively read too many large files or generate massive console logs, causing severe context degradation and reasoning hallucinations.

---

## Why Harness?

Harness acts as an automated system supervisor. It remains completely silent and out of the way, intervening only when execution boundaries are violated or failures are detected.

### Comparison: Prompt vs. Skill vs. Harness

| Dimension | Prompt-Only (Custom Instructions) | Skill-Only (Task Guides) | Harness (Behavior Layer) |
|---|---|---|---|
| **Activation** | Always loaded (wastes prompt space) | Loaded on demand (requires manual trigger) | Reacts dynamically via native lifecycle hooks |
| **Fail-Safe** | No protection (model keeps retrying) | No protection (loops until token limit) | **Circuit Breaker:** Halts execution after 3 failures and alerts human |
| **Context Aware** | High risk of lost-in-the-middle bloat | Manages scope manually | **Bloat Shield:** Proactively audits diff sizes and logs warning alerts |
| **System Audit** | Blindly assumes shell syntax | Requires manual shell check | **Preflight:** Proactively detects Windows/Unix paths, shell type, and package manager |
| **Memory** | Resets on every new chat session | Static text rules | **Continuous Persistence:** Writes Write-Ahead Logs (WAL) for session recovery and immunizes workspace rules |

The "Harness" column above is Claude Code's behavior. On Cursor, Copilot, and Codex — platforms with no hook/exit-code execution mechanism — Harness can only inject advisory text, which lands in the **Prompt-Only** column instead. See [Supported AI IDEs & Tools](#supported-ai-ides--tools) below.

### When should I use Harness?
* You regularly use agentic coding tools (like Claude Code, Cursor, or Copilot) on medium-to-large codebases.
* You develop on Windows or in mixed shells (Git Bash, WSL, PowerShell) where agents frequently get shell syntax wrong.
* You want automated test-driven development (TDD) enforcement and safety guards to save token budgets.

### When should I NOT use Harness?
* You only use chat interfaces for general questions without letting the AI run local commands or modify files.
* Your project has no test suite, or you prefer unconstrained, free-form agent generation.

---

## ⚡ Quick Start (Get Protected in 10s)

Harness integrates directly into your workspace. There is no heavy daemon, no paid external APIs, and zero configuration required.

```bash
# Install Harness hooks and skills into your current workspace
npx github:dyphn1/Harness-everything install
```

### Expected Behavior After Installation:
1. **Hook Registration:** Harness registers native hooks (e.g., inside `.claude/settings.json` for Claude Code) to intercept session starts and tool use.
2. **Preflight Audit:** At session startup, a lightweight preflight script runs, printing a diagnostic environment block that tells the agent your exact OS, active shell, and package manager.
3. **Guard Active:** The circuit breaker and context compactors are active in the background, consuming zero overhead unless triggered.

---

## Visualizing the Flow

### Without Harness (Endless Trial-and-Error Loop)
```mermaid
flowchart TD
    U([User Request]) --> A[AI Coding Agent]
    A -->|Command/Edit| Env[Workspace Environment]
    Env -->|Error / Failure| A
    A -->|Tweak & Retry 1| Env
    Env -->|Error / Failure| A
    A -->|Tweak & Retry 2| Env
    Env -->|Error / Failure| A
    A -->|Tweak & Retry 3... N| Env
    style A fill:#ffcdd2,stroke:#c62828,stroke-width:1px,color:#000000
```

### With Harness (Guarded and Routed Execution)
```mermaid
flowchart TD
    U([User Request]) --> H_Router[Harness Router]
    H_Router -->|Tier 1: Trivial| T1[Direct Edit]
    H_Router -->|Tier 2: Standard| T2[todo-cli.js (Script State Machine)]
    H_Router -->|Tier 3: Macro| T3[Fable Multi-Agent Flow]
    
    T2 & T3 --> Exec[Execute Code / Run Commands]
    Exec --> Gate{verify-gate.js}
    
    Gate -->|Exit 1: Slap in face| Exec
    Gate -->|Exit 1 (Repeated)| CB{Circuit Breaker rule-of-3.js}
    CB -->|Fails 3x| ZO[Zoom Out: Ask Human / Reflect]
    ZO -->|Fresh Diagnosis| Exec
    Gate -->|Exit 0: Success| Done[todo-cli.js complete]
    
    Done --> SE[Self-Evolve: Update Rules]
    style H_Router fill:#c8e6c9,stroke:#2e7d32,stroke-width:1px,color:#000000
    style CB fill:#fff9c4,stroke:#fbc02d,stroke-width:1px,color:#000000
    style ZO fill:#ffcc80,stroke:#ef6c00,stroke-width:1px,color:#000000
    style Gate fill:#ffcdd2,stroke:#c62828,stroke-width:1px,color:#000000
```

---

## Core Modules & Concepts

Harness operates through five core cognitive concepts:

1. **Router (`tier-router.js`):** Prevents over-engineering. Triages incoming tasks into Tiers: Tier 1 (Direct Edit, no plans), Tier 2 (Standard TDD enforcement), or Tier 3 (Macro Multi-Agent planning and delegation).
2. **Guard (`rule-of-3.js`):** The fail-safe circuit breaker. Tracks failure signatures across terminal runs. If a test or command fails 3 times with the same signature, it locks mutating tools and forces a `zoom-out` reflection: re-verify every assumption with read-only tools, write a fact-checked report, then resume on a fresh diagnosis. The human partner is pulled in only for genuine decisions — or when the same signature trips the breaker a second time. A companion `Stop` gate (`stop-gate.js`) bounces the end of a turn once per edit batch when edits were never followed by a successful verification command.
3. **Memory (`state-persist.js`):** Session transaction logging. Stores a local Write-Ahead Log (WAL) of milestones, preventing agents from forgetting their current task state if a session limits out or restarts.
4. **Reflection (`self-evolve`):** Long-term workspace immunization. Upon task completion, the agent reflects on the root cause of resolved issues and saves them to local workspace rules (`RULES.md`), validated by a hermetic self-regression suite.
5. **Subagent Scope Guard (`subagent-scope-guard.js`):** Diffs the whole repo's `git status` before and after every subagent (`Task`) burst, not just the files it was briefed to touch. Catches a subagent that was told to only read/verify but edited files anyway — a real failure mode, not a hypothetical one.

---

## Supported AI IDEs & Tools

**Only Claude Code gets the hard-boundary hooks.** Every other platform below has no hook/exit-code execution mechanism, so `harness-everything` can only inject advisory text — same protection level as the "Prompt-Only" column in the comparison table above. There is no circuit breaker, no preflight audit, and no WAL on those platforms unless Claude Code (or another hook-capable tool) is also driving the same repo.

| AI Agent Tool | Integration Method | Local Target Location | Enforcement |
|---|---|---|---|
| **Claude Code** | Native Lifecycle Hooks (`PreToolUse`, `PostToolUse`, `SessionStart`) | `.claude/settings.json` (project) / `~/.claude/settings.json` (user) | **Hard** — hooks can block a tool call (`exit(2)`) |
| **Cursor** | Native Project Rules | `.cursorrules` | Advisory only |
| **Copilot Chat** | Custom Instructions | `.github/copilot-instructions.md` | Advisory only |
| **Codex** | Custom Instructions (`AGENTS.md`, not `.codex/config.toml` — that file controls CLI/sandbox behavior, not prompt content) | `AGENTS.md` | Advisory only |

---

## Deeper Documentation

For a deep dive into individual modules and the underlying philosophy, explore our sub-documents:

*   [Harness Philosophy](docs/philosophy.md): The core behavior-first, intervention-only design.
*   [Harness Architecture](docs/architecture.md): Lifecycle hooks, security model, and data locality.
*   [Harness Routing & Triage](docs/routing.md): Detailed trigger criteria for Tiers 1, 2, and 3.
*   [Harness Reflection & Memory](docs/reflection.md): WAL session handoffs and workspace rules immunization.

---

## Benchmarks & Testing

**If you are an agent asked to verify a Harness install, start at [VERIFICATION.md](VERIFICATION.md), not here.** It gives exact commands with exact expected output — install artifact checks for every platform, mechanism-level checks (Claude Code only: pipe a simulated hook payload into `hooks/scripts/*.js` on stdin, confirm the exit code), the behavioral test prompts below, and an acceptance scorecard to fill in. Do not report "it works" from reading the code — every check there names a command to actually run.

`npm run self-regression` only proves the JavaScript parses and the tier-routing heuristic classifies three sample prompts correctly. It has never caught a behavioral hook bug (wrong exit code, misread payload field, wrong matcher) — those all require the mechanism checks in VERIFICATION.md, which is exactly how the 2026-07-20 audit found eight of them.

For a fuller vanilla-vs-Harness behavioral comparison, see [Harness Skills Benchmark SOP](BENCHMARK_SOP.md) — standardized, reproducible scenarios:
*   **Test A:** Over-engineering defense (Tier 1 typo correction)
*   **Test B:** Micro-error loop defense (Tier 2 bug resolution)
*   **Test C:** Attention loss and hallucination (Tier 3 module refactoring)
*   **Test D:** Knowledge boundary constraints (Offline hallucination prevention)
*   **Test E:** Terminal environment and shell awareness (Windows/Unix shell detection)
*   **Test F** (in VERIFICATION.md, not BENCHMARK_SOP.md): fact-audit discipline — does the agent verify an external-behavior claim before asserting it?

---

## 🤝 For Contributors

To contribute to Harness or modify any Skill behavior, ensure you run the local self-regression suite first:

```bash
# Run full hermetic static syntax & routing simulations
npm run self-regression
```

All script modifications must pass 100% cleanly before pushing to keep the runtime immunized against behavioral regression.

