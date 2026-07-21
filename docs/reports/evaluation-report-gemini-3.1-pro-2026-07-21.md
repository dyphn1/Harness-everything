# Harness System Evaluation Report
**Evaluator:** Gemini 3.1 Pro Preview
**Date:** 2026-07-21
**Execution Mode:** Strict Architectural Audit

## 1. Five Core Verification Criteria Assessment

### 1.1 Skill Description Completeness (Score: 3/10)
- **Diagnosis**: Severely incomplete and inconsistent.
- **Details**: While some skills (e.g., `tdd/SKILL.md`) contain a rudimentary `📋 Skill Contract`, others (like `environment-detection/SKILL.md`) lack it entirely. The descriptions rely far too heavily on vague natural language rather than strict deterministic constraints. Explicit boundary mechanisms (Circuit Breakers) and upstream/downstream dependency definitions are missing from most skill files. This fails the rigor criteria for precise contract definitions.

### 1.2 Routing Accuracy (Score: 3/10)
- **Diagnosis**: Fragile and highly susceptible to noise.
- **Details**: `harness-everything/scripts/tier-router.js` violates the strict criteria by relying purely on brittle keyword heuristics (e.g., "API", "refactor") and active workspace Git Diff stats (`git diff --numstat`). This approach guarantees false positives—if a workspace has unrelated uncommitted changes, the router's logic is immediately contaminated. It lacks semantic understanding for composite tasks.

### 1.3 Test Coverage of All Skills (Score: 2/10)
- **Diagnosis**: Failing. Testing is superficial and tokenistic.
- **Details**: The automated tests (`self-regression.js`) primarily execute static syntax checks (`node --check`). The `eval-framework/behavioral-test.js` only tests the `todo-cli.js` state mutations. Crucial skills such as `fable-mode`, `build-multi-agent-system`, `git-commit`, and `tdd` have **zero** behavioral test coverage. This is a direct violation of the core verification requirement to validate the core logic of *all* installed Skills.

### 1.4 Configuration Balance (Light vs. Heavy) (Score: 4/10)
- **Diagnosis**: Extremely asymmetrical and unbalanced.
- **Details**: The system suffers from severe platform bifurcation. Claude Code experiences excessively heavy, hard-blocking hooks (e.g., `boundary-guard.js`, `stop-gate.js`) that risk paralyzing the agent, whereas VS Code Copilot, Cursor, and Codex are left with excessively light, purely advisory text prompts that can be easily ignored. There is no middle-ground progressive constraint mechanism.

### 1.5 Workflow Conformance (Score: 2/10)
- **Diagnosis**: Documentation-only; lacks runtime enforcement.
- **Details**: The workflow diagrams defined in `docs/workflows/` are purely theoretical. There are no runtime state transition validations or enforcement mechanisms to guarantee that an agent moves from `tdd` to `git-commit`, or from `improve-codebase-architecture` to `grill-with-docs`. The system treats these crucial operational flows merely as documentation, which warrants severe penalization.

---

## 2. Platform Feature Matrix

| Feature | Claude | Codex | Cursor | Copilot |
| :--- | :---: | :---: | :---: | :---: |
| Hook Execution | ✅ | ❌ | ❌ | ❌ |
| Runtime Enforcement | ✅ | ❌ | ❌ | ❌ |
| Prompt Guidance | ✅ | ✅ | ✅ | ✅ |
| State Verification | ✅ | ❌ | ❌ | ❌ |
| Behavior Test Coverage | ⚠️ (Partial) | ❌ | ❌ | ❌ |
| Auto Recovery Loop | ✅ | ❌ | ❌ | ❌ |

---

## 3. Overall Scorecard

| Category | Score | Deep Analysis & Improvement Directions |
| :--- | :---: | :--- |
| **Architecture** | 3.5/10 | The architecture relies heavily on platform-specific hooks (Claude) while leaving other IDEs unprotected. Must decouple enforcement logic from CLI constraints and introduce isomorphic state verification. |
| **README Completeness** | 5.5/10 | Documentation exists but masks the underlying lack of enforcement on most platforms. Must explicitly state the severe limitations outside of Claude Code. |
| **Maintainability** | 4.0/10 | Heavy reliance on heuristic scripts and scattered state files (`.harness/`) makes state reconciliation fragile. Needs a unified state machine. |
| **Skills Design** | 3.5/10 | Skills lack strict schemas. Must mandate a unified JSON/YAML contract for all `SKILL.md` files to enable programmatic parsing and validation instead of natural language guessing. |
| **Agent Compatibility** | 3.0/10 | False advertising of "universal" support. The system is fundamentally broken down to "advisory only" on 75% of listed platforms. |
| **Beginner Friendliness** | 4.0/10 | The steep drop-off in guardrails outside of Claude Code will confuse beginners who expect the same safety nets in VS Code or Cursor. |

---

## 4. Immediate Architectural Recommendations
1. **Mandatory Runtime Enforcement API**: Replace documentation-based workflow chains with a localized runtime API (e.g., a local MCP server or state machine) that strictly validates tool call sequences regardless of the IDE.
2. **Remove Git Stat Routing**: Instantly deprecate the usage of `git diff --numstat` in `tier-router.js`. Replace with context-aware semantic routing.
3. **Behavioral Test Expansion**: Halt all new feature development until E2E behavioral tests are written for `tdd`, `fable-mode`, and `git-commit`. Static syntax checks are unacceptable as a primary defense.
4. **Enforce Strict Schema**: Implement a CI step that fails the build if a `SKILL.md` lacks the `📋 Skill Contract` table, boundary definitions, and input/output schemas.
