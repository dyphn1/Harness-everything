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
| `tier1` | Something answered or done without changing project behavior: Git/GitHub housekeeping (commit, push, open a PR, sync, tag, post given results as a comment), a status check, reading a log or searching and reporting, the smallest doc fix (a typo, a link, an ignore entry), or a reply the assistant can give directly, including non-engineering chores and discussion questions | "commit these changes", "is issue 88 still open?", "find every repo still using the old logging package", "close the other apps" |
| `tier2` | A bounded change or investigation: any code, configuration or CI edit (a rename, a value, a revert), running tests or a build, filing an issue, explaining code that must be read first, most bug fixes, a focused review or benchmark, planning or synthesis that produces documents (phase plans, an ADR, an overview), and answers that settle open decisions for work in progress | "rename tmp to buffer", "run npm test", "the CLI fails with this error, fix it", "1. agree 2. keep the old name" |
| `tier3` | Work that needs several agents (sub-agents included); a new module or subsystem, a refactor, or a change to a framework or interface definition; or code or design work that spans several repositories or several workflows | "add a plugin system to the CLI", "refactor the parser into modules", "change the plugin interface", "dispatch agents to audit every repo" |
| `null` | No actionable content: a bare continuation, "do what you said", a vague reaction, a question about what the assistant meant, or pasted status with no request | "go", "yes", "照剛剛說的改", "something is off here" |

Rules:

1. Label the work the prompt would start. A reply that settles decisions for
   work in progress ("1. agree 2. use hash") is labeled by that work, not `null`.
   Use `null` only when no work can be identified at all.
2. Label the work requested, not the words used. Searching every repository and
   reporting is `tier1`; changing every repository is `tier3`.
3. Pick the smallest tier that covers the whole request.
   A question, a confirmation, a discussion point, or a request to restate,
   reformat or extend the assistant's previous answer without changing files is
   `tier1`. A requested change to code or configuration, however small, is at
   least `tier2`. Only the smallest doc fixes listed in the table stay `tier1`.
   The line between `tier2` and `tier3` is the owner's: `tier3` when the work
   needs several agents or sub-agents, adds a feature, refactors, changes a
   framework or interface definition, or spans several repositories or
   workflows. Fixing, adjusting, investigating or reviewing existing behavior
   within one workflow is `tier2`.
   The owner settled four more lines from the third spot-check:
   - **Git is `tier1` at any width.** Committing sub-repositories and then the
     main repository is still housekeeping. "Several repositories" applies to
     code or design work only.
   - **Scope, not the word "add".** Adding an option, a function or a parser
     inside one existing tool or component is `tier2`. A new module or
     subsystem, or an addition that spans several components, is `tier3`.
     A bug fix, even with a regression test, is `tier2`.
   - **Repository-wide or cross-component work is `tier3`.** Replacing or
     unifying a pattern across the repository (every `console.log`, all error
     handling, every path in a report), upgrading a dependency and fixing what
     breaks, a data migration, a CI matrix across platforms, or restructuring a
     documentation tree is `tier3`, even when each edit is small.
   - **A short reply follows the work in progress.** A reply that asks to
     change an output (code, a document, an example) is `tier2`. Only a pure
     question or a bare acknowledgement stays `tier1`.
   - **Explicit agents or architecture make `tier3`.** A request for several
     agents, a team discussion or a verifier pass, or one that redefines an
     architecture, is `tier3` even when it is phrased as discussion.
4. Explicit workflow words ("use fable", "no subagents") do not change the gold.
   Precedence is a router policy, not a label.
5. Never derive gold from the lexical router or any model output. A reviewer may
   read the proposed gold, but the recorded gold is the reviewer's decision.

These definitions are the repository owner's, recorded after the first review
of the draft: the owner's labels moved many drafted cases one tier up, labeled
context-dependent replies by their work, and gave non-engineering chores
`tier1`. The draft's `proposedGold` values predate this and are only
suggestions. Acknowledgements, reactions, host commands (`/compact`) and meeting
notes were rejected from the holdout because they never reach routing as tasks.

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
(`human:repository-owner`), not a name or account. When a decision contradicts
the owner's decisions on sibling cases, the agent may ask the owner to confirm
it. The owner's answer is recorded as the decision, and the agent never changes
a decision on its own.

## Committed files

| File | Content |
| --- | --- |
| `benchmarks/fixtures/system-one-holdout-draft.json` | Draft cases with proposed gold |
| `benchmarks/fixtures/system-one-holdout-reviews.json` | Owner decisions (ID, prompt hash, decision, gold, role) |
| `benchmarks/fixtures/system-one-holdout.json` | Evaluation corpus, rebuilt with `node scripts/system-one-corpus.js build <draft> <reviews> <corpus>` |

The reviewed holdout has 215 cases (11 rejected): en 93 and zh-TW 122; gold
`tier1` 48, `tier2` 104, `tier3` 43 and `null` 20. It meets the `reviewedHoldout`
gate. After the third training spot-check the owner moved nine cases to the new
lines: `h-long-git-ops-1` to `tier1`, and the `h-add-cli-flag-*`,
`h-hash-algorithm-support-1/2`, `h-fix-cli-error-log-3/4` and
`h-fix-failing-test-3` cases to `tier2`. Results recorded before that change
used 47 `tier1`, 97 `tier2` and 51 `tier3`. It says nothing about model quality until a `harness-routing-v1`
checkpoint is evaluated on it.
