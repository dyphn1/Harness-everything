# Quality Principles — condensed from `writing-great-skills` and Anthropic's `skill-creator`

Read this when `skill-creator/SKILL.md`'s Quality Checklist flags something and you need the reasoning behind the check, not just the checkbox. Each term below is condensed from the two source skills and paired with a Harness-specific example — good or bad — found during the [2026-07-22 audit](../../docs/reports/skill-quality-audit-writing-great-skills-2026-07-22.md).

## Contents
- [The root idea: Predictability](#the-root-idea-predictability)
- [Information hierarchy](#information-hierarchy)
- [Pruning](#pruning)
- [Leading words](#leading-words)
- [Negation](#negation)
- [Invocation, adapted for Harness's router](#invocation-adapted-for-harnesss-router)
- [Anthropic `skill-creator`'s anatomy conventions](#anthropic-skill-creators-anatomy-conventions)

## The root idea: Predictability

A skill exists to make the agent take the same *process* on every run — not the same output. A skill that should diverge (brainstorming, `grill-me`'s interrogation) is still predictable if it reliably takes the same *kind* of path every time. Every other term here is a lever on this one thing. Harness reaches for the same goal through a different lever — a physical Enforcement Gate instead of a cognitive one — see `skill-creator/SKILL.md` §1 for how the two combine.

## Information hierarchy

Content in a skill ranks by how immediately the agent needs it:

1. **Steps** — ordered actions in the SKILL.md body. Each ends on a completion criterion. Harness's Skill Contract table makes this criterion unusually concrete by default (an exit code, a file write) — keep that when you write new steps; don't downgrade a checkable criterion to a vague one for the sake of shorter prose.
2. **In-file reference** — rules, tables, decision lists consulted on demand. A skill can be *all* reference with no steps at all (`skill-style` itself, most review-shaped skills) — that's a legitimate shape, not a smell.
3. **Disclosed / external reference** — pushed into a linked file, reached by a pointer, loaded only when the pointer fires.

**Good Harness example**: `git-commit/SKILL.md` keeps the core Angular-style rules inline and pushes submodule handling, language detection, and generation strategy into `git-commit/guides/*.md`, each named for what it holds. `tdd/SKILL.md` does the same with `tdd/guides/mocking.md`, `interface-design.md`, etc.

**Bad Harness example**: `security-review/SKILL.md` is 508 lines — the longest in the repo — with no reference-file split. It wasn't re-read line-by-line for this audit, but its length alone is the sprawl smell described below; it's the next candidate if this skill's checklist gets applied broadly.

A **context pointer**'s *wording* decides whether the agent actually opens the linked file — not just its existence. "See `guides/mocking.md` for more" is weak; "before writing any test double, read `guides/mocking.md`" is a pointer that actually fires. Every "Deep Reference Guides" section in this repo should name *when*, not just *what*.

## Pruning

Four related failure modes, roughly in order of how much they cost:

- **Duplication** — the same meaning stated in more than one place. Costs tokens on every load, and drifts over time because nobody remembers to edit both copies. The audit report's §1.1 (33 lines shared verbatim between `install-cognitive-os` and `harness-everything`) and §1.2 (one skill's description independently rewritten in four places, two of which already disagree) are the two worst confirmed cases in this repo. **Test**: could you point to exactly one place that defines this, and would editing only that place actually change the behavior everywhere it matters?
- **Sediment** — stale content nobody removes because adding feels safe and removing feels risky. `docs/workflows/skill-style.md`'s three Mermaid diagrams (audit §1.4) are a mild case: not wrong, just three restatements of one flow that accreted instead of being consolidated.
- **Sprawl** — a skill simply too long, even if every line is live and unique. The cure is always the information hierarchy above: push reference behind a pointer, split by branch.
- **No-op** — an instruction the model already follows by default, so you pay tokens to say nothing. Test it against the actual default, not against how important the rule feels: "MUST operate using the cognitive loop" repeated inside a sub-skill when `install-cognitive-os` already declares itself always-loaded (audit §2.3) is a borderline example — not egregious, but a candidate to cut the next time that file is touched.

## Leading words

A leading word is a compact, already-understood concept the model can think *with*, repeated as a token (not re-explained as a sentence) everywhere it applies. This repo already has strong ones — don't invent synonyms for them:

| Leading word | What it compresses |
|---|---|
| `Tier 1 / 2 / 3` | Task-complexity routing and the whole action-strategy that follows from each |
| `circuit breaker` / `zoom out` | The entire reflect-before-retry protocol in `zoom-out/SKILL.md` |
| `Rule of 3` | "three failed attempts on the same signature ⇒ stop and reflect" |
| `Red / Green / Refactor` | The TDD cycle and which actions are legal in each phase |
| `Discover > Think > Try > Summarize > Record` | The base cognitive loop every tier and skill runs inside |

When a new skill needs to say "stop and reflect on repeated failure," write `trigger zoom-out`, not a fresh paragraph re-explaining the reflection protocol. That's the whole payoff of a leading word: one anchored phrase instead of a restated idea.

## Negation

A prohibition drags the forbidden behavior into the model's attention rather than out of it — "don't think of an elephant" makes the elephant the only thing present. This repo uses `MUST NOT`/`PROHIBITED` heavily and by design (`skill-style` mandates it), so the actual lever available isn't "stop using negation" — it's **reserve it for gates that are real**, and pair the rest with the positive target:

- **Does this well**: `zoom-out/SKILL.md`'s "ABSOLUTELY PROHIBITED from proposing any new code modification" is immediately followed by *why* ("that sentence is the tunnel talking") and by what to do instead (Phase 2's read-only fact-checking). The prohibition isn't left to stand alone.
- **Could do better**: `environment-detection/SKILL.md`'s "Red Flags & Common Errors" section restates, as a list of ❌ prohibitions, rules the same file already gave positively one section earlier (which shell uses which syntax). The information isn't wrong, it's just said twice in two moods.

If you're about to write `MUST NOT X`, check: is there a script or state mutation that actually enforces this, or human cost if violated (data loss, a broken build, a security gap)? If yes, keep the imperative — that's this repo's real strength, don't soften it. If no, try stating what *good* looks like instead and see if the `MUST NOT` was even carrying information.

## Invocation, adapted for Harness's router

The original framework's "model-invoked vs. user-invoked" split assumes a native skill system where an agent autonomously reads `description` fields and decides what to fire. That's not how this repo's skills are actually reached — confirmed by reading `scripts/installer.js` and `harness-everything/scripts/tier-router.js` directly rather than assuming:

- `harness-everything/SKILL.md` §5's Skill Registry table is a hand-maintained index — functionally Harness's own version of the framework's **router skill** pattern (a single place a human, or `tier-router.js` on their behalf, can look up "what exists and when to reach for it").
- `tier-router.js` prints keyword-triggered recommendations from its own hardcoded strings — a second, independent "what does this skill do" list that must be kept in sync with the registry and the frontmatter by hand (this is where the drift in audit §1.2 came from).
- `scripts/installer.js`'s interactive CLI picker is the one place that *does* read frontmatter `description` directly and shows it to a live reader — a **human**, choosing checkboxes at install time. That makes the real invocation axis in this repo closer to "does a human need to understand this in one line while skimming a checklist" than "will an autonomous model decide to fire this."

Practical upshot: write `description` as a plain, scannable sentence for that installer screen. Trigger-condition phrasing ("Use when...") isn't wrong, but it's optimizing for a reader (an autonomous picker) that doesn't exist in this deployment yet. If this repo's skills are ever installed as native Claude Skills (`.claude/skills/`) rather than the current `.harness/skills` / hook-advisory model, this section should be revisited — the trigger-phrasing advice becomes directly relevant again at that point.

## Anthropic `skill-creator`'s anatomy conventions

Kept because they don't conflict with anything above — they're just concrete, useful defaults:

- Bundled resources split by purpose: `scripts/` for things that execute deterministically, `references/` for things loaded into context on demand (this file is one), `guides/`/`templates/` (Harness's existing naming) for the same idea.
- A reference file past ~300 lines gets a table of contents (this file has one).
- Domain-organized skills (a skill that supports several distinct variants) split by variant, one file per variant, so only the relevant one loads — `repo-docs/templates/*.md` already does this for different README/AGENTS.md archetypes.
- Draft first, then re-read with fresh eyes and cut. Don't try to write the pruned version on the first pass.
