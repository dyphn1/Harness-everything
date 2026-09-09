#!/usr/bin/env node
'use strict';

// The resolver is deliberately self-contained.  multi-agent-workspace is
// copied as a standalone skill, so it cannot depend on the package's source
// tree or on another installed skill at runtime.
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { execFileSync } = require('child_process');

const ZONES = Object.freeze(['decision', 'domain', 'architecture']);
const PLATFORM_HOMES = Object.freeze(['.claude', '.cursor', '.github', '.codex', '.continue']);
const PROJECT_DOC_FIELDS = Object.freeze({
  decision: ['decisionLocation', 'decisions', 'adrLocation', 'adr'],
  domain: ['domainLocation', 'domains', 'contextLocation', 'contexts', 'domain'],
  architecture: ['architectureLocation', 'architectures', 'architecture']
});
const UNBOUND_WORKSPACE_KEY = 'unbound-workspace';

function getWorkspaceRoot(start, allowNonGit = false) {
  const candidate = typeof start === 'string' && start.trim() ? start : process.cwd();
  let dir = path.resolve(candidate);
  while (dir !== path.parse(dir).root) {
    if (fs.existsSync(path.join(dir, '.git'))) return dir;
    dir = path.dirname(dir);
  }
  return allowNonGit && typeof start === 'string' && start.trim() ? path.resolve(start) : null;
}

function getStateHome() {
  return process.env.HARNESS_STATE_HOME || path.join(os.homedir(), '.agents', 'harness-everything');
}

function getWorkspaceKey(workspaceRoot) {
  const root = workspaceRoot || getWorkspaceRoot();
  if (!root) return UNBOUND_WORKSPACE_KEY;
  const absolute = path.resolve(root);
  let real = absolute;
  try { real = fs.realpathSync(absolute); } catch { /* the caller may be creating it */ }
  const slug = path.basename(real).toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'workspace';
  const hashInput = process.platform === 'win32' ? real.toLowerCase() : real;
  const hash = crypto.createHash('sha1').update(hashInput).digest('hex').slice(0, 12);
  return `${slug}-${hash}`;
}

function getRuntimeRoot(workspaceRoot) {
  return path.join(getStateHome(), 'workspaces', getWorkspaceKey(workspaceRoot), 'multi-agent');
}

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

function getRepoManifestHomes(workspaceRoot) {
  return PLATFORM_HOMES.map(home => path.join(workspaceRoot, home));
}

function readProjectDocs(workspaceRoot) {
  const manifests = [];
  for (const home of getRepoManifestHomes(workspaceRoot)) {
    const file = path.join(home, 'harness-everything', 'manifest.json');
    if (!fs.existsSync(file)) continue;
    const data = readJson(file);
    if (data && data.projectDocs && typeof data.projectDocs === 'object') {
      manifests.push({ file, projectDocs: data.projectDocs });
    }
  }
  const complete = manifests.find(entry =>
    ['docLocation', 'tracker', 'issueDefinition'].every(field => String(entry.projectDocs[field] || '').trim())
  );
  return complete || manifests[0] || null;
}

function cleanConfiguredPath(value) {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed.replace(/[\\/]$/, '');
}

function resolvePath(workspaceRoot, value) {
  const cleaned = cleanConfiguredPath(value);
  if (!cleaned) return null;
  return path.resolve(workspaceRoot, cleaned);
}

function pathIsFile(file) {
  try { return fs.statSync(file).isFile(); } catch { return false; }
}

function pathIsDir(dir) {
  try { return fs.statSync(dir).isDirectory(); } catch { return false; }
}

function parseContextMap(workspaceRoot, configuredMap) {
  const candidates = [];
  const explicit = resolvePath(workspaceRoot, configuredMap);
  if (explicit) candidates.push(explicit);
  candidates.push(path.join(workspaceRoot, 'CONTEXT-MAP.md'));
  const mapPath = candidates.find(pathIsFile);
  if (!mapPath) return null;

  const raw = fs.readFileSync(mapPath, 'utf8');
  const links = [];
  const pattern = /\[[^\]]+\]\(([^)]+)\)/g;
  let match;
  while ((match = pattern.exec(raw))) {
    const target = match[1].split('#')[0].trim();
    if (!target || target.startsWith('http:') || target.startsWith('https:')) continue;
    const absolute = path.resolve(path.dirname(mapPath), target);
    if (/context\.md$/i.test(target) || /(?:context|domain)/i.test(target)) links.push(absolute);
  }
  const existing = links.filter(pathIsFile);
  const domainDirs = existing.map(file => path.dirname(file));
  const resolvedPath = domainDirs.length ? commonPath(domainDirs) : path.dirname(mapPath);
  return { path: mapPath, domainDirs, resolvedPath, links: existing };
}

