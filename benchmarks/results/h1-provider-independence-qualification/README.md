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

## Next acceptance packet (preparation only)

The current H1 run is preparation: provider A/B/omitted are tested as side inputs, never as inputs to the F4 consumer. It does not complete H1 or any Phase 3c gate. Keep the existing contracts in [document-lifecycle.md](../../../docs/document-lifecycle.md) authoritative.

| Gate | Remaining evidence | Required positive and negative result |
|---|---|---|
| H1 | Exercise provider A, B and omitted through the same active workflow consumer, and use a valid alternate executor that is independent of the suggestion. | Expected MUSTs stay byte-for-byte identical; valid alternate evidence satisfies the applicable MUST; omitted or zero evidence does not. |
| H2 | Capture active-step provider metadata and actual skill/content reads at each step, including an unrelated/future provider control. | Only active-step metadata is exposed; no unrelated or future `SKILL.md` content is read or injected. |
| H3 | Complete the adversarial matrix in `docs/document-lifecycle.md` § Phase 3b minimum trust boundary / Phase 3c H3 validation, on source and packaged legs. | Every listed fabricated, missing, stale, substituted, forged, unsupported, replayed, unsupported-waiver or contradictory MUST stays unsatisfied; the current independently produced evidence control passes; zero false MUST PASS. |
| H4 | Compose docs-only, docs+code, REQ-citing assertions, typo-only, code-only uncertainty, missing independent approval and waiver cases. | Each case has the expected obligation union and explicit `unknown`/`unavailable` outcomes where evidence is missing. |

Existing focused commands are `node ci/mechanism-325-3b-h1-qualification.test.js`, `node ci/mechanism-325-3a-doc-evidence.test.js`, `node ci/mechanism-325-f4-trust-boundary.test.js` and `node ci/mechanism-325-3a-cross.test.js`. They are mechanism evidence only; a green replay does not replace the host traces or paired real-task evidence above.

## Paired real-task protocol

Use the owner-registered five task families from [#320's paired-evaluation decision](https://github.com/dyphn1/Harness-everything/issues/320#issuecomment-6230246258): typo-only ADR context; normative PRD revision with approval; mixed code/docs change; REQ-tagged assertion change with valid/invalid waiver; broken derived/link evidence with unavailable verifier.

| Arm | Pinned commit | Condition |
|---|---|---|
| Baseline | Accepted [#327](https://github.com/dyphn1/Harness-everything/pull/327) merge `d9ff242c1fca1b308e4a9c3b55af257f12c44a82` | Current documentation workflow before the #326/#325 consumer slices. |
| Treatment | [#358](https://github.com/dyphn1/Harness-everything/pull/358) merge `550f1a24d327df7022ef3b32b6fe5409c5a7873b` | Includes declared-only #326 step type, #325 Phase 3a and limited Phase 3b consumer; set `HARNESS_DOC_RECONCILIATION_PILOT=1`. |

These are the comparison pins in the owner protocol. Measure baseline first; freeze task snapshots, rubric and baseline-derived threshold before inspecting treatment outcomes. Record host/model/effort/permissions and use fresh comparable contexts with counterbalanced pairs. An optional OFF run on the treatment commit can isolate switch overhead, but it is not the accepted #327 baseline; report the extra pilot-hook startup overhead separately.

For every arm retain the task/prompt and base/candidate hashes, commit, host/model/runtime and package versions, expected obligations, actual report, independent adjudication, task outcome, false MUST pass/rejection, audit/compatibility findings, correction effort, tokens, elapsed time, tool calls, retries, interventions, failure overhead and uncertainty. Judge task success/failure first; report successful-task cost separately from failed-run cost. The existing generic paired runner does not implement this doc-workflow treatment; do not record its other effects as #325 paired evidence.

**Status:** this protocol is preparation, not a run. The current H1 test results above remain the only evidence recorded here; #341 E1 is open with insufficient adjudicated exposure, and complete H1–H4, paired benefit and #320 promotion remain unchecked.
