# Testing Workflow

Read this when `skill-creator/SKILL.md` asks for realistic trigger tests or a
with/without comparison. Use isolated control/treatment lanes and keep execution
topology owned by the active router/host.

## With/without comparison

1. Write 2-3 realistic prompts with paths, framework names, and near-misses.
2. Run the treatment with the draft skill loaded and the control without it in
   isolated lanes selected by the active router/host.
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
