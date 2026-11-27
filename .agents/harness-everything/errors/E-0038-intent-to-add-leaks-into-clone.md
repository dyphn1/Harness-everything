---
id: E-0038
signature: intent-to-add-leaks-into-clone
class: process
title: "An intent-to-add entry in the coordinator checkout broke the checkout of the next throwaway clone"
sites:
  - "coordinator checkout (git add -N)"
  - "throwaway clone checkout"
violates: unknown
scope: in
status: open
mechanism_ref: null
episodes:
  - episode: 1126-coordinator-intent-to-add-clone-checkout
    feature: "coordinator session 2026-11-26, no PR"
    date: 2026-11-26
    closed: false
    rounds:
      - round: 0
        change: null
        review: "coordinator session 2026-11-26, no PR"
        result: "`git add -N` (intent-to-add) in the coordinator checkout left an intent-to-add entry; the next throwaway clone's checkout broke. Avoidance recorded in the session: use fresh clones, never `add -N`. The clone command, affected SHA and any PR evidence are unknown."
---

## Cue

The coordinator uses `git add -N` to make a file visible to a diff, and the next throwaway clone cannot check out cleanly.

## What happened

In the coordinator session of 2026-11-26, an intent-to-add entry left by `git add -N` in the source checkout broke the checkout of the following throwaway clone. No PR, commit or issue records the incident, so only the session report carries it.

## Lesson

Use fresh clones and never `git add -N` in a checkout that will be cloned for a worker. How the intent-to-add entry reached the clone is unknown (a plain `git clone` does not copy the index); treat `add -N` as state that can leak into derived checkouts, not a harmless diff aid. Related: E-0030 covers a stale checkout running a merged tool and E-0037 covers borrowed `node_modules` in a re-check; neither covers index state leaking into a fresh clone.

## Evidence

- Coordinator session 2026-11-26, no PR.
