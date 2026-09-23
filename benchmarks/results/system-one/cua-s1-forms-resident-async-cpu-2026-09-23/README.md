# System One: async hook pre-score on the resident CPU provider (2026-09-23)

Evidence layer: **local real-checkpoint inference through the resident transport**,
paired against the previous synchronous client. It is not live-host evidence, not
a reviewed holdout, and not a Harness routing quality claim. Issue
[#233](https://github.com/dyphn1/Harness-everything/issues/233); previous resident
run: [cua-s1-forms-resident-cpu-2026-09-23](../cua-s1-forms-resident-cpu-2026-09-23/README.md).

## Change under test

The hook entry (`tier-router.js` run as a script) now pre-scores over a direct
async loopback call (`scoreAsync`) and routes with that result. The synchronous
client starts a worker thread for every call. Decisions, reason mapping and the
router contract are unchanged; see [docs/system-one-routing.md](../../../../docs/system-one-routing.md).

## Setup

Same host, venv, pinned `cua-s1` source (`pinned`) and `cua-ai/cua-s1-forms`
checkpoint as the previous runs: Intel Core Ultra 5 225H, Windows 11 (win32
10.0.26200 x64), Node v24.18.0, CPython 3.13.6, one torch thread. "main" is
`f9d70ed`, which uses the synchronous worker bridge.

## Evaluator

```bash
node scripts/evaluate-system-one.js benchmarks/fixtures/system-one-routing.json \
  ~/.agents/harness-everything/system-one/manifest.json \
  benchmarks/results/system-one/cua-s1-forms-resident-async-cpu-2026-09-23/report.json
```

[`report.json`](report.json) is the unmodified output of this command. The
server was not running beforehand, so the evaluator started it, waited for
readiness, and stopped it afterwards. That gives 32 warm samples with p50
31.5 ms and p95 76.6 ms. `warmLatency` passes, repeatability is 1.0 and
`sourceProvenance` passes. Decisions are unchanged: 30 are `domain-mismatch`
and 2 are the over-limit `provider-exit`. Coverage is 0 and `rolloutReady` is false.

**A single run does not separate the two clients.** main, run once right
after this report under the same conditions, also passed (p95 75.9 ms). The
earlier 108.6 ms was also a single run. So [`paired-latency.json`](paired-latency.json) records
three alternating rounds against one already-warm server:

| Round | main p50 / p95 | branch p50 / p95 |
| --- | --- | --- |
| 1 | 50.8 / 82.3 ms | 24.6 / 47.6 ms |
| 2 | 51.4 / 75.9 ms | 26.8 / 51.1 ms |
| 3 | 58.4 / **116.8** ms | 24.3 / 62.9 ms |

main fails the ≤100 ms gate in one of three rounds and the branch in none. The
branch roughly halves p50. The branch's single worst sample (189.6 ms, round 3)
shows that outliers remain. Three rounds of 32 samples are a small sample.

## Hook entry

**Fresh process.** This matches how the hook runs. Each of 20 fresh processes
loads the modules and scores once.

| | module load p50 | one score p50 / p95 |
| --- | --- | --- |
| sync | 9 ms | 77.8 / 105.4 ms |
| async | 9 ms | 35.9 / 67.6 ms |

**Wall time.** `kernel-router-core.js "fix a typo in README"` runs for 40
rounds against a warm server. Each round runs `off`, main `shadow` and branch
`shadow` in turn. Overhead is paired against `off` in the same round.

| | p50 | p95 |
| --- | --- | --- |
| `off` | 182 ms | 339 ms |
| main `shadow` overhead | +63 ms | +179 ms |
| branch `shadow` overhead | **+44 ms** | **+111 ms** |

The router plans were identical in all 40 rounds for all three variants, and
every shadow diagnostic was `domain-mismatch`.

## Limitations

- These are single-host Windows numbers with high run-to-run variance.
  macOS/Linux and other CPUs are not measured.
- Most of the remaining ~44 ms hook overhead is first-call cost in a fresh
  process (connect plus a cold client path) on top of server scoring (≈7–12 ms).
  It is not reduced further here.
- The seed corpus is 16 unreviewed cases, and the forms checkpoint cannot drive
  Harness routing. The `reviewedHoldout`, `coverage`, `acceptedPrecision`,
  `macroF1`, `policyEvidence` and `liveHostEvidence` gates remain unmet.
- The hook host was not live-tested for this change. Only the CLI entry points
  above were run.
