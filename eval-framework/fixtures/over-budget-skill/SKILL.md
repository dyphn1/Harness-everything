---
name: over-budget-skill
description: Over budget skill for token limit testing
version: 0.3.4
metadata:
  author: Miya Daniel
  version: 0.3.4
---

## USE FOR:
This skill is intentionally over the word budget to test the token limit enforcement gate. It contains a very long description and body that exceeds the 500 word hard limit. The purpose of this skill is to verify that the consistency-check.js script correctly detects when a SKILL.md file exceeds the token budget and fails the check. This is a negative control fixture that must fail the token budget gate.

The skill description is intentionally verbose to push the word count over the limit. In a real skill, this would be a routing surface issue where the description is too long and bloats token budgets for agent routing. The token budget gate in consistency-check.js uses a word-count proxy (1.55 tokens per word) to estimate token usage and fails when the hard limit of 500 tokens is exceeded.

This negative control ensures that the gate actually works and catches over-budget skills. Without this fixture, a gate that silently passes everything would be indistinguishable from a working gate.

Additional content to push word count over 500 words. This skill contains extensive documentation about how the token budget enforcement works in the Harness system. The gate uses a simple word-count heuristic where each word is estimated to be approximately 1.55 tokens. This means 330 words roughly equals 511 tokens, which exceeds the 500 token hard limit. The gate has two thresholds: a warning at 400 words (80% of hard limit) and a hard failure at 500 words.

The word counting is performed on the body of the SKILL.md file after removing the frontmatter. This means the frontmatter fields like name, description, version, and metadata are not counted toward the word budget. Only the markdown content in the body sections (USE FOR, DO NOT USE FOR, and any additional reference content) contributes to the word count.

To create a skill that exceeds the budget, this fixture includes many paragraphs of explanatory text. Each paragraph adds to the word count. The test verifies that when a skill exceeds 500 words, the consistency-check.js script fails with an appropriate error message indicating the number of words over the limit.

This is a comprehensive test of the token budget enforcement mechanism. The gate is designed to be a local early-warning system that catches token budget issues before they reach CI, where waza tokens check would also catch them. By having both local and CI gates, we ensure that token budget violations are caught at multiple stages.

Production systems should never have skills that exceed the token budget because long descriptions bloat the routing context and make agent selection less efficient. The routing system uses skill descriptions as the primary signal for skill selection, so keeping them concise and focused is essential for good routing performance.

Additional paragraphs to ensure we exceed the five hundred word threshold. Each sentence here adds multiple words to the total count. We need to reach at least five hundred and one words to trigger the hard failure gate. The consistency check will then report the exact number of words over the limit and fail the build. This is the expected behavior for the negative control test.

More content to push the word count higher. The word counting algorithm splits on whitespace and filters out empty strings. This means each space-separated token counts as a word. Punctuation attached to words does not affect the count. We are now adding several more sentences to ensure we cross the five hundred word boundary with comfortable margin.

Even more text to guarantee the word count exceeds the hard limit. The test fixture must reliably fail the token budget check every time it runs. Flaky tests that sometimes pass and sometimes fail are worse than no tests at all. By making the content significantly over the limit, we ensure consistent test results.

Final paragraph to push us well over the five hundred word target. At this point we should have more than enough words to trigger the hard failure. The consistency check will output an error showing the exact word count and how many words exceed the limit. This confirms the gate is working correctly.

## DO NOT USE FOR:
Production use - this is a test fixture only