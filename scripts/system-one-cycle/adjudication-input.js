'use strict';

const path = require('node:path');
const { readJsonl, writeJsonl, assertPrivateDataDir } = require('./common');
const { CATALOGS } = require('../../harness-everything/scripts/system-one/catalogs');

const TIERS = new Set(['tier1', 'tier2', 'tier3']);
const INTENTS = new Set(CATALOGS.intent.map(option => option.id));

function intentDisagrees(self, lunaIntent) {
  return Array.isArray(self?.intents) && lunaIntent !== undefined && (self.intents[0] ?? null) !== lunaIntent;
}

function buildAdjudicationInput({ dataDir }) {
  const privateDir = assertPrivateDataDir(dataDir);
  const training = path.join(privateDir, 'training');
  const prompts = readJsonl(path.join(training, 'observed', 'prompts-observed.jsonl'));
  const index = (rows, file) => {
    const map = new Map();
    for (const row of rows) {
      if (typeof row?.id !== 'string' || !row.id || map.has(row.id)) throw new Error(`${path.basename(file)} has an invalid or duplicate id`);
      map.set(row.id, row);
    }
    return map;
  };
  const observedFile = path.join(training, 'observed', 'labels-observed.jsonl');
  const lunaFile = path.join(training, 'relabel-luna', 'labels.jsonl');
  const lunaIntentFile = path.join(training, 'relabel-luna', 'labels-intent.jsonl');
  const observed = index(readJsonl(observedFile, true), observedFile);
  const luna = index(readJsonl(lunaFile), lunaFile);
  const lunaIntents = index(readJsonl(lunaIntentFile), lunaIntentFile);
  const rows = [];
  const seen = new Set();

  for (const prompt of prompts) {
    if (typeof prompt?.id !== 'string' || !prompt.id) throw new Error('observed prompt is missing an id');
    if (seen.has(prompt.id)) throw new Error('duplicate observed prompt id');
    seen.add(prompt.id);
    const self = observed.get(prompt.id);
    const textLabel = luna.get(prompt.id);
    const intentLabel = lunaIntents.get(prompt.id);
    if (!self || self.tier === undefined || !textLabel) continue;
    if ((self.tier !== null && !TIERS.has(self.tier)) || (textLabel.gold !== null && !TIERS.has(textLabel.gold))) {
      throw new Error('invalid tier label for adjudication input');
    }
    if (intentLabel && (!Object.hasOwn(intentLabel, 'gold') || (intentLabel.gold !== null && !INTENTS.has(intentLabel.gold)))) {
      throw new Error('invalid intent label for adjudication input');
    }
    const hasSelfIntent = Array.isArray(self.intents);
    const selfIntent = hasSelfIntent ? (self.intents[0] ?? null) : null;
    if (selfIntent !== null && !INTENTS.has(selfIntent)) throw new Error('invalid self intent for adjudication input');
    const tierDisagrees = self.tier !== textLabel.gold;
    const intentsDisagree = intentLabel && intentDisagrees(self, intentLabel.gold);
    if (tierDisagrees || intentsDisagree) {
      if (typeof prompt.text !== 'string' || !prompt.text) throw new Error('observed prompt is missing text');
      rows.push({ id: prompt.id, text: prompt.text, selfTier: self.tier, lunaTier: textLabel.gold,
        ...(intentsDisagree ? { selfIntent, lunaIntent: intentLabel.gold } : {}) });
    }
  }

  writeJsonl(path.join(training, 'adjudication', 'input.jsonl'), rows);
  return { candidates: rows.length };
}

module.exports = { buildAdjudicationInput, intentDisagrees };
