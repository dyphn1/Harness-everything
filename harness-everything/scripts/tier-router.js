#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const {
  buildRouterContract,
  writeRouterContract,
} = require('./router-contract');

const DEFAULT_ROUTING_CONFIG = {
  tiers: { tier3: [], tier2: [] },
  guideGroups: [],
  factAudit: { externalClaim: [], estimate: [] },
};

function loadRoutingConfig() {
  const configPath = process.env.HARNESS_ROUTING_CONFIG_PATH || path.join(__dirname, 'routing-keywords.json');
  try {
    const raw = fs.readFileSync(configPath, 'utf8');
    const parsed = JSON.parse(raw);
    return {
      config: {
        tiers: parsed.tiers || DEFAULT_ROUTING_CONFIG.tiers,
        guideGroups: Array.isArray(parsed.guideGroups) ? parsed.guideGroups : DEFAULT_ROUTING_CONFIG.guideGroups,
        factAudit: parsed.factAudit || DEFAULT_ROUTING_CONFIG.factAudit,
      },
      routingStatus: 'ok',
      reasonCodes: [],
    };
  } catch (err) {
    console.log(`[Tier Routing Pre-check] routing-keywords.json missing/invalid - routing is degraded; no silent Tier 1 fallback. (${err.message})`);
    return {
      config: DEFAULT_ROUTING_CONFIG,
      routingStatus: 'degraded',
      reasonCodes: ['routing-config-invalid'],
    };
  }
}

function matchKeyword(prompt, keyword) {
  const k = keyword.toLowerCase().trim();
  if (!k) return false;
  const isChineseOrMultiword = /[\u4e00-\u9fa5]/.test(k) || k.includes(' ') || k.includes('-');
  if (isChineseOrMultiword) return prompt.includes(k);
  const escaped = k.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&');
  return new RegExp(`\\b${escaped}\\b`, 'i').test(prompt);
}

function detectFableModel(prompt) {
  const match = prompt.match(/\bfable(?:[- ]mode)?\s+(?:on|with)\s+(haiku|sonnet|sonnect|opus)\b|\bfable-(haiku|sonnet|opus)\b/i);
  if (!match) return null;
  const requested = (match[1] || match[2]).toLowerCase();
  return requested === 'sonnect' ? 'sonnet' : requested;
}

function addReason(reasonCodes, code) {
  if (code && !reasonCodes.includes(code)) reasonCodes.push(code);
}

