# Workflow: Todo-Driven Workflow

> The fundamental execution loop. Driven entirely by terminal state machines (`todo-cli.js`).

---

## 1. Skill Behavior Workflow

This section visualizes the rigid state constraints. Transitioning state is blocked unless verification gates pass.

```mermaid
graph TD
  Start([Initialize Checklist]) --> Plan["Define 3-7 Verifiable Sub-tasks"]
  Plan --> SaveTodo["Try: node todo-cli.js init ..."]
  
  SaveTodo --> ChooseTask["Choose ONE pending task"]
  ChooseTask --> MarkInProgress["Try: node todo-cli.js start <id>"]
  
  MarkInProgress --> CheckStart{Gate: Exit Code?}
  CheckStart -->|Exit 1: Multitasking Blocked| ReflectStart["Reflect: Must complete previous task first"]
  ReflectStart --> Execute
  
  CheckStart -->|Exit 0| Execute["Execute code changes"]
  
  Execute --> GatherEvidence["Try: node verify-gate.js"]
  GatherEvidence --> VerifySuccess{Gate: Exit Code?}
  
  VerifySuccess -->|Exit 1: Code is broken| ReflectCode["Reflect: Read Error Log & Fix"]
  ReflectCode --> Execute
  
  VerifySuccess -->|Exit 0: Code works| MarkCompleted["Try: node todo-cli.js complete <id>"]
  
  MarkCompleted --> CheckRemaining{All tasks completed?}
  CheckRemaining -->|No| ChooseTask
  CheckRemaining -->|Yes| Finish([Signal Task Completion])
```
