# Document-evidence boundary enforcement (#341 Phase 0C)

## C1 method decision

The C1 isolation trial does **not** establish enforcement equivalence for the document-evidence
read boundary. The approved dependency-free checker rejects nine of eleven weakened-boundary
controls in both distributions. N05 and N06 survive with complete C1 coverage and no diagnostics:
each adds an unapproved read inside an existing compatibility method, and C1 checks that method's
API/call surface without constraining its body. The plan therefore requires the bounded AST/source
supplement in C2 before any E0 acceptance. These survivors are recorded as survivors; they are not
out of scope, and corpus behavior does not count as their enforcement.

## Checked source graph and policy

`ci/lib/doc-evidence-boundary-check.js` exports only `checkBoundary({ distribution, sources,
policy, method })`. For this trial `method` is `isolation`, and `sources` is the exact evaluator and
capture source text supplied by the caller. The checker does not read source files itself. The
mechanism suite loads and checks each pair independently:

- canonical: `harness-everything/scripts/doc-evidence.js` and
  `harness-everything/scripts/doc-evidence-capture.js`;
- packaged: `plugins/harness-everything/skills/harness-everything/scripts/doc-evidence.js` and
  `plugins/harness-everything/skills/harness-everything/scripts/doc-evidence-capture.js`.

In the restricted VM, the evaluator's relative capture import resolves to the exact supplied
capture text. The capture module may import only the declared `crypto` builtin. The policy at
`ci/fixtures/doc-obligations/read-boundary/boundary-policy.json` is fixed input; the checker
validates its required module/context surfaces, return schemas, ownership rules, call-site list,
compatibility anchors, and nine coverage IDs. Missing or malformed policy schemas fail closed.
The C1 policy fields remain unchanged. C2 adds a separate, pinned AST supplement to the same
policy file; its final file hash is recorded in the C2 report.

The checker provides deterministic mechanism evidence for these C1 surfaces:

- exact evaluator/capture exports and import edges;
- evaluator context handoff and consumer keys;
- invocation and obligation capability names;
- reachable tagged return shapes and primitive schemas;
- recursively detached, plain owned views, opaque tokens, and repeated detached arrays;
- exact direct capture call-site counts, including rejection of computed and optional-chain calls;
- reviewed compatibility-site anchors.

It compiles and exercises the supplied modules with synthetic objects; it does not wrap or freeze
production caller objects or add production reads. The returned-view exercise checks reachable
values and ownership. It is not source-flow analysis. Direct capability aliases, cross-function
transfers, and statements or dormant branches added inside an already permitted compatibility
method remain possible C1 bypasses. Compatibility anchors prove that reviewed text is present at
declared sites; they do not constrain the complete body or control-flow footprint of those sites.

## Trial evidence

`ci/mechanism-341-boundary-enforcement.test.js` applies each transform in
`ci/fixtures/doc-obligations/read-boundary/boundary-controls.json` exactly once to the selected
in-memory pair, parses both changed texts, and calls the checker with the unchanged frozen policy.
It checks the fixture-pinned intended rule for each rejection, records complete-coverage survivors,
and includes a diagnostic-sink mutation that must make the N01/N02/N03 rejection assertions fail.
Unchanged canonical and packaged pairs are positive checks.

On Node.js 24.14.1 the focused suite passed, and `npm run test:mechanism` discovered 106 suites and
passed all 106, including the C1 suite. For each distribution the unchanged pair passed with all
nine coverage IDs complete and no diagnostics. The 11 controls produced nine `REJECTED`, two
`SURVIVED`, and zero `UNCHECKED` outcomes:

| Controls | Result in both distributions |
|---|---|
| N01d, N02d, N01, N02 | Rejected by the exact evaluator context surface |
| N03, N04 | Rejected by returned-view ownership checks |
| N07 | Rejected by capture call-site drift under COMP-C5 |
| N08 | Rejected by the exact obligation capability surface |
| N09 | Rejected by the exact module export surface |
| N05, N06 | Survived with complete coverage and no diagnostics |

