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
const PROJECT_DOCS_CONFIG = path.join('.agents', 'harness-everything', 'project-docs.json');
const PROJECT_DOC_ROLES = Object.freeze(['prd', 'adr', 'ticket', 'reference', 'log', 'report']);
const PROJECT_DOC_CONFIG_KEYS = new Set([
  'governed', 'domains', 'legacy', 'derived', 'tickets',
  'docLocation', 'tracker', 'issueDefinition', 'contextMap', 'contextMapPath',
  'decisionLocation', 'decisions', 'adrLocation', 'adr',
  'domainLocation', 'contextLocation', 'contexts', 'domain',
  'architectureLocation', 'architectures', 'architecture'
]);
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

function isPlainObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function normalizeHostProjectDocs(projectDocs) {
  if (!isPlainObject(projectDocs)) return { projectDocs, warnings: [] };

  const normalized = { ...projectDocs };
  const warnings = [];
  if (typeof normalized.domains === 'string') {
    if (typeof normalized.domainLocation !== 'string' || !normalized.domainLocation.trim()) {
      normalized.domainLocation = normalized.domains;
    }
    delete normalized.domains;
    warnings.push({
      code: 'deprecated-domains-string',
      severity: 'warning',
      message: 'host projectDocs.domains as a string is deprecated; use domainLocation for the zone path and domains as the ID-prefix array'
    });
  }
  return { projectDocs: normalized, warnings };
}

function projectDocsConfigPath(workspaceRoot) {
  return path.join(workspaceRoot, PROJECT_DOCS_CONFIG);
}

function normalizedHostHome(activeHost) {
  if (typeof activeHost !== 'string') return null;
  const name = activeHost.trim().toLowerCase().replace(/^\./, '');
  return PLATFORM_HOMES.find(home => home.slice(1) === name) || null;
}

function readHostProjectDocsConfigs(workspaceRoot) {
  const manifests = [];
  for (let index = 0; index < PLATFORM_HOMES.length; index++) {
    const homeName = PLATFORM_HOMES[index];
    const home = path.join(workspaceRoot, homeName);
    const file = path.join(home, 'harness-everything', 'manifest.json');
    if (!fs.existsSync(file)) continue;
    const data = readJson(file);
    if (data && data.projectDocs && isPlainObject(data.projectDocs)) {
      manifests.push({ file, home: homeName, projectDocs: data.projectDocs });
    }
  }
  return manifests;
}

