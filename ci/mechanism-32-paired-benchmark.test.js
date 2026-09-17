'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const helper = require('./test-helper');
const {
  mcnemarExactP,
  prepareArmWorkspace,
  summarizePairs,
  validatePairRecord,
  validateRunConfig,
} = require('../behavioral-evals/paired-benchmark');

console.log('\n[32] paired behavioral benchmark contract...');

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])]));
}

function hash(value) {
  return crypto.createHash('sha256').update(JSON.stringify(stable(value))).digest('hex');
}

function skillContract(caseId = 'case-a') {
  return {
    schema_version: 1,
    effect_type: 'skill-text',
    engine: 'opencode',
    requested_model: 'test/model',
    case_id: caseId,
    max_turns: 8,
    loaded_skills: ['tdd'],
    fixture_sha256: 'fixture-hash',
    prompt_sha256: 'prompt-hash',
    rubric_sha256: 'rubric-hash',
    execution_policy: 'opencode-auto',
  };
}

function arm(outcome, treatment, overrides = {}) {
  return {
    outcome,
    model_name: 'test/model',
    intervention: {
      skill_text: treatment,
      plugin_enforcement: false,
    },
    loaded_skills: treatment ? ['tdd'] : [],
    plugin_sha256: null,
    plugin_attribution: null,
    cost: treatment ? 2 : 1,
    total_tokens: treatment ? 120 : 100,
    tool_call_count: treatment ? 4 : 3,
    duration_ms: treatment ? 1200 : 1000,
    ...overrides,
  };
}

function skillPair(id, baselineOutcome, treatmentOutcome, overrides = {}) {
  const contract = skillContract(overrides.caseId || id);
  return {
    schema_version: 1,
    id: overrides.caseId || id,
    pair_id: id,
    effect_type: 'skill-text',
    contract,
    contract_sha256: hash(contract),
    arms: {
      baseline: arm(baselineOutcome, false, overrides.baseline || {}),
      treatment: arm(treatmentOutcome, true, overrides.treatment || {}),
    },
  };
}

