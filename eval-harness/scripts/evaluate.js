#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

const args = process.argv.slice(2);
if (args.length < 5) {
  console.error("Usage: node evaluate.js <scoreA> <scoreB> <scoreC> <scoreD> \"<insights>\"");
  console.error("Scores should be 0, 5, or 10.");
  process.exit(1);
}

const [scoreA, scoreB, scoreC, scoreD, ...insightParts] = args;
const insights = insightParts.join(" ");

const scores = {
  "Correctness & Factuality": parseInt(scoreA, 10),
  "Token & Step Efficiency": parseInt(scoreB, 10),
  "Anti-loop & Focus": parseInt(scoreC, 10),
  "Environment & Tool Awareness": parseInt(scoreD, 10)
};

let total = 0;
let markdown = `## Harness Evaluation Report - ${new Date().toISOString()}\n\n| Dimension | Score |\n|---|---|\n`;

for (const [dim, score] of Object.entries(scores)) {
  if (isNaN(score)) {
    console.error(`Error: Score for ${dim} is not a valid number.`);
    process.exit(1);
  }
  markdown += `| ${dim} | ${score}/10 |\n`;
  total += score;
}

markdown += `| **Total Score** | **${total}/40** |\n\n`;
markdown += `### Insights\n${insights}\n\n---\n`;

function getWorkspaceRoot() {
  let dir = path.resolve(process.cwd());
  while (dir !== path.parse(dir).root) {
    if (fs.existsSync(path.join(dir, '.git'))) return dir;
    dir = path.dirname(dir);
  }
  return process.cwd();
}

// Store the evaluations in an evals folder in the project root
const evalDir = path.join(getWorkspaceRoot(), 'evals');
if (!fs.existsSync(evalDir)) {
  fs.mkdirSync(evalDir, { recursive: true });
}

const reportPath = path.join(evalDir, 'evaluation-reports.md');
try {
  fs.appendFileSync(reportPath, markdown, 'utf8');
  console.log(`[Success] Evaluation report generated and saved to ${reportPath}`);
  console.log('\n--- Report Preview ---\n');
  console.log(markdown);
} catch (err) {
  console.error(`[Error] Failed to write evaluation report: ${err.message}`);
  process.exit(1);
}
