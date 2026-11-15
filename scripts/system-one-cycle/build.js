'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { REPO, readJsonl, writeJsonl, writeJson, assertPrivateDataDir, isSyntheticBuildDataDir } = require('./common');
const { intentDisagrees } = require('./adjudication-input');
const { CATALOGS, validSecondary } = require('../../harness-everything/scripts/system-one/catalogs');

const TIERS = new Set(['tier1', 'tier2', 'tier3']);
const DROP_REASONS = ['no-majority', 'no-vote', 'intent-no-majority', 'holdout-overlap', 'split-overlap'];

function indexById(rows, file) {
  const map = new Map();
  for (const row of rows) {
    if (typeof row?.id !== 'string' || !row.id) throw new Error(`${path.basename(file)} has a row without an id`);
    if (map.has(row.id)) throw new Error(`${path.basename(file)} has duplicate id ${row.id}`);
    map.set(row.id, row);
  }
  return map;
}

function requireTier(value, file) {
  if (value !== null && !TIERS.has(value)) throw new Error(`${path.basename(file)} has an invalid tier label`);
  return value;
}

function requirePrompt(row, file) {
  for (const key of ['id', 'family', 'source', 'split', 'text']) {
    if (typeof row?.[key] !== 'string' || !row[key]) throw new Error(`${path.basename(file)} has a row without a string ${key}`);
  }
  if (!['train', 'validation'].includes(row.split)) throw new Error(`${path.basename(file)} has an invalid split`);
  return { id: row.id, family: row.family, source: row.source, split: row.split, text: row.text };
}

function holdoutTexts(file) {
  const corpus = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (!Array.isArray(corpus?.cases)) throw new Error(`${path.basename(file)} has no cases array`);
  return corpus.cases.map((row, index) => {
    if (typeof row?.request?.context !== 'string') throw new Error(`${path.basename(file)} cases[${index}] is missing request.context`);
    return row.request.context;
  });
}

const normalize = text => text.toLowerCase().replace(/[\p{P}\p{S}]+/gu, ' ').replace(/\s+/gu, ' ').trim();

function defaultHoldouts() {
  const dir = path.join(REPO, 'benchmarks', 'fixtures');
  return ['system-one-holdout.json', 'system-one-intent-holdout.json'].map(file => path.join(dir, file));
}

