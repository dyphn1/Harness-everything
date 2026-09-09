#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const {
  ZONES: DOCUMENT_ZONES,
  getWorkspaceRoot,
  resolveProjectDocs,
  ensureCommittableFallback
} = require('./project-docs-resolver');
const {
  SUPPORTED_PLATFORMS,
  readAgencyCatalog,
  resolveSelection
} = require('./agency-catalog');

const GENERATOR = 'harness-everything/multi-agent-workspace';
const RUNTIME_ZONES = Object.freeze(['state', 'logs', 'roles']);
const ALL_ZONES = Object.freeze(['state', 'logs', 'decisions', 'domain', 'architecture', 'roles']);
const ROUTER_TEMPLATE = path.join(__dirname, '..', 'templates', 'AGENTS.md');

function values(args, name) {
  const result = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i] !== name) continue;
    if (!args[i + 1] || args[i + 1].startsWith('--')) throw new Error(`${name} requires a value`);
    result.push(args[++i]);
  }
  return result;
}

function commaValues(args, name) {
  return values(args, name).flatMap(value => value.split(',')).map(value => value.trim()).filter(Boolean);
}

function parseArgs(args) {
  if (args.includes('--help') || args.includes('-h')) return { help: true };
  const workspace = values(args, '--workspace')[0] || getWorkspaceRoot();
  const sourceValues = values(args, '--agency-source');
  const platform = values(args, '--platform')[0] || null;
  if (platform && !SUPPORTED_PLATFORMS.includes(platform)) {
    throw new Error(`unsupported platform "${platform}"; supported: ${SUPPORTED_PLATFORMS.join(', ')}`);
  }
  return {
    workspace: path.resolve(workspace),
    source: sourceValues[0] || process.env.AGENCY_AGENTS_SOURCE || null,
    platform,
    divisions: commaValues(args, '--division'),
    agents: commaValues(args, '--agent'),
    allAgents: args.includes('--all-agents'),
    expectedRevision: values(args, '--expected-agency-revision')[0] || null,
    allowSourceDrift: args.includes('--allow-source-drift'),
    force: args.includes('--force')
  };
}

