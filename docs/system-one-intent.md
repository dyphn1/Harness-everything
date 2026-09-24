# System One intent stage: catalog and labeling

This document defines the second stage of [System One](system-one-routing.md#staged-classification):
the **intent** of a prompt, meaning the kind of work it asks for (issue
[#233](https://github.com/dyphn1/Harness-everything/issues/233)). The tier stage is
defined in [system-one-corpus.md](system-one-corpus.md) and is unchanged. The intent
stage reuses the tier pipeline in [system-one-training.md](system-one-training.md) with
its own catalog, labels, holdout and gates.

## Intent labels

An intent label answers one question: **what kinds of work does this prompt ask the
assistant to do, judged from the prompt and its session context?** The catalog is the
repository owner's (confirmed 2026-09-24, with `edit` added the same day) and is fixed.
Its order is the scorer's option order.

A label has two parts:

- **Primary.** Exactly one intent, or `null`. This is the work that produces the main
  deliverable.
- **Secondary.** Zero or more other intents that the request also needs. Changing a
  default port, for example, is primary `edit` with secondary `test` and `docs` when
  tests and docs mention the port. Secondary never contains the primary intent or
  `null`, and it is empty when the primary is `null`.

| Gold | Use when the prompt asks the assistant to | Examples of shape |
| --- | --- | --- |
| `explain` | Answer a question or explain how something works, without deciding anything or changing files | "what does this flag do?", "why is this test slow?" (explanation only), "今天這段 code 在做什麼" |
| `discuss` | Weigh options, give an opinion, or settle a decision for work in progress | "should we keep the old name?", "1. agree 2. use hash", "你覺得哪個方案好" |
| `git` | Perform Git or GitHub housekeeping: commit, push, branch, merge, rebase, cherry-pick, tag, open or merge a PR, post a comment | "commit and push", "開 PR", "commit the sub-repos, then the main repo" |
| `fix` | Repair behavior that is wrong: a bug, a crash, a failing or flaky test, a build or CI failure, a dependency conflict | "the CLI panics here, fix it", "CI times out, find the cause and fix it" |
| `edit` | Change an existing value, setting, text or behavior on request, when it is neither a bug nor new behavior | "change the default port from 8080 to 3000", "把 timeout 改成 30 秒", "rename the button label to Save" |
| `feature` | Add new behavior: a command, an option, a format, an endpoint, a script, a migration | "add a --verbose flag", "support YAML input", "寫一個資料遷移腳本" |
| `refactor` | Restructure or unify existing code without new behavior: rename, move, extract, replace a pattern everywhere, upgrade a dependency | "rename component to module everywhere", "replace console.log with the logger", "把常數搬出去" |
| `review` | Evaluate an existing artifact against a standard: a PR, a diff, a design, a document, test coverage, a benchmark result | "review this PR", "檢查測試是不是只有 happy path", "audit the skill descriptions" |
| `test` | Run tests or builds, or write tests as the main deliverable | "run npm test", "add tests for the parser" |
| `docs` | Write or edit documentation as the main deliverable: README, guides, comments, changelogs, a memory note | "update the install guide", "改成全英文文件" |
| `plan` | Produce a plan, specification, roadmap, ADR or breakdown before implementation | "plan phase 4", "拆分實作階段", "write an ADR for the new cache" |
| `investigate` | Find facts or a cause and report back, without being asked to change anything | "find every repo still using the old logger", "查一下為什麼變慢，先不要改" |
| `null` | Nothing actionable: a bare continuation, a vague reaction, pasted status with no request, or a request outside software work | "go", "嗯", "今天股價多少" |

Rules:

1. **One primary intent, then the rest as secondary.** The primary is the work that
   produces the main deliverable. "Fix the bug and add a regression test" is primary
   `fix`, secondary `test`. "Investigate and fix" is primary `fix`, secondary
   `investigate`. "Implement the feature, then commit" is primary `feature`, secondary
   `git`. Add a secondary intent only when the request asks for it or clearly needs it,
   not for every step an assistant might take.
2. **Change beats inquiry.** When the prompt asks for a change, label the change, not
   the reading that precedes it. `investigate` and `explain` are for prompts that only
   ask for information.
3. **`investigate` against `explain`.** `investigate` needs searching or running
   something to find facts; `explain` can be answered from what is already known or
   shown.
4. **`review` against `investigate`.** `review` judges a given artifact against a
   standard; `investigate` looks for a cause or for facts that are not yet known.
5. **`fix`, `edit`, `feature` and `refactor`.** Wrong behavior made right is `fix`.
   A requested change to a value, setting, text or existing behavior that was not wrong
   is `edit`. New behavior is `feature`. The same behavior in a new structure is
   `refactor`.
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
through the same owner review as the tier holdout. An intent review decision also
records `secondary`, the list of secondary intents. `accept` and `relabel` refer to the
primary intent only. The review records live in
`benchmarks/fixtures/system-one-intent-reviews.json`, and the evaluation corpus is
`benchmarks/fixtures/system-one-intent-holdout.json`. The `reviewedHoldout` gate is the
same: at least 200 reviewed cases and at least 50 per language. The report also gives
the count per intent, because a class with only a few holdout cases cannot be measured.

**Scope.** The intent stage runs only on actionable prompts. When the tier stage
abstains (`unclassified`), no intent is asked. In the first review the owner rejected
all 25 non-actionable prompts, which left 190 cases, so the holdout gains
**supplementary intent-only families** (`synthetic:authored`). Those families favor
the thinnest intents (`test`, `plan`, `discuss`, `review`, `edit`). They are appended
to the intent draft, reviewed the same way, and added to the training-leakage filter
like every holdout prompt.

## Scoring

System One gives a probability for every intent. The highest is the predicted
primary, and every other intent at or above a calibrated threshold is a predicted
secondary. The skills stage consumes the primary intent together with the accepted
secondary intents.

Two intent labels are compared by **graded agreement**. Each side is a primary `p`
plus a secondary set `S`, and its full set is `{p} ∪ S`. The owner set these grades:

| Case | Score |
| --- | --- |
| Same primary | 1.0 |
| Different primaries, and each primary is in the other side's full set (only the order differs) | 0.6 |
| Different primaries, and only one primary is in the other side's full set; or the order differs but the secondary counts differ by 3 or more | 0.3 |
| Neither primary is in the other side's full set | 0 |

Both sides agreeing on intent but differing in order or in the number of steps means
the same goal with a different breakdown, not a different goal. Graded agreement is
reported next to exact primary agreement, never instead of it. The same grades apply
to the labeler check and to accepted predictions of a model.

**Family consistency.** A family groups variants and translations of one scenario.
The report gives the share of families whose members share one primary intent, for the
owner's gold and for the predictions. This makes a language-dependent intent visible
without treating every variant as a translation.

## Training data

The collected prompts are labeled a second time, for intent. The labeler returns a
primary and a secondary list for each prompt. Intent labels are stored beside the tier
labels, never in place of them. Owner spot-checks for intent show session context, like
the tier spot-checks. The labeler check against the intent holdout must reach a graded
agreement of 80% before training data is labeled.

## Gates

The intent stage uses the rollout gates of
[system-one-routing.md](system-one-routing.md#rollout-gates): accepted precision at least
85% (graded agreement over accepted predictions, with exact primary precision
reported beside it), coverage at least 80%, repeatability, warm p95 at most 100 ms and
verified provenance. There is no lexical intent router, so the macro-F1 baseline is the
majority-class predictor on the holdout.
