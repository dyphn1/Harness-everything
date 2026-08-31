#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const ZONES = Object.freeze(['state', 'logs', 'decisions', 'domain', 'architecture', 'roles']);

function option(args, name) {
  const index = args.indexOf(name);
  return index === -1 ? undefined : args[index + 1];
}

function buildIndex(root) {
  const base = path.join(root, '.harness', 'multi-agent');
  const manifestPath = path.join(base, 'manifest.json');
  let manifest = {};
  if (fs.existsSync(manifestPath)) manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  const selected = Array.isArray(manifest.selectedAgents) ? manifest.selectedAgents : [];
  const lines = [
    '# Multi-Agent Memory Index',
    '',
    'This index is generated from the local multi-agent manifest. Read linked records on demand.',
    '',
    '## Zones',
    ''
  ];
  for (const zone of ZONES) lines.push(`- [${zone}](${zone}/)`);
  lines.push('', '## Selected specialists', '');
  if (selected.length === 0) {
    lines.push('- None selected. Do not claim that the external roster is complete.');
  } else {
    for (const agent of selected) {
      lines.push(`- **${agent.name}** (${agent.division}) - \`${agent.slug}\``);
    }
  }
  lines.push('', '## Handoff', '', '- [Structured handoff](handoff.json)', '- [Launcher](launcher.md)');
  return `${lines.join('\n')}\n`;
}

function main() {
  const args = process.argv.slice(2);
  const root = path.resolve(option(args, '--root') || '.');
  const output = path.resolve(option(args, '--output') || path.join(root, '.harness', 'multi-agent', 'memory-index.md'));
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, buildIndex(root), 'utf8');
  console.log(`Memory index written to ${output}`);
}

if (require.main === module) main();
module.exports = { ZONES, buildIndex };
