---
name: grill-with-docs
description: Grilling session that challenges your plan against the existing domain model, sharpens terminology, and updates documentation (CONTEXT.md, ADRs) inline as decisions crystallise. Use when user wants to stress-test a plan against their project's language and documented decisions.
author: Miya Daniel | Harness Core Team
version: 0.3.3
---

# Grill With Docs (Domain Modeling & Architectural Alignment)

## 📋 Skill Contract

| Component | Specification |
| :--- | :--- |
| **Trigger / Input** | User wants to stress-test a plan against the project's existing domain language and documented decisions (`CONTEXT.md`, ADRs). |
| **Expected Output** | Structured interview walking the design tree; `CONTEXT.md` updated inline as terms resolve; ADRs created via dynamic path resolution or handed off to `to-spec`. |
| **State Mutations** | Updates `CONTEXT.md` and ADR files at resolved locations (`docs/adr/`, `CONTEXT-MAP.md` locations, or platform fallback `.github/harness-everything/adr/`). |
| **Enforcement Gate** | `CONTEXT.md` MUST remain a pure glossary (no implementation details). ADRs MUST meet the 3-part criteria. Hand off to `to-spec` for formal spec/ADR publishing upon alignment completion. |

## Process & Domain Alignment Flow

Follow the decision matrix below when aligning domain models and architectural decisions:

```mermaid
flowchart TD
    Start[Trigger: Stress-test Plan against Domain Model] --> Scan[1. Scan Codebase, CONTEXT.md & Existing ADRs]
    Scan --> Frontier[2. Calculate Frontier & Ask Questions]
    
    Frontier --> Answer[Receive Answer & Resolve Domain Term]
    Answer --> UpdateGlossary[3. Update CONTEXT.md Glossary Inline]
    
    UpdateGlossary --> CheckADR{4. Hard-to-reverse Trade-off Decision Reached?}
    
    CheckADR -- Yes --> ResolvePath{Resolve ADR Storage Path}
    CheckADR -- No --> CheckMore
    
    ResolvePath -- projectDocs / docs/adr Exists --> WriteMain[Write to docs/adr/ or CONTEXT-MAP.md Location]
    ResolvePath -- No Folder Found --> WritePlatform[Write to .github/harness-everything/adr/ or Delegate to to-spec]
    
    WriteMain --> CheckMore{5. All Design Tree Branches Resolved?}
    WritePlatform --> CheckMore
    
    CheckMore -- Unresolved Branches Remain --> Frontier
    CheckMore -- All Branches Resolved --> ToSpec[6. Hand off to to-spec for Outline Preview & Spec/ADR Publishing]
    
    ToSpec --> Execution[7. Route to to-tickets / fable-mode / tdd via harness-everything]
```

<what-to-do>

Interview me relentlessly about every aspect of this plan until we reach a shared understanding. Walk down each branch of the design tree, resolving dependencies between decisions one-by-one. For each question, provide your recommended answer.

Ask the questions one at a time, waiting for feedback on each question before continuing.

If a question can be answered by exploring the codebase, explore the codebase instead.

</what-to-do>

<supporting-info>

## Domain awareness

During codebase exploration, also look for existing documentation:

### Dynamic Storage Resolution & File Structure

Inspect the workspace and resolve document locations dynamically:

1. **Monorepo / Multi-Context**: If `CONTEXT-MAP.md` exists at the root, follow its context-specific mapping.
2. **Project Configured / Inferred Location**: Run `node "to-spec/scripts/check-project-docs.js" check` or inspect if `docs/adr/` or `docs/` exists in the workspace.
3. **Platform Fallback**: If no documentation directory exists, write ADRs under `.github/harness-everything/adr/` (or `.claude/harness-everything/adr/`, `.cursor/harness-everything/adr/`), or delegate formal document generation to `to-spec`.

```
/
├── CONTEXT.md                        ← Primary domain glossary
├── docs/                             ← Default documentation root
│   └── adr/                          ← System-wide ADR decisions
│       ├── 0001-event-sourced-orders.md
│       └── 0002-postgres-for-write-model.md
└── .github/harness-everything/adr/   ← Fallback ADR storage if workspace has no docs/ directory
```

Create files lazily — only when you have resolved terms or ADRs to write.

## During the session

### Challenge against the glossary

When the user uses a term that conflicts with the existing language in `CONTEXT.md`, call it out immediately. "Your glossary defines 'cancellation' as X, but you seem to mean Y — which is it?"

### Sharpen fuzzy language

When the user uses vague or overloaded terms, propose a precise canonical term. "You're saying 'account' — do you mean the Customer or the User? Those are different things."

### Discuss concrete scenarios

When domain relationships are being discussed, stress-test them with specific scenarios. Invent scenarios that probe edge cases and force the user to be precise about the boundaries between concepts.

### Cross-reference with code

When the user states how something works, check whether the code agrees. If you find a contradiction, surface it: "Your code cancels entire Orders, but you just said partial cancellation is possible — which is right?"

### Update CONTEXT.md inline

When a term is resolved, update `CONTEXT.md` right there. Don't batch these up — capture them as they happen. Use the format in [CONTEXT-FORMAT.md](./CONTEXT-FORMAT.md).

`CONTEXT.md` should be totally devoid of implementation details. Do not treat `CONTEXT.md` as a spec, a scratch pad, or a repository for implementation decisions. It is a glossary and nothing else.

### Offer ADRs sparingly

Only offer to create an ADR when all three are true:

1. **Hard to reverse** — the cost of changing your mind later is meaningful
2. **Surprising without context** — a future reader will wonder "why did they do it this way?"
3. **The result of a real trade-off** — there were genuine alternatives and you picked one for specific reasons

If any of the three is missing, skip the ADR. Use the format in [ADR-FORMAT.md](./ADR-FORMAT.md).

### Connection to Grill Me & Specification Handoffs

1. **Pre-flight**: If the core proposal is highly vague or its technical robustness (SRE, security, locks, concurrency, fail-safes) is unverified, recommend the user run `grill-me` first. Do not attempt to align a glossary for a broken or unstable design.
2. **Transition**: Once technical issues are hardened in `grill-me`, transition here to solidify domain terms and record architectural choices.
3. **Downstream Specification Handoff**: Once alignment is complete and domain terms are updated, hand off to `to-spec/SKILL.md` to present an outline preview and publish the formal specification document or ADR.
4. **Execution Handoff**: Route to `to-tickets` (for ticket decomposition), `fable-mode` (for macro scaffolding), or `tdd` (for feature implementation) via `harness-everything`.

</supporting-info>
