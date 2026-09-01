---
name: verify-before-claim
description: "Verify external framework/API claims and unmeasured perf/cost estimates against an authoritative source before asserting them. Use when stating how an external framework, SDK, CLI, or API behaves, or quoting numbers not produced by a real run; output is a cited claim, a real measurement, or a labeled estimate."
license: Apache-2.0
metadata:
  author: Miya Daniel
  version: 0.3.6
---

# Verify Before Claim

Verify external behavior and unmeasured numbers before asserting them.

## Skill Contract

| Component | Specification |
| :--- | :--- |
| **Trigger / Input** | External behavior, version/config/exit-code claim, or unmeasured number. |
| **Expected Output** | Official citation, real measurement, or explicitly labeled estimate. |
| **State Mutations** | None; evidence is returned with the claim. |
| **Enforcement Gate** | Official source or real measurement; unresolved claims stay inconclusive. |

## Core Flow

1. For this repository, read the local source and report observed facts.
2. For external behavior, use official documentation first and cite it.
3. For numbers, run a real measurement or label the result an estimate.
4. Report contradictions or missing evidence as inconclusive.

## USE FOR:
- Stating how an external framework, SDK, CLI tool, or API behaves
- Quoting performance, cost, latency, or timing numbers
- Answering "does X support Y" or version-specific questions
- Citing defaults, exit codes, config flags, pricing, or rate limits

## DO NOT USE FOR:
- Claims about this repository's own code (read the actual source)
- Facts the user supplied directly in this conversation
- Generic CS/engineering knowledge (e.g. Big-O) that can't go stale

Never claim an unverified external fact as certain, even under time pressure.

Deep dive: `references/verification-guide.md`
