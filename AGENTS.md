---
description: "Harness OS Guidance (Advisory)"
applyTo: "**"
---
# Agent Instructions (Codex / AGENTS.md)

This file is advisory only - this platform has no hook/execution mechanism to
enforce it mechanically (unlike Claude Code's hook-based circuit breaker). Treat
these as strong defaults, not guarantees.

## 🚦 MANDATORY ENTRY TRIAGE & ROUTING (ALWAYS RUN FIRST)
Every time you receive a new prompt, you MUST load the `harness-everything` skill and immediately do the following:
1. **STOP.** You MUST use the `run_in_terminal` tool to run the Tier Router script: `node harness-everything/scripts/tier-router.js "<Brief summary of user's prompt>"`. Do NOT guess the tier.
2. Read the terminal output.
3. Output a clear, stylized routing checkpoint block at the VERY BEGINNING of your response to the user:
   ```markdown
   ## 🚦 Harness OS Routing Checkpoint
   - **Active Tier**: Tier 1 (Trivial) | Tier 2 (Standard) | Tier 3 (Macro)
   - **Rationale**: <1-sentence rationale from the tier router output>
   - **Routed Skills, Guides & Actions**:
     - `path/to/skill/or/guide.md` (<Brief reason why this guide/skill is loaded/used>)
   ```

## 🤖 COGNITIVE COMPLIANCE (NO SILENT DEGRADES FOR NEW FEATURES)
- **Newly Added Features / Extensions**: Copilot is highly prone to treating new feature requests as Tier 1 direct edits. If a task introduces *any* new logic, a new API endpoint, or a new file/module, you **MUST NOT** treat it as Tier 1. It **MUST** be treated as a **Tier 2 (Standard Task)** or **Tier 3 (Macro Task)**.
- **Tier 2 Activation**: Initialize the `todo-driven-workflow` checklist first. Summon Domain Experts based on tech stack. Load and execute the `tdd` (Test-Driven Development) skill (write tests first, implement, refactor).
- **Tier 3 Activation**: Initialize the `todo-driven-workflow` checklist, load `fable-mode` and `fable-discipline`, run sub-agents via `create-agent-launcher`, and write global docs using `repo-docs`.
- **Memory Summarization (Self-Evolve)**: Upon task completion, you **MUST** run the `self-evolve` skill (running `node self-evolve/scripts/self-regression.js` or writing memories) to record key insights, lessons learned, and error boundaries so your context builds across sessions.
- **Environment Discovery**: Discover the environment (OS, shell, package manager) before running commands - don't assume.
- **Rule of 3**: If the same error repeats 3 times in a row, STOP retrying. Explain what's failing and ask the human for direction instead of continuing to guess.
- **Prefer Editing**: Prefer editing over rewriting; commit logically complete chunks rather than one giant diff.

## ⚡ ALWAYS-ON ADHD-FRIENDLY OUTPUT SHAPING (GLOBAL NORMALIZATION)
Same rules as `install-cognitive-os/SKILL.md`'s "Global Output Normalization" section — open that file and apply them to every response, regardless of the active tier or which skill is executing. (Previously restated here in full; consolidated to one source per `docs/reports/skill-quality-audit-writing-great-skills-2026-07-22.md` §1.1 — this platform has no hook to force re-reading that file automatically, so open it explicitly at session start if it isn't already in context, the same way §🤖 above tells you to open `tdd`/`fable-mode` rather than inlining them here.)

