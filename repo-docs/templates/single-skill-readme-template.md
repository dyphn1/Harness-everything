---
name: "single-skill-readme-template"
description: "README template for a repository that hosts a single, complex AI skill. Focuses on usage, workflows, generated artifacts, and supplementary resources."
---

# {Skill Name}

> {One-line description from SKILL.md YAML frontmatter}

<!-- Optional: Badges for version, license, status -->
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

## Overview

{2–3 sentences explaining what this skill does, what problem it solves, and why a user would invoke it.}

---

## Usage

Invoke the skill in GitHub Copilot Chat (or your preferred AI agent) with a prompt like:

- "{Trigger phrase 1 from description}"
- "{Trigger phrase 2}"
- "{Trigger phrase 3}"

---

## How it Works (Workflow)

When invoked, the skill automatically executes the following steps:

1. **{Step 1 Title}**: {Brief human-readable summary of what the AI does first}
2. **{Step 2 Title}**: {Summary of the next action}
3. **{Step 3 Title}**: {Summary of the next action}

*(See the `SKILL.md` file for the exact machine-readable instructions.)*

---

## Key Rules & Constraints

- **{Constraint 1}**: {e.g., "All submodules must be fully processed before the main repository."}
- **{Constraint 2}**: {e.g., "Existing files are never overwritten without explicit confirmation."}

---

## Resources & File Structure

This skill utilizes supplementary context files to guide the AI's behavior:

```
.
├── SKILL.md                   # Core AI instructions and workflow definition
├── {supplementary_file.md}    # {Brief description of what this file provides to the AI}
├── examples/                  
│   └── {example_file.md}      # {Description of the example}
└── guidelines/                
    └── {guideline_file.md}    # {Description of the guideline}
```

---

## Contributing

Open a PR to update the core workflow in `SKILL.md`, or to add new edge cases to the `examples/` directory. 

## License

Apache 2.0 — see [LICENSE](LICENSE) for details.