N05 adds a candidate-bound read within the existing COMP-C2-BOUND method. N06 adds a dormant
unvisited read within the compatibility boundary. Both demonstrate the same unbounded-method-body
gap, including when ordinary corpus cases do not take the changed branch. The C1 fixture pins them
as survivors; C2 below supplies their structural rejection. The C1 trial does not qualify E0 or
establish live-host enforcement.

## C2 structural supplement

The checker retains `method: "isolation"` as the C1 leg and adds `method: "ast"` as a separate
structural leg. The AST leg parses the exact evaluator/capture texts passed by its caller and never
substitutes source read from disk. Its reviewed policy pins both complete module AST fingerprints
and named targets for `checkDocObligations`, `evaluateObligation`, its exact consumer-context
destructure, `captureEntry`, `createInvocationCapture`, `compatibilityCandidateBound`,
`isPlainObject`, and `module.exports`. Each named target assigns alpha-normalized names to uniquely
declared identifiers that occur in that target, numbering them in target-local AST order. A
declaration added elsewhere therefore cannot renumber unrelated target fingerprints. A changed
named target emits its structural rule; module-wide drift also emits `AST_SOURCE_STRUCTURE`.
Thus a new read, dormant branch, helper edge, handoff field, or export cannot be admitted merely
because it uses an existing method name or is not reached by the corpus.

Fingerprints omit comments, source locations, and literal raw spelling; they preserve AST node
shape, operators, guards, property names, and statement/call order. The target normalizer retains
safe renames of uniquely declared enclosing locals referenced by nested targets, while a local
addition to one target cannot shift another target's names. The full-module fingerprint applies the
same alpha normalization across the whole program. Names with ambiguous declarations are kept
verbatim, making some otherwise safe renames require an explicit policy review. The whole-module
fingerprint is deliberately conservative: any other semantic source change needs a reviewed
fingerprint update and the corresponding trace replay.
Unknown walker nodes, parse failures, missing targets, policy errors, unavailable parser packages,
and parser-version drift fail the AST coverage gate.

Acorn 8.19.0 and acorn-walk 8.3.5 are exact development dependencies used only by CI. The checker
also verifies the installed versions against the frozen policy. The parser is not part of the
installed skill runtime. Both canonical and packaged source pairs are checked independently.

The C2 in-memory trial applied all 11 frozen N01–N09 transforms (including N01d/N02d) to each
distribution. All 22 attempts had complete AST coverage and were rejected with their fixture-pinned
intended rule, including N05/N06 as `COMP-C2-BOUND`. Unchanged pairs passed. A unique local rename
combined with CRLF/trailing-comment formatting passed in each distribution. A syntax-invalid
control produced an incomplete AST result with `AST_PARSE_COMPLETE`, not a boundary PASS. The
existing C1 enforcement suite still passes with its original isolation outcomes, and the repository
mechanism discovery run passed all 106 suites on Node.js 24.14.1. These are deterministic mechanism
results; they do not establish live-host enforcement or qualify E0. C3 mutation/compatibility
qualification and the final C4 merged-SHA gates remain required. See
[the baseline-binding contract](doc-evidence-baseline-binding.md) for the read roles and
compatibility behavior the supplement must preserve.

### C3 target-local repair

The C3 attribution probe added an unused local to capture's `isPlainObject`. After the target-local
normalizer change, the AST reports `AST_PROGRAM_DRIFT` plus exactly one target drift:
`isPlainObject` under `AST_SOURCE_STRUCTURE`; no unrelated target fingerprint moves. The established
local-rename positive still passes.

The policy also pins `evaluateObligation`'s context-consumer destructure as the
`@evaluateObligation-context-destructure` target under `EVALUATOR_CONTEXT_EXACT`. N02c was applied
and checked separately in both distributions: it emits that exact target/rule pair with complete
AST coverage. The enclosing `evaluateObligation` function fingerprint also detects the body edit
under `CAPTURE_CALL_SITES`; the precise destructure target independently supplies the intended
context-surface rejection. The 11 existing AST controls were re-run in both distributions and all
22 were rejected under their intended rule. N02c remains isolation-only in the Haiku-owned control
fixture; the local AST check is not yet a persistent suite assertion. These results address C3's
two executed findings without changing the control or enforcement-test files.
