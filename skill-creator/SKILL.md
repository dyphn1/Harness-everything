---
name: skill-creator
description: Author, audit, and refactor SKILL.md files against a single quality bar — the Skill Contract format plus predictability/pruning/progressive-disclosure principles from external skill-writing research. Use when creating a new skill from scratch, reviewing or refactoring an existing SKILL.md, checking whether two skills overlap, or when self-evolve needs to package a session's learning into a durable dynamic skill.
---

# Skill Creator (Skill Authoring, Audit & Evolution Workflow)

## 📋 Skill Contract

| Component | Specification |
| :--- | :--- |
| **Trigger / Input** | Creating a new skill from scratch; auditing/refactoring an existing `SKILL.md`; `self-evolve`'s Step 3 packaging a session's insight into a durable dynamic skill. Input: a task description, an existing SKILL.md, or a root-cause insight from self-evolve. |
| **Expected Output** | A `SKILL.md` that passes the Quality Checklist (§3) — static skills at `<skill-name>/SKILL.md` with a `harness-everything` registry row, dynamic skills at `.harness/skills/generated/<skill-name>/SKILL.md` with lifecycle metadata (§4). |
| **State Mutations** | Writes/edits `<skill>/SKILL.md` (+ optional `guides/`/`references/`); for new static skills, adds one row to `harness-everything/SKILL.md` §5 and, if keyword-routable, one line to `tier-router.js`'s `recommendedGuides`. |
| **Enforcement Gate** | A new or edited `SKILL.md` **MUST NOT** be registered or persisted until every item in the Quality Checklist (§3) is checked off — for dynamic skills this is self-evolve's actual persistence gate, not optional polish. |

`skill-style/SKILL.md` defines *the shape* a SKILL.md must take (the Skill Contract table, the imperative tone) but not *how to get there well* — how to size a skill, when to push detail into a reference file, how to tell a real enforcement gate from a restated default, or where a rule belongs before it starts drifting across three files. Those questions come from two sources studied for this skill: [`writing-great-skills`](../mattpocock-skills/skills/productivity/writing-great-skills/SKILL.md) and Anthropic's own `skill-creator`. Neither is followed blindly — §1 says where Harness's own conventions override them, and why.

## 1. Two philosophies, reconciled

Harness gets predictability from a **physical** mechanism: the Skill Contract table's Enforcement Gate row, backed by a script that exits non-zero. External skill-writing research gets predictability from a **cognitive** mechanism: minimal context load, leading words, explaining *why* instead of just forbidding. Both are real and both are validated — see [`docs/reports/skill-quality-audit-writing-great-skills-2026-07-22.md`](../docs/reports/skill-quality-audit-writing-great-skills-2026-07-22.md) for the evidence — and they don't actually conflict where it counts:

- **Keep** the Skill Contract table and `MUST`/`PROHIBITED` for anything with a real Enforcement Gate: an irreversible action, a script that can exit non-zero, a state mutation another skill depends on. That's a hard guardrail; state it as one.
- **Don't** reach for `MUST`/`PROHIBITED` as the default tone for style preferences with no gate behind them — "don't write long paragraphs" doesn't need to be a `MUST NOT`; say what good output looks like instead. Every imperative not backed by an actual gate is a candidate for rewriting positively.
- **Always** apply the parts with no philosophical conflict at all: don't duplicate a meaning across files, don't restate what the model already does by default, push detail behind a pointer once a skill grows past what every reader needs inline, and reuse this repo's own leading words (`Tier 1/2/3`, `circuit breaker`/`zoom out`, `Rule of 3`, `Red/Green/Refactor`) instead of coining new ones for the same concept.

Full glossary and worked examples from both sources: `references/quality-principles.md`.

## 2. Authoring workflow

### Step 1 — Capture intent (before writing a word of SKILL.md)
Answer these, pulling from the conversation first if it already has the answers:
1. What should this skill make the agent do that it wouldn't do by default?
2. What's the *one* canonical sentence describing when it fires? This sentence becomes the frontmatter `description` — and nothing else. Don't let the registry row or `tier-router.js` invent independent wording later: the audit report §1.2 found the same skill carrying two different one-line descriptions inside `tier-router.js` itself, because nobody treated the frontmatter line as the source of truth.
3. Which Tier does it belong to, or is it an always-on discipline / meta skill outside the tier system?
4. Does an existing skill already own this ground? Grep `harness-everything/SKILL.md` §5 first — a near-duplicate skill is worse than a slightly-too-broad existing one.

### Step 2 — Draft
Write the Skill Contract table first — it forces you to know the Enforcement Gate before you write a paragraph. Then the body, sized by the information hierarchy:
- **Steps** (ordered, each ending on a checkable completion criterion) for anything the agent *does*, in order.
- **Flat reference** (a rule table, a decision list) for anything the agent *consults*. A skill can be all steps, all reference, or both — a flat rule table is a legitimate shape, not a smell.
- Past ~100-150 lines of body, or once a piece of detail is only needed on some branches rather than every invocation, push it to `guides/` or `references/` with a pointer sentence that says *when* to open it, not a bare link. Past 300 lines in a reference file, add a table of contents. `git-commit`, `tdd`, `repo-docs`, and `improve-codebase-architecture` already do this well — copy their shape.

