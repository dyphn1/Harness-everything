---
id: E-0032
signature: bulk-read-truncation-skips-records
class: process
title: "Workers bulk-read all E-*.md records in one call, tool output truncated the middle, and they skipped records"
sites:
  - ".agents/harness-everything/errors/E-*.md"
  - "coordinator packet error-ledger reading instructions"
violates: "Packet error-ledger instruction: read every E-*.md record before classifying findings."
scope: in
status: open
mechanism_ref: null
episodes:
  - episode: 453-p1-p2-bulk-read-truncation
    feature: "#453 packets P1 and P2"
    date: 2026-11-24
    closed: false
    rounds:
      - round: 0
        change: null
        review: "coordinator inspection of P1 and P2 reports"
        result: "Workers instructed to read every E-*.md performed a bulk read whose tool output truncated the middle of the set, skipping records; both reports admitted they did not open every E-*.md body."
      - round: 1
        change: "Packets instruct workers to read E-*.md one file per read (or one by one if a bulk read truncates) and list every E-id opened in the report"
        review: unknown
        result: "Mitigation added to packet instructions; no closing review is recorded, so the episode stays open."
---

## Cue

A packet asks a worker to read a whole set of files (such as every `E-*.md` in the error ledger), and the worker combines them into one shell dump or bulk read whose tool output gets truncated in the middle.

## What happened

During #453 (packets P1 and P2), workers told to read every `E-*.md` ran a bulk read. Tool output truncation dropped the middle of the set, and the workers proceeded without opening the missing records. Two reports explicitly disclosed this ("did not open every E-*.md body" / "the full E-*.md dump was truncated … did not read every record").

## Lesson

- Read required ledger records one file per read (or fall back to one-by-one reads whenever a bulk read truncates); never treat a truncated dump as having read the whole set.
- Packets that require reading a whole file set should state "one file per read (one by one if a bulk read truncates)" and ask the report to list every ID opened.

## Evidence

- #453 packets P1 and P2 reports (2026-11-24).
