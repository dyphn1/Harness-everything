# H1 provider-independence qualification (preparation)

This directory records the bounded #325 H1 preparation/non-interference qualification scope. It is preparation evidence only; it is not full H1, Phase 3c, E1, paired evidence, benefit evidence, or #320 promotion.

## Scope

- H1 preparation/non-interference only.
- `suggestDocProviders` is called as an independent side input. Suggestions and provider identity are never passed to the F4 consumer, workflow, binding, or reconciliation path.
- No runtime, shared harness, package, manifest, lockfile, fixture JSON, or issue edits are part of this qualification.
- The registered F4 evidence and executor remain the only evidence path: executor `f4-pos-body-edit-session`; provenance `claude-code-capture:<captureId>`.

## Matrix

Cross product: 3 provider inputs × 2 evidence modes × 2 distributions = 12 cells.

Provider inputs:

- A: only `fixture-lint-a` metadata; expected exactly the A suggestion.
- B: only `fixture-lint-b` metadata; expected exactly the B suggestion.
- Omitted: no provider metadata; expected `suggestions: []` and one unavailable `doc-lint` record.

Evidence modes:

- Valid evidence: actual registered doc-check `hostRun` and correlated `PostToolUse` capture.
- Zero evidence: same F4-POS-body-edit task definition and loaded `verification-loop` binding, with only `lint-run` and `post-lint` removed.

Distributions: `source` and `packaged`.

## Fixed expected full applicable MUST objects

- `{id:"doc-change:doc-lint", capability:"doc-lint", strength:"MUST", applicability:"applicable", scope:{paths:["docs/a.md"]}, acceptance:"Run document lifecycle lint for every changed governed document."}`
- `{id:"doc-change:link-check", capability:"link-check", strength:"MUST", applicability:"applicable", scope:{paths:["docs/a.md"]}, acceptance:"Check in-repository links for every changed governed document."}`

`expectedMustIds` must equal those IDs. The pilot runtime report `results` field is empty and is not asserted. A non-blocking missing-path-coverage diagnostic for the SHOULD `prose-reminder` is expected; diagnostics are not asserted empty.

## Asserted fields

Valid evidence cells assert:

- `reportOrigin: runtime`
- `expectedMustIds` exact
- no unsatisfied MUSTs
- `creditedCapabilities` and accepted refs for both capabilities
- `pilotCredit: true`, `pilotStatus: credited`
- verification step pass
- Stop exit `0`, workflow state `satisfied`

Zero evidence cells assert:

- both MUSTs remain expected and unsatisfied
- `creditedCapabilities` and `acceptedRefs` empty
- `pilotCredit: false`, `pilotStatus: unresolved`
- verification step pending
- Stop exit `0`, workflow state `running` (not satisfied)

## Test approach and execution

This is an integration qualification because each F4 cell crosses real child processes, filesystem state, hook entries, and workflow disposition. Expectations come from #325 H1 and the fixed F4 fixture. The existing valid-evidence and zero-evidence cases are positive and negative controls; this does not manufacture a runtime-bug RED or authorize runtime edits.

| Command | Result |
|---|---|
| `node ci/mechanism-325-3b-h1-qualification.test.js` | 36 PASS, 0 FAIL, 0 INFRA; all 12 matrix cells and source/package MUST derivations passed |
| Initial `npm run verify:all -- --fast` | 3 PASS, 2 FAIL, 11 UNCHECKED. Environment preflight failure: this worktree had no node_modules; self-regression lacked node_modules and the #341 C2 AST checker/mutation controls reported AST_PARSER_UNAVAILABLE. This is not counted as a product defect. |
| Focused dependency controls after installation | Node 24.22.1: mechanism-2i-crlf-frontmatter passed; mechanism-341-boundary-enforcement passed all C1/C2 controls; npm run test:mutations passed 113 mutants and 2 source probe suites. |
| Final `npm run verify:all` | Node 24.22.1: 13 PASS, 0 FAIL, 3 UNCHECKED. The unchecked items are Node 22 self-regression smoke, Node 22 installer roundtrip, and npm ci under Node 22. No CI or live-host evidence is claimed. |

The initial fast run was retained as the environment-preflight result and was not rerun. After confirming the missing dependencies with npm ls and resolving pinned acorn/acorn-walk, the full verification gate passed. Dependencies were installed with npm ci --ignore-scripts; the only package lifecycle script is prepare: husky install.

## Pending

- Full H1 and Phase 3c remain pending.
- E1, paired evidence, benefit evidence, and #320 promotion remain pending.
