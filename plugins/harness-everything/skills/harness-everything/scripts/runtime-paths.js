'use strict';

const fs = require('fs');
const path = require('path');

// Helpers live in both the source checkout and the packaged plugin's skill
// tree. Resolve the owning runtime root instead of assuming either layout.
function candidateRoots() {
  return [
    path.resolve(__dirname, '..', '..'),
    path.resolve(__dirname, '..', '..', '..'),
  ];
}

function getHarnessRoot() {
  const root = candidateRoots().find(candidate =>
    fs.existsSync(path.join(candidate, 'scripts', 'lib', 'workspace.js'))
  );
  if (!root) {
    throw new Error(`Harness runtime root not found from ${__dirname}`);
  }
  return root;
}

function requireWorkspace() {
  return require(path.join(getHarnessRoot(), 'scripts', 'lib', 'workspace.js'));
}

function requireHarnessState() {
  return require(path.join(getHarnessRoot(), 'hooks', 'scripts', 'lib', 'harness-state.js'));
}

module.exports = {
  getHarnessRoot,
  requireWorkspace,
  requireHarnessState,
};
