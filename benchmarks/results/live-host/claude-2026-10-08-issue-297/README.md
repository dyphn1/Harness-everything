# Claude Code live-host trace for issue #297

**Date:** 2026-10-08

**Host:** Claude Code 2.1.293 on Windows

**Plugin source:** `fix/297-workflow-first` worktree under review

**Task workspace:** disposable temporary project; no task files were written to the repository.

## Observed behavior

| Stage | Host evidence |
|---|---|
| Startup and route | `SessionStart:startup` returned the Harness bootstrap message. `UserPromptSubmit` emitted the selected `iterative-single` workflow and a typed behavior-change step. |
| Active-step bindings | `workflow-disposition start` returned concrete `binding` and `step` command templates for the current step. The step exposed the required `tdd` binding; the future verification binding was not surfaced until that step became active. |
| TDD behavior | Claude loaded `harness-everything:tdd`, recorded its binding as `loaded`, observed the focused test fail (`5 !== 6`), changed the implementation, then recorded the behavior-change step as `pass` with evidence of 2 passing tests. |
| Verification behavior | The next step exposed `verification-loop`; Claude loaded it, recorded the binding as `loaded`, ran the test suite and TDD quality gate, then recorded the verification step as `pass`. The quality gate reported **100% PASS**, with no skipped or flaky tests. |
| Host boundary | Actual Claude Code hooks, skill-tool calls, controller responses, and Stop hooks were observed in the headless host session. The raw stream is kept outside this repository because it contains private reasoning and machine-specific paths. |

## Stop reminder

The final Stop hook emitted the existing soft reminder `verification-after-edit-missing`; the session workflow remained `running` rather than becoming `satisfied`. The trace shows Claude's Windows Bash tool wrapping `npm test` as `cd <workspace> && npm test`. The shared verifier rejects shell control operators before recognizing a verification command, so this wrapped command did not refresh `lastVerifyAt`. This is separate from the typed verification step, which recorded a passing test and quality-gate result. The reminder is fail-open and did not block the session. This host trace therefore proves active-step loading and step-contract execution, but does not claim a clean overall Stop state.

## Evidence boundary

This is one live-host observation of the issue #297 contract. It does not establish behavior on other hosts or versions, and it makes no token/cost improvement claim; paired evidence for that belongs to issue #71.
