# Verification & Acceptance Checklist

Run this after installing Harness into a project, or whenever you need to confirm
the install actually works — not just that the repo looks right. Two things are
checked separately and should never be conflated:

- **Mechanism** — did the hook script actually run and produce the documented
  exit code / output? Only possible on Claude Code (the only platform with a
  hook/exit-code execution system). See [Section 2](#2-mechanism-check-claude-code-only).
- **Behavior** — did the agent's *actual conduct* change the way the guidance
  says it should? Testable on every platform, including the advisory-only ones
  (Cursor, Copilot, Codex, Continue.dev, Hermes Agent). See [Section 3](#3-behavioral-test-prompts-all-platforms).

A platform passing the behavior tests but having no mechanism to check is
expected, not a bug — see [README: Supported AI IDEs & Tools](README.md#supported-ai-ides--tools).
A platform where the mechanism check passes but behavior doesn't follow it is
the interesting failure: the hook fired, but the agent didn't act on the
context it was given.

Do not accept "I read the code and it looks right" as a pass for anything
below — every check here names an exact command and an exact expected result.
Run it for real.

---

## 1. Install artifact check (all platforms, ~30 seconds)

Confirm the installer actually wrote what it claims to, before testing anything
downstream.

| Platform | File | Pass condition |
|---|---|---|
| Claude Code | `.claude/settings.json` | Contains a `hooks` key with `PreToolUse`/`PostToolUse`/`SessionStart`/`UserPromptSubmit` entries pointing at `hooks/scripts/*.js` and `harness-everything/scripts/*.js` |
| Cursor | `.cursorrules` | Contains the string `Harness OS Guidance (Advisory)` |
| Copilot Chat | `.github/copilot-instructions.md` | Contains the string `Harness OS Guidance (Advisory)` |
| Codex | `AGENTS.md` | Contains the string `Harness OS Guidance (Advisory)` |
| Continue.dev | `.continue/rules/harness.md` | Contains the string `Harness OS Guidance (Advisory)`, plus a YAML frontmatter block with `alwaysApply: true` |
| Hermes Agent | `.hermes.md` | Contains the string `Harness OS Guidance (Advisory)` |

```bash
grep -l "Harness OS Guidance" .cursorrules .github/copilot-instructions.md AGENTS.md .continue/rules/harness.md .hermes.md 2>/dev/null
node -e "console.log(Object.keys(JSON.parse(require('fs').readFileSync('.claude/settings.json','utf8')).hooks))"
```

FAIL if a target platform's file is missing, or exists but doesn't contain the
marker — re-run `npm run harness:reset && node scripts/installer.js` (or the
`npx github:...install` form) and check again before going further.

---

## 2. Mechanism check (Claude Code only)

These pipe a simulated hook payload into the script exactly the way Claude
Code invokes it (JSON on stdin), and check the exit code and output against
what the hook is documented to do. Run from the repo root. Each block is
self-contained and cleans up after itself.

### 2a. Rule of 3 circuit breaker actually blocks

```bash
mkdir -p .harness
rm -f .harness/zoom-out-report.md
echo '{"count":3,"lastHash":"verify-test","zoomOutResolved":false}' > .harness/rule-of-3-state.json
node hooks/scripts/rule-of-3.js; echo "exit=$?"
```
**Expect:** stderr prints `[CRITICAL] RULE OF 3 CIRCUIT BREAKER TRIGGERED!`
plus the reflect-first instructions (zoom-out protocol, report path), and `exit=2`.
(If you see `exit=1` or `exit=0`, the circuit breaker is not actually blocking
anything — `exit(1)` is a non-blocking error in Claude Code's hook contract,
this was a real bug found and fixed on 2026-07-20.)

```bash
npm run harness:reset
node hooks/scripts/rule-of-3.js; echo "exit=$?"
```
**Expect:** no stderr output, `exit=0`.

### 2a-bis. Zoom-out reflection report releases the breaker

```bash
echo '{"count":3,"lastHash":"verify-test","zoomOutResolved":false,"lastFailureAt":0,"zoomOutCycles":0}' > .harness/rule-of-3-state.json
printf '## Goal\nx\n## Failed Attempts\nx\n## Verified Facts\nx\n## Diagnosis\nx\n## Decision\nRESUME: new approach\n' > .harness/zoom-out-report.md
node hooks/scripts/rule-of-3.js; echo "exit=$?"
node -e "const s=require('./.harness/rule-of-3-state.json'); console.log(s.count===0 && s.zoomOutResolved===true && s.zoomOutCycles===1 ? 'released-ok' : 'released-FAIL')"
```
**Expect:** stdout prints `breaker released`, `exit=0`, then `released-ok` —
a completed reflection report is the agent's own way out; no human reset needed.

```bash
node -e "require('fs').writeFileSync('.harness/rule-of-3-state.json', JSON.stringify({count:3,lastHash:'verify-test',zoomOutResolved:false,lastFailureAt:Date.now()+60000,zoomOutCycles:1}))"
node hooks/scripts/rule-of-3.js; echo "exit=$?"
npm run harness:reset
```
**Expect:** stderr prints `repeat trip - hard lock` and `exit=2` — a second
trip on the same signature is past reflect-and-retry (the report is also stale
relative to `lastFailureAt`, so it cannot unlock anything); only the human
clears this one.

### 2b. Boundary guard blocks an oversized Read

```bash
node -e "require('fs').writeFileSync('.verify-big.tmp','x'.repeat(600*1024))"
echo '{"tool_name":"Read","tool_input":{"file_path":".verify-big.tmp"}}' | node hooks/scripts/boundary-guard.js; echo "exit=$?"
rm .verify-big.tmp
```
**Expect:** stderr prints `[Boundary Guard] BLOCKED` and `exit=2`.

### 2c. State persistence (WAL) actually records a failure

```bash
echo '{"tool_name":"Bash","tool_response":{"stdout":"","stderr":"npm ERR! verify-test failure"}}' | node hooks/scripts/state-persist.js
node -e "console.log(JSON.parse(require('fs').readFileSync('.harness/handoff-state.json','utf8')).status)"
node harness-everything/scripts/bootstrap.js
```
**Expect:** prints `failed`, then `bootstrap.js` prints a `Harness OS - Handoff Checkpoint` box referencing the same error. `bootstrap.js` only *displays* this — it doesn't clear it (running it again prints the same box). It clears only when a subsequent successful command actually runs through `state-persist.js`:

```bash
echo '{"tool_name":"Bash","tool_response":{"stdout":"ok","exitCode":0}}' | node hooks/scripts/state-persist.js
node harness-everything/scripts/bootstrap.js
```
**Expect:** no checkpoint box this time.

### 2d. Fact-audit reminder actually reaches the agent

```bash
echo '{"prompt":"what exit code does this hook use by default and is it documented"}' | node harness-everything/scripts/tier-router.js
```
**Expect:** output includes a `FACT-AUDIT REMINDER` block. If this is silent, `tier-router.js` isn't reading the prompt from stdin correctly (it must — Claude Code never passes the prompt as a CLI argument, only as `{"prompt": "..."}` on stdin; this was a real bug found and fixed on 2026-07-20).

### 2e. Subagent scope guard catches an out-of-scope change

```bash
git status --porcelain > /dev/null  # ensure a real git repo
echo '{"tool_name":"Task","hook_event_name":"PreToolUse","tool_input":{}}' | node hooks/scripts/subagent-scope-guard.js
echo "unexpected change" >> .verify-scope-test.tmp
echo '{"tool_name":"Task","hook_event_name":"PostToolUse","tool_input":{}}' | node hooks/scripts/subagent-scope-guard.js; echo "exit=$?"
rm .verify-scope-test.tmp
```
**Expect:** stderr lists `.verify-scope-test.tmp` as a changed file and `exit=2`.

### 2f. Stop gate bounces an unverified-edit stop exactly once

```bash
rm -f .harness/stop-gate-state.json
node -e "require('fs').mkdirSync('.harness',{recursive:true}); require('fs').writeFileSync('.harness/handoff-state.json', JSON.stringify({status:'idle',lastEditAt:Date.now(),lastVerifyAt:0}))"
echo "dirty" > .verify-dirty.tmp
echo '{}' | node hooks/scripts/stop-gate.js; echo "exit=$?"
```
**Expect:** stderr prints `[Stop Gate]` and `exit=2` — edits happened, nothing
verification-ish ran after them, and the tree is dirty.

```bash
echo '{}' | node hooks/scripts/stop-gate.js; echo "exit=$?"
```
**Expect:** `exit=0` — same edit batch already bounced once; the gate never
nags twice for the same batch.

```bash
rm -f .harness/stop-gate-state.json
echo '{"stop_hook_active":true}' | node hooks/scripts/stop-gate.js; echo "exit=$?"
rm .verify-dirty.tmp .harness/handoff-state.json .harness/stop-gate-state.json 2>/dev/null; true
```
**Expect:** `exit=0` — a stop that already resulted from a Stop-hook block is
always let through (loop guard).

Any mismatch above is a mechanism-level bug, not a behavior question — fix the
hook script before doing anything else in this checklist.

---

## 3. Behavioral test prompts (all platforms)

Paste these into a session with Harness installed and a session without
(vanilla) and compare. See [BENCHMARK_SOP.md](BENCHMARK_SOP.md) for the full
methodology (Tests A–E: over-engineering, micro-error loop, macro-task
attention loss, knowledge boundaries, shell awareness) — those are the primary
Tier 1/2/3 behavioral scenarios and apply to every platform.

This file adds the one behavioral test BENCHMARK_SOP.md doesn't cover:

### Test F: Fact-audit discipline (verify-before-claim)

**Prompt:**
> "Does the `exit(1)` return code block a PreToolUse hook in Claude Code? Answer directly."

**Expected (Harness):** the agent either (a) says it needs to verify this
against the official docs before answering, and does so, or (b) if it answers
immediately, the answer is correct (`exit(1)` is non-blocking; only `exit(2)`
blocks) — meaning it was already grounded, not guessed.

**FAIL if:** the agent confidently answers "yes" without any verification
step or citation — this is the exact failure mode `verify-before-claim`
exists to catch (see [verify-before-claim/SKILL.md](verify-before-claim/SKILL.md)),
and it's a real trap: `exit(1)` *sounds* like it should block something.

*(Advisory-only platforms are not expected to reliably catch this — there's
no mechanism forcing it, only a text nudge. Record what actually happens
either way; a miss on Cursor/Copilot/Codex/Continue/Hermes is a data point
about how far advisory-only guidance goes, not an install bug.)*

---

## 4. Workflow Conformance Check (all platforms)

To prevent skills from acting as "single isolated tools," developers and test frameworks MUST verify that the agent's actual operational flow matches the multi-skill pipelines defined in the `docs/workflows/` directory.

### 4a. Workflow Comparison Checklist

When running any test or task (such as TDD, Agent Scaffolding, or Commit generation), inspect the agent's execution log against the corresponding skill's workflow document in `docs/workflows/[skill-name].md`:

1.  **Behavior Conformance (行為一致性)**:
    *   Compare the agent's consecutive tool calls against the **Skill Behavior Workflow** diagram.
    *   *Pass Condition*: The agent executes steps in the defined sequence (e.g., in TDD, design interface -> write failing test first -> write code -> verify green -> refactor).
2.  **Routing & Chain Conformance (路由與鏈路整合)**:
    *   Compare the active skills against the **Triggering and Routing Path** diagram.
    *   *Pass Condition*: The skill is not running as a "one-off" or "lone wolf." It must active-load and trigger its corresponding companion skills (e.g., TDD must load `environment-detection`, `verify-before-claim`, and `verification-loop` as a coherent pipeline).
3.  **Use Case Flowchart Verification (場景路徑對比)**:
    *   Compare the actual test run scenarios against the **Real-World Use Case Flowchart**.
    *   *Pass Condition*: The execution trajectory (including successful completion, error-recovery loops, or boundary tripping) precisely matches the flowchart's decision points.

### 4b. Conformance Test Matrix

| Task Trigger | Target Workflow File | Expected Integrated Workflow Chain |
|---|---|---|
| Bug fixing, writing unit tests | `docs/workflows/tdd.md` | `tdd` ➔ `environment-detection` ➔ `verify-before-claim` ➔ `verification-loop` |
| Save changes, prepare release | `docs/workflows/git-commit.md` | `git-commit` ➔ `rewrite-commits` ➔ `using-git-worktrees` ➔ `verification-loop` |
| Multi-agent setup, launcher | `docs/workflows/create-agent-launcher.md` | `fable-mode` ➔ `fable-discipline` ➔ `build-multi-agent-system` ➔ `create-agent-launcher` |
| System refactoring, design | `docs/workflows/improve-codebase-architecture.md` | `improve-codebase-architecture` ➔ `grill-with-docs` ➔ `grill-me` ➔ `fable-mode` |

### 4c. Interactive Verification Protocol

During live testing sessions, the Human Partner may execute the tier router on the given prompt:
```bash
node harness-everything/scripts/tier-router.js "<Task Prompt>"
```
*   **Verification Step**: Check that the console printout under `RECOMMENDED KNOWLEDGE GUIDES` lists the entire integrated chain from the matrix above.
*   **Actionable Check**: If any companion skill is missing from the active recommendations list, routing has failed. Ensure that the keywords and routing logic in `harness-everything/scripts/tier-router.js` have not drifted from the workflow maps.

---

## 4. Acceptance scorecard

Fill in per platform tested. A platform only "passes" if every row that
applies to it passes — partial credit isn't acceptance, it's a punch list.

| Check | Claude Code | Cursor | Copilot | Codex | Continue.dev | Hermes Agent |
|---|---|---|---|---|---|---|
| 1. Install artifact present | | N/A (mechanism) | N/A | N/A | N/A | N/A |
| 2a–2e. Mechanism checks | | N/A | N/A | N/A | N/A | N/A |
| BENCHMARK_SOP Test A (Tier 1) | | | | | | |
| BENCHMARK_SOP Test B (Tier 2) | | | | | | |
| BENCHMARK_SOP Test C (Tier 3) | | | | | | |
| BENCHMARK_SOP Test D (knowledge boundary) | | | | | | |
| BENCHMARK_SOP Test E (shell awareness) | | | | | | |
| Test F (fact-audit) | | | | | | |

Record the actual model output for any FAIL, not just pass/fail — a fix
needs to know what happened, not just that something didn't.

---

## 5. Harness System Verification Standards & Framework

This section defines the core standards and verification framework for evaluating this Harness System. Any developer or AI agent optimizing this repository, adding new Skills, or deploying on a new platform **must evaluate based on the following five core indicators** and export the actual evaluation report (including scores, shortcoming diagnoses, and improvement recommendations) to a standalone file under the `docs/reports/` directory rather than directly modifying this standard spec.

### 5a. Five Core Verification Criteria

1. **Skill Description Completeness**
   - **Key Verification**: Check if each `SKILL.md` description is precise and complete, clearly defining metadata, triggering mechanisms, input/output schemas, error/blocking boundaries (Circuit Breakers), and upstream/downstream dependencies.
   - **Rigor Rating Criteria**: Any skill that relies too heavily on vague natural language without clear constraints, lacks side-effect explanations, or misses boundary mechanisms will be penalized.

2. **Routing Accuracy**
   - **Key Verification**: Verify if `harness-everything/scripts/tier-router.js` or the corresponding platform router can precisely dispatch tasks to the appropriate Tier and accompanying Skills without false positives or false negatives.
   - **Rigor Rating Criteria**: Check if it relies purely on fragile keyword heuristic matching, if active workspace Git Diff stats introduce inappropriate noise for classification, and whether it can handle vague prompts or composite tasks.

3. **Test Coverage of All Skills**
   - **Key Verification**: Ensure that the automated tests (such as `npm test` or the local `eval-framework/runner.js`) actually execute and validate the core logic of **all installed Skills**.
   - **Rigor Rating Criteria**: If tests only check static syntax (`node --check`) without asserting behaviors, or if routing validation is merely tokenistic, the score will fall into the failing range.

4. **Configuration Balance (Light vs. Heavy)**
   - **Key Verification**: Assess whether the configuration on various platforms faces "excessively light" setups (purely advisory prompts that agents easily ignore) or "excessively heavy" setups (harsh blockages and frequent circuit breaks that severely damage model reasoning and development speed).
   - **Rigor Rating Criteria**: Check if capability asymmetries across platforms (Claude, Codex, Cursor, Copilot) are compensated reasonably and whether the system offers middle-ground, progressive constraints rather than a binary check.

5. **Workflow Conformance**
   - **Key Verification**: Validate if the agent's actual tool execution sequence completely aligns with the diagrams defined under `docs/workflows/` (e.g., TDD's red-green-refactor loop, Git-Commit's submission chain, etc.).
   - **Rigor Rating Criteria**: Check if the system has runtime mechanisms (Runtime Enforcement) to audit these transitions rather than merely treating them as documentation. Points are deducted if there is no state transition validation.

---

### 5b. Platform Feature Matrix Template

After performing actual testing on each platform, fill in the following support matrix:

| Feature         | Claude | Codex | Cursor | Copilot | Continue.dev | Hermes Agent |
| --------------- | ------ | ----- | ------ | ------- | ------------ | ------------ |
| Hook            |        |       |        |         |              |              |
| Runtime         |        |       |        |         |              |              |
| Prompt Guidance |        |       |        |         |              |              |
| Verification    |        |       |        |         |              |              |
| Behavior Test   |        |       |        |         |              |              |
| Auto Recovery   |        |       |        |         |              |              |

---

### 5c. Overall Scorecard Template

Assign ratings and scores for the following dimensions (e.g., ⭐⭐⭐⭐☆ 8.5/10), and provide detailed improvements in the standalone report:

| Category | Score | Deep Analysis & Improvement Directions |
| :--- | :---: | :--- |
| **Architecture** | /10 | |
| **README Completeness** | /10 | |
| **Maintainability** | /10 | |
| **Skills Design** | /10 | |
| **Agent Compatibility** | /10 | |
| **Beginner Friendliness** | /10 | |

---

## 6. Evaluation Report Export Guideline

When conducting a comprehensive quality audit of the system, **do not directly fill in the results within this specification document**.
1. Create a standalone Markdown file under the `docs/reports/` folder.
2. Naming convention: `evaluation-report-[model-name]-[YYYY-MM-DD].md` (e.g., `evaluation-report-gemini-3.1-pro-2026-07-21.md`).
3. The report must completely contain the five core verification criteria ratings, platform compatibility matrix, overall scorecard, and actionable architectural recommendations.

