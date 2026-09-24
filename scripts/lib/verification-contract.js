'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const CONTRACT_RELATIVE = path.join('.harness', 'verify.json');
const CONTRACT_VERSION = 1;
const MAX_TIMEOUT_SEC = 3600;

function runGit(cwd, args) {
  return spawnSync('git', args, {
    cwd,
    encoding: 'utf8',
    windowsHide: true,
    timeout: 5000,
  });
}

function findGitRoot(cwd = process.cwd()) {
  const result = runGit(cwd, ['rev-parse', '--show-toplevel']);
  return result.status === 0 ? path.resolve(result.stdout.trim()) : path.resolve(cwd);
}

function within(root, target) {
  const relative = path.relative(path.resolve(root), path.resolve(target));
  return relative === '' || (!path.isAbsolute(relative) && relative !== '..' && !relative.startsWith('..' + path.sep));
}

function resolveContained(root, value, label, { mustExist = true } = {}) {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${label} must be a non-empty relative path`);
  if (path.isAbsolute(value)) throw new Error(`${label} must stay inside the repository`);
  const resolved = path.resolve(root, value);
  if (!within(root, resolved)) throw new Error(`${label} escapes the repository`);
  if (mustExist && !fs.existsSync(resolved)) throw new Error(`${label} does not exist: ${value}`);
  if (mustExist) {
    const physicalRoot = fs.realpathSync.native(path.resolve(root));
    const physicalTarget = fs.realpathSync.native(resolved);
    if (!within(physicalRoot, physicalTarget)) throw new Error(`${label} escapes the repository through a symbolic link`);
    return physicalTarget;
  }
  return resolved;
}

function assertKnownFields(value, allowed, label) {
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) throw new Error(`${label} contains unknown field: ${key}`);
  }
}

function readContract(repoRoot) {
  const contractPath = path.join(repoRoot, CONTRACT_RELATIVE);
  if (!fs.existsSync(contractPath)) return null;

  let raw;
  try {
    raw = JSON.parse(fs.readFileSync(contractPath, 'utf8'));
  } catch (error) {
    throw new Error(`verify.json is invalid JSON: ${error.message}`);
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('verify.json must contain a JSON object');
  assertKnownFields(raw, new Set(['version', 'roots', 'checks']), 'verify.json');
  if (raw.version !== CONTRACT_VERSION) throw new Error(`verify.json version must be ${CONTRACT_VERSION}`);
  if (!Array.isArray(raw.checks) || raw.checks.length === 0) throw new Error('verify.json checks must be a non-empty array');

  const rootValues = raw.roots === undefined ? ['.'] : raw.roots;
  if (!Array.isArray(rootValues) || rootValues.length === 0) throw new Error('verify.json roots must be a non-empty array');
  const seenRoots = new Set();
  const roots = rootValues.map((value, index) => {
    const resolved = resolveContained(repoRoot, value, `verify.json roots[${index}]`);
    const key = process.platform === 'win32' ? resolved.toLowerCase() : resolved;
    if (seenRoots.has(key)) throw new Error(`verify.json has duplicate root: ${value}`);
    seenRoots.add(key);
    return { declared: value, path: resolved };
  });

  const ids = new Set();
  const checks = raw.checks.map((check, index) => {
    if (!check || typeof check !== 'object' || Array.isArray(check)) throw new Error(`verify.json checks[${index}] must be an object`);
    assertKnownFields(check, new Set(['id', 'run', 'cwd', 'timeoutSec']), `verify.json checks[${index}]`);
    if (typeof check.id !== 'string' || !check.id.trim()) throw new Error(`verify.json checks[${index}].id must be non-empty`);
    if (ids.has(check.id)) throw new Error(`verify.json check id is duplicated: ${check.id}`);
    ids.add(check.id);
    if (typeof check.run !== 'string' || !check.run.trim()) throw new Error(`verify.json checks[${index}].run must be non-empty`);
    const cwdValue = check.cwd === undefined ? '.' : check.cwd;
    const cwd = resolveContained(repoRoot, cwdValue, `verify.json checks[${index}].cwd`);
    const timeoutSec = check.timeoutSec === undefined ? 600 : check.timeoutSec;
    if (!Number.isInteger(timeoutSec) || timeoutSec < 1 || timeoutSec > MAX_TIMEOUT_SEC) {
      throw new Error(`verify.json checks[${index}].timeoutSec must be an integer from 1 to ${MAX_TIMEOUT_SEC}`);
    }
    return {
      id: check.id,
      run: check.run.trim(),
      cwd,
      cwdDeclared: cwdValue,
      timeoutSec,
      source: 'contract',
    };
  });

  for (const check of checks) {
    const owners = roots.filter(root => within(root.path, check.cwd))
      .sort((a, b) => b.path.length - a.path.length);
    if (!owners.length) throw new Error(`verify.json check ${check.id} cwd is outside declared roots`);
    check.root = owners[0].path;
  }

  return { path: contractPath, roots, checks };
}

function detectRunner(dir) {
  if (fs.existsSync(path.join(dir, 'pnpm-lock.yaml'))) return 'pnpm';
  if (fs.existsSync(path.join(dir, 'yarn.lock'))) return 'yarn';
  if (fs.existsSync(path.join(dir, 'bun.lockb')) || fs.existsSync(path.join(dir, 'bun.lock'))) return 'bun';
  return 'npm';
}

function packageCommand(runner, name) {
  return `${runner} run ${name}`;
}

function addCandidate(list, seen, candidate) {
  const key = [candidate.source, candidate.run, candidate.cwd].join('\0');
  if (seen.has(key)) return;
  seen.add(key);
  list.push(candidate);
}

function readTextIfExists(file) {
  return fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
}

function detectRoot(root) {
  const checks = [];
  const candidates = [];
  const seen = new Set();
  const pkgPath = path.join(root, 'package.json');

  if (fs.existsSync(pkgPath)) {
    let pkg;
    try {
      pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
    } catch (error) {
      throw new Error(`package.json at ${root} is unreadable/invalid JSON (${error.message})`);
    }
    const scripts = pkg && typeof pkg === 'object' && pkg.scripts && typeof pkg.scripts === 'object' ? pkg.scripts : {};
    const runner = detectRunner(root);
    for (const name of ['lint', 'test']) {
      const script = scripts[name];
      if (typeof script === 'string' && script.trim() && !/no test specified/i.test(script)) {
        checks.push({
          id: `package-${name}`,
          run: packageCommand(runner, name),
          cwd: root,
          timeoutSec: 600,
          source: 'package-auto',
          root,
        });
      }
    }
    for (const name of ['check', 'typecheck', 'verify', 'build']) {
      const script = scripts[name];
      if (typeof script === 'string' && script.trim()) {
        addCandidate(candidates, seen, { source: `package:${name}`, run: packageCommand(runner, name), cwd: root });
      }
    }
  }

  if (fs.existsSync(path.join(root, '.pre-commit-config.yaml')) || fs.existsSync(path.join(root, '.pre-commit-config.yml'))) {
    addCandidate(candidates, seen, { source: 'pre-commit', run: 'pre-commit run --all-files', cwd: root });
  }

  const makeText = readTextIfExists(path.join(root, 'Makefile'));
  if (makeText) {
    const targets = new Set([...makeText.matchAll(/^([A-Za-z0-9_.-]+)\s*:(?![=])/gm)].map(match => match[1]));
    for (const target of ['test', 'check', 'lint', 'ci']) {
      if (targets.has(target)) addCandidate(candidates, seen, { source: 'make', run: `make ${target}`, cwd: root });
    }
  }

  const justText = readTextIfExists(path.join(root, 'justfile')) || readTextIfExists(path.join(root, 'Justfile'));
  if (justText) {
    const recipes = new Set([...justText.matchAll(/^([A-Za-z0-9_-]+)\s*(?:[^:=\r\n]*)?:\s*$/gm)].map(match => match[1]));
    for (const recipe of ['test', 'check', 'ci']) {
      if (recipes.has(recipe)) addCandidate(candidates, seen, { source: 'just', run: `just ${recipe}`, cwd: root });
    }
  }

  const pyproject = readTextIfExists(path.join(root, 'pyproject.toml'));
  if (/\[tool\.pytest(?:\.|\])/m.test(pyproject)) {
    addCandidate(candidates, seen, { source: 'pyproject:pytest', run: 'pytest', cwd: root });
    addCandidate(candidates, seen, { source: 'pyproject:pytest', run: 'uv run pytest', cwd: root });
  }
  if (/\[tool\.ruff(?:\.|\])/m.test(pyproject)) {
    addCandidate(candidates, seen, { source: 'pyproject:ruff', run: 'ruff check .', cwd: root });
    addCandidate(candidates, seen, { source: 'pyproject:ruff', run: 'uv run ruff check .', cwd: root });
  }
  if (fs.existsSync(path.join(root, 'tsconfig.json'))) addCandidate(candidates, seen, { source: 'typescript', run: 'npx tsc --noEmit', cwd: root });
  if (['eslint.config.js', 'eslint.config.mjs', 'eslint.config.cjs', '.eslintrc', '.eslintrc.json', '.eslintrc.js', '.eslintrc.cjs'].some(name => fs.existsSync(path.join(root, name)))) {
    addCandidate(candidates, seen, { source: 'eslint', run: 'npx eslint .', cwd: root });
  }
  if (fs.existsSync(path.join(root, 'tox.ini'))) addCandidate(candidates, seen, { source: 'tox', run: 'tox', cwd: root });
  if (fs.existsSync(path.join(root, 'noxfile.py'))) addCandidate(candidates, seen, { source: 'nox', run: 'nox', cwd: root });
  if (fs.existsSync(path.join(root, 'Cargo.toml'))) addCandidate(candidates, seen, { source: 'cargo', run: 'cargo test', cwd: root });
  if (fs.existsSync(path.join(root, 'go.mod'))) addCandidate(candidates, seen, { source: 'go', run: 'go test ./...', cwd: root });

  if (hasCommitHook(root)) {
    addCandidate(candidates, seen, { source: 'git-hook', run: 'git commit (pre-commit hook configured)', cwd: root });
  }

  return { checks, candidates };
}

function enumerateSubmoduleRoots(repoRoot) {
  const roots = [path.resolve(repoRoot)];
  const result = runGit(repoRoot, ['submodule', 'status', '--recursive']);
  if (result.status !== 0 || !result.stdout.trim()) return roots;
  for (const line of result.stdout.split(/\r?\n/)) {
    if (!line.trim()) continue;
    const match = line.match(/^[ +-U]?([0-9a-fA-F]{40,64})\s+(.+?)(?:\s+\(.+\))?$/);
    if (!match) continue;
    const candidate = path.resolve(repoRoot, match[2]);
    if (within(repoRoot, candidate) && fs.existsSync(candidate)) roots.push(candidate);
  }
  return [...new Set(roots)];
}

function hasCommitHook(repoRoot) {
  const result = runGit(repoRoot, ['rev-parse', '--git-path', 'hooks/pre-commit']);
  if (result.status !== 0) return false;
  const value = result.stdout.trim();
  if (!value) return false;
  const hook = path.isAbsolute(value) ? value : path.resolve(repoRoot, value);
  return fs.existsSync(hook);
}

function normalizeCommand(command) {
  return String(command || '').trim().replace(/\s+/g, ' ');
}

function hasControlOperators(command) {
  return /(?:&&|\|\||[;|\r\n])/.test(command);
}

function commandMatches(command, expected) {
  const actual = normalizeCommand(command);
  const target = normalizeCommand(expected);
  if (!actual || !target || hasControlOperators(actual)) return false;
  return actual === target || actual.startsWith(target + ' ');
}

function isGitCommit(command) {
  const actual = normalizeCommand(command);
  return /^git\s+commit(?:\s|$)/i.test(actual);
}

function bypassesHooks(command) {
  const actual = normalizeCommand(command);
  if (/(?:^|\s)--no-verify(?:\s|$)/i.test(actual) || /(?:^|\s)-n(?:\s|$)/.test(actual)) return true;

  // Git accepts boolean short options in clusters, e.g. `git commit -an`.
  // Treat a cluster containing -n as hook bypass only when every clustered
  // option is a no-argument commit flag; this avoids mistaking attached
  // arguments such as `-S<key>` or `-m<message>` for --no-verify.
  return actual.split(/\s+/).some(token =>
    /^-[avqseipon]+$/i.test(token) && token.length > 2 && token.slice(1).toLowerCase().includes('n')
  );
}

function legacyVerificationCommand(command) {
  const value = normalizeCommand(command);
  return /^(?:(?:npm|pnpm|yarn|bun)\s+(?:run\s+)?(?:test|lint|build|typecheck|check|verify)\b|npx\s+(?:jest|vitest|mocha|tsc|eslint)\b|(?:jest|vitest|mocha|pytest|rspec|phpunit)\b|uv\s+run\s+(?:pytest|ruff)\b|(?:make|just)\s+(?:test|check|lint|ci)\b|cargo\s+(?:test|check)\b|go\s+test\b|dotnet\s+(?:test|build)\b)/i.test(value);
}

function verificationCommandSet(cwd, options = {}) {
  const repoRoot = path.resolve(options.root || findGitRoot(cwd));
  let contract = null;
  try { contract = readContract(repoRoot); }
  catch (error) {
    // The verify gate treats an invalid authoritative contract as FAILED.
    // Preserve that fail-closed state here instead of falling through to
    // legacy recognition and manufacturing contradictory verification evidence.
    return {
      repoRoot,
      contract: null,
      contractInvalid: true,
      contractError: error && error.message ? error.message : String(error),
      commands: [],
      commitHookDeclared: false,
    };
  }

  if (contract) {
    return {
      repoRoot,
      contract,
      contractInvalid: false,
      commands: contract.checks.map(check => check.run),
      commitHookDeclared: contract.checks.some(check => /^pre-commit\s+/i.test(normalizeCommand(check.run))),
    };
  }

  const root = findGitRoot(cwd);
  let detected;
  try { detected = detectRoot(root); }
  catch (_) { detected = { checks: [], candidates: [] }; }
  return {
    repoRoot,
    contract: null,
    contractInvalid: false,
    commands: [
      ...detected.checks.map(check => check.run),
      ...detected.candidates.filter(candidate => candidate.source !== 'git-hook').map(candidate => candidate.run),
    ],
    commitHookDeclared: false,
  };
}

function isVerificationCommand(command, options = {}) {
  const cwd = path.resolve(options.cwd || process.cwd());
  const actual = normalizeCommand(command);
  if (!actual || hasControlOperators(actual)) return false;
  const set = verificationCommandSet(cwd, options);
  if (set.contractInvalid) return false;

  if (isGitCommit(actual)) {
    return !!set.commitHookDeclared && !bypassesHooks(actual) && hasCommitHook(set.repoRoot);
  }
  if (set.commands.some(expected => commandMatches(actual, expected))) return true;
  return !set.contract && legacyVerificationCommand(actual);
}

module.exports = {
  CONTRACT_RELATIVE,
  MAX_TIMEOUT_SEC,
  addCandidate,
  commandMatches,
  detectRoot,
  enumerateSubmoduleRoots,
  findGitRoot,
  hasCommitHook,
  isVerificationCommand,
  legacyVerificationCommand,
  normalizeCommand,
  readContract,
  resolveContained,
  verificationCommandSet,
  within,
};
