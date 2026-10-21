#!/usr/bin/env node
'use strict';

// #325 Phase 3b S3 RED suite: advisory provider suggestions (pure suggestDocProviders).
//
// Every assertion runs against both legs: the canonical harness-everything/scripts/doc-providers.js and the packaged
// plugins/harness-everything/skills/harness-everything/scripts/doc-providers.js. A missing or unloadable module is reported
// per assertion and per leg as a module-missing (or module-load) reason; the harness itself does not crash. Byte parity
// between the two copies is one assertion over both files. Expected outputs are hand-derived from the S3 spec in
// docs/doc-workflow-reconciliation.md and from reconciliation-prep/provider-contract.json, never from an implementation.
// Exit 1 means at least one assertion FAILED; exit 2 means an infrastructure fault in this suite (unreadable fixture).

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const http = require('http');
const https = require('https');
const net = require('net');
const childProcess = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const FIXTURE_DIR = path.join(__dirname, 'fixtures', 'doc-obligations');
const CASES_FILE = path.join(FIXTURE_DIR, 'providers-s3', 'cases.json');
const CONTRACT_FILE = path.join(FIXTURE_DIR, 'reconciliation-prep', 'provider-contract.json');
const DERIVE_DIR = path.join(FIXTURE_DIR, 'derive');
const MODULE = 'doc-providers.js';
const LEGS = [
  { name: 'source', dir: path.join(ROOT, 'harness-everything', 'scripts') },
  { name: 'packaged', dir: path.join(ROOT, 'plugins', 'harness-everything', 'skills', 'harness-everything', 'scripts') }
];
const INVALID = 'invalid-input';
const R_OK = 'active-step capability and host requirements match';
const NO_META = 'no available provider metadata for the active-step capability';
const VALID_KEYS = ['suggestions', 'unavailable'];
const INVALID_KEYS = ['diagnostics', 'suggestions', 'unavailable'];
const SUGGESTION_KEYS = ['availability', 'capability', 'providerId', 'reason'];
const UNAVAILABLE_KEYS = ['capability', 'reason'];
const AVAILABILITY_ENUM = ['available', 'unavailable', 'unknown'];

let corpus;
let contract;
let deriveConfig;
try {
  corpus = JSON.parse(fs.readFileSync(CASES_FILE, 'utf8'));
  contract = JSON.parse(fs.readFileSync(CONTRACT_FILE, 'utf8'));
  deriveConfig = JSON.parse(fs.readFileSync(path.join(DERIVE_DIR, 'config.json'), 'utf8'));
} catch (error) {
  console.error(`[s3-providers] infrastructure: fixture unreadable: ${error.message.split('\n')[0]}`);
  process.exitCode = 2;
  return;
}

let passed = 0;
let failed = 0;
const failures = [];
const infrastructure = [];

function record(status, id, leg, detail) {
  const where = leg ? ` [${leg}]` : '';
  if (status === 'PASS') passed += 1;
  else { failed += 1; failures.push(`${id}${where}`); }
  console.log(`  ${status} ${id}${where}${detail ? ` — ${detail}` : ''}`);
}

// Stable JSON: object keys sorted recursively, so comparisons do not depend on property order.
function stable(value) {
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stable(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function truncate(text) {
  return text.length > 300 ? `${text.slice(0, 300)}…` : text;
}

function same(actual, expected, label) {
  const a = stable(actual);
  const e = stable(expected);
  if (a !== e) throw new Error(`${label}: got ${truncate(a)} expected ${truncate(e)}`);
}

// Candidate-set comparison: order-insensitive, no ranking implied.
function sameSet(actual, expected, label) {
  const a = (Array.isArray(actual) ? actual : []).map(stable).sort();
  const e = expected.map(stable).sort();
  if (JSON.stringify(a) !== JSON.stringify(e)) throw new Error(`${label}: set got ${truncate(a.join(' | '))} expected ${truncate(e.join(' | '))}`);
}

function deepFreeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const item of Object.values(value)) deepFreeze(item);
  }
  return value;
}

