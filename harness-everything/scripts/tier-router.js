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

function run(userPrompt) {
  const stats = getGitDiffStats();

  console.log(`[Tier Routing Pre-check]`);
  console.log(`- Staged Files Changed: ${stats.files}`);
  console.log(`- Staged Lines Changed: ${stats.lines}`);

  const promptLower = userPrompt.toLowerCase();

  // Basic heuristic
  let recommendedTier = "Tier 1 (Trivial)";
  let rationale = "Very few changes staged and prompt is short.";

  if (stats.files > 5 || stats.lines > 300 || promptLower.includes("architecture") || promptLower.includes("refactor")) {
    recommendedTier = "Tier 3 (Macro Task)";
    rationale = "Large number of files/lines changed, or prompt implies system-wide architectural changes.";
  } else if (stats.files >= 2 || stats.lines >= 50 || promptLower.includes("test") || promptLower.includes("api")) {
    recommendedTier = "Tier 2 (Standard Task)";
    rationale = "Moderate changes requiring TDD validation or multi-file coordination.";
  }

  console.log(`\n=> REQUIRED TIER: ${recommendedTier}`);
  console.log(`=> RATIONALE: ${rationale}`);

  // Base execution loop: Tier 2/3 must run on the todo-driven-workflow
  // checklist (Tier 1 is exempt to avoid checklist bloat on trivial edits).
  if (!recommendedTier.startsWith("Tier 1")) {
    console.log(`\n=> BASE EXECUTION LOOP: Load 'todo-driven-workflow' and initialize its checklist (3-7 verifiable sub-tasks) BEFORE editing any file.`);
    console.log(`   Track exactly ONE item in-progress at a time; verify with real evidence before marking completed.`);
  }

  // Analyze and output relevant Knowledge Guides / Templates based on user prompt keywords
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
  if (promptLower.includes("verify") || promptLower.includes("fact") || promptLower.includes("audit")) {
    recommendedGuides.push(
      "- verify-before-claim/SKILL.md (Fact-audit discipline: verify external claims and unmeasured estimates before asserting them)"
    );
  }
  if (/\bpr\b|pull request|release|quality gate|ready to ship|verification/.test(promptLower)) {
    recommendedGuides.push(
      "- verification-loop/SKILL.md (Pre-PR quality gates: build, types, lint, tests, security scan, diff review)"
    );
  }
  if (/\bskill\b|skill\.md|new skill|write a skill/.test(promptLower)) {
    recommendedGuides.push(
      "- skill-style/SKILL.md (Style rules for authoring or modifying SKILL.md files in this repository)"
    );
  }

  if (recommendedGuides.length > 0) {
    console.log(`\n=> RECOMMENDED KNOWLEDGE GUIDES (Auto-loaded based on keywords):`);
    recommendedGuides.forEach(guide => console.log(guide));
  }

  // Fact-audit nudge: broad, cheap keyword net for claims that risk being
  // asserted from stale/wrong training memory instead of verified. False
  // positives cost nothing here (it's a reminder, not a block) so recall
  // matters more than precision.
  const externalClaimTriggers = [
    "does it support", "does support", "how does", "what's the default", "what is the default",
    "exit code", "schema", "sdk", " api", "hook", "payload", "pricing", "rate limit",
    "latest version", "current version", "deprecated", "breaking change", "changelog",
    "spec", "documentation", "according to", "endpoint", "config option", "flag"
  ];
  const estimateTriggers = [
    "benchmark", "performance", "how fast", "how long will", "how much memory",
    "how many requests", "estimate", "roughly how", "big o", "complexity",
    "will this scale", "throughput", "latency"
  ];
  const hitExternalClaim = externalClaimTriggers.some(kw => promptLower.includes(kw));
  const hitEstimate = estimateTriggers.some(kw => promptLower.includes(kw));

  if (hitExternalClaim || hitEstimate) {
    console.log(`\n=> FACT-AUDIT REMINDER:`);
    if (hitExternalClaim) {
      console.log(`This looks like it may require a claim about an external framework/library/API/tool's current behavior.`);
      console.log(`Verify via WebFetch/WebSearch against the authoritative source before asserting it - do not answer from training memory alone; it can be stale or confidently wrong (e.g. exit-code semantics, schema fields, defaults, pricing).`);
    }
    if (hitEstimate) {
      console.log(`This looks like it may call for a performance/cost/timing number.`);
      console.log(`Prefer an actual measurement over a reasoned estimate when the stakes justify it - an unmeasured number (including one you generate yourself) is a hypothesis, not a fact.`);
    }
  }

  console.log(`\nYou MUST route to this tier path unless explicitly overridden by the Human Partner.`);
}

let inputData = '';
process.stdin.on('data', chunk => { inputData += chunk; });
process.stdin.on('end', () => {
  let userPrompt = process.argv[2] || '';
  try {
    if (inputData.trim()) {
      const payload = JSON.parse(inputData);
      if (typeof payload.prompt === 'string') userPrompt = payload.prompt;
    }
  } catch (err) {
    // Not valid JSON on stdin - fall back to argv (useful for direct/manual testing).
  }
  run(userPrompt);
});
