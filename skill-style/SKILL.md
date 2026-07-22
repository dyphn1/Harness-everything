---
name: skill-style
description: Guidelines for writing and refactoring skills in the Harness ecosystem.
---

# Skill Style (Harness Ecosystem Skill Development Guidelines)

When you need to create a new Skill or refactor an existing one, strictly adhere to the writing style in this document to ensure all Skills seamlessly integrate into the `harness-everything` routing system and are mathematically enforced by scripts.

## 0. Triggers
This skill should be loaded when:
- Creating a new SKILL.md file.
- Refactoring or reviewing an existing SKILL.md file.

## 1. Structured Definition
Every Skill file (`SKILL.md`) MUST contain the following standard structure:

1.  **Title & Introduction**: Clearly state the purpose of this Skill.
2.  **📋 Skill Contract (CRITICAL)**: A strict Markdown table defining inputs, outputs, state mutations, and script gates. This replaces vague prose.
3.  **Triggers / Usage**: Explicitly tell the system when this skill applies.
4.  **Core Rules / Action List**: Specific, actionable commands tied to Terminal Scripts. Avoid vague suggestions.

### 📋 The Skill Contract Format
Every SKILL.md MUST include this table exactly:

```markdown
## 📋 Skill Contract

| Component | Specification |
| :--- | :--- |
| **Trigger / Input** | (What causes this skill to execute? What exact data/args does it expect?) |
| **Expected Output** | (What specific files, artifacts, or Terminal Exit Codes are produced?) |
| **State Mutations** | (What JSON/files are written to track progress? e.g., `.harness/todo-state.json`) |
| **Enforcement Gate** | (Which exact CLI script slaps the LLM with Exit Code 1 if it fails?) |
```

## 2. Tone & Voice
- **Anti-Linear / Anti-Prose**: Do not write long paragraphs. Map actions to specific `run_in_terminal` commands.
- **Absolute Imperatives**: Use "MUST", "MUST NOT", "ALWAYS". Do not use "suggest".
- **Script-Driven Enforcement**: Do not write "You should check your code". Write "You MUST run `node verify-gate.js`. If Exit Code 1, you MUST reflect and retry."

## 3. Avoid Functional Overlap
- **OS Skills vs. Domain Skills**: Distinguish between the OS layer (which routes and constrains behavior) and the Domain layer (which provides deep technical expertise).

## 4. For the fuller authoring & quality workflow, see `skill-creator`
This document is the terse format spec — the Skill Contract table shape and the tone rules. For interviewing intent, drafting, testing a skill against real prompts, pruning duplication/no-op/sprawl, and the rules for skills `self-evolve` generates dynamically mid-session, load `skill-creator/SKILL.md` instead. It builds on this spec rather than replacing it.
