'use strict';

const fs = require('fs');
const path = require('path');

function workspaceError(code, message, cause) {
  const error = new Error(`${code}: ${message}${cause ? ` (${cause.code || cause.name}: ${cause.message})` : ''}`, { cause });
  error.code = code;
  return error;
}

function readMarker(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch (error) {
    if (error.code === 'ENOENT') return null;
    throw workspaceError('WORKSPACE_HELPER_UNAVAILABLE', `cannot read installation marker ${file}`, error);
  }
}

let helper;
function loadHelper() {
  if (helper) return helper;
  const sourceRoot = path.resolve(__dirname, '../..');
  const sourceMarker = path.join(sourceRoot, 'package.json');
  const source = readMarker(sourceMarker);
  let installRoot;
  // A source checkout may itself be named "skills". Its own package marker
  // takes precedence, including when its helper is absent or broken.
  if (source) {
    if (source.name !== 'harness-everything') {
      throw workspaceError('WORKSPACE_HELPER_UNAVAILABLE', `unrecognized source installation marker ${sourceMarker}`);
    }
    installRoot = sourceRoot;
  } else {
    const pluginRoot = path.dirname(sourceRoot);
    const marker = path.join(pluginRoot, '.codex-plugin/plugin.json');
    const plugin = path.basename(sourceRoot) === 'skills' ? readMarker(marker) : null;
    if (!plugin || plugin.name !== 'harness-everything' || plugin.skills !== './skills/') {
      throw workspaceError('WORKSPACE_HELPER_UNAVAILABLE', `unrecognized layout; expected ${sourceMarker} or packaged skills under ${marker}`);
    }
    installRoot = pluginRoot;
  }
  const candidate = path.join(installRoot, 'scripts/lib/workspace.js');
  try {
    const loaded = require(candidate);
    for (const name of ['getWorkspaceRoot', 'getWorkspaceStateDir', 'getWorkspaceKey']) {
      if (typeof loaded[name] !== 'function') throw new Error(`missing ${name} export`);
    }
    helper = loaded;
    return helper;
  } catch (error) {
    throw workspaceError('WORKSPACE_HELPER_UNAVAILABLE', `cannot load selected installation helper ${candidate}`, error);
  }
}

function getWorkspaceRoot(context) {
  const loaded = loadHelper();
  let root;
  try { root = loaded.getWorkspaceRoot(context); }
  catch (error) { throw workspaceError('WORKSPACE_ROOT_UNRESOLVED', 'canonical workspace resolution failed', error); }
  if (typeof root !== 'string' || !root.trim()) {
    throw workspaceError('WORKSPACE_ROOT_UNRESOLVED', 'canonical resolver returned no workspace identity');
  }
  return root;
}

function getWorkspaceStateDir(root) {
  const loaded = loadHelper();
  if (typeof root !== 'string' || !root.trim()) {
    throw workspaceError('WORKSPACE_ROOT_UNRESOLVED', 'workspace identity is required for state access');
  }
  try {
    const state = loaded.getWorkspaceStateDir(root);
    if (typeof state !== 'string' || !state.trim()) throw new Error('canonical state path must be nonempty');
    // Missing state is valid for a new workspace. Existing non-directory or
    // inaccessible ancestors are not an empty candidate list.
    let ancestor = state;
    while (true) {
      try {
        if (!fs.statSync(ancestor).isDirectory()) throw new Error(`${ancestor} is not a directory`);
        fs.accessSync(ancestor, fs.constants.R_OK);
        break;
      } catch (error) {
        if (error.code !== 'ENOENT') throw error;
        const parent = path.dirname(ancestor);
        if (parent === ancestor) throw error;
        ancestor = parent;
      }
    }
    return state;
  } catch (error) {
    throw workspaceError('WORKSPACE_STATE_UNAVAILABLE', `cannot access canonical state for ${root}`, error);
  }
}

function getWorkspaceKey(root) { return loadHelper().getWorkspaceKey(root); }

module.exports = { getWorkspaceRoot, getWorkspaceStateDir, getWorkspaceKey, workspaceError };
