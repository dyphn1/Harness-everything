# Workflow: Repo Docs

> Generates high-quality, professional README.md and AGENTS.md files based on actual workspace structures and product-archetype templates.

---

## 1. Skill Behavior Workflow

This section visualizes how the `repo-docs` skill executes internally, detailing the sequence of operations, state transitions, and evaluation steps.

```mermaid
graph TD
  Start([Generate / Update Repository Docs]) --> AuditProjectStructure["Audit workspace directory tree & build configs"]
  AuditProjectStructure --> CheckExisting{Existing README / AGENTS File Found?}
  
  CheckExisting -->|Yes| ReadOld["Read Existing File & Extract Bespoke Notes (env vars, URLs, gotchas)"]
  CheckExisting -->|No| ClassifyProductArchetype["Classify repository archetype"]
  
  ReadOld --> ClassifyProductArchetype
  ClassifyProductArchetype --> LoadTemplates["Load standard README and AGENTS templates"]
  LoadTemplates --> SmartMerge["Smartly Merge Codebase Facts + Bespoke Notes + Template Structure"]
  SmartMerge --> FormatMarkdown["Format documents following clean layout rules"]
  FormatMarkdown --> WriteFiles["Save / Merge README.md and AGENTS.md at Root or .github/"]
  WriteFiles --> End([Professional onboarding documentation created without losing history])
```

---

## 2. Triggering and Routing Path

This diagram illustrates how the `repo-docs` skill is triggered through user requests or developer actions, and how it integrates or chains together with other companion skills in the Harness OS ecosystem to form unified workflows.

```mermaid
graph LR
  Router["harness-everything / tier-router.js"] -->|Keyword: doc / readme / agents-template| RepoDocs["repo-docs / SKILL.md"]
  RepoDocs -->|Integrates frontmatter constraints into| BMAS["multi-agent-workspace / SKILL.md"]
  RepoDocs -->|Leverages ADR details generated in| GWD["grill-with-docs / SKILL.md"]
```

---

## 3. Real-World Use Case Flowchart

Here we model concrete real-world scenarios and use cases of the `repo-docs` skill, illustrating standard success paths, error handling, or recovery loops.

```mermaid
graph TD
  Start["New library lacks onboarding docs and setup details"] --> Trigger["repo-docs skill invoked"]
  Trigger --> Scan["Scans folders: discovers it's a TypeScript utility package"]
  Scan --> MatchTemplate["Loads library archetype README template"]
  MatchTemplate --> GenDocs["Outputs README.md with TypeScript usage examples, badges, and structure"]
  GenDocs --> GenOnboarding["Outputs AGENTS.md defining the developer agent rules for the repo"]
  GenOnboarding --> Done([Clean, standardized documentation committed])
```

---

## 4. Verification Check

To ensure that the `repo-docs` skill is operating in strict compliance with Harness OS design laws, verify the following:

- [ ] **Physical Boundary Verification**: The skill boundaries are respected and do not leak context.
- [ ] **State Checkpoint Verification**: The active state is established, validated, and recorded at the beginning and end of each execution branch.
- [ ] **Cognitive Alignment**: The skill conforms to the **Think > Try > Summarize > Record** cognitive loop.
