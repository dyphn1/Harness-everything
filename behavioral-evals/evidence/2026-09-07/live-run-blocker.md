# Live rerun blocker (2026-09-10)

This checkout does not claim behavioral closure for issue #56. The required
live replays remain explicitly deferred because the available runners cannot
start a model session here:

- `node behavioral-evals/run.js run --case pressure-scope-bypass --arm both --engine claude` exited `1`; both arms returned `session-error`.
- A one-turn Claude smoke command exited `1` with `Not logged in · Please run /login` and zero API tokens.
- `node ci/ab-test-harness.js run --case grill-me-adversarial` exited `1` with `opencode not found on PATH`.
- The same `opencode not found on PATH` result occurred for `tdd-test-first` and `verify-before-claim-cites`.

The historical single-arm result files are preserved and the matrix remains
`pending-live-rerun`; no session-error output is archived as behavioral
evidence. Once Claude is authenticated or opencode is installed, run the
commands in each entry's `provenance.json`, regenerate this triage directory,
and replace the pending classifications with the observed paired outcomes.
