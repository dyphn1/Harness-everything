# Workflow: Repo Docs

> Creates or refreshes reader-focused README.md and AGENTS.md from real repository scans, carefully blending discovered facts with existing custom notes for projects missing docs or needing better agent onboarding.

Source of truth: `repo-docs/SKILL.md`.

## 1. Skill Behavior Workflow

```mermaid
graph TD
  MissingDocs["Input: missing docs or request to update README.md and AGENTS.md"] --> ScanConfigs["Scan configs such as package.json and Cargo.toml as Source of Truth; never fabricate"]
  ScanConfigs --> ReadExisting["Read existing docs fully first; extract bespoke notes: env vars, URLs, gotchas"]
  ReadExisting --> PickTemplate["Pick template from repo-docs/templates/ else built-in structure"]
  PickTemplate --> DraftDocs["Draft README as user journey; AGENTS.md as conventions and build/test commands"]
  DraftDocs --> VerifyCmds["Verify commands run; mark doubts with TODO Pending confirmation; ask via grill-me"]
  VerifyCmds --> WriteRoot["Write to root; if protected use .github/AGENTS.md or docs/README.md"]
```

## 2. Triggering and Routing Path

```mermaid
graph LR
  UndocProject["Trigger: undocumented project needs README"] --> RepoDocs["repo-docs / SKILL.md"]
  StructuralChange["Trigger: structural change needs AGENTS.md refresh"] --> RepoDocs
  RepoDocs --> GrillMe["grill-me: clarify doubts marked TODO Pending confirmation"]
  RepoDocs --> WriteOut["Write README.md and AGENTS.md to root or fallback locations"]
```

## 3. Real-World Use Case

```mermaid
graph TD
  BareRepo["New TypeScript utility package with no onboarding docs"] --> ScanProj["Scan package.json and directory tree"]
  ScanProj --> PreserveNotes["Read existing stub docs; preserve custom env vars and gotchas"]
  PreserveNotes --> SelectTemplate["Select library README template from repo-docs/templates/"]
  SelectTemplate --> MergeDraft["Merge scan facts plus bespoke notes into README journey and AGENTS conventions"]
  MergeDraft --> VerifyStep["Verify build and test commands; mark unconfirmed items TODO Pending confirmation"]
  VerifyStep --> PublishDocs["Write README.md and AGENTS.md to root or fallback"]
```

Concrete example: an undocumented utility repo is scanned for its real entry points and scripts, its bespoke environment notes are preserved, a template from `repo-docs/templates/` shapes the draft, commands are verified, and the merged README and AGENTS files are written without blind overwrites.

Deep detail: `repo-docs/references/process-guide.md`.

## 4. Verification Check

- [ ] Configs scanned as Source of Truth; no facts fabricated without repo evidence
- [ ] Existing docs read fully first; bespoke notes preserved and never overwritten blindly
- [ ] Template picked from `repo-docs/templates/` or built-in structure applied
- [ ] `README.md` covers the user journey; `AGENTS.md` covers conventions and build/test commands
- [ ] Commands verified to run; unresolved doubts marked `// TODO: Pending confirmation` and clarified with `grill-me`
- [ ] Written to root, or to `<workspace>/.github/AGENTS.md` and `<workspace>/docs/README.md` when root is protected
- [ ] Not used for marketing copy, fabrication without scanning, or non-repository wikis
