# Harness Philosophy

Harness is built on a single, core belief: **AI coding models are highly capable, but they struggle with self-regulation, attention drift, and environment awareness.** 

Instead of replacing the model or restricting it with heavy, opinionated frameworks that stifle creativity, Harness acts as a **behavioral runtime**—a lightweight, non-intrusive layer that guides, guards, and immunizes.

---

## The Core Philosophy: Intervene Only When Necessary

Many AI development frameworks attempt to fully control the model's execution flow. They use rigid DAGs, forced chains, or complex state machines. While this works for trivial, repetitive tasks, it destroys the model's creative problem-solving capability when tackling complex, novel engineering challenges.

Harness takes the opposite approach:

1. **Model Autonomy is Paramount:** The model should have full freedom to explore, choose its tools, and design its solution.
2. **Context-Driven Guidance:** Harness injects high-context, low-friction signals (via hooks, rules, and local preflight checks) rather than forcing rigid execution paths.
3. **Reactive Guardrails:** Harness remains completely silent and out of the way until a critical failure state is detected (e.g., repeating the same error 3 times, or context bloat reaching a dangerous threshold).
4. **Behavior-First, Not Prompt-First:** Harness is not a collection of static templates or "magic prompts." It is a dynamic runtime that reacts to terminal outcomes, git status, and actual workspace conditions.

---

## The 4 Pillars of AI Model Guidance

To keep agents aligned and productive, Harness operates across four distinct domains:

### 1. Environment Alignment (Discovery over Assumption)
AI models often hallucinate terminal environments or make incorrect assumptions about the host operating system, shells, or package managers (especially on Windows or within sandboxed shells). 
Harness forces a **Discovery** phase immediately upon session start. By auditing the environment beforehand, the model knows exactly what commands are safe to run, preventing wasted tokens on syntax trial-and-error.

### 2. Guardrails (The Circuit Breakers)
When a model gets stuck on a subtle bug or compiler error, its natural tendency is to make micro-adjustments repeatedly (the "infinite loop of trial-and-error"). 
Harness implements a **Circuit Breaker** (the `Rule of 3`). If the exact same failure occurs three times, Harness halts execution, "zooms out," and prompts the human partner for guidance, preserving your token budget and sanity.

### 3. Context Preservation (Anti-Bloat Protection)
As sessions grow, models often read too many large files or run commands that generate massive output, causing severe "Lost in the Middle" attention degradation. 
Harness acts as an informational dashboard that tracks active file counts and staging queues, proactively nudging the model to commit changes, clean the terminal, or compact its context.

### 4. Self-Evolution (Continuous Workspace Memory)
When a complex issue is resolved, the model should never have to solve it again. Harness abstracts the underlying root cause and permanently saves it to local workspace rules. On subsequent sessions, the model immediately imports these lessons, preventing regression.

---

## A Non-Intrusive Cognitive Amplifier

Harness does not run a heavy daemon, send your code to third-party APIs, or lock you into a proprietary ecosystem. It runs entirely locally within your project, acting as a quiet guardian that ensures your AI sessions are efficient, secure, and successful.
