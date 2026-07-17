# Harness Skills Benchmark SOP

This guide helps you objectively test the performance difference between an AI Agent **with the Harness framework** and **without the Harness framework (Vanilla)**. You can switch between different underlying models (e.g., Haiku, Sonnet, Opus) to test whether the framework truly prevents "over-engineering" and breaks through the "reasoning ceiling".

## Testing Process

To maintain controlled variables, please follow these steps for testing:

1. **Prepare the Test Environment**: Prepare a small project containing an intentionally flawed bug or requiring refactoring.
2. **Control Group (Vanilla Session)**:
   - Open a **clean session without any Skills loaded**.
   - Provide the test task instructions (see scenarios below).
   - Record: Was it successful? How many Tokens (or steps) were used? Did it hit a dead end?
   - Export the conversation log to `vanilla_log.md`.
3. **Experimental Group (Harness Session)**:
   - Open a session with **all Harness Skills loaded**.
   - Provide the exact same test task instructions.
   - Record: Was it successful? How many Tokens were used? Were `zoom-out` or `tdd` triggered?
   - Export the conversation log to `harness_log.md`.
4. **Automated Scoring (Scoring)**:
   - Paste both logs to an Agent with Harness loaded and input: `Please launch eval-harness to score these two tests.`

---

## Benchmark Scenarios (Test Scenarios)

### Test A: Over-engineering Test (Tier 1 Task)
- **Scenario**: The project has a `README.md` with an obvious spelling error ("Instalation" -> "Installation").
- **User Prompt**: "Help me fix the typo in the README."
- **Expected Difference**:
  - **Vanilla**: Might read `package.json` first, then write a Python script to search, or even spend 2000 tokens regenerating the entire README.
  - **Harness**: Should trigger Tier 1 (Direct Execution), use `[Discover]` only to verify the file exists, and then directly `replace_string_in_file`, consuming very few Tokens.

### Test B: Micro-Error Loop Defense Test (Tier 2 Task)
- **Scenario**: Provide a sorting algorithm containing a boundary condition error (e.g., crashing on empty arrays) and intentionally set a "hard-to-spot Regex or logic error".
- **User Prompt**: "This sort function has a bug, help me fix it."
- **Expected Difference**:
  - **Vanilla**: Will modify the code directly, find the test fails, tweak a line, fail again... entering a micro-modification dead end of 5~10+ iterations.
  - **Harness**: Triggers `tdd`. After confirming the error in the RED phase, if it gets stuck in the GREEN phase for 3 attempts, it automatically triggers the `zoom-out` circuit breaker, stopping token waste and reporting the architectural issue to you.

### Test C: Attention Loss and Hallucination Test (Tier 3 Task)
- **Scenario**: In a project without any defined interfaces, ask for a large-scale abstraction.
- **User Prompt**: "Refactor all database connections in this project into a Dependency Injection architecture."
- **Expected Difference**:
  - **Vanilla**: Reads 20 files at once, suffers Context Bloat, starts hallucinating non-existent packages, and ultimately breaks the entire project.
  - **Harness**: Triggers `fable-mode` and `improve-codebase-architecture`. Will `[Discover]` first, demand definition of Adapter boundaries, and may even trigger `grill-with-docs` to ensure Architectural Decision Records (ADR) are written before acting.

### Test D: Knowledge Boundary and Hallucination Test (Knowledge Boundary Test)
- **Scenario**: Intentionally ask about current events unrelated to the project, e.g., "Updates on the Russia-Ukraine war", "Current US-China relations", "Who is the current US Secretary of State", "Latest on US-Iran conflicts".
- **User Prompt**: "Summarize the latest updates on the Russia-Ukraine war and US-China relations for me."
- **Expected Difference**:
  - **Vanilla**: Highly likely to confidently hallucinate using outdated training data, randomly call Web Search tools without structure, or even write fake data directly into files.
  - **Harness**: Strongly constrained by the `install-cognitive-os` cognitive loop (Evidence Assertion and No Hallucinations). The Agent must clearly recognize its knowledge boundaries, determining a lack of information during the `[Think]` phase. If search tools are available, it will precisely plan queries before acting; if not, it will **firmly stop**, explicitly admit the inability to fetch the latest information, and refuse to fabricate answers.

### Test E: Environment & Tool Awareness Test (Terminal Detection)
- **Scenario**: The user is running a specific terminal on Windows (e.g., Git Bash instead of the default Command Prompt or PowerShell).
- **User Prompt**: "Run a terminal command to list all environment variables and save them to env_list.txt."
- **Expected Difference**:
  - **Vanilla**: Blindly assumes the default OS shell (e.g., assumes PowerShell on Windows and uses `Get-ChildItem Env: > env_list.txt`), resulting in command not found or syntax errors, followed by multiple confused retries.
  - **Harness**: Enforces the `[Discover]` phase. The Agent will first use safe commands (like `echo $SHELL` or check terminal type) to correctly identify that it is running in Git Bash, and then accurately execute the Linux-style command (`env > env_list.txt`) to succeed on the first try.
