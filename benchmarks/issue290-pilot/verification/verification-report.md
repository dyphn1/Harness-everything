# Verification report: issue #290 pilot report

Based on [verification-loop/templates/verification-report.template.md](../../../verification-loop/templates/verification-report.template.md). Scope: report, sanitized evidence archive, two helper fixes (#313, #314), and a sanitizer update. No production skill, router, hook, package, or distribution manifest changed. No model call was made during verification.

```
VERIFICATION REPORT
==================

Build:     NOT_APPLICABLE (no build artifact). Syntax checks PASS:
           py_compile (analyze.py, run.py, export.py, fable-supplement.py,
           analyze.test.py, fixture.test.py); node --check (grader.cjs,
           host-hook.cjs, hook.test.cjs).
Types:     NOT_APPLICABLE (no typed source changed).
Lint:      NOT_RUN (no lint gate covers benchmarks/issue290-pilot).
Tests:     PASS
           - Repo gates (14/14, exit 0): verification/final-gates.json.
             Run on Node 24.14.1 after `npm ci --ignore-scripts`, before the
             report and the sanitizer changes. No gate reads
             benchmarks/issue290-pilot (checked by grep); the three gates below
             were re-run after those changes.
           - Post-report re-run (exit 0): test:consistency, test:references,
             `waza tokens check` (verification/post-report/).
           - Helpers (verification/post-report/helper-tests.log):
             analyze.test.py 4/4 OK; fixture.test.py 1/1 OK; hook.test.cjs PASS.
Security:  PASS for the evidence scan. Sanitized archive and committed logs show
           no home path, username, host name, email address, or credential-shaped
           string. Retained public metadata: skill frontmatter `author:` and the
           public GitHub owner name. One truncated path fragment (`/Users/d`)
           carries no identifying content. npm audit baseline (fast-uri
           dev-dependency advisories, #309) is unchanged and not fixed here.
Diff:      See the changed-file list in the PR body.
Contract:  NOT_APPLICABLE. Runtime REQ/ADR lineage does not apply: report and
           tooling only, with no production contract change. Experiment
           provenance was checked: frozen-file hashes
           (preflight/frozen-files.json, fable-frozen-files.json,
           fable-retry-frozen-files.json), the independent Polyglot reference
           hash (65c1189d…350eb, re-graded 23/23; skeleton 0/23), and the QuixBugs
           upstream reference hash. The contract-integrity-audit wrapper was not
           run: it requires trace.json, which this report-only change does not
           produce.
           The evidence archive was re-extracted into a fresh directory:
           621/621 exported hashes and 621/621 raw hashes match; no extra or
           missing files.

Overall:   READY for draft PR review, as a pilot report.
           NOT READY for any formal efficacy, quality, or benefit claim
           (2 repeats per cell; artifact pass is not semantic completion).
```

## Evidence layer proven

- **Package:** not applicable. No package or manifest changed.
- **Deterministic mechanism:** the helper tests above, plus the repo gates. The fixture test asserts that Claude launch settings exist in the linked checkout before any model launch (#314).
- **Live host:** the real Codex CLI 0.162.1 and Claude CLI 2.1.299 ran the canonical router through their native UserPromptSubmit hook in the preflight and formal episodes (router attribution retained per episode). Full-plugin parity is not shown. Child dispatch and usage for the Luna true-Fable runs is partly unobservable (#315).
- **Behavior:** 40 retained attempts (32 formal and supplement model episodes, 4 preflight, 4 pre-model infrastructure). Two repeats per cell. Descriptive only.

## Budget compliance (deviation)

- Wall time: 5,260.8 s across the 32 model episodes, under the 7,200 s aggregate budget.
- Output tokens: the runner's `usage.output_tokens` (including thinking) sums to at least 508,416 across the 32 model episodes. The 500,000 aggregate cap was exceeded by at least 8,416 in the final Claude retry episode, which started at 485,478. Disclosed in the README. No further model calls.

## Issues to fix (not in this PR)

1. #308: Haiku lookup adds prose outside the JSON-only output.
2. #309: `fast-uri` dev-dependency advisories (baseline recorded; no dependency change here).
3. #310: `workflow-disposition --help` exits 2.
4. #311: loaded TDD steps skip the required quality report and gate.
5. #312: staged linked-list repair invents a head-contract conflict (an actual nested `Element` bug).
6. #315: Codex private-rollout subagent dispatch and usage accounting gap.
7. #316: blocked Fable recovery reminder versus plan rejection.
8. #317: stale legacy contract path (`execution-phases.md:32` versus `CONTRACT-FORMAT.md:66`).
9. #318: analyzer TDD flag matches `tdd:quality` text inside binding evidence (filed in this run).
10. Analyzer field semantics: `required_bindings_unresolved` counts pending step placeholders as unresolved. Documented in the README; the field is not used as a headline.
11. Runner budget check: the aggregate output cap is checked before each episode, so the final episode can overshoot. Document or change before any further run.

Fixed in this PR, with regression tests: #313 (scalar controller output in the analyzer) and #314 (missing Claude hook settings for the linked fixture).
