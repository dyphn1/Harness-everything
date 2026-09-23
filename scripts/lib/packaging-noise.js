'use strict';
// Untracked local/CI build artifacts that no distribution (installer copy, plugin mirror,
// public submission) may ship, even when they exist in the working tree.
const isPackagingNoise = name => name === '__pycache__' || /\.py[co]$/.test(name);

module.exports = { isPackagingNoise };
