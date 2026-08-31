#!/usr/bin/env node
const { execSync } = require('child_process');

// Keyword/guide tables live in the sibling routing-keywords.json, not inline
// here, so the Human Partner (or the LLM itself) can retune routing by
// editing data - no code changes, no re-install. It travels with this script
// on every install/update since it lives in the same skill folder. Fail open
// (empty tables) if it's missing or hand-edited into invalid JSON, so a bad
// edit degrades routing instead of breaking the hook.
function loadRoutingConfig() {
  const fallback = { tiers: { tier3: [], tier2: [] }, guideGroups: [], factAudit: { externalClaim: [], estimate: [] } };
  try {
    const raw = require('fs').readFileSync(require('path').join(__dirname, 'routing-keywords.json'), 'utf8');
    const parsed = JSON.parse(raw);
    return {
      tiers: parsed.tiers || fallback.tiers,
      guideGroups: Array.isArray(parsed.guideGroups) ? parsed.guideGroups : fallback.guideGroups,
      factAudit: parsed.factAudit || fallback.factAudit
    };
  } catch (err) {
    console.log(`[Tier Routing Pre-check] routing-keywords.json missing/invalid - falling back to Tier 1 default, no guides. (${err.message})`);
    return fallback;
  }
}

function run(userPrompt) {
  console.log(`[Tier Routing Pre-check]`);

  const promptLower = userPrompt.toLowerCase();
  const routingConfig = loadRoutingConfig();

  // Basic keyword heuristic (bilingual - the Human Partner often prompts in
  // Chinese, and an English-only net silently degrades to Tier 1 for them).
  // Deliberately NOT driven by the diff stats above: those measure what is
  // already sitting uncommitted in the tree - usually the PREVIOUS task's
  // leftovers - not the complexity of the task being asked for now.
  const TIER3_KEYWORDS = routingConfig.tiers.tier3 || [];
  const TIER2_KEYWORDS = routingConfig.tiers.tier2 || [];

  function matchKeyword(prompt, keyword) {
    const k = keyword.toLowerCase().trim();
    if (!k) return false;
    const isChineseOrMultiword = /[\u4e00-\u9fa5]/.test(k) || k.includes(' ') || k.includes('-');
    if (isChineseOrMultiword) {
      return prompt.includes(k);
    }
    const escaped = k.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&');
    return new RegExp(`\\b${escaped}\\b`, 'i').test(prompt);
  }

  function detectFableModel(prompt) {
    const match = prompt.match(/\bfable(?:[- ]mode)?\s+(?:on|with)\s+(haiku|sonnet|sonnect|opus)\b|\bfable-(haiku|sonnet|opus)\b/i);
    if (!match) return null;
    const requested = (match[1] || match[2]).toLowerCase();
    return requested === 'sonnect' ? 'sonnet' : requested;
  }

  let recommendedTier = "Tier 1 (Trivial)";
  let rationale = "No structural/testing signals in the prompt.";

  // Task-shape signals catch one-sentence audits and benchmarks that a flat
  // keyword list cannot see. They are intentionally kept here, rather than
  // mixed into the editable technology keyword table.
  const macroSignals = [
    /\b(?:every|each|all|entire|whole|full|complete)\s+(?:skill|skills|repo|repository|codebase|project|file|files|module|modules)/i,
    /\b(?:evaluate|audit|benchmark|stress[- ]test|ab test|a\/b test|compare)\b/i,
    /\b(?:repository[- ]wide|codebase[- ]wide|end[- ]to[- ]end)\b/i,
    /\b(?:multiple|several|four|fourteen|dozens)\s+(?:issues|skills|files|modules)/i,
    /(?:每個|每一個|所有|全部|整個|全套|逐一|多個|四個).*(?:skill|技能|檔案|問題|版本|基準|測試|評估|稽核|比較|壓力)/i,
    /(?:評估|稽核|基準|壓力測試|比較).*(?:每個|所有|全部|整個|全套|技能|skill|檔案|版本)/i
  ];
  const hasMacroSignal = macroSignals.some(signal => signal.test(userPrompt));
  const isTrivialDocsEdit = /^(?:(?:please|help me)\s+)?(?:fix|update|correct|change)\b.*\b(?:readme|documentation|docs?)\b.*\b(?:typo|spelling|wording|one line|single line)\b/i.test(userPrompt.trim());

  if (isTrivialDocsEdit) {
    // "update" is a common Tier 2 verb, but a one-line documentation typo
    // is still Tier 1. This override prevents a broad keyword from winning.
    recommendedTier = "Tier 1 (Trivial)";
    rationale = "Single documentation typo detected - direct edit, no checklist required.";
  } else if (hasMacroSignal || TIER3_KEYWORDS.some(k => matchKeyword(promptLower, k))) {
    recommendedTier = "Tier 3 (Macro Task)";
    rationale = "Prompt implies repository-wide scope, audit/benchmark work, architectural refactoring, or multi-agent collaboration.";
  } else if (TIER2_KEYWORDS.some(k => matchKeyword(promptLower, k))) {
    recommendedTier = "Tier 2 (Standard Task)";
    rationale = "Prompt implies development work needing TDD validation or multi-file coordination.";
  }

  // Structural complexity signals (not just keywords)
  // These help differentiate between simple and complex tasks within the same keyword tier
  const sentenceCount = userPrompt.split(/[.!?。！？]+/).filter(s => s.trim()).length;
  const hasMultipleTasks = /\b(and|also|then|additionally|plus|而且|還有|然後|另外|以及)\b/i.test(userPrompt);
  const mentionsSpecificFile = /\b(file|script|module|class|function|component)\b.*\.\w+/i.test(userPrompt);
  const hasQuestionMarks = /\?|？/.test(userPrompt);
  const hasMultipleSentences = sentenceCount > 2;

  // Adjust tier based on structural signals
  if (!hasMacroSignal && !isTrivialDocsEdit && hasMultipleTasks && hasMultipleSentences) {
    // Multiple tasks with multiple sentences suggests complexity
    if (recommendedTier.startsWith("Tier 1")) {
      recommendedTier = "Tier 2 (Standard Task)";
      rationale = "Multiple tasks detected with structural complexity - upgraded to Tier 2 for TDD validation.";
    } else if (recommendedTier.startsWith("Tier 2")) {
      // Keep at Tier 2 but note the complexity
      rationale += " Multiple task structure detected.";
    }
  } else if (!hasMacroSignal && mentionsSpecificFile && !hasMultipleTasks) {
    // Single file mention with no multiple tasks suggests simpler work
    if (recommendedTier.startsWith("Tier 3")) {
      recommendedTier = "Tier 2 (Standard Task)";
      rationale = "Single file focus detected - downgraded from Tier 3 to Tier 2.";
    }
  } else if (!hasMacroSignal && hasQuestionMarks && !hasMultipleTasks) {
    // Questions without multiple tasks are often advisory, not execution
    if (recommendedTier.startsWith("Tier 3")) {
      recommendedTier = "Tier 2 (Standard Task)";
      rationale = "Question format detected - likely advisory rather than macro execution.";
    }
  }

  console.log(`\n=> RECOMMENDED TIER: ${recommendedTier}`);
  console.log(`=> RATIONALE: ${rationale}`);

  // Base execution loop: Tier 2/3 must run on the todo-driven-workflow
  // checklist (Tier 1 is exempt to avoid checklist bloat on trivial edits).
  if (!recommendedTier.startsWith("Tier 1")) {
    console.log(`\n=> BASE EXECUTION LOOP: Load 'todo-driven-workflow' and initialize its checklist (3-7 verifiable sub-tasks) BEFORE editing any file.`);
    console.log(`   Track exactly ONE item in-progress at a time; verify with real evidence before marking completed.`);
  }

  const requestedFableModel = detectFableModel(promptLower);
  if (requestedFableModel) {
    console.log(`\n=> REQUESTED FABLE MODEL MODE: ${requestedFableModel}`);
    console.log(`=> ROUTE: fable-mode/fable-${requestedFableModel}/SKILL.md`);
    console.log(`   Resolve availability and record fallback status with fable-mode/scripts/model-selector.js.`);
  }

  // Analyze and output relevant Knowledge Guides / Templates based on user prompt keywords.
  // Each group comes from routing-keywords.json - matches via plain-substring
  // 'keywords' OR a 'regex' source string (tested case-insensitively).
  const recommendedGuides = [];

  for (const group of routingConfig.guideGroups) {
    let matched = false;
    if (typeof group.regex === "string") {
      matched = new RegExp(group.regex, "i").test(promptLower);
    } else if (Array.isArray(group.keywords)) {
      matched = group.keywords.some(k => promptLower.includes(k));
    }
    if (matched && Array.isArray(group.guides)) {
      recommendedGuides.push(...group.guides);
    }
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

  // ---------------------------------------------------------
  // SELF-EVOLVED DYNAMIC SKILLS AUTO-DISCOVERY & PRECISE MATCHING
  //
  // Deliberately generated[] only, not find-skills' downloaded skills:
  // generated[] is safe to cache-and-match here because Harness owns its
  // whole lifecycle (self-evolve authors it, skill-creator quality-gates it,
  // status is tracked draft/active/deprecated). A skill fetched via
  // `npx skills add` has none of that - caching its triggers/description at
  // download time would silently go stale the moment the upstream skill (or
  // a later `npx skills update`/`remove`) changes it. find-skills queries
  // `npx skills list` live instead of being folded into this cache.
  // ---------------------------------------------------------
  try {
    const fs = require('fs');
    const path = require('path');
    const userHome = process.env.HOME || process.env.USERPROFILE || '';

    // Skill installs land at varying depth per platform/scope (e.g.
    // <root>/.claude/skills/harness-everything/scripts/, <root>/.cursor/skills/...,
    // ~/.claude/skills/...), so a fixed __dirname offset can't reach the real
    // workspace root. Walk up from the invoking cwd to the nearest .git instead
    // - the same approach register-dynamic-skill.js already uses.
    function getWorkspaceRoot() {
      let dir = path.resolve(process.cwd());
      while (dir !== path.parse(dir).root) {
        if (fs.existsSync(path.join(dir, '.git'))) return dir;
        dir = path.dirname(dir);
      }
      return process.cwd();
    }
    const workspaceRoot = getWorkspaceRoot();

    const manifestPaths = [
      path.join(workspaceRoot, '.claude', 'harness-everything', 'manifest.json'),
      path.join(workspaceRoot, '.cursor', 'harness-everything', 'manifest.json'),
      path.join(workspaceRoot, '.github', 'harness-everything', 'manifest.json'),
      path.join(workspaceRoot, '.codex', 'harness-everything', 'manifest.json'),
      path.join(workspaceRoot, '.continue', 'harness-everything', 'manifest.json'),
      path.join(userHome, '.agents', 'harness-everything', 'manifest.json'),
      path.join(userHome, '.claude', 'harness-everything', 'manifest.json')
    ];

    const generatedSkills = new Map();
    for (const mPath of manifestPaths) {
      if (fs.existsSync(mPath)) {
        try {
          const manifestData = JSON.parse(fs.readFileSync(mPath, 'utf8'));
          if (Array.isArray(manifestData.generated)) {
            for (const s of manifestData.generated) {
              generatedSkills.set(s.id, s);
            }
          }
        } catch (err) {
          // ignore malformed manifests
        }
      }
    }

    const allDynamicSkills = Array.from(generatedSkills.values());
    const matchedDynamicSkills = [];

    for (const skill of allDynamicSkills) {
      let score = 0;
      const triggers = skill.triggers || [];
      
      for (const rawTrigger of triggers) {
        const trigger = rawTrigger.toLowerCase().trim();
        if (!trigger || trigger.length < 2) continue;
        
        // Ignore generic words to prevent false positives
        if (['the', 'and', 'for', 'with', 'your', 'this', 'that', 'some', 'from', 'prevent', 'resolved'].includes(trigger)) continue;
        
        const isChinese = /[\u4e00-\u9fa5]/.test(trigger);
        if (isChinese) {
          if (promptLower.includes(trigger)) {
            score += trigger.length * 2;
          }
        } else {
          // English word-boundary matching to prevent substrings inside larger words
          const escapedTrigger = trigger.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&');
          const regex = new RegExp(`\\b${escapedTrigger}\\b`, 'i');
          if (regex.test(promptLower)) {
            score += trigger.length >= 4 ? 3 : 1.5;
          }
        }
      }
      
      if (score >= 3) {
        matchedDynamicSkills.push({ skill, score });
      }
    }

    if (matchedDynamicSkills.length > 0) {
      matchedDynamicSkills.sort((a, b) => b.score - a.score);
      console.log(`\n=> 🎯 HIGH-RELEVANCE SELF-EVOLVED SKILL(S) DETECTED:`);
      matchedDynamicSkills.forEach(({ skill }) => {
        // Compute path relative to workspace or keep absolute
        let displayPath = skill.dirPath;
        if (displayPath.startsWith(workspaceRoot)) {
          displayPath = path.relative(workspaceRoot, displayPath);
        }
        console.log(`- ${displayPath}/SKILL.md (${skill.description} [DYNAMIC SKILL])`);
      });
    } else if (recommendedGuides.length === 0 && allDynamicSkills.length > 0) {
      // Prompt has no match in standard skills, and no direct match in dynamic skills,
      // but there are indeed dynamic skills in manifest.json. Suggest the LLM to inspect them!
      console.log(`\n=> ℹ️ UNMATCHED PROMPT HINT:`);
      console.log(`No standard or dynamic skills matched your prompt directly.`);
      console.log(`However, you have ${allDynamicSkills.length} self-evolved dynamic skill(s) registered in your manifest.json.`);
      console.log(`To ensure you don't miss past lessons, you should inspect the "generated" section of your manifest.json or check .claude/harness-everything/skills/generated/ to see if any apply to your current task.`);
      console.log(`If genuinely nothing covers this - including nothing already fetched via find-skills - load find-skills/SKILL.md: it checks "npx skills list" for anything already installed, then searches skills.sh/npx skills if not, and always requires explicit approval before installing anything.`);
    }
  } catch (err) {
    // Fail silently in router to prevent breaking the core execution loop
  }

  // Fact-audit nudge: broad, cheap keyword net for claims that risk being
  // asserted from stale/wrong training memory instead of verified. False
  // positives cost nothing here (it's a reminder, not a block) so recall
  // matters more than precision.
  const externalClaimTriggers = routingConfig.factAudit.externalClaim || [];
  const estimateTriggers = routingConfig.factAudit.estimate || [];
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
