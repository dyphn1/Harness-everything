# System One holdout corpus: labeling and review

This document defines how the reviewed tier holdout for
[System One](system-one-routing.md) is written, labeled, reviewed and
assembled (issue [#233](https://github.com/dyphn1/Harness-everything/issues/233),
Phase 3). The `reviewedHoldout` gate requires at least 200 holdout cases, at
least 50 per language, and `reviewed: true` on every case.

## Gold labels

A gold label answers one question: **which tier should Harness route this prompt
to, judged from the prompt alone?** The labels follow the tier model in
[routing.md](routing.md#three-tier-routing-model) and the fixed tier catalog.

| Gold | Use when the prompt asks for | Examples of shape |
| --- | --- | --- |
| `tier1` | One bounded operation with clear scope: a typo or doc fix, a narrow local edit, a bounded explanation or status check, a straightforward Git/GitHub operation, running a named command | "commit these changes", "fix the typo in README", "check the status of issue 85" |
| `tier2` | Implementation or a bug fix that needs iterative testing, a multi-file change, a focused review or benchmark | "the CLI fails with this error, fix it", "add a flag to the export command with tests" |
| `tier3` | Architecture or migration work, a repository-wide or multi-repository change, broad synthesis, a multi-phase plan, or bounded delegation to several agents | "audit every repo for convention violations", "split this feature into phases and implement phase 1" |
| `null` | Intent that cannot be determined from the prompt alone (a bare continuation, an answer to an earlier question, a reference to unstated context), or work outside software/project engineering | "go", "yes, next one", "1. agree 2. use hash", "close the other apps" |

Rules:

1. Judge the prompt alone. Do not assume conversation context that the prompt
   does not state. If the task depends on unseen context, the gold is `null`.
2. Label the work requested, not the words used. "Refactor" of one function is
   `tier1`/`tier2`; "every" or "all" over one file is not repository-wide.
3. Pick the smallest tier that covers the whole request. A prompt with a
   bounded operation plus real implementation work is `tier2`.
4. Explicit workflow words ("use fable", "no subagents") do not change the gold.
   Precedence is a router policy, not a label.
5. Never derive gold from the lexical router or any model output. A reviewer may
   read the proposed gold, but the recorded gold is the reviewer's decision.

## Cases

Each draft case has `id`, `family`, `language` (`en` or `zh-TW`), `source`,
`prompt`, `proposedGold` and a one-line `rationale`.

- **Family.** A family groups prompts that share one task scenario, such as
  "commit and push" or "fix a CLI error from a pasted log". Paraphrases,
  translations and variants of one scenario stay in one family, and a family
  never spans splits. All families in this corpus are `holdout`. Later train or
  validation data must use new families.
- **Source.** `synthetic:authored` marks a prompt written for the corpus.
  `derived:local-history` marks a prompt rewritten from the shape of a real
  local prompt: same length class, task type and phrasing style, with every
  name, path, product, customer, issue number and pasted log replaced. No real
  prompt text, person, organization or local path is committed.
- **Length.** The corpus follows the observed length profile of real local
  prompts (median about 90 UTF-8 bytes, about one in five over 224 bytes, a
  long tail with pasted logs), so that length limits are evaluated on realistic
  input, not only short prompts.

## Review

A human reviewer decides every case on the review page. The possible decisions are:

| Decision | Effect |
| --- | --- |
| `accept` | Gold is the proposed gold. |
| `relabel` | Gold is the reviewer's chosen label. |
| `reject` | The case is dropped: ambiguous even for a human, unrealistic, or it leaks private data. |

Each decision records the case ID, the SHA-256 of the exact prompt text it
reviewed (`promptHash`), the decision, the gold, and the reviewer role. The
assembler `scripts/system-one-corpus.js` builds the evaluation corpus from the
draft and the decisions:

- A case with a valid decision becomes `reviewed: true` with the reviewer's gold.
- A case without a decision, or whose prompt changed after review (hash
  mismatch), stays `reviewed: false` with the proposed gold, so the gate cannot
  pass on stale or missing review.
- A rejected case is omitted.
- The output passes `validateCorpus`, and the assembler reports per-language and
  per-gold counts plus whether the `reviewedHoldout` gate would pass.

The agent that drafts cases never records decisions. `reviewed: true` means a
human reviewed that exact text. Review records store a role
(`human:repository-owner`), not a name or account.
