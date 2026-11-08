---
id: E-0013
signature: one-shot-agent-not-health-checked
class: process
title: "A one-shot agent hung for about 6 hours because no health-check was set at dispatch"
sites:
  - "coordinator dispatch of one-shot agents (background run, exit notification only)"
violates: "Owner rule 2026-10-27 (memory feedback-subagent-health-check): while any one-shot agent runs, check it every ~30 min; a log stale >15 min or exit without STATUS ⇒ re-dispatch."
scope: in
status: lesson
mechanism_ref: null
episodes:
  - episode: 412-review11d-unmonitored
    feature: "#412 review-11d (codex exec luna)"
    date: 2026-11-08
    closed: true
    rounds:
      - round: 0
        change: null
        review: coordinator
        result: "no health-check cron was set when review-11d was dispatched; the coordinator waited only for the exit notification, so a stdin hang went unnoticed for about 6 hours (owner: '忘了主動監測 sub agents')"
      - round: 1
        change: "session cron `13,43 * * * *` checks etime, log mtime/tail and STATUS for every dispatched agent"
        review: coordinator
        result: "set at the next dispatch"
---

## Cue

A one-shot agent runs in the background, and the coordinator waits only for its exit notification without a health-check cron running for the session.

## What happened

Review-11d was dispatched with no health-check cron. The background exit notification never came, because the process was stuck reading stdin (see E-0009). Nothing checked its log, so the hang went unnoticed for about 6 hours. The owner caught it: "忘了主動監測 sub agents".

## Lesson

Create the health-check cron at the first dispatch of a session; the background exit notification alone does not detect a hang.

## Evidence

- Coordinator log, review-11d, 2026-11-08.
