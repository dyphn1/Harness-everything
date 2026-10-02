import json,pathlib
from decimal import Decimal
root=pathlib.Path(__file__).resolve().parent;prev=root.parent/'pr291-corrected-2026-10-02'
old=json.loads((prev/'usage.json').read_text());new=json.loads((root/'usage.json').read_text());rows=[]
for size in ['small','medium','large']:
 for arm in ['A','B','C']:
  t=next(t for t in (new if arm=='C' else old)['trials'] if t['id']==size+'-'+arm);u=t['usage'];timing=t['timing'] if arm=='C' else new['previousTimings'][t['id']]
  rows.append(f"| {t['id']} | {u['input_tokens']:,} | {u['output_tokens']:,} | {u['cached_input_tokens']:,} | {u['cache_write_input_tokens']:,} | {t['standardAPIEquivalentUSD']} | {timing['elapsedSeconds']:.3f} |")
cost=sum(Decimal(t['standardAPIEquivalentUSD']) for t in new['trials'])
text='''# PR #291: elapsed time and no-Harness control

Luna / xhigh, one sample per cell. A = PR base 2716be9; B = corrected product snapshot 7a0f72e; C = clean native CLI 0.159.3 without Harness. A/B were native collaboration sessions (0.159.2). Identical task and initial fixture byte hashes are retained. Both rounds ran bounded probes: only medium may edit its isolated README, and large is planning only with no implementation or delegation.

## Nine-cell comparison

| Case-arm | Input incl. cache | Output incl. reasoning | Cached input | Cache writes | Standard USD-equivalent | Elapsed seconds |
|---|---:|---:|---:|---:|---:|---:|
'''+ '\n'.join(rows)+f'''

C aggregate Standard API-equivalent cost: **US${cost}**. Input includes cached input; reasoning is a subset of output. The full counters, including uncached input, reasoning subset and each unique request, are in `usage.json`. Every request is reconciled to completed thread totals. Parent setup/analysis/publication costs are excluded.

Time is the retained native rollout's `task_started` → `task_complete` wall time, excluding launch/startup overhead. A/B exact timestamps are also exported to the previous report's `timing.json`, and that report now includes the new time column. C process duration (including CLI startup) is recorded separately and is not substituted into this table. Trials ran concurrently; the row times are not experiment-total wall time.

## No-Harness isolation and outcomes

Three fresh fixture directories outside every Harness repository, each with a separate clean CODEX_HOME. Existing native login was reused privately; no credential contents were exported or included in model prompts. User config/rules were ignored, hooks/plugins/apps/memory/delegation were disabled, host-skill discovery skipped, and web search disabled. Only task.txt, README.md and architecture.json were supplied. `instruction-context.json` records observable developer/user instructions. The audit confirms no Harness instruction text, no repo AGENTS instruction block, and no Harness/router/SKILL read or delegation tool calls. The CLI reports skip_host_skill_discovery as under-development, so the observed instruction/tool evidence matters beyond the configuration flags. No source or personal configuration was changed.

Small C honestly reports the custom Fable/Sonnect profile unavailable and returns null canonical fields. Medium C similarly cannot explain the custom profile but correctly changes the README heading to Installation. Large C produces a seven-stage generic dependency-injection plan covering all fourteen inventory files, ordered dependencies, role labels, failable checks, an isolation disposition and read-only independent final review; all generic structural checks pass. It does not resolve the Harness profile or provide the same detailed future worktree execution contract as B. These quality differences must accompany the cheaper/faster control figures.

## Limits and reproducibility

This is a **descriptive additional control**, not a causal estimate of Harness overhead: C uses a clean standalone CLI, different tool/system context, a neutral wrapper and a later sampling round; A/B used native collaboration plus repository instructions. Model and effort match, but wrapper/host equality does not. Existing A/B native task-message payloads remain encrypted, so their wrapper equality cannot be independently verified. Cache warmth, scheduling and token variability were not controlled. A single sample per case cannot establish a general speed/cost benefit, and profile explanation cases intentionally depend on Harness-specific knowledge. Full migration execution, actual delegated verification, and live-host enforcement were not tested.

Rates: [official GPT-6 Luna Standard pricing](https://developers.openai.com/api/docs/models/gpt-6-luna), USD/million: uncached input .10, cached .01, cache write .125, output .50. Costs are API-equivalent estimates, not subscription invoices. No individual request exceeded 272K input. [Official Codex configuration reference](https://developers.openai.com/codex/config-reference/) and installed CLI help informed isolation; the concrete retained commands and observed loaded messages establish this run's evidence.

`run.py` preserves the neutral wrapper and command line; do not rerun it over retained fixtures. `audit.py` requires original local rollouts, whose hashes are exported, while arithmetic can be recomputed from sanitized per-request counters on any host. `events.jsonl` contains observable messages/commands and excludes reasoning items. Raw reasoning and auth files remain private outside the repo. `sha256.json` seals publication bytes.
'''
(root/'README.md').write_text(text,encoding='utf8')
print('Nine-cell report built; C cost '+str(cost))
