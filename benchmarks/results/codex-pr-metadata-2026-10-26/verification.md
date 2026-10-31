# Final local regression

- Command: `PATH=/Users/daniel.chang/.nvm/versions/node/v24.22.1/bin:$PATH npm run verify:all`
- Process exit: `0`.
- Full local log: `/tmp/pr-metadata-verify-final.log`.
- Full log SHA-256: `630159501b19d1d0178683262f0bfe7c0ec9cacb29a336057bb95094481129f4`.
- Final core is pinned below; subsequent commits contain evidence only.

## Local gate run — paste-ready evidence
HEAD `c170a96cf856295200d2d1a62c15a552c3cb2b37` · node v24.22.1 · darwin · mode: full gate set · flags: (defaults)

| # | Gate | Result | Time |
| --- | --- | --- | --- |
| 1 | self-regression (hermetic + mechanism + routing contracts) | PASS | 386.3s |
| 2 | mutation checks | PASS | 38.5s |
| 3 | consistency (docs, manifests, repo contract, prompt contracts) | PASS | 0.5s |
| 4 | references resolve | PASS | 0.1s |
| 5 | release consistency | PASS | 3.0s |
| 6 | skill description collision | PASS | 0.1s |
| 7 | skill routing coverage | PASS | 1.2s |
| 8 | routing invariants | PASS | 4.9s |
| 9 | openai plugin package | PASS | 1.6s |
| 10 | openai public submission | PASS | 0.2s |
| 11 | platform compatibility matrix | PASS | 0.1s |
| 12 | test-source portability | PASS | 0.1s |
| 13 | node22 lane: self-regression execution smoke test | UNCHECKED (not requested; add --node22) | — |
| 14 | node22 lane: installer roundtrip execution smoke test | UNCHECKED (not requested; add --node22) | — |
| 15 | node22 lane: dependency install (npm ci under Node 22) | UNCHECKED (covered by the CI runtime-floor job; not replicated locally) | — |
| 16 | waza readiness (optional) | PASS | 7.0s |

Summary: 13 PASS, 0 FAIL, 3 UNCHECKED.
