# Fable Haiku — v3 Routing Notes

Details moved from SKILL.md.

## v3 change: agent-routed

The worker is a real agent definition (`../agents/fable-worker-haiku.md`)
invoked by name. Its system prompt carries the loop, the tightened verification
rule, and the operational rules; this skill only routes.

## Full run procedure

1. Confirm `fable-worker-haiku` appears in the available agent types. If not,
   fall back to inline: spawn a general-purpose Haiku agent and pass it the
   rules verbatim from `../agents/fable-worker-haiku.md`.
2. Spawn **@fable-worker-haiku** via the Task tool (`subagent_type:
   "fable-worker-haiku"`). Brief it with: the task, the exact output path(s),
   and the pass condition — name the check explicitly; Haiku gets no benefit of
   the doubt on verification.
3. Haiku is cheap: for independent sub-parts, fan out one worker per part and
   merge. Set a ceiling on concurrent workers.
4. Follow with **@fable-verifier** (a second Haiku is cheap; fresh eyes can't
   inherit the worker's blind spots) for anything that will be delivered
   without human review.
5. If a worker escalates ("needs synthesis"), re-route that part to
   the main Orchestrator model context rather than retrying Haiku with a louder prompt.