function emitDynamicSkills(promptLower, context, recommendedGuides) {
  try {
    const userHome = process.env.HOME || process.env.USERPROFILE || '';
    const { getWorkspaceRoot } = require('../../scripts/lib/workspace');
    const workspaceRoot = getWorkspaceRoot(context);

    const manifestPaths = [
      path.join(workspaceRoot, '.claude', 'harness-everything', 'manifest.json'),
      path.join(workspaceRoot, '.cursor', 'harness-everything', 'manifest.json'),
      path.join(workspaceRoot, '.github', 'harness-everything', 'manifest.json'),
      path.join(workspaceRoot, '.codex', 'harness-everything', 'manifest.json'),
      path.join(workspaceRoot, '.continue', 'harness-everything', 'manifest.json'),
      path.join(userHome, '.agents', 'harness-everything', 'manifest.json'),
      path.join(userHome, '.claude', 'harness-everything', 'manifest.json'),
    ];

    const generatedSkills = new Map();
    for (const manifestPath of manifestPaths) {
      if (!fs.existsSync(manifestPath)) continue;
      try {
        const manifestData = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
        if (Array.isArray(manifestData.generated)) {
          for (const skill of manifestData.generated) generatedSkills.set(skill.id, skill);
        }
      } catch (err) {
        // Ignore malformed generated-skill manifests; they are advisory only.
      }
    }

    const allDynamicSkills = Array.from(generatedSkills.values());
    const matchedDynamicSkills = [];

    for (const skill of allDynamicSkills) {
      let score = 0;
      for (const rawTrigger of skill.triggers || []) {
        const trigger = rawTrigger.toLowerCase().trim();
        if (!trigger || trigger.length < 2) continue;
        if (['the', 'and', 'for', 'with', 'your', 'this', 'that', 'some', 'from', 'prevent', 'resolved'].includes(trigger)) continue;

        if (/[\u4e00-\u9fa5]/.test(trigger)) {
          if (promptLower.includes(trigger)) score += trigger.length * 2;
        } else {
          const escapedTrigger = trigger.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&');
          const regex = new RegExp(`\\b${escapedTrigger}\\b`, 'i');
          if (regex.test(promptLower)) score += trigger.length >= 4 ? 3 : 1.5;
        }
      }
      if (score >= 3) matchedDynamicSkills.push({ skill, score });
    }

    if (matchedDynamicSkills.length > 0) {
      matchedDynamicSkills.sort((a, b) => b.score - a.score);
      console.log(`\n=> 🎯 HIGH-RELEVANCE SELF-EVOLVED SKILL(S) DETECTED:`);
      matchedDynamicSkills.forEach(({ skill }) => {
        let displayPath = skill.dirPath;
        if (displayPath.startsWith(workspaceRoot)) displayPath = path.relative(workspaceRoot, displayPath);
        console.log(`- ${displayPath}/SKILL.md (${skill.description} [DYNAMIC SKILL])`);
      });
    } else if (recommendedGuides.length === 0 && allDynamicSkills.length > 0) {
      console.log(`\n=> ℹ️ UNMATCHED PROMPT HINT:`);
      console.log(`No standard or dynamic skills matched your prompt directly.`);
      console.log(`However, you have ${allDynamicSkills.length} self-evolved dynamic skill(s) registered in your manifest.json.`);
      console.log(`To ensure you don't miss past lessons, you should inspect the "generated" section of your manifest.json or check .claude/harness-everything/skills/generated/ to see if any apply to your current task.`);
      console.log(`If genuinely nothing covers this - including nothing already fetched via find-skills - load find-skills/SKILL.md: it checks "npx skills list" for anything already installed, then searches skills.sh/npx skills if not, and always requires explicit approval before installing anything.`);
    }
  } catch (err) {
    // Dynamic-skill discovery is advisory and must never break core routing.
  }
}

