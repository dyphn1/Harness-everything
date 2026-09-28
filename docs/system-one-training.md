# System One training data and weights

This document defines how the `harness-routing-v1` tier checkpoint for
[System One](system-one-routing.md) is trained, calibrated and released
(issue [#233](https://github.com/dyphn1/Harness-everything/issues/233), Phase 4).
Gold labels follow [system-one-corpus.md](system-one-corpus.md). The owner-reviewed
holdout in that document is used only for evaluation. It is never used for training,
threshold selection or labeler tuning.

## Pipeline

1. **Collect**: copy the owner's own prompts from local assistant histories into a local
   dataset (`scripts/system-one-collect.js`).
2. **Label**: an LLM labels each prompt against the owner's rules. The labeler is checked
   once against the holdout, and the owner spot-checks a sample
   (`scripts/system-one-label.js`).
3. **Train**: train a fresh `cua_s1` `tinyx` scorer on the train split and select the epoch
   on the validation split.
4. **Calibrate**: choose the confidence and margin thresholds on validation.
5. **Evaluate**: produce one paired report on the holdout.
6. **Release**: publish the weights as a GitHub release asset. The installer pins them by
   SHA-256.

## Sources

Only text the owner typed is collected. Injected context, tool output and assistant text are
never collected.

| Source | Location | User text |
| --- | --- | --- |
| Claude Code | `~/.claude/projects/*/*.jsonl` | `type: "user"` records that are not meta or sidechain, string content or text parts |
| Codex | `~/.codex/sessions/**/*.jsonl` | `event_msg` `user_message.message`. Older sessions without it fall back to `response_item` user text |
| Copilot CLI | `~/.copilot/session-state/*/events.jsonl` | `user.message` `data.content` |
| VS Code Copilot Chat | `%APPDATA%/Code/User/workspaceStorage/*/chatSessions/*.json(l)` and `globalStorage/emptyWindowChatSessions` | `requests[].message.text` in snapshots (`kind: 0`) and request pushes (`kind: 2`, key `["requests"]`) |

The following are dropped:

- Text that starts with an injected wrapper tag, such as `<environment_context>`,
  `<system-reminder>`, `<command-…>`, `<task-notification>` or `<ide_…>`.
- Tool results.
- Slash commands.
- Session-continuation summaries ("This session is being continued…").
- Empty text.

Codex sessions are kept only when they are interactive, meaning `session_meta` has a
`source` of `vscode` or `cli` and an originator that is neither `Claude Code` nor
`codex_exec`. Exec sessions, sub-agent threads and sessions another agent started contain
prompts written by an agent, not by the owner. VS Code terminal notifications
(`[Terminal … notification …`) are dropped as well.

## Filters, families and splits

- **Length**: at most 1024 UTF-8 bytes, which matches the checkpoint's `context_tokens`. A
  longer prompt is still refused at inference and falls back to lexical routing. It is never
  truncated.
- **Deduplication**: exact duplicates after whitespace normalization are dropped. The first
  occurrence is kept.
- **Holdout leakage**: a prompt is dropped if its character-trigram Jaccard similarity to any
  holdout prompt is at least 0.5. The same applies if either prompt contains the other after
  normalization and the shorter one is more than 12 characters long. This matters because
  the holdout includes rewrites of local prompt shapes.
- **Family**: the source session. Prompts from one conversation never span splits.
- **Split**: 15% of families go to `validation`, chosen by a stable SHA-256 of the family ID.
  The rest go to `train`.

## Privacy

- Collected prompts and labels stay on the local machine under
  `~/.agents/harness-everything/system-one/training/` and are **never committed**. The
  repository holds only the scripts, aggregate statistics and the SHA-256 of each dataset
  file.
- Email addresses and user home paths are replaced with placeholders before storage. Names
  and product terms are not reliably detectable and remain.
- The released weights come from a 4-way byte-level classifier with about 0.7M parameters. It
  has no text-generation head, but a trained model can still encode fragments of its data.
  The owner accepted this for their own prompts.
- Labeling sends the prompts to the Claude API. The owner authorized this.

## Labeling

- **Labeler**: `claude -p` with Sonnet.
  - Flags: `--setting-sources ""` (no hooks or plugins), `--no-session-persistence` (labeling
    sessions never become collectable history), `--tools ""` and a JSON schema.
  - The instructions contain the gold table and rules from
    [system-one-corpus.md](system-one-corpus.md).
  - Prompts go in batches of 100. `--max-batches N` stops after N batches so a
    memory-constrained host can label in short foreground runs that resume from the
    labels already written. Every returned index must be labeled exactly once with
    `tier1`, `tier2`, `tier3` or `null`. A malformed batch is retried once and then
    recorded as failed. It is never partially accepted.
- **Labeler check**: the labeler labels the 215 holdout prompts once, before any training
  data is labeled. The report gives agreement with the owner's gold and the per-class recall.
  - Labeling proceeds only when agreement is at least 80%.
  - The instructions are never tuned on the holdout. If the check fails, the owner reviews
    the disagreements and decides how to proceed.
- **Owner spot-check**: a deterministic sample of the labeled training data is reviewed on
  the review page, and the disagreement rate is reported.
  - Each case shows the preceding prompts from the same session as read-only context.
    Without it, short replies read as confirmations: the first spot-check (103 cases,
    no context) disagreed 51% and was not used to override labels.
  - A checkpoint may be trained before the spot-check, but it is released only when
    disagreement is below 20%.
  - Decisions made with context replace the LLM labels for those cases.

## Training and calibration

- **Tier engine**: `scripts/system-one-train-ngram.py` trains the `ngram` transport, a
  multinomial logistic regression over hashed character n-gram features. Featurization
  follows [system-one-routing.md](system-one-routing.md#n-gram-provider-phase-4).
  - The trainer uses torch for the optimizer only. The features are stdlib Python and match
    the Node provider exactly.
  - The configuration (`nmax`, class weighting, weight decay) is chosen on validation
    macro-F1. The first exploration picked `nmax` 3, square-root inverse-frequency class
    weights and a weight decay of 1e-4.
  - The output is the `.bin` weights, the `.json` sidecar and validation scores for
    calibration.
- The `tinyx` path below is kept for comparison. Its first checkpoint learned little beyond
  class priors.
- **Model** (`tinyx`): a new `cua_s1` `tinyx` scorer built with `make_system`.
  - Config: `width` 128, `rank` 128, `layers` 2, `heads` 4, `context_tokens` 1024 and
    `option_tokens` 96.
  - Weights are initialized fresh, not from the forms checkpoint, whose domain and
    positional range differ.
- **Target**: each example is the fixed tier catalog with the index of the gold option.
  `null` maps to `unclassified`.
- **Optimization**:
  - Cross-entropy, AdamW, a fixed seed and CPU.
  - The epoch with the lowest validation negative log-likelihood is kept.
  - The checkpoint metadata records the dataset hashes, the config and the validation metrics.
- **Calibration**: `minConfidence` and `minMargin` are chosen on validation to maximize
  coverage, subject to an accepted precision of at least 85% (the owner's advisory target). The router currently uses the
  Phase 0 defaults (0.9 and 0.2). Carrying calibrated thresholds into the manifest is a
  separate contract change.

## Evaluation and release

- **Evaluation**: `scripts/evaluate-system-one.js` runs once on
  `benchmarks/fixtures/system-one-holdout.json` with the new manifest. The rollout gates and
  the lexical baseline (macro-F1 0.254) decide the result. The report goes under
  `benchmarks/results/system-one/`.
- **Release**: the `.safetensors` and `.json` files are attached to a GitHub release. The
  installer's pins gain the new model ID, revision, `domain: "harness-routing-v1"` and both
  SHA-256 values. Until every rollout gate passes, the router default stays `off`.
