# System One: real CUA-S1-FORMS CPU inference (2026-09-23)

Evidence layer: **local real-checkpoint inference and paired offline evaluation**.
It is not live-host evidence, not a reviewed holdout, and not a Harness routing
quality claim. Issue [#233](https://github.com/dyphn1/Harness-everything/issues/233).

## Setup

- Installed with `node harness-everything/scripts/system-one/install.js` (default
  directory `~/.agents/harness-everything/system-one`); exit 0, `verification.ok: true`.
  A second run reported both checkpoint files as `verified-existing`.
- Provenance probe: CPython 3.13.6, torch `2.14.0+cpu`, distribution `cua-s1 0.0.0`,
  PEP 610 source revision `b7f7e2d8714609853a29c7d049140bc46aec0954` → `pinned`.
- Checkpoint: `cua-ai/cua-s1-forms` at Hugging Face revision
  `f54adbf447f4ca6ec259f529ee3f2e3e09f8cc71`; weights SHA-256
  `05954c1c…6ddc` (LFS oid), sidecar SHA-256 `62d31e2f…50ca` (git blob
  `d8f8426a…` re-hashed); declared domain `forms-v1`.
- Host: Intel Core Ultra 5 225H, Windows 11 (win32 10.0.26200 x64), Node v24.18.0,
  one torch thread.

## Command

```bash
node scripts/evaluate-system-one.js benchmarks/fixtures/system-one-routing.json \
  ~/.agents/harness-everything/system-one/manifest.json \
  benchmarks/results/system-one/cua-s1-forms-cpu-2026-09-23/report.json
```

[`report.json`](report.json) is the unmodified output (16 holdout cases × 2 runs, 173 s wall).

## Results

| Metric | Lexical baseline | CUA-S1-FORMS |
| --- | --- | --- |
| Accuracy | 0.625 | 0.25 (null-gold cases only) |
| Macro-F1 | 0.572 | 0.10 |
| Coverage | 0.5625 | 0 |

- Every scored decision was `abstain/domain-mismatch`; the 225-byte case was
  `provider-exit` (context over the checkpoint's 224-byte limit, no truncation).
- Repeatability: agreement 1.0 across full score vectors.
- Latency: cold p95 6415 ms (32 cold samples; every call starts Python and imports torch).
  No warm samples exist.
- Gates: `repeatability` and `sourceProvenance` pass; all others fail or are pending;
  `rolloutReady: false`.

Diagnostic only (not a gate): if the domain check is ignored, raw top-1 would match
gold on 6/15 scored cases. Several of the wrong answers had very high confidence
(0.994, 0.996). This confirms the documented model-suitability boundary: the forms
checkpoint must not drive Harness routing, and the `domain-mismatch` abstention
is working as intended.

Kernel router check (same host): `shadow` and `prefer` with this manifest print a
`SYSTEM ONE` diagnostic with `domain-mismatch`/`applied: false`, and the emitted
router workflow plan is byte-identical to `off`. One shadow prompt took ≈7.2 s wall,
so enabling shadow in a live host adds roughly 5–7 s per prompt with this one-shot bridge.

## Limitations

The seed corpus is 16 unreviewed mechanism cases. There is no warm/persistent server,
no policy or live-host evidence, and no Harness-trained checkpoint. None of the
Phase 4 rollout gates are satisfied.
