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

## [Unreleased]

## [0.2.0-alpha] - 2026-07-22

### Added
- **`skill-creator` skill**: merges principles from `mattpocock-skills/writing-great-skills` (predictability, information hierarchy, pruning, leading words, failure modes) and Anthropic's `skill-creator` (anatomy, progressive disclosure, testing workflow) into a Harness-native authoring/audit/testing workflow, reconciled against the existing Skill Contract convention rather than replacing it. Ships with a Quality Checklist and a Dynamic Skill Generation Contract that `self-evolve` now requires before packaging a session insight into a durable skill (written to `.harness/skills/generated/`, with `draft -> active -> deprecated` lifecycle metadata). Registered in `harness-everything/SKILL.md` §5 and `tier-router.js`'s skill-authoring keyword block.
- `docs/workflows/skill-creator.md`, matching the existing per-skill workflow-diagram convention (Behavior Workflow / Triggering & Routing Path / Real-World Use Case / Verification Check).
- **Skill Contract coverage**: All 25 `SKILL.md` files now carry a `📋 Skill Contract` table (Trigger/Input, Expected Output, State Mutations, Enforcement Gate) - up from 10/25.
- **Behavioral test wiring**: `eval-framework/behavioral-test.js` (the `todo-cli.js` state-machine E2E test) is now actually executed as Phase 3 of `npm test` / `self-regression.js`. It previously existed but was never invoked by any script, so it never ran automatically.

### Fixed
- **Installer uninstall safety**: `scripts/installer.js uninstall -y` no longer implicitly wipes global state (`~/.agents`, VS Code global prompts, global `.claude`/`.cursorrules`) just because it happens to detect a prior global install. Global removal now requires an explicit `--global`/`-g` flag, matching the interactive flow's existing unchecked-by-default behavior. The bug spanned two independent code paths (config removal and skill removal); both are fixed. Found via live testing on 2026-07-21 - a bare `uninstall -y` run from an unrelated test repo deleted real global Harness state.
- **Cross-file duplication**: the 33-line "ADHD-Friendly Output Shaping" block was duplicated verbatim across `install-cognitive-os/SKILL.md`, `harness-everything/SKILL.md`, and `AGENTS.md`. Consolidated to a single source (`install-cognitive-os`), with the other two replaced by a one-line pointer.
- **`tier-router.js` description drift**: six skills (`environment-detection`, `verify-before-claim`, `verification-loop`, `using-git-worktrees`, `fable-mode`, `grill-with-docs`) had inconsistently reworded one-line descriptions across the file's separate keyword blocks - including one outright inaccurate description of `verify-before-claim` (mislabeled as validating test assertions instead of external framework/API claims). Unified to one wording per skill everywhere it appears.
- `skill-style/SKILL.md`: removed a large copy-paste duplication of its own Skill Contract format example and Tone & Voice section.
- `AGENTS.md`: fixed a mislabeled `# Copilot Instructions` heading (the file is Codex's `AGENTS.md`, not Copilot's `.github/copilot-instructions.md`).
- `harness-everything/SKILL.md`: fixed a dangling pointer to a non-existent `harness-everything/adhd-output-shaping` path.

### Documentation
- **Skill quality audit**: Added `docs/reports/skill-quality-audit-writing-great-skills-2026-07-22.md`, a rule-based audit of all `SKILL.md` files against `mattpocock-skills/writing-great-skills` and Anthropic's `skill-creator`, with file:line evidence for every finding, a routing-consistency verification for the `install-cognitive-os` / `todo-driven-workflow` / `self-evolve` triad, and a record of the fixes applied above.
- **External evaluation report**: Added `docs/reports/evaluation-report-gemini-3.1-pro-2026-07-21.md`, an independent strict audit scoring the system 2-4/10 across the five core verification criteria (skill contract completeness, routing accuracy, test coverage, configuration balance, workflow conformance). The router fix (`f87bf34`) and the Skill Contract rollout (`7b2d04f`, completed above) were made in direct response to its findings.

### Corrected
- Removed a changelog entry from 2026-07-21 that claimed a self-authored "9.0/10 (Excellent)" evaluation and referenced `docs/reports/evaluation-report-harness-strict-2026-07-21.md`. That report was only ever committed on an unmerged branch (`test-fresh-env`) and never existed on `main`; several of its "PASS" rows were self-reported as untestable ("stdin not a TTY, cannot test directly") rather than actually run - an excuse that doesn't hold, since the same mechanism checks run fine over stdin in practice (see VERIFICATION.md §2). The external Gemini audit above is the only evaluation report that exists on `main`.
