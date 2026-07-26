#!/usr/bin/env node
/**
 * Ephemeral third-party skill lookup: prints a skill's SKILL.md wrapped as a
 * ready-to-apply prompt (the same shape `npx skills use` writes to stdout),
 * backed by a content-addressed cache under the OS temp directory so
 * repeat lookups of the same <source> cost zero network calls within the
 * cache's freshness window.
 *
 * Deliberately writes nothing anywhere Harness owns - no manifest, no
 * platform's native skill directory. The cache lives entirely under
 * os.tmpdir() and needs no explicit cleanup: the OS reclaims temp files on
 * its own schedule, and the freshness check below (default 6h) means a
 * lingering entry just gets treated as a miss and re-fetched rather than
 * served stale. That's the only "lifecycle" this needs - nothing for
 * Harness to track or govern, unlike self-evolve's `generated[]`.
 *
 * Usage:
 *   node use-skill.js <owner/repo[@skill]> [--max-age <hours>]
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { execSync } = require('child_process');

const CACHE_DIR = path.join(os.tmpdir(), 'harness-find-skills-cache');
const DEFAULT_MAX_AGE_HOURS = 6;

// `source` is a third-party-supplied identifier (from a search result the
// agent picked) that ends up in a shell command line - `npx` is a `.cmd`
// shim on Windows, which CreateProcess can only launch through a shell, so
// there's no shell-free path here. Node's own child_process docs flag
// spawn/execFile's `{args: [...], shell: true}` form as unsafe (DEP0190: the
// array isn't actually escaped, just concatenated) - execSync's single
// pre-built string is the form Node expects the caller to have already
// validated, so this allow-list IS the injection defense, checked before the
// string is built. A package spec never legitimately needs spaces or shell
// metacharacters (`&|;$()<>\`"'`).
const SAFE_SOURCE_PATTERN = /^[A-Za-z0-9._/@:-]+$/;

function assertSafeSource(source) {
  if (!SAFE_SOURCE_PATTERN.test(source)) {
    console.error(`[Error] Refusing to run "npx skills use" with a source containing unexpected characters: ${JSON.stringify(source)}`);
    process.exit(1);
  }
}

function parseArgs(argv) {
  const opts = { source: null, maxAgeHours: DEFAULT_MAX_AGE_HOURS };
  const rest = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--max-age') opts.maxAgeHours = Number(argv[++i]);
    else rest.push(a);
  }
  opts.source = rest[0] || null;
  return opts;
}

function cachePathFor(source) {
  const hash = crypto.createHash('sha1').update(source).digest('hex');
  return path.join(CACHE_DIR, `${hash}.md`);
}

function readCacheIfFresh(cachePath, maxAgeHours) {
  if (!fs.existsSync(cachePath)) return null;
  const ageMs = Date.now() - fs.statSync(cachePath).mtimeMs;
  if (ageMs > maxAgeHours * 60 * 60 * 1000) return null;
  return fs.readFileSync(cachePath, 'utf8');
}

function main() {
  const { source, maxAgeHours } = parseArgs(process.argv.slice(2));
  if (!source) {
    console.error('Usage: node use-skill.js <owner/repo[@skill]> [--max-age <hours>]');
    process.exit(1);
  }
  assertSafeSource(source);

  const cachePath = cachePathFor(source);
  const cached = readCacheIfFresh(cachePath, maxAgeHours);
  if (cached !== null) {
    process.stderr.write(`[find-skills] cache hit (<${maxAgeHours}h old, no network call): ${cachePath}\n`);
    process.stdout.write(cached);
    return;
  }

  process.stderr.write(`[find-skills] cache miss - fetching "${source}" via npx skills use...\n`);
  let prompt;
  try {
    // Safe to interpolate directly: assertSafeSource() already rejected
    // anything outside [A-Za-z0-9._/@:-], so there's no metacharacter left
    // for a shell to act on.
    prompt = execSync(`npx --yes skills use ${source}`, { encoding: 'utf8' });
  } catch (err) {
    console.error(`[Error] "npx skills use ${source}" failed:\n${(err.stderr || err.message || '').toString().trim()}`);
    process.exit(1);
  }

  fs.mkdirSync(CACHE_DIR, { recursive: true });
  fs.writeFileSync(cachePath, prompt, 'utf8');
  process.stdout.write(prompt);
}

main();
