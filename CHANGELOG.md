# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---
## [0.3.3-alpha] - 2026-08-13

### Added
- **CLI Commands (`harness next` & `harness verify`)**: Added `harness next "<prompt>"` and `harness verify` subcommands to `bin/cli.js` as thin wrappers around `tier-router.js` and `verify-gate.js`, enabling `npx github:dyphn1/Harness-everything next/verify` across all platforms (`7625a2f`).
- **Expressive CLI `--help` Interfaces**: Added CLI `--help`/`-h` options to agent-facing scripts (`todo-cli.js`, `persist-memory.js`, `register-dynamic-skill.js`, `check-project-docs.js`, and `evaluate.js`) to expose parameter schemas directly from code logic (`f1f4f11`).
- **OWASP & STRIDE Guides in Security Review**: Added OWASP patterns, STRIDE threat model guides, and `audit-secrets` script to `security-review` (`5df5844`).
- **Report Template Files**: Extracted report structures into dedicated template files for `zoom-out` (`zoom-out/templates/zoom-out-report.template.md`) and `verification-loop` (`verification-loop/templates/verification-report.template.md`) (`8b6724e`).
- **Git Worktree Concurrency Guidance**: Added Git Worktree concurrency isolation rules and cross-platform compatibility guidelines to `todo-driven-workflow` (`c3df2b3`, `c031aa1`).

### Fixed
- **Hookless Platform Routing Paths**: Fixed dead path issue in advisory text by updating hookless platforms (Codex, Cursor, Copilot, Continue, Hermes) to use `npx github:dyphn1/Harness-everything next/verify` (`7625a2f`).
- **Orchestrator Discoverability**: Surfaced `fable-orchestrator` as a discoverable sub-skill in `fable-mode/SKILL.md` and tier-router logic (`4ea61eb`).
- **Cross-Platform & Windows Compatibility**:
  - `find-skills`: Fixed Windows execution by invoking `npx.cmd` and enabling shell execution option (`2b678d6`).
  - `environment-detection`: Resolved Git Bash shell misidentification on Windows (`97c2f48`).
  - `rewrite-commits`: Prevented terminal hangs during interactive rebase by requiring explicit rebase abort on conflict (`c51a091`).
  - `verification-loop`: Removed POSIX pipeline (`head`/`tail`/`grep`) dependencies for cross-platform compatibility (`5f9c580`).
  - `execution-guardrails`: Replaced raw `sed` command suggestions with cross-platform native edit tools (`9a2fc78`).
- **Compliance Theater Prevention**: Updated `verify-gate.js` to output an explicit `UNCHECKED` warning when tests are missing instead of silently passing (`fb8c851`).
- **Self-Evolve & Path Fixes**:
  - Auto-create repo manifest directories and resolve script path references in `self-evolve` (`e0f0295`).
  - Resolved stale memory paths and relative agent definition references in `fable-haiku` (`962ff39`, `9975063`).
- **Circuit Breaker Deadlock**: Resolved tool name matching and session path deadlock in `zoom-out` (`46b4798`).
- **Manifest Loading in `to-spec`**: Fixed manifest helper module loading in `check-project-docs.js` (`142c668`).
- **Unlinked Launcher Files**: Linked orphaned workflow/template files in `create-agent-launcher` and unbound hard tool dependencies (`dbf075f`).

### Changed
- **Progressive Disclosure & Gentle Guidance**: Streamlined `git-commit`, `create-agent-launcher`, and `cognitive-os` skills to follow progressive disclosure, replacing rigid commands with adaptable entrypoints (`5df5844`, `8a6a48f`, `b53d9d5`, `d84147b`, `a1234da`).
- **Path Portability**: Standardized script path invocation references across `SKILL.md` files to use `<this-skill-dir>` and `npx` commands (`30bc368`).
- **Single Source of Truth for Platform Notes**: Centralized platform availability notes across `zoom-out`, `todo-driven-workflow`, `install-cognitive-os`, and `create-agent-launcher` to link to README's supported tools table (`8b6724e`).
- **Subagent Scope Guard Awareness**: Integrated `subagent-scope-guard` awareness across `fable-mode` and launcher workflows (`b9a4a42`).
- **Gitignore Auto-Rules**: Added auto-generated comment banner for Harness OS ignore rules in `.gitignore` (`30bc368`).

### Removed
- **Unverified Platform References**: Removed dangling, unverified Gemini CLI references and deleted the orphaned `platform-gemini.md` guideline (`e427bee`).
- **Obsolete Style Docs**: Removed obsolete `STYLE.md` and updated missing single-skill templates in `repo-docs` (`2d98ceb`).

---
## [0.3.2-alpha] - 2026-07-28

### Fixed
- **Platform Self-Heal Overkill**: Completely redesigned the environment and workspace detection algorithm in `self-heal.js` and `bootstrap.js`. Replaced the overly-broad binary if-else check (which fell back to auditing and generating files for all other 5 non-Claude platforms when Claude Code env was absent) with a precise dual-track platform detection strategy based on environment variables (like `TERM_PROGRAM`, `CURSOR_SANDBOX`, and `GITHUB_COPILOT_CHAT`) and existing configuration files. This ensures that the self-healing and bootstrap processes only target and audit platforms that are actively used or pre-configured in the project, eliminating accidental file pollution for other platforms.
- **Gitignore Suffix Matching**: Appended `.github/harness-everything/state/` to the ignore rules to prevent tracking state files for the Copilot integration.

---
## [0.3.1-alpha] - 2026-07-28

### Added
- **Expanded Routing Keywords**: Expanded routing keywords derived from user history and resolved regex preemption in `tier-router.js`.
- **Adjusted Default Skills**: Adjusted default skills configuration and unified command-line option indicators within the installer.

### Fixed
- **Legacy Hook Identification**: Supported robust legacy hook identification during global uninstallation.

### Changed
- **Pipeline Refactoring**: Integrated `grill-me` and `grill-with-docs` into a cohesive companion pipeline.

---
## [0.3.0-beta] - 2026-07-27

### Added
- **Modular Mechanism Tests**: Completely split the monolithic mechanism-test suite into 8 isolated, highly cohesive `.test.js` modules (`mechanism-2a` through `mechanism-2h` under `eval-framework/`) for superior traceability and ease of debugging.
- **Unified Test Helper**: Created `eval-framework/test-helper.js` managing mock execution directories, teardown life cycles, and child processes safely across all mechanism test runs.
- **Selective Gitignore Exclusion Tests (`mechanism-2g`)**: Added full validation tests for selective `.gitignore` exclusion algorithms across different developer platforms.
- **Installer & Manifest Serialization Tests (`mechanism-2h`)**: Implemented complete testing coverage for the installer manifest, metadata parsing, dynamic-skill registration, and automatic cleanup of empty manifest files.

### Fixed
- **Platform Gitignore Exclusion Overkill**: Fixed a critical bug in `hooks/scripts/lib/platforms/*.js` where the installer incorrectly added the entire workspace-level `.claude/skills` (or `.cursor/skills`, `.github/skills`, etc.) to `.gitignore`, silently blocking developers from committing their custom project-specific skills to version control. It now dynamically reads each skill's `SKILL.md` frontmatter and only ignores verified Harness core/system skills, keeping custom skills fully trackable.
- **Redundant Gitignore Suffix Matches**: Optimized platform ignore matching (`isMatch` in platform helper modules) to prevent appending redundant nested directories to `.gitignore` when parent directories (e.g. `.claude/` or `.cursor/`) are already broadly ignored.

### Changed
- Refactored `eval-framework/mechanism-test.js` to serve as a dynamic test orchestration runner. It auto-discovers all mechanism test suites, executes them sequentially under isolated environments, and outputs a clean console summary table at the end.
- Updated `VERIFICATION.md` and `docs/audit.md` to reflect the newly modularized test suites, raising the system-wide test coverage and capability scorecard to 9.0/10.

---
## [0.3.0-alpha] - 2026-07-26

