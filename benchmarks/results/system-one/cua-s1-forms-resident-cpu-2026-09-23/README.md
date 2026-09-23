# System One: resident CUA-S1-FORMS provider on CPU (2026-09-23)

Evidence layer: **local real-checkpoint inference through the resident transport**.
It is not live-host evidence, not a reviewed holdout, and not a Harness routing quality
claim. Issue [#233](https://github.com/dyphn1/Harness-everything/issues/233); one-shot
baseline: [cua-s1-forms-cpu-2026-09-23](../cua-s1-forms-cpu-2026-09-23/README.md).

## Setup

- Same host, venv and pinned checkpoint as the one-shot baseline: Intel Core Ultra 5 225H,
  Windows 11 (win32 10.0.26200 x64), Node v24.18.0, CPython 3.13.6, torch `2.14.0+cpu`,
  `cua-s1` at `b7f7e2d8…` (`pinned`), `cua-ai/cua-s1-forms` at `f54adbf4…`, one torch thread.
- The installer was rerun with `transport: "resident"`: exit 0, `verification.ok: true`,
  server ready in 7230 ms, first warm score 131 ms. The installer then stopped the server it had started.

## Command

```bash
node scripts/evaluate-system-one.js benchmarks/fixtures/system-one-routing.json \
  ~/.agents/harness-everything/system-one/manifest.json \
  benchmarks/results/system-one/cua-s1-forms-resident-cpu-2026-09-23/report.json
```

[`report.json`](report.json) is the unmodified output (`evidence.kind: offline-resident`,
`residentReady: true`, 16 holdout cases × 2 runs, 8 s wall versus 173 s one-shot).

## Results

| Metric | One-shot | Resident |
| --- | --- | --- |
| Samples | 32 cold | 32 warm |
| p95 latency (end to end in Node) | 6415 ms | 108.6 ms |
| p50 latency | — | 63.4 ms |
| Repeatability (full vectors) | 1.0 | 1.0 |

- Score vectors are byte-identical to the one-shot run for every case; decisions are
  unchanged (all `domain-mismatch`, one 225-byte `provider-exit`), coverage 0,
  `rolloutReady: false`.
- The `warmLatency` gate (p95 ≤ 100 ms) is **not met** (108.6 ms).

## Where the time goes (medians, same host)

| Component | ms |
| --- | --- |
| Worker-thread bootstrap per call (sync bridge) | 29–41 |
| Loopback connect | ≈3 |
| Server `ping` / `score` measured from a Python client (back-to-back) | 1.2 / 7.5 |
| Server `score` with 30 ms gaps between calls | 12.3 |
| In-process warm inference (earlier probe) | 2.8–5.6 |

Worker `env`/stdio options did not reduce bootstrap. Reusing the reply buffer lowered
p50 (67 → 55 ms) but not p95, and was not kept.

## Hook wall time

`node harness-everything/scripts/kernel-router-core.js "fix a typo in README"`, 25
interleaved runs per mode, with the server already warm:

| Mode | p50 | p95 |
| --- | --- | --- |
| `off` | 273 ms | 409 ms |
| `shadow` (resident) | 383 ms | 494 ms |

Resident shadow mode adds roughly 85–110 ms per prompt. The one-shot bridge added 5–7 s.
The router plan was identical to `off` in all 25 pairs. A cold start returns
`provider-starting` without waiting.

## Limitations

The server survived the exit of the CLI processes that spawned it. Survival after
exit of a real host's hook runner, and on macOS/Linux, is not verified. The seed
corpus is 16 unreviewed cases. The forms checkpoint cannot drive Harness routing.
Worker bootstrap is the remaining bottleneck. One possible follow-up is an async
pre-score in the hook entry, which would remove the worker; this is not measured.
