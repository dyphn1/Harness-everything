---
id: E-0022
signature: wrong-episode-rule-briefed
class: process
title: "The coordinator briefed a worker with the wrong episode and round rule, twice on the same day"
sites:
  - "coordinator briefing of ledger-writing workers (packet text and chat instructions)"
  - "shared packet common-gates file"
  - "advisor gate clauses in adjudication answers"
violates: unknown
scope: in
status: lesson
mechanism_ref: null
episodes:
  - episode: 2026-11-12-ledger-rule-briefing
    feature: unknown
    date: 2026-11-12
    closed: false
    rounds:
      - round: 0
        change: null
        review: coordinator
        result: "The coordinator told a worker the wrong episode and round rule, twice on 2026-11-12. The authority is the 'Episodes vs rounds' section of the errors README."
  - episode: 2026-11-15-packet-template-drift
    feature: unknown
    date: 2026-11-15
    closed: false
    rounds:
      - round: 0
        change: null
        review: coordinator
        result: "The shared common-gates file carried a stale input SHA and a wrong report path; W3 followed the file."
      - round: 1
        change: "each packet's own input SHA made authoritative over the shared common-gates file"
        review: unknown
        result: "Fixed. No closing review is recorded, so the episode stays open."
  - episode: 2026-11-17-advisor-gate-clause-too-broad
    feature: "#456 H2"
    date: 2026-11-17
    closed: false
    rounds:
      - round: 0
        change: null
        review: "advisor adjudication"
        result: "An advisor gate clause ('no writes to cycle-state') was literal for the whole `all` invocation; H2 (PR #456) correctly stopped on its write-set."
      - round: 1
        change: "advisor amended the clause: the prohibition covers rejected evaluate only"
        review: unknown
        result: "H2 proceeded under the amended clause. The over-broad wording cost one extra adjudication round."
---

## Cue

A coordinator briefing gives a worker an episode or round rule that differs from the README's "Episodes vs rounds" section.

## What happened

On 2026-11-12 the coordinator told a worker the wrong episode and round rule, twice.

## Lesson

The README's "Episodes vs rounds" section is the authority. When a packet asks a worker to write an episode or a round, quote that section in the packet.

## Episode 2 (2026-11-15)

A second failure shape in the same class: briefing text inherited from a shared file drifts. The shared common-gates file carried a stale input SHA and a wrong report path, and W3 followed the file. Each packet's own input SHA is authoritative over the shared file.

## Episode 3 (2026-11-17, PR #456)

A third shape: an advisor gate clause ('no writes to cycle-state') was literal for the whole `all` invocation, so H2 (PR #456) correctly stopped on its write-set and the advisor had to amend the clause (rejected evaluate only). Cost: one extra adjudication round. A gate clause states the exact invocation and verb it binds.

## Evidence

- Coordinator briefings on 2026-11-12. No PR or commit evidence is available.
- Related: E-0013 (process: health checks), a different process failure.
