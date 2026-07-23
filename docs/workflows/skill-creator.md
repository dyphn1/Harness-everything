# Workflow: Skill Creator

> Authors, audits, and evolves SKILL.md files against a single quality bar — the Skill Contract format plus predictability/pruning/progressive-disclosure principles from external skill-writing research — and is the required gate for skills `self-evolve` generates dynamically.

---

## 1. Skill Behavior Workflow

This section visualizes how the `skill-creator` skill executes internally, detailing the sequence of operations, state transitions, and evaluation steps.

```mermaid
graph TD
  Start([New skill request / existing SKILL.md to audit / self-evolve dynamic-generation call]) --> Intent["Capture intent: what it does, the one canonical description sentence, which Tier, does an existing skill already own this ground"]
  Intent --> Draft["Draft: Skill Contract table first, then body sized by information hierarchy (steps vs flat reference vs guides/references)"]
  Draft --> Test["Test 2-3 realistic prompts via create-agent-launcher: with-skill subagent vs baseline subagent"]
  Test --> Checklist{"Quality Checklist (§3): SSOT, no duplication >5 lines, every MUST has a real gate, no no-ops, info hierarchy, leading words reused, checkable completion criteria, human-facing description"}
  Checklist -->|Fails| Prune["Prune and rewrite the failing item"]
  Prune --> Checklist
  Checklist -->|Passes| Route{Static or dynamic?}
  Route -->|Static| Register["Register: harness-everything §5 row + tier-router.js keyword line"]
  Route -->|Dynamic, from self-evolve| DynamicContract["§4 Dynamic Skill Generation Contract: write to .claude/harness-everything/skills/generated/<name>/, metadata.type=dynamic, status=draft"]
  Register --> End([Skill live in the repo, single source of truth for its own description])
  DynamicContract --> End
```

---

## 2. Triggering and Routing Path

This diagram illustrates how `skill-creator` is triggered through user requests or developer actions, and how it integrates or chains together with other companion skills in the Harness OS ecosystem to form unified workflows.

```mermaid
graph LR
  Router["harness-everything / tier-router.js"] -->|Keyword: skill / skill.md / new skill / write a skill| Creator["skill-creator / SKILL.md"]
  Creator -->|Table shape spec| SkillStyle["skill-style / SKILL.md"]
  Creator -->|With/without test subagents| Launcher["create-agent-launcher / SKILL.md"]
  Creator -->|Registers new static skills into| Registry["harness-everything / SKILL.md §5"]
  Evolve["self-evolve / SKILL.md §4"] -->|MUST load before packaging a session insight| Creator
  Creator -->|Writes dynamic skills to| Generated[".claude/harness-everything/skills/generated/"]
```

---

## 3. Real-World Use Case Flowchart

Here we model concrete real-world scenarios and use cases of the `skill-creator` skill, illustrating standard success paths, error handling, or recovery loops — one for a human-directed static skill, one for `self-evolve`'s dynamic path.

```mermaid
graph TD
  Start1["Developer: 'I want a skill for deploying to AWS'"] --> Intent1["skill-creator §2 Step 1: capture intent, one canonical description sentence"]
  Intent1 --> Draft1["Draft Skill Contract table + steps, push detail to deploy-aws/guides/"]
  Draft1 --> Test1["Spawn with/without subagents via create-agent-launcher on 2-3 realistic prompts"]
  Test1 --> Check1{Quality Checklist passes?}
  Check1 -->|No| Fix1["Fix flagged item, re-test"]
  Fix1 --> Check1
  Check1 -->|Yes| Reg1["Add row to harness-everything §5 + one line to tier-router.js"]
  Reg1 --> Done1([deploy-aws/SKILL.md live as a static, reviewed skill])

  Start2["zoom-out recovery ends: root cause found for a recurring connection-pool exhaustion bug"] --> Trigger2["self-evolve §3 Step 3: Dynamic Skill Generation"]
  Trigger2 --> Load2["self-evolve MUST load skill-creator §4 before writing anything"]
  Load2 --> Gate2{Quality Checklist §3 passes?}
  Gate2 -->|No| Reject2["Do not persist — this checklist is the only review a dynamic skill gets"]
  Gate2 -->|Yes| Write2["Write .claude/harness-everything/skills/generated/orm-transaction-batching/SKILL.md, metadata.type=dynamic, status=draft"]
  Write2 --> Done2([Dynamic skill available next session, lifecycle tracked separately from static skills])
```

---

## 4. Verification Check

To ensure that the `skill-creator` skill is operating in strict compliance with Harness OS design laws, verify the following:

- [ ] **Physical Boundary Verification**: The skill boundaries are respected and do not leak context.
- [ ] **State Checkpoint Verification**: The active state is established, validated, and recorded at the beginning and end of each execution branch.
- [ ] **Cognitive Alignment**: The skill conforms to the **Think > Try > Summarize > Record** cognitive loop.
