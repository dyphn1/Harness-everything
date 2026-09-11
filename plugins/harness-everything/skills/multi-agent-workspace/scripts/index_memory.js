#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { getWorkspaceRoot, getRuntimeRoot, resolveProjectDocs } = require('./project-docs-resolver');

function option(args, ...names) {
  for (const name of names) {
    const index = args.indexOf(name);
    if (index !== -1) return args[index + 1];
  }
  return undefined;
}

function manifestFromArgs(args) {
  const workspace = path.resolve(option(args, '--workspace', '--root') || getWorkspaceRoot());
  const manifestPath = path.resolve(option(args, '--manifest') || path.join(getRuntimeRoot(workspace), 'manifest.json'));
  if (!fs.existsSync(manifestPath)) {
    throw new Error(`manifest not found: ${manifestPath}; pass --workspace or --manifest explicitly`);
  }
  let manifest;
  try { manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8')); }
  catch (error) { throw new Error(`invalid manifest: ${error.message}`); }
  return { workspace, manifestPath, manifest };
}

function linkPath(workspace, absolute) {
  const relative = path.relative(workspace, absolute).replace(/\\/g, '/');
  return relative && !relative.startsWith('../') ? relative : path.resolve(absolute).replace(/\\/g, '/');
}

function linkTarget(workspace, absolute) {
  const relative = path.relative(workspace, absolute).replace(/\\/g, '/');
  if (relative && !relative.startsWith('../')) return relative;
  const normalized = path.resolve(absolute).replace(/\\/g, '/');
  return encodeURI(`file://${normalized.startsWith('/') ? '' : '/'}${normalized}`);
}

function buildIndex(input) {
  // Keep the old string form for consumers that imported buildIndex directly;
  // path resolution still comes from an explicit workspace, never output depth.
  const args = typeof input === 'string' ? ['--workspace', input] : (Array.isArray(input) ? input : null);
  const resolved = args ? manifestFromArgs(args) : {
    workspace: path.resolve(input.workspace || getWorkspaceRoot()),
    manifestPath: path.resolve(input.manifest),
    manifest: input.manifestData || JSON.parse(fs.readFileSync(path.resolve(input.manifest), 'utf8'))
  };
  const { workspace, manifest } = resolved;
  const selected = Array.isArray(manifest.selectedAgents) ? manifest.selectedAgents : [];
  const paths = manifest.paths || resolveProjectDocs(workspace).paths;
  const lines = [
    '# Multi-Agent Memory Index', '',
    'This index is generated from the global multi-agent runtime manifest. Read linked records on demand.',
    '', '## Runtime', '',
    `- Root: \`${manifest.runtimeRoot || (manifest.runtime && manifest.runtime.root) || ''}\``,
    `- Manifest: \`${resolved.manifestPath}\``,
    '', '## Document paths', ''
  ];
  for (const zone of ['decision', 'domain', 'architecture']) {
    const entry = paths[zone];
    if (entry) lines.push(`- **${zone}**: [${linkPath(workspace, entry.path)}](${linkTarget(workspace, entry.path)}) (${entry.source})`);
  }
  lines.push('', '## Selected specialists', '');
  if (!selected.length) {
    lines.push('- None selected. Do not claim that the external roster is complete.');
  } else {
    for (const agent of selected) {
      if (typeof agent === 'string') lines.push(`- \`${agent}\``);
      else lines.push(`- **${agent.name}** (${agent.division}) - \`${agent.slug}\``);
    }
  }
  lines.push('', '## Handoff', '', `- [Structured handoff](${linkTarget(workspace, path.join(path.dirname(resolved.manifestPath), 'handoff.json'))})`, `- [Launcher](${linkTarget(workspace, path.join(path.dirname(resolved.manifestPath), 'launcher.md'))})`);
  return `${lines.join('\n')}\n`;
}

function parseArgs(args) {
  const workspace = option(args, '--workspace', '--root');
  const manifest = option(args, '--manifest');
  const output = option(args, '--output');
  if (!output) throw new Error('--output requires a path; output location is never inferred from its depth');
  return { workspace, manifest, output: path.resolve(output) };
}

function main() {
  try {
    const args = process.argv.slice(2);
    const options = parseArgs(args);
    const result = manifestFromArgs(args);
    fs.mkdirSync(path.dirname(options.output), { recursive: true });
    fs.writeFileSync(options.output, buildIndex({
      workspace: result.workspace,
      manifest: result.manifestPath,
      manifestData: result.manifest
    }), 'utf8');
    console.log(`Memory index written to ${options.output}`);
  } catch (error) {
    console.error(`ERROR: ${error.message}`);
    process.exitCode = 1;
  }
}

if (require.main === module) main();
module.exports = { buildIndex, parseArgs, manifestFromArgs };
