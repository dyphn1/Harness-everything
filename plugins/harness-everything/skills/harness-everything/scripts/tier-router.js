#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const {
  buildRouterContract,
  writeRouterContract,
} = require('./router-contract');
const { requireWorkspace } = require('./runtime-paths');

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

function detectExplicitStrategy(prompt, requestedFableModel) {
  if (/\bdirect[- ]single\b/i.test(prompt)) return 'direct-single';
  if (/\biterative[- ]single\b/i.test(prompt)) return 'iterative-single';
  if (/\bfable[- ]multi[- ]agent[- ]workspace\b|\bmulti[- ]agent workspace\b/i.test(prompt)) return 'fable-multi-agent-workspace';
  if (/\bfable[- ]parallel\b|\bparallel fable\b/i.test(prompt)) return 'fable-parallel';
  if (/\bfable[- ]staged\b|\bstaged fable\b/i.test(prompt)) return 'fable-staged';
  if (requestedFableModel || /\b(?:use|run|enter)\s+fable(?:[- ]mode)?\b/i.test(prompt)) return 'fable-staged';
  return null;
}

function detectProhibitions(prompt) {
  const rules = [
    ['fable', /\b(?:no|without|do not|don't)\s+(?:use\s+)?fable\b/i],
    ['subagents', /\b(?:no|without|do not|don't)\s+(?:use\s+)?subagents?\b|\bsingle[- ]agent only\b/i],
    ['parallel', /\b(?:no|without|do not|don't)\s+(?:use\s+)?parallel(?:ism| execution)?\b|\bdo not parallelize\b|\bserial only\b/i],
    ['workspace', /\b(?:no|without|do not|don't)\s+(?:use\s+)?(?:multi[- ]agent )?workspace\b/i],
    ['memory', /\b(?:no|without|do not|don't)\s+(?:use\s+)?memory\b/i],
    ['ensemble', /\b(?:no|without|do not|don't)\s+(?:use\s+)?ensemble\b/i],
  ];
  return rules.filter(([, regex]) => regex.test(prompt)).map(([name]) => name);
}

function detectMemoryPersistenceRequest(prompt) {
  const text = String(prompt || '');
  return /^\s*self-evolve\b/i.test(text) ||
    /\b(?:run|use|invoke|execute)\s+(?:the\s+)?self-evolve\b/i.test(text) ||
    /\b(?:persist|save|record|remember)\b.{0,40}\b(?:lesson|memory|rule|insight)\b/i.test(text) ||
    /(?:執行|使用).{0,8}自我進化|(?:記住|保存|持久化|記錄).{0,20}(?:教訓|記憶|規則|經驗)/i.test(text);
}

function detectActionGateReasons(prompt) {
  const reasons = [];
  const irreversible = [
    /\b(?:drop|truncate|wipe|purge|destroy)\b.*\b(?:database|db|table|production|prod|data)\b/i,
    /\b(?:force[- ]push|push\s+--force(?:-with-lease)?|git\s+push\b[^\n]*--force(?:-with-lease)?)\b/i,
    /\bgit\s+reset\s+--hard\b/i,
    /\bdelete\b.*\b(?:production|prod|database|db|table|branch|release|data)\b/i,
  ];
  const external = [
    /\bdeploy(?:ment|ing|ed)?\b.*\b(?:prod|production|live)\b|\bdeploy\s+to\s+(?:prod|production|live)\b/i,
    /\b(?:npm|pnpm|yarn|cargo|pip|twine)\s+publish\b|\bpublish\s+(?:the\s+)?(?:package|release|artifact)\b/i,
    /\b(?:send|email|message)\b.*\b(?:customer|client|user|users|external|production)\b/i,
    /\b(?:charge|pay|payment|refund|transfer)\b.*\b(?:customer|account|money|funds|invoice)?\b/i,
    /\bcreate\b.*\b(?:release|deployment)\b/i,
  ];
  if (irreversible.some(regex => regex.test(prompt))) reasons.push('irreversible-action');
  if (external.some(regex => regex.test(prompt))) reasons.push('external-side-effect');
  return reasons;
}

function addReason(reasonCodes, code) {
  if (code && !reasonCodes.includes(code)) reasonCodes.push(code);
}

function deduplicateGuidesByPath(guides) {
  const byPath = new Map();
  for (const guide of guides) {
    const match = String(guide).match(/^\s*-\s+([^\s]+)/);
    const key = match ? match[1].replace(/\\/g, '/') : String(guide).trim();
    if (!byPath.has(key)) byPath.set(key, guide);
  }
  return Array.from(byPath.values());
}

function countDomainSignals(promptLower) {
  const domains = [
    /\bsecurity\b|安全|資安/i,
    /\barchitecture\b|架構/i,
    /\bdocumentation\b|\bdocs?\b|文件/i,
    /\btests?\b|測試/i,
    /\bfrontend\b|前端/i,
    /\bbackend\b|後端/i,
    /\bdatabase\b|資料庫/i,
    /\binfrastructure\b|\bdevops\b|基礎設施/i,
  ];
  return domains.reduce((count, regex) => count + (regex.test(promptLower) ? 1 : 0), 0);
}

function plannerInputsFromContext(context, promptLower) {
  const harness = context && typeof context.harness === 'object' ? context.harness : {};
  const rawHost = (context && context.hostCapabilities) || harness.hostCapabilities || {};
  const rawConstraints = (context && context.constraints) || harness.constraints || {};
  const hostCapabilities = { ...rawHost };
  const constraints = { ...rawConstraints };

  const envCapabilityMap = {
    subagents: process.env.HARNESS_HOST_SUBAGENTS,
    parallelCalls: process.env.HARNESS_HOST_PARALLEL_CALLS,
    hooks: process.env.HARNESS_HOST_HOOKS,
    state: process.env.HARNESS_HOST_STATE,
    modelAvailability: process.env.HARNESS_HOST_MODEL_AVAILABILITY,
  };
  for (const [key, value] of Object.entries(envCapabilityMap)) {
    if (value) hostCapabilities[key] = value;
  }

  if (process.env.HARNESS_BUDGET_CONCURRENCY !== undefined) constraints.concurrency = process.env.HARNESS_BUDGET_CONCURRENCY;
  if (process.env.HARNESS_BUDGET_COST !== undefined) constraints.cost = process.env.HARNESS_BUDGET_COST;
  if (process.env.HARNESS_BUDGET_LATENCY !== undefined) constraints.latency = process.env.HARNESS_BUDGET_LATENCY;
  if (process.env.HARNESS_BUDGET_TOKENS !== undefined) constraints.tokens = process.env.HARNESS_BUDGET_TOKENS;

  const concurrencyMatch = promptLower.match(/\b(?:max(?:imum)?\s+)?(?:concurrency|workers?|agents?)\s*(?:=|:|of)?\s*(\d+)\b/i);
  if (concurrencyMatch) constraints.concurrency = Number(concurrencyMatch[1]);
  if (/\b(?:single worker|one worker|serial only)\b/i.test(promptLower)) constraints.concurrency = 1;

  return { hostCapabilities, constraints };
}

function emitDynamicSkills(promptLower, context, recommendedGuides) {
  try {
    const userHome = process.env.HOME || process.env.USERPROFILE || '';
    const { getWorkspaceRoot } = requireWorkspace();
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
  const memoryPersistenceRequested = detectMemoryPersistenceRequest(userPrompt);
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
  const hasTrivialEditVerb = /^(?:(?:please|help me)\s+)?(?:fix|update|correct|change)\b/i.test(userPrompt.trim());
  const hasDocsTarget = /\b(?:readme|documentation|docs?)\b/i.test(userPrompt);
  const hasTinyEditSignal = /\b(?:typo|spelling|wording|one line|single line)\b/i.test(userPrompt);
  const isTrivialDocsEdit = !hasMacroSignal && hasTrivialEditVerb && hasDocsTarget && hasTinyEditSignal;
  const hasTier3Keyword = TIER3_KEYWORDS.some(keyword => matchKeyword(promptLower, keyword));
  const hasTier2Keyword = TIER2_KEYWORDS.some(keyword => matchKeyword(promptLower, keyword));

  let recommendedTier = 'Unclassified';
  let rationale = 'No structural/testing signals matched; unclassified is not equivalent to trivial.';
  const reasonCodes = [...loadedConfig.reasonCodes, 'no-classification-signal'];

  if (memoryPersistenceRequested && !hasMacroSignal && !hasTier3Keyword && !hasTier2Keyword) {
    recommendedTier = 'Tier 1 (Trivial)';
    rationale = 'Explicit bounded self-evolve memory persistence request.';
    reasonCodes.splice(loadedConfig.reasonCodes.length);
    addReason(reasonCodes, 'memory-persistence-requested');
  } else if (isTrivialDocsEdit) {
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

  const { selectTier } = require('./system-one/router');
  const structuralFloor = hasMacroSignal ? 'tier3'
    : !isTrivialDocsEdit && hasMultipleTasks && hasMultipleSentences ? 'tier2' : null;
  const semantic = selectTier({ prompt: userPrompt, tier: recommendedTier, floor: structuralFloor,
    explicit: Boolean(detectExplicitStrategy(userPrompt, detectFableModel(userPrompt))) });
  if (semantic.diagnostic) console.log(`\n=> SYSTEM ONE: ${JSON.stringify(semantic.diagnostic)}`);
  if (semantic.diagnostic?.applied) {
    recommendedTier = semantic.tier;
    rationale = 'System One selected a tier from the fixed catalog; deterministic policy remains authoritative.';
    reasonCodes.splice(loadedConfig.reasonCodes.length);
    addReason(reasonCodes, 'system-one-tier');
  }

  console.log(`\n=> RECOMMENDED TIER: ${recommendedTier}`);
  console.log(`=> RATIONALE: ${rationale}`);

  const requestedFableModel = detectFableModel(promptLower);
  if (requestedFableModel) {
    console.log(`\n=> REQUESTED FABLE MODEL MODE: ${requestedFableModel}`);
    console.log(`=> ROUTE: fable-mode/fable-${requestedFableModel}/SKILL.md`);
    console.log(`   Resolve availability and record fallback status with fable-mode/scripts/model-selector.js.`);
  }

  const allRecommendedGuides = [];
  for (const group of routingConfig.guideGroups) {
    let matched = false;
    if (typeof group.regex === 'string') {
      matched = new RegExp(group.regex, 'i').test(promptLower);
    } else if (Array.isArray(group.keywords)) {
      matched = group.keywords.some(keyword => promptLower.includes(keyword));
    }
    if (matched && Array.isArray(group.guides)) allRecommendedGuides.push(...group.guides);
  }
  const recommendedGuides = deduplicateGuidesByPath(allRecommendedGuides);

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

  const independentWorkstreams = /\bindependent(?:ly)?\b|\bparallel(?:ize|ise|ized|ised|ism)?\b/i.test(userPrompt);
  const readOnly = /\bread[- ]only\b|\bno edits?\b|\bwithout (?:editing|edits|changes|modifications)\b/i.test(userPrompt);
  const disjointWrites = /\bdisjoint\b|\bnon[- ]overlapping\b|\bseparate files?\b|\bdistinct files?\b/i.test(userPrompt);
  const sharedWrite = /\bsame files?\b|\bshared mutable state\b|\boverlapping writes?\b|\bshared write[- ]set\b/i.test(userPrompt);
  const dependentStages = /\bdependent\b|\bsequential\b|\bstaged?\b|\bafter\b.*\bthen\b/i.test(userPrompt);
  const multiSession = /\bmulti[- ]session\b|\bmultiple sessions\b|\bacross sessions\b|\bdurable\b|\blong[- ]running\b|\bpersistent handoff\b/i.test(userPrompt);
  const reusableSpecialists = /\breusable specialists?\b|\bpersistent roles?\b|\bspecialist catalog\b|\breusable roles?\b/i.test(userPrompt);
  const crossDomain = countDomainSignals(promptLower) >= 2;
  const highUncertainty = /\bhigh uncertainty\b|\bcompeting approaches\b|\bdesign comparison\b|\bcompare alternatives\b|\btrade[- ]offs?\b/i.test(userPrompt);
  const actionGateReasonCodes = detectActionGateReasons(userPrompt);
  const irreversibleAction = actionGateReasonCodes.includes('irreversible-action');
  const externalSideEffect = actionGateReasonCodes.includes('external-side-effect');
  const requestedStrategy = detectExplicitStrategy(userPrompt, requestedFableModel);
  const prohibitions = detectProhibitions(userPrompt);
  const plannerInputs = plannerInputsFromContext(context, promptLower);

  const contract = buildRouterContract({
    routingStatus: loadedConfig.routingStatus,
    recommendedTier,
    rationale,
    reasonCodes,
    requestedFableModel,
    explicitRequest: {
      fableModel: requestedFableModel,
      strategy: requestedStrategy,
      prohibitions,
    },
    hostCapabilities: plannerInputs.hostCapabilities,
    constraints: plannerInputs.constraints,
    actionGateReasonCodes,
    signals: {
      macroScope: hasMacroSignal,
      trivialDocsEdit: isTrivialDocsEdit,
      tier3Keyword: hasTier3Keyword,
      tier2Keyword: hasTier2Keyword,
      multipleTasks: hasMultipleTasks,
      multipleSentences: hasMultipleSentences,
      specificFile: mentionsSpecificFile,
      question: hasQuestionMarks,
      independentWorkstreams,
      readOnly,
      disjointWrites,
      sharedWrite,
      dependentStages,
      multiSession,
      reusableSpecialists,
      crossDomain,
      highUncertainty,
      irreversibleAction,
      externalSideEffect,
      memoryPersistenceRequested,
      highRisk: irreversibleAction || externalSideEffect,
    },
  });

  console.log(`\n=> WORKFLOW STRATEGY: ${contract.workflowPlan.strategy || 'deferred'}`);
  if (contract.workflowPlan.memory.write !== 'none') {
    console.log(`=> MEMORY WRITE: ${contract.workflowPlan.memory.write}`);
  }
  if (contract.workflowPlan.actionGate.required) {
    console.log(`=> ACTION GATE: required (${contract.workflowPlan.actionGate.reasonCodes.join(', ')}); disposition=pending-approval`);
  }
  if (contract.workflowPlan.fallback.disposition !== 'none') {
    console.log(`=> ROUTING FALLBACK: ${contract.workflowPlan.fallback.disposition}/${contract.workflowPlan.fallback.mode} (${contract.workflowPlan.fallback.reasonCodes.join(', ')})`);
  }

  if (process.env.HARNESS_ROUTER_CONTRACT_PATH) {
    try {
      writeRouterContract(process.env.HARNESS_ROUTER_CONTRACT_PATH, contract);
    } catch (err) {
      console.error(`[Tier Routing Pre-check] failed to write structured router contract: ${err.message}`);
    }
  }

  console.log(`\nTreat the tier and strategy above as the default route. Explicit Human Partner choices/prohibitions win and are recorded in the plan; unavailable capabilities must remain visible rather than being silently downgraded.`);
  return contract;
}

if (require.main === module) {
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
}
module.exports = { run };
