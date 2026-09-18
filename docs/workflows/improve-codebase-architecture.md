# Workflow: Improve Codebase Architecture

> Finds thin or overweight modules and reshapes them into focused, single-responsibility units by dividing large objects and functions, isolating seams, and separating interfaces.

Source of truth: `improve-codebase-architecture/SKILL.md`.

## 1. Skill Behavior Workflow

```mermaid
graph TD
  RefactorAsk["Input: refactor architecture, split object, apply SRP, tech debt"] --> DiscoverScan["Scan CONTEXT.md, docs/adr/, and core interfaces first; no blind refactoring"]
  DiscoverScan --> FindTargets["Target SRP violations over 300 lines or over 10 complexity, shallow modules, coupled seams"]
  FindTargets --> Proposal["Present Deepening and SRP proposal: object splitting plus seam abstraction"]
  Proposal --> Approved{"Proposal approved?"}
  Approved -->|No| Proposal
  Approved -->|Yes| SafetyNet{"Legacy code has tests?"}
  SafetyNet -->|No| CharTests["Write Characterization Tests first via tdd"]
  SafetyNet -->|Yes| Extract["Extract incrementally via tdd; verify tests after each change"]
  CharTests --> Extract
  Extract --> ErrorCheck{"More than 3 cascading errors?"}
  ErrorCheck -->|Yes| Rollback["Rollback plus zoom-out; record traps in self-evolve"]
  ErrorCheck -->|No| DoneState["Refactoring complete"]
```

## 2. Triggering and Routing Path

```mermaid
graph LR
  TechDebt["Trigger: refactor architecture or split object or apply SRP or tech debt"] --> ICA["improve-codebase-architecture / SKILL.md"]
  ICA --> TDD["tdd: Characterization Tests first, then incremental extraction"]
  ICA --> ZoomOut["zoom-out: invoked with rollback after more than 3 cascading errors"]
  ICA --> SelfEvolve["self-evolve: record traps"]
```

## 3. Real-World Use Case

```mermaid
graph TD
  BloatedUtil["utils.js handles email, tokens, DB pooling, logging"] --> ScanInterfaces["Scan CONTEXT.md, ADRs, core interfaces"]
  ScanInterfaces --> SRPProposal["Propose split into focused units plus seam abstractions"]
  SRPProposal --> CharNet["Add Characterization Tests for untested legacy paths"]
  CharNet --> Incremental["Incremental extraction with test check after each step"]
  Incremental --> RollbackGate{"More than 3 cascading errors?"}
  RollbackGate -->|Yes| RollbackZoom["Rollback and zoom-out"]
  RollbackGate -->|No| ModularDone["SRP-compliant modules with safety net"]
```

Concrete example: a 600-line utility module is scanned for interfaces and ADR constraints, proposed for splitting into single-purpose units, guarded by Characterization Tests, then extracted step by step with verification after each change.

Deep detail: `improve-codebase-architecture/references/README.md`.

## 4. Verification Check

- [ ] `CONTEXT.md`, `docs/adr/`, and core interfaces scanned first; no blind refactoring
- [ ] Targets match the skill bar: SRP violations over 300 lines or over 10 complexity, shallow modules, coupled seams
- [ ] Deepening and SRP proposal with object splitting and seam abstraction presented and approved before code changes
- [ ] `tdd` launched; Characterization Tests added first when legacy code lacks tests
- [ ] Extraction done incrementally with tests verified after each change
- [ ] On more than 3 cascading errors, changes rolled back with `zoom-out` and traps recorded in `self-evolve`
- [ ] Not used for features, bugfixes, or style-only cleanups with no structure change
