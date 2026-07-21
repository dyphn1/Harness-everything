#!/usr/bin/env node
const { execSync } = require('child_process');

function run(userPrompt) {
  console.log(`[Tier Routing Pre-check]`);
  
  const promptLower = userPrompt.toLowerCase();

  // Basic keyword heuristic (bilingual - the Human Partner often prompts in
  // Chinese, and an English-only net silently degrades to Tier 1 for them).
  // Deliberately NOT driven by the diff stats above: those measure what is
  // already sitting uncommitted in the tree - usually the PREVIOUS task's
  // leftovers - not the complexity of the task being asked for now.
  const TIER3_KEYWORDS = ["architecture", "refactor", "rewrite the", "架構", "重構", "重寫"];
  const TIER2_KEYWORDS = ["test", "api", "integration", "endpoint", "測試", "整合", "端點", "介面"];

  let recommendedTier = "Tier 1 (Trivial)";
  let rationale = "No structural/testing signals in the prompt.";

  if (TIER3_KEYWORDS.some(k => promptLower.includes(k))) {
    recommendedTier = "Tier 3 (Macro Task)";
    rationale = "Prompt implies system-wide or architectural change.";
  } else if (TIER2_KEYWORDS.some(k => promptLower.includes(k))) {
    recommendedTier = "Tier 2 (Standard Task)";
    rationale = "Prompt implies development work needing TDD validation or multi-file coordination.";
  }

  console.log(`\n=> RECOMMENDED TIER: ${recommendedTier}`);
  console.log(`=> RATIONALE: ${rationale}`);

  // Base execution loop: Tier 2/3 must run on the todo-driven-workflow
  // checklist (Tier 1 is exempt to avoid checklist bloat on trivial edits).
  if (!recommendedTier.startsWith("Tier 1")) {
    console.log(`\n=> BASE EXECUTION LOOP: Load 'todo-driven-workflow' and initialize its checklist (3-7 verifiable sub-tasks) BEFORE editing any file.`);
    console.log(`   Track exactly ONE item in-progress at a time; verify with real evidence before marking completed.`);
  }

  // Analyze and output relevant Knowledge Guides / Templates based on user prompt keywords
  const recommendedGuides = [];

  const TDD_TEST_KEYWORDS = [
    "tdd", "test", "mock", "stub", "api", "endpoint", "integration", "debugging", "bug", "error", "fix",
    "測試", "單測", "模組測試", "端點", "介面", "除錯", "錯誤", "修復"
  ];
  if (TDD_TEST_KEYWORDS.some(k => promptLower.includes(k))) {
    recommendedGuides.push(
      "- tdd/SKILL.md (Test-Driven Development Red-Green-Refactor loop)",
      "- tdd/guides/mocking.md (Mocking principles & isolation)",
      "- tdd/guides/interface-design.md (Interface and contract design)",
      "- tdd/guides/deep-modules.md (Testing deep nested modules)",
      "- tdd/guides/tests.md (General test architecture)",
      "- environment-detection/SKILL.md (Detect active shell & preflight syntax to run tests safely)",
      "- verify-before-claim/SKILL.md (Validate test assertions with objective evidence)",
      "- verification-loop/SKILL.md (Run pre-PR quality checks: build, types, lint, tests)"
    );
  }

  const GIT_COMMIT_KEYWORDS = [
    "commit", "git", "save", "submodule", "pr", "pull request", "release", "quality gate", "ready to ship",
    "提交", "版控", "合併", "分支", "發行"
  ];
  if (GIT_COMMIT_KEYWORDS.some(k => promptLower.includes(k))) {
    recommendedGuides.push(
      "- git-commit/SKILL.md (Angular-style commit convention generation)",
      "- git-commit/guides/ANGULAR_STYLE.md (Commit conventions reference)",
      "- git-commit/guides/COMMIT_GENERATION.md (Commit generation patterns)",
      "- git-commit/guides/LANGUAGE_DETECTION.md (Multi-language commits)",
      "- git-commit/guides/MAIN_REPO.md (Commits in main repositories)",
      "- git-commit/guides/SUBMODULES.md (Submodule commit handling)",
      "- rewrite-commits/SKILL.md (Rewrite commit history safely to Angular style)",
      "- using-git-worktrees/SKILL.md (Git Worktrees isolation for multi-tasking)",
      "- verification-loop/SKILL.md (Pre-PR verification gate: build, lint, types, tests, security scan)"
    );
  }

  if (promptLower.includes("doc") || promptLower.includes("readme") || promptLower.includes("文件") || promptLower.includes("說明文件")) {
    recommendedGuides.push(
      "- repo-docs/templates/readme-template.md (Standard README template)",
      "- repo-docs/templates/product-readme-template.md (Product README template)",
      "- repo-docs/templates/agents-template.md (Agent onboarding instructions template)"
    );
  }

  const AGENT_KEYWORDS = [
    "agent", "multi-agent", "launcher", "subagent", "sub-agent", "delegate", "orchestrate", "specialist", 
    "workspace scaffolding", "scaffold workspace", "division of labor", "fable", "macro", "orchestrator",
    "代理", "多代理", "啟動器", "子代理", "委派", "指派", "分工", "協調", "任務分配", "規劃"
  ];
  if (AGENT_KEYWORDS.some(k => promptLower.includes(k))) {
    recommendedGuides.push(
      "- fable-mode/SKILL.md (Macro task planning & execution orchestrator)",
      "- fable-discipline/SKILL.md (Shadow guard preventing context bloat and managing token limits)",
      "- build-multi-agent-system/SKILL.md (Universal Multi-Agent Workspace scaffolding & memory db)",
      "- create-agent-launcher/SKILL.md (Sub-agent generator for specialized task delegation)",
      "- repo-docs/templates/agents-template.md (Agent onboarding instructions template)",
      "- grill-with-docs/SKILL.md (Decision tracking, Glossary & ADR-driven Grilling)"
    );
  }

  const ARCH_REFACTOR_KEYWORDS = [
    "refactor", "architecture", "structure", "couple", "seam", "adr", "design plan", "decision", "grill",
    "重構", "架構", "結構", "解耦", "設計", "決策", "辯論", "質疑"
  ];
  if (ARCH_REFACTOR_KEYWORDS.some(k => promptLower.includes(k))) {
    recommendedGuides.push(
      "- improve-codebase-architecture/guides/DEEPENING.md (Deepening opportunities & depth rules)",
      "- improve-codebase-architecture/guides/INTERFACE-DESIGN.md (Interface design principles)",
      "- improve-codebase-architecture/guides/LANGUAGE.md (Language-specific patterns)",
      "- improve-codebase-architecture/guides/HTML-REPORT.md (Mermaid dependency report generation)",
      "- grill-with-docs/SKILL.md (Decision tracking, Glossary & ADR-driven design grilling)",
      "- grill-me/SKILL.md (Challenger interview to stress-test your architecture plan)",
      "- fable-mode/SKILL.md (Fable execution framework for macro architectural rewrites)"
    );
  }

  const ENV_KEYWORDS = [
    "shell", "terminal", "powershell", "bash", "cmd", "env", "preflight", "command", "run",
    "終端機", "命令", "環境", "指令", "執行"
  ];
  if (ENV_KEYWORDS.some(k => promptLower.includes(k))) {
    recommendedGuides.push(
      "- environment-detection/SKILL.md (Active shell and environment detection, syntax guardrails)",
      "- using-git-worktrees/SKILL.md (Git Worktrees isolation for safe terminal environment testing)"
    );
  }

  const VERIFY_KEYWORDS = [
    "verify", "fact", "audit", "estimate", "benchmark", "performance", "speed", "scale",
    "驗證", "查證", "核對", "效能", "評測", "性能", "估計"
  ];
  if (VERIFY_KEYWORDS.some(k => promptLower.includes(k))) {
    recommendedGuides.push(
      "- verify-before-claim/SKILL.md (Fact-audit discipline: verify external claims and unmeasured estimates)",
      "- verification-loop/SKILL.md (Comprehensive pre-PR quality gate)",
      "- eval-harness/SKILL.md (AI performance evaluation metrics & anti-loop metrics)"
    );
  }

  if (/\bskill\b|skill\.md|new skill|write a skill/.test(promptLower)) {
    recommendedGuides.push(
      "- skill-style/SKILL.md (Style rules for authoring or modifying SKILL.md files in this repository)"
    );
  }

  if (recommendedGuides.length > 0) {
    console.log(`\n=> RECOMMENDED KNOWLEDGE GUIDES (Auto-loaded based on keywords):`);
    recommendedGuides.forEach(guide => {
      const match = guide.match(/^- ([^\s]+)/);
      if (match) {
        const guidePath = require('path').join(__dirname, '..', '..', match[1]);
        if (!require('fs').existsSync(guidePath)) {
          console.log(`${guide} [NOT INSTALLED - Ignore this recommendation]`);
          return;
        }
      }
      console.log(guide);
    });
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

  // Constraint strength must match judgment reliability: this routing is a
  // keyword heuristic, so it is a default, not an order.
  console.log(`\nTreat the tier above as the default route. If your own read of the task clearly disagrees, follow your read and say why in one line. An explicit instruction from the Human Partner always wins.`);
}

let userPrompt = process.argv[2] || '';

if (process.argv[2]) {
  // If a command-line argument is passed, use it and execute immediately.
  run(userPrompt);
} else if (process.stdin.isTTY) {
  // Running interactively in a terminal without piped input, execute immediately.
  run('');
} else {
  // Piped input or non-TTY, read from standard input.
  let inputData = '';
  process.stdin.on('data', chunk => { inputData += chunk; });
  process.stdin.on('end', () => {
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
}
