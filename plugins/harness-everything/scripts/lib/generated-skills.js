'use strict';

// Metadata-only lookup of self-evolved skills registered in Harness
// manifests. The router uses it to emit step-input signals (ids only); the
// workflow runtime uses it to resolve a declared binding id to its SKILL.md
// once the declaring step is active. Nothing here reads or injects skill text.
const fs = require('fs');
const path = require('path');

const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const STOP_TRIGGERS = new Set(['the', 'and', 'for', 'with', 'your', 'this', 'that', 'some', 'from', 'prevent', 'resolved']);

function generatedManifestPaths(workspaceRoot, homeDir = process.env.HOME || process.env.USERPROFILE || '') {
  const paths = [];
  if (workspaceRoot) {
    for (const platform of ['.claude', '.cursor', '.github', '.codex', '.continue']) {
      paths.push(path.join(workspaceRoot, platform, 'harness-everything', 'manifest.json'));
    }
  }
  if (homeDir) {
    paths.push(path.join(homeDir, '.agents', 'harness-everything', 'manifest.json'));
    paths.push(path.join(homeDir, '.claude', 'harness-everything', 'manifest.json'));
  }
  return paths;
}

function readGeneratedSkills(workspaceRoot, homeDir) {
  const skills = new Map();
  for (const manifestPath of generatedManifestPaths(workspaceRoot, homeDir)) {
    let data;
    try { data = JSON.parse(fs.readFileSync(manifestPath, 'utf8')); } catch (_) { continue; }
    if (!Array.isArray(data?.generated)) continue;
    for (const entry of data.generated) {
      const id = typeof entry?.id === 'string' ? entry.id.trim() : '';
      if (!SAFE_ID.test(id) || skills.has(id) || typeof entry.dirPath !== 'string' || !entry.dirPath.trim()) continue;
      const dirPath = path.isAbsolute(entry.dirPath)
        ? entry.dirPath
        : path.resolve(workspaceRoot || path.dirname(manifestPath), entry.dirPath);
      skills.set(id, {
        id,
        dirPath,
        triggers: Array.isArray(entry.triggers) ? entry.triggers.filter(value => typeof value === 'string') : [],
      });
    }
  }
  return skills;
}

function triggerScore(promptLower, rawTrigger) {
  const trigger = rawTrigger.toLowerCase().trim();
  if (trigger.length < 2 || STOP_TRIGGERS.has(trigger)) return 0;
  if (/[一-龥]/.test(trigger)) return promptLower.includes(trigger) ? trigger.length * 2 : 0;
  const escaped = trigger.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&');
  if (!new RegExp(`\\b${escaped}\\b`, 'i').test(promptLower)) return 0;
  return trigger.length >= 4 ? 3 : 1.5;
}

// Returns matching generated-skill ids, strongest match first.
function matchGeneratedSkills(promptLower, skills) {
  const matched = [];
  for (const skill of skills.values()) {
    const score = skill.triggers.reduce((total, trigger) => total + triggerScore(promptLower, trigger), 0);
    if (score >= 3) matched.push({ id: skill.id, score });
  }
  return matched.sort((a, b) => b.score - a.score).map(item => item.id);
}

function findGeneratedSkill(id, workspaceRoot, homeDir) {
  if (!SAFE_ID.test(id || '')) return null;
  return readGeneratedSkills(workspaceRoot, homeDir).get(id) || null;
}

module.exports = {
  generatedManifestPaths,
  readGeneratedSkills,
  matchGeneratedSkills,
  findGeneratedSkill,
};
