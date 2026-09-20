# Paired Behavioral Benchmark Protocol

This protocol is the measurement surface for issue #71. It is intentionally
separate from mechanism tests: mechanism tests prove deterministic hook and
state-machine behavior, while this benchmark measures agent behavior under a
real model session.

## Separate causal questions

Never combine these interventions into one headline number.

### `skill-text`

Measures the incremental effect of Harness skill guidance only.

- baseline: no Harness skill text, no Harness hooks/plugin enforcement;
- treatment: the case's named Harness skill text only;
- same engine, explicit model, prompt, fixture, rubric, CLI policy, and tool
  availability in both arms.

The treatment does **not** install `hooks/hooks.json` or the OpenCode
`harness-enforcement.js` plugin. This removes the old confound where a
"skill" treatment also changed enforcement behavior.

### `plugin-enforcement`

Measures the incremental effect of OpenCode enforcement while holding skill
text constant.

- baseline: named Harness skill text, no OpenCode enforcement plugin;
- treatment: the same named Harness skill text plus the canonical OpenCode
  enforcement module installed as `.opencode/plugins/harness-enforcement.js`.

This experiment currently supports OpenCode only. It requires a retained
Rule-of-3 reflection-gate preflight produced by `opencode-reflection-gate-live.js`. The preflight must
still pass verification and its plugin SHA-256 must equal the current canonical
`opencode-plugin/index.mjs`; changing the plugin invalidates the old preflight.

Each treatment case must also leave retained plugin state proving that the
plugin fired during that case. Missing attribution is classified as
infrastructure/inconclusive and is excluded from behavioral pass rates.

### Cost and execution overhead

Cost is reported separately from correctness:

- provider cost, where exposed by the host;
- total tokens, where exposed;
- attempted tool calls;
- elapsed duration.

The report gives treatment-minus-baseline deltas and does not fold them into a
correctness score.

## Predeclare the decision threshold

There is deliberately **no default minimum effect**. Before model calls start,
the caller must supply `--min-effect-pp <N>` to state the smallest paired pass
rate improvement that would be practically meaningful for that study. The
experiment manifest is written before either arm runs, so the threshold cannot
be selected after seeing the result.

Example only (not a project-wide default):

```bash
--min-effect-pp 10
```

A study reports `meets-predeclared-threshold` only when the lower bound of the
paired bootstrap 95% confidence interval is at or above that predeclared
minimum. It reports `below-predeclared-threshold` when the interval lies wholly
below it, otherwise `uncertain-at-predeclared-threshold`. Fewer than two
included pairs is `insufficient-data`.

The report also includes an exact McNemar p-value for the discordant pairs. The
p-value is evidence about symmetry of fail->pass vs pass->fail transitions; it
is not a substitute for the predeclared practical-effect threshold.

## Evidence and exclusions

A pair enters the behavioral denominator only when both arms are definitive
`pass` or `fail` and the pair contract validates.

Excluded reasons include:

- CLI/session error;
- grader error;
- incomplete or inconclusive transcript evidence;
- mismatched actual model when both hosts report it;
- pair-contract hash mismatch;
- intervention shape mismatch;
- missing OpenCode plugin attribution/preflight/hash evidence.

`command_exit_0` remains a post-hoc workspace correctness check. It is tagged
as such in the result and is never presented as proof that the agent itself
executed the same command. Agent execution claims require structured tool
transcript evidence.

## Retained artifacts

Each experiment receives a unique directory under
`behavioral-evals/results/paired/` containing:

- `manifest.json` — pre-run engine/model/effect/threshold/repository/host
  contract;
- `pairs/*.json` — one immutable record per case/repeat;
- `<pair-id>/<arm>.transcript.jsonl` and stderr;
- `<pair-id>/<arm>.workspace/` — final synthetic fixture snapshot excluding
  Harness install artifacts and `.git`;
- `<pair-id>/<arm>.state/` — isolated Harness state, when any;
- `summary.json` — included/excluded counts, transitions, paired effect and CI,
  repeat variance, McNemar statistic, and overhead deltas.

Pair IDs include a UUID, so repeated runs of the same case never overwrite one
another.

## Run skill-text pairs

Use an explicit model. The same model argument is sent to both arms.

```bash
npm run eval:paired -- \
  --effect skill-text \
  --engine opencode \
  --model <provider/model> \
  --min-effect-pp <N> \
  --repeats 3
```

A single case can be targeted with `--case <case-id>`.

Claude is also supported for the `skill-text` experiment:

```bash
npm run eval:paired -- \
  --effect skill-text \
  --engine claude \
  --model <model> \
  --min-effect-pp <N> \
  --case baseline-debugging \
  --repeats 3
```

Both Claude arms use the same permission/configuration invocation. The old
runner's baseline-only `--safe-mode` difference is not used in this protocol.

## Run OpenCode plugin-enforcement pairs

First produce the #37 attribution evidence from the exact plugin revision being
measured:

```bash
npm run eval:opencode:reflection-gate-live
```

Then pass that evidence directory into the paired study:

```bash
npm run eval:paired -- \
  --effect plugin-enforcement \
  --engine opencode \
  --model <provider/model> \
  --min-effect-pp <N> \
  --opencode-preflight benchmarks/results/live-host/opencode-reflection-gate-<timestamp> \
  --repeats 3
```

If the preflight fails, is missing, or belongs to a different plugin SHA, the
study refuses to start rather than silently counting an unattributed plugin
arm.

## Statistical output

For included pairs the summary reports:

- baseline and treatment pass/fail counts;
- `fail->pass`, `pass->fail`, `pass->pass`, and `fail->fail` transitions;
- paired effect in percentage points: `(treatment passes - baseline passes) / n`;
- deterministic paired-bootstrap 95% confidence interval;
- exact McNemar p-value on discordant pairs;
- per-case repeat count, mean paired difference, and sample variance;
- excluded pairs with explicit reasons;
- cost/token/tool-call/duration deltas in a separate section.

Historical `opencode-with-plugin` result files pre-dating the live attribution
protocol are descriptive only and must not be mixed into this paired dataset.
