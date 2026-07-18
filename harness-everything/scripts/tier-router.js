#!/usr/bin/env node
const { execSync } = require('child_process');

function getGitDiffStats() {
  try {
    let files = 0;
    let lines = 0;

    const parseStats = (diffStat) => {
      if (!diffStat) return;
      diffStat.split('\n').forEach(line => {
        const [added, deleted] = line.split('\t');
        if (added && added !== '-' && deleted && deleted !== '-') {
          files += 1;
          lines += parseInt(added) + parseInt(deleted);
        }
      });
    };

    const staged = execSync('git diff --cached --numstat', { encoding: 'utf8' }).trim();
    parseStats(staged);
    
    const unstaged = execSync('git diff --numstat', { encoding: 'utf8' }).trim();
    parseStats(unstaged);
    
    return { files, lines };
  } catch (err) {
    return { files: 0, lines: 0 };
  }
}

const stats = getGitDiffStats();
const userPrompt = process.argv[2] || '';

console.log(`[Tier Routing Pre-check]`);
console.log(`- Staged Files Changed: ${stats.files}`);
console.log(`- Staged Lines Changed: ${stats.lines}`);

// Basic heuristic
let recommendedTier = "Tier 1 (Trivial)";
let rationale = "Very few changes staged and prompt is short.";

if (stats.files > 5 || stats.lines > 300 || userPrompt.toLowerCase().includes("architecture") || userPrompt.toLowerCase().includes("refactor")) {
  recommendedTier = "Tier 3 (Macro Task)";
  rationale = "Large number of files/lines changed, or prompt implies system-wide architectural changes.";
} else if (stats.files >= 2 || stats.lines >= 50 || userPrompt.toLowerCase().includes("test") || userPrompt.toLowerCase().includes("api")) {
  recommendedTier = "Tier 2 (Standard Task)";
  rationale = "Moderate changes requiring TDD validation or multi-file coordination.";
}

console.log(`\n=> REQUIRED TIER: ${recommendedTier}`);
console.log(`=> RATIONALE: ${rationale}`);
console.log(`\nYou MUST route to this tier path unless explicitly overridden by the Human Partner.`);