function commonPath(paths) {
  if (!paths.length) return null;
  const parts = paths.map(item => path.resolve(item).split(path.sep));
  const common = [];
  for (let i = 0; i < parts[0].length; i++) {
    if (parts.every(candidate => candidate[i] === parts[0][i])) common.push(parts[0][i]);
    else break;
  }
  return common.length ? common.join(path.sep) || path.parse(paths[0]).root : path.dirname(paths[0]);
}

function configuredZonePath(workspaceRoot, projectDocs, zone) {
  for (const key of PROJECT_DOC_FIELDS[zone]) {
    const configured = resolvePath(workspaceRoot, projectDocs && projectDocs[key]);
    if (configured) return { path: configured, source: 'projectDocs', resolution: 'explicit', field: key };
  }
  return null;
}

function configuredBasePath(workspaceRoot, projectDocs, zone) {
  const docLocation = resolvePath(workspaceRoot, projectDocs && projectDocs.docLocation);
  if (!docLocation) return null;
  const configuredBase = pathIsFile(docLocation) ? path.dirname(docLocation) : docLocation;
  const names = {
    decision: ['adr', 'decisions'],
    domain: ['domain', 'contexts'],
    architecture: ['architecture']
  }[zone];
  const baseName = path.basename(configuredBase).toLowerCase();
  if (names.includes(baseName)) return configuredBase;
  return path.join(configuredBase, names[0]);
}

function inferredZonePath(workspaceRoot, projectDocs, zone) {
  const configured = configuredBasePath(workspaceRoot, projectDocs, zone);
  if (configured) return { path: configured, source: 'projectDocs', resolution: 'inferred' };
  const candidates = {
    decision: ['docs/adr', 'docs/decisions', 'adr', 'decisions'],
    domain: ['docs/domain', 'docs/contexts', 'domain', 'contexts'],
    architecture: ['docs/architecture', 'architecture']
  }[zone].map(candidate => path.join(workspaceRoot, candidate));
  const existing = candidates.find(pathIsDir);
  if (existing) {
    return { path: existing, source: 'inference', resolution: 'inferred' };
  }
  // An existing docs/doc root is itself a repository convention. Create the
  // zone below it lazily while retaining provenance distinct from fallback.
  for (const base of ['docs', 'doc']) {
    if (pathIsDir(path.join(workspaceRoot, base))) {
      const names = { decision: 'adr', domain: 'domain', architecture: 'architecture' };
      return { path: path.join(workspaceRoot, base, names[zone]), source: 'inference', resolution: 'inferred' };
    }
  }
  return null;
}

function fallbackZonePath(workspaceRoot, zone) {
  return path.join(workspaceRoot, {
    decision: 'docs/adr',
    domain: 'docs/domain',
    architecture: 'docs/architecture'
  }[zone]);
}

function relativePath(workspaceRoot, absolute) {
  const relative = path.relative(workspaceRoot, absolute).replace(/\\/g, '/');
  return relative || '.';
}