try {
  const missingThreshold = validateRunConfig({
    effect_type: 'skill-text', engine: 'opencode', model: 'test/model',
    min_effect_pp: NaN, repeats: 1,
  });
  helper.check(
    '32. a paired study cannot start without a predeclared minimum effect',
    missingThreshold.some((problem) => problem.includes('min-effect-pp')),
    missingThreshold.join('; '),
  );

  const noModel = validateRunConfig({
    effect_type: 'skill-text', engine: 'opencode', model: '',
    min_effect_pp: 10, repeats: 1,
  });
  helper.check(
    '32. an explicit model is required so both arms share the same model contract',
    noModel.some((problem) => problem.includes('explicit --model')),
    noModel.join('; '),
  );

  const badPluginEngine = validateRunConfig({
    effect_type: 'plugin-enforcement', engine: 'claude', model: 'test/model',
    min_effect_pp: 10, repeats: 1,
  });
  helper.check(
    '32. plugin-enforcement is not generalized beyond the currently attributed OpenCode surface',
    badPluginEngine.some((problem) => problem.includes('opencode only')),
    badPluginEngine.join('; '),
  );

  const fixtureCase = {
    id: 'workspace-shape',
    discipline: 'tdd',
    fixture: { files: [{ path: 'probe.txt', content: 'baseline\n' }] },
  };
  const skillBaseline = prepareArmWorkspace(fixtureCase, 'skill-text', 'baseline', 'opencode');
  const skillTreatment = prepareArmWorkspace(fixtureCase, 'skill-text', 'treatment', 'opencode');
  helper.check(
    '32. skill-text control contains no Harness skill or plugin',
    !fs.existsSync(path.join(skillBaseline.ws, '.claude', 'skills', 'tdd', 'SKILL.md')) &&
      !fs.existsSync(path.join(skillBaseline.ws, '.opencode', 'plugins', 'harness-enforcement.js')),
    skillBaseline.ws,
  );
  helper.check(
    '32. skill-text treatment installs the named skill without installing hooks/plugin enforcement',
    fs.existsSync(path.join(skillTreatment.ws, '.claude', 'skills', 'tdd', 'SKILL.md')) &&
      !fs.existsSync(path.join(skillTreatment.ws, '.claude', 'settings.json')) &&
      !fs.existsSync(path.join(skillTreatment.ws, '.opencode', 'plugins', 'harness-enforcement.js')),
    skillTreatment.ws,
  );
  fs.rmSync(skillBaseline.ws, { recursive: true, force: true });
  fs.rmSync(skillTreatment.ws, { recursive: true, force: true });

  const pluginBaseline = prepareArmWorkspace(fixtureCase, 'plugin-enforcement', 'baseline', 'opencode');
  const pluginTreatment = prepareArmWorkspace(fixtureCase, 'plugin-enforcement', 'treatment', 'opencode');
  helper.check(
    '32. plugin experiment holds skill text constant and changes only enforcement installation',
    fs.existsSync(path.join(pluginBaseline.ws, '.claude', 'skills', 'tdd', 'SKILL.md')) &&
      fs.existsSync(path.join(pluginTreatment.ws, '.claude', 'skills', 'tdd', 'SKILL.md')) &&
      !fs.existsSync(path.join(pluginBaseline.ws, '.opencode', 'plugins', 'harness-enforcement.js')) &&
      fs.existsSync(path.join(pluginTreatment.ws, '.opencode', 'plugins', 'harness-enforcement.js')),
    JSON.stringify({ baseline: pluginBaseline.ws, treatment: pluginTreatment.ws }),
  );
  fs.rmSync(pluginBaseline.ws, { recursive: true, force: true });
  fs.rmSync(pluginTreatment.ws, { recursive: true, force: true });

  const validSkillPair = skillPair('p1', 'fail', 'pass');
  helper.check('32. a correctly isolated skill-text pair is includable', validatePairRecord(validSkillPair).included, JSON.stringify(validatePairRecord(validSkillPair)));

  const modelMismatch = skillPair('model-mismatch', 'fail', 'pass', {
    treatment: { model_name: 'other/model' },
  });
  helper.check(
    '32. actual model mismatch excludes the pair instead of counting it as behavior',
    !validatePairRecord(modelMismatch).included && validatePairRecord(modelMismatch).reason === 'actual-model-mismatch',
    JSON.stringify(validatePairRecord(modelMismatch)),
  );

  const pluginContract = {
    schema_version: 1,
    effect_type: 'plugin-enforcement',
    engine: 'opencode',
    requested_model: 'test/model',
    case_id: 'plugin-case',
    max_turns: 8,
    loaded_skills: ['tdd'],
    fixture_sha256: 'fixture-hash',
    prompt_sha256: 'prompt-hash',
    rubric_sha256: 'rubric-hash',
    execution_policy: 'opencode-auto',
  };
  const pluginPair = {
    id: 'plugin-case',
    pair_id: 'plugin-pair',
    effect_type: 'plugin-enforcement',
    contract: pluginContract,
    contract_sha256: hash(pluginContract),
    preflight: { passed: true, plugin_sha256: 'plugin-hash' },
    arms: {
      baseline: {
        ...arm('fail', true),
        intervention: { skill_text: true, plugin_enforcement: false },
        loaded_skills: ['tdd'],
      },
      treatment: {
        ...arm('pass', true),
        intervention: { skill_text: true, plugin_enforcement: true },
        loaded_skills: ['tdd'],
        plugin_sha256: 'plugin-hash',
        plugin_attribution: { fired: true, state_files: ['workspaces/x/state/sessions/y/edit-state.json'] },
      },
    },
  };
  helper.check(
    '32. plugin pair is includable only when preflight, hash, constant skill text, and per-arm attribution agree',
    validatePairRecord(pluginPair).included,
    JSON.stringify(validatePairRecord(pluginPair)),
  );
  const unattributedPlugin = JSON.parse(JSON.stringify(pluginPair));
  unattributedPlugin.pair_id = 'plugin-unattributed';
  unattributedPlugin.arms.treatment.plugin_attribution.fired = false;
  helper.check(
    '32. missing live plugin attribution is infrastructure/inconclusive, not a behavioral result',
    !validatePairRecord(unattributedPlugin).included && validatePairRecord(unattributedPlugin).reason === 'plugin-attribution-missing',
    JSON.stringify(validatePairRecord(unattributedPlugin)),
  );

  const records = [
    skillPair('a-r1', 'fail', 'pass', { caseId: 'a' }),
    skillPair('a-r2', 'fail', 'pass', { caseId: 'a' }),
    skillPair('b-r1', 'pass', 'fail', { caseId: 'b' }),
    skillPair('c-r1', 'pass', 'pass', { caseId: 'c' }),
    skillPair('infra-r1', 'pass', 'session-error', { caseId: 'infra' }),
  ];
  const summary = summarizePairs(records, 10);
  helper.check(
    '32. summary excludes infrastructure outcomes and reports paired transitions',
    summary.requested_pairs === 5 && summary.included_pairs === 4 && summary.excluded_pairs === 1 &&
      summary.transitions['fail->pass'] === 2 && summary.transitions['pass->fail'] === 1 &&
      summary.transitions['pass->pass'] === 1 && summary.transitions['fail->fail'] === 0,
    JSON.stringify(summary),
  );
  helper.check(
    '32. paired effect is derived from within-pair transitions and carries a deterministic uncertainty interval',
    summary.paired_effect_pp === 25 && Array.isArray(summary.paired_effect_ci95_pp) && summary.paired_effect_ci95_pp.length === 2,
    JSON.stringify(summary),
  );
  helper.check(
    '32. repeated runs remain separate samples and expose per-case variance instead of overwriting',
    summary.repeat_variance.a.repeats === 2 && summary.repeat_variance.a.paired_difference_variance === 0,
    JSON.stringify(summary.repeat_variance),
  );
  helper.check(
    '32. cost and execution overhead are reported separately from correctness',
    summary.cost_and_execution_overhead.cost_delta.mean === 1 &&
      summary.cost_and_execution_overhead.token_delta.mean === 20 &&
      summary.cost_and_execution_overhead.tool_call_delta.mean === 1 &&
      summary.cost_and_execution_overhead.duration_ms_delta.mean === 200,
    JSON.stringify(summary.cost_and_execution_overhead),
  );
  helper.check(
    '32. exact discordant-pair statistic is available without turning it into an unpaired pass-rate verdict',
    mcnemarExactP(2, 1) === 1 && summary.mcnemar_exact_p === 1,
    JSON.stringify({ direct: mcnemarExactP(2, 1), summary: summary.mcnemar_exact_p }),
  );
  helper.check(
    '32. the predeclared practical threshold is retained in the summary decision contract',
    summary.decision.min_effect_pp === 10 && /predeclared/i.test(summary.decision.rule),
    JSON.stringify(summary.decision),
  );

  helper.finish();
} catch (error) {
  helper.check('32. paired behavioral benchmark contract', false, error.stack);
  helper.finish();
}
