---
name: verify-before-claim
description: "Verify external framework/API claims and unmeasured perf/cost estimates against an authoritative source before asserting them, instead of answering from training memory. Use whenever about to state how an external framework, SDK, CLI, or API behaves, or quote any number not produced by a real run this session; output is a cited claim, a real measurement, or a labeled estimate."
license: Apache-2.0
metadata:
  author: Miya Daniel | Harness Core Team
  version: 0.3.4
---

# Verify Before Claim

Verify external claims against authoritative sources before asserting them; never answer from memory.

## 📋 Skill Contract
| Component | Specification |
| :--- | :--- |
| **Trigger / Input** | About to state how an external system behaves, or state unmeasured perf/cost numbers. |
| **Expected Output** | Claim backed by WebFetch/WebSearch docs, real measurement, or explicit fallback estimate warning. |
| **State Mutations** | None — governs response assertions. |
| **Enforcement Gate** | Fetch/search official docs for external claims; if unavailable, label assertions as unverified estimates. |

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

Deep dive: references/verification-guide.md
