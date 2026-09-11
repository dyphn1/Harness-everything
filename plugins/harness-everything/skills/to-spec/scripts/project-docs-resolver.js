#!/usr/bin/env node
'use strict';

// In the source tree this is the single shared resolver. A to-spec-only
// installation has no sibling multi-agent skill, so its fallback preserves
// the same explicit/inferred/fallback provenance contract locally.
try {
  module.exports = require('../../multi-agent-workspace/scripts/project-docs-resolver');
} catch (error) {
  const fs = require('fs');
  const os = require('os');
  const path = require('path');
  const crypto = require('crypto');
  const PLATFORM_HOMES = Object.freeze(['.claude', '.cursor', '.github', '.codex', '.continue']);
  function getWorkspaceRoot(start = process.cwd()) {
    let dir = path.resolve(start);
    while (dir !== path.parse(dir).root) {
      if (fs.existsSync(path.join(dir, '.git'))) return dir;
      dir = path.dirname(dir);
    }
    return path.resolve(start);
  }
  function getRepoManifestHomes(root) { return PLATFORM_HOMES.map(home => path.join(root, home)); }
  function readProjectDocs(root) {
    for (const home of getRepoManifestHomes(root)) {
      const file = path.join(home, 'harness-everything', 'manifest.json');
      try {
        const data = JSON.parse(fs.readFileSync(file, 'utf8'));
        if (data.projectDocs) return { file, projectDocs: data.projectDocs };
      } catch { /* not bootstrapped or invalid; the check command reports it */ }
    }
    return null;
  }
  function getWorkspaceKey(root) {
    let real = path.resolve(root);
    try { real = fs.realpathSync(real); } catch { /* best effort */ }
    const slug = path.basename(real).toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '') || 'workspace';
    return `${slug}-${crypto.createHash('sha1').update(real).digest('hex').slice(0, 12)}`;
  }
  function getStateHome() { return process.env.HARNESS_STATE_HOME || path.join(os.homedir(), '.agents', 'harness-everything'); }
  function getRuntimeRoot(root) { return path.join(getStateHome(), 'workspaces', getWorkspaceKey(root), 'multi-agent'); }
  function resolveProjectDocs(root) {
    const workspaceRoot = path.resolve(root);
    const manifest = readProjectDocs(workspaceRoot);
    const docs = manifest ? manifest.projectDocs : {};
    const fields = {
      decision: ['decisionLocation', 'decisions', 'adrLocation', 'adr'],
      domain: ['domainLocation', 'domains', 'contextLocation', 'contexts', 'domain'],
      architecture: ['architectureLocation', 'architectures', 'architecture']
    };
    const conventional = {
      decision: ['docs/adr', 'docs/decisions', 'adr', 'decisions'],
      domain: ['docs/domain', 'docs/contexts', 'domain', 'contexts'],
      architecture: ['docs/architecture', 'architecture']
    };
    const fallback = { decision: 'docs/adr', domain: 'docs/domain', architecture: 'docs/architecture' };
    const paths = {};
    for (const zone of Object.keys(fields)) {
      let selected = null;
      for (const field of fields[zone]) {
        if (typeof docs[field] === 'string' && docs[field].trim()) {
          selected = { path: path.resolve(workspaceRoot, docs[field]), source: 'projectDocs', resolution: 'explicit', field };
          break;
        }
      }
      if (!selected && docs.docLocation) {
        const base = path.resolve(workspaceRoot, docs.docLocation);
        const names = { decision: ['adr', 'decisions'], domain: ['domain', 'contexts'], architecture: ['architecture'] }[zone];
        selected = { path: names.includes(path.basename(base).toLowerCase()) ? base : path.join(base, names[0]), source: 'projectDocs', resolution: 'inferred' };
      }
      if (!selected) {
        const existing = conventional[zone].map(item => path.join(workspaceRoot, item)).find(item => {
          try { return fs.statSync(item).isDirectory(); } catch { return false; }
        });
        if (existing) selected = { path: existing, source: 'inference', resolution: 'inferred' };
      }
      if (!selected) selected = { path: path.join(workspaceRoot, fallback[zone]), source: 'fallback', resolution: 'fallback' };
      paths[zone] = { path: path.resolve(selected.path), relativePath: path.relative(workspaceRoot, selected.path).replace(/\\/g, '/'), source: selected.source, resolution: selected.resolution || selected.source, origin: selected.source, ...(selected.field ? { field: selected.field } : {}) };
    }
    const runtimeRoot = getRuntimeRoot(workspaceRoot);
    return {
      workspaceRoot,
      workspaceKey: getWorkspaceKey(workspaceRoot),
      stateHome: getStateHome(),
      runtimeRoot,
      runtime: { root: runtimeRoot, state: path.join(runtimeRoot, 'state'), logs: path.join(runtimeRoot, 'logs'), roles: path.join(runtimeRoot, 'roles') },
      projectDocs: manifest ? { ...manifest.projectDocs, manifestPath: manifest.file } : null,
      paths,
      decisions: paths.decision,
      domains: paths.domain,
      architectures: paths.architecture
    };
  }
  function detectProjectDocsConventions(root) {
    const workspaceRoot = path.resolve(root);
    const configured = readProjectDocs(workspaceRoot);
    const inferred = configured && configured.projectDocs && configured.projectDocs.docLocation
      ? { docLocation: configured.projectDocs.docLocation } : {};
    if (!inferred.docLocation) {
      for (const dir of ['docs/roadmaps', 'docs/reference', 'docs/specs', 'docs', 'doc']) {
        if (fs.existsSync(path.join(workspaceRoot, dir))) { inferred.docLocation = `${dir}/`; break; }
      }
    }
    if (fs.existsSync(path.join(workspaceRoot, '.github', 'ISSUE_TEMPLATE'))) inferred.tracker = 'GitHub Issues via .github/ISSUE_TEMPLATE/';
    else if (inferred.docLocation) inferred.tracker = `${inferred.docLocation}tickets/ local markdown tickets`;
    if (inferred.tracker && inferred.tracker.includes('ISSUE_TEMPLATE')) inferred.issueDefinition = '.github/ISSUE_TEMPLATE/ template structure';
    else if (inferred.tracker) inferred.issueDefinition = 'Title + acceptance criteria + Status: ready-for-agent';
    return inferred;
  }
  module.exports = { PLATFORM_HOMES, getWorkspaceRoot, getStateHome, getRuntimeRoot, getWorkspaceKey, getRepoManifestHomes, readProjectDocs, resolveProjectDocs, detectProjectDocsConventions, ensureCommittableFallback: resolution => resolution };
}