function buildDataset({ dataDir, holdoutFiles = defaultHoldouts(), outDir, validityOutDir }) {
  const privateDir = assertPrivateDataDir(dataDir, { allowSyntheticBuildRoot: true, create: false });
  const syntheticBuildRoot = isSyntheticBuildDataDir(privateDir);
  const outputDir = outDir === undefined ? path.join(privateDir, 'training', 'v1') : outDir;
  const validityOutputDir = validityOutDir === undefined ? path.join(privateDir, 'training', 'v1-validity') : validityOutDir;
  outDir = assertPrivateDataDir(outputDir, {
    allowSyntheticBuildRoot: syntheticBuildRoot, create: false,
  });
  validityOutDir = assertPrivateDataDir(validityOutputDir, {
    allowSyntheticBuildRoot: syntheticBuildRoot, create: false,
  });
  const training = path.join(privateDir, 'training');
  const promptFile = path.join(training, 'observed', 'prompts-observed.jsonl');
  const selfFile = path.join(training, 'observed', 'labels-observed.jsonl');
  const lunaFile = path.join(training, 'relabel-luna', 'labels.jsonl');
  const intentFile = path.join(training, 'relabel-luna', 'labels-intent.jsonl');
  const consensusFile = path.join(training, 'adjudication', 'consensus.jsonl');
  const promptRows = readJsonl(promptFile);
  if (syntheticBuildRoot && (!promptRows.length || promptRows.some(row => typeof row.text !== 'string' || !row.text.toLowerCase().includes('synthetic')))) {
    throw new Error('repository-local build input must contain only synthetic fixture rows');
  }
  const selfLabels = indexById(readJsonl(selfFile, true), selfFile);
  const luna = indexById(readJsonl(lunaFile), lunaFile);
  const intents = indexById(readJsonl(intentFile), intentFile);
  const votes = indexById(readJsonl(consensusFile, true), consensusFile);
  const heldOut = new Set(holdoutFiles.flatMap(holdoutTexts).map(normalize));
  const seenIds = new Set();
  const candidates = [];
  const droppedByReason = Object.fromEntries(DROP_REASONS.map(reason => [reason, 0]));

  for (const row of promptRows) {
    const prompt = requirePrompt(row, promptFile);
    if (seenIds.has(prompt.id)) throw new Error(`duplicate prompt id ${prompt.id}`);
    seenIds.add(prompt.id);
    const textLabel = luna.get(prompt.id);
    const intentLabel = intents.get(prompt.id);
    if (!textLabel || !intentLabel) throw new Error(`text-only labels are missing for id ${prompt.id}`);
    let gold = requireTier(textLabel.gold, lunaFile);
    const self = selfLabels.get(prompt.id);

    if (self && self.tier !== undefined && requireTier(self.tier, selfFile) !== gold) {
      const vote = votes.get(prompt.id);
      if (!vote) { droppedByReason['no-vote']++; continue; }
      if (!['majority', 'unanimous'].includes(vote.status)) { droppedByReason['no-majority']++; continue; }
      gold = requireTier(vote.consensus, consensusFile);
    }
    if (gold === 'tier1' && self?.contradictions?.includes('tier1-with-writes')) gold = 'tier2';
    let intentGold = intentLabel.gold;
    let secondary = Array.isArray(intentLabel.secondary) ? intentLabel.secondary : [];
    if ((intentGold !== null && !CATALOGS.intent.some(option => option.id === intentGold)) || !validSecondary('intent', intentGold, secondary)) {
      throw new Error(`${path.basename(intentFile)} has an invalid intent label`);
    }
    let intent = { gold: intentGold, secondary };
    if (self && intentDisagrees(self, intentGold)) {
      const vote = votes.get(prompt.id);
      if (!['majority', 'unanimous'].includes(vote?.intentStatus)) {
        droppedByReason['intent-no-majority']++;
        intent = null;
      } else {
        intentGold = vote.intentConsensus;
        secondary = intentGold === null ? [] : secondary.filter(value => value !== intentGold);
        if ((intentGold !== null && !CATALOGS.intent.some(option => option.id === intentGold))
            || !validSecondary('intent', intentGold, secondary)) {
          throw new Error(`${path.basename(consensusFile)} has an invalid intent consensus`);
        }
        intent = { gold: intentGold, secondary };
      }
    }
    if (gold === null && intent) intent = { gold: null, secondary: [] };

    candidates.push({ prompt, gold, validityGold: textLabel.gold,
      intent });
  }

  const validationText = new Set(candidates.filter(row => row.prompt.split === 'validation').map(row => normalize(row.prompt.text)));
  const retained = [];
  for (const row of candidates) {
    const normalized = normalize(row.prompt.text);
    if (heldOut.has(normalized)) droppedByReason['holdout-overlap']++;
    else if (row.prompt.split === 'train' && validationText.has(normalized)) droppedByReason['split-overlap']++;
    else retained.push(row);
  }

  const prompts = retained.map(row => row.prompt);
  const labels = retained.map(row => ({ id: row.prompt.id, gold: row.gold }));
  const validityLabels = retained.map(row => ({ id: row.prompt.id, gold: row.validityGold }));
  const intentRows = retained.filter(row => row.intent).map(row => ({ id: row.prompt.id, ...row.intent }));
  const ids = new Set(prompts.map(row => row.id));
  if (ids.size !== prompts.length || labels.some(row => !ids.has(row.id)) || validityLabels.some(row => !ids.has(row.id)) || intentRows.some(row => !ids.has(row.id))) {
    throw new Error('output id integrity check failed');
  }

  const count = values => Object.fromEntries([...new Set(values)].sort().map(value => [value, values.filter(item => item === value).length]));
  const report = {
    schemaVersion: 1,
    rows: prompts.length,
    split: count(prompts.map(row => row.split)),
    tier: Object.fromEntries(['tier1', 'tier2', 'tier3'].map(value => [value, labels.filter(row => row.gold === value).length])),
    invalid: validityLabels.filter(row => row.gold === null).length,
    tierNull: labels.filter(row => row.gold === null).length,
    droppedByReason,
  };

  outDir = assertPrivateDataDir(outDir, { allowSyntheticBuildRoot: syntheticBuildRoot });
  validityOutDir = assertPrivateDataDir(validityOutDir, { allowSyntheticBuildRoot: syntheticBuildRoot });
  writeJsonl(path.join(outDir, 'prompts.jsonl'), prompts);
  writeJsonl(path.join(outDir, 'labels.jsonl'), labels);
  writeJsonl(path.join(outDir, 'labels-intent.jsonl'), intentRows);
  writeJsonl(path.join(validityOutDir, 'prompts.jsonl'), prompts);
  writeJsonl(path.join(validityOutDir, 'labels.jsonl'), validityLabels);
  writeJson(path.join(outDir, 'report.json'), report);
  return report;
}

module.exports = { buildDataset, defaultHoldouts, holdoutTexts, normalize };
