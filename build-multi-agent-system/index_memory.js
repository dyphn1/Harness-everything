#!/usr/bin/env node
/**
 * Minimal Memory Indexer for build-multi-agent-system
 *
 * Generates a project-local memory index (markdown fallback) by parsing
 * frontmatter from markdown files in the 6 functional zones.
 * This is the runtime-generated component — NOT shipped in the skill directory.
 */

const fs = require('fs');
const path = require('path');

const ROOT = process.cwd();
const ZONES = ['State', 'Logs', 'Decisions', 'Domain', 'Architecture', 'Roles'];
const OUTPUT = path.join(ROOT, 'memory-index.md');

function parseFrontmatter(content) {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!match) return null;
  const fm = match[1];
  const data = {};
  for (const line of fm.split('\n')) {
    const m = line.match(/^(\w+):\s*(.+)$/);
    if (m) data[m[1]] = m[2].trim().replace(/^["']|["']$/g, '');
  }
  return data;
}

function walk(dir, files = []) {
  if (!fs.existsSync(dir)) return files;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, files);
    else if (entry.name.endsWith('.md')) files.push(full);
  }
  return files;
}

function main() {
  console.log('[index_memory] Scanning 6 functional zones...');

  const allFiles = [];
  for (const zone of ZONES) {
    const zonePath = path.join(ROOT, zone);
    allFiles.push(...walk(zonePath));
  }

  if (allFiles.length === 0) {
    console.log('[index_memory] No markdown files found in zones. Creating empty index.');
    fs.writeFileSync(OUTPUT, '# Memory Index\n\n_No indexed documents yet._\n');
    return;
  }

  const index = [];
  for (const file of allFiles) {
    const content = fs.readFileSync(file, 'utf8');
    const fm = parseFrontmatter(content);
    if (fm) {
      const rel = path.relative(ROOT, file);
      index.push({ file: rel, frontmatter: fm });
    }
  }

  // Generate markdown index
  let md = '# Memory Index\n\n';
  md += `Generated: ${new Date().toISOString()}\n`;
  md += `Total documents: ${index.length}\n\n`;

  for (const zone of ZONES) {
    const zoneFiles = index.filter(i => i.file.startsWith(zone + '/'));
    if (zoneFiles.length === 0) continue;
    md += `## ${zone} (${zoneFiles.length})\n\n`;
    for (const item of zoneFiles) {
      const { title, date, tags, status } = item.frontmatter;
      md += `- [${item.file}](${item.file})`;
      if (title) md += ` — ${title}`;
      if (date) md += ` (${date})`;
      if (tags) md += ` [${tags}]`;
      if (status) md += ` {${status}}`;
      md += '\n';
    }
    md += '\n';
  }

  fs.writeFileSync(OUTPUT, md);
  console.log(`[index_memory] Generated ${OUTPUT} with ${index.length} entries`);
}

main();