const path = require('path');

function normalizeCommand(command) {
  if (Array.isArray(command)) {
    return command.map((part) => String(part));
  }
  if (typeof command !== 'string') return null;
  return command.trim().replace(/\s+/g, ' ');
}

function commandsEqual(actual, expected) {
  const left = normalizeCommand(actual);
  const right = normalizeCommand(expected);
  if (Array.isArray(left) || Array.isArray(right)) {
    return Array.isArray(left) && Array.isArray(right) &&
      left.length === right.length && left.every((part, index) => part === right[index]);
  }
  return left !== null && left === right;
}

function normalizeRepoPath(value) {
  if (typeof value !== 'string') return null;
  const normalized = value.replace(/\\/g, '/').replace(/^\.\//, '');
  const segments = normalized.split('/');
  if (!normalized || normalized === '.' || path.posix.isAbsolute(normalized) || /^[A-Za-z]:\//.test(normalized) || segments.includes('..')) return null;
  return normalized;
}

function extractPatchPaths(patchText) {
  if (typeof patchText !== 'string') return [];
  const paths = [];
  const marker = /^\*\*\* (?:Update File|Add File|Delete File|Move to):\s*(.+?)\s*$/gm;
  for (const match of patchText.matchAll(marker)) {
    if (!paths.includes(match[1])) paths.push(match[1]);
  }
  return paths;
}

function patchPathsAuthorized(patchText, allowedPaths) {
  const paths = extractPatchPaths(patchText).map(normalizeRepoPath);
  const allowed = new Set(Array.from(allowedPaths || []).map(normalizeRepoPath));
  return paths.length > 0 && paths.every((candidate) => candidate && allowed.has(candidate));
}

module.exports = {
  commandsEqual,
  extractPatchPaths,
  normalizeCommand,
  patchPathsAuthorized,
};