function inspectHostProjectDocs(workspaceRoot) {
  const entries = [];
  for (const home of PLATFORM_HOMES) {
    const file = path.join(workspaceRoot, home, 'harness-everything', 'manifest.json');
    if (!fs.existsSync(file)) continue;
    const entry = { file, home, projectDocs: null, warnings: [], diagnostics: [], hasProjectDocs: false };
    let manifest;
    try {
      manifest = JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch {
      entry.diagnostics.push({
        code: 'invalid-host-config',
        severity: 'error',
        path: configSource(workspaceRoot, file),
        message: `host manifest at ${configSource(workspaceRoot, file)} is not valid JSON`
      });
      entries.push(entry);
      continue;
    }
    if (!isPlainObject(manifest)) {
      entry.diagnostics.push({
        code: 'invalid-host-config',
        severity: 'error',
        path: configSource(workspaceRoot, file),
        message: `host manifest at ${configSource(workspaceRoot, file)} must contain a JSON object`
      });
      entries.push(entry);
      continue;
    }
    if (!Object.prototype.hasOwnProperty.call(manifest, 'projectDocs')) {
      entries.push(entry);
      continue;
    }
    entry.hasProjectDocs = true;
    if (!isPlainObject(manifest.projectDocs)) {
      entry.diagnostics.push({
        code: 'invalid-host-config',
        severity: 'error',
        path: configSource(workspaceRoot, file),
        message: `projectDocs in ${configSource(workspaceRoot, file)} must be a JSON object`
      });
      entries.push(entry);
      continue;
    }

    const normalizedHost = normalizeHostProjectDocs(manifest.projectDocs);
    const projectDocs = normalizedHost.projectDocs;

    const validation = validateDocsConfig(projectDocs);
    const source = configSource(workspaceRoot, file);
    entry.warnings.push(...normalizedHost.warnings.map(item => ({ ...item, path: source })));
    entry.warnings.push(...validation.warnings.map(item => ({ ...item, path: source })));
    if (!validation.valid) {
      const details = validation.diagnostics.map(item => item.message).join('; ');
      entry.diagnostics.push({
        code: 'invalid-host-config',
        severity: 'error',
        path: source,
        message: `projectDocs in ${source} failed validation${details ? `: ${details}` : ''}`
      });
      entries.push(entry);
      continue;
    }
    entry.projectDocs = projectDocs;
    entries.push(entry);
  }
  return entries;
}

function readProjectDocs(workspaceRoot, options = {}) {
  const resolvedRoot = workspaceRoot || getWorkspaceRoot();
  if (!resolvedRoot) throw new Error('cannot resolve project docs outside a git workspace; pass a workspace root explicitly');
  const root = path.resolve(resolvedRoot);
  const selection = resolveDocsConfig(root, options);
  const firstSource = selection.sources && selection.sources[0];
  const file = firstSource ? path.resolve(root, ...firstSource.split('/')) : null;
  return {
    file,
    projectDocs: selection.config,
    source: selection.status,
    status: selection.status,
    invalid: selection.status === 'invalid',
    sources: selection.sources || [],
    warnings: selection.warnings || [],
    diagnostics: selection.diagnostics || []
  };
}

function isRepoRelativePath(value) {
  if (typeof value !== 'string' || !value.trim()) return false;
  const normalized = value.trim().replace(/\\/g, '/');
  if (normalized.startsWith('/') || /^[A-Za-z]:\//.test(normalized)) return false;
  if (path.isAbsolute(value) || path.win32.isAbsolute(value)) return false;
  return !normalized.split('/').includes('..');
}

// Config globs must match the shape the matcher canonicalizes against:
// forward slashes, repo-relative, no "./" or "../" leading segments. A
// non-canonical value would validate but silently match nothing.
function getPatternIssue(value) {
  if (typeof value !== 'string' || !value.trim()) return 'must be a non-empty string';
  if (value.includes('\\')) return 'must use forward slashes (backslashes are not allowed)';
  if (value.startsWith('/') || /^[A-Za-z]:\//.test(value)) return 'must be repo-relative (no leading "/")';
  if (value.startsWith('./') || value === '.') return 'must be canonical (no leading "./")';
  if (value.startsWith('../')) return 'must be canonical (no leading "../")';
  if (value.split('/').includes('..')) return 'must not contain ".." segments';
  if (value.split('/').includes('.')) return 'must not contain "." path segments';
  if (value.split('/').includes('')) return 'must not contain empty path segments (no "//" or trailing "/")';
  return null;
}

function validateDocsConfig(config) {
  const diagnostics = [];
  const warnings = [];
  function invalid(code, message) {
    diagnostics.push({ code, severity: 'error', path: PROJECT_DOCS_CONFIG.replace(/\\/g, '/'), message });
  }

  if (!isPlainObject(config)) {
    invalid('invalid-config-root', 'project-docs.json must contain a JSON object');
    return { valid: false, diagnostics, warnings };
  }

  for (const key of Object.keys(config).sort()) {
    if (!PROJECT_DOC_CONFIG_KEYS.has(key)) {
      warnings.push({
        code: 'unknown-config-key',
        severity: 'warning',
        path: PROJECT_DOCS_CONFIG.replace(/\\/g, '/'),
        message: `unknown project-docs.json key: ${key}`
      });
    }
  }

  if (Object.prototype.hasOwnProperty.call(config, 'governed')) {
    if (!Array.isArray(config.governed)) {
      invalid('invalid-governed', 'governed must be an array');
    } else {
      config.governed.forEach((entry, index) => {
        if (!isPlainObject(entry) || getPatternIssue(entry.path)) {
          const issue = isPlainObject(entry) ? getPatternIssue(entry.path) : 'must be an object with a path';
          invalid('invalid-governed-entry', `governed[${index}].path ${issue} (must be a canonical repo-relative glob like "docs/**"); got ${JSON.stringify(entry && entry.path)}`);
          return;
        }
        if (!PROJECT_DOC_ROLES.includes(entry.role)) {
          invalid('invalid-governed-role', `governed[${index}].role must be one of ${PROJECT_DOC_ROLES.join(', ')}`);
        }
      });
    }
  }

  if (Object.prototype.hasOwnProperty.call(config, 'domains')) {
    if (!Array.isArray(config.domains)) {
      invalid('invalid-domains', 'domains must be an array');
    } else {
      const seen = new Set();
      config.domains.forEach((domain, index) => {
        if (typeof domain !== 'string' || !/^[A-Z][A-Z0-9]{1,9}$/.test(domain)) {
          invalid('invalid-domain', `domains[${index}] must match ^[A-Z][A-Z0-9]{1,9}$`);
        } else if (seen.has(domain)) {
          invalid('duplicate-domain', `domains contains duplicate value ${domain}`);
        }
        seen.add(domain);
      });
    }
  }

  if (Object.prototype.hasOwnProperty.call(config, 'legacy')) {
    if (!Array.isArray(config.legacy)) {
      invalid('invalid-legacy', 'legacy must be an array of repo-relative globs');
    } else {
      config.legacy.forEach((pattern, index) => {
        const issue = getPatternIssue(pattern);
        if (issue) invalid('invalid-legacy-entry', `legacy[${index}] ${issue} (must be a canonical repo-relative glob like "docs/**"); got ${JSON.stringify(pattern)}`);
      });
    }
  }

  if (Object.prototype.hasOwnProperty.call(config, 'derived')) {
    if (!Array.isArray(config.derived)) {
      invalid('invalid-derived', 'derived must be an array');
    } else {
      config.derived.forEach((entry, index) => {
        if (!isPlainObject(entry) || getPatternIssue(entry.path) ||
            typeof entry.generator !== 'string' || !entry.generator.trim()) {
          const issue = isPlainObject(entry) ? (getPatternIssue(entry.path) || null) : null;
          if (issue) {
            invalid('invalid-derived-entry', `derived[${index}].path ${issue} (must be a canonical repo-relative path like "docs/gen/index.md"); got ${JSON.stringify(entry && entry.path)}`);
          } else {
            invalid('invalid-derived-entry', `derived[${index}] must have non-empty path and generator strings`);
          }
        }
      });
    }
  }

  if (Object.prototype.hasOwnProperty.call(config, 'tickets') &&
      config.tickets !== 'tracker' && !isRepoRelativePath(config.tickets)) {
    invalid('invalid-tickets', 'tickets must be "tracker" or a repo-relative path');
  }

  return { valid: diagnostics.length === 0, diagnostics, warnings };
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (!isPlainObject(value)) return value;
  const normalized = {};
  for (const key of Object.keys(value).sort()) normalized[key] = canonicalize(value[key]);
  return normalized;
}

function canonicalJson(value) {
  return JSON.stringify(canonicalize(value));
}

function configSource(workspaceRoot, file) {
  return relativePath(workspaceRoot, file);
}

function resolveDocsConfig(workspaceRoot, options = {}) {
  const resolvedRoot = workspaceRoot || getWorkspaceRoot();
  if (!resolvedRoot) throw new Error('cannot resolve project docs outside a git workspace; pass a workspace root explicitly');
  const root = path.resolve(resolvedRoot);
  const projectFile = projectDocsConfigPath(root);
  if (fs.existsSync(projectFile)) {
    const source = configSource(root, projectFile);
    let config;
    try {
      config = JSON.parse(fs.readFileSync(projectFile, 'utf8'));
    } catch {
      return {
        status: 'invalid',
        sources: [source],
        config: null,
        warnings: [],
        diagnostics: [{ code: 'invalid-project-config-json', severity: 'error', path: source, message: 'project-docs.json must contain valid JSON' }]
      };
    }

    const validation = validateDocsConfig(config);
    const diagnostics = validation.diagnostics.map(item => ({ ...item, path: source }));
    const warnings = validation.warnings.map(item => ({ ...item, path: source }));
    if (!validation.valid) {
      return { status: 'invalid', sources: [source], config: null, warnings, diagnostics };
    }

    const hosts = inspectHostProjectDocs(root);
    const hostDiagnostics = hosts.flatMap(entry => entry.diagnostics);
    const hostWarnings = hosts.flatMap(entry => entry.warnings);
    const validHosts = hosts.filter(entry => entry.projectDocs);
    const differing = validHosts.filter(entry => canonicalJson(entry.projectDocs) !== canonicalJson(config));
    if (differing.length) {
      warnings.push({
        code: 'project-overrides-host',
        severity: 'warning',
        path: source,
        message: 'project-docs.json wholly overrides differing host projectDocs values',
        candidates: differing.map(entry => configSource(root, entry.file))
      });
    }
    return { status: 'project', sources: [source], config, warnings: [...warnings, ...hostWarnings], diagnostics: [...diagnostics, ...hostDiagnostics] };
  }

  const hosts = inspectHostProjectDocs(root);
  const hostDiagnostics = hosts.flatMap(entry => entry.diagnostics);
  const hostWarnings = hosts.flatMap(entry => entry.warnings);
  const activeHome = normalizedHostHome(options.activeHost);
  if (activeHome) {
    const activeHost = hosts.find(entry => entry.home === activeHome);
    const activeFile = activeHost ? activeHost.file : path.join(root, activeHome, 'harness-everything', 'manifest.json');
    const activeSource = configSource(root, activeFile);
    if (activeHost && activeHost.diagnostics.length) {
      return {
        status: 'invalid',
        sources: [activeSource],
        config: null,
        warnings: [...hostWarnings],
        diagnostics: [...hostDiagnostics]
      };
    }
    if (!activeHost || !activeHost.hasProjectDocs) {
      return {
        status: 'none',
        sources: [activeSource],
        config: null,
        warnings: [
          ...hostWarnings,
          {
            code: 'missing-project-docs-config',
            severity: 'warning',
            path: activeSource,
            message: `active host has no projectDocs config; add .agents/harness-everything/project-docs.json`
          }
        ],
        diagnostics: [...hostDiagnostics]
      };
    }
    return {
      status: 'host',
      sources: [activeSource],
      config: activeHost.projectDocs,
      warnings: [...hostWarnings],
      diagnostics: [...hostDiagnostics]
    };
  }

  const validHosts = hosts.filter(entry => entry.projectDocs);
  if (!validHosts.length) return { status: 'none', sources: [], config: null, warnings: hostWarnings, diagnostics: hostDiagnostics };
  const sources = validHosts.map(entry => configSource(root, entry.file));
  const firstConfig = validHosts[0].projectDocs;
  const equal = validHosts.every(entry => canonicalJson(entry.projectDocs) === canonicalJson(firstConfig));
  if (equal) return { status: 'host', sources, config: firstConfig, warnings: hostWarnings, diagnostics: hostDiagnostics };
  return {
    status: 'ambiguous',
    sources,
    config: null,
    warnings: hostWarnings,
    diagnostics: [{
      code: 'ambiguous-host-project-docs',
      severity: 'error',
      path: sources[0],
      message: 'host projectDocs configurations differ and no active host selects one',
      candidates: sources
    }, ...hostDiagnostics]
  };
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
  candidates.push(path.join(workspaceRoot, 'CONTEXT-MAP.md'));
  const explicit = resolvePath(workspaceRoot, configuredMap);
  if (explicit) candidates.push(explicit);
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
  const resolved = paths.map(item => path.resolve(item));
  const parts = resolved.map(item => comparisonPath(item).split(path.sep));
  const common = [];
  for (let i = 0; i < parts[0].length; i++) {
    if (parts.every(candidate => candidate[i] === parts[0][i])) common.push(parts[0][i]);
    else break;
  }
  if (!common.length) return path.dirname(resolved[0]);
  const selected = resolved[0].split(path.sep).slice(0, common.length).join(path.sep);
  return selected || path.parse(resolved[0]).root;
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

function realPathWithMissingSegments(value) {
  let current = path.resolve(value);
  const missing = [];
  while (!fs.existsSync(current)) {
    const parent = path.dirname(current);
    if (parent === current) break;
    missing.unshift(path.basename(current));
    current = parent;
  }
  let existing;
  try {
    existing = fs.realpathSync.native ? fs.realpathSync.native(current) : fs.realpathSync(current);
  } catch {
    existing = current;
  }
  return path.join(existing, ...missing);
}

function comparisonPath(value) {
  const normalized = path.normalize(value);
  return process.platform === 'win32' ? normalized.toLowerCase() : normalized;
}

function isWithinWorkspace(workspaceRoot, absolute) {
  const realWorkspaceRoot = comparisonPath(realPathWithMissingSegments(workspaceRoot));
  const realTarget = comparisonPath(realPathWithMissingSegments(absolute));
  const relative = path.relative(realWorkspaceRoot, realTarget);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function resolveProjectDocs(workspaceRoot, options = {}) {
  const resolvedRoot = workspaceRoot || getWorkspaceRoot();
  if (!resolvedRoot) throw new Error('cannot resolve project docs outside a git workspace; pass --workspace <path> explicitly');
  const root = path.resolve(resolvedRoot);
  const manifest = readProjectDocs(root, options);
  const hasValidConfig = manifest.status === 'project' || manifest.status === 'host';
  const projectDocs = hasValidConfig ? manifest.projectDocs || {} : {};
  const contextMap = parseContextMap(root, projectDocs.contextMap || projectDocs.contextMapPath);
  const paths = {};

  for (const zone of ZONES) {
    const explicit = configuredZonePath(root, projectDocs, zone);
    const inferred = contextMap
      ? { path: contextMap.resolvedPath, source: 'context-map', resolution: 'explicit', mapPath: contextMap.path }
      : (explicit ? null : inferredZonePath(root, projectDocs, zone));
    const selected = inferred || explicit || {
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
      ...(contextMap ? { contextMap: contextMap.path, contextPaths: contextMap.links } : {})
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
    projectDocsStatus: manifest.status,
    projectDocsSources: manifest.sources,
    projectDocsWarnings: manifest.warnings,
    projectDocsDiagnostics: manifest.diagnostics,
    projectDocs: hasValidConfig && manifest.file ? { ...projectDocs, manifestPath: manifest.file } : null,
    contextMap: contextMap ? { path: contextMap.path, links: contextMap.links } : null,
    paths,
    // Plural aliases make the contract readable to callers that treat these
    // as zones, while the singular keys match the project-docs vocabulary.
    decisions: paths.decision,
    domains: paths.domain,
    architectures: paths.architecture
  };
}

function detectProjectDocsConventions(workspaceRoot, options = {}) {
  const REQUIRED_CONFIG_FIELDS = ['docLocation', 'tracker', 'issueDefinition'];
  const resolvedRoot = workspaceRoot || getWorkspaceRoot();
  if (!resolvedRoot) return {};
  const root = path.resolve(resolvedRoot);
  const selection = resolveDocsConfig(root, options);
  if (selection.status === 'invalid' || selection.status === 'ambiguous') {
    return {
      status: selection.status,
      sources: selection.sources || [],
      warnings: selection.warnings || [],
      diagnostics: selection.diagnostics || [],
      missing: []
    };
  }
  const configured = selection.config || {};
  const inferred = {};
  for (const field of REQUIRED_CONFIG_FIELDS) {
    if (typeof configured[field] === 'string' && configured[field].trim()) inferred[field] = configured[field];
  }
  // Heuristic completion is a resource for UNSELECTED workspaces only: a
  // project or selected-host configuration is authoritative for exactly the
  // fields it declares, so missing selected fields are reported instead of
  // being silently authorized from workspace conventions.
  if (selection.status !== 'none') {
    const missing = REQUIRED_CONFIG_FIELDS.filter(field => !inferred[field]);
    return {
      ...inferred,
      status: selection.status,
      sources: selection.sources || [],
      warnings: selection.warnings || [],
      diagnostics: selection.diagnostics || [],
      missing
    };
  }
  if (!inferred.docLocation) {
    for (const dir of ['docs/roadmaps', 'docs/reference', 'docs/specs', 'docs', 'doc']) {
      if (pathIsDir(path.join(root, dir))) {
        inferred.docLocation = `${dir}/`;
        break;
      }
    }
  }
  if (!inferred.tracker) {
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
  }
  if (!inferred.issueDefinition) {
    if (inferred.tracker && inferred.tracker.includes('ISSUE_TEMPLATE')) {
      inferred.issueDefinition = '.github/ISSUE_TEMPLATE/ template structure';
    } else if (inferred.tracker) {
      inferred.issueDefinition = 'Title + acceptance criteria + Status: ready-for-agent';
    }
  }
  const missing = REQUIRED_CONFIG_FIELDS.filter(field => !inferred[field]);
  return {
    ...inferred,
    status: selection.status,
    sources: selection.sources || [],
    warnings: selection.warnings || [],
    diagnostics: selection.diagnostics || [],
    missing
  };
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
  resolveDocsConfig,
  validateDocsConfig,
  normalizeHostProjectDocs,
  parseContextMap,
  resolveProjectDocs,
  detectProjectDocsConventions,
  ensureCommittableFallback,
  isIgnored,
  relativePath,
  isWithinWorkspace
};
