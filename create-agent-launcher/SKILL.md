---
name: create-agent-launcher
description: Sub-agent generator for orchestrating multi-domain specialized agents to avoid token waste.
---

# Create Agent Launcher

This skill is automatically invoked by `fable-mode` when handling Tier 3 (Macro Tasks) that require domain-specific division of labor.
Its purpose is to avoid wasting Tokens and losing attention caused by a single General Agent handling everything, by creating highly specialized Sub-agents to solve complex problems.

## 1. Responsibilities and Use Cases
Launch this skill when the task complexity exceeds what a single context can handle, or when switching between entirely different tech stacks is necessary (e.g., the same feature requires modifying Postgres Schema, Node.js Backend, and React Frontend).

## 2. Standard Procedure for Creating Sub-agents

### Step 1: Persona Definition
Before calling a secondary model (or instantiating a new Agent), you MUST explicitly give it a specialized persona definition.
- **Bad Example**: "Help me fix these frontend and backend codes."
- **Good Example**: "You are now a Senior Database Architect. Your sole task is to optimize the indexing and write performance of the User Table for this requirement. You are PROHIBITED from modifying any frontend code."

### Step 2: Resource Isolation
- Limit the Sub-agent's field of view. Only provide it with the file paths and Context necessary to complete its task.
- Do not feed the entire project structure to an Agent that is only responsible for writing a single SQL Migration.

### Step 3: Model Selection Strategy
Based on the complexity of the sub-task, select the most cost-effective model (assuming the underlying Harness supports switching):
- **Exploration/Finding Files/Simple Edits**: Assign to a fast, low-cost small model (like Claude 3.5 Haiku).
- **Multi-file Implementation/General Logic**: Assign to a medium-sized main model (like Claude 3.5 Sonnet).
- **Extremely Complex Algorithms/Security Audits**: Assign to a deep reasoning model (like Claude 3 Opus).

### Step 4: Handoff Contract
- Tell the Sub-agent that once it completes its task, it MUST output a report in a specific format to the main Orchestrator (`fable-mode`).
- The report MUST include: which files were modified, what new APIs/interfaces were exposed, and what downstream Agents need to pay attention to.

## 3. Foolproofing Mechanism
- Avoid over-segmentation: If a cross-stack task can be resolved within 2 files and 300 lines of code, establishing a Sub-agent is **PROHIBITED**. Resolve it directly in the current Context using `tdd` mode.
- Sub-agents are also Agents, equally bound by the `install-cognitive-os` physical laws and the `zoom-out` circuit breaker.
