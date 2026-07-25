# Workflow: To Tickets

> Breaks a `to-spec` feature spec, a plan, or the current conversation into tracer-bullet tickets with declared blocking edges, published through the same `projectDocs` entry `to-spec` already established. Reuses `to-spec`'s own project-docs gate — never a second setup interview.

---

## 1. Skill Behavior Workflow

This section visualizes how the `to-tickets` skill executes internally, detailing the sequence of operations, state transitions, and evaluation steps.

```mermaid
graph TD
  Start(["/to-tickets invoked"]) --> CheckScript["Step 0: node to-spec/scripts/check-project-docs.js check (shared gate)"]
  CheckScript --> ExitCode{"Exit code?"}
  ExitCode -->|1: missing/incomplete| StopPoint["Stop - tell user to run to-spec's Step 0 interview first"]
  ExitCode -->|0: projectDocs complete| Gather["Step 1: Gather context"]
  Gather --> SourceChoice{"Source available?"}
  SourceChoice -->|to-spec feature-spec referenced/in context| ReadSpec["Read full spec body + comments"]
  SourceChoice -->|No spec, just plan/conversation| UseConvo["Work from conversation/plan directly"]
  ReadSpec --> ShapeCheck{"Which to-spec shape was it?"}
  ShapeCheck -->|feature-spec| Explore
  ShapeCheck -->|cli-reference / schema-doc / dev-doc| ConfirmSplit["Confirm with user whether it even needs splitting"]
  ConfirmSplit -->|Needs splitting| Explore
  ConfirmSplit -->|Already ticket-sized| SingleTicket["Treat as a single ticket, skip Step 3 slicing"]
  UseConvo --> Explore["Step 2: Explore codebase, look for prefactor opportunities"]
  Explore --> Draft["Step 3: Draft vertical slices - tracer bullets + blocking edges"]
  Draft --> WideRefactor{"Wide refactor (mechanical, huge blast radius)?"}
  WideRefactor -->|Yes| ExpandContract["Sequence as expand - migrate batches - contract instead of tracer bullets"]
  WideRefactor -->|No| Quiz
  ExpandContract --> Quiz["Step 4: Quiz user - granularity, blocking edges, merge/split"]
  SingleTicket --> Quiz
  Quiz --> Approved{"User approves breakdown?"}
  Approved -->|No| Draft
  Approved -->|Yes| Publish["Step 5: Publish per projectDocs.tracker + issueDefinition"]
  Publish --> End(["Tickets published, frontier = unblocked tickets"])
```

---

## 2. Triggering and Routing Path

This diagram illustrates how `to-tickets` is reached through user requests and how it chains with companion skills in the Harness OS ecosystem.

```mermaid
graph LR
  Router["harness-everything / tier-router.js"] -->|Keyword: break into tickets / vertical slice / tracer bullet / blocking edges| Suggest["Suggests to-tickets/SKILL.md - advisory only, still explicit-invoke"]
  Suggest --> TT["to-tickets / SKILL.md"]
  TT -->|Step 0, mandatory, SAME script as to-spec| Gate["check-project-docs.js check"]
  Gate -->|Exit 1| RedirectToSpec["Stop - point user to /to-spec's Step 0 interview, not a duplicate here"]
  TS["to-spec / SKILL.md"] -->|Published feature-spec is the preferred input| TT
  TS -.->|Same projectDocs entry, read not written| Gate
  TT -->|No spec exists yet, still works from| Convo["Current conversation / plan"]
  TT -->|Publishes tickets that unblock| TDD["tdd / SKILL.md (Tier 2, per ticket)"]
```

---

## 3. Real-World Use Case Flowchart

```mermaid
graph TD
  Start["A to-spec feature-spec for 'notification retry limits' was published earlier"] --> Invoke["/to-tickets invoked with the spec's issue number"]
  Invoke --> RunCheck["node check-project-docs.js check - Exit 0, projectDocs already set from the to-spec run"]
  RunCheck --> FetchSpec["Fetches full spec body via gh issue view"]
  FetchSpec --> ExploreCode["Explores retry-policy module, finds a shared RetryConfig prefactor opportunity"]
  ExploreCode --> DraftSlices["Drafts 3 tracer-bullet tickets: 01 prefactor RetryConfig, 02 per-tenant override (blocked by 01), 03 UI toggle (blocked by 02)"]
  DraftSlices --> QuizUser["Presents numbered breakdown, user merges 02+03"]
  QuizUser --> Publish2["Publishes 2 GitHub issues in dependency order, Status: ready-for-agent"]
  Publish2 --> Done(["Frontier = ticket 01, unblocked, ready to claim"])
```

---

## 4. Verification Check

To ensure `to-tickets` is operating in strict compliance with Harness OS design laws, verify the following:

- [ ] **Shared Gate, No Duplicate Interview**: Step 0 called `to-spec`'s own `check-project-docs.js check` — it did not run a second, parallel setup interview for tracker/doc-location/issue-definition.
- [ ] **Vertical, Not Horizontal**: Every non-wide-refactor ticket cuts a complete path through all layers it touches — no ticket is "just the schema" or "just the UI" for the same feature.
- [ ] **Blocking Edges Are Real**: Each ticket's "Blocked by" lists only tickets that genuinely gate it, not every ticket that merely precedes it in reading order.
- [ ] **Wide-Refactor Exception Applied Correctly**: A mechanical, huge-blast-radius change was sequenced as expand → migrate batches → contract, not forced into a single tracer-bullet ticket that can't land green.
- [ ] **User Approval Before Publish**: The numbered breakdown was shown and approved (or iterated on) before Step 5 published anything.
- [ ] **No Forced Decomposition**: A `cli-reference`/`schema-doc`/`dev-doc` shaped `to-spec` doc that was already a single unit of work was not artificially split into multiple tickets.
