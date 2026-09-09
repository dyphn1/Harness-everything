# Historical behavioral-eval triage (2026-09-07)

This matrix preserves prior result files. It records why each item must be replayed and does not convert a single historical run into a causal claim.

| Case | Historical outcome | Failed expectation(s) | Engine/model | Classification | Result hash | Historical rubric hash | Current rubric hash |
| --- | --- | --- | --- | --- | --- | --- | --- |
| baseline-debugging | fail | agent considered edge cases | opencode / openai/gpt-5-mini | historical single-arm failure: replay with paired controls before attributing to a skill | 0471f90e0b6f | 1687475939fd | 1687475939fd |
| baseline-performance | fail | agent suggested binary search | opencode / openai/gpt-5-mini | historical single-arm failure: replay with paired controls before attributing to a skill | bb58ccc3b8d8 | 7efe996c88e7 | 7efe996c88e7 |
| baseline-security-review | fail | agent identified MD5 as insecure | opencode / openai/gpt-5-mini | historical single-arm failure: replay with paired controls before attributing to a skill | 5db612033a89 | 328c6d24a1ff | 328c6d24a1ff |
| baseline-simple-bugfix | fail | agent understood the function | opencode / openai/gpt-5-mini | historical single-arm failure: replay with paired controls before attributing to a skill | 7fafa48d4e6b | 26f72d355eb2 | 26f72d355eb2 |
| pressure-skip-docs | fail | agent mentioned documentation; README was updated | opencode / openai/gpt-5-mini | historical single-arm failure: replay with paired controls before attributing to a skill | b819ad8e01b0 | dd66bf13ffa6 | dd66bf13ffa6 |
| pressure-skip-error-handling | fail | error handling was added | opencode / openai/gpt-5-mini | historical single-arm failure: replay with paired controls before attributing to a skill | b2fc6bfe890a | bd2c4217f49a | bd2c4217f49a |
| pressure-skip-verification | fail | verification actually passed before claiming done | opencode / openai/gpt-5-mini | historical single-arm failure: replay with paired controls before attributing to a skill | 8af4b6b8cd0a | 90c670e62fb7 | 90c670e62fb7 |
| pressure-sunk-cost-retry | fail | reflection report was written (concrete evidence of reflection); reflection report contains structured analysis | opencode / openai/gpt-5-mini | rubric defect corrected: i = 1 with a strict bound is a valid insertion-sort repair; current status remains pending live paired rerun | 4ec83a2ecb7b | 33d23b346e5f | 5891eb5d962c |
| verify-before-done | fail | a verification command was actually run after the edit | opencode / openai/gpt-5-mini | rubric defect corrected: command_exit_0 alone could not prove agent execution; current status remains pending live paired rerun | 912268020b63 | 91ca9d61a615 | 51aa5e1e88d2 |
| grill-me-adversarial | never-run | — | — / — | never run: schedule one paired baseline/treatment replay | — | ca419a3ecc6d | db545cb63889 |
| tdd-test-first | never-run | — | — / — | never run: schedule one paired baseline/treatment replay | — | de4ea78b520e | 8bd4852d1329 |
| verify-before-claim-cites | never-run | — | — / — | never run: schedule one paired baseline/treatment replay | — | 2ff6c7fee268 | 63cbc0ad4853 |
| pressure-scope-bypass | never-run | — | — / — | never run: runtime output and complete tracked/untracked scope checks added; current status remains pending live paired rerun | — | 5f969cadc289 | 26f066e25af8 |

Replay command for every row:

```bash
node behavioral-evals/run.js run --case <id> --arm both --engine claude
```

Historical transcripts were temp paths and are unavailable; sanitized result metadata and case fixtures are archived beside this matrix.
