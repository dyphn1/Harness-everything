---
name: harness-everything
description: The single entry point and dynamic router for the Harness ecosystem. Triage tasks into Tier 1, 2, or 3.
author: Harness Core Team
version: 0.2.0-rc.1
---

# Harness Everything (System Main Entry & Dynamic Router)

## 📋 Skill Contract

| Component | Specification |
| :--- | :--- |
| **Trigger / Input** | Every new user request where no specific skill is already indicated — the mandatory first load, run via `scripts/tier-router.js "<prompt>"`. |
| **Expected Output** | A Tier determination (1/2/3) and a mandatory "🚦 Harness OS Routing Checkpoint" block at the very start of the response, listing the tier, rationale, and routed skills/guides. |
| **State Mutations** | None directly — orchestrates which other skills/guides get loaded and, for Tier 2/3, triggers `todo-driven-workflow` checklist initialization. |
| **Enforcement Gate** | **MUST** run `scripts/tier-router.js` (or reuse the `UserPromptSubmit` hook's output for the same turn) before deciding the tier — the routing checkpoint output is mandatory, not optional. Rule of 3: 3 consecutive failed fix attempts on the same signature **MUST** stop further edits and force `zoom-out`. |

This is the single entry point for the entire Harness Skills ecosystem. When you receive a new request from the user and no specific Skill is indicated, you **MUST** prioritize loading this Skill to perform Task Triage.

## 1. Core Rule: Global Underlying OS & Base Execution Loop
Before taking any action, you must awaken and load the principles of `install-cognitive-os`.
No matter how simple the task is, your behavior must comply with the **Discover > Think > Try > Summarize > Record** cognitive loop.
Never rush to act before understanding the environment; establish contextual awareness first.

**Base Execution Loop (`todo-driven-workflow`)**: The cognitive loop above defines *how you think*; `todo-driven-workflow` defines *how you execute*. For every **Tier 2 and Tier 3** task, you MUST load `todo-driven-workflow` and initialize its checklist BEFORE editing any file — it is the foundational step-by-step execution layer of this harness (break down into 3-7 verifiable sub-tasks, one `in-progress` at a time, verify with real evidence before marking `completed`). Tier 1 tasks are exempt to avoid checklist bloat.

**Always-On Disciplines** (apply on every tier, alongside the loops above):
- `fable-mode/execution-guardrails` — verify-before-flag, warning batching, find-and-replace safety. These are behavioral contracts, not Tier-3-only rules.
- `verify-before-claim` — never assert external framework/API behavior or unmeasured performance numbers from training memory; verify against an authoritative source first.
- `install-cognitive-os`'s Global Output Normalization — lead with direct answers, suppress preambles/recaps/pleasantries, and enforce natural locale terminology (§6).

**Self-Healing Toolchain (工欲善其事,必先利其器)**: The harness may have been installed from a different editor than the one currently running (e.g., installed via Claude Code, now opened in Copilot). During the `[Discover]` phase, audit the workspace's integration touchpoints and repair any that are missing — the script is idempotent and delegates to the installer, so re-running is always safe:
```bash
node "<this-skill-dir>/scripts/self-heal.js"          # audit + auto-repair missing touchpoints
node "<this-skill-dir>/scripts/self-heal.js" --check  # audit only, never writes
```
Also run this immediately whenever the `bootstrap.js` SessionStart output shows a `[Self-Heal] Missing integration touchpoints` warning. Exception: if the user says they intentionally removed one of these files, respect that and do not re-create it.

## 2. Task Triage
To avoid "over-engineering" and maximize efficiency, you must categorize the user's task during the `[Think]` phase and take the corresponding action path.
- **MANDATORY**: Run the Tier Router script before deciding the tier. The script lives at `scripts/tier-router.js` **inside this skill's own directory** — resolve the path from wherever this SKILL.md was loaded (do not guess a hard-coded location):
  ```bash
  node "<this-skill-dir>/scripts/tier-router.js" "<Brief summary of the user's prompt>"
  ```
- You MUST follow the `REQUIRED TIER` output by the script.
- If a `UserPromptSubmit` hook already ran the router this turn (its `[Tier Routing Pre-check]` output is visible in context), reuse that output instead of running it again.

### Mandated Routing Checkpoint Output
At the very beginning of your response to the user, you **MUST** output a clear, stylized routing report. This report is mandatory for all entries via `harness-everything`. It must list the determined Tier and the exact routing targets:
```markdown
## 🚦 Harness OS Routing Checkpoint
- **Active Tier**: Tier X (Tier Name)
- **Rationale**: Short 1-sentence reason from the tier router.
- **Routed Skills, Guides & Actions**:
  - `path/to/skill/or/guide.md` (Brief description of why this applies)
  - ...
```

### Proactive Copilot & VS Code Instruction (Avoid Silent Degrades)
If you are running in VS Code or GitHub Copilot, you do not have automated hooks to run scripts on your behalf.
- You **MUST** proactively run the tier-router script (`node harness-everything/scripts/tier-router.js "<prompt>"`) or simulate its routing logic manually at the start.
- **NEVER degrade newly added features or structural extensions to Tier 1.** Copilot is highly prone to treating new feature requests as trivial Tier 1 direct edits. If the request adds *any* new logic, a new API endpoint, or a new file/module, it **MUST** be triaged as **Tier 2 (Standard Task)** or **Tier 3 (Macro Task)**. This activates:
  1. The `todo-driven-workflow` checklist (mandatory step-by-step progress tracking).
  2. Multi-agent spawning / sub-agents via `create-agent-launcher` or macro plan orchestration via `fable-mode`.
  3. The memory summarization & evolution sequence via `self-evolve` upon completion, ensuring new knowledge is registered in workspace memory.

### Tier 1: Trivial Tasks & Daily Chores
- **Characteristics**: Fixing typos, simple modifications to a single function, asking/explaining code, syntax adjustments. Or simple `git-commit` and `rewrite-commits`.
- **Action Strategy (Direct Execution)**:
  - **PROHIBITED** from writing large plans.
  - **PROHIBITED** from calling `create-agent-launcher` or `fable-mode`.
  - Execute the modification directly based on requirements, or load `git-commit` / `rewrite-commits`. Perform a simple `[Record]` after modifying.

### Tier 2: Standard Tasks & Architectural Review
- **Characteristics**: Adding a single API endpoint, fixing a specific bug, modifications requiring coordination across 2-3 files. Or requiring stress testing and benchmark evaluation for specific designs.
- **Action Strategy (TDD, Deep Context & Domain Expertise)**:
  - **Initialize the Base Execution Loop**: Load `todo-driven-workflow` and lay out the checklist first (the TDD Red/Green/Refactor phases map naturally onto todo items).
  - **Information Depth Requirement**: Before entering TDD, you MUST perform a deep context trace (find references, call sites, and related interfaces). Superficial fixes that break dependencies are strictly forbidden.
  - **Load Domain Experts (領域專家召喚)**: Based on the tech stack detected in Tier 1, explicitly search for and load the corresponding **Domain Skills** (e.g., `security-review` from this repo, or `frontend-patterns` / `api-design` from the user's legacy skill library) to inject robust expert knowledge into your context.
  - Development tasks: Automatically load and follow the `tdd` (Test-Driven Development) skill. Write tests first (Red) -> Implement (Green) -> Refactor.
  - Before starting feature work on a busy repository, consider loading `using-git-worktrees` to isolate your workspace and prevent workspace pollution.
  - If the user requests grilling or refactoring a plan, load `grill-me` (pure Q&A) or `improve-codebase-architecture` (deep architectural analysis).
  - If the user requests "scoring" or "benchmark comparison", load `eval-harness` for quantitative scoring and summarization.
  - **Pre-Delivery Gate**: Before declaring the task done or creating a PR, load `verification-loop` (build / types / lint / tests / security scan / diff review). For changes touching auth, input handling, secrets, or network boundaries, additionally load `security-review`.

### Tier 3: Macro Tasks & Documentation
- **Characteristics**: New project initialization, low-level architecture refactoring, vague and massive requirements (e.g., "Help me write a user login system"). Or lack of global documentation.
- **Action Strategy (Multi-Agent Orchestration & Domain Infusion)**:
  - If initializing a multi-agent system workspace, load `build-multi-agent-system` to scaffold the 6 functional zones, memory relational indexes, and immutable routing laws.
  - If project-level documentation needs to be created, load `repo-docs`.
  - If establishing a large system design, strongly recommend loading `grill-with-docs` first to document decisions (ADR, CONTEXT) before proceeding.
  - **Sub-Agent Specialization**: When calling `create-agent-launcher`, you MUST inject robust Domain Skills into the sub-agent's persona (e.g., passing `database-reviewer` and `backend-patterns` to a Backend Sub-Agent). Do not create generic, empty-shell agents.
  - Development execution: Automatically load `fable-mode` and `fable-discipline`. The macro plan produced in fable-mode's Discovery phase MUST be materialized as the `todo-driven-workflow` checklist — sub-agent handoffs and milestone checks are tracked there, not in prose.
  - **Pre-Delivery Gate**: Same as Tier 2 — run `verification-loop` (and `security-review` where applicable) before the final handoff.

## 3. Foolproofing & Circuit Breaker Mechanism
LLMs have a Reasoning Ceiling. To avoid invalid infinite retries, you must strictly obey the following limits:
- **Rule of 3**: If attempting to fix the same Bug or test failure fails 3 times consecutively, **STOP modifying code immediately**.
- **Trigger Circuit Breaker**: Forcefully call the `zoom-out` skill — rebuild the full picture, fact-check the assumption behind each failed attempt with read-only tools, and write the reflection report. Most trips should end in **self-recovery on a fresh diagnosis**, not a cry for help.
- **Seek Human Help — only for genuine decisions**: Escalate when zoom-out concludes the blocker is a human call (requirement conflict, architecture trade-off, destructive action, missing access), or when the breaker hard-locks on a second trip of the same signature. Present verified facts and 2-3 options with a recommendation — never a bare "I'm stuck".

## 4. Evolution Loop
- When the circuit breaker is triggered and the problem is ultimately solved — whether by post-reflection self-recovery or with human intervention.
- Or, when you have expended great effort to overcome difficulties and complete a complex task.
- You **MUST** automatically call the `self-evolve` skill to write "human key insights" or "successfully avoided traps" into system memory, ensuring the same blind spots are bypassed next time.

## 6. Always-On ADHD-Friendly Output Shaping
This is the same always-on discipline `install-cognitive-os` defines under its own §"Global Output Normalization" — this router doesn't restate it (that duplication was flagged in [`docs/reports/skill-quality-audit-writing-great-skills-2026-07-22.md`](../docs/reports/skill-quality-audit-writing-great-skills-2026-07-22.md) §1.1 and has been removed). Since §1 already sends every task through `install-cognitive-os` before any action, its output-shaping rules are already in effect by the time this router does anything — apply them as written there, on every response, regardless of tier.

## 5. Skill Registry (Full Activation Map)
Every skill in this repository is reachable from this router. If a task matches a trigger below and the skill is not yet loaded, load it.

| Skill | Layer | Activated when |
| :--- | :--- | :--- |
| `install-cognitive-os` | Foundation | Always, before any action (§1). |
| `todo-driven-workflow` | Foundation | Every Tier 2/3 task — the base execution loop (§1). |
| `environment-detection` | Foundation | Session start / `[Discover]` phase, before running shell commands. |
| `fable-mode/execution-guardrails` | Always-on discipline | Every tier: flagging problems, batching warnings, find-and-replace edits (§1). |
| `verify-before-claim` | Always-on discipline | Before asserting external-system behavior or unmeasured numbers (§1). |
| `git-commit` / `rewrite-commits` | Tier 1 | Commit creation / history rewriting. |
| `tdd` | Tier 2 | Feature/bugfix development (Red-Green-Refactor). |
| `using-git-worktrees` | Tier 2 | Isolating feature work on a busy repository. |
| `grill-me` | Tier 2 | User asks to be grilled on a plan (pure Q&A). |
| `improve-codebase-architecture` | Tier 2 | Deep architectural analysis / refactor planning. |
| `eval-harness` | Tier 2 | Scoring, stress testing, benchmark comparison. |
| `verification-loop` | Tier 2/3 gate | Before declaring done or creating a PR. |
| `security-review` | Tier 2/3 gate | Changes touching auth, input handling, secrets, network boundaries. |
| `fable-mode` | Tier 3 | Macro task planning & execution engine. |
| `fable-discipline` | Tier 3 | Risk control paired with fable-mode. |
| `fable-mode/fable-haiku` | Tier 3 (opt-in) | User explicitly asks for staged execution run cheaply on Haiku. |
| `create-agent-launcher` | Tier 3 | Spawning specialized sub-agents. |
| `build-multi-agent-system` | Tier 3 | Scaffolding a multi-agent workspace. |
| `repo-docs` | Tier 3 | Creating project-level documentation. |
| `grill-with-docs` | Tier 3 | Documenting decisions (ADR / CONTEXT) before large designs. |
| `zoom-out` | Circuit breaker | Rule of 3 trips (§3). |
| `self-evolve` | Evolution | Post-breaker resolution or major breakthrough (§4). |
| `skill-style` | Meta | Authoring or modifying any SKILL.md in this repository — the terse Skill Contract format spec. |
| `skill-creator` | Meta | Creating a new skill from scratch, auditing/refactoring an existing SKILL.md, or `self-evolve`'s dynamic skill generation step (§4) — the fuller authoring, quality-checklist, and testing workflow built on `skill-style`. |

(`eval-framework/` is internal CI for the router itself — run `node eval-framework/runner.js` after modifying `tier-router.js`; it is not a routable skill. Likewise `scripts/self-heal.js` in this skill is infrastructure, invoked during `[Discover]` per §1.)