function run(userPrompt, context) {
  console.log(`[Tier Routing Pre-check]`);

  const promptLower = userPrompt.toLowerCase();
  const loadedConfig = loadRoutingConfig();
  const routingConfig = loadedConfig.config;
  const TIER3_KEYWORDS = routingConfig.tiers.tier3 || [];
  const TIER2_KEYWORDS = routingConfig.tiers.tier2 || [];

  const macroSignals = [
    /\b(?:every|each|all|entire|whole|full|complete)\s+(?:skill|skills|repo|repository|codebase|project|file|files|module|modules)/i,
    /\b(?:evaluate|audit|benchmark|stress[- ]test|ab test|a\/b test|compare)\b/i,
    /\b(?:repository[- ]wide|codebase[- ]wide|end[- ]to[- ]end)\b/i,
    /\b(?:multiple|several|four|fourteen|dozens)\s+(?:issues|skills|files|modules)/i,
    /(?:每個|每一個|所有|全部|整個|全套|逐一|多個|四個).*(?:skill|技能|檔案|問題|版本|基準|測試|評估|稽核|比較|壓力)/i,
    /(?:評估|稽核|基準|壓力測試|比較).*(?:每個|所有|全部|整個|全套|技能|skill|檔案|版本)/i,
  ];
  const hasMacroSignal = macroSignals.some(signal => signal.test(userPrompt));
  const isTrivialDocsEdit = /^(?:(?:please|help me)\s+)?(?:fix|update|correct|change)\b.*\b(?:readme|documentation|docs?)\b.*\b(?:typo|spelling|wording|one line|single line)\b/i.test(userPrompt.trim());
  const hasTier3Keyword = TIER3_KEYWORDS.some(keyword => matchKeyword(promptLower, keyword));
  const hasTier2Keyword = TIER2_KEYWORDS.some(keyword => matchKeyword(promptLower, keyword));

  let recommendedTier = 'Unclassified';
  let rationale = 'No structural/testing signals matched; unclassified is not equivalent to trivial.';
  const reasonCodes = [...loadedConfig.reasonCodes, 'no-classification-signal'];

  if (isTrivialDocsEdit) {
    recommendedTier = 'Tier 1 (Trivial)';
    rationale = 'Single documentation typo detected - direct edit, no checklist required.';
    reasonCodes.splice(loadedConfig.reasonCodes.length);
    addReason(reasonCodes, 'trivial-docs-edit');
  } else if (hasMacroSignal || hasTier3Keyword) {
    recommendedTier = 'Tier 3 (Macro Task)';
    rationale = 'Prompt implies repository-wide scope, audit/benchmark work, architectural refactoring, or multi-agent collaboration.';
    reasonCodes.splice(loadedConfig.reasonCodes.length);
    addReason(reasonCodes, hasMacroSignal ? 'macro-scope-signal' : 'tier3-keyword');
  } else if (hasTier2Keyword) {
    recommendedTier = 'Tier 2 (Standard Task)';
    rationale = 'Prompt implies development work needing TDD validation or multi-file coordination.';
    reasonCodes.splice(loadedConfig.reasonCodes.length);
    addReason(reasonCodes, 'tier2-keyword');
  }

  const sentenceCount = userPrompt.split(/[.!?。！？]+/).filter(sentence => sentence.trim()).length;
  const hasMultipleTasks = /\b(and|also|then|additionally|plus|而且|還有|然後|另外|以及)\b/i.test(userPrompt);
  const mentionsSpecificFile = /\b(file|script|module|class|function|component)\b.*\.\w+/i.test(userPrompt);
  const hasQuestionMarks = /\?|？/.test(userPrompt);
  const hasMultipleSentences = sentenceCount > 2;

  if (!hasMacroSignal && !isTrivialDocsEdit && hasMultipleTasks && hasMultipleSentences) {
    if (recommendedTier === 'Unclassified' || recommendedTier.startsWith('Tier 1')) {
      recommendedTier = 'Tier 2 (Standard Task)';
      rationale = 'Multiple tasks detected with structural complexity - upgraded to Tier 2 for TDD validation.';
      reasonCodes.splice(loadedConfig.reasonCodes.length);
      addReason(reasonCodes, 'multi-task-structure');
    } else if (recommendedTier.startsWith('Tier 2')) {
      rationale += ' Multiple task structure detected.';
      addReason(reasonCodes, 'multi-task-structure');
    }
  } else if (!hasMacroSignal && mentionsSpecificFile && !hasMultipleTasks) {
    if (recommendedTier.startsWith('Tier 3')) {
      recommendedTier = 'Tier 2 (Standard Task)';
      rationale = 'Single file focus detected - downgraded from Tier 3 to Tier 2.';
      addReason(reasonCodes, 'single-file-focus');
    }
  } else if (!hasMacroSignal && hasQuestionMarks && !hasMultipleTasks) {
    if (recommendedTier.startsWith('Tier 3')) {
      recommendedTier = 'Tier 2 (Standard Task)';
      rationale = 'Question format detected - likely advisory rather than macro execution.';
      addReason(reasonCodes, 'question-format');
    }
  }

  console.log(`\n=> RECOMMENDED TIER: ${recommendedTier}`);
  console.log(`=> RATIONALE: ${rationale}`);

  if (recommendedTier.startsWith('Tier 2') || recommendedTier.startsWith('Tier 3')) {
    console.log(`\n=> BASE EXECUTION LOOP: Load 'todo-driven-workflow' and initialize its checklist (3-7 verifiable sub-tasks) BEFORE editing any file.`);
    console.log(`   Track exactly ONE item in-progress at a time; verify with real evidence before marking completed.`);
  }

  const requestedFableModel = detectFableModel(promptLower);
  if (requestedFableModel) {
    console.log(`\n=> REQUESTED FABLE MODEL MODE: ${requestedFableModel}`);
    console.log(`=> ROUTE: fable-mode/fable-${requestedFableModel}/SKILL.md`);
    console.log(`   Resolve availability and record fallback status with fable-mode/scripts/model-selector.js.`);
  }

  const recommendedGuides = [];
  for (const group of routingConfig.guideGroups) {
    let matched = false;
    if (typeof group.regex === 'string') {
      matched = new RegExp(group.regex, 'i').test(promptLower);
    } else if (Array.isArray(group.keywords)) {
      matched = group.keywords.some(keyword => promptLower.includes(keyword));
    }
    if (matched && Array.isArray(group.guides)) recommendedGuides.push(...group.guides);
  }

  if (recommendedGuides.length > 0) {
    console.log(`\n=> RECOMMENDED KNOWLEDGE GUIDES (Auto-loaded based on keywords):`);
    recommendedGuides.forEach(guide => {
      const match = guide.match(/^- ([^\s]+)/);
      if (match) {
        const guidePath = path.join(__dirname, '..', '..', match[1]);
        if (!fs.existsSync(guidePath)) {
          console.log(`${guide} [NOT INSTALLED - Ignore this recommendation]`);
          return;
        }
      }
      console.log(guide);
    });
  }

  emitDynamicSkills(promptLower, context, recommendedGuides);

  const externalClaimTriggers = routingConfig.factAudit.externalClaim || [];
  const estimateTriggers = routingConfig.factAudit.estimate || [];
  const hitExternalClaim = externalClaimTriggers.some(keyword => promptLower.includes(keyword));
  const hitEstimate = estimateTriggers.some(keyword => promptLower.includes(keyword));

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

  const contract = buildRouterContract({
    routingStatus: loadedConfig.routingStatus,
    recommendedTier,
    rationale,
    reasonCodes,
    requestedFableModel,
    signals: {
      macroScope: hasMacroSignal,
      trivialDocsEdit: isTrivialDocsEdit,
      tier3Keyword: hasTier3Keyword,
      tier2Keyword: hasTier2Keyword,
      multipleTasks: hasMultipleTasks,
      multipleSentences: hasMultipleSentences,
      specificFile: mentionsSpecificFile,
      question: hasQuestionMarks,
    },
  });

  if (process.env.HARNESS_ROUTER_CONTRACT_PATH) {
    try {
      writeRouterContract(process.env.HARNESS_ROUTER_CONTRACT_PATH, contract);
    } catch (err) {
      console.error(`[Tier Routing Pre-check] failed to write structured router contract: ${err.message}`);
    }
  }

  console.log(`\nTreat the tier above as the default route. If your own read of the task clearly disagrees, follow your read and say why in one line. An explicit instruction from the Human Partner always wins.`);
  return contract;
}

let userPrompt = process.argv[2] || '';
let hookContext = null;

if (process.argv[2]) {
  run(userPrompt);
} else if (process.stdin.isTTY) {
  run('');
} else {
  let inputData = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', chunk => { inputData += chunk; });
  process.stdin.on('end', () => {
    try {
      if (inputData.trim()) {
        const payload = JSON.parse(inputData);
        if (typeof payload.prompt === 'string') userPrompt = payload.prompt;
        hookContext = payload;
      }
    } catch (err) {
      // Not valid JSON on stdin - fall back to argv/manual behavior.
    }
    run(userPrompt, hookContext);
  });
}
