# System One: LLM labeler check against the owner-reviewed holdout (2026-09-23)

Evidence layer: **one-time agreement check** between the training-data labeler and the
owner's gold. It measures label quality only. It is neither model evidence nor routing
evidence. Issue [#233](https://github.com/dyphn1/Harness-everything/issues/233). The labeling
procedure is defined in [system-one-training.md](../../../../docs/system-one-training.md).

## Command

```bash
node scripts/system-one-label.js check-holdout \
  --out benchmarks/results/system-one/labeler-holdout-check-2026-09-23/report.json --concurrency 3
```

[`report.json`](report.json) is the unmodified output. It lists case IDs with gold and
predicted labels only; prompt text is not included.

- **Labeler**: headless `claude -p` with Sonnet (`claude-sonnet-5`). Settings, hooks, plugins,
  tools and session persistence are disabled, and output follows a JSON schema.
- **Rules**: the gold section of `docs/system-one-corpus.md`, with SHA-256 prefix
  `87871ae710981284`.
- **Batching**: 100 prompts per batch.

## Result

| Metric | Value |
| --- | --- |
| Cases | 215 (0 missing, 0 failed) |
| Agreement with the owner's gold | **86.0%** (the gate is at least 80%) |
| Recall: tier1 / tier2 / tier3 / null | 87.2% / 84.5% / 88.2% / 85.0% |

Disagreements, shown as gold → labeler:

| Pair | Cases |
| --- | --- |
| tier2 → tier3 | 8 |
| tier2 → tier1 | 7 |
| tier3 → tier2 | 5 |
| tier1 → tier2 | 4 |
| tier1 → null | 2 |
| null → tier2 | 2 |
| tier3 → tier1 | 1 |
| null → tier1 | 1 |

All but one disagreement lies between adjacent tiers or involves `null`. The gate passes, so
the training data can be labeled with these instructions unchanged. The instructions were not
tuned on this holdout.

## Limitations

- An agreement of about 86% implies roughly 14% label noise in the training data. That noise
  bounds what a model trained on these labels can reach against the owner's gold.
- The owner's spot-check of the training labels measures the noise on the training
  distribution itself.
- This is one run with one model; run-to-run variance was not measured.
