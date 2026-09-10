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

function commandTokens(command) {
  if (typeof command !== 'string') return [];
  return command.match(/"[^"]*"|'[^']*'|\S+/g) || [];
}

function commandMatches(actual, expected) {
  if (commandsEqual(actual, expected)) return true;
  if (typeof actual !== 'string' || typeof expected !== 'string') return false;
  const target = expected.trim();
  if (!target || /\s/.test(target) || !/\.(?:c?js|mjs|py|sh|ps1|bat|cmd)$/i.test(target)) return false;
  const expectedName = path.basename(target.replace(/\\/g, '/')).toLowerCase();
  const tokens = commandTokens(actual).map((token) => token.replace(/^['"]|['"]$/g, ''));
  if (tokens.length < 2) return false;
  const launcher = path.basename(tokens[0].replace(/\\/g, '/')).toLowerCase();
  if (!new Set(['node', 'node.exe', 'bun', 'bun.exe', 'deno', 'deno.exe', 'python', 'python.exe', 'python3', 'python3.exe', 'ruby', 'ruby.exe']).has(launcher)) return false;
  return tokens.slice(1).some((token) => path.basename(token.replace(/\\/g, '/')).toLowerCase() === expectedName);
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
  commandMatches,
  commandsEqual,
  extractPatchPaths,
  normalizeCommand,
  normalizeRepoPath,
  patchPathsAuthorized,
};
