#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

const args = process.argv.slice(2);
const memoryText = args[0];

if (!memoryText) {
  console.error("Usage: node persist-memory.js \"<insight to remember>\"");
  process.exit(1);
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

  const timestamp = new Date().toISOString().split('T')[0];
  const formattedMemory = `\n## [${timestamp}] Self-Evolution Insight\n- ${memoryText}\n`;

  fs.appendFileSync(rulesFile, formattedMemory, 'utf8');
  console.log(`[Success] Memory persisted to ${rulesFile}`);
} catch (err) {
  console.error(`[Error] Failed to write memory: ${err.message}`);
  process.exit(1);
}
