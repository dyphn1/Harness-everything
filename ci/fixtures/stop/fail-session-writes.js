'use strict';

// Test preload for real Stop hooks: reject writes whose target is inside one
// selected session directory while leaving reads and unrelated writes alone.
// The migration suite passes the target with HARNESS_STOP_TEST_SESSION_DIR.

const fs = require('node:fs');
const path = require('node:path');

(function install() {
  const sessionDirectory = process.env.HARNESS_STOP_TEST_SESSION_DIR;
  if (!sessionDirectory) return;
  let resolvedDirectory;
  try { resolvedDirectory = path.resolve(sessionDirectory); } catch (_) { return; }
  if (!resolvedDirectory || resolvedDirectory === path.parse(resolvedDirectory).root) return;

  function unwritable(target) {
    if (target === undefined || target === null) return false;
    try {
      const resolved = path.resolve(String(target));
      const relative = path.relative(resolvedDirectory, resolved);
      return relative === '' || (!relative.startsWith('..' + path.sep) && relative !== '..' && !path.isAbsolute(relative));
    } catch (_) { return false; }
  }

  function denied(method, target) {
    const error = new Error(`EACCES: permission denied, ${method} ${target} (simulated session store write failure)`);
    error.code = 'EACCES';
    error.errno = -13;
    error.syscall = method;
    error.path = String(target);
    return error;
  }

  const originalWriteFileSync = fs.writeFileSync;
  fs.writeFileSync = function (file, ...rest) {
    if (unwritable(file)) throw denied('write', file);
    return originalWriteFileSync.call(fs, file, ...rest);
  };

  const originalRenameSync = fs.renameSync;
  fs.renameSync = function (from, to, ...rest) {
    if (unwritable(from) || unwritable(to)) throw denied('rename', from);
    return originalRenameSync.call(fs, from, to, ...rest);
  };

  const originalOpenSync = fs.openSync;
  fs.openSync = function (file, flags, ...rest) {
    const value = String(flags || 'r');
    if (unwritable(file) && (value.startsWith('w') || value.startsWith('a') || value.includes('+') || value.includes('x'))) {
      throw denied('open', file);
    }
    return originalOpenSync.call(fs, file, flags, ...rest);
  };

  const originalUnlinkSync = fs.unlinkSync;
  fs.unlinkSync = function (file, ...rest) {
    if (unwritable(file)) throw denied('unlink', file);
    return originalUnlinkSync.call(fs, file, ...rest);
  };

  const callback = args => typeof args[args.length - 1] === 'function' ? args[args.length - 1] : () => {};
  const originalWriteFile = fs.writeFile;
  fs.writeFile = function (file, data, ...rest) {
    const done = callback(rest);
    if (unwritable(file)) return process.nextTick(() => done(denied('write', file)));
    return originalWriteFile.call(fs, file, data, ...rest);
  };

  const originalRename = fs.rename;
  fs.rename = function (from, to, ...rest) {
    const done = callback(rest);
    if (unwritable(from) || unwritable(to)) return process.nextTick(() => done(denied('rename', from)));
    return originalRename.call(fs, from, to, ...rest);
  };

  const originalUnlink = fs.unlink;
  fs.unlink = function (file, ...rest) {
    const done = callback(rest);
    if (unwritable(file)) return process.nextTick(() => done(denied('unlink', file)));
    return originalUnlink.call(fs, file, ...rest);
  };

  const promises = fs.promises;
  if (!promises) return;
  const originalPromisesWriteFile = promises.writeFile;
  promises.writeFile = function (file, data, ...rest) {
    if (unwritable(file)) return Promise.reject(denied('write', file));
    return originalPromisesWriteFile.call(promises, file, data, ...rest);
  };
  const originalPromisesRename = promises.rename;
  promises.rename = function (from, to, ...rest) {
    if (unwritable(from) || unwritable(to)) return Promise.reject(denied('rename', from));
    return originalPromisesRename.call(promises, from, to, ...rest);
  };
  const originalPromisesUnlink = promises.unlink;
  promises.unlink = function (file, ...rest) {
    if (unwritable(file)) return Promise.reject(denied('unlink', file));
    return originalPromisesUnlink.call(promises, file, ...rest);
  };
  const originalPromisesOpen = promises.open;
  promises.open = function (file, flags, ...rest) {
    const value = String(flags || 'r');
    if (unwritable(file) && (value.startsWith('w') || value.startsWith('a') || value.includes('+') || value.includes('x'))) {
      return Promise.reject(denied('open', file));
    }
    return originalPromisesOpen.call(promises, file, flags, ...rest);
  };
})();
