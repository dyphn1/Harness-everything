'use strict';

const fs = require('fs');
const path = require('path');

function workspaceError(code, message, cause) {
  const error = new Error(`${code}: ${message}${cause ? ` (${cause.code || cause.name}: ${cause.message})` : ''}`, { cause });
  error.code = code;
  return error;
}

let helper;
function loadHelper() {
  if (helper) return helper;
  const attempted = [
    path.resolve(__dirname, '../../scripts/lib/workspace.js'),
    path.resolve(__dirname, '../../../scripts/lib/workspace.js'),
  ];
  for (const candidate of attempted) {
    try {
      // Only an absent candidate permits trying the other supported layout.
      // A missing dependency or malformed existing module must remain visible.
      fs.statSync(candidate);
    } catch (error) {
      if (error.code === 'ENOENT' || error.code === 'ENOTDIR') continue;
      throw workspaceError('WORKSPACE_HELPER_UNAVAILABLE', `cannot access ${candidate}`, error);
    }
    try {
      const loaded = require(candidate);
      for (const name of ['getWorkspaceRoot', 'getWorkspaceStateDir', 'getWorkspaceKey']) {
        if (typeof loaded[name] !== 'function') throw new Error(`missing ${name} export`);
      }
      helper = loaded;
      return helper;
    } catch (error) {
      throw workspaceError('WORKSPACE_HELPER_UNAVAILABLE', `cannot load ${candidate}; attempted ${attempted.join(', ')}`, error);
    }
  }
  throw workspaceError('WORKSPACE_HELPER_UNAVAILABLE', `canonical helper missing; attempted ${attempted.join(', ')}`);
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
