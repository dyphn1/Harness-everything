# agy exit-3 quota fixture provenance (I544)

The three `agy-quota-*` files are sanitized copies of the live captures in
`.w/capture/`, recorded 2026-11-26 on macOS with `agy` 1.5.18. The identifier
and reset duration are redacted; the advice text is retained as captured.

| Fixture | Source | Live-backed part | Fixture part |
| --- | --- | --- | --- |
| `agy-quota-direct-third-party.stderr` | `.w/capture/direct.sanitized.stderr` | Fresh readiness-equivalent call, quota already exhausted before start: **normal exit 3**, no signal, stdout 0 bytes, exactly these two stderr lines, no report created (2026-11-26 22:52). | Managed readiness wrapper in `ci/mechanism-468-dispatch-cli.test.js`. |
| `agy-quota-direct-individual.stderr` | `.w/capture/direct-gemini.sanitized.stderr` | Direct `gemini-4-neon-medium` call, individual pool exhausted: **normal exit 3**, no signal, stdout 0 bytes, exactly these two stderr lines, no report (2026-11-26 23:4x). | C8 execution wrapper in `ci/mechanism-468-dispatch-cli.test.js`. |
| `agy-quota-exec-individual.log` | `.w/capture/exec-individual.sanitized.log` | Managed C8 execution log framing from PR #547 code, `gemini-4-neon-medium`, individual pool: the retained result was **15 RUN_FAILED** (nonzero exit, stderr, no report). | The child exit status is **not** carried by the log. The execution fixture uses this live stderr shape plus a **fixture exit status of 3**. |

## Exit-status boundary

Only the two direct calls above establish a live normal exit 3. The managed
readiness and managed execution rows are derived from those live stderr shapes
with a fixture exit status. The managed execution fixture is labelled as
derived until a fresh managed result preserves its original exit status; the
captured 15 RUN_FAILED result is not retroactively reclassified as exit 3.