### Step 3 — Test against real prompts
Don't ship on vibes alone. Write 2-3 prompts a real user would actually type — not "test the skill," the kind of message that should trigger it. Using this repo's own `create-agent-launcher`, spawn one subagent *with* the draft skill loaded and one *without* (baseline), same prompt, and compare. This is the same with/without comparison Anthropic's `skill-creator` runs through a Python eval-viewer — Harness doesn't need a second toolchain for it; `create-agent-launcher` already does resource-isolated subagent spawning. Read both transcripts, not just final outputs — repeated dead-end exploration in the with-skill transcript is a sign the skill under-specifies something, not that the model is weak.

Full adapted testing loop — when to bother, what to look for in transcripts, how a router-based system checks trigger phrasing without a native autonomous picker: `references/testing-workflow.md`.

### Step 4 — Prune, then register
Run the Quality Checklist (§3). Then:
- **Static skill**: add one row to `harness-everything/SKILL.md` §5 (Layer + "Activated when," quoting the frontmatter description rather than rewriting it), and if the trigger is keyword-detectable, one line to the matching keyword block in `harness-everything/scripts/tier-router.js`.
- **Dynamic skill** (from `self-evolve`): follow §4 instead — different location, different lifecycle, same checklist.

## 3. Quality Checklist (the actual gate)

A skill isn't done until every line here is true. This is deliberately a flat checklist, not steps — check them in any order, but check all of them.

- [ ] **Skill Contract table present and accurate** — all four rows; Enforcement Gate names a real script/exit-code or an explicit "None" if the skill is pure reference.
- [ ] **Single source of truth**: the frontmatter `description` is the *only* place this skill's purpose is originally written. The registry row and any `tier-router.js` line quote or tightly paraphrase it — they don't independently re-describe the skill.
- [ ] **No block over ~5 lines duplicated verbatim elsewhere** — in this file or in another always/near-always-loaded skill. (`install-cognitive-os` vs. `harness-everything`'s 33-line ADHD-output block, flagged in the audit report, is the canonical counter-example — don't add a second one.)
- [ ] **Every `MUST`/`MUST NOT`/`PROHIBITED` has a real gate behind it**, or is rewritten as a positive statement of the target behavior. A prohibition with no gate and no "why" sentence next to it is a smell, not a strength.
- [ ] **No no-op lines** — for each imperative sentence, ask whether it changes behavior versus what the model already does by default. ("Be thorough" reads as a no-op; a concrete completion criterion or a stronger leading word doesn't.)
- [ ] **Body fits the information hierarchy** — steps for ordered action, flat reference for rules, detail past what every branch needs pushed to `guides/`/`references/` with a "when to open this" pointer.
- [ ] **Reuses existing leading words** (`Tier 1/2/3`, `circuit breaker`/`zoom out`, `Rule of 3`, `Red/Green/Refactor`, `Discover > Think > Try > Summarize > Record`) instead of naming a new concept for something this repo already has a word for.
- [ ] **Completion criteria are checkable** — tied to an exit code, a file's existence, a grep result, or explicit human confirmation, not "when it feels done."
- [ ] **Description reads as a human-facing sentence**, not just a trigger-phrase list — `scripts/installer.js`'s interactive picker prints it next to a checkbox for a person deciding whether to install this skill; that's its real first reader in this architecture (audit report §2.1).

## 4. Dynamic Skill Generation Contract (for `self-evolve`)

`self-evolve`'s Step 3 packages a hard-won session insight into a new, standalone skill. That new skill **MUST** go through this skill, not be hand-written inline:

- **Location**: `.harness/skills/generated/<kebab-case-name>/SKILL.md` — not the repo root. `.harness/skills` is already a scope the installer recognizes (`scripts/installer.js`'s `getInstalledSkills`), which keeps dynamically-generated skills discoverable without mixing them into the reviewed, static skill set at the repo root.
- **Required frontmatter**, in addition to `name`/`description`:
  ```yaml
  metadata:
    type: dynamic
    generated: <YYYY-MM-DD>
    source: <one-line pointer to the session/root-cause that produced it, e.g. "zoom-out recovery, 2026-07-22, ORM connection-pool exhaustion">
    status: draft
  ```
- **Gate**: run the Quality Checklist (§3) before the skill file is written. A dynamic skill skips human PR review by design, so this checklist is the only review it gets — don't skip it because the insight "feels obviously right" in the moment; that's exactly the state self-evolve is triggered from.
- **Lifecycle**: `status: draft` at birth. Promote to `status: active` once it fires successfully in a *different* task than the one that produced it — a skill that has only proven itself on the bug that spawned it hasn't proven generality yet. If a dynamic skill goes unused or stops matching reality, mark `status: deprecated` rather than deleting it silently — deleting is fine once something else supersedes it, but a silent disappearance is harder to debug later than a stale-but-labeled file.
- **Promotion to static**: once a dynamic skill has proven itself general — used successfully across genuinely unrelated tasks, not repeated instances of the same bug — promote it: move it to the repo root, drop the `metadata.type: dynamic` block, and register it in `harness-everything/SKILL.md` §5 like any other skill. At that point it's subject to the same review/PR discipline as everything else here.

## 5. Related skills

- `skill-style/SKILL.md` — the terse Skill Contract format spec this skill builds on. Read it if you just need the table shape, not the full workflow.
- `create-agent-launcher/SKILL.md` — used in §2 Step 3 to spawn with/without-skill test subagents.
- `self-evolve/SKILL.md` — the caller for §4; it loads this skill rather than duplicating the Dynamic Skill Generation Contract inline.
