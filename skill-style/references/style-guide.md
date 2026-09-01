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
Every path a `SKILL.md` names is checked by `node <skills-repo-root>/ci/reference-check.js`. A path is **relative to the file that names it** - that is the default and needs no ceremony. Only a base that is not the current file's directory takes a marker.

| Form | Base | Checked? |
| :--- | :--- | :--- |
| `references/x.md`, `./x.md`, `../x.md` | this skill's own directory | yes |
| `skill-creator/SKILL.md` | another skill, named directly | yes |
| `<skills-repo-root>/hooks/x.js` | the root of this package | yes |
| `<workspace>/anywhere/x.md` | a path in the USER's project | no - recorded as intentional |
| `tasks/`, `memories/`, `specs/`, `docs/`, `evals/`, `.claude/`, `.github/`, `.cursor/`, `.codex/`, `.continue/` | the USER's project, by published namespace | no |

- **MUST** mark a path outside the skill's own directory. There is no allowlist of top-level names promoting a path to the repo root: `ci/x.js` is this skill's `ci/`. Write `<skills-repo-root>/ci/x.js` when you mean the package root.
- **MUST NOT** invent a new placeholder. An unrecognised one is a hard failure, not a skip - a typo like `<this_folder>/` would otherwise make every path in the file invisible to the gate. Register a genuinely new one in `<skills-repo-root>/ci/reference-check.js`.
- Use `<workspace>/` for a user-project path outside the published namespaces above. It always wins over any other rule.
- **Markers cost tokens** against the 500-token `waza` hard limit, so spend them only where the base actually differs. The bare relative form is both the default and the cheapest.
- A bare filename with no directory (`CONTEXT.md`, `package.json`) is prose and stays unchecked. Give it a directory when you mean a specific file.

## 4. Avoid Functional Overlap
- **OS Skills vs. Domain Skills**: Distinguish between the OS layer (which routes and constrains behavior) and the Domain layer (which provides deep technical expertise).

## 5. For the fuller authoring & quality workflow, see `skill-creator`
This document is the terse format spec — the Skill Contract table shape and the tone rules. For interviewing intent, drafting, testing a skill against real prompts, pruning duplication/no-op/sprawl, and the rules for skills `self-evolve` generates dynamically mid-session, load `skill-creator/SKILL.md` instead. It builds on this spec rather than replacing it.
