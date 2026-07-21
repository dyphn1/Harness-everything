# Workflow: Test-Driven Development (TDD)

> Enforces the classic Red-Green-Refactor development cycle. Crucially, this is NOT a linear process. It is a loop driven by terminal exit codes.

---

## 1. Skill Behavior Workflow

This section visualizes the script-gated reality of TDD. The AI cannot progress to the next phase until the terminal script explicitly confirms the state.

```mermaid
graph TD
  Start([Identify Feature / Bug]) --> DesignInterface["Design interface & contract"]
  DesignInterface --> WriteTest["Write unit/integration tests first"]
  
  WriteTest --> RunRed["Try: Run tests (EXPECT FAILURE)"]
  RunRed --> VerifyRed{Gate: Exit Code 1?}
  VerifyRed -->|Exit 0: Fake Test| FixTest["Reflect: Test is broken/fake. Fix it."]
  FixTest --> RunRed
  
  VerifyRed -->|Exit 1: True Red| WriteCode["Write minimal code to pass test"]
  
  WriteCode --> RunGreen["Try: Run tests (EXPECT SUCCESS)"]
  RunGreen --> VerifyGreen{Gate: verify-gate.js}
  
  VerifyGreen -->|Exit 1: Still Broken| DebugCode["Reflect: Read logs, fix code"]
  DebugCode --> RunGreen
  VerifyGreen -->|Exit 1: 3x Failures| CircuitBreaker["Trigger rule-of-3.js: ZOOM OUT"]
  CircuitBreaker --> DebugCode
  
  VerifyGreen -->|Exit 0: Green| Refactor["Refactor code for readability"]
  
  Refactor --> RunVerify["Try: Run tests again"]
  RunVerify --> VerifyRefactor{Gate: verify-gate.js}
  VerifyRefactor -->|Exit 1| Revert["Revert refactor / Fix"]
  Revert --> RunVerify
  
  VerifyRefactor -->|Exit 0| End([Feature verified & completed])
```
