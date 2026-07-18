---
name: skill-style
description: Guidelines for writing and refactoring skills in the Harness ecosystem.
---

# Skill Style (Harness Ecosystem Skill Development Guidelines)

When you need to create a new Skill or refactor an existing one, strictly adhere to the writing style in this document (STYLE.md) to ensure all Skills seamlessly integrate into the `harness-everything` routing system.

## 0. Triggers
This skill should be loaded when:
- Creating a new SKILL.md file.
- Refactoring or reviewing an existing SKILL.md file.
- The user explicitly asks about skill style or guidelines.

## 1. Structured Definition
Every Skill file (`SKILL.md`) must contain the following standard structure:
1.  **Title & Introduction**: Clearly state the purpose of this Skill.
2.  **Triggers**: Explicitly tell the system (or single-entry router) under what conditions this skill should be loaded.
3.  **Core Rules / Action List**: Specific, actionable commands. Avoid vague suggestions.
4.  **Handoffs**: Define which Skill should take control after this Skill finishes, or when it encounters difficulties (e.g., call `zoom-out` when stuck).

## 2. Tone & Voice
- **Absolute Imperatives**: Use "MUST", "MUST NOT", "ALWAYS". Do not use "suggest" or "please consider".
- **Defensive Thinking**: Expect the Agent to make mistakes or be lazy, and write defensive boundaries into the rules (e.g., PROHIBITED from directly overwriting without checking the file first).

## 3. Avoid Functional Overlap (The Layered Approach)
- **OS Skills vs. Domain Skills**: Distinguish between the OS layer (which routes and constrains behavior) and the Domain layer (which provides deep technical expertise). 
- Do not bloat OS Skills with specific tech-stack rules.
- Instead, OS Skills should actively **delegate and load** Domain Skills (e.g., "Load `react-patterns` when touching frontend code") to ensure the system remains both structurally disciplined and technically comprehensive.

## 4. Cognitive Boundaries
- OS skills should not contain concrete business logic code, but rather **tell the Agent how to think and acquire** business logic.
- Domain skills are the opposite: they MUST provide concrete architectural patterns, vulnerability checklists, and code examples to restore the rich, robust capability of legacy setups.