function cloneJson(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

// Module loading is per leg and cached; a load failure is an assertion FAIL for that leg, not a harness crash.
const loaded = {};
function loadLeg(leg) {
  if (loaded[leg.name]) return loaded[leg.name];
  const file = path.join(leg.dir, MODULE);
  let result;
  if (!fs.existsSync(file)) {
    result = { error: `module-missing: ${path.relative(ROOT, file)} does not exist` };
  } else {
    try {
      delete require.cache[require.resolve(file)];
      const mod = require(file);
      if (typeof mod.suggestDocProviders !== 'function') result = { error: 'module-missing-export: suggestDocProviders is not a function' };
      else result = { mod };
    } catch (error) {
      result = { error: `module-load: ${error.message.split('\n')[0]}` };
    }
  }
  loaded[leg.name] = result;
  return result;
}

// Runs one assertion on each leg. The callback receives the suggest function and the leg name.
function assertPerLeg(id, fn) {
  for (const leg of LEGS) {
    const { mod, error } = loadLeg(leg);
    if (error) { record('FAIL', id, leg.name, error); continue; }
    try {
      fn(mod.suggestDocProviders, leg);
      record('PASS', id, leg.name);
    } catch (error) {
      record('FAIL', id, leg.name, error.message.split('\n')[0]);
    }
  }
}

// Runs one assertion over both legs at once (parity). Reports a missing leg as module-missing for that leg.
function assertPair(id, fn) {
  const missing = LEGS.filter(leg => loadLeg(leg).error);
  if (missing.length) {
    for (const leg of missing) record('FAIL', id, leg.name, loadLeg(leg).error);
    return;
  }
  try {
    fn();
    record('PASS', id, 'both');
  } catch (error) {
    record('FAIL', id, 'both', error.message.split('\n')[0]);
  }
}

// Validity of one output for a valid input: exact keys, then exact ordered content.
function checkValidOutput(out, expected) {
  same(Object.keys(out).sort(), VALID_KEYS, 'top-level keys (valid input has no diagnostics)');
  same(out.suggestions, expected.suggestions, 'suggestions');
  same(out.unavailable, expected.unavailable, 'unavailable');
}

// Validity of one structured invalid-input result.
function checkInvalidOutput(out, expected) {
  same(Object.keys(out).sort(), INVALID_KEYS, 'top-level keys (invalid input)');
  same(out.suggestions, [], 'suggestions must be empty for invalid input');
  same(out.unavailable, expected.unavailable, 'unavailable (retained needed capabilities)');
  if (!Array.isArray(out.diagnostics) || out.diagnostics.length === 0) throw new Error('diagnostics must be a nonempty array');
  for (const item of out.diagnostics) {
    same(item.code, INVALID, 'diagnostic code');
    if (typeof item.path !== 'string' || !item.path.trim()) throw new Error('diagnostic path must be a nonempty string');
    if (typeof item.message !== 'string' || !item.message.trim()) throw new Error('diagnostic message must be a nonempty string');
  }
  for (const prefix of expected.diagnosticPathPrefixes) {
    if (!out.diagnostics.some(item => item.path.startsWith(prefix))) throw new Error(`no diagnostic path starts with ${prefix}`);
  }
  if (expected.minDiagnostics !== undefined && out.diagnostics.length < expected.minDiagnostics) {
    throw new Error(`expected at least ${expected.minDiagnostics} diagnostics, got ${out.diagnostics.length}`);
  }
  const sorted = out.diagnostics.map(item => [item.path, item.message]).slice().sort((x, y) => (x[0] < y[0] ? -1 : x[0] > y[0] ? 1 : x[1] < y[1] ? -1 : x[1] > y[1] ? 1 : 0));
  same(out.diagnostics.map(item => [item.path, item.message]), sorted, 'diagnostics ordered by path then message');
  if (expected.forbiddenText) {
    const text = JSON.stringify(out);
    for (const forbidden of expected.forbiddenText) {
      if (text.includes(forbidden)) throw new Error('diagnostics expose an unrelated record value');
    }
  }
}

console.log('=== #325 3b S3: advisory provider suggestions (RED; canonical and packaged legs) ===');

// ---- Contract examples: candidate sets, both legs -----------------------------------------------------------------
for (const example of contract.examples) {
  assertPerLeg(`contract:${example.id}`, suggest => {
    const out = suggest(cloneJson(example.input));
    same(Object.keys(out).sort(), VALID_KEYS, 'top-level keys');
    sameSet(out.suggestions, example.expected.suggestions, 'suggestions');
    sameSet(out.unavailable, example.expected.unavailable, 'unavailable');
  });
}

assertPerLeg('contract:swap-provider-order-same-candidate-set', suggest => {
  const example = contract.examples[0];
  const swapped = cloneJson(example.input);
  swapped.availableProviderMetadata.reverse();
  const out = suggest(swapped);
  sameSet(out.suggestions, example.expected.suggestions, 'suggestions after swapping provider order');
  sameSet(out.unavailable, example.expected.unavailable, 'unavailable after swapping provider order');
});

// ---- Fixture cases: exact outputs (valid) and structured invalid-input results (malformed) -------------------------
for (const item of corpus.cases) {
  assertPerLeg(`case:${item.id}`, suggest => {
    const out = suggest(cloneJson(item.input));
    if (item.kind === 'valid') checkValidOutput(out, item.expected);
    else if (item.kind === 'malformed') checkInvalidOutput(out, item.expected);
    else throw new Error(`fixture kind ${item.kind} is unknown`);
  });
}

// ---- H1: obligations are unchanged by any suggestion metadata ------------------------------------------------------
function readTree(root) {
  const files = {};
  if (!fs.existsSync(root)) return files;
  const walk = dir => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else {
        const rel = path.relative(root, full).split(path.sep).join('/');
        files[rel.endsWith('.fixture') ? rel.slice(0, -'.fixture'.length) : rel] = fs.readFileSync(full, 'utf8');
      }
    }
  };
  walk(root);
  return files;
}

