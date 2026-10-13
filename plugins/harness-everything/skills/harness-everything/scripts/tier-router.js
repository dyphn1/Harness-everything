#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const {
  buildRouterContract,
  writeRouterContract,
} = require('./router-contract');
const { getHarnessRoot, requireWorkspace } = require('./runtime-paths');

const DEFAULT_ROUTING_CONFIG = {
  tiers: { tier3: [], tier2: [] },
  inputSignalGroups: [],
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
        inputSignalGroups: Array.isArray(parsed.inputSignalGroups) ? parsed.inputSignalGroups : DEFAULT_ROUTING_CONFIG.inputSignalGroups,
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

const FABLE_PROFILE_INVOCATION = /\bfable(?:[- ]mode)?\s+(?:on|with)\s+(haiku|sonnet|sonnect|opus)\b|\bfable-(haiku|sonnet|opus)\b/i;
const PROFILE_LOOKUP_FIELDS = /\b(?:requestedProfile|effectiveProfile|profileAlias|assignedRole|runtimeModel|runtimeEffort)\b/gi;

function detectFableModel(prompt) {
  const match = prompt.match(FABLE_PROFILE_INVOCATION);
  if (!match) return null;
  return (match[1] || match[2]).toLowerCase();
}

// A profile mention is data in a lookup, not an instruction to start Fable.
// Validate the whole clause, not just its prefix. Unknown prose conservatively
// retains execution routing; format field lists are recognized separately.
function containsOnlyLookupTerms(text, operation) {
  const terms = {
    explanation: /\b(?:please|help|me|could|would|you|explain|resolve|define|what|is|does|mean|means|meaning|the|a|an|of|to|into|in|for|as|compact|small|only|behavior|behaviour|profile|profiles|selection|json|record|object|alias|role|runtime|model|effort|floor|fableprofile)\b/gi,
    output: /\b(?:as|return|respond|output|show|provide|only|a|an|small|compact|short|json|record|object|selection|profile|result|with|fields|containing|include|including)\b/gi,
  };
  const chineseTerms = {
    explanation: /(?:請問|麻煩|請|幫我|解釋|說明|解析|的意思|意思|含義|意義|是什麼|設定檔|行為|角色|精簡|簡短|緊湊|JSON|紀錄|記錄)/g,
    output: /(?:只|僅|回傳|返回|輸出|顯示|提供|包含|含|的|欄位|記錄|紀錄|結果|設定檔)/g,
  };
  return text.replace(PROFILE_LOOKUP_FIELDS, '').replace(terms[operation], '')
    .replace(chineseTerms[operation], '').replace(/[.!?]+$/g, '').replace(/[\s"'`“”‘’?:：？]/g, '') === '';
}

function splitProfileLookupClauses(prompt) {
  let text = String(prompt || '').trim()
    .replace(/^(?:could\s+you(?:\s+please)?|would\s+you(?:\s+please)?|please)\s*,?\s+/i, '')
    .replace(/^(?:麻煩請|麻煩|請問|請)\s*/u, '');
  const outputLead = String.raw`(?:please\s+)?(?:return|respond|output|show|provide|no|without|do\s+not|don't)\b|(?:請(?:問)?\s*)?(?:只|僅|回傳|返回|輸出|顯示|提供|不要|不需要|無需|無須|不必|毋須|不用|不會|不)`;
  text = text.replace(new RegExp(String.raw`\.(?=\s*${outputLead})|[—–](?=\s*(?:${outputLead}|as\s+(?:a\s+)?(?:compact\s+|small\s+|short\s+)?json\s+(?:record|object)\b))`, 'giu'), ';');
  return text.split(/(?:\.{3,}|[;!?？！,，；。、…]|\b(?:and\s+then|and|then|also|plus|afterwards|additionally)\b|(?:並且?|以及|接著|然後|另外))/iu)
    .map(part => part.trim().replace(/[.!?…]+$/g, '')).filter(Boolean);
}

// A negation scopes only its own noun/verb list. Vocabulary-only matching would
// let "no delegation, do execution" pass, so English negations follow a grammar
// and an un-negated continuation may only extend the noun list. Chinese nouns
// and verbs share forms, so Chinese lists must stay inside the negated clause.
const negatedList = unit => `${unit}(?:\\s+or\\s+${unit})*`;
const NEGATED_ITEM = '(?:orchestration|delegation|stages?|staging|execution|model[- ]switch(?:ing)?)';
const NEGATED_ACTION = '(?:switch(?:ing)?\\s+(?:the\\s+)?models?|delegate|orchestrate|stage|execute)';
const ENGLISH_NEGATION = new RegExp(`^(?:(?:no|without)\\s+${negatedList(NEGATED_ITEM)}|(?:do not|don't)\\s+${negatedList(NEGATED_ACTION)})$`, 'i');
const ENGLISH_NEGATION_CONTINUATION = new RegExp(`^(?:or\\s+)?${negatedList(NEGATED_ITEM)}$`, 'i');
const CHINESE_NEGATION_PREFIX = /^(?:不要|不需要|無需|無須|不必|毋須|不用|不會|不)/;
const CHINESE_NEGATION_TERMS = /(?:不要|不需要|無需|無須|不必|毋須|不用|不會|不|或|也|任何|一切|啟動|開始|開啟|進入|執行|進行|運行|啟用|切換|模型|階段|流程|任務|操作|編排|委派)/g;

function isBoundedNegation(clause, continuation) {
  const text = clause.replace(/’/g, "'").replace(/[.!?…]+$/g, '').replace(/[“”"`?:：？]/g, '').replace(/\s+/g, ' ').trim();
  if (CHINESE_NEGATION_PREFIX.test(text)) {
    return !continuation && text.replace(CHINESE_NEGATION_TERMS, '').replace(/\s/g, '') === '';
  }
  return (continuation ? ENGLISH_NEGATION_CONTINUATION : ENGLISH_NEGATION).test(text);
}

function isFableProfileLookup(prompt, hasMacroSignal) {
  if (!detectFableModel(prompt) || hasMacroSignal) return false;
  if (/\b(?:direct[- ]single|iterative[- ]single|fable[- ](?:staged|parallel|multi[- ]agent[- ]workspace))\b/i.test(prompt)) return false;

  const clauses = splitProfileLookupClauses(prompt)
    .map(part => part.trim())
    .filter(Boolean);
  if (clauses.length === 0) return false;

  const [lookupClause, ...continuations] = clauses;
  const quotedInvocation = new RegExp(`(["'\x60])(?:run|use|enter)\\s+(?:${FABLE_PROFILE_INVOCATION.source})\\1`, 'gi');
  const normalizedLookup = lookupClause.replace(/[“”]/g, '"').replace(/[‘’]/g, "'")
    .replace(quotedInvocation, 'fableprofile')
    .replace(new RegExp(FABLE_PROFILE_INVOCATION.source, 'gi'), 'fableprofile');
  const isLookupLead = /^(?:(?:please|help me|could you(?: please)?|would you(?: please)?)\s+|(?:請問|麻煩請|麻煩|請|幫我)\s*)?(?:explain|resolve|define|what (?:is|does)|解釋|說明|解析)/i.test(lookupClause)
    && Boolean(detectFableModel(lookupClause));
  const normalizedFormatRequest = normalizedLookup.replace(/\bas\s+(?:a\s+)?(?:compact|small|short)?\s*json\s+(?:record|object)\b/gi, '');
  if (!isLookupLead || !containsOnlyLookupTerms(normalizedFormatRequest, 'explanation')) return false;

  let continuationOperation = null;
  for (const clause of continuations) {
    const output = /^(?:please\s+)?(?:return|respond|output|show|provide)\b|^as\s+(?:a\s+)?(?:compact\s+|small\s+|short\s+)?json\s+(?:record|object)\b|^(?:請\s*)?(?:只|僅)?(?:回傳|返回|輸出|顯示|提供)/i.test(clause);
    const negative = /^(?:please\s+)?(?:no|without|do not|don't)\b|^(?:請\s*)?(?:不要|不需要|無需|無須|不必|毋須|不用|不會|不)/i.test(clause);
    if (output || negative) {
      continuationOperation = output ? 'output' : 'negative';
      const normalizedContinuation = clause.replace(/^(?:please\s+|請\s*)/i, '');
      const bounded = output ? containsOnlyLookupTerms(normalizedContinuation, 'output')
        : isBoundedNegation(normalizedContinuation, false);
      if (!bounded) return false;
    } else if (continuationOperation === 'output') {
      // Only named canonical fields may continue a comma/and-separated list.
      const remainder = clause.replace(PROFILE_LOOKUP_FIELDS, '').replace(/^(?:包含|欄位)/, '').replace(/[\s"'`“”‘’]/g, '');
      if (remainder || !new RegExp(PROFILE_LOOKUP_FIELDS.source, 'i').test(clause)) return false;
    } else if (continuationOperation !== 'negative' || !isBoundedNegation(clause, true)) {
      return false;
    }
  }
  return true;
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

// Self-evolved skills are discovered from manifest metadata only: matching ids
// become step inputs, and the SKILL.md path resolves when a declaring step is
// active. Discovery is advisory and never breaks routing.
function matchGeneratedSkillIds(promptLower, context) {
  try {
    const generated = require(path.join(getHarnessRoot(), 'scripts', 'lib', 'generated-skills.js'));
    const { getWorkspaceRoot } = requireWorkspace();
    const skills = generated.readGeneratedSkills(getWorkspaceRoot(context));
    return { registered: skills.size, matched: generated.matchGeneratedSkills(promptLower, skills) };
  } catch (_) {
    return { registered: 0, matched: [] };
  }
}

function run(userPrompt, context, options = {}) {
  console.log(`[Tier Routing Pre-check]`);

  const promptLower = userPrompt.toLowerCase();
  const memoryPersistenceRequested = detectMemoryPersistenceRequest(userPrompt);
  const loadedConfig = loadRoutingConfig();
  const routingConfig = loadedConfig.config;
  const TIER3_KEYWORDS = routingConfig.tiers.tier3 || [];
  const TIER2_KEYWORDS = routingConfig.tiers.tier2 || [];

  const macroSignals = [
    /\b(?:every|each|all|entire|whole|full|complete)\s+(?:skill|skills|repo|repository|codebase|project|file|files|module|modules)/i,
    /\b(?:controlled\s+)?a(?:\/|[- ]?)b\s+(?:test|benchmark)\b/i,
    /\b(?:repository[- ]wide|codebase[- ]wide|end[- ]to[- ]end)\b/i,
    /\b(?:multiple|several|four|fourteen|dozens)\s+(?:issues|skills|files|modules)/i,
    /(?:每個|每一個|所有|全部|整個|全套|逐一|多個|四個).*(?:skill|技能|檔案|問題|版本|基準|測試|評估|稽核|比較|壓力)/i,
    /(?:評估|稽核|基準|壓力測試|比較).*(?:每個|所有|全部|整個|全套|技能|skill|檔案|版本)/i,
  ];
  const hasMacroSignal = macroSignals.some(signal => signal.test(userPrompt));
  const profileLookup = isFableProfileLookup(userPrompt, hasMacroSignal);
  const hasTrivialEditVerb = /^(?:(?:please|help me)\s+)?(?:fix|update|correct|change)\b/i.test(userPrompt.trim());
  const hasDocsTarget = /\b(?:readme|documentation|docs?)\b/i.test(userPrompt);
  const hasTinyEditSignal = /\b(?:typo|spelling|wording|one line|single line)\b/i.test(userPrompt);
  const isTrivialDocsEdit = !hasMacroSignal && hasTrivialEditVerb && hasDocsTarget && hasTinyEditSignal;
  const matchedTier3Keyword = TIER3_KEYWORDS.find(keyword => matchKeyword(promptLower, keyword)) || null;
  const hasTier3Keyword = matchedTier3Keyword !== null;
  const hasTier2Keyword = TIER2_KEYWORDS.some(keyword => matchKeyword(promptLower, keyword));

  let recommendedTier = 'Unclassified';
  let rationale = 'No structural/testing signals matched; unclassified is not equivalent to trivial.';
  const reasonCodes = [...loadedConfig.reasonCodes, 'no-classification-signal'];

  if (profileLookup) {
    recommendedTier = 'Tier 1 (Trivial)';
    rationale = 'Bounded behavior-profile lookup; select compact reference before execution.';
    reasonCodes.splice(loadedConfig.reasonCodes.length);
    addReason(reasonCodes, 'fable-profile-lookup');
  } else if (memoryPersistenceRequested && !hasMacroSignal && !hasTier3Keyword && !hasTier2Keyword) {
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
    rationale = hasMacroSignal
      ? 'Prompt implies repository-wide scope, a structured comparative experiment, architectural refactoring, or multi-agent collaboration.'
      : `Prompt matched configured Tier 3 keyword: "${matchedTier3Keyword}".`;
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

  if (!profileLookup && !hasMacroSignal && !isTrivialDocsEdit && hasMultipleTasks && hasMultipleSentences) {
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
    explicit: profileLookup || Boolean(detectExplicitStrategy(userPrompt, detectFableModel(userPrompt))) }, process.env, options.systemOneScorer || undefined);
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
    console.log(`\n=> REQUESTED FABLE PROFILE: ${requestedFableModel}`);
    console.log(`=> ROUTE: fable-mode/SKILL.md`);
    if (profileLookup) {
      console.log('=> FABLE OPERATION: profile-lookup');
      console.log('=> REFERENCES: fable-mode/references/profile-lookup.md only; no stage state or delegation.');
    } else {
      console.log(`   Profile alias: ${requestedFableModel}; resolve behavior role plus advisory host runtime floor with fable-mode/scripts/model-selector.js.`);
    }
  }

  const knowledgeSignals = [];
  const candidateBindings = [];
  for (const group of profileLookup ? [] : routingConfig.inputSignalGroups) {
    let matched = false;
    if (typeof group.regex === 'string') {
      matched = new RegExp(group.regex, 'i').test(promptLower);
    } else if (Array.isArray(group.keywords)) {
      matched = group.keywords.some(keyword => matchKeyword(promptLower, keyword));
    }
    if (matched && typeof group.id === 'string') {
      knowledgeSignals.push(group.id);
      if (Array.isArray(group.bindings)) candidateBindings.push(...group.bindings.filter(id => typeof id === 'string'));
    }
  }
  if (memoryPersistenceRequested && !knowledgeSignals.includes('memory-persistence')) {
    knowledgeSignals.push('memory-persistence');
    candidateBindings.push('self-evolve');
  }
  const generatedSkills = profileLookup ? { registered: 0, matched: [] } : matchGeneratedSkillIds(promptLower, context);
  if (generatedSkills.matched.length > 0) knowledgeSignals.push('self-evolved-skill');

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
  const requestedStrategy = profileLookup ? null : detectExplicitStrategy(userPrompt, requestedFableModel);
  const prohibitions = detectProhibitions(userPrompt);
  const plannerInputs = plannerInputsFromContext(context, promptLower);

  const contract = buildRouterContract({
    routingStatus: loadedConfig.routingStatus,
    recommendedTier,
    rationale,
    reasonCodes,
    requestedFableModel,
    knowledgeSignals,
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

  if (knowledgeSignals.length > 0) {
    console.log(`\n=> KNOWLEDGE SIGNALS (STEP INPUT ONLY): ${knowledgeSignals.join(', ')}`);
    console.log('   These normalized prompt signals help compose requirement steps; they do not select or load documents.');
    const bindingIds = [...new Set(candidateBindings)];
    if (bindingIds.length > 0) console.log(`   Candidate step binding ids: ${bindingIds.join(', ')}`);
  }
  if (generatedSkills.matched.length > 0) {
    console.log(`\n=> SELF-EVOLVED SKILL SIGNALS (STEP INPUT ONLY): ${generatedSkills.matched.join(', ')}`);
    console.log('   Declare a matching id as a step binding; its SKILL.md resolves from the manifest only when that step is active.');
  } else if (generatedSkills.registered > 0 && knowledgeSignals.length === 0) {
    console.log(`\n=> SELF-EVOLVED SKILLS REGISTERED: ${generatedSkills.registered} (none matched this prompt; inspect manifest "generated" metadata if a past lesson may apply).`);
  }

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

// Entry point: pre-score System One asynchronously so routing never needs the sync worker bridge.
async function main(prompt, context) {
  let systemOneScorer = null;
  if (['shadow', 'prefer'].includes(process.env.HARNESS_SYSTEM_ONE_MODE)) {
    try { systemOneScorer = await require('./system-one/router').prescoreTier(prompt); } catch (_) { /* the sync path still scores */ }
  }
  run(prompt, context, { systemOneScorer });
}

if (require.main === module) {
let userPrompt = process.argv[2] || '';
let hookContext = null;

if (process.argv[2]) {
  main(userPrompt);
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
    main(userPrompt, hookContext);
  });
}
}
module.exports = { run, splitProfileLookupClauses, isFableProfileLookup, containsOnlyLookupTerms, detectFableModel };
