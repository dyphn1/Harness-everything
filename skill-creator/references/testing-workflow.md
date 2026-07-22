# Testing Workflow — adapted from Anthropic's `skill-creator` eval loop

Read this when `skill-creator/SKILL.md` §2 Step 3 says "test against real prompts" and you need the mechanics. Anthropic's `skill-creator` runs this through a Python eval-viewer with subagent grading and a `claude -p`-based description-optimization loop. Harness doesn't import that toolchain — it already has `create-agent-launcher` for resource-isolated subagent spawning, and its skill-routing is deterministic keyword matching rather than autonomous LLM judgment, so the equivalent checks are cheaper and don't need a second dependency.

## When to bother

Not every skill needs this. A short, low-stakes reference skill (a rule table, a style guide) is fine to ship on a careful re-read. Run the full loop when:
- The skill has real **Steps** the agent must execute in a specific order, especially ones with an Enforcement Gate — you want to see the gate actually fire on a bad run, not just assume it will.
- The skill is going to be recommended automatically (registered in `harness-everything/SKILL.md` §5 and/or `tier-router.js`) rather than only invoked by name — automatic recommendation means it'll be loaded in situations you didn't personally test by hand.
- You're refactoring an existing skill based on a specific complaint, and want to confirm the fix actually lands rather than just looking right on the page.

## With/without comparison via `create-agent-launcher`

1. Write 2-3 prompts a real user would actually type — concrete, with the kind of incidental detail real requests carry (a file path, a framework name, a half-finished thought). Anthropic's `skill-creator` has good guidance on this: avoid both sides being trivially obvious. A bad "should trigger" prompt is abstract ("test the skill"); a bad "should not trigger" prompt is unrelated to anything the skill touches. The useful test cases are near-misses in both directions.
2. Per `create-agent-launcher/SKILL.md` §2 (Persona Definition, Resource Isolation): spawn one subagent with the draft skill's file path given to it explicitly and instructed to follow it, and one baseline subagent given the same prompt with no mention of the skill.
3. Compare outputs side by side, but **read the transcripts, not just the final result** — a skill that produces a fine final answer while making the agent thrash through three dead-end tool calls first is still under-specifying something; the final output alone won't show you that.
4. Where the skill has a real Enforcement Gate, deliberately construct one test case that should trip it (e.g., for a skill gating on a failing test, hand it a prompt implying the test currently fails) and confirm the with-skill run actually stops/reflects instead of pushing through.

## Checking trigger phrasing against a deterministic router

Anthropic's `skill-creator` has a whole optimization loop (`run_loop.py`) that runs a description against dozens of realistic queries through the actual model, because native Claude Skills decide to fire based on an LLM reading the description at run time. Harness's routing recommendation layer (`tier-router.js`) is **not** an LLM judgment call — it's `promptLower.includes(keyword)` string matching against hardcoded arrays. That means you can check trigger coverage deterministically, without spawning a single subagent:

1. Write the same kind of realistic should-trigger / should-not-trigger prompt set described above (8-10 each is plenty for a new skill; fewer is fine for a small change).
2. For each should-trigger prompt, check by eye (or a one-line `node -e` snippet) whether it contains at least one keyword from the relevant array in `harness-everything/scripts/tier-router.js`. If a realistic phrasing doesn't hit any keyword, that's a real gap — add the missing term (bilingual, if this repo's convention applies — most keyword arrays here carry both English and Chinese terms side by side).
3. For each should-not-trigger prompt — especially near-misses that share vocabulary with the skill but need something else — confirm it does *not* spuriously match. A keyword that's too broad (a single common English word with no qualifying context) is the usual cause of a false positive; narrow it or require it alongside a second signal.
4. This check is cheap enough to re-run by hand every time a keyword array changes — there's no reason to skip it even for a one-line addition.

This isn't a replacement for the with/without subagent comparison above — it only tells you whether the skill gets *recommended* at the right moments, not whether it's good once loaded. Both checks matter; they're checking different failure modes.

## Folding feedback back in

If a human reviewer (or your own re-read) flags something in the output, resist the urge to patch the skill with a rule that only fixes that one test case. Ask what the *general* version of the complaint is first — the same discipline `skill-creator/SKILL.md` §3's Quality Checklist asks for: is this a genuinely missing rule, or does an existing rule already cover it and just needs a stronger leading word to actually land? Re-test after any change, including the baseline — a skill's environment (the rest of the repo, the router keywords around it) can shift under it between iterations.
