# Workflow: Fable Mode

> Macro-task planning and execution engine. Like all Harness workflows, this is not a straight line to success. It requires continuous verification and course correction.

---

## 1. Skill Behavior Workflow

This section visualizes how `fable-mode` handles macro tasks. Subagent failure or integration crashes are expected realities, not edge cases.

```mermaid
graph TD
  Start([Tier 3 Macro Task Triggered]) --> InitFable["Initialize Fable Execution Context"]
  InitFable --> AnalyzeScope["Map system dependencies & files"]
  AnalyzeScope --> GenerateContract["Generate Contract & Todo List"]
  
  GenerateContract --> RunStep["Try: Execute Step / Sub-agent"]
  RunStep --> VerifyStep["Try: Run verify-gate.js for Integration"]
  
  VerifyStep --> Check{Gate: Exit Code?}
  Check -->|Exit 1: Sub-agent Failed| Diagnose["Reflect: Why did sub-agent fail?"]
  Diagnose --> InsertBlocker["Insert Blocker Todo: Fix Integration"]
  InsertBlocker --> RunStep
  
  Check -->|Exit 0: Success| CheckAllSteps{All steps done?}
  CheckAllSteps -->|No| RunStep
  CheckAllSteps -->|Yes| FinalAudit["Perform system-wide verification loop"]
  
  FinalAudit --> FinalCheck{Gate: Exit Code?}
  FinalCheck -->|Exit 1| Diagnose
  FinalCheck -->|Exit 0| End([Macro rewrite successfully deployed])
```
