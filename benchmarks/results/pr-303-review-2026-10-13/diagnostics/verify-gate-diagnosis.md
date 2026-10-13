STRUCTURED GATE FAILURE DIAGNOSIS

The nested `npm run test` ran with HARNESS_SKIP_PROJECT_CHECKS=1 because verify-gate.js executeCheck sets that environment variable for recursion protection.

Reproduction:
- `HARNESS_SKIP_PROJECT_CHECKS=1 node ci/mechanism-35-verification-contract.test.js` -> exit 1; first assertion in the taxonomy fixture received `SKIPPED`, expected `UNCHECKED_NO_CHECKS`.
- `node ci/mechanism-35-verification-contract.test.js` with the variable absent -> exit 0; suite printed its verification-contract success message.

Cause: mechanism-35's `run()` helper spreads `process.env`; `invokeGate()` passes `{}` by default, so the inherited recursion flag leaks into its empty-repo fixture. The test explicitly expects the empty fixture to run normally.

Minimal test-only correction proposal: in `invokeGate()`, set a default `HARNESS_SKIP_PROJECT_CHECKS: '0'` before spreading `options.env`, so explicit recursion-guard coverage can still pass `'1'`.

No source files changed. Other verify-gate references found in CI are path/documentation references; self-regression's verify smoke test explicitly sets and expects the recursion guard.