### Added
- **`to-spec`**: adaptive spec/doc skill (feature spec, CLI/API reference, schema-doc, or dev-doc shape) chained after `grill-with-docs`/`grill-me`, advisory-only, with a one-time `check-project-docs.js` setup gate persisted in this repo's own `manifest.json`.
- **`to-tickets`**: breaks a `to-spec` doc (or an already-settled plan/conversation) into tracer-bullet tickets with declared blocking edges, reusing `to-spec`'s project-docs gate rather than a second interview.
- **`find-skills`**: external skill discovery via skills.sh/`npx skills`, defaulting to a zero-footprint ephemeral apply (content-addressed OS-temp cache) instead of caching third-party metadata in `manifest.json`; permanent install (`npx skills add`) remains an explicit, rare opt-in.
- Self-evolve's dynamic skills now register in `manifest.json` and get precise trigger matching from `tier-router.js`, so a lesson learned in one session is auto-surfaced in later ones.
- CI: `.github/workflows/ci.yml` runs `npm test` on push/PR across `ubuntu-latest` and `windows-latest`.
- `verify-gate.js` now runs the target project's real `lint`/`test` scripts (via the detected package manager) instead of a simulated stub, with a self-recursion guard (`HARNESS_SKIP_PROJECT_CHECKS`).

### Fixed
- `tier-router.js` resolved `workspaceRoot` via a `__dirname` offset that only ever worked inside this source repo — real installs could never find their `manifest.json`, silently killing dynamic-skill auto-discovery outside of development. Now walks up from `cwd` to the nearest `.git`.
- Installer's legacy-skills cleanup deleted `self-evolve`'s entire `skills/generated/` directory on every install/uninstall of Claude Code skills. Now only removes non-generated legacy subdirectories.
- `self-regression`'s syntax-check phase didn't cover `to-spec`/`to-tickets` scripts.
- Dynamic skill registration: removed an unconditional manifest rescan firing on every memory persist, tightened fallback trigger inference, made `triggers:` a required dynamic-skill frontmatter field, and fixed a broken Mermaid fence in `docs/workflows/skill-creator.md`.

### Changed
- Cognitive OS "iron laws" decoupled from one shared file and woven directly into the specific skill phase each governs.
- `tier-router.js`'s keyword/guide tables extracted into a sibling `routing-keywords.json` (fails open to Tier 1 if the file is missing or invalid).
- README and `docs/reflection.md` updated to describe six core modules (was five) and both `self-evolve` persistence paths (simple rule vs. dynamic skill).

### Documentation
- README restructured to be user-facing; audit scorecards, the 2026-07-23 mis-measurement incident, and the per-cycle change log moved to new `docs/audit.md`.
- New "What Gets Installed (and How to Remove It)" README section.
- `harness-everything/SKILL.md` section numbering fixed (§5 registry now precedes §6) and tier-following wording aligned with the router's actual output.

---
## [0.2.1] - 2026-07-24

