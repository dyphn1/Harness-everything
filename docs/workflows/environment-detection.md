# Workflow: Environment Detection

> Active shell, operating system, and toolset environment detection, providing safety guardrails and running preflight syntactic verification.

---

## 1. Skill Behavior Workflow

This section visualizes how the `environment-detection` skill executes internally, detailing the sequence of operations, state transitions, and evaluation steps.

```mermaid
graph TD
  Start([Before Command Execution]) --> DetectOS["Detect Operating System: Windows, macOS, Linux"]
  DetectOS --> DetectShell["Detect Shell: Bash, PowerShell, CMD, Zsh"]
  DetectShell --> ScanCapabilities["Scan available runtimes: Node, Python, .NET, Docker"]
  ScanCapabilities --> CheckSyntax["Inspect command for active shell compatibilities"]
  CheckSyntax --> SyntaxGuard{Syntax safe for shell?}
  SyntaxGuard -->|No| RewriteCmd["Transform/Rewrite command syntax to match active shell"]
  SyntaxGuard -->|Yes| Execute["Run command in persistent terminal"]
  RewriteCmd --> Execute
  Execute --> CaptureOutput["Interleave output and exit code correctly"]
  CaptureOutput --> End([Secure terminal result returned])
```

---

## 2. Triggering and Routing Path

This diagram illustrates how the `environment-detection` skill is triggered through user requests or developer actions, and how it integrates or chains together with other companion skills in the Harness OS ecosystem to form unified workflows.

```mermaid
graph LR
  Router["harness-everything / tier-router.js"] -->|Pre-flight command execution| Env["environment-detection / SKILL.md"]
  Env -->|Guards runner execution commands in| TDD["tdd / SKILL.md"]
  Env -->|Guards script installations in| InstallOS["install-cognitive-os / SKILL.md"]
  Env -->|Guards PR quality checks in| VerLoop["verification-loop / SKILL.md"]
```

---

## 3. Real-World Use Case Flowchart

Here we model concrete real-world scenarios and use cases of the `environment-detection` skill, illustrating standard success paths, error handling, or recovery loops.

```mermaid
graph TD
  Start["Agent wants to run: 'rm -rf build && mkdir build' on Windows Powershell"] --> Trigger["Environment detection pre-flight check"]
  Trigger --> Detect["Identifies OS: Windows, Shell: PowerShell"]
  Detect --> AnalyzeSyntax["Identifies that 'rm -rf' will fail or behave unexpectedly in PowerShell"]
  AnalyzeSyntax --> Rewrite["Rewrites command to PowerShell equivalent or executes using native node commands"]
  Rewrite --> Run["Executes safely with exit code 0"]
  Run --> Done([Syntax error and execution crash avoided])
```

---

## 4. Verification Check

To ensure that the `environment-detection` skill is operating in strict compliance with Harness OS design laws, verify the following:

- [ ] **Physical Boundary Verification**: The skill boundaries are respected and do not leak context.
- [ ] **State Checkpoint Verification**: The active state is established, validated, and recorded at the beginning and end of each execution branch.
- [ ] **Cognitive Alignment**: The skill conforms to the **Think > Try > Summarize > Record** cognitive loop.
