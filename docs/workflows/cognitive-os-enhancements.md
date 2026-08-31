# Cognitive OS Enhancements: Architecture & Tooling Blueprint

## 1. Decision Statement

To comprehensively enhance the defensive depth and engineering coverage of Harness-everything without introducing additional Skills, we will synthesize the best practices from `agent-skills`, `mattpocock-skills`, and `reverse-skill` (a zero-trust security analysis framework). These concepts will be seamlessly integrated into a unified Software Development Life Cycle (SDLC) Pipeline within the Harness Cognitive OS.

Core objectives include:
1.  **Introduce Shared References**: Elevate engineering standards and defense-in-depth (inspired by `agent-skills`).
2.  **Establish The Golden Flow (Spec -> Audit -> Ticket)**: Reorder the lifecycle so that parallel audits and architectural grilling occur *before* code is written, ensuring flawless specifications are fed into `to-tickets` (inspired by the missing link between `agent-skills` and `mattpocock-skills`).
3.  **Inject Zero-Trust Boundaries (Scope Lock & Evidence Chains)**: Enforce strict modification boundaries and require hard evidence for all assertions before execution (inspired by `reverse-skill`).
4.  **Ensure Zero-Leakage Installations**: Support single-skill installation and safe dependency path resolution, ensuring no ghost files remain upon `uninstall`.

## 2. Architectural Adjustments

### 2.1 The Golden Flow & Dual-Phase Parallel Audits (Fan-out/Merge)
Instead of auditing only at the end of the lifecycle, we will implement a dual-phase audit strategy to catch design flaws early.
-   **Phase 1: Design Audit (Post `to-spec`, Pre `to-tickets`)**:
    -   After `to-spec` generates the PRD/Design Doc, invoke `multi-agent-workspace` for a Fan-out architectural audit (e.g., Security Auditor, Senior Architect).
    -   If flaws (e.g., over-engineering, logic gaps) are found, the process regresses to `to-spec`.
    -   `to-tickets` is only permitted to consume a *fully audited and approved* spec.
-   **Phase 2: Code Audit (Pre-Delivery in `fable-mode`)**:
    -   Before completing a Tier 3 task, launch parallel Sub-agents (QA, Security, Performance) to audit the Git Diff. Any `Blocker` regresses the flow to the `[Try]` phase.

### 2.2 Zero-Trust Boundaries & Evidence-Driven Context (Scope Lock)
Borrowing from the stringent operational security of `reverse-skill`, we will inject guardrails into the `[Think]` and `[Plan]` phases:
-   **Scope Lock (`scope.md` analogy)**: When `to-tickets` breaks down a Tier 3 macro task, it must explicitly declare the authorized modification boundaries (e.g., "Allowed to edit `src/billing/**`"). If `fable-mode` or a Sub-agent attempts to modify files outside this locked scope, the Harness hook will intercept and block the action (Exit 1) unless explicitly authorized by the user.
-   **Evidence Chains (`Evidence -> Finding -> Path`)**: When gathering context in `to-spec` or `to-tickets`, Agents are strictly forbidden from "guessing" the architecture. Every finding MUST be backed by an explicit evidence chain (e.g., "Based on reading `src/auth.ts` line 45, the API lacks token validation").

### 2.3 Shared References & Path Alignment
To allow all Skills (e.g., `todo-driven-workflow`, `security-review`) to share industry-standard checklists, we will:
-   Create a `references/` directory at the Harness repo root containing standard documents like `security-checklist.md`, `performance-checklist.md`, and `definition-of-done.md`.
-   **Copy on Install**: Modify `scripts/installer.js` so that when any Skill is installed, the `references/` directory is uniformly copied to the target platform's sandbox directory (e.g., `<platform-home>/harness-everything/references/`).
-   **Path Resolution**: Existing `SKILL.md` files referencing these checklists must use paths relative to the sandbox (e.g., `../harness-everything/references/security-checklist.md`) to ensure reliable reads across different platforms (VS Code, Claude Code, CLI).
-   **Clean Uninstall**: Because they are placed within the dedicated `harness-everything` directory, the existing `uninstall` logic can wipe them completely, guaranteeing zero project pollution.

### 2.4 CLI Enhancements for Single Skill Installation
To let users utilize Harness as an a-la-carte toolbox, we will expand the CLI tools (`bin/cli.js` and `scripts/installer.js`):
-   **New Command**: Support `npx github:dyphn1/Harness-everything install --skill <skill-name>`.
-   **Precise Registration**: Write only the specified Skill (and shared `references/`) into `manifest.json` and track its path.
-   **Clean Removal**: Users can perform targeted removals via `uninstall --skill <skill-name>`. `manifest.json` will accurately delete the record, and if emptied, automatically remove the sandbox directory.
-   **Global Mode Support**: Explicitly document the `--global` flag, encouraging users who want zero files in their workspace to install Harness in `~/.agents/`. Using `tier-router.js` will realize the powerful "zero project pollution" paradigm.

## 3. Implementation Steps

1.  **[ ] Create and populate the `references/` directory** (fill defensive baselines referencing `agent-skills`).
2.  **[ ] Modify `scripts/installer.js` and `bin/cli.js`**:
    -   Add logic to copy `references/`.
    -   Expose the `--skill <name>` flag and adjust the corresponding copy and `manifest.json` registration logic.
3.  **[ ] Upgrade `to-spec` and `to-tickets`**: 
    -   Integrate the `Evidence -> Finding` requirement during context gathering.
    -   Insert the Phase 1 Design Audit (Fan-out) link between Spec and Ticket generation.
4.  **[ ] Upgrade `fable-mode/SKILL.md`**: 
    -   Implement the Scope Lock mechanism (strict boundary enforcement).
    -   Implement the Pre-Delivery Code Audit (Fan-out/Merge) workflow.
5.  **[ ] Update Documentation (README / Docs)**: Document how to use single-skill installations and the `--global` mode, and update the verification cases (`VERIFICATION.md`).
