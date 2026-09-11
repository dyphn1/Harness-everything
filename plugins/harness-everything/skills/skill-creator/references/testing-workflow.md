# Testing Workflow

Read this when `skill-creator/SKILL.md` asks for realistic trigger tests or a
with/without comparison. Harness uses deterministic routing and the merged
`multi-agent-workspace` skill for bounded sub-agent spawning.

## With/without comparison

1. Write 2-3 realistic prompts with paths, framework names, and near-misses.
2. Use `multi-agent-workspace` to spawn one sub-agent with the draft skill
   loaded and one baseline with no mention of it.
3. Read both transcripts, not only final answers; record thrashing and missed
   gates as evidence.
4. Construct one prompt that should trigger the skill's enforcement gate and
   verify that the treatment reflects instead of pushing through.

## Deterministic trigger check

Check realistic positive and negative prompts against the keyword table in
`harness-everything/scripts/routing-keywords.json`. A positive miss is a
routing gap; a negative hit usually means a keyword is too broad.

## Completion

Keep the canonical frontmatter description identical in the positive eval's
`description:` field. Run the relevant `waza spec verify` and repository
consistency checks before registration.
