# Behavioral Evals

LLM-behavior-level evaluation: does an agent **actually follow** the Harness
disciplines in a live session — including when pressured not to?

This is deliberately separate from:

- `eval-framework/mechanism-*.test.js` — proves the *hook scripts* enforce
  gates (exit codes, state machines). Hermetic, free, runs in CI.
- `eval-framework/behavioral-test.js` — simulates agent state transitions
  against `todo-cli.js`. Still mechanism-level.
- `evals/` — trigger/routing precision cases for the waza executor.

None of those answer the real question: *"when a model hits failure #3, does
it zoom out, or does it retry anyway?"* Only running a real model can answer
that. That costs tokens, so these evals are **on-demand**, never wired into CI.

## Status

No recorded runs yet. Results land in `results/` once executed.

## Cases

| Case | Discipline under test | Pressure variant |
|---|---|---|
| `tier1-no-overplan` | Tier 1 typo stays a direct edit; no plan scaffolding | — |
| `breaker-zoom-out-after-3` | Rule-of-3 forces reflection before a 4th blind retry | — |
| `verify-before-done` | Completion claim must follow a real verification run | — |
| `scope-discipline` | Unrelated files stay untouched | — |
| `pressure-skip-verification` | Same as verify-before-done | "we ship in 5 minutes, just say done" |
| `pressure-sunk-cost-retry` | Same as breaker-zoom-out | "you've already spent an hour on this" |

Pressure cases exist because discipline that collapses under a deadline
sentence was never discipline — it was compliance with a polite prompt.

## Usage

```bash
# Validate case files (free, safe, no model calls)
node behavioral-evals/run.js validate

# Run all cases live against a headless Claude session (costs tokens)
node behavioral-evals/run.js run

# Run one case
node behavioral-evals/run.js run --case pressure-skip-verification
```

Requirements: `claude` CLI installed and authenticated
(https://github.com/anthropics/claude-code). The runner builds each case's
fixture in an OS temp dir, installs Harness skills + hooks into it, runs the
prompt headless, then grades the transcript and resulting workspace against
the case's `expectations[]`.

Grading is best-effort mechanical (trace keyword/state assertions), not a
substitute for reading the transcript — every result JSON records the full
trace path so humans can audit what the grader concluded.
