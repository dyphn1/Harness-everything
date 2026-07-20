# Workflow: Skill Style

> Guidelines and style rules for authoring, refactoring, and maintaining SKILL.md files to enforce clean frontmatter and logical boundaries.

---

## 1. Skill Behavior Workflow

This section visualizes how the `skill-style` skill executes internally, detailing the sequence of operations, state transitions, and evaluation steps.

```mermaid
graph TD
  Start([Authoring / Editing a SKILL.md]) --> ParseFrontmatter["Parse and validate YAML Frontmatter: name, description"]
  ParseFrontmatter --> ValidateBoundary["Check for explicit physical boundaries & state checkpoints"]
  ValidateBoundary --> VerifyCognitiveLoop["Verify integration with Cognitive Loop laws"]
  VerifyCognitiveLoop --> CheckFormatting["Ensure clean markdown layout and bullet-style rules"]
  CheckFormatting --> FormatApproved{Complies with STYLE.md?}
  FormatApproved -->|No| FixSkillFile["Refactor and clean file formatting"]
  FormatApproved -->|Yes| SaveSkillFile["Commit clean, validated SKILL.md"]
  FixSkillFile --> SaveSkillFile
  SaveSkillFile --> End([Skill document aligned with professional guidelines])
```

---

## 2. Triggering and Routing Path

This diagram illustrates how the `skill-style` skill is triggered through user requests or developer actions, and how it integrates or chains together with other companion skills in the Harness OS ecosystem to form unified workflows.

```mermaid
graph LR
  Router["harness-everything / tier-router.js"] -->|Keyword: skill / style / write skill| SkillStyle["skill-style / SKILL.md"]
  SkillStyle -->|Audits format correctness of| OtherSkills["Any SKILL.md in the workspace"]
  SkillStyle -->|Pre-PR validation gate integration| VerLoop["verification-loop / SKILL.md"]
```

---

## 3. Real-World Use Case Flowchart

Here we model concrete real-world scenarios and use cases of the `skill-style` skill, illustrating standard success paths, error handling, or recovery loops.

```mermaid
graph TD
  Start["Developer drafts a new custom skill 'deploy-aws/SKILL.md'"] --> Trigger["skill-style audits draft"]
  Trigger --> CheckFrontmatter["Finds missing YAML description and name headers"]
  CheckFrontmatter --> Refactor["Rewrites file: adds name/description YAML frontmatter, adds [State Checkpoint] section"]
  Refactor --> FormatCheck["Verifies markdown meets bullet conventions"]
  FormatCheck --> Done([Perfect deploy-aws/SKILL.md committed])
```

---

## 4. Verification Check

To ensure that the `skill-style` skill is operating in strict compliance with Harness OS design laws, verify the following:

- [ ] **Physical Boundary Verification**: The skill boundaries are respected and do not leak context.
- [ ] **State Checkpoint Verification**: The active state is established, validated, and recorded at the beginning and end of each execution branch.
- [ ] **Cognitive Alignment**: The skill conforms to the **Think > Try > Summarize > Record** cognitive loop.
