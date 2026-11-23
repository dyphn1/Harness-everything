'use strict';

const path = require('path');
const fs = require('fs');

function readJsonStdin(timeoutMs = 1500) {
  return new Promise(resolve => {
    let raw = '';
    let settled = false;

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      try {
        resolve(raw.trim() ? JSON.parse(raw) : {});
      } catch (_) {
        resolve({});
      }
    }, timeoutMs);

    process.stdin.setEncoding('utf8');
    process.stdin.on('data', chunk => { raw += chunk; });
    process.stdin.on('end', () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try {
        resolve(raw.trim() ? JSON.parse(raw) : {});
      } catch (_) {
        resolve({});
      }
    });
    process.stdin.on('error', () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({});
    });
  });
}

function resolveKernelRouter() {
  const candidates = [
    path.join(__dirname, '..', '..', '..', 'skills', 'harness-everything', 'scripts', 'kernel-router.js'),
    path.join(__dirname, '..', '..', '..', 'harness-everything', 'scripts', 'kernel-router.js'),
    path.join(__dirname, '..', '..', 'harness-everything', 'scripts', 'kernel-router.js')
  ];
  return candidates.find(candidate => fs.existsSync(candidate)) || null;
}

function getAgySessionId(payload) {
  if (!payload || typeof payload !== 'object') return '';
  const candidate = payload.conversationId || payload.session_id || payload.sessionId || '';
  return typeof candidate === 'string' ? candidate.trim() : String(candidate || '').trim();
}

function getAgyWorkspacePaths(payload) {
  if (!payload || typeof payload !== 'object') return [];
  const roots = [];
  if (Array.isArray(payload.workspacePaths)) {
    for (const entry of payload.workspacePaths) {
      if (typeof entry === 'string' && entry.trim()) roots.push(entry.trim());
    }
  }
  if (typeof payload.cwd === 'string' && payload.cwd.trim()) {
    roots.push(payload.cwd.trim());
  }
  return [...new Set(roots)];
}

function getAgyEffectiveCwd(payload) {
  if (payload && typeof payload === 'object') {
    if (typeof payload.cwd === 'string' && payload.cwd.trim()) {
      return payload.cwd.trim();
    }
    if (Array.isArray(payload.workspacePaths)) {
      const first = payload.workspacePaths.find(entry => typeof entry === 'string' && entry.trim());
      if (first) return first.trim();
    }
  }
  return process.cwd();
}

function normalizeAgyStatePayload(payload, overrideCwd) {
  const base = payload && typeof payload === 'object' ? payload : {};
  const sessionId = getAgySessionId(base);
  const effectiveCwd = (typeof overrideCwd === 'string' && overrideCwd.trim())
    ? overrideCwd.trim()
    : getAgyEffectiveCwd(base);

  return {
    ...base,
    ...(sessionId ? { session_id: sessionId, sessionId, conversationId: sessionId } : {}),
    cwd: effectiveCwd
  };
}

const MAX_SYMLINK_HOPS = 40;
const realpath = fs.realpathSync.native || fs.realpathSync;

function canonicalizePath(targetPath, baseDir, depth = 0) {
  if (depth > MAX_SYMLINK_HOPS) return null;
  if (typeof targetPath !== 'string' || !targetPath.trim()) return null;
  const resolved = (typeof baseDir === 'string' && baseDir.trim())
    ? path.resolve(baseDir, targetPath)
    : path.resolve(targetPath);

  try {
    return realpath(resolved);
  } catch (_) {
    const suffix = [];
    let current = resolved;
    while (true) {
      try {
        const stat = fs.lstatSync(current);
        if (stat.isSymbolicLink()) {
          const linkTarget = fs.readlinkSync(current);
          const resolvedLink = path.resolve(path.dirname(current), linkTarget);
          const nextPath = suffix.length > 0 ? path.join(resolvedLink, ...suffix) : resolvedLink;
          return canonicalizePath(nextPath, null, depth + 1);
        }
      } catch (_) {
        // Entry does not exist yet; continue ascending to nearest existing ancestor.
      }

      const parent = path.dirname(current);
      if (parent === current) return resolved;
      suffix.unshift(path.basename(current));
      current = parent;
      try {
        const realAncestor = realpath(current);
        return path.join(realAncestor, ...suffix);
      } catch (_) {}
    }
  }
}

function isOutOfBoundsPath(filePath, allowedRoots, baseDir) {
  if (typeof filePath !== 'string' || !filePath.trim()) return true;
  const roots = (Array.isArray(allowedRoots) ? allowedRoots : [allowedRoots])
    .filter(root => typeof root === 'string' && root.trim());
  if (roots.length === 0) return false;

  const resolveBase = (typeof baseDir === 'string' && baseDir.trim()) ? baseDir : roots[0];
  const canonicalTarget = canonicalizePath(filePath, resolveBase);
  if (!canonicalTarget) return true;

  const normTarget = process.platform === 'win32' ? canonicalTarget.toLowerCase() : canonicalTarget;
  return !roots.some(root => {
    const canonicalRoot = canonicalizePath(root);
    if (!canonicalRoot) return false;
    const normRoot = process.platform === 'win32' ? canonicalRoot.toLowerCase() : canonicalRoot;
    if (normTarget === normRoot) return true;
    const prefix = normRoot.endsWith(path.sep) ? normRoot : normRoot + path.sep;
    return normTarget.startsWith(prefix);
  });
}

module.exports = {
  readJsonStdin,
  resolveKernelRouter,
  getAgySessionId,
  getAgyWorkspacePaths,
  getAgyEffectiveCwd,
  normalizeAgyStatePayload,
  canonicalizePath,
  isOutOfBoundsPath
};
