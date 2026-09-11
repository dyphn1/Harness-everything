'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFileSync } = require('child_process');

const SUPPORTED_PLATFORMS = Object.freeze([
  'antigravity', 'gemini-cli', 'opencode', 'cursor', 'aider', 'windsurf',
  'openclaw', 'qwen', 'zcode', 'kimi', 'codex', 'osaurus', 'hermes', 'vibe'
]);

function scalar(value) {
  const trimmed = value.trim();
  if ((trimmed.startsWith('"') && trimmed.endsWith('"')) ||
      (trimmed.startsWith("'") && trimmed.endsWith("'"))) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

function parseFrontmatter(raw, filePath) {
  const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!match) throw new Error(`agent file lacks YAML frontmatter: ${filePath}`);
  const fields = {};
  for (const line of match[1].split(/\r?\n/)) {
    if (!line.trim() || line.trim().startsWith('#')) continue;
    const field = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
    if (field) fields[field[1]] = scalar(field[2]);
  }
  if (!fields.name || !fields.description) {
    throw new Error(`agent frontmatter requires name and description: ${filePath}`);
  }
  return fields;
}

function slugify(value) {
  const slug = value.normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  if (!slug) throw new Error(`agent name cannot produce a safe slug: ${value}`);
  return slug;
}

function safeSegment(value, label) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(value)) {
    throw new Error(`${label} must be a single safe path segment: ${value}`);
  }
  return value;
}

function sourceIdentity(sourceRoot) {
  let revision = null;
  try {
    revision = execFileSync('git', ['-C', sourceRoot, 'rev-parse', 'HEAD'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    // A source export may not be a Git checkout; use a content fingerprint.
  }
  if (!revision) {
    const hash = crypto.createHash('sha256');
    const files = [];
    const walk = dir => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (entry.name === '.git' || entry.name === 'integrations' || entry.name === 'scripts') continue;
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(full);
        else if (entry.name === 'divisions.json' || entry.name.endsWith('.md')) files.push(full);
      }
    };
    walk(sourceRoot);
    for (const file of files.sort()) {
      hash.update(path.relative(sourceRoot, file).replace(/\\/g, '/'));
      hash.update('\0');
      hash.update(fs.readFileSync(file));
    }
    revision = `export-${hash.digest('hex').slice(0, 40)}`;
  }
  let version = null;
  const packagePath = path.join(sourceRoot, 'package.json');
  if (fs.existsSync(packagePath)) {
    try { version = JSON.parse(fs.readFileSync(packagePath, 'utf8')).version || null; } catch { /* optional */ }
  }
  return { revision, version };
}

function readAgencyCatalog(sourceRoot) {
  const root = path.resolve(sourceRoot);
  if (!fs.existsSync(root) || !fs.statSync(root).isDirectory()) {
    throw new Error(`agency source not found: ${root}`);
  }
  const divisionsPath = path.join(root, 'divisions.json');
  if (!fs.existsSync(divisionsPath)) throw new Error(`agency source is missing divisions.json: ${root}`);

  let divisionsManifest;
  try { divisionsManifest = JSON.parse(fs.readFileSync(divisionsPath, 'utf8')); }
  catch (error) { throw new Error(`invalid divisions.json: ${error.message}`); }
  if (!divisionsManifest.divisions || typeof divisionsManifest.divisions !== 'object') {
    throw new Error('divisions.json must contain a divisions object');
  }

  const divisions = [];
  const agents = [];
  const seenNames = new Map();
  const seenSlugs = new Map();
  for (const [rawId, metadata] of Object.entries(divisionsManifest.divisions).sort(([a], [b]) => a.localeCompare(b))) {
    const id = safeSegment(rawId, 'division id');
    const divisionPath = path.join(root, id);
    if (!fs.existsSync(divisionPath) || !fs.statSync(divisionPath).isDirectory()) {
      throw new Error(`division directory is missing: ${id}`);
    }
    const files = fs.readdirSync(divisionPath).filter(file => file.endsWith('.md')).sort();
    if (files.length === 0) throw new Error(`division is empty: ${id}`);
    const divisionAgents = [];
    for (const file of files) {
      const absolutePath = path.join(divisionPath, file);
      const fields = parseFrontmatter(fs.readFileSync(absolutePath, 'utf8'), absolutePath);
      const slug = slugify(path.basename(file, '.md'));
      const normalizedName = fields.name.toLowerCase();
      if (seenNames.has(normalizedName)) {
        throw new Error(`duplicate agent name "${fields.name}" in ${seenNames.get(normalizedName)} and ${absolutePath}`);
      }
      if (seenSlugs.has(slug)) {
        throw new Error(`duplicate agent slug "${slug}" in ${seenSlugs.get(slug)} and ${absolutePath}`);
      }
      seenNames.set(normalizedName, absolutePath);
      seenSlugs.set(slug, absolutePath);
      const agent = {
        slug,
        name: fields.name,
        description: fields.description,
        division: id,
        sourceFile: path.relative(root, absolutePath).replace(/\\/g, '/'),
        color: fields.color || null,
        emoji: fields.emoji || null,
        vibe: fields.vibe || null
      };
      divisionAgents.push(agent);
      agents.push(agent);
    }
    divisions.push({
      id,
      label: metadata && metadata.label ? metadata.label : id,
      icon: metadata && metadata.icon ? metadata.icon : null,
      color: metadata && metadata.color ? metadata.color : null,
      agentCount: divisionAgents.length,
      agents: divisionAgents
    });
  }

  const identity = sourceIdentity(root);
  return {
    source: {
      kind: 'agency-agents',
      locator: path.basename(root),
      revision: identity.revision,
      version: identity.version,
      divisionCount: divisions.length,
      agentCount: agents.length,
      converterTargets: SUPPORTED_PLATFORMS
    },
    divisions,
    agents
  };
}

function resolveSelection(catalog, divisionIds = [], agentIds = [], allAgents = false) {
  const divisionMap = new Map(catalog.divisions.map(division => [division.id, division]));
  const agentMap = new Map(catalog.agents.map(agent => [agent.slug, agent]));
  const nameMap = new Map(catalog.agents.map(agent => [agent.name.toLowerCase(), agent]));
  const selected = new Map();
  const requestedDivisions = [...new Set(divisionIds)].sort();
  for (const id of requestedDivisions) {
    if (!divisionMap.has(id)) throw new Error(`unknown agency division: ${id}`);
    for (const agent of divisionMap.get(id).agents) selected.set(agent.slug, agent);
  }
  if (allAgents) for (const agent of catalog.agents) selected.set(agent.slug, agent);
  for (const requested of [...new Set(agentIds)]) {
    const agent = agentMap.get(requested) || nameMap.get(requested.toLowerCase());
    if (!agent) throw new Error(`unknown agency agent: ${requested}`);
    selected.set(agent.slug, agent);
  }
  return {
    divisionIds: requestedDivisions,
    agents: [...selected.values()].sort((a, b) => a.slug.localeCompare(b.slug))
  };
}

module.exports = { SUPPORTED_PLATFORMS, parseFrontmatter, readAgencyCatalog, resolveSelection, safeSegment, slugify };
