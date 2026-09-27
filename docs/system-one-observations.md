# System One observations: collecting routing data from real sessions

Status: **accepted**, 2026-09-27. Owner decisions are recorded below.
Implementation: `hooks/scripts/observation-hook.js`,
`hooks/scripts/lib/observations.js`, `scripts/system-one-observations-export.js`
and `scripts/system-one-observations-review.js`; tests in
`ci/mechanism-34-observations.test.js`. Issue
[#233](https://github.com/dyphn1/Harness-everything/issues/233).

## Why

Two data problems limit the System One scorers
([system-one-suggestion-gates.md](system-one-suggestion-gates.md)):

1. There are too few valid, text-decidable examples.
2. Teacher labels from an offline LLM are thin, and were often assigned with
   session context the small model never sees.

Every Harness turn already produces better material. The host LLM sees the
whole conversation, states its view in the Harness Status, and then acts.
Recording the prompt, that view, and what the agent actually did, turn by
turn, gives labeled data that grows with daily use. The data covers
validity, intent, tier, workflow and skills.

## Owner decisions (2026-09-27)

- The host LLM adds one machine-readable label line to its final message
  each turn. The token cost is accepted.
- Collection is **on by default**, with no environment variable needed to
  enable it. `HARNESS_OBSERVATIONS=off` turns it off; this opt-out exists
  because the plugin ships to other users.
- Hosts: **Claude Code** and **Codex** first.
- This document is the specification; implementation follows
  docs → RED → GREEN.

## One observation per turn

A turn runs from `UserPromptSubmit` to `Stop`. Its record:

| Field | Source | Notes |
| --- | --- | --- |
| `id`, `sessionId`, `turn`, `host`, `observedAt` | hooks | `id` = hash of session id + turn |
| `prompt` | `UserPromptSubmit` | stored in the private text store only (see Storage) |
| `previous` | the last assistant message before the prompt | truncated to 2 KB; text store only |
| `router` | kernel-router output | lexical tier, strategy, suggested skills; System One shadow scores when present |
| `behavior` | `PostToolUse` | counts and categories, never arguments: files written, distinct repositories written, files created, commands by class (git, gh, test, build, package, shell), skills loaded or read, subagents started |
| `workflow` | `workflow-run.json` / `workflow-disposition` | selected and confirmed strategy |
| `selfReport` | label line in the final message | see below; `null` if missing or invalid |
| `derived` | exporter | labels computed from the fields above |

### Label line

At the end of the final message of each turn the agent writes one line,
which is invisible in rendered Markdown:

```
<!-- harness-label {"v":1,"validity":"actionable","contextDependent":false,"tier":"tier2","intents":["fix","test"],"workflow":"iterative-single","skills":["tdd"]} -->
```

| Key | Values |
| --- | --- |
| `validity` | `actionable` or `invalid` (continuation, feedback on earlier work, pointer to earlier content, paste or chatter) |
| `contextDependent` | `true` when the prompt text alone would not have been enough to know the task |
| `tier` | `tier1`, `tier2`, `tier3` or `null`, under tier rules v2 |
| `intents` | up to 3 of the 12 intent ids, strongest first |
| `workflow` | a router strategy id or `null` |
| `skills` | skill ids actually used this turn |

The line states the agent's own judgement **after** the work, not a copy of
the router's suggestion. A line that does not parse, or uses unknown ids, is
recorded as `selfReport: null` with a reason code; it never blocks the turn.

## Labels and how much to trust them

The label is the host LLM's own judgement. It saw the whole conversation and
did the work, so no fixed rule replaces it (owner decision, 2026-09-27: no
file-count threshold for tier).

| Label | Source | Override |
| --- | --- | --- |
| validity, contextDependent | self-report | owner review |
| intents | self-report | — |
| tier | self-report (tier rules v2) | owner review |
| workflow | self-report, else the confirmed strategy | — |
| skills | skills actually loaded or read, else the self-report | — |

Behavior counters (files, repositories, command classes, skills,
subagents) are kept as **evidence**, never as a label rule. They serve two
purposes:

- **Contradictions.** Some records contradict themselves. A `tier1` label
  after files were written contradicts the tier1 definition (no code
  change). These records go to the owner's review page.
- **Future features.** The counters can train or check later models
  without re-reading transcripts.

**Owner review.** Missing labels, contradictions, and turns where the
router's tier and the self-reported tier differ go to a blind review page.
The owner's decisions override the self-report.

**Bias controls.** The agent sees the router's suggestion before it
answers, so it may copy it. Router output and self-report are both stored.
Each export reports how often they agree; a rate close to 1 over many turns
is a warning sign. The review page samples the turns where they differ.

## Storage, index and privacy

- **Location**: `~/.agents/harness-everything/system-one/observations/`,
  outside every workspace. It is never written under `memories/repo`, which
  can be committed.
- **Text store**: `text/<sha256>.json` holds `prompt` and `previous`, with
  the collector's redaction applied (email addresses and home paths).
- **Index**: `observations-index.json` uses the `index_memory.js` record
  shape: `schemaVersion: 1` and `records[]`. Each record has `id`,
  `status`, `validUntil`, `contentSha256`, `scope`, `writer.sessionId` and
  `source: "observation"`, plus the non-text fields above. `scope.taskTerms`
  hold normalized terms, so `retrieveMemoryRecords`-style lookups can find
  similar past turns.
- **Retention**: `validUntil` is 180 days after `observedAt`. An expired
  record keeps its labels, but its text is deleted.
- **Telemetry stays content-free.** The telemetry channel keeps its
  `FORBIDDEN_KEYS` rule. Observations are a separate, local-only channel and
  are never uploaded by Harness.
- `PRIVACY.md` is updated to state that prompts and the previous assistant
  message are stored locally by default, where they are stored, how long
  they are kept, and how to turn this off.

## Hosts

- **Claude Code**: plugin hooks `UserPromptSubmit`, `PostToolUse` and
  `Stop`. The final message is read from the Stop payload or from the
  transcript the payload points to.
- **Codex**: the same plugin hooks. Codex hook payload fields differ; the
  exact fields for the prompt and the final message are verified against
  the installed Codex version during implementation, never assumed.
- A missing field records `null` with a reason code. Collection must never
  block, slow down, or fail a turn; each hook has a short time budget.

## Export

`scripts/system-one-observations-export.js` writes to the private data
repository:

- `prompts-observed.jsonl`: `{id, family, source: "observation", split, text}`
- `labels-observed.jsonl`: `{id, validity, contextDependent, tier, tierSource, intents, workflow, skills}`

`family` groups near-duplicate prompts. The split is by time: the newest 15%
is validation. The existing holdouts stay frozen and separate. Observed data
may later seed a new holdout, but only after owner review.

## Phases

1. **Contract.** Define the label-line format in `AGENTS.md` rule 11 and in
   the Harness Status docs. The parser and validator come with tests.
2. **Collector.** Hook-side recording for Claude Code: the turn record,
   behavior counters, the text store, the index and the opt-out. Tests cover
   redaction, the time budget, fail-open behavior and index shape.
3. **Codex.** Verify the payload fields, then add the adapter and its tests.
4. **Exporter.** Derived labels, the family grouping, the time split, and
   bias reports.
5. **Review page.** A blind review of disagreements; decisions feed back as
   owner overrides.

## Non-goals

- Nothing is uploaded and there is no remote collection.
- The label line never gates or changes routing.
- Observed data does not replace the owner-reviewed holdouts.
