# OpenCode V2 turn → export trace (2.4.1, #397)

**Observed:** OpenCode 2.4.1 on macOS 26.7.3, Node 24.22.1, 2026-11-28. One long-lived `opencode serve --hostname 127.0.0.1` (2.4.1 requires `OPENCODE_PASSWORD`; the first attempt without it returned HTTP 401), two consecutive `opencode run --server` turns in one session (`opencode/hy4-flash-free`), followed by `system-one-cycle` `collect` runs against the same explicit `HARNESS_OBSERVATIONS_DIR`, empty Codex sessions, and same date.

**Candidate:** Clean clone of `main` at `411e5a70`. The probe workspace loaded a 1-line re-export `.opencode/plugins/harness-enforcement.js` pointing to the checkout's `opencode-plugin/index.mjs` so the Harness root resolved.

## Isolation (E-0029)

The server ran under `env -i` with `HOME`, `XDG_*`, `TMPDIR`, `HARNESS_OBSERVATIONS_DIR`, and `HARNESS_STATE_HOME` pointed at an empty probe directory, copying only provider auth, so no global Harness plugin, user config, or ambient store could interfere. [plugin-load-lines.txt](plugin-load-lines.txt) shows the server loaded only the candidate plugin.

## Sequence

```mermaid
sequenceDiagram
  participant M as Model (hy4-flash-free)
  participant H as OpenCode 2.4.1
  participant P as Harness candidate
  participant C as system-one-cycle collect
  H->>P: setup(ctx) (load)
  H->>M: Turn 1 (s2 / t3) with injected router contract
  M->>H: Reply + v1 turn-label line (tier1 / actionable)
  P->>P: Persist observation r1 (s2 / t3)
  H->>M: Turn 2 (s2 / t5) with injected router contract
  M->>H: Reply + v1 turn-label line (tier1 / actionable)
  P->>P: Persist observation r4 (s2 / t5)
  C->>C: Run 1: import persisted=2, export eligible=2 valid=2 rate=1
  C->>C: Plain rerun: {"skipped":true} (cycle-state completion mark)
  C->>C: Clear steps.collect; Run 2: persisted=0 duplicate=2, export ids identical (2)
```

## What the files show

| File | Shows |
|---|---|
| [host-version.txt](host-version.txt) | Host CLI version string (`opencode v2.4.1`). |
| [plugin-load-lines.txt](plugin-load-lines.txt) | Server log line confirming only the candidate plugin loaded in the isolated probe workspace. |
| [observations-index-excerpt.json](observations-index-excerpt.json) | Live observation store index: 2 `opencode` records (`r1`, `r4`) in the same session (`s2`) with distinct turn IDs (`t3`, `t5`), both carrying valid v1 self-reports (`tier1`, `actionable`, `selfReportReason: null`). |
| [import-report-1.json](import-report-1.json) | First `collect` import report: `live` and `codex` sources `ok`, `opencode.persisted: 2`, `duplicate: 0`, `ambiguous: 0`, `importFailure: 0`. |
| [export-report.json](export-report.json) | Export report: 2 records exported, `withSelfReport: 2`, `hostAcceptance.byHost.opencode` has `eligible: 2`, `valid: 2`, `invalid: 0`, `missing: 0`, `acceptanceRate: 1`. |
| [labels-observed-excerpt.jsonl](labels-observed-excerpt.jsonl) | Two exported rows (`r1`, `r4`) in `labels-observed.jsonl` with `host: "opencode"` and `behaviorEvidence: "observed"`. |
| [import-report-2.json](import-report-2.json) | Second `collect` import report (after clearing `steps.collect` in private `cycle-state.json`): `persisted: 0`, `duplicate: 2`, `ambiguous: 0`, `importFailure: 0`. |
| [collect-rerun.txt](collect-rerun.txt) | Reconciliation summary: plain rerun was skipped (`{"skipped":true}`); after clearing `steps.collect`, run 2 executed with identical export IDs (2) and 2 store records. |

## Boundary

- Establishes, for this one host/version/run (`2.4.1`, macOS 26.7.3, long-lived server): V2 default-export loading, live observation recording for two consecutive turns in one session, and idempotent `system-one-cycle` import/export (`persisted: 2` → `persisted: 0, duplicate: 2`, identical export IDs, `acceptanceRate: 1`).
- **Router/context injection:** indirectly observed only — the model emitted the turn-label line that only the injected router contract asks for (valid labels on both turns); no full injection trace was captured.
- **Idempotency note:** a plain second `collect` returned `{"skipped":true}` because of the `cycle-state.json` completion mark and proves nothing on its own; run 2 was forced to execute by clearing `steps.collect` in private `cycle-state.json` while keeping the same destination store.
- **2.4.1 setup fact:** `opencode serve --hostname 127.0.0.1` required `OPENCODE_PASSWORD`; the first attempt without it returned HTTP 401.
- Not exercised: full router/context injection trace, ledger lessons, session create/delete reset, cancellation, global scope, npm-package install, standalone one-shot runs, other OpenCode versions, and Windows/Linux.
