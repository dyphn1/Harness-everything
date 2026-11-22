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

function isOutOfBoundsPath(filePath, rootDir) {
  if (!filePath || !rootDir) return false;
  const resolved = path.resolve(rootDir, filePath);
  const normalizedRoot = path.resolve(rootDir);
  // Allow paths within workspace
  return !resolved.startsWith(normalizedRoot + path.sep) && resolved !== normalizedRoot;
}

module.exports = {
  readJsonStdin,
  resolveKernelRouter,
  isOutOfBoundsPath
};
