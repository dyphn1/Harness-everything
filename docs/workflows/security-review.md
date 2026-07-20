# Workflow: Security Review

> Automated security scanning, threat modeling, and input-validation reviews to identify potential security holes and enforce robust safety guardrails.

---

## 1. Skill Behavior Workflow

This section visualizes how the `security-review` skill executes internally, detailing the sequence of operations, state transitions, and evaluation steps.

```mermaid
graph TD
  Start([Code Refactoring / Feature Done]) --> ScanInputs["Locate all user input and API boundary points"]
  ScanInputs --> ThreatModeling["Perform threat modeling on data flow"]
  ThreatModeling --> CheckCommonVulnerabilities["Check for SQL Injection, XSS, CSRF, and broken access controls"]
  CheckCommonVulnerabilities --> AuditDependencies["Scan package dependencies for known CVE vulnerabilities"]
  AuditDependencies --> FlagSinks["Flag insecure coding patterns, hardcoded secrets, or raw exec commands"]
  FlagSinks --> CompileSecurityReport["Compile actionable security hardening proposal"]
  CompileSecurityReport --> End([Codebase hardened and verified secure])
```

---

## 2. Triggering and Routing Path

This diagram illustrates how the `security-review` skill is triggered through user requests or developer actions, and how it integrates or chains together with other companion skills in the Harness OS ecosystem to form unified workflows.

```mermaid
graph LR
  Router["harness-everything / tier-router.js"] -->|Pre-flight / Quality PR reviews| SecReview["security-review / SKILL.md"]
  SecReview -->|Informs security tests written in| TDD["tdd / SKILL.md"]
  SecReview -->|Integrated as mandatory PR gate in| VerLoop["verification-loop / SKILL.md"]
```

---

## 3. Real-World Use Case Flowchart

Here we model concrete real-world scenarios and use cases of the `security-review` skill, illustrating standard success paths, error handling, or recovery loops.

```mermaid
graph TD
  Start["New search feature: executes system shell query using raw user input string"] --> Trigger["security-review skill runs"]
  Trigger --> Scan["Flags potential command injection vulnerability in search.js"]
  Scan --> Propose["Propose input sanitization and switching to child_process.execFile with argument array"]
  Propose --> Implement["Refactor code to use safe argument arrays instead of raw string shell execution"]
  Implement --> Done([Critical remote code execution vulnerability resolved])
```

---

## 4. Verification Check

To ensure that the `security-review` skill is operating in strict compliance with Harness OS design laws, verify the following:

- [ ] **Physical Boundary Verification**: The skill boundaries are respected and do not leak context.
- [ ] **State Checkpoint Verification**: The active state is established, validated, and recorded at the beginning and end of each execution branch.
- [ ] **Cognitive Alignment**: The skill conforms to the **Think > Try > Summarize > Record** cognitive loop.
