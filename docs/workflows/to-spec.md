# Workflow: To Spec

> Synthesizes an already-discussed conversation into whichever written artifact actually fits — feature spec, CLI/API reference, schema doc, or dev doc — and publishes it per this repo's own `projectDocs` entry inside `harness-everything/manifest.json`. Advisory in both Tier 2 and Tier 3 toward other skills; its own Step 0 framework check is a mechanized script gate, not advisory.

---

## 1. Skill Behavior Workflow

This section visualizes how the `to-spec` skill executes internally, detailing the sequence of operations, state transitions, and evaluation steps.

```mermaid
graph TD
  Start(["/to-spec invoked"]) --> CheckScript["Step 0: node to-spec/scripts/check-project-docs.js check"]
  CheckScript --> ExitCode{"Exit code?"}
  ExitCode -->|0: projectDocs complete in a repo-local manifest.json| Gather
  ExitCode -->|1: missing/incomplete| Interview["Interview only the flagged field(s): docLocation / tracker / issueDefinition"]
  Interview --> PersistInit["node check-project-docs.js init --doc-location ... --tracker ... --issue-definition ..."]
  PersistInit --> WriteManifest["Writes projectDocs into every bootstrapped platform's harness-everything/manifest.json (repo-local homes only)"]
  WriteManifest --> Gather["Step 1: Gather context - explore codebase, cite settled CONTEXT.md/ADR decisions"]
  Gather --> PriorGrilling{"Unresolved fork found?"}
  PriorGrilling -->|Yes| SuggestGrill["Suggest grill-me/grill-with-docs first - do NOT interview inline"]
  PriorGrilling -->|No| PickShape["Step 2: Pick the template shape"]
  PickShape --> ShapeChoice{"What's being built?"}
  ShapeChoice -->|Feature / product surface| FeatureSpec["templates/feature-spec.md"]
  ShapeChoice -->|Command / endpoint| CliRef["templates/cli-reference.md"]
  ShapeChoice -->|Data shape| SchemaDoc["templates/schema-doc.md"]
  ShapeChoice -->|Scoped decision| DevDoc["templates/dev-doc.md"]
  FeatureSpec --> ConfirmSeams["Step 3: Confirm seams with user"]
  CliRef --> ConfirmSurface["Step 3: Confirm flag/field surface with user"]
  SchemaDoc --> ConfirmSurface
  DevDoc --> ConfirmDecision["Step 3: Confirm one-line decision with user"]
  ConfirmSeams --> WriteDoc["Step 4: Write doc from adapted template"]
  ConfirmSurface --> WriteDoc
  ConfirmDecision --> WriteDoc
  WriteDoc --> RouteDest{"Shape?"}
  RouteDest -->|Feature spec| PublishIssue["File as issue per tracker + issueDefinition fields"]
  RouteDest -->|CLI ref / schema doc / dev doc| PublishDoc["Write under docLocation field - not filed as an issue"]
  PublishIssue --> End(["Published"])
  PublishDoc --> End
```

---

## 2. Triggering and Routing Path

This diagram illustrates how `to-spec` is reached through user requests and how it chains with companion skills in the Harness OS ecosystem.

```mermaid
graph LR
  Router["harness-everything / tier-router.js"] -->|Keyword: spec / PRD / cli reference / schema doc / dev doc| Suggest["Suggests to-spec/SKILL.md - advisory only, still explicit-invoke"]
  Suggest --> TS["to-spec / SKILL.md"]
  TS -->|Step 0, mandatory| Gate["check-project-docs.js check - scans repo-local manifest.json homes only"]
  Gate -->|Exit 1, first run only| Init["check-project-docs.js init writes projectDocs into manifest.json"]
  Init --> TS
  Manifest["harness-everything/manifest.json (also owned by scripts/lib/manifest.js + self-evolve's generated registry)"] -.->|same file, different key| Gate
  GWD["grill-with-docs / SKILL.md"] -->|Settles decisions BEFORE, feeds feature-spec shape| TS
  GM["grill-me / SKILL.md"] -->|Settles decisions BEFORE| TS
  TDD["tdd / SKILL.md (Tier 2)"] -.->|Optional pre-implementation doc, never blocks Red/Green/Refactor| TS
  TS -->|Unresolved fork found mid-synthesis| GWD
  TS -->|Published doc becomes input for| ToTickets["to-tickets / SKILL.md (planned)"]
```

---

## 3. Real-World Use Case Flowchart

```mermaid
graph TD
  Start["Tier 2 task: add a new `harness todo export` CLI command"] --> Invoke["/to-spec invoked (optional, offered by router)"]
  Invoke --> RunCheck["node check-project-docs.js check"]
  RunCheck --> Exit0["Exit 0 - .claude/harness-everything/manifest.json already has projectDocs from a prior run"]
  Exit0 --> Gather2["Gathers context: existing todo-cli.js command shapes"]
  Gather2 --> PickShape2["Picks cli-reference.md - not feature-spec, no user stories needed"]
  PickShape2 --> ConfirmFlags["Confirms --format and --since flag names with user"]
  ConfirmFlags --> Draft["Writes doc from templates/cli-reference.md, adapted headings"]
  Draft --> ReadDocLoc["projectDocs.docLocation says docs/reference/"]
  ReadDocLoc --> PublishLocal["docs/reference/todo-export.md - not filed as an issue"]
  PublishLocal --> Done(["Doc published; TDD proceeds unblocked either way"])
```

---

## 4. Verification Check

To ensure `to-spec` is operating in strict compliance with Harness OS design laws, verify the following:

- [ ] **Mechanized Gate, Not Prose**: Step 0 ran `check-project-docs.js check` and honored its exit code — it did not skip straight to inferring the framework from prose memory of past runs.
- [ ] **Repo-Local, Not Global**: `projectDocs` was read from / written to a workspace-relative platform home only (`.claude/`, `.cursor/`, `.github/`, `.codex/`, `.continue/` under this repo) — never `~/.agents` or the global `~/.claude` manifest, which would leak this repo's tracker into unrelated projects.
- [ ] **Pointer, Not Payload**: Every `projectDocs` field is a short pointer (≤ 200 chars, enforced by `init`) — elaborate content (a full issue template, a per-context doc map) lives in its own file, referenced by path, not inlined into `manifest.json`.
- [ ] **No Re-Interview Violation**: Beyond the one-time Step 0 setup, the skill did not ask the user questions that a prior `grill-me`/`grill-with-docs` pass, or the conversation itself, already answered.
- [ ] **Adaptive Shape Selection**: The template picked (feature-spec / cli-reference / schema-doc / dev-doc) actually matches the artifact being documented — not defaulted to the heaviest shape out of habit.
- [ ] **Shape-Correct Destination**: A feature-spec was filed as an issue; a CLI-reference/schema-doc/dev-doc was written under `docLocation` instead, unless the user explicitly confirmed it should also be an issue.
- [ ] **Non-Blocking Toward Other Skills**: The Step 3 confirmation happened before publishing, and to-spec's own execution never delayed or gated `tdd`/`verification-loop` in a Tier 2 flow.