function json(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function readExistingManifest(runtimeRoot) {
  const file = path.join(runtimeRoot, 'manifest.json');
  if (!fs.existsSync(file)) return null;
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch (error) { throw new Error(`existing runtime manifest is invalid: ${error.message}`); }
}

function detectStack(workspaceRoot) {
  const names = new Set(fs.readdirSync(workspaceRoot, { withFileTypes: true })
    .filter(entry => entry.isFile()).map(entry => entry.name));
  if (names.has('package.json')) return 'node';
  if (names.has('pyproject.toml') || names.has('requirements.txt')) return 'python';
  if (names.has('Cargo.toml')) return 'rust';
  if (names.has('go.mod')) return 'go';
  return 'polyglot';
}

function gitRevision(root) {
  if (!fs.existsSync(path.join(root, '.git'))) return null;
  try { return execFileSync('git', ['-C', root, 'rev-parse', '--short', 'HEAD'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(); }
  catch { return null; }
}

function renderRouter(manifest) {
  const values = {
    RUNTIME_ROOT: manifest.runtime.root,
    RUNTIME_STATE: manifest.runtime.state,
    RUNTIME_LOGS: manifest.runtime.logs,
    LAUNCHER: path.join(manifest.runtime.root, 'launcher.md'),
    DECISION_PATH: manifest.paths.decision.path,
    DOMAIN_PATH: manifest.paths.domain.path,
    ARCHITECTURE_PATH: manifest.paths.architecture.path
  };
  const template = fs.readFileSync(ROUTER_TEMPLATE, 'utf8');
  return template.replace(/\{\{([A-Z_]+)\}\}/g, (match, name) => {
    if (!(name in values)) throw new Error(`router template placeholder is unknown: ${name}`);
    return values[name];
  });
}

function renderLauncher(manifest, selectedAgents) {
  const lines = [
    '# Multi-Agent Launcher', '',
    `Generator: ${GENERATOR}`,
    `Runtime: ${manifest.runtime.root}`,
    `Workspace: ${manifest.workspace.root}`,
    `Platform: ${manifest.workspace.platform || 'generic'}`,
    `Stack: ${manifest.workspace.stack}`,
    '',
    'The installed multi-agent-workspace skill and indexer are immutable. Read',
    'manifest.json and handoff.json from the runtime root before dispatching.',
    '', '## Resolved document paths', ''
  ];
  for (const zone of DOCUMENT_ZONES) {
    const entry = manifest.paths[zone];
    lines.push(`- ${zone}: ${entry.path} (${entry.source})`);
  }
  lines.push('', '## Selected Specialists', '');
  if (!selectedAgents.length) {
    lines.push('- None selected. Configure an agency source and rerun with --agent or --division.');
  } else {
    for (const agent of selectedAgents) {
      lines.push(`- **${agent.name}** [${agent.division}] - ${agent.description}`);
      lines.push(`  - slug: \`${agent.slug}\`; source file: \`${agent.sourceFile}\``);
      lines.push('  - boundary: only the files and deliverables named in the dispatch brief.');
    }
  }
  lines.push('', '## Handoff Schema', '', 'Return `status`, `changes`, `verification`, `risks`, and `nextAction`.', '');
  return lines.join('\n');
}

function listFiles(root) {
  const files = [];
  if (!fs.existsSync(root)) return files;
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const full = path.join(root, entry.name);
    if (entry.isDirectory()) files.push(...listFiles(full));
    else if (entry.isFile()) files.push(full);
  }
  return files;
}

function sameFile(left, right) {
  try { return fs.readFileSync(left).equals(fs.readFileSync(right)); }
  catch { return false; }
}

function isSamePath(left, right) {
  return path.resolve(left) === path.resolve(right);
}

function migrationTargetKey(target) {
  const resolved = path.normalize(path.resolve(target));
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
}

function generatedLegacyArtifact(file, manifest) {
  const name = path.basename(file);
  if (name === 'manifest.json') {
    // The pre-#43 manifest had no schema marker, but was still Harness-owned
    // because it lived at the reserved legacy root.
    return manifest && (manifest.generator === GENERATOR || Object.keys(manifest).length === 0);
  }
  if (name === 'handoff.json') return manifest && manifest.generator === GENERATOR;
  if (name === 'AGENTS.md') return /^# Multi-Agent Workspace Router\b/m.test(fs.readFileSync(file, 'utf8'));
  if (name === 'launcher.md') return /^# Multi-Agent Launcher\b/m.test(fs.readFileSync(file, 'utf8'));
  if (name === 'index_memory.js') return /^#!\/usr\/bin\/env node\b/m.test(fs.readFileSync(file, 'utf8'));
  if (name === 'memory-index.md') return /^# Multi-Agent Memory Index\b/m.test(fs.readFileSync(file, 'utf8'));
  return false;
}

function removeEmptyParents(start, stop) {
  let current = start;
  const boundary = path.resolve(stop);
  while (path.resolve(current) !== boundary) {
    const relative = path.relative(boundary, current);
    if (relative.startsWith('..') || path.isAbsolute(relative)) break;
    try {
      if (fs.readdirSync(current).length) break;
      fs.rmdirSync(current);
    } catch { break; }
    current = path.dirname(current);
  }
}

// Migrate authored records from the pre-#43 repository-local output only
// after every destination conflict has been checked. Generated router,
// launcher, indexer, and runtime files are intentionally not copied.
function migrateLegacyWorkspace(workspaceRoot, resolution) {
  const legacyRoot = path.join(workspaceRoot, '.harness', 'multi-agent');
  if (!fs.existsSync(legacyRoot)) return null;
  const legacyBoundary = path.resolve(legacyRoot);
  const copies = [];
  const plannedTargets = new Map();
  for (const zone of DOCUMENT_ZONES) {
    const legacyZone = path.join(legacyRoot, zone === 'decision' ? 'decisions' : zone);
    const destination = resolution.paths[zone].path;
    for (const source of listFiles(legacyZone)) {
      if (path.basename(source) === '.gitkeep') continue;
      const relative = path.relative(legacyZone, source);
      const target = path.join(destination, relative);
      if (isSamePath(source, target)) continue;
      const targetFromLegacy = path.relative(legacyBoundary, target);
      if (!targetFromLegacy.startsWith('..') && !path.isAbsolute(targetFromLegacy)) {
        throw new Error(`migration destination is inside legacy workspace: ${path.relative(workspaceRoot, target).replace(/\\/g, '/')}`);
      }
      const targetKey = migrationTargetKey(target);
      if (plannedTargets.has(targetKey)) {
        throw new Error(`migration conflict: multiple legacy records target ${path.relative(workspaceRoot, target).replace(/\\/g, '/')}`);
      }
      plannedTargets.set(targetKey, source);
      if (fs.existsSync(target) && !sameFile(source, target)) {
        throw new Error(`migration conflict: ${path.relative(workspaceRoot, target).replace(/\\/g, '/')}`);
      }
      copies.push({ source, target });
    }
  }

  for (const copy of copies) {
    fs.mkdirSync(path.dirname(copy.target), { recursive: true });
    if (!fs.existsSync(copy.target)) fs.copyFileSync(copy.source, copy.target);
  }

  // Remove known generated artifacts only once migration has fully succeeded.
  let legacyManifest = null;
  const manifestPath = path.join(legacyRoot, 'manifest.json');
  if (fs.existsSync(manifestPath)) {
    try { legacyManifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8')); } catch { legacyManifest = null; }
  }
  const generated = ['manifest.json', 'AGENTS.md', 'launcher.md', 'index_memory.js', 'memory-index.md', 'handoff.json'];
  for (const name of generated) {
    const file = path.join(legacyRoot, name);
    if (fs.existsSync(file) && generatedLegacyArtifact(file, legacyManifest)) fs.rmSync(file, { force: true });
  }
  for (const copy of copies) fs.rmSync(copy.source, { force: true });
  for (const zone of ['roles', 'state', 'logs']) {
    const runtimeZone = path.join(legacyRoot, zone);
    if (fs.existsSync(runtimeZone)) fs.rmSync(runtimeZone, { recursive: true, force: true });
  }
  for (const zone of ['decisions', 'domain', 'architecture']) {
    for (const marker of listFiles(path.join(legacyRoot, zone)).filter(file => path.basename(file) === '.gitkeep')) {
      fs.rmSync(marker, { force: true });
    }
    removeEmptyParents(path.join(legacyRoot, zone), legacyRoot);
  }
  removeEmptyParents(legacyRoot, workspaceRoot);
  return { from: legacyRoot, records: copies.length };
}

function writeRuntimeArtifacts(runtimeRoot, artifacts) {
  for (const artifact of artifacts) {
    fs.mkdirSync(path.dirname(artifact.path), { recursive: true });
    fs.writeFileSync(artifact.path, artifact.content, 'utf8');
  }
}

function runIndexer(workspaceRoot, runtimeRoot) {
  const indexer = path.join(__dirname, 'index_memory.js');
  const manifest = path.join(runtimeRoot, 'manifest.json');
  const output = path.join(runtimeRoot, 'memory-index.md');
  execFileSync(process.execPath, [indexer, '--workspace', workspaceRoot, '--manifest', manifest, '--output', output], { stdio: 'pipe' });
  return output;
}

function scaffold(options) {
  if (!fs.existsSync(options.workspace) || !fs.statSync(options.workspace).isDirectory()) {
    throw new Error(`workspace not found: ${options.workspace}`);
  }
  const resolution = ensureCommittableFallback(resolveProjectDocs(options.workspace));
  const runtimeRoot = resolution.runtimeRoot;
  const existing = readExistingManifest(runtimeRoot);
  if (existing && existing.generator !== GENERATOR) throw new Error('existing Harness runtime belongs to another generator');

  const catalog = options.source ? readAgencyCatalog(options.source) : null;
  if (options.expectedRevision && (!catalog || catalog.source.revision !== options.expectedRevision)) {
    throw new Error(`agency source revision mismatch: expected ${options.expectedRevision}, got ${catalog && catalog.source.revision || '(unknown)'}`);
  }
  if (existing && existing.agency && existing.agency.sourceRevision &&
      (!catalog || existing.agency.sourceRevision !== catalog.source.revision) && !options.allowSourceDrift) {
    throw new Error(`agency source revision drift: existing ${existing.agency.sourceRevision}, current ${catalog && catalog.source.revision || '(unavailable)'}; pass --allow-source-drift to refresh`);
  }
  const selection = catalog
    ? resolveSelection(catalog, options.divisions, options.agents, options.allAgents)
    : { divisionIds: [], agents: [] };
  if (!catalog && (options.divisions.length || options.agents.length || options.allAgents)) {
    throw new Error('cannot select agency agents without --agency-source or AGENCY_AGENTS_SOURCE');
  }
  const migration = migrateLegacyWorkspace(options.workspace, resolution);
  for (const zone of DOCUMENT_ZONES) fs.mkdirSync(resolution.paths[zone].path, { recursive: true });
  const agency = catalog
    ? { status: 'available', ...catalog.source, selectedCount: selection.agents.length, selectionRequired: selection.agents.length === 0 }
    : { status: 'unavailable', reason: 'No agency source configured', requiredConfiguration: '--agency-source <path> or AGENCY_AGENTS_SOURCE', selectedCount: 0, selectionRequired: false };
  const generatedAt = new Date().toISOString();
  const manifest = {
    schemaVersion: 2,
    generator: GENERATOR,
    workspace: {
      root: resolution.workspaceRoot,
      key: resolution.workspaceKey,
      revision: gitRevision(options.workspace),
      stack: detectStack(options.workspace),
      platform: options.platform
    },
    runtime: {
      root: runtimeRoot,
      state: resolution.runtime.state,
      logs: resolution.runtime.logs,
      roles: resolution.runtime.roles,
      manifest: path.join(runtimeRoot, 'manifest.json'),
      handoff: path.join(runtimeRoot, 'handoff.json')
    },
    paths: resolution.paths,
    zones: ALL_ZONES,
    documentationZones: DOCUMENT_ZONES,
    supportedPlatforms: SUPPORTED_PLATFORMS,
    agency,
    selectedDivisions: selection.divisionIds,
    selectedAgents: selection.agents,
    execution: { generatedAt, resolver: 'project-docs-resolver', migration },
    artifactPaths: ['AGENTS.md', 'manifest.json', 'handoff.json', 'memory-index.md', 'launcher.md', 'roles/']
  };
  const catalogPayload = catalog
    ? { ...catalog, generatedBy: GENERATOR }
    : { generatedBy: GENERATOR, status: 'unavailable', agents: [], divisions: [], reason: agency.reason };
  const handoff = {
    schemaVersion: 2,
    status: selection.agents.length || agency.status !== 'available' ? 'ready' : 'selection-required',
    generator: GENERATOR,
    workspace: resolution.workspaceRoot,
    runtimeRoot,
    paths: resolution.paths,
    selectedAgents: selection.agents.map(agent => agent.slug),
    changes: [],
    execution: { generatedAt, workspaceRevision: manifest.workspace.revision },
    verification: { catalog: agency.status, indexer: 'pending' },
    risks: [],
    nextAction: selection.agents.length ? 'dispatch selected specialists with bounded briefs' : 'select specialists or configure AGENCY_AGENTS_SOURCE'
  };
  const artifacts = [
    { path: path.join(runtimeRoot, 'AGENTS.md'), content: renderRouter(manifest) },
    { path: path.join(runtimeRoot, 'manifest.json'), content: json(manifest) },
    { path: path.join(runtimeRoot, 'handoff.json'), content: json(handoff) },
    { path: path.join(runtimeRoot, 'launcher.md'), content: renderLauncher(manifest, selection.agents) },
    { path: path.join(runtimeRoot, 'roles', 'agency-catalog.json'), content: json(catalogPayload) },
    { path: path.join(runtimeRoot, 'roles', 'selected-agents.json'), content: json({ selected: selection.agents }) }
  ];
  for (const zone of RUNTIME_ZONES) fs.mkdirSync(path.join(runtimeRoot, zone), { recursive: true });
  writeRuntimeArtifacts(runtimeRoot, artifacts);
  const memoryIndex = runIndexer(options.workspace, runtimeRoot);
  handoff.verification.indexer = 'passed';
  fs.writeFileSync(path.join(runtimeRoot, 'handoff.json'), json(handoff), 'utf8');
  return { runtimeRoot, manifest, memoryIndex, resolution, migration };
}

function usage() {
  return [
    'Usage: node scripts/scaffold.js --workspace <path> [options]',
    '  --agency-source <path>       Read divisions.json and agent frontmatter from this source',
    '  --division <id[,id]>         Select every specialist in a division (repeatable)',
    '  --agent <slug[,name]>        Select named specialists (repeatable)',
    '  --all-agents                 Explicitly select the complete metadata catalog',
    '  --platform <name>            Validate a supported converter target',
    '  --allow-source-drift         Accept a different source revision on refresh',
    '  --force                      Retained for compatibility; runtime files are Harness-owned'
  ].join('\n');
}

function main() {
  try {
    const options = parseArgs(process.argv.slice(2));
    if (options.help) return console.log(usage());
    const result = scaffold(options);
    console.log(`Multi-agent runtime written to ${result.runtimeRoot}`);
    console.log(`  Documentation zones: ${result.manifest.documentationZones.length}`);
    console.log(`  Agency: ${result.manifest.agency.status}`);
    console.log(`  Selected agents: ${result.manifest.selectedAgents.length}`);
    console.log(`  Memory index: ${result.memoryIndex}`);
  } catch (error) {
    console.error(`ERROR: ${error.message}`);
    process.exitCode = 1;
  }
}

if (require.main === module) main();
module.exports = {
  GENERATOR,
  ZONES: ALL_ZONES,
  DOCUMENT_ZONES,
  parseArgs,
  migrateLegacyWorkspace,
  scaffold,
  usage
};
