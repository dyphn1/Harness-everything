#!/usr/bin/env node
const { execSync } = require('child_process');

function getGitDiffStats() {
  if (process.env.HARNESS_EVAL === 'true') {
    return { files: 0, lines: 0 };
  }
  try {
    let files = 0;
    let lines = 0;

    const parseStats = (diffStat) => {
      if (!diffStat) return;
      diffStat.split('\n').forEach(line => {
        const [added, deleted] = line.split('\t');
        if (added && added !== '-' && deleted && deleted !== '-') {
          files += 1;
          lines += parseInt(added) + parseInt(deleted);
        }
      });
    };

    const staged = execSync('git diff --cached --numstat', { encoding: 'utf8' }).trim();
    parseStats(staged);
    
    const unstaged = execSync('git diff --numstat', { encoding: 'utf8' }).trim();
    parseStats(unstaged);
    
    return { files, lines };
  } catch (err) {
    return { files: 0, lines: 0 };
  }
}

const stats = getGitDiffStats();
const userPrompt = process.argv[2] || '';

console.log(`[Tier Routing Pre-check]`);
console.log(`- Staged Files Changed: ${stats.files}`);
console.log(`- Staged Lines Changed: ${stats.lines}`);

// Basic heuristic
let recommendedTier = "Tier 1 (Trivial)";
let rationale = "Very few changes staged and prompt is short.";

if (stats.files > 5 || stats.lines > 300 || userPrompt.toLowerCase().includes("architecture") || userPrompt.toLowerCase().includes("refactor")) {
  recommendedTier = "Tier 3 (Macro Task)";
  rationale = "Large number of files/lines changed, or prompt implies system-wide architectural changes.";
} else if (stats.files >= 2 || stats.lines >= 50 || userPrompt.toLowerCase().includes("test") || userPrompt.toLowerCase().includes("api")) {
  recommendedTier = "Tier 2 (Standard Task)";
  rationale = "Moderate changes requiring TDD validation or multi-file coordination.";
}

console.log(`\n=> REQUIRED TIER: ${recommendedTier}`);
console.log(`=> RATIONALE: ${rationale}`);

// Analyze and output relevant Knowledge Guides / Templates based on user prompt keywords
const promptLower = userPrompt.toLowerCase();
const recommendedGuides = [];

if (promptLower.includes("tdd") || promptLower.includes("test") || promptLower.includes("mock") || promptLower.includes("stub")) {
  recommendedGuides.push(
    "- tdd/guides/mocking.md (Mocking principles)",
    "- tdd/guides/interface-design.md (Interface and contract design)",
    "- tdd/guides/deep-modules.md (Testing deep nested modules)",
    "- tdd/guides/tests.md (General test architecture)",
    "- tdd/guides/refactoring.md (Refactoring safety)"
  );
}
if (promptLower.includes("commit") || promptLower.includes("git") || promptLower.includes("save") || promptLower.includes("submodule")) {
  recommendedGuides.push(
    "- git-commit/guides/ANGULAR_STYLE.md (Commit conventions)",
    "- git-commit/guides/COMMIT_GENERATION.md (Commit generation patterns)",
    "- git-commit/guides/LANGUAGE_DETECTION.md (Multi-language commits)",
    "- git-commit/guides/MAIN_REPO.md (Commits in main repositories)",
    "- git-commit/guides/SUBMODULES.md (Git submodule commit handling)",
    "- using-git-worktrees/SKILL.md (Git Worktrees isolation)"
  );
}
if (promptLower.includes("doc") || promptLower.includes("readme") || promptLower.includes("agent") || promptLower.includes("multi-agent")) {
  recommendedGuides.push(
    "- repo-docs/templates/readme-template.md (Standard README template)",
    "- repo-docs/templates/product-readme-template.md (Product README template)",
    "- repo-docs/templates/agents-template.md (Agent onboarding instructions template)",
    "- build-multi-agent-system/SKILL.md (Universal Multi-Agent Workspace scaffolding)",
    "- grill-with-docs/SKILL.md (Decision tracking, Glossary & ADR-driven Grilling)"
  );
}
if (promptLower.includes("refactor") || promptLower.includes("architecture") || promptLower.includes("structure") || promptLower.includes("couple") || promptLower.includes("seam")) {
  recommendedGuides.push(
    "- improve-codebase-architecture/guides/DEEPENING.md (Deepening opportunities & depth rules)",
    "- improve-codebase-architecture/guides/INTERFACE-DESIGN.md (Interface design principles)",
    "- improve-codebase-architecture/guides/LANGUAGE.md (Language-specific patterns)",
    "- improve-codebase-architecture/guides/HTML-REPORT.md (Mermaid report generation)",
    "- grill-with-docs/SKILL.md (Decision tracking, Glossary & ADR-driven Grilling)"
  );
}
if (promptLower.includes("shell") || promptLower.includes("terminal") || promptLower.includes("powershell") || promptLower.includes("bash") || promptLower.includes("cmd") || promptLower.includes("env") || promptLower.includes("preflight")) {
  recommendedGuides.push(
    "- environment-detection/SKILL.md (Active shell and environment detection, syntax guardrails)"
  );
}

if (recommendedGuides.length > 0) {
  console.log(`\n=> RECOMMENDED KNOWLEDGE GUIDES (Auto-loaded based on keywords):`);
  recommendedGuides.forEach(guide => console.log(guide));
}

console.log(`\nYou MUST route to this tier path unless explicitly overridden by the Human Partner.`);