function isWithinWorkspace(workspaceRoot, absolute) {
  const relative = path.relative(path.resolve(workspaceRoot), path.resolve(absolute));
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function resolveProjectDocs(workspaceRoot, options = {}) {
  const resolvedRoot = workspaceRoot || getWorkspaceRoot();
  if (!resolvedRoot) throw new Error('cannot resolve project docs outside a git workspace; pass --workspace <path> explicitly');
  const root = path.resolve(resolvedRoot);
  const manifest = readProjectDocs(root);
  const projectDocs = manifest ? manifest.projectDocs : {};
  const contextMap = parseContextMap(root, projectDocs.contextMap || projectDocs.contextMapPath);
  const paths = {};

  for (const zone of ZONES) {
    const explicit = configuredZonePath(root, projectDocs, zone);
    const inferred = explicit ? null : (zone === 'domain' && contextMap
      ? { path: contextMap.resolvedPath, source: 'context-map', resolution: 'explicit', mapPath: contextMap.path }
      : inferredZonePath(root, projectDocs, zone));
    const selected = explicit || inferred || {
      path: fallbackZonePath(root, zone),
      source: 'fallback',
      resolution: 'fallback'
    };
    if (!isWithinWorkspace(root, selected.path)) {
      throw new Error(`resolved ${zone} path must stay inside workspace: ${selected.path}`);
    }
    paths[zone] = {
      path: path.resolve(selected.path),
      relativePath: relativePath(root, selected.path),
      source: selected.source,
      resolution: selected.resolution || selected.source,
      origin: selected.source,
      ...(selected.field ? { field: selected.field } : {}),
      ...(selected.mapPath ? { mapPath: selected.mapPath } : {}),
      ...(zone === 'domain' && contextMap ? { contextMap: contextMap.path, contextPaths: contextMap.links } : {})
    };
  }

  const runtimeRoot = options.runtimeRoot ? path.resolve(options.runtimeRoot) : getRuntimeRoot(root);
  return {
    workspaceRoot: root,
    workspaceKey: getWorkspaceKey(root),
    stateHome: getStateHome(),
    runtimeRoot,
    runtime: {
      root: runtimeRoot,
      state: path.join(runtimeRoot, 'state'),
      logs: path.join(runtimeRoot, 'logs'),
      roles: path.join(runtimeRoot, 'roles')
    },
    projectDocs: manifest ? { ...projectDocs, manifestPath: manifest.file } : null,
    contextMap: contextMap ? { path: contextMap.path, links: contextMap.links } : null,
    paths,
    // Plural aliases make the contract readable to callers that treat these
    // as zones, while the singular keys match the project-docs vocabulary.
    decisions: paths.decision,
    domains: paths.domain,
    architectures: paths.architecture
  };
}

function detectProjectDocsConventions(workspaceRoot) {
  const resolvedRoot = workspaceRoot || getWorkspaceRoot();
  if (!resolvedRoot) return {};
  const root = path.resolve(resolvedRoot);
  const configured = readProjectDocs(root);
  const inferred = {};
  if (configured && configured.projectDocs && configured.projectDocs.docLocation) {
    inferred.docLocation = configured.projectDocs.docLocation;
  }
  if (!inferred.docLocation) {
    for (const dir of ['docs/roadmaps', 'docs/reference', 'docs/specs', 'docs', 'doc']) {
      if (pathIsDir(path.join(root, dir))) {
        inferred.docLocation = `${dir}/`;
        break;
      }
    }
  }
  if (pathIsDir(path.join(root, '.github', 'ISSUE_TEMPLATE'))) {
    inferred.tracker = 'GitHub Issues via .github/ISSUE_TEMPLATE/';
  } else if (pathIsDir(path.join(root, 'docs', 'roadmaps'))) {
    inferred.tracker = 'docs/roadmaps/ local markdown tickets';
  } else if (pathIsDir(path.join(root, 'tasks', 'tickets'))) {
    inferred.tracker = 'tasks/tickets/ local markdown tickets';
  } else if (pathIsDir(path.join(root, '.scratch'))) {
    inferred.tracker = '.scratch/ local markdown workspace';
  } else if (inferred.docLocation) {
    inferred.tracker = `${inferred.docLocation}tickets/ local markdown tickets`;
  }
  if (inferred.tracker && inferred.tracker.includes('ISSUE_TEMPLATE')) {
    inferred.issueDefinition = '.github/ISSUE_TEMPLATE/ template structure';
  } else if (inferred.tracker) {
    inferred.issueDefinition = 'Title + acceptance criteria + Status: ready-for-agent';
  }
  return inferred;
}

function isIgnored(workspaceRoot, target) {
  try {
    execFileSync('git', ['-C', workspaceRoot, 'check-ignore', '--quiet', '--no-index', target], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

function ensureCommittableFallback(resolution) {
  for (const zone of ZONES) {
    const entry = resolution.paths[zone];
    if (entry.resolution === 'fallback' && isIgnored(resolution.workspaceRoot, entry.relativePath)) {
      throw new Error(`fallback ${zone} path is ignored and cannot be committed: ${entry.relativePath}`);
    }
  }
  return resolution;
}

module.exports = {
  ZONES,
  PLATFORM_HOMES,
  getWorkspaceRoot,
  getStateHome,
  getWorkspaceKey,
  getRuntimeRoot,
  getRepoManifestHomes,
  readProjectDocs,
  parseContextMap,
  resolveProjectDocs,
  detectProjectDocsConventions,
  ensureCommittableFallback,
  isIgnored,
  relativePath,
  isWithinWorkspace
};
