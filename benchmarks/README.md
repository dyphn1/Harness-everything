# Benchmarks

Executable companion to [BENCHMARK_SOP.md](../BENCHMARK_SOP.md). The SOP
describes *how* to test; this directory is where results live — committed,
dated, and traceable to exported session logs.

## Status

| Scenario | Vanilla | Harness |
|---|---|---|
| test-a-overengineering | not run | not run |
| test-b-micro-loop | not run | not run |
| test-c-attention-loss | not run | not run |
| test-d-knowledge-boundary | not run | not run |
| test-e-shell-awareness | not run | not run |
| test-f-fact-audit | not run | not run |

**Until cells above are filled, no effectiveness claim about Harness is backed
by recorded evidence.** Self-audit scores in `docs/audit.md` measure mechanism
correctness (do the hooks fire), not behavioral effect (does the agent actually
behave differently). These benchmarks measure the latter.

## Usage

```bash
# 1. Build the fixture workspace for a scenario and get the exact prompt
node benchmarks/run.js scaffold test-a-overengineering

# 2. Run the prompt twice in real agent sessions:
#    once with NO skills loaded (vanilla), once with Harness installed.
#    Export both conversation logs into benchmarks/results/logs/.

# 3. Register both runs (evidence log required — no log, no result)
node benchmarks/run.js record test-a-overengineering \
  --variant vanilla --model claude-sonnet-4.6 --outcome partial \
  --tokens 2140 --steps 11 --evidence logs/test-a-vanilla.md

node benchmarks/run.js record test-a-overengineering \
  --variant harness --model claude-sonnet-4.6 --outcome pass \
  --tokens 380 --steps 2 --triggered harness-everything \
  --evidence logs/test-a-harness.md

# 4. Check coverage
node benchmarks/run.js status
```

## Result format

Each record follows `schema.json`: scenario, variant, model, date,
harness_version, outcome, token/step counts, triggered skills, notes, and a
content-hash `id` derived from the evidence log so records can't silently drift
from their evidence.

## Honesty rules

1. **No log, no result** — `record` refuses entries whose evidence file is missing.
2. Record failures too (`--outcome fail`). A benchmark suite where Harness
   passes everything is a red flag, not a victory lap.
3. Note the model per run. Results are model-specific; never generalize a
   single-model result across models.
4. Pair every behavioral result here with a mechanism check from
   `VERIFICATION.md` §2 — a well-behaved model can pass these scenarios even if
   every hook silently no-ops (see the 2026-07-20 incident note in BENCHMARK_SOP.md).
