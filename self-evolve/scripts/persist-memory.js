#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

const args = process.argv.slice(2);
const memoryText = args[0];

if (memoryText === '--help' || memoryText === '-h') {
  console.log(`Append a short defensive rule to memories/repo/RULES.md.

Usage: node persist-memory.js "<insight to remember>"

One positional argument - the extracted root cause / rule, written as a universal,
high-level statement (not a specific file, line number, or variable name). Wrap it
in quotes if it contains spaces. Appended under a dated heading; never overwrites
earlier entries.

Quality gates:
- Minimum score of 5/10 required for persistence
- Deduplication check against existing rules
- Specificity and actionability scoring`);
  process.exit(0);
}

if (!memoryText) {
  console.error("Usage: node persist-memory.js \"<insight to remember>\"");
  process.exit(1);
}

// Rule quality scoring system
function scoreRuleQuality(ruleText, existingRules = []) {
  let score = 0;
  
  // Specificity: mentions specific files, errors, or patterns
  if (/\.\w{2,4}/.test(ruleText)) score += 2; // File extensions
  if (/Error|Exception|Warning|錯誤|異常|警告/.test(ruleText)) score += 2; // Error patterns
  if (/\b(test|lint|build|verify|check|測試|檢查)\b/i.test(ruleText)) score += 1; // Verification terms
  
  // Actionability: starts with verb, has clear instruction
  if (/^(Always|Never|Check|Verify|Prefer|Avoid|Use|不要|總是|檢查|驗證|避免|使用)/i.test(ruleText)) score += 3;
  if (/^(should|must|will|needs? to|ought|應該|必須|需要)/i.test(ruleText)) score += 2;
  
  // Uniqueness: not already in RULES.md
  const isDuplicate = existingRules.some(existing => {
    const similarity = calculateSimilarity(ruleText, existing);
    return similarity > 0.7; // 70% similarity threshold
  });
  if (!isDuplicate) score += 3;
  
  // Length appropriateness (not too short, not too long)
  if (ruleText.length > 20 && ruleText.length < 200) score += 1;
  
  return Math.min(score, 10); // Cap at 10
}

// Simple text similarity calculation
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

// Extract existing rules from RULES.md
function extractExistingRules(rulesFile) {
  if (!fs.existsSync(rulesFile)) return [];
  
  try {
    const content = fs.readFileSync(rulesFile, 'utf8');
    const ruleMatches = content.match(/^- .+$/gm) || [];
    return ruleMatches.map(rule => rule.substring(2)); // Remove "- " prefix
  } catch (err) {
    return [];
  }
}

function getWorkspaceRoot() {
  let dir = path.resolve(process.cwd());
  while (dir !== path.parse(dir).root) {
    if (fs.existsSync(path.join(dir, '.git'))) return dir;
    dir = path.dirname(dir);
  }
  return process.cwd();
}

// Ensure the memory is written to the project root's /memories/repo/ directory
const currentDir = getWorkspaceRoot();
const memoryDir = path.join(currentDir, 'memories', 'repo');
const rulesFile = path.join(memoryDir, 'RULES.md');

try {
  if (!fs.existsSync(memoryDir)) {
    fs.mkdirSync(memoryDir, { recursive: true });
  }

  // Extract existing rules for deduplication check
  const existingRules = extractExistingRules(rulesFile);
  
  // Score the rule quality
  const qualityScore = scoreRuleQuality(memoryText, existingRules);
  
  if (qualityScore < 5) {
    console.error(`[Quality Gate] Rule rejected - score ${qualityScore}/10 (minimum 5 required)`);
    console.error(`Suggestions to improve:`);
    console.error(`- Be more specific (mention file types, error patterns)`);
    console.error(`- Start with action verbs (Always, Never, Check, Verify)`);
    console.error(`- Ensure the rule is actionable and not already captured`);
    process.exit(1);
  }
  
  // Check for duplicates
  const isDuplicate = existingRules.some(existing => {
    const similarity = calculateSimilarity(memoryText, existing);
    return similarity > 0.7;
  });
  
  if (isDuplicate) {
    console.error(`[Quality Gate] Rule rejected - similar rule already exists`);
    process.exit(1);
  }

  const timestamp = new Date().toISOString().split('T')[0];
  const formattedMemory = `\n## [${timestamp}] Self-Evolution Insight (Quality: ${qualityScore}/10)\n- ${memoryText}\n`;

  fs.appendFileSync(rulesFile, formattedMemory, 'utf8');
  console.log(`[Success] Memory persisted to ${rulesFile} (Quality: ${qualityScore}/10)`);
} catch (err) {
  console.error(`[Error] Failed to write memory: ${err.message}`);
  process.exit(1);
}