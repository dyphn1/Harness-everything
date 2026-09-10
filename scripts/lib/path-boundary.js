const fs = require('fs');
const path = require('path');

function boundaryError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function realpath(p) {
  const resolver = fs.realpathSync.native || fs.realpathSync;
  return resolver(p);
}

// Resolve the deepest existing ancestor first, then append missing segments.
// This preserves the physical location of an existing junction/symlink even
// when the final file has not been created yet.
function canonicalizePath(candidate) {
  const absolute = path.resolve(candidate);
  const missing = [];
  let cursor = absolute;

  while (true) {
    try {
      fs.lstatSync(cursor);
      return path.join(realpath(cursor), ...missing);
    } catch (error) {
      if (!['ENOENT', 'ENOTDIR'].includes(error.code)) throw error;
      const parent = path.dirname(cursor);
      if (parent === cursor) return path.join(cursor, ...missing);
      missing.unshift(path.basename(cursor));
      cursor = parent;
    }
  }
}

function isWithin(root, candidate) {
  const relative = path.relative(root, candidate);
  return relative === '' || (
    relative !== '..' &&
    !relative.startsWith(`..${path.sep}`) &&
    !path.isAbsolute(relative)
  );
}

// A caller may intentionally choose a symlink as the boundary root. Links
// below that root are rejected so a later write/delete cannot follow an alias
// whose target was changed after the initial lexical path check.
function assertNoLinkComponents(root, candidate) {
  const lexicalRoot = path.resolve(root);
  const lexicalCandidate = path.resolve(candidate);
  const relative = path.relative(lexicalRoot, lexicalCandidate);
  if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) return;

  let cursor = lexicalRoot;
  for (const segment of relative ? relative.split(path.sep) : []) {
    cursor = path.join(cursor, segment);
    try {
      if (fs.lstatSync(cursor).isSymbolicLink()) {
        throw boundaryError('LINK_COMPONENT_IN_BOUNDARY', `Link component is not allowed below boundary: ${cursor}`);
      }
    } catch (error) {
      if (error.code === 'ENOENT' || error.code === 'ENOTDIR') break;
      throw error;
    }
  }
}

function assertContainedPath(root, candidate) {
  if (typeof root !== 'string' || typeof candidate !== 'string') {
    throw boundaryError('INVALID_PATH', 'Boundary root and candidate must be strings');
  }

  assertNoLinkComponents(root, candidate);
  const physicalRoot = canonicalizePath(root);
  const physicalCandidate = canonicalizePath(candidate);
  if (!isWithin(physicalRoot, physicalCandidate)) {
    throw boundaryError(
      'PATH_OUTSIDE_BOUNDARY',
      `Path escapes boundary: ${candidate} is outside ${root}`
    );
  }
  return { root: physicalRoot, target: physicalCandidate };
}

module.exports = {
  assertContainedPath,
  canonicalizePath,
  isWithin,
};
