# Skill Style Guide — Full Detail

When you need to create a new Skill or refactor an existing one, strictly adhere to the writing style in this document to ensure all Skills seamlessly integrate into the `harness-everything` routing system and are mathematically enforced by scripts.

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
| **State Mutations** | (What JSON/files are written to track progress? e.g., a stage audit JSONL file under `.claude/harness-everything/state/`) |
| **Enforcement Gate** | (Which exact CLI script slaps the LLM with Exit Code 1 if it fails?) |
```

## 2. Tone & Voice
- **Anti-Linear / Anti-Prose**: Do not write long paragraphs. Map actions to specific `run_in_terminal` commands.
- **Absolute Imperatives**: Use "MUST", "MUST NOT", "ALWAYS". Do not use "suggest".
- **Script-Driven Enforcement**: Do not write "You should check your code". Write "You MUST run `node <skills-repo-root>/harness-everything/scripts/verify-gate.js`. If Exit Code 1, you MUST reflect and retry."

## 3. Path Notation
Every path a `SKILL.md` names is checked by `node <skills-repo-root>/ci/reference-check.js`. Every checked path MUST name its base explicitly: use `<this-skill-dir>/` for the skill that names it, `<skills-repo-root>/` for this package, and `<workspace>/` for the user's project.

| Form | Base | Checked? |
| :--- | :--- | :--- |
| `<this-skill-dir>/references/x.md`, `<this-skill-dir>/../x.md` | this skill's own directory | yes |
| `<skills-repo-root>/skill-creator/SKILL.md` | another skill in this package | yes |
| `<skills-repo-root>/hooks/x.js` | the root of this package | yes |
| `<workspace>/anywhere/x.md` | a path in the USER's project | no - recorded as intentional |

- **MUST** use one of the three markers. Bare `references/x.md`, `../x.md`, or `ci/x.js` is a hard failure, not a guess.
- **MUST NOT** invent a new placeholder. An unrecognised one is a hard failure, not a skip - a typo like `<this_folder>/` would otherwise make every path in the file invisible to the gate. Register a genuinely new one in `<skills-repo-root>/ci/reference-check.js`.
- Use `<workspace>/` for every user-project path. It always wins over any package rule.
- Markers cost words, but explicit bases prevent a top-level directory from silently changing a path's meaning. Keep the top-level body short and put explanation in the workflow or references rung.
- A bare filename with no directory (`CONTEXT.md`, `package.json`) is prose and stays unchecked. Give it a directory when you mean a specific file.

## 4. Progressive Disclosure

Keep each skill in three clear rungs:

1. `SKILL.md` contains the trigger, contract, short imperative workflow, `USE FOR`/`DO NOT USE FOR`, and one valid `Deep dive:` entry point. Keep its body at or below 330 words, the local proxy for waza's 500-token limit.
2. `docs/workflows/<skill>.md` explains the same workflow in plain language. It must contain at least one meaningful Mermaid diagram showing a real sequence, state change, or decision. Complex workflows need separate diagrams for distinct branches; repeated decorative graphs do not count.
3. `references/` or `guides/` holds detailed procedures, examples, and checklists. Load these files only when the task reaches that detail.

Do not put Mermaid source in `SKILL.md`, copy a full guide into the top-level file, or change a `description:` during a content-only rewrite. The description is a routing API and must remain byte-identical unless a routing change is intentional.

## 5. Avoid Functional Overlap
- **OS Skills vs. Domain Skills**: Distinguish between the OS layer (which routes and constrains behavior) and the Domain layer (which provides deep technical expertise).

## 6. For the fuller authoring & quality workflow, see `skill-creator`
This document is the terse format spec — the Skill Contract table shape and the tone rules. For interviewing intent, drafting, testing a skill against real prompts, pruning duplication/no-op/sprawl, and the rules for skills `self-evolve` generates dynamically mid-session, load `skill-creator/SKILL.md` instead. It builds on this spec rather than replacing it.
