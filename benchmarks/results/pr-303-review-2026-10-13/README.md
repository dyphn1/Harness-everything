# PR #303 review-fix evidence — 2026-10-13

Retained evidence for [PR #303](https://github.com/dyphn1/Harness-everything/pull/303), collected by delegated **Luna high** workers on Windows with Node.js 24.18.0. This directory packages existing runs; it does not represent a new test execution.

The final tested source commit is [`788ea75b7ab69af678734c87ef3cba920b0b892f`](https://github.com/dyphn1/Harness-everything/commit/788ea75b7ab69af678734c87ef3cba920b0b892f), with Git tree `8f6c2c942d3f6c1af6ca4332b8ba1f2529b5cc95`. Evidence-only commits made afterward do not change that attribution.

## Regression evidence

| Evidence | Result | Artifact |
| --- | --- | --- |
| Binding declaration RED | Exit 1; 40 expected assertion failures before the parser correction | [RED log](regression/red.log) |
| Workflow obligation GREEN | Exit 0; malformed declarations rejected without changing workflow/obligation state | [GREEN log](regression/workflow-obligations-green.log) |
| Existing binding resolution coverage | Exit 0 | [Binding resolution log](regression/binding-resolution-green.log) |
| Same-input repeated rejection | Two scenarios, each executed twice; identical outputs and unchanged session hashes | [Determinism record](regression/determinism.json) |
| Untyped Fable declarations | Both fields rejected with exit 2 and unchanged session state | [Fable probe](regression/untyped-fable-probe.json) |
| TDD quality gate | PASS, 100% for the binding declaration requirement | [Evidence input](regression/quality-evidence.json), [quality report](regression/quality-report.json) |

The regression suite covers `requiredBindings` and `optionalBindings`, five malformed value classes (`null`, object, string, boolean, number), and typed/untyped fragments: 20 input combinations. Explicit empty arrays and omitted declarations remain supported. The authoritative requirement is [workflow-runtime.md, “Fable and worktrees”](../../../docs/workflow-runtime.md#fable-and-worktrees).

## Repository gates

All 14 independently requested gates returned exit 0. The mechanism run reports **76 passed suite files**, with **4 optional model-backend cases skipped** because `torch` or `torch/cua_s1` was unavailable. The mutation run rejected all **11 production mutations**. Passing command exits do not imply those optional cases executed.

| Command | Retained log |
| --- | --- |
| `npm.cmd test` | [Self-regression](gates/heavy/test.log) |
| `npm.cmd run test:mutations` | [Mutation checks](gates/heavy/test-mutations.log) |
| `npm.cmd run test:mechanism` | [Mechanism suites](gates/heavy/test-mechanism.log) |
| `npm.cmd run test:consistency` | [Consistency](gates/contracts/test-consistency.log) |
| `npm.cmd run test:repo-contract` | [Repository contract](gates/contracts/test-repo-contract.log) |
| `npm.cmd run test:docs:capabilities` | [Capability documentation](gates/contracts/test-docs-capabilities.log) |
| `npm.cmd run test:references` | [References](gates/contracts/test-references.log) |
| `npm.cmd run test:release` | [Release checks](gates/contracts/test-release.log) |
| `npm.cmd run test:collision` | [Description collisions](gates/contracts/test-collision.log) |
| `npm.cmd run test:routing:skills` | [Skill routing](gates/contracts/test-routing-skills.log) |
| `npm.cmd run test:routing:invariants` | [Routing invariants](gates/contracts/test-routing-invariants.log) |
| `npm.cmd run test:plugin:openai` | [Local OpenAI package](gates/contracts/test-plugin-openai.log) |
| `npm.cmd run test:plugin:submission` | [Public submission package](gates/contracts/test-plugin-submission.log) |
| `npm.cmd run test:platform:compatibility` | [Platform compatibility](gates/contracts/test-platform-compatibility.log) |

Machine-readable exit summaries: [heavy gates and diagnostic history](gates/heavy/summary.json), [11 contract gates](gates/contracts/summary.json), and [final consistency/release reruns](gates/final-fast/summary.json).

## Source phases and final verification

The records span successive working-tree states; they must not all be attributed to a single final commit.

| Phase | Source attribution |
| --- | --- |
| Binding RED | PR head `8ad41ac`, with the new regression cases present and the parser correction absent |
| Binding GREEN / quality | Parser correction that was committed as `2faa451`, before integrating `main` |
| Independent repository gates / Fable probe | Integrated staged tree `09ff1e72d936ce56d58b1cbde6ae44cd6486fd39`, before the additional verification-fixture correction |
| Corrected fixture, final consistency/release reruns, final nested self-regression | Final tree `8f6c2c942d3f6c1af6ca4332b8ba1f2529b5cc95`, committed as `788ea75` |
| GitHub CI | Exact final source commit `788ea75b7ab69af678734c87ef3cba920b0b892f` |

The extra fixture change clears an inherited `HARNESS_SKIP_PROJECT_CHECKS` value for ordinary fixture invocations while retaining explicit overrides. Its [inherited-flag GREEN](verification/mechanism-35-inherited-flag-fixed.log) and [clean-environment GREEN](verification/mechanism-35-clean-env-fixed.log) both returned exit 0.

The final `node harness-everything/scripts/verify-gate.js --json` returned **`UNCHECKED_DISCOVERED`**, not `PASSED`: its `package-test` check completed successfully with exit 0, while a configured Git-hook candidate remained unexecuted. See the [structured result](verification/verify-gate-final.json), [final child stdout](verification/nested-test.stdout.log), [final child stderr](verification/nested-test.stderr.log), and [child process metadata](verification/nested-test.meta.json).

Do not cite the structured gate's overall exit 0 as additional passing-test evidence. The independently executed gates and the successful nested `package-test` supply the test evidence.

The logs include deliberately failing fixtures, circuit-breaker alarm text, and Git line-ending warnings. Those fixture messages are recorded test data, not instructions for a reader or evidence that the overall test process failed; use the assertions, process exits, and suite summaries to interpret them.

## Earlier failed attempts

The [initial structured result](diagnostics/verify-gate.json) reported exit 1 because the recursion guard leaked into verification fixtures. The [inherited-flag reproduction](diagnostics/mechanism-35-inherited-flag.log), [clean-environment comparison](diagnostics/mechanism-35-clean-env.log), and [diagnosis](diagnostics/verify-gate-diagnosis.md) document that failure.

A later [capture attempt](diagnostics/verify-gate-captured.json) also failed: the diagnostic preload propagated into a fixture with intentionally invalid package JSON. The final capture isolated the preload from child processes. Its test passed without further product-runtime changes.

The original structured JSON omitted child streams. Later capture attempts reused temporary stream filenames; the archived `verification/nested-test.*` files belong to the **final successful child**, not the earlier failures. Earlier failed child streams were not retained. The historical summaries describe those attempts; they are not substitutes for missing raw streams.

## GitHub CI and evidence boundary

[CI run 38355092624](https://github.com/dyphn1/Harness-everything/actions/runs/38355092624) passed all 15 jobs on the exact final source commit, including Ubuntu, Windows, and macOS self-regression. The [retained CI snapshot](ci/run.json) includes the run SHA, job conclusions, timestamps, and links. It describes that historical run, not a later evidence-only commit.

These artifacts prove deterministic mechanism/package checks and the recorded CI results. They do not establish a new live-host enforcement claim, behavioral improvement, or token/cost improvement.

## Sanitization and integrity

[manifest.json](manifest.json) maps each published file to its retained source filename and phase. It records SHA-256 hashes of both the original bytes and the published bytes. Local workspace, home, and temporary-directory paths are replaced with `<workspace>`, `<repo>`, `<home>`, or `<temp>` placeholders; text is normalized to UTF-8/LF and JSON is reformatted. Captured `.log` files also have trailing spaces/tabs and blank EOF lines removed, retaining internal blank lines. Results, case order, exit codes, session hashes, and optional skips are preserved.

The original byte hashes are provenance fingerprints, not copies of unsanitized originals. Published hashes can be checked against the files in this directory. The manifest and this index are packaging metadata created after the runs.
