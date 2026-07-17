---
name: skill-style
description: Guidelines for writing and refactoring skills in the Harness ecosystem.
---

# Skill Style (Harness Ecosystem Skill Development Guidelines)

When you need to create a new Skill or refactor an existing one, strictly adhere to the writing style in this document (STYLE.md) to ensure all Skills seamlessly integrate into the `harness-everything` routing system.

## 1. Structured Definition
Every Skill file (`SKILL.md`) must contain the following standard structure:
1.  **Title & Introduction**: Clearly state the purpose of this Skill.
2.  **Triggers**: Explicitly tell the system (or single-entry router) under what conditions this skill should be loaded.
3.  **Core Rules / Action List**: Specific, actionable commands. Avoid vague suggestions.
4.  **Handoffs**: Define which Skill should take control after this Skill finishes, or when it encounters difficulties (e.g., call `zoom-out` when stuck).

## 2. Tone & Voice
- **Absolute Imperatives**: Use "MUST", "MUST NOT", "ALWAYS". Do not use "suggest" or "please consider".
- **Defensive Thinking**: Expect the Agent to make mistakes or be lazy, and write defensive boundaries into the rules (e.g., PROHIBITED from directly overwriting without checking the file first).

## 3. Avoid Functional Overlap
- Before adding a new Skill, check if it can be integrated into the existing `harness-everything` workflow.
- Skills should be high-cohesion and low-coupling; each Skill should only do one thing well.

## 4. Cognitive Boundaries
- The skill itself should not contain concrete business logic code, but rather **tell the Agent how to think and acquire** business logic.
- For example: Do not hardcode React best practices in the Skill; instead, write "When developing React components, you MUST first read the UI guidelines document in the project."
