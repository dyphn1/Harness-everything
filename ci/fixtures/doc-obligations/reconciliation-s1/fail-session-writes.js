'use strict';

// #325 PR #351 review follow-up ("Unwritable session store"): test-only preload that simulates an
// unwritable session store for one child process, without chmod (cross-platform).
//
// Loaded through NODE_OPTIONS=--require <this file> onto the real Stop entry point by
// ci/mechanism-325-3b-s1-review.test.js. The integration test passes the target session directory in the
// HARNESS_S1_REVIEW_SESSION_DIR environment variable. While that variable names a directory, every
// write/rename/open-for-write/unlink whose target is inside it fails with EACCES and nothing else is
// intercepted: reads, mkdir, and writes outside the session directory keep working, so a failed write
// cannot be confused with a skipped or missing one. Without the variable this preload is inert.

const fs = require('fs');
const path = require('path');

(function install() {
  const sessionDirectory = process.env.HARNESS_S1_REVIEW_SESSION_DIR;
  if (!sessionDirectory) return;
  let resolvedDirectory;
  try { resolvedDirectory = path.resolve(sessionDirectory); } catch (_) { return; }
  if (!resolvedDirectory || resolvedDirectory === '/') return;

  function unwritable(target) {
    if (target === undefined || target === null) return false;
    try {
      const resolved = path.resolve(String(target));
      const relative = path.relative(resolvedDirectory, resolved);
      return relative === '' || (!relative.startsWith('..' + path.sep) && relative !== '..' && !path.isAbsolute(relative));
    } catch (_) { return false; }
  }

  function writeTargetOpenFlags(flags) {
    // open()/openSync() only fail for write-capable flags; 'r' stays readable.
    const value = String(flags || 'r');
    return value.startsWith('w') || value.startsWith('a') || value.includes('+') || value.includes('x');
  }

  function eacces(method, target) {
    const error = new Error(`EACCES: permission denied, ${method} ${target} (simulated session store write failure)`);
    error.code = 'EACCES';
    error.errno = -13;
    error.syscall = method;
    error.path = String(target);
    return error;
  }

  const originalWriteFileSync = fs.writeFileSync;
  fs.writeFileSync = function (file, ...rest) {
    if (unwritable(file)) throw eacces('write', file);
    return originalWriteFileSync.call(fs, file, ...rest);
  };

  const originalRenameSync = fs.renameSync;
  fs.renameSync = function (from, to, ...rest) {
    if (unwritable(from) || unwritable(to)) throw eacces('rename', from);
    return originalRenameSync.call(fs, from, to, ...rest);
  };

  const originalOpenSync = fs.openSync;
  fs.openSync = function (file, flags, ...rest) {
    if (unwritable(file) && writeTargetOpenFlags(flags)) throw eacces('open', file);
    return originalOpenSync.call(fs, file, flags, ...rest);
  };

  const originalUnlinkSync = fs.unlinkSync;
  fs.unlinkSync = function (file, ...rest) {
    if (unwritable(file)) throw eacces('unlink', file);
    return originalUnlinkSync.call(fs, file, ...rest);
  };

  // Callback forms used by async production paths, if any.
  const normalizeCallback = args => (typeof args[args.length - 1] === 'function' ? args[args.length - 1] : () => {});
  const originalWriteFile = fs.writeFile;
  fs.writeFile = function (file, data, ...rest) {
    const callback = normalizeCallback(rest);
    if (unwritable(file)) return process.nextTick(() => callback(eacces('write', file)));
    return originalWriteFile.call(fs, file, data, ...rest);
  };
  const originalRename = fs.rename;
  fs.rename = function (from, to, ...rest) {
    const callback = normalizeCallback(rest);
    if (unwritable(from) || unwritable(to)) return process.nextTick(() => callback(eacces('rename', from)));
    return originalRename.call(fs, from, to, ...rest);
  };
  const originalUnlink = fs.unlink;
  fs.unlink = function (file, ...rest) {
    const callback = normalizeCallback(rest);
    if (unwritable(file)) return process.nextTick(() => callback(eacces('unlink', file)));
    return originalUnlink.call(fs, file, ...rest);
  };

  // fs.promises equivalents, if any production path uses them.
  const promises = fs.promises || null;
  if (promises) {
    const originalPromisesWriteFile = promises.writeFile;
    promises.writeFile = function (file, data, ...rest) {
      if (unwritable(file)) return Promise.reject(eacces('write', file));
      return originalPromisesWriteFile.call(promises, file, data, ...rest);
    };
    const originalPromisesRename = promises.rename;
    promises.rename = function (from, to, ...rest) {
      if (unwritable(from) || unwritable(to)) return Promise.reject(eacces('rename', from));
      return originalPromisesRename.call(promises, from, to, ...rest);
    };
    const originalPromisesUnlink = promises.unlink;
    promises.unlink = function (file, ...rest) {
      if (unwritable(file)) return Promise.reject(eacces('unlink', file));
      return originalPromisesUnlink.call(promises, file, ...rest);
    };
    const originalPromisesOpen = promises.open;
    promises.open = function (file, flags, ...rest) {
      if (unwritable(file) && writeTargetOpenFlags(flags)) return Promise.reject(eacces('open', file));
      return originalPromisesOpen.call(promises, file, flags, ...rest);
    };
  }
})();
