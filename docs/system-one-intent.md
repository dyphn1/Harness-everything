# System One intent stage: catalog and labeling

This document defines the second stage of [System One](system-one-routing.md#staged-classification):
the **intent** of a prompt, meaning the kind of work it asks for (issue
[#233](https://github.com/dyphn1/Harness-everything/issues/233)). The tier stage is
defined in [system-one-corpus.md](system-one-corpus.md) and is unchanged. The intent
stage reuses the tier pipeline in [system-one-training.md](system-one-training.md) with
its own catalog, labels, holdout and gates.

## Intent labels

An intent label answers one question: **what kind of work does this prompt ask the
assistant to do, judged from the prompt and its session context?** The catalog is the
repository owner's (confirmed 2026-09-24) and is fixed. Its order is the scorer's
option order.

| Gold | Use when the prompt asks the assistant to | Examples of shape |
| --- | --- | --- |
| `explain` | Answer a question or explain how something works, without deciding anything or changing files | "what does this flag do?", "why is this test slow?" (explanation only), "今天這段 code 在做什麼" |
| `discuss` | Weigh options, give an opinion, or settle a decision for work in progress | "should we keep the old name?", "1. agree 2. use hash", "你覺得哪個方案好" |
| `git` | Perform Git or GitHub housekeeping: commit, push, branch, merge, rebase, cherry-pick, tag, open or merge a PR, post a comment | "commit and push", "開 PR", "commit the sub-repos, then the main repo" |
| `fix` | Repair behavior that is wrong: a bug, a crash, a failing or flaky test, a build or CI failure, a dependency conflict | "the CLI panics here, fix it", "CI times out, find the cause and fix it" |
| `feature` | Add new behavior: a command, an option, a format, an endpoint, a script, a migration | "add a --verbose flag", "support YAML input", "寫一個資料遷移腳本" |
| `refactor` | Restructure or unify existing code without new behavior: rename, move, extract, replace a pattern everywhere, upgrade a dependency | "rename component to module everywhere", "replace console.log with the logger", "把常數搬出去" |
| `review` | Evaluate an existing artifact against a standard: a PR, a diff, a design, a document, test coverage, a benchmark result | "review this PR", "檢查測試是不是只有 happy path", "audit the skill descriptions" |
| `test` | Run tests or builds, or write tests as the main deliverable | "run npm test", "add tests for the parser" |
| `docs` | Write or edit documentation as the main deliverable: README, guides, comments, changelogs, a memory note | "update the install guide", "改成全英文文件" |
| `plan` | Produce a plan, specification, roadmap, ADR or breakdown before implementation | "plan phase 4", "拆分實作階段", "write an ADR for the new cache" |
| `investigate` | Find facts or a cause and report back, without being asked to change anything | "find every repo still using the old logger", "查一下為什麼變慢，先不要改" |
| `null` | Nothing actionable: a bare continuation, a vague reaction, pasted status with no request, or a request outside software work | "go", "嗯", "今天股價多少" |

Rules:

1. **One primary intent.** Label the work that produces the main deliverable. "Fix
   the bug and add a regression test" is `fix`. "Investigate and fix" is `fix`.
   "Implement the feature, then commit" is `feature`.
2. **Change beats inquiry.** When the prompt asks for a change, label the change, not
   the reading that precedes it. `investigate` and `explain` are for prompts that only
   ask for information.
3. **`investigate` against `explain`.** `investigate` needs searching or running
   something to find facts; `explain` can be answered from what is already known or
   shown.
4. **`review` against `investigate`.** `review` judges a given artifact against a
   standard; `investigate` looks for a cause or for facts that are not yet known.
5. **`fix` against `feature` against `refactor`.** Wrong behavior made right is `fix`.
   New behavior is `feature`. The same behavior in a new structure is `refactor`.
6. **Short replies follow the work in progress**, as in the tier rules. A reply that
   asks to change an output takes the intent of that change ("not this format, use the
   table" in a docs session is `docs`). A reply that settles decisions is `discuss`.
7. **Intent is independent of tier.** A repository-wide `refactor` is `tier3` and a
   one-line `refactor` is `tier2`; both are `refactor`. Never infer intent from a tier
   label or tier from an intent label.
8. **Never derive gold from the lexical router or any model output.** A reviewer may
   read a proposed intent, but the recorded gold is the reviewer's decision.

## Holdout

The intent holdout reuses the prompts of the tier holdout
(`benchmarks/fixtures/system-one-holdout.json`). Their families are already
holdout-only, so no training prompt can leak into them. Each case gets an intent gold
through the same owner review as the tier holdout. The review records live in
`benchmarks/fixtures/system-one-intent-reviews.json`, and the evaluation corpus is
`benchmarks/fixtures/system-one-intent-holdout.json`. The `reviewedHoldout` gate is the
same: at least 200 reviewed cases and at least 50 per language. The report also gives
the count per intent, because a class with only a few holdout cases cannot be measured.

## Training data

The collected prompts are labeled a second time, for intent. Intent labels are stored
beside the tier labels, never in place of them. Owner spot-checks for intent show
session context, like the tier spot-checks. The labeler check against the intent
holdout must reach 80% before training data is labeled.

## Gates

The intent stage uses the rollout gates of
[system-one-routing.md](system-one-routing.md#rollout-gates): accepted precision at least
85%, coverage at least 80%, repeatability, warm p95 at most 100 ms and verified
provenance. There is no lexical intent router, so the macro-F1 baseline is the
majority-class predictor on the holdout.
