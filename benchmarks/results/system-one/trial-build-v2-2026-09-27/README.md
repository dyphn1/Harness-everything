# Trial build v2 with synthetic command data (2026-09-27)

#233. Holdout not read; aggregates only. The trial CLI is
`scripts/system-one-trial.py` (`build`, `score`, `eval`).

- **Synthetic commands.** opencode generated 400 train and 120 test
  single-message commands (git, gh, package scripts, shell, build/test,
  edits, features, refactors; en 55%, zh-TW 45%) from a written spec. Train
  and test share no family. Kept in the private repo
  (`training/synthetic-commands-{train,test}.jsonl`). Every test case is
  actionable by construction; its tier follows rules v2.
- **v1** (the first trial build, 2026-09-27 morning): validity gate with owner review, intent on valid prompts, old-rules
  tier scorer.
- **v2**: the same, plus the synthetic train rows in all three stages, and
  intent trained on Sonnet + Laya-ft rows with feature/refactor weight 2.
  Single seed; one training process at a time.

## Synthetic test set (120 commands)

| Metric | v1 | v2 |
| --- | --- | --- |
| wrongly marked invalid, all | 0.23 | **0.03** |
| wrongly marked invalid, en | 0.30 | **0.00** |
| wrongly marked invalid, zh-TW | 0.15 | 0.06 |
| tier coverage | 0.80 | 0.68 |
| tier acceptable | **0.76** | 0.62 |
| tier under | 0.15 | 0.13 |
| primary intent in top 3 | 0.40 | 0.34 |

## Real validation (same code paths)

- Validity gate AUROC: 0.863 (v1 build) and 0.852 (v2), within seed noise.
- Intent micro-F1 (valid rows, cross-validated thresholds): 0.355 and
  **0.405**.
- Composed tier on 471 rows (in-sample intent thresholds): acceptable 0.842,
  under-tier 0.028.

## Reading

1. **The command data fixed the validity false alarms.** Short English
   commands are no longer handed off as invalid, and the real-data gate did
   not degrade.
2. **Intent improved on real prompts, but tier got worse on the synthetic
   commands.** The weighted intent scorer fires `feature`/`refactor` on
   plain Git commands (19 of 41 actionable tier1 cases went to tier3), which
   the composition turns into an error two tiers too high. On real
   validation, the same rule gives the best tier numbers so far, so the
   synthetic set exposes a distribution the real corpus under-represents.
3. Two readout alternatives were checked and not adopted. Requiring
   feature/refactor to rank in the top 2 raises under-tier on real
   validation to 0.12. Letting a top `git` intent force tier1 moves real
   under-tier from 0.028 to 0.049 and makes the synthetic numbers worse.
4. Next lever: stop `feature`/`refactor` from firing on Git and lookup
   commands. Either fit their thresholds for the tier3 composition rather
   than for intent F1, or add tier1 Git/lookup negatives for those two
   intents.