function obligationsFor(leg) {
  const { deriveDocFacts, deriveDocObligations } = require(path.join(leg.dir, 'doc-obligations.js'));
  const caseDir = path.join(DERIVE_DIR, 'mixed-docs-code');
  const facts = deriveDocFacts({
    base: { files: readTree(path.join(caseDir, 'base')) },
    candidate: { files: readTree(path.join(caseDir, 'candidate')) },
    config: deriveConfig
  });
  return stable(deriveDocObligations(facts.facts));
}

for (const leg of LEGS) {
  const id = 'H1:suggestions-leave-derived-obligations-unchanged';
  const { mod, error } = loadLeg(leg);
  if (error) { record('FAIL', id, leg.name, error); continue; }
  try {
    const before = obligationsFor(leg);
    for (const example of contract.examples) mod.suggestDocProviders(cloneJson(example.input));
    for (const item of corpus.cases) mod.suggestDocProviders(cloneJson(item.input));
    const after = obligationsFor(leg);
    if (before !== after) throw new Error('deriveDocObligations output changed after suggestDocProviders calls');
    record('PASS', id, leg.name);
  } catch (error) {
    record('FAIL', id, leg.name, error.message.split('\n')[0]);
  }
}

// ---- Output shape: no channel that could remove or waive a capability -----------------------------------------------
assertPerLeg('output:exact-key-shapes-and-no-removal-channel', suggest => {
  const outputs = [
    ...contract.examples.map(example => suggest(cloneJson(example.input))),
    ...corpus.cases.map(item => suggest(cloneJson(item.input)))
  ];
  for (const out of outputs) {
    const keys = Object.keys(out).sort();
    if (JSON.stringify(keys) !== JSON.stringify(VALID_KEYS) && JSON.stringify(keys) !== JSON.stringify(INVALID_KEYS)) {
      throw new Error(`unexpected top-level keys ${keys.join(',')}`);
    }
    for (const suggestion of out.suggestions) same(Object.keys(suggestion).sort(), SUGGESTION_KEYS, 'suggestion keys (no locator or extra metadata)');
    for (const gap of out.unavailable) same(Object.keys(gap).sort(), UNAVAILABLE_KEYS, 'unavailable keys');
  }
});

// ---- Host: availability enum; unknown is reserved and never emitted ------------------------------------------------
assertPerLeg('host:unknown-availability-never-emitted', suggest => {
  const outputs = [
    ...contract.examples.map(example => suggest(cloneJson(example.input))),
    ...corpus.cases.map(item => suggest(cloneJson(item.input)))
  ];
  for (const out of outputs) {
    for (const suggestion of out.suggestions) {
      if (!['available', 'unavailable'].includes(suggestion.availability)) {
        throw new Error(`availability ${suggestion.availability} is outside the S3 emitted set`);
      }
      if (!AVAILABILITY_ENUM.includes(suggestion.availability)) throw new Error('availability outside the contract enum');
    }
  }
});

