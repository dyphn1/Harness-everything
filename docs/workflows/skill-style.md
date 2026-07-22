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

This diagram illustrates how `skill-style` is reached — as of the `skill-creator` split, it is no longer the first stop. `tier-router.js`'s `/\bskill\b|skill\.md|new skill|write a skill/` match now recommends `skill-creator` first (the full authoring/audit/testing workflow) and `skill-style` second (the terse Skill Contract table shape it builds on) — see `harness-everything/scripts/tier-router.js`.

```mermaid
graph LR
  Router["harness-everything / tier-router.js"] -->|Keyword: skill / skill.md / new skill| Creator["skill-creator / SKILL.md"]
  Creator -->|Builds on the table shape defined in| SkillStyle["skill-style / SKILL.md"]
  SkillStyle -->|Audits format correctness of| OtherSkills["Any SKILL.md in the workspace"]
  SkillStyle -->|Pre-PR validation gate integration| VerLoop["verification-loop / SKILL.md"]
```

---

## 3. Real-World Use Case Flowchart

§1 already walks the linear audit steps for a single file. This section instead shows the case that motivated splitting `skill-creator` out of this skill in the first place: a developer who needs the *fuller* workflow, not just the table shape.

```mermaid
graph TD
  Start["Developer: 'help me write a new skill for deploying to AWS'"] --> Router["tier-router.js recommends skill-creator + skill-style"]
  Router --> Creator["skill-creator: capture intent, draft, test against real prompts (§2)"]
  Creator --> StyleCheck["skill-style: does the draft's Skill Contract table match the required shape?"]
  StyleCheck -->|Missing/malformed table| Fix["Fix table shape per skill-style, re-run skill-creator's Quality Checklist"]
  StyleCheck -->|Table shape OK| Checklist["skill-creator §3 Quality Checklist: no-op / duplication / negation / progressive-disclosure checks"]
  Fix --> Checklist
  Checklist --> Register["Register in harness-everything §5 + tier-router.js (skill-creator §2 Step 4)"]
  Register --> Done([deploy-aws/SKILL.md committed, consistent with the rest of the repo])
```

---

## 4. Verification Check

To ensure that the `skill-style` skill is operating in strict compliance with Harness OS design laws, verify the following:

- [ ] **Physical Boundary Verification**: The skill boundaries are respected and do not leak context.
- [ ] **State Checkpoint Verification**: The active state is established, validated, and recorded at the beginning and end of each execution branch.
- [ ] **Cognitive Alignment**: The skill conforms to the **Think > Try > Summarize > Record** cognitive loop.
