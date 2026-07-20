# Workflow: Install Cognitive OS

> Automates the installation of the Agent Cognitive Loop (Think > Try > Summarize > Record) into the user's active workspace and environment configs.

---

## 1. Skill Behavior Workflow

This section visualizes how the `install-cognitive-os` skill executes internally, detailing the sequence of operations, state transitions, and evaluation steps.

```mermaid
graph TD
  Start([Bootstrap Hook Triggered]) --> DetectTargetEnv["Scan for active IDE / Client config paths"]
  DetectTargetEnv --> InjectAdvisoryRules["Append advisory rules to .cursorrules, .github/copilot-instructions.md, or AGENTS.md"]
  InjectAdvisoryRules --> InstallHooks["Configure Claude Code settings.json hook pre-flights"]
  InstallHooks --> DeployScripts["Deploy core bootstrap.js, self-heal.js, and tier-router.js scripts"]
  DeployScripts --> RunVerification["Execute self-heal audit test to confirm platform integrations"]
  RunVerification --> End([Harness cognitive guardrails fully established])
```

---

## 2. Triggering and Routing Path

This diagram illustrates how the `install-cognitive-os` skill is triggered through user requests or developer actions, and how it integrates or chains together with other companion skills in the Harness OS ecosystem to form unified workflows.

```mermaid
graph LR
  BootstrapCmd["Bootstrap CLI Command / npm install"] --> InstallSkill["install-cognitive-os / SKILL.md"]
  InstallSkill -->|Deploys core router script| Router["harness-everything / scripts / tier-router.js"]
  InstallSkill -->|Establishes memory loop configs for| Evolve["self-evolve / SKILL.md"]
  InstallSkill -->|Guards all file edits using| Todo["todo-driven-workflow / SKILL.md"]
```

---

## 3. Real-World Use Case Flowchart

Here we model concrete real-world scenarios and use cases of the `install-cognitive-os` skill, illustrating standard success paths, error handling, or recovery loops.

```mermaid
graph TD
  Start["Fresh repository checkout"] --> Trigger["Run 'node scripts/installer.js install --all --yes'"]
  Trigger --> Scan["Detects Cursor editor rules and GitHub action configurations"]
  Scan --> BuildAdvisory["Appends mandatory routing checkpoint and cognitive compliance blocks to .cursorrules"]
  BuildAdvisory --> CopySkills["Copies all 23 core skills into .cursor/skills/ and .github/skills/"]
  CopySkills --> CheckHeal["Runs preflight audit to confirm 100% path coverage"]
  CheckHeal --> Done([Harness OS environment setup is complete and active])
```

---

## 4. Verification Check

To ensure that the `install-cognitive-os` skill is operating in strict compliance with Harness OS design laws, verify the following:

- [ ] **Physical Boundary Verification**: The skill boundaries are respected and do not leak context.
- [ ] **State Checkpoint Verification**: The active state is established, validated, and recorded at the beginning and end of each execution branch.
- [ ] **Cognitive Alignment**: The skill conforms to the **Think > Try > Summarize > Record** cognitive loop.