// ---- Purity: input unchanged (including frozen), determinism, no file/network/process activity -----------------------
const everyInput = [...contract.examples.map(example => example.input), ...corpus.cases.map(item => item.input)];

assertPerLeg('purity:input-unchanged-including-frozen', suggest => {
  for (const input of everyInput) {
    const copy = cloneJson(input);
    const before = stable(copy);
    suggest(copy);
    same(stable(copy), before, 'input after the call');
    const frozen = deepFreeze(cloneJson(input));
    suggest(frozen);
    same(stable(frozen), before, 'frozen input after the call');
  }
});

assertPerLeg('purity:deterministic-two-calls', suggest => {
  for (const input of everyInput) {
    const first = stable(suggest(cloneJson(input)));
    const second = stable(suggest(cloneJson(input)));
    same(second, first, 'second call output');
  }
});

assertPerLeg('purity:no-file-network-process-activity-during-calls', suggest => {
  const calls = [];
  const trap = (owner, name) => {
    const original = owner[name];
    owner[name] = (...args) => { calls.push(`${name}`); throw new Error(`forbidden ${name} call`); };
    return () => { owner[name] = original; };
  };
  const restores = [
    trap(fs, 'readFileSync'), trap(fs, 'readdirSync'), trap(fs, 'existsSync'), trap(fs, 'statSync'),
    trap(fs, 'lstatSync'), trap(fs, 'openSync'), trap(childProcess, 'spawnSync'), trap(childProcess, 'execFileSync'),
    trap(childProcess, 'execSync'), trap(childProcess, 'spawn'), trap(childProcess, 'exec'), trap(childProcess, 'fork'),
    trap(net, 'connect'), trap(net, 'createConnection'), trap(http, 'request'), trap(https, 'request')
  ];
  try {
    for (const input of everyInput) suggest(cloneJson(input));
  } finally {
    for (const restore of restores) restore();
  }
  same(calls, [], 'forbidden calls during suggestDocProviders');
});

// ---- Static checks on both source copies --------------------------------------------------------------------------
const FORBIDDEN_REQUIRE = /require\(\s*['"](?:node:)?(?:fs|child_process|net|http|https)(?:\/promises)?['"]\s*\)/;
const FORBIDDEN_IMPORT = /\bfrom\s+['"](?:node:)?(?:fs|child_process|net|http|https)(?:\/promises)?['"]/;
const SKILL_LITERAL = /['"`][^'"`\n]*SKILL\.md[^'"`\n]*['"`]/;

function sourceText(leg) {
  return fs.readFileSync(path.join(leg.dir, MODULE), 'utf8');
}

assertPerLeg('static:no-forbidden-requires', (suggest, leg) => {
  const text = sourceText(leg);
  if (FORBIDDEN_REQUIRE.test(text) || FORBIDDEN_IMPORT.test(text)) {
    throw new Error('module requires fs, child_process, net, http or https');
  }
});

assertPerLeg('static:never-references-SKILL.md-as-a-path', (suggest, leg) => {
  if (SKILL_LITERAL.test(sourceText(leg))) throw new Error('module contains a SKILL.md path literal');
});

assertPair('parity:source-and-packaged-byte-identical', () => {
  const digest = leg => crypto.createHash('sha256').update(fs.readFileSync(path.join(leg.dir, MODULE))).digest('hex');
  const [source, packaged] = LEGS.map(digest);
  if (source !== packaged) throw new Error(`source ${source.slice(0, 12)} differs from packaged ${packaged.slice(0, 12)}`);
});

// ---- Summary ------------------------------------------------------------------------------------------------------
console.log(`\nS3 provider suggestion summary: ${passed} PASS, ${failed} FAIL, ${infrastructure.length} INFRA across ${corpus.cases.length} fixture cases and ${contract.examples.length} contract examples`);
if (failures.length) console.log(`FAILED assertions (${failures.length}):\n  ${failures.join('\n  ')}`);

if (infrastructure.length) {
  console.error('S3 suite: infrastructure faults present; these are not assertion results.');
  process.exitCode = 2;
} else if (failed > 0) {
  console.error('S3 suite: assertion FAIL present (expected on the RED base; GREEN must clear every FAIL).');
  process.exitCode = 1;
} else {
  console.log('S3 suite: all assertions PASS.');
}
