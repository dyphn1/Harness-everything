# Authoring Workflow & Philosophy Detail (moved from SKILL.md)

## 1. Two philosophies, reconciled

Harness gets predictability from a **physical** mechanism: the Skill Contract table's Enforcement Gate row, backed by a script that exits non-zero. External skill-writing research gets predictability from a **cognitive** mechanism: minimal context load, leading words, explaining *why* instead of just forbidding. Both are real and both are validated — see the 2026-07-22 skill quality audit for the evidence — and they don't actually conflict where it counts:

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

# Related Skills

- `skill-style/SKILL.md` — terse Contract format spec this builds on.
- `create-agent-launcher/SKILL.md` — spawns with/without-skill test subagents.
- `self-evolve/SKILL.md` — caller for the Dynamic Skill Generation Contract.
