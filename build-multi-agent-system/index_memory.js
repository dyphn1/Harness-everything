#!/usr/bin/env node
/**
 * index_memory — Minimal memory indexer for build-multi-agent-system.
 *
 * Scans the workspace for agent-related files (SKILL.md, AGENTS.md, zone
 * directories) and generates a markdown index. This is the fallback when
 * SQLite is unavailable.
 *
 * Usage: node index_memory.js [workspace-root]
 * Output: memory-index.md in the workspace root.
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(process.argv[2] || '.');
const OUTPUT = path.join(ROOT, 'memory-index.md');

function findAgents(dir, depth = 0) {
  if (depth > 3) return [];
  const results = [];
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return []; }
  for (const e of entries) {
    if (e.name.startsWith('.') || e.name === 'node_modules') continue;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      results.push(...findAgents(full, depth + 1));
    } else if (e.name === 'SKILL.md' || e.name === 'AGENTS.md') {
      const rel = path.relative(ROOT, full);
      const content = fs.readFileSync(full, 'utf8');
      const nameMatch = content.match(/^name:\s*(.+)$/m);
      results.push({ path: rel, name: nameMatch ? nameMatch[1].trim() : e.name });
    }
  }
  return results;
}

function findZones(dir) {
  const zonePatterns = ['state', 'logs', 'decisions', 'domain', 'architecture', 'roles'];
  const found = [];
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return []; }
  for (const e of entries) {
    if (e.isDirectory() && !e.name.startsWith('.') && e.name !== 'node_modules') {
      if (zonePatterns.includes(e.name.toLowerCase())) {
        found.push(e.name);
      }
    }
  }
  return found;
}

const agents = findAgents(ROOT);
const zones = findZones(ROOT);

let md = `# Memory Index\n\n`;
md += `Generated: ${new Date().toISOString()}\n\n`;
md += `## Agents (${agents.length})\n\n`;
if (agents.length) {
  for (const a of agents) {
    md += `- **${a.name}** — \`${a.path}\`\n`;
  }
} else {
  md += `_No agents found._\n`;
}
md += `\n## Zones (${zones.length})\n\n`;
if (zones.length) {
  for (const z of zones) {
    md += `- ${z}/\n`;
  }
} else {
  md += `_No functional zones detected._\n`;
}

fs.writeFileSync(OUTPUT, md, 'utf8');
console.log(`Memory index written to ${OUTPUT}`);
console.log(`  Agents: ${agents.length}, Zones: ${zones.length}`);