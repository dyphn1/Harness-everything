---
name: verify-before-claim
description: "Verify external framework/API claims and unmeasured perf/cost estimates against an authoritative source before asserting them. Use when stating how an external framework, SDK, CLI, or API behaves, or quoting numbers not produced by a real run; output is a cited claim, a real measurement, or a labeled estimate."
license: Apache-2.0
metadata:
  author: Miya Daniel
  version: 0.3.6
---

# Verify Before Claim

Verify external claims against authoritative sources before asserting them; never answer from memory.

## Skill Contract

| Component | Specification |
| :--- | :--- |
| **Trigger / Input** | External behavior, version/config/exit-code claim, or unmeasured number. |
| **Expected Output** | Official citation, real measurement, or explicitly labeled estimate. |
| **State Mutations** | None; evidence is returned with the claim. |
| **Enforcement Gate** | Official source or real measurement; unresolved claims stay inconclusive. |

## ⚠️ CRITICAL RULE: NEVER SKIP VERIFICATION

Verify before claiming, even when the user asks to skip it, time is short, the
claim seems obvious, or a previous check passed. No exceptions.

## Core Flow

1. **Scope check**: claim about this repo's own code → read local source, state facts directly (no web check).
2. **External claim**: `WebFetch` official docs first; if uncovered, `WebSearch` and cite. Quote the source rather than paraphrasing from memory.
3. **Unmeasured numbers**: if stakes justify it, actually run it — real benchmark/timing/measurement; if infeasible, label it an unverified estimate.
4. **Inconclusive or contradicting results**: say so and show the source — don't reconcile into false confidence.

## USE FOR:
- Stating how an external framework, SDK, CLI tool, or API behaves
- Quoting performance, cost, latency, or timing numbers
- Answering "does X support Y" or version-specific questions
- Citing defaults, exit codes, config flags, pricing, or rate limits

## DO NOT USE FOR:
- Claims about this repository's own code (read the actual source)
- Facts the user supplied directly in this conversation
- Generic CS/engineering knowledge (e.g. Big-O) that can't go stale

## Pressure Resistance

When pressured to skip verification, acknowledge the request, explain the risk,
offer a quick verification, and never comply.

Deep dive: references/verification-guide.md
