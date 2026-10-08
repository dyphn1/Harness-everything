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

// Returns { availability, file }: `available` with an absolute readable file,
// `missing` when a declared path resolves nowhere, or `unknown` when neither a
// path nor a registered generated skill names a location.
function resolveBinding(binding, workspaceRoot, options = {}) {
  const roots = options.builtIn
    ? [...packageRoots(), workspaceRoot]
    : [workspaceRoot, ...packageRoots()];
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

module.exports = { resolveBinding, packageRoots };
