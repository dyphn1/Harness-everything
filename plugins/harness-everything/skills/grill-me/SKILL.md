---
name: grill-me
description: Stress-test plans and architectures one question at a time, expose blind spots, update domain terminology, and suggest an explicit to-spec handoff when alignment is complete.
license: Apache-2.0
metadata:
  author: Miya Daniel
  version: 0.4.0
---

# Grill Me

Stress-test a plan one question at a time.

## USE FOR:
- vague plans or architecture proposals
- adversarial design review
- unresolved decision branches

## DO NOT USE FOR:
- implementation or spec publication
- ticket decomposition
- casual Q&A

## Skill Contract

| Component | Specification |
| :--- | :--- |
| **Trigger / Input** | Plan evaluation or explicit "grill me". |
| **Expected Output** | Resolved decision tree plus explicit `/to-spec` handoff suggestion. |
| **State Mutations** | May update `CONTEXT.md`; does not auto-run publication/ticket skills. |
| **Enforcement Gate** | Ask ONE question at a time. Never auto-run `to-spec` or `to-tickets`. |

## Workflow

1. Read relevant code, context, and ADRs.
2. Challenge one branch at a time with project terminology.
3. Update glossary terms as they resolve.
4. On consensus, recommend explicit `/to-spec`.
5. Suggest the next execution route without auto-invoking explicit-only skills.

Deep dive: <this-skill-dir>/references/grilling-playbook.md