### Fixed
- **Global skill installs landed one directory too deep**: `--global`/`-g` installs (all platforms share this one code path) copied skills to `~/.agents/harness-everything/skills/` instead of the documented `~/.agents/skills/` (see `bin/cli.js`'s own `-g, --global` help text, and the legacy-fallback scan `scripts/lib/skills.js` already expected at that path). Corrected in `scripts/installer.js` to match the same convention already used locally: `harness-everything/` holds manifest bookkeeping only, skill content lives in the native/shared `skills/` folder next to it. `~/.agents/harness-everything/manifest.json` is unchanged; uninstall's final global sweep was updated to match.
- **Duplicate lines could accumulate in `.gitignore`**: `ensureHarnessStateIgnored` (`hooks/scripts/lib/harness-state.js`) runs once per hook-invoked subprocess with no cross-process lock around its read-then-append, so two invocations firing close together could both decide the same ignore pattern was missing and both append it. It (and the installer's own `scripts/lib/gitignore.js` writer, which shares the identical shape) now collapses exact-duplicate non-comment/non-blank lines on every write, so a duplicate from a lost race self-heals on the next invocation instead of accumulating.

---
## [0.2.0] - 2026-07-23

### Added
- **Multi-Platform State Isolation Strategy**: Designed and created a registry for developer platforms (`claude.js`, `cursor.js`, `copilot.js`, `continue.js`, `codex.js`, `hermes.js`, `worktrees.js`) dynamically managing state folders (`getStateDir`) under respective tool namespaces (e.g. `.github/harness-state/`, `.cursor/harness-state/`) instead of hardcoding `.claude/harness-state/`.
- **Runtime and Install-Time Auto-Ignore Defense**: Automated self-exclusion by writing active platform patterns directly to `.gitignore` seamlessly during both runtime execution checkpoints and local setup/installation.
- **Per-platform install manifest**: every install now writes `<platform-dir>/harness-everything/manifest.json` (e.g. `.claude/harness-everything/manifest.json`, and a shared `~/.agents/harness-everything/manifest.json` for global scope), recording exactly which skill directories this package put where. All 23 `SKILL.md` files now carry `author`/`version` frontmatter, which the manifest cross-checks against before ever removing a directory.

### Fixed
- **Uninstall could delete content it didn't install**: `uninstall --skills`/interactive "Remove ALL" used to list every subdirectory under shared skill folders (`~/.agents/skills`, `.harness/skills`, …) as "installed," including a user's own manually-placed skills and `self-evolve`'s locally-generated `skills/generated/*`. Global uninstall additionally `rm -rf`'d all of `~/.agents` outright. Removal is now manifest-driven and author-marker-verified per skill, and global uninstall only ever touches its own `harness-everything/` subfolder — never `~/.agents` itself.
- **Claude hook removal false-positive**: the fallback matcher removed any hook whose command merely *contained the substring* "harness," which could catch an unrelated hook from another tool. Removal now keys solely off the `harness:` id namespace every hook this package ships already carries.

### Changed
- **`scripts/installer.js` split into `scripts/lib/`**: the single ~1200-line file (TUI, hook merge, advisory-text injection duplicated twice, skill copy, gitignore upkeep all mixed together) is now an orchestrator over `lib/manifest.js`, `lib/skills.js`, `lib/claude-hooks.js`, `lib/advisory-text.js`, `lib/gitignore.js`, `lib/prompts.js`, and `lib/workspace.js`.
- **Local runtime state relocated under `<platform-dir>/harness-everything/`**: the self-invented top-level `.harness/` root (Claude's manifest + skill copies) is retired in favor of `.claude/harness-everything/{state,skills,manifest.json}` — a subfolder of Claude's own directory that nothing else creates, so it can be added/removed as a unit. Each other platform's own `harness-state/` similarly moves to `<platform-dir>/harness-everything/state/`, alongside its own new `manifest.json`. Skill locations for Cursor/Copilot/Continue (`.cursor/skills`, `.github/skills`, `.continue/skills`) are unchanged. A one-time migration step removes any leftover `.harness/` on next local uninstall.
- **Codex skill target corrected from `.agents/skills/` to `.codex/skills/`**: `.agents/` was never a real Codex CLI convention — Codex's actual project-scoped home is `.codex/` (`.codex/skills/` for project skills, `.codex/config.toml` for CLI/sandbox config), confirmed against OpenAI's own docs. This bug predated this release. `getInstalledSkills` still scans the old `.agents/skills/` location as a legacy fallback so existing wrong-location installs remain discoverable and cleanly removable.
- **Author attribution**: `author` frontmatter across all 23 `SKILL.md` files, `package.json`, and the `HARNESS_AUTHOR` constant `scripts/lib/skills.js`'s uninstall safety check matches against, updated from `Harness Core Team` to `Miya Daniel | Harness Core Team`.

### Documentation
- Removed dangling `docs/reports/` links from `README.md`, `VERIFICATION.md`, `harness-everything/SKILL.md`, `skill-creator/SKILL.md`, and `skill-creator/references/quality-principles.md` — the referenced audit report files were removed from the repo; `VERIFICATION.md`'s own instruction to store *future* reports under `docs/reports/` is unaffected.

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

## [0.2.0-beta] - 2026-07-22

### Fixed
- **`uninstall` command unreachable via CLI**: `bin/cli.js`'s command dispatcher never had a `case 'uninstall'` - `scripts/installer.js` has handled `uninstall` internally since it was added, but the CLI entrypoint's `switch` fell through to `default` and printed `[Error] Unknown command: "uninstall"` before ever reaching it, making `npx github:dyphn1/Harness-everything uninstall` unusable regardless of flags. Added the missing case (routes to the same `runInstaller` path as `install`, since `installer.js` reads the command off `process.argv` itself) and documented `uninstall`'s flags in `--help`.

### Added
- **Continue.dev and Hermes Agent platform support**: `scripts/installer.js` now accepts `--continue` and `--hermes` (also included in `--all`). Continue.dev gets a dedicated `.continue/rules/harness.md` rule file (YAML frontmatter, `alwaysApply: true` — Continue's native rules format is one Markdown file per rule rather than a single shared file, so unlike Cursor/Copilot/Codex, Harness never appends into an arbitrary pre-existing file); global scope writes to `~/.continue/rules/harness.md`. Hermes Agent ([Nous Research](https://hermes-agent.nousresearch.com/)) gets `.hermes.md`, which Hermes auto-loads into its system prompt alongside `AGENTS.md`/`CLAUDE.md`/`.cursorrules` if present — project scope only, since Hermes has no documented global project-instructions equivalent (`--global --hermes` is a deliberate no-op with an explanatory message, not a guess). Both platforms are advisory-only (no hook/exit-code mechanism), matching Cursor/Copilot/Codex. `harness-everything/scripts/self-heal.js` and the uninstall path cover both new touchpoints. Updated `README.md`, `docs/architecture.md`, `VERIFICATION.md`, and `BENCHMARK_SOP.md` accordingly.

### Fixed
- **Runtime state scattered across the tree**: 4 of the 12 scripts that touch `.harness/*` state (`context-compact.js`, `rule-of-3.js`, `rule-of-3-tracker.js`, `harness-everything/scripts/todo-cli.js`) resolved their state directory from `process.cwd()` directly instead of walking up to the git root the way the other 8 did — a hook firing with a `cwd` that wasn't the repo root would create a fresh, orphaned `.harness/` wherever it stood. All state-path resolution is now centralized in one helper (`hooks/scripts/lib/harness-state.js`), so every script agrees on where state lives.

### Changed
- **Runtime state moved to `.claude/harness-state/`, scoped per Claude Code session**: `.harness/` mixed two unrelated things — the installer's local skill-copy target (`.harness/skills/`, a peer of `.cursor/skills`/`.github/skills`, untouched by this change) and pure runtime state (handoff/verification timestamps, circuit-breaker counters). The latter now lives at `.claude/harness-state/`. Hook-owned files (`handoff-state.json`, `stop-gate-state.json`, `subagent-scope-state.json`, `rule-of-3-state.json`, `context-compact-state.json`, `atomic-commit-state.json`, `zoom-out-report.md`) are scoped under `sessions/<session_id>/`, so two Claude Code sessions open on the same repo no longer share — and stomp — each other's edit/verify timestamps or breaker counts. `contracts/*.json` (written proactively by fable-orchestrator, which has no clean way to learn its own `session_id`) and `todo-state.json` (written via a plain CLI call, not a hook) stay shared across sessions, matching prior behavior — collision there is a narrower, lower-stakes edge case than the timestamp/counter files. `rule-of-3.js` keeps its no-stdin fast path for the common case (nobody's breaker tripped anywhere) via a cheap scan across session directories, only paying to read the hook payload once some session actually trips. `bootstrap.js` now also prunes session directories untouched for 14+ days, since nothing else purges them the way an OS temp directory would. `scripts/installer.js uninstall` removes `.claude/harness-state/` alongside the existing `.harness/` cleanup. Updated `VERIFICATION.md`, `docker-verify.sh`, `docs/architecture.md`, `fable-mode/CONTRACT-FORMAT.md`, `fable-mode/agents/fable-orchestrator.md`, and all affected `SKILL.md` state-mutation references accordingly.

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
