---
name: fable-haiku
description: >
  Run fable-mode execution discipline on Claude Haiku. Routes the task to the
  @fable-worker-haiku agent, whose definition carries the staged loop with
  tightened verification (no bare "unverified" allowed) and an
  escalate-don't-improvise rule. Trigger when the user explicitly asks for
  thorough/systematic handling run cheaply or fast ("fable on haiku", "deep work
  mode but cheap", "stage this on haiku"). For bulk mechanical work. Do NOT use
  for tasks needing synthesis — benchmark note: at n=1 the skill's effect on
  Haiku swung both directions (+25 / −17); route quality-critical work to
  fable-sonnet instead.
---

# Fable Mode — Haiku (v3, agent-routed)

## 📋 Skill Contract

| Component | Specification |
| :--- | :--- |
| **Trigger / Input** | User explicitly asks for staged/thorough execution run cheaply or fast on Haiku ("fable on haiku", "stage this on haiku") for bulk mechanical work. |
| **Expected Output** | Task delegated to the `fable-worker-haiku` agent (or an inline fallback carrying the same rules verbatim), optionally fanned out across multiple concurrent workers, followed by a `fable-verifier` pass before any unsupervised delivery. |
| **State Mutations** | None directly — spawns/manages Task-tool subagents and whatever file edits they perform. |
| **Enforcement Gate** | Every worker brief **MUST** name the pass condition explicitly (no benefit of the doubt on verification for Haiku). A worker that escalates "needs synthesis" **MUST** be re-routed to `fable-worker-sonnet`, never retried on Haiku with a louder prompt. |

v3 change: the worker is a real agent definition (`agents/fable-worker-haiku.md`)
invoked by name. Its system prompt carries the loop, the tightened verification
rule, and the operational rules; this skill only routes.

If a task has one obvious correct approach and fits in a single pass, skip this
loop and do it directly.

## How to run it

1. Confirm `fable-worker-haiku` appears in the available agent types. If not,
   fall back to inline: spawn a general-purpose Haiku agent and pass it the
   rules verbatim from `agents/fable-worker-haiku.md`.
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
   fable-worker-sonnet rather than retrying Haiku with a louder prompt.
