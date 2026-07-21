# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [0.1.0-beta] - 2026-07-20

### Added
- Implemented strict boundaries and self-healing mechanisms for Harness core.
- Added interactive setup and modular skill installation to the installer.

### Changed
- Promoted to beta release for broader testing and validation of the Harness OS capabilities.
- Renamed references from `harness-skills` to `harness-everything` across the codebase.

### Documentation
- Updated `git-commit` guidelines to disallow blank lines between bullet points in the Angular style guide.

## [0.1.0-alpha] - 2026-07-20

This is the initial alpha release of **Harness OS** — a lightweight, local behavior and orchestration runtime that wraps around AI development sessions to enforce self-regulation, prevent token-wasting infinite loops, and eliminate environment hallucinations.

### Added

#### 1. Core Behavior Layer & Guards (Circuit Breaker & Context Safety)
- **`rule-of-3`**: Fail-safe circuit breaker. Tracks command failure signatures. If a command/test fails 3 times with the exact same signature, it locks mutating tools and triggers the **Zoom-Out Reflection Protocol**, requiring a structured diagnosis report (`zoom-out-report.md`) to release or escalates to a human.
- **`boundary-guard`**: Limits oversized file reads (preventing >600KB reads) and logs warnings to shield the model from "lost-in-the-middle" context degradation.
- **`stop-gate`**: Bounces the end of an edit turn once to ensure that file changes are always verified by a compiler/test command.
- **`subagent-scope-guard`**: Protects out-of-scope files from being accidentally modified by background or subagent processes.
- **`state-persist` (WAL)**: Write-Ahead Logs that preserve agent failure signatures and recovery status across tool invocations.

#### 2. Task Routing Engine
- **`tier-router`**: Triages user requests into three precise execution tiers:
  - **Tier 1 (Direct Edit)**: Small bugfixes, typos, or single-file changes.
  - **Tier 2 (TDD Red-Green-Refactor)**: Standard features requiring tests and validation loops.
  - **Tier 3 (Macro Multi-Agent Flow)**: Comprehensive architectural refactoring requiring multi-agent delegation.

#### 3. Environment Detection & Preflight Audit
- **`preflight`**: Automatically executes at session startup to print a diagnostic block identifying the Host OS (Windows/macOS/Linux), active shell, and package managers, neutralizing path and shell command hallucinations.

#### 4. Multi-Agent Scaffolding & Specialized Workflows
- **`create-agent-launcher`**: Templates and workflows for spinning up context-specific specialized subagents (`backend-developer`, `memory-keeper`, `requirement-analyzer`, etc.).
- **`fable-mode`**: Specialized multi-agent orchestrator for bulk text processing, validation, and verification (with Orchestrator, Verifier, and specialized Worker agent roles).

#### 5. Evaluation & Verification Suite
- **`eval-framework`**: Automated evaluation cases (case 1 to 5) covering multiple complexity levels and support for multi-language (en/zh) prompt classification.
- **`VERIFICATION.md` & `docker-verify.sh`**: A comprehensive mechanism verification test suite that locally executes sandbox environment simulations to prove terminal blocking and self-recovery behaviors.

## [Unreleased] - 2026-07-21

### Added
- **Strict Evaluation Report**: Generated comprehensive strict evaluation report (`docs/reports/evaluation-report-harness-strict-2026-07-21.md`) following the most rigorous verification checklist.

### Testing
- **Mechanism Checks**: Verified all core mechanisms (Rule of 3 circuit breaker, boundary guard, state persistence, fact-audit reminder, subagent scope guard, stop gate).
- **Behavioral Tests**: Executed Test F (Fact-audit discipline) with **PASS** result - agent correctly emitted FACT-AUDIT REMINDER instead of answering from memory.
- **Workflow Conformance**: Confirmed execution sequences align with `docs/workflows/` definitions.
- **Self-Heal Mechanism**: Successfully auto-repaired missing integration touchpoints (`.cursorrules`, `.github/copilot-instructions.md`, `AGENTS.md`).

### Documentation
- **Evaluation Reports**: Added strict evaluation report template with detailed scoring matrix and improvement recommendations.

### Performance
- **Overall Score**: **9.0/10** (Excellent) in GitHub Copilot environment.
- **Core Verification Criteria**: 9.2/10 average across all five core criteria.
- **Platform Compatibility**: Full support on advisory platforms with auto-repair capabilities.
