---
name: todo-driven-workflow
description: Enforces a deliberate, step-by-step execution loop.
version: 1.1.0
metadata:
  type: harness-discipline
---

# Todo-Driven Workflow (以 TODO 驅動的自動化工作流)

## 📋 Skill Contract

| Component | Specification |
| :--- | :--- |
| **Trigger / Input** | Tier 2/3 Task Identification. Input: High-level task description. |
| **Expected Output** | Granular execution state. A series of terminal calls to `todo-cli.js`. |
| **State Mutations** | MUST write to `.harness/todo-state.json` via CLI. |
| **Enforcement Gate** | `node harness-everything/scripts/todo-cli.js`. Exits with Code 1 if multitasking, bypassing initialization, or skipping `verify-gate.js`. |

This skill enforces a disciplined execution loop. It prevents "hallucinated progress" by forcing the Agent to track exact state and prove completion before moving to the next step. 

---

## ⚡ Core Trigger (觸發時機)
This workflow is **the default operating behavior** for any complex, multi-step, or multi-file development tasks (Tier 2 and Tier 3).

## ⚙️ Execution Method

| Environment | Primary Task Tracker | Implementation Method |
| :--- | :--- | :--- |
| **All Environments** | `todo-cli.js` | You MUST use `node harness-everything/scripts/todo-cli.js` for all state transitions. Do NOT rely on prompt text. |

---

## 🔄 Execution Loop: Think > Try > Summarize > Record

### 1. Analyze and Plan (Think)
Break the high-level goal into **3 to 7 concrete, verifiable sub-tasks**.

### 2. Initialize the Todo List (Record)
- **CRITICAL ACTION**: You MUST use the `run_in_terminal` tool to run `node harness-everything/scripts/todo-cli.js init "Task 1" "Task 2"` BEFORE modifying any code.
- *Rule*: The terminal output will confirm the list is initialized.

### 3. Step-by-Step Execution
1. **Start**: Use `run_in_terminal` to run `node harness-everything/scripts/todo-cli.js start <id>`. **If you try to start two tasks, the script will crash and block you.**
2. **Execute**: Perform the necessary actions (read files, grep, run terminal commands, edit files).
3. **Verify**: The validation gate is hardcoded into the completion step.
4. **Complete**: Use `run_in_terminal` to run `node harness-everything/scripts/todo-cli.js complete <id>`. If the internal `verify-gate.js` check fails, this command will Exit 1 and block you.

### 4. Handling Blocker Failures (Dynamic Adaptation)
If a step fails:
- Use `node harness-everything/scripts/todo-cli.js add "Fix specific error"` to insert a blocker.
- Do NOT silently ignore or bypass the error.
