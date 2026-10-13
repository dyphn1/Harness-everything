'use strict';

// Resolves a declared step/stage binding to a real, readable file. A binding
// path is availability evidence only after it resolves under the workspace or
// an installed Harness skill root; path syntax alone proves nothing.
const fs = require('fs');
const path = require('path');

function loadGeneratedSkills() {
  const file = path.resolve(__dirname, '..', '..', '..', 'scripts', 'lib', 'generated-skills.js');
  return fs.existsSync(file) ? require(file) : null;
}

// Source checkout and Claude plugin keep skills at the package root; the
// Codex plugin keeps them under skills/. Host-provided plugin roots win.
function packageRoots() {
  const packageRoot = path.resolve(__dirname, '..', '..', '..');
  const roots = [];
  for (const root of [process.env.CLAUDE_PLUGIN_ROOT, process.env.PLUGIN_ROOT, packageRoot]) {
    if (!root) continue;
    roots.push(path.resolve(root), path.resolve(root, 'skills'));
  }
  return [...new Set(roots)];
}

function readableFile(file) {
  try {
    if (!fs.statSync(file).isFile()) return false;
    fs.accessSync(file, fs.constants.R_OK);
    return true;
  } catch (_) {
    return false;
  }
}

// Registered Harness bindings and the path each one loads.
const PACKAGED_BINDING_PATHS = {
  tdd: 'tdd/SKILL.md',
  'verification-loop': 'verification-loop/SKILL.md',
  'git-commit': 'git-commit/SKILL.md',
  'security-review': 'security-review/SKILL.md',
  'review-guidance': 'harness-everything/references/triage-and-tiers.md',
};
const SKILL_ID = /^[a-z0-9][a-z0-9-]{0,63}$/;

// Only a recognized Harness binding may search installation roots: a
// registered id at its registered path, or a skill id naming its own
// `<id>/SKILL.md`. Any other path is a workspace reference and must never
// resolve to an unrelated file that happens to exist in the Harness package.
function isPackagedBinding(binding) {
  if (!binding.path) return false;
  if (PACKAGED_BINDING_PATHS[binding.id]) return PACKAGED_BINDING_PATHS[binding.id] === binding.path;
  return SKILL_ID.test(binding.id || '') && binding.path === `${binding.id}/SKILL.md`;
}

// Returns { availability, file }: `available` with an absolute readable file,
// `missing` when a declared path resolves nowhere, or `unknown` when neither a
// path nor a registered generated skill names a location.
function resolveBinding(binding, workspaceRoot) {
  const roots = isPackagedBinding(binding) ? [...packageRoots(), workspaceRoot] : [workspaceRoot];
  if (binding.path) {
    for (const root of roots.filter(Boolean)) {
      const file = path.resolve(root, binding.path);
      if (readableFile(file)) return { availability: 'available', file };
    }
    return { availability: 'missing', file: null };
  }
  const generated = loadGeneratedSkills()?.findGeneratedSkill(binding.id, workspaceRoot);
  if (generated) {
    const file = path.join(generated.dirPath, 'SKILL.md');
    return readableFile(file) ? { availability: 'available', file } : { availability: 'missing', file: null };
  }
  return { availability: 'unknown', file: null };
}

module.exports = { resolveBinding, packageRoots, isPackagedBinding, PACKAGED_BINDING_PATHS };
