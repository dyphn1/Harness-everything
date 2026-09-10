'use strict';

const fs = require('fs');
const path = require('path');

function canonicalizePath(value) {
  let current = path.resolve(value);
  const missing = [];
  while (!fs.existsSync(current)) {
    const parent = path.dirname(current);
    if (parent === current) break;
    missing.unshift(path.basename(current));
    current = parent;
  }
  let existing = current;
  try { existing = fs.realpathSync.native ? fs.realpathSync.native(current) : fs.realpathSync(current); }
  catch { /* retain the nearest existing lexical ancestor */ }
  return path.join(existing, ...missing);
}

function isWithin(root, target) {
  const relative = path.relative(root, target);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function assertNoLinkComponents(root, target) {
  const relative = path.relative(path.resolve(root), path.resolve(target));
  if (relative.startsWith('..') || path.isAbsolute(relative)) return;
  let current = path.resolve(root);
  for (const component of relative ? relative.split(path.sep) : []) {
    current = path.join(current, component);
    let stat;
    try { stat = fs.lstatSync(current); } catch { continue; }
    if (stat.isSymbolicLink()) {
      const error = new Error(`path contains a link component inside boundary: ${current}`);
      error.code = 'LINK_COMPONENT_IN_BOUNDARY';
      throw error;
    }
  }
}

function assertContainedPath(root, target) {
  if (typeof root !== 'string' || typeof target !== 'string') {
    const error = new TypeError('path boundary requires string root and target');
    error.code = 'INVALID_BOUNDARY_PATH';
    throw error;
  }
  assertNoLinkComponents(root, target);
  const canonicalRoot = canonicalizePath(root);
  const canonicalTarget = canonicalizePath(target);
  if (!isWithin(canonicalRoot, canonicalTarget)) {
    const error = new Error(`path escapes boundary: ${target}`);
    error.code = 'PATH_OUTSIDE_BOUNDARY';
    throw error;
  }
  return { root: canonicalRoot, target: canonicalTarget };
}

module.exports = { assertContainedPath };
