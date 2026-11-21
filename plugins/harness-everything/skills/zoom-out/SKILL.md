---
name: zoom-out
description: "Agent-initiated reassessment when evidence contradicts assumptions, exposes an unknown boundary, or a path stops producing useful information. Use for voluntary diagnosis of stalled or changing work. DO NOT USE FOR: routine debugging when the next check is clear, or greenfield planning."
license: Apache-2.0
metadata:
  author: Miya Daniel
  version: 0.47.5
---

# Zoom Out

Choose a fresh diagnosis when evidence changes your understanding, an important boundary is unknown, or the next action is unclear. You may do this after the first failure or later. Continue while attempts yield useful evidence and the next step is justified.

## Reassess

1. Restate the goal and acceptance criteria.
2. Review observed evidence, assumptions, and attempts; separate facts from guesses.
3. Trace callers and consumers when a shared decision or impact boundary is unclear.
4. Choose the next smallest check or correction. Continue, revise, or surface a genuine user decision.

This is agent-chosen guidance: no failure count or threshold requires a stop, report, or reset ritual. A written note is optional.

## USE FOR:
- Evidence contradicts a core assumption or exposes an unknown impact boundary.
- The current approach stops producing useful information, or you request a fresh diagnosis.

## DO NOT USE FOR:
- Routine debugging when the next check is clear.
- Greenfield planning (`fable-mode`).

Deep dive: `<this-skill-dir>/references/circuit-breaker.md`
