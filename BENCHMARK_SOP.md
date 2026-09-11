# Harness Skills Benchmark SOP

This guide helps you objectively test the performance difference between an AI Agent **with the Harness framework** and **without the Harness framework (Vanilla)**. You can switch between different underlying models (e.g., Haiku, Sonnet, Opus) to test whether the framework truly prevents "over-engineering" and breaks through the "reasoning ceiling".

**What this SOP does NOT test:** it compares emergent behavior (did the agent avoid the loop, did it stay in scope), not whether an underlying hook/plugin mechanism actually loaded, fired, or blocked anything. A well-behaved model can pass every scenario below even if a mechanism silently no-ops — that is why behavior evidence and mechanism/live-host evidence are tracked separately in [VERIFICATION.md](VERIFICATION.md).

Do not classify mechanism support by product name alone. A host can expose more than one Harness surface. For example, the general Codex installer path is instruction-oriented, while the **Codex / local OpenAI plugin** packages `SessionStart` and `UserPromptSubmit` invariant hooks; the public OpenAI **Skills-only** artifact does not include those local lifecycle hooks. OpenCode has a real plugin implementation with deterministic mechanism coverage, but live plugin loading remains unverified. Use [docs/platform-capabilities.md](docs/platform-capabilities.md) as the current source of truth.

This SOP is therefore a **behavior** benchmark. Pair it with the mechanism/package/live-host checks that apply to the exact installation surface under test before making an enforcement claim.

## Testing Process

To maintain controlled variables, please follow these steps for testing:

1. **Prepare the Test Environment**: Prepare a small project containing an intentionally flawed bug or requiring refactoring.
2. **Control Group (Vanilla Session)**:
   - Open a **clean session without Harness skills/runtime integration loaded**.
   - Provide the test task instructions (see scenarios below).
   - Record: Was it successful? How many Tokens (or steps) were used? Did it hit a dead end?
   - Export or preserve the conversation/session evidence required by your benchmark workflow.
3. **Experimental Group (Harness Session)**:
   - Open a session with the exact Harness installation surface being tested.
   - Provide the exact same test task instructions.
   - Record: Was it successful? How many Tokens were used? Which Harness skills/mechanisms were actually observed rather than merely expected?
   - Preserve the corresponding session evidence.
4. **Automated Scoring (Scoring)**:
   - Use `eval-harness` or the repository benchmark tooling to score the paired evidence against a declared rubric.

---

## Benchmark Scenarios (Test Scenarios)

### Test A: Over-engineering Test (Tier 1 Task)
- **Scenario**: The project has a `README.md` with an obvious spelling error ("Instalation" -> "Installation").
- **User Prompt**: "Help me fix the typo in the README."
- **Expected Difference**:
  - **Vanilla**: May over-read or over-plan relative to the tiny change.
  - **Harness**: Should classify this as a small task and prefer direct execution with only enough discovery/verification to support the final claim.

### Test B: Micro-Error Loop Defense Test (Tier 2 Task)
- **Scenario**: Provide a sorting algorithm containing a boundary condition error (e.g., crashing on empty arrays) and intentionally set a hard-to-spot logic error.
- **User Prompt**: "This sort function has a bug, help me fix it."
- **Expected Difference**:
  - **Vanilla**: May repeatedly micro-adjust the code after failed verification.
  - **Harness**: Should use evidence-driven debugging and verification. If the selected installation surface packages an automatic Rule-of-3 mechanism, repeated same-signature failures can trigger it mechanically; otherwise the same recovery principle is behavioral/advisory rather than an automatic hook claim. `tdd` may be selected when executable behavior benefits from it, but Tier 2 does not force TDD universally.

### Test C: Attention Loss and Hallucination Test (Tier 3 Task)
- **Scenario**: In a project without any defined interfaces, ask for a large-scale abstraction.
- **User Prompt**: "Refactor all database connections in this project into a Dependency Injection architecture."
- **Expected Difference**:
  - **Vanilla**: May read too broadly, lose constraints, or make unsupported architectural assumptions.
  - **Harness**: Should classify the work as broad/architectural, discover evidence before mutation, keep scope/decisions explicit, and gather verification evidence. `fable-mode`, `improve-codebase-architecture`, `grill-with-docs`, or multi-agent execution are possible tactics when useful; Tier 3 does not mandate one fixed chain.

### Test D: Knowledge Boundary and Hallucination Test (Knowledge Boundary Test)
- **Scenario**: Intentionally ask about current events unrelated to the project, e.g., "Updates on the Russia-Ukraine war", "Current US-China relations", "Who is the current US Secretary of State", "Latest on US-Iran conflicts".
- **User Prompt**: "Summarize the latest updates on the Russia-Ukraine war and US-China relations for me."
- **Expected Difference**:
  - **Vanilla**: May answer from stale assumptions or provide weakly grounded current claims.
  - **Harness**: The relevant evidence/knowledge-boundary discipline should make the agent recognize when current external verification is needed and avoid fabricating unavailable facts. Note that ordinary non-software web/Q&A may bypass the software-work kernel; this scenario tests evidence discipline rather than Tier routing.

### Test E: Environment & Tool Awareness Test (Terminal Detection)
- **Scenario**: The user is running a specific terminal on Windows (e.g., Git Bash instead of the default Command Prompt or PowerShell).
- **User Prompt**: "Run a terminal command to list all environment variables and save them to env_list.txt."
- **Expected Difference**:
  - **Vanilla**: May assume the default OS shell and choose incompatible syntax.
  - **Harness**: Should determine the execution environment before relying on shell-specific commands, then use syntax appropriate to the actual shell. Whether environment context is injected automatically or discovered explicitly depends on the installation surface under test.

---

## Reporting Rules

For each run, record at least:

- repository revision;
- model/host and exact Harness installation surface;
- scenario and prompt;
- success/failure plus objective task evidence;
- observed skill/mechanism events, clearly distinguishing expected behavior from trace evidence;
- token/step metrics when available;
- links/hashes for retained session evidence.

Do not turn a behavioral PASS into a statement such as "the hook fired" unless the trace proves that hook/plugin event. Likewise, a surface without a particular automatic gate is not a mechanism failure if [docs/platform-capabilities.md](docs/platform-capabilities.md) never claimed that gate was packaged there.
