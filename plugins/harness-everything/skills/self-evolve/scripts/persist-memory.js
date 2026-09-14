#!/usr/bin/env node
'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
let getWorkspaceRoot;
try {
  ({ getWorkspaceRoot } = require('../../scripts/lib/workspace'));
} catch (err) {
  getWorkspaceRoot = () => null;
}

// NOTE: this script ships standalone - it is copied whole into every install
// target. When the canonical workspace resolver is not present, persistence
// fails closed rather than guessing a project root (issue #42).

const SECRET_PATTERNS = [
  ['github-token', /\bgh[pousr]_[A-Za-z0-9]{20,}\b/],
  ['openai-key', /\bsk-(?:proj-)?[A-Za-z0-9_-]{20,}\b/],
  ['aws-access-key', /\bAKIA[0-9A-Z]{16}\b/],
  ['private-key', /-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----/],
  ['jwt', /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/],
  ['credential-assignment', /\b(?:api[_-]?key|access[_-]?token|auth[_-]?token|password|passwd|secret)\s*[:=]\s*["']?[A-Za-z0-9_./+=:-]{8,}/i],
];

const INJECTION_PATTERNS = [
  ['ignore-prior-instructions', /\bignore\s+(?:all\s+)?(?:previous|prior|above)\s+(?:instructions|messages|rules)\b/i],
  ['replace-instructions', /\b(?:follow|obey)\s+(?:these|the following)\s+instructions\s+instead\b/i],
  ['role-override', /\byou\s+are\s+now\b/i],
  ['instruction-override', /\boverride\s+(?:the\s+)?(?:system|developer|safety|previous|prior)\s+(?:instructions|message|prompt|rules)\b/i],
  ['system-prompt-exfiltration', /\b(?:reveal|print|show|expose)\s+(?:the\s+)?(?:system|developer)\s+prompt\b/i],
  ['role-token', /<\|(?:system|developer|assistant)\|>/i],
  ['jailbreak-marker', /\b(?:jailbreak|prompt[- ]injection)\b/i],
];

function parseArgs(argv) {
  let memoryText = null;
  let source = 'manual-unspecified';
  for (let index = 0; index < argv.length; index++) {
    const token = argv[index];
    if (token === '--help' || token === '-h') return { help: true, memoryText: null, source };
    if (token === '--source') {
      if (index + 1 >= argv.length) throw new Error('--source requires a value');
      source = argv[++index];
      continue;
    }
    if (token.startsWith('--source=')) {
      source = token.slice('--source='.length);
      continue;
    }
    if (token.startsWith('-')) throw new Error(`unknown option: ${token}`);
    if (memoryText !== null) throw new Error('exactly one memory rule positional argument is allowed');
    memoryText = token;
  }
  return { help: false, memoryText, source };
}

function normalizeSource(value) {
  const source = String(value || 'manual-unspecified').trim();
  if (!source) return 'manual-unspecified';
  if (/[\r\n\0]/.test(source)) throw new Error('source provenance must be one line');
  if (source.length > 240) throw new Error('source provenance exceeds 240 characters');
  const secretReasons = detectReasonCodes(source, SECRET_PATTERNS);
  if (secretReasons.length > 0) throw new Error(`source provenance rejected by secret screening: ${secretReasons.join(', ')}`);
  return source;
}

function detectReasonCodes(text, patterns) {
  const reasons = [];
  for (const [reasonCode, pattern] of patterns) {
    if (pattern.test(text)) reasons.push(reasonCode);
  }
  return reasons;
}

function screenMemoryForPersistence(text) {
  const value = String(text || '');
  const secretReasonCodes = detectReasonCodes(value, SECRET_PATTERNS);
  const injectionReasonCodes = detectReasonCodes(value, INJECTION_PATTERNS);
  return {
    allowed: secretReasonCodes.length === 0 && injectionReasonCodes.length === 0,
    secretReasonCodes,
    injectionReasonCodes,
  };
}

function calculateSimilarity(text1, text2) {
  const words1 = text1.toLowerCase().split(/\s+/);
  const words2 = text2.toLowerCase().split(/\s+/);
  const set1 = new Set(words1);
  const set2 = new Set(words2);
  let intersection = 0;
  for (const word of set1) {
    if (set2.has(word)) intersection++;
  }
  const union = set1.size + set2.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

function scoreRuleQuality(ruleText, existingRules = []) {
  let score = 0;
  if (/\.\w{2,4}/.test(ruleText)) score += 2;
  if (/Error|Exception|Warning|錯誤|異常|警告/.test(ruleText)) score += 2;
  if (/\b(test|lint|build|verify|check|測試|檢查)\b/i.test(ruleText)) score += 1;
  if (/^(Always|Never|Check|Verify|Prefer|Avoid|Use|不要|總是|檢查|驗證|避免|使用)/i.test(ruleText)) score += 3;
  if (/^(should|must|will|needs? to|ought|應該|必須|需要)/i.test(ruleText)) score += 2;
  const isDuplicate = existingRules.some(existing => calculateSimilarity(ruleText, existing) > 0.7);
  if (!isDuplicate) score += 3;
  if (ruleText.length > 20 && ruleText.length < 200) score += 1;
  return Math.min(score, 10);
}

function extractExistingRules(rulesFile) {
  if (!fs.existsSync(rulesFile)) return [];
  try {
    const content = fs.readFileSync(rulesFile, 'utf8');
    const ruleMatches = content.match(/^- .+$/gm) || [];
    return ruleMatches.map(rule => rule.substring(2));
  } catch (err) {
    return [];
  }
}

function contentHash(text) {
  return crypto.createHash('sha256').update(String(text), 'utf8').digest('hex');
}

function persistMemory({ memoryText, source = 'manual-unspecified' }) {
  const ruleText = String(memoryText || '').trim();
  if (!ruleText) return { ok: false, exitCode: 1, message: 'memory rule is required' };

  const screening = screenMemoryForPersistence(ruleText);
  if (!screening.allowed) {
    const reasons = [...screening.secretReasonCodes, ...screening.injectionReasonCodes];
    return {
      ok: false,
      exitCode: 2,
      screening,
      message: `memory rejected by persistence screening: ${reasons.join(', ')}`,
    };
  }

  let provenance;
  try {
    provenance = normalizeSource(source);
  } catch (err) {
    return { ok: false, exitCode: 2, screening, message: err.message };
  }

  const currentDir = getWorkspaceRoot();
  if (!currentDir) {
    return {
      ok: false,
      exitCode: 1,
      screening,
      message: 'Cannot persist project memory without a resolved git workspace.',
    };
  }

  const memoryDir = path.join(currentDir, 'memories', 'repo');
  const rulesFile = path.join(memoryDir, 'RULES.md');
  const existingRules = extractExistingRules(rulesFile);
  const qualityScore = scoreRuleQuality(ruleText, existingRules);
  if (qualityScore < 5) {
    return {
      ok: false,
      exitCode: 1,
      screening,
      qualityScore,
      message: `Rule rejected - score ${qualityScore}/10 (minimum 5 required)`,
    };
  }

  const isDuplicate = existingRules.some(existing => calculateSimilarity(ruleText, existing) > 0.7);
  if (isDuplicate) {
    return {
      ok: false,
      exitCode: 1,
      screening,
      qualityScore,
      message: 'Rule rejected - similar rule already exists',
    };
  }

  fs.mkdirSync(memoryDir, { recursive: true });
  const timestamp = new Date().toISOString().split('T')[0];
  const hash = contentHash(ruleText);
  const formattedMemory = [
    '',
    `## [${timestamp}] Self-Evolution Insight (Quality: ${qualityScore}/10)`,
    `Source: ${provenance}`,
    `Content-SHA256: ${hash}`,
    'Screening: secret=clear; prompt-injection=clear',
    `- ${ruleText}`,
    '',
  ].join('\n');
  fs.appendFileSync(rulesFile, formattedMemory, 'utf8');
  return {
    ok: true,
    exitCode: 0,
    rulesFile,
    qualityScore,
    source: provenance,
    contentSha256: hash,
    screening,
  };
}

function printHelp() {
  console.log(`Append a short defensive rule to memories/repo/RULES.md.

Usage: node persist-memory.js "<insight to remember>" [--source <provenance>]

The rule must be universal and actionable. --source records where the lesson came
from (for example issue-85, verifier-stage-3, or manual-review); when omitted the
source is recorded as manual-unspecified.

Persistence gates:
- secret-like tokens and credential material are rejected before any write
- prompt-injection-shaped instructions are rejected before any write
- source provenance is recorded with a SHA-256 content fingerprint
- minimum quality score of 5/10 and similarity deduplication still apply`);
}

if (require.main === module) {
  let parsed;
  try {
    parsed = parseArgs(process.argv.slice(2));
  } catch (err) {
    console.error(`[self-evolve] ${err.message}`);
    process.exit(1);
  }

  if (parsed.help) {
    printHelp();
    process.exit(0);
  }
  if (!parsed.memoryText) {
    console.error('Usage: node persist-memory.js "<insight to remember>" [--source <provenance>]');
    process.exit(1);
  }

  try {
    const result = persistMemory(parsed);
    if (!result.ok) {
      const prefix = result.exitCode === 2 ? '[Persistence Screening]' : '[Quality Gate]';
      console.error(`${prefix} ${result.message}`);
      if (result.qualityScore !== undefined && result.qualityScore < 5) {
        console.error('Suggestions to improve:');
        console.error('- Be more specific (mention file types, error patterns)');
        console.error('- Start with action verbs (Always, Never, Check, Verify)');
        console.error('- Ensure the rule is actionable and not already captured');
      }
      process.exit(result.exitCode);
    }
    console.log(`[Success] Memory persisted to ${result.rulesFile} (Quality: ${result.qualityScore}/10, Source: ${result.source})`);
  } catch (err) {
    console.error(`[Error] Failed to write memory: ${err.message}`);
    process.exit(1);
  }
}

module.exports = {
  calculateSimilarity,
  contentHash,
  extractExistingRules,
  parseArgs,
  persistMemory,
  scoreRuleQuality,
  screenMemoryForPersistence,
};
