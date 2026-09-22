---
max_turns: 15
allowed_tools: [Read, Glob, Grep, Skill]
tags: [pilot, positive-trigger, tier-3]
description: "Architectural, repo-wide request should route through the harness-everything router and land on Tier 3."
---

Route this coding request: split our monolith into two services (orders and billing) with an event bus between them; this touches deployment, data migration, and every team's code.
