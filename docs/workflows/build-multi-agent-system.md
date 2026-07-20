# Workflow: Build Multi-Agent System

> Deploys an industrial-grade, self-adapting Multi-Agent Workspace architecture, scaffolding physical boundaries and relational SQLite context indexes.

---

## 1. Skill Behavior Workflow

This section visualizes how the `build-multi-agent-system` skill executes internally, detailing the sequence of operations, state transitions, and evaluation steps.

```mermaid
graph TD
  Start([Workspace Scaffolding Requested]) --> DiscoverStack["Analyze project package.json/runtimes"]
  DiscoverStack --> DeduceRoles["Deduce required specialist roles & PM / Challenger"]
  DeduceRoles --> ScaffoldZones["Scaffold '6 Functional Zones' directories: State, Decisions, Logs, etc."]
  ScaffoldZones --> GenMemoryIndexer["Generate language-appropriate index_memory script"]
  GenMemoryIndexer --> GenAgentsRouter["Generate AGENTS.md routing brain"]
  GenAgentsRouter --> RunIndexer["Execute memory indexer to initialize local memory.db SQLite index"]
  RunIndexer --> VerifyExecution["Verify schema, tables, and execution status"]
  VerifyExecution --> End([Scaffolding and hybrid relational memory initialized])
```

---

## 2. Triggering and Routing Path

This diagram illustrates how the `build-multi-agent-system` skill is triggered through user requests or developer actions, and how it integrates or chains together with other companion skills in the Harness OS ecosystem to form unified workflows.

```mermaid
graph LR
  Router["harness-everything / tier-router.js"] -->|Keyword: agent / workspace / multi-agent| BMAS["build-multi-agent-system / SKILL.md"]
  BMAS -->|Works hand-in-hand with spawning tool| CAL["create-agent-launcher / SKILL.md"]
  BMAS -->|Stores architectural contracts in| GWD["grill-with-docs / SKILL.md"]
  BMAS -->|Initializes memory rules via| Evolve["self-evolve / SKILL.md"]
```

---

## 3. Real-World Use Case Flowchart

Here we model concrete real-world scenarios and use cases of the `build-multi-agent-system` skill, illustrating standard success paths, error handling, or recovery loops.

```mermaid
graph TD
  Start["User asks to set up an AI developer workspace for a Python backend"] --> Trigger["Invoke build-multi-agent-system"]
  Trigger --> DetectStack["Identifies Python/Django stack"]
  DetectStack --> BuildDirs["Creates .agents/, docs/decisions/, docs/architecture/, state/ folders"]
  BuildDirs --> WriteIndexer["Creates python indexer script parsing markdown frontmatter"]
  WriteIndexer --> CreateDB["Runs indexer, generating SQLite memory.db schema"]
  CreateDB --> WriteAgentsRouter["Generates AGENTS.md with routing matrix"]
  WriteAgentsRouter --> Done([Professional Multi-Agent Workspace deployed and indexed])
```

---

## 4. Verification Check

To ensure that the `build-multi-agent-system` skill is operating in strict compliance with Harness OS design laws, verify the following:

- [ ] **Physical Boundary Verification**: The skill boundaries are respected and do not leak context.
- [ ] **State Checkpoint Verification**: The active state is established, validated, and recorded at the beginning and end of each execution branch.
- [ ] **Cognitive Alignment**: The skill conforms to the **Think > Try > Summarize > Record** cognitive loop.
