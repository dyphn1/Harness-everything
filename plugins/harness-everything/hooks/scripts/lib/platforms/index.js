const claude = require('./claude');
const cursor = require('./cursor');
const copilot = require('./copilot');
const codex = require('./codex');
const _continue = require('./continue');
const hermes = require('./hermes');
const worktrees = require('./worktrees');

module.exports = [
  claude,
  cursor,
  copilot,
  codex,
  _continue,
  hermes,
  worktrees
];
