#!/usr/bin/env node
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { fileURLToPath, pathToFileURL } = require('url');
const { distributionTargets, prepareMutation } = require('./mutation-loader');

const ROOT = path.resolve(__dirname, '..');
const LOADER = path.join(__dirname, 'mutation-loader.js');
const SHA256 = /^[a-f0-9]{64}$/;

const LEGACY_CASES = {
  pathBoundary: 'LEGACY.mechanism-2v-verifier-boundaries',
  executionContract: 'LEGACY.mechanism-2v-verifier-boundaries',
  evidenceTool: 'LEGACY.mechanism-2t-evidence-triage',
  scaffold: 'LEGACY.mechanism-2l-multi-agent-workspace',
  installer: 'LEGACY.mechanism-2q-installer-global-shared-store',
  transcript: 'LEGACY.mechanism-2t-transcript-parser',
  behavioralRunner: 'LEGACY.mechanism-2j-behavioral-runner',
  workspace: 'LEGACY.mechanism-2u-issue-42-regressions',
  submodule: 'LEGACY.mechanism-34-worktree-submodule-reachability',
  verifyGate: 'LEGACY.mechanism-35-verification-contract',
  skillRouting: 'LEGACY.skill-routing-check',
};

const LEGACY_CHECKS = [
  {
    label: 'physical path boundaries', target: 'scripts/lib/path-boundary.js', mutantId: 'path-boundary',
    test: 'ci/mechanism-2v-verifier-boundaries.test.js', caseId: LEGACY_CASES.pathBoundary,
    assertionId: `${LEGACY_CASES.pathBoundary}.symlink-component-rejected`,
  },
  {
    label: 'exact execution commands', target: 'scripts/lib/execution-contract.js', mutantId: 'execution-contract',
    test: 'ci/mechanism-2v-verifier-boundaries.test.js', caseId: LEGACY_CASES.executionContract,
    assertionId: `${LEGACY_CASES.executionContract}.extra-arguments-rejected`,
  },
  {
    label: 'archive output boundaries', target: 'behavioral-evals/evidence-tool.js', mutantId: 'evidence-tool',
    test: 'ci/mechanism-2t-evidence-triage.test.js', caseId: LEGACY_CASES.evidenceTool,
    assertionId: `${LEGACY_CASES.evidenceTool}.archive-link-rejected`,
  },
  {
    label: 'legacy migration boundaries', target: 'multi-agent-workspace/scripts/scaffold.js', mutantId: 'scaffold-migration',
    test: 'ci/mechanism-2l-multi-agent-workspace.test.js', caseId: LEGACY_CASES.scaffold,
    assertionId: `${LEGACY_CASES.scaffold}.linked-legacy-source-rejected`,
  },
  {
    label: 'global installer fallback', target: 'scripts/installer.js', mutantId: 'installer-global',
    test: 'ci/mechanism-2q-installer-global-shared-store.test.js', caseId: LEGACY_CASES.installer,
    assertionId: `${LEGACY_CASES.installer}.global-install-from-non-git-directory`,
  },
  {
    label: 'transcript command qualifiers', target: 'behavioral-evals/transcript-parser.js', mutantId: 'transcript-command',
    test: 'ci/mechanism-2t-transcript-parser.test.js', caseId: LEGACY_CASES.transcript,
    assertionId: `${LEGACY_CASES.transcript}.command-qualifier`,
  },
  {
    label: 'fixture path boundaries', target: 'behavioral-evals/run.js', mutantId: 'runner-fixture',
    test: 'ci/mechanism-2j-behavioral-runner.test.js', caseId: LEGACY_CASES.behavioralRunner,
    assertionId: `${LEGACY_CASES.behavioralRunner}.fixture-traversal-rejected`,
  },
  {
    label: 'unbound workspace identity', target: 'scripts/lib/workspace.js', mutantId: 'workspace-identity',
    test: 'ci/mechanism-2u-issue-42-regressions.test.js', caseId: LEGACY_CASES.workspace,
    assertionId: `${LEGACY_CASES.workspace}.stable-unbound-workspace-key`,
  },
  {
    label: 'worktree submodule reachability', target: 'using-git-worktrees/scripts/submodule-reachability.js', mutantId: 'submodule-reachability',
    test: 'ci/mechanism-34-worktree-submodule-reachability.test.js', caseId: LEGACY_CASES.submodule,
    assertionId: `${LEGACY_CASES.submodule}.unpublished-submodule-commit-rejected`,
  },
  {
    label: 'verification contract precedence', target: 'harness-everything/scripts/verify-gate.js', mutantId: 'verify-contract-precedence',
    test: 'ci/mechanism-35-verification-contract.test.js', caseId: LEGACY_CASES.verifyGate,
    assertionId: `${LEGACY_CASES.verifyGate}.authoritative-contract-precedence`,
  },
  {
    label: 'positive skill-eval relevance', target: 'harness-everything/scripts/tier-router.js', mutantId: 'knowledge-signal-matcher',
    test: 'ci/skill-routing-check.js', caseId: LEGACY_CASES.skillRouting,
    assertionId: `${LEGACY_CASES.skillRouting}.tdd-positive-relevance`,
  },
];

const DOC_EVIDENCE_TEST = 'ci/mechanism-341-read-boundary.test.js';
const DOC_EVIDENCE_COVERAGE = require('./fixtures/doc-obligations/read-boundary/cases.json').mutantCoverage;
const DOC_EVIDENCE_CHECKS = Object.entries(DOC_EVIDENCE_COVERAGE).flatMap(([mutantId, mapping]) =>
  Object.entries(distributionTargets(mutantId)).map(([distribution, target]) => ({
    label: `${mutantId} ${distribution} read-boundary mutant`,
    target,
    mutantId,
    test: DOC_EVIDENCE_TEST,
    caseId: mapping.caseId,
    assertionId: mapping.assertionId,
  }))
);
const DOC_EVIDENCE_VARIANTS = [
  { mutantId: 'M01-stateful', caseId: 'RB44', assertionId: 'RB44.R1.baseline-digest-reads' },
  { mutantId: 'M06-observation', caseId: 'RB17', assertionId: 'RB17.result.observation-outcome' },
  { mutantId: 'M07b-audit-output', caseId: 'RB19', assertionId: 'RB19.conformance.output-matches-expected' },
  { mutantId: 'M09-descriptor-count', caseId: 'RB21', assertionId: 'RB21.R3.source-descriptor-checks' },
  { mutantId: 'M10-rename-to', caseId: 'RB52', assertionId: 'RB52.result.observation-outcome' },
  { mutantId: 'M11-entry-exception', caseId: 'RB11', assertionId: 'RB11.conformance.exception-matches-expected' },
  { mutantId: 'M11-baseline-map', caseId: 'RB12', assertionId: 'RB12.conformance.exception-matches-expected' },
  { mutantId: 'M11-candidate-descriptor', caseId: 'RB14', assertionId: 'RB14.conformance.exception-matches-expected' },
  { mutantId: 'M11-destination', caseId: 'RB56', assertionId: 'RB56.conformance.exception-matches-expected' },
  { mutantId: 'M11-ordinary-capture', caseId: 'RB23', assertionId: 'RB23.conformance.exception-matches-expected' },
  { mutantId: 'M14-diagnostic', caseId: 'RB86', assertionId: 'RB86.result.diagnostic-codes' },
  { mutantId: 'M16-trace', caseId: 'RB26', assertionId: 'RB26.conformance.trace-matches-expected' },
  { mutantId: 'M19-eager', caseId: 'RB32', assertionId: 'RB32.C5.prd-enumeration-scoped' },
  { mutantId: 'M20-partial-revision', caseId: 'RB70', assertionId: 'RB70.result.diagnostic-codes' },
  { mutantId: 'M20-unknown-scope', caseId: 'RB34', assertionId: 'RB34.result.observation-outcome' },
].flatMap(variant => Object.entries(distributionTargets(variant.mutantId)).map(([distribution, target]) => ({
  label: `${variant.mutantId} ${distribution} variant`,
  target,
  test: DOC_EVIDENCE_TEST,
  ...variant,
})));
// New scope mutants (plan §3). Their coverage lives here, not in cases.json, which stays pinned to the reviewed corpus.
const NEW_SCOPE_COVERAGE = {
  'B01-r5-cross-obligation': { caseId: 'RB20', assertionId: 'RB20.R5.per-obligation-sha-reads' },
  'B02-r3-per-destination-collapse': { caseId: 'RB16', assertionId: 'RB16.R3.shared-destination-reads' },
  'B02-observation': { caseId: 'RB17', assertionId: 'RB17.result.observation-outcome' },
  'B03-r3-cross-obligation': { caseId: 'RB107', assertionId: 'RB107.result.observation-outcome' },
  'B04-leak': { caseId: 'CAPTURE-B04', assertionId: 'CAPTURE-B04.detachment.no-input-references', test: 'ci/mechanism-341-capture-module.test.js' },
  'B04-mutable-view': { caseId: 'CAPTURE-B04', assertionId: 'CAPTURE-B04.detachment.views-fresh-copies', test: 'ci/mechanism-341-capture-module.test.js' },
};
const NEW_SCOPE_CHECKS = Object.entries(NEW_SCOPE_COVERAGE).flatMap(([mutantId, mapping]) =>
  Object.entries(distributionTargets(mutantId)).map(([distribution, target]) => ({
    label: `${mutantId} ${distribution} scope mutant`,
    target,
    mutantId,
    test: mapping.test || DOC_EVIDENCE_TEST,
    caseId: mapping.caseId,
    assertionId: mapping.assertionId,
  }))
);
const CHECKS = [...LEGACY_CHECKS, ...DOC_EVIDENCE_CHECKS, ...DOC_EVIDENCE_VARIANTS, ...NEW_SCOPE_CHECKS];

const LEGACY_ASSERTIONS = {
  [`${LEGACY_CASES.pathBoundary}.symlink-component-rejected`]: {
    kind: 'helper', label: '2v. a junction/symlink inside the boundary cannot escape it',
  },
  [`${LEGACY_CASES.executionContract}.extra-arguments-rejected`]: {
    kind: 'helper', label: '2v. extra command arguments are not silently accepted',
  },
  [`${LEGACY_CASES.evidenceTool}.archive-link-rejected`]: {
    kind: 'output',
    pass: /^Behavioral evidence-triage regressions passed\.$/,
    fail: /^FAIL archive rejects an output junction or symlink escape(?:$|:)/,
  },
  [`${LEGACY_CASES.scaffold}.linked-legacy-source-rejected`]: {
    kind: 'helper', label: '2l. legacy migration rejects a linked source before copying or deleting outside files',
  },
  [`${LEGACY_CASES.installer}.global-install-from-non-git-directory`]: {
    kind: 'helper', label: '2q. global installer works from a non-git directory',
  },
  [`${LEGACY_CASES.transcript}.command-qualifier`]: {
    kind: 'helper', label: '2t. {"type":"tool_executed","command":"npm test"} does not match another completed command',
  },
  [`${LEGACY_CASES.behavioralRunner}.fixture-traversal-rejected`]: {
    kind: 'helper', label: '2j. behavioral fixtures reject traversal for the expected boundary reason',
  },
  [`${LEGACY_CASES.workspace}.stable-unbound-workspace-key`]: {
    kind: 'output',
    pass: /^PASS 2u\. no-context non-git calls use one stable unbound workspace key$/,
    fail: /^FAIL 2u\. no-context non-git calls use one stable unbound workspace key$/,
  },
  [`${LEGACY_CASES.submodule}.unpublished-submodule-commit-rejected`]: {
    kind: 'assert', method: 'strictEqual', messageIndex: 2,
    message: 'an unpublished linked-worktree submodule commit must fail',
  },
  [`${LEGACY_CASES.verifyGate}.authoritative-contract-precedence`]: {
    kind: 'assert', method: 'strictEqual',
    callSite: { file: 'mechanism-35-verification-contract.test.js', line: 198 },
  },
  [`${LEGACY_CASES.skillRouting}.tdd-positive-relevance`]: {
    kind: 'output',
    // Paths print with the host separator, so accept both / and \ (Windows).
    pass: /^PASS tdd[\\/][^:]+: skill-specific relevance proven without pre-step path leaks$/,
    fail: /^FAIL evals[\\/]tdd[\\/]tasks[\\/][^:]+: skill is not a candidate step binding(?: \(got:.*\))?$/,
  },
};

function isWithin(root, candidate) {
  const relative = path.relative(path.resolve(root), path.resolve(candidate));
  return relative === '' || (relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
}

function resolveTupleCaseId(check) {
  return check.caseId || `LEGACY.${path.basename(check.test).replace(/\.test\.js$|\.js$/i, '')}`;
}

// A private module contract names its case as CAPTURE-B<nn> and its assertion as CAPTURE-B<nn>.detachment.<contract>.
// It is valid only in the capture-module test, and is checked by the same event protocol as RB assertions.
function isPrivateContract(check) {
  return check.test === 'ci/mechanism-341-capture-module.test.js'
    && /^CAPTURE-B\d{2}$/.test(check.caseId)
    && /^CAPTURE-B\d{2}\.detachment\.[a-z-]+$/.test(check.assertionId);
}

function validateCheck(check, root, legacyAssertions) {
  if (!check || typeof check !== 'object') throw new Error('Mutation check entry must be an object');
  for (const key of ['label', 'target', 'mutantId', 'test', 'assertionId']) {
    if (typeof check[key] !== 'string' || !check[key]) throw new Error(`Mutation check entry is missing ${key}`);
  }
  const caseId = resolveTupleCaseId(check);
  if (typeof caseId !== 'string' || !caseId || !check.assertionId.startsWith(`${caseId}.`)) {
    throw new Error(`Assertion ID must begin with the selected case ID: ${check.assertionId}`);
  }
  if (check.caseId && /^RB\d{2,}$/.test(check.caseId) && !/^RB\d{2,}\./.test(check.assertionId)) {
    throw new Error(`Corpus assertion ID must be case-scoped: ${check.assertionId}`);
  }
  const target = path.resolve(root, check.target);
  const test = path.resolve(root, check.test);
  if (!isWithin(root, target) || !isWithin(root, test)) throw new Error('Mutation target and test must stay within the selected root');
  if (!fs.existsSync(test) || !fs.statSync(test).isFile()) throw new Error(`Mutation test does not exist: ${test}`);
  const legacy = legacyAssertions[check.assertionId];
  if (!check.caseId || !/^RB\d{2,}$/.test(check.caseId)) {
    // Private module contracts (plan §3, B04) are event-protocol assertions in the capture-module test, not legacy checks.
    if (!legacy && !isPrivateContract(check)) throw new Error(`Legacy assertion signature is not mapped: ${check.assertionId}`);
  }
  return { ...check, caseId, absoluteTarget: target, absoluteTest: test, legacy };
}

function tokenizeNodeOptions(value) {
  const tokens = [];
  let token = '';
  let quote = null;
  for (let index = 0; index < value.length; index++) {
    const character = value[index];
    if (quote) {
      if (character === quote) quote = null;
      else if (character === '\\' && value[index + 1] === quote) token += value[++index];
      else token += character;
    } else if (character === '"' || character === "'") {
      quote = character;
    } else if (/\s/.test(character)) {
      if (token) tokens.push(token);
      token = '';
    } else {
      token += character;
    }
  }
  if (token) tokens.push(token);
  return tokens;
}

function quoteNodeOption(value) {
  return /\s/.test(value) ? `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"` : value;
}

function isSamePath(left, right) {
  const resolvedLeft = fs.existsSync(left) ? fs.realpathSync(left) : path.resolve(left);
  const resolvedRight = fs.existsSync(right) ? fs.realpathSync(right) : path.resolve(right);
  return process.platform === 'win32'
    ? resolvedLeft.toLowerCase() === resolvedRight.toLowerCase()
    : resolvedLeft === resolvedRight;
}

function stripLoaderPreload(nodeOptions, loaderPath) {
  const tokens = tokenizeNodeOptions(nodeOptions || '');
  const kept = [];
  for (let index = 0; index < tokens.length; index++) {
    const token = tokens[index];
    if (token === '--import' && tokens[index + 1]) {
      if (isSameImport(tokens[index + 1], loaderPath)) {
        index++;
        continue;
      }
      kept.push(token, tokens[++index]);
      continue;
    }
    if (token.startsWith('--import=')) {
      const imported = token.slice('--import='.length);
      if (isSameImport(imported, loaderPath)) continue;
    }
    if ((token === '--require' || token === '-r') && tokens[index + 1]) {
      if (isSamePath(tokens[index + 1], loaderPath)) {
        index++;
        continue;
      }
      kept.push(token, tokens[++index]);
      continue;
    }
    if (token.startsWith('--require=')) {
      const required = token.slice('--require='.length);
      if (isSamePath(required, loaderPath)) continue;
    }
    if (token.startsWith('-r') && token.length > 2 && isSamePath(token.slice(2), loaderPath)) continue;
    kept.push(token);
  }
  return kept.map(quoteNodeOption).join(' ');
}

// --import specifiers may be file: URLs; compare them as paths.
function isSameImport(specifier, loaderPath) {
  if (specifier.startsWith('file:')) {
    try {
      return isSamePath(fileURLToPath(specifier), loaderPath);
    } catch (_) {
      return false;
    }
  }
  return isSamePath(specifier, loaderPath);
}

function addLoaderPreload(nodeOptions, loaderPath) {
  const cleaned = stripLoaderPreload(nodeOptions, loaderPath);
  // --import resolves ESM specifiers, so a Windows drive path must be a file: URL.
  const preload = `--import=${pathToFileURL(loaderPath).href}`;
  return [cleaned, quoteNodeOption(preload)].filter(Boolean).join(' ');
}

function childEnvironment({ check, root, tempDir, mutation = null, testEnv = {}, allowTestMutations = false }) {
  const env = { ...process.env };
  for (const key of Object.keys(env)) {
    if (key.startsWith('HARNESS_MUTATION') || [
      'HARNESS_CASE_ID', 'HARNESS_ASSERTION_ID', 'HARNESS_ASSERTION_EVENT_FILE',
      'HARNESS_LEGACY_ASSERTION_CONFIG', 'HARNESS_TEST_HELPER_PATH',
    ].includes(key)) delete env[key];
  }
  const cleanNodeOptions = stripLoaderPreload(env.NODE_OPTIONS, LOADER);
  if (cleanNodeOptions) env.NODE_OPTIONS = cleanNodeOptions;
  else delete env.NODE_OPTIONS;
  for (const [key, value] of Object.entries(testEnv)) {
    if (key.startsWith('HARNESS_MUTATION') || [
      'HARNESS_CASE_ID', 'HARNESS_ASSERTION_ID', 'HARNESS_ASSERTION_EVENT_FILE',
      'HARNESS_LEGACY_ASSERTION_CONFIG', 'HARNESS_TEST_HELPER_PATH',
    ].includes(key)) throw new Error(`Synthetic test environment cannot override runner control: ${key}`);
    env[key] = value;
  }

  const eventFile = path.join(tempDir, mutation ? 'mutant-assertions.jsonl' : 'control-assertions.jsonl');
  env.HARNESS_ASSERTION_EVENT_FILE = eventFile;
  env.HARNESS_ASSERTION_ID = check.assertionId;
  if (/^RB\d{2,}$/.test(check.caseId)) env.HARNESS_CASE_ID = check.caseId;

  const args = [];
  let tapFile = null;
  if (check.legacy && (check.legacy.kind === 'helper' || check.legacy.kind === 'assert')) {
    const tapDescriptor = {
      ...check.legacy,
      caseId: check.caseId,
      assertionId: check.assertionId,
    };
    env.HARNESS_LEGACY_ASSERTION_CONFIG = JSON.stringify(tapDescriptor);
    if (check.legacy.kind === 'helper') env.HARNESS_TEST_HELPER_PATH = path.join(root, 'ci', 'test-helper.js');
    tapFile = path.join(tempDir, 'assertion-tap.js');
    fs.writeFileSync(tapFile, assertionTapSource(), 'utf8');
    args.push('--require', tapFile);
  }

  if (mutation) {
    const evidenceFile = path.join(tempDir, 'mutation-loader.jsonl');
    env.HARNESS_MUTATION = check.mutantId;
    env.HARNESS_MUTATION_TARGET = check.absoluteTarget;
    env.HARNESS_MUTATION_ROOT = root;
    env.HARNESS_MUTATION_EVIDENCE_FILE = evidenceFile;
    env.HARNESS_MUTATION_EXPECT_SOURCE_HASH = mutation.sourceHash;
    env.HARNESS_MUTATION_EXPECT_TRANSFORMED_HASH = mutation.transformedHash;
    if (allowTestMutations) env.HARNESS_MUTATION_TEST_MODE = '1';
    env.HARNESS_MUTATION_LOADER_PRELOAD = '1';
    env.NODE_OPTIONS = addLoaderPreload(env.NODE_OPTIONS, LOADER);
  }
  args.push(check.absoluteTest);
  return { env, args, eventFile, evidenceFile: mutation ? env.HARNESS_MUTATION_EVIDENCE_FILE : null, tapFile };
}

function assertionTapSource() {
  return String.raw`
'use strict';
const fs = require('fs');
const config = JSON.parse(process.env.HARNESS_LEGACY_ASSERTION_CONFIG);
const eventFile = process.env.HARNESS_ASSERTION_EVENT_FILE;
function emit(failed) {
  const record = {
    schemaVersion: 1,
    event: failed ? 'assertion-failure' : 'assertion-pass',
    caseId: config.caseId,
    assertionId: config.assertionId,
  };
  if (failed) record.errorCode = 'ERR_ASSERTION';
  fs.appendFileSync(eventFile, JSON.stringify(record) + '\n', 'utf8');
}
if (config.kind === 'helper') {
  const helper = require(process.env.HARNESS_TEST_HELPER_PATH);
  const original = helper.check;
  helper.check = function checkWithMutationEvent(name, condition, ...rest) {
    if (name === config.label) emit(!condition);
    return original.call(this, name, condition, ...rest);
  };
} else if (config.kind === 'assert') {
  const assert = require('assert');
  const original = assert[config.method];
  if (typeof original !== 'function') throw new Error('Unknown legacy assert method: ' + config.method);
  assert[config.method] = function assertWithMutationEvent(...args) {
      const selectedCallSite = config.callSite && (new Error().stack || '').split(/\r?\n/).some(line =>
        line.includes(config.callSite.file + ':' + config.callSite.line + ':'));
      const selectedAssertion = config.callSite ? selectedCallSite : args[config.messageIndex] === config.message;
      if (!selectedAssertion) return original.apply(this, args);
    try {
      const result = original.apply(this, args);
      emit(false);
      return result;
    } catch (error) {
      if (error && error.code === 'ERR_ASSERTION') emit(true);
      throw error;
    }
  };
}
`;
}

function runChild({ check, root, tempDir, mutation = null, testEnv, allowTestMutations, timeoutMs }) {
  const invocation = childEnvironment({ check, root, tempDir, mutation, testEnv, allowTestMutations });
  const result = spawnSync(process.execPath, invocation.args, {
    cwd: root,
    env: invocation.env,
    encoding: 'utf8',
    windowsHide: true,
    timeout: timeoutMs,
    maxBuffer: 8 * 1024 * 1024,
  });
  return {
    ...result,
    eventFile: invocation.eventFile,
    evidenceFile: invocation.evidenceFile,
    output: `${result.stdout || ''}\n${result.stderr || ''}`,
  };
}

function readJsonLines(file) {
  if (!fs.existsSync(file)) return [];
  const text = fs.readFileSync(file, 'utf8');
  const events = [];
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) continue;
    try {
      events.push(JSON.parse(line));
    } catch (error) {
      return { error: `malformed JSONL: ${error.message}` };
    }
  }
  return events;
}

function isAssertionEvent(event) {
  if (!event || event.schemaVersion !== 1 || typeof event.caseId !== 'string' || !event.caseId ||
      typeof event.assertionId !== 'string' || !event.assertionId.startsWith(`${event.caseId}.`)) return false;
  if (event.event === 'assertion-pass') return true;
  return event.event === 'assertion-failure' && event.errorCode === 'ERR_ASSERTION';
}

function matchingAssertionEvents(events, check) {
  if (!Array.isArray(events) || events.some(event => !isAssertionEvent(event))) return { error: 'invalid assertion event' };
  const matching = events.filter(event => event.caseId === check.caseId && event.assertionId === check.assertionId);
  const failures = events.filter(event => event.event === 'assertion-failure');
  return { matching, failures };
}

function outputLines(output) {
  return output.split(/\r?\n/).map(line => line.trimEnd());
}

function regexMatches(lines, matcher) {
  return lines.filter(line => {
    matcher.lastIndex = 0;
    return matcher.test(line);
  });
}

function evaluateControl(result, check) {
  if (result.error || result.signal || result.status !== 0) return { passed: false, reason: `control process status=${result.status} signal=${result.signal || 'none'}${result.error ? ` error=${result.error.message}` : ''}` };
  if (check.legacy && check.legacy.kind === 'output') {
    const lines = outputLines(result.output);
    const pass = regexMatches(lines, check.legacy.pass);
    const failures = lines.filter(line => /^FAIL(?:\s|$)/.test(line));
    return pass.length > 0 && failures.length === 0
      ? { passed: true }
      : { passed: false, reason: `expected legacy pass signature; pass hits=${pass.length}, failure lines=${failures.length}` };
  }
  const events = readJsonLines(result.eventFile);
  if (!Array.isArray(events)) return { passed: false, reason: events.error };
  const selected = matchingAssertionEvents(events, check);
  if (selected.error) return { passed: false, reason: selected.error };
  if (selected.matching.length !== 1 || selected.matching[0].event !== 'assertion-pass' || selected.failures.length) {
    return { passed: false, reason: `expected one passing ${check.caseId}/${check.assertionId} event` };
  }
  return { passed: true };
}

// Finds uncaught Node exceptions: an Error header line with stack frames after it. A multi-line message pushes
// the frames down, so the frames are searched in the lines that follow the header.
function uncaughtErrors(output) {
  const lines = outputLines(output);
  const found = [];
  lines.forEach((line, index) => {
    const header = /^([A-Za-z]*Error)(?: \[([A-Z0-9_]+)\])?: (.*)$/.exec(line);
    if (!header) return;
    const nearby = lines.slice(index + 1, index + 61);
    if (nearby.some(next => /^\s+at \S/.test(next))) found.push({ name: header[1], code: header[2], message: header[3] });
  });
  return found;
}

// The one uncaught exception a selected check may end with. A legacy Node assert failure throws its own
// AssertionError, so that exact error is the intended failure. Every other kind fails through the event file or a
// status 1 exit with no stack, so any uncaught exception from it is unrelated to the selected assertion.
function expectedUncaughtError(check) {
  if (check.legacy && check.legacy.kind === 'assert') {
    return error => error.name === 'AssertionError' && error.code === 'ERR_ASSERTION' &&
      (check.legacy.message === undefined || error.message === check.legacy.message);
  }
  return null;
}

function evaluateMutated(result, check) {
  const processNormal = !result.error && !result.signal && (result.status === 0 || result.status === 1);
  if (!processNormal) return { verdict: 'INFRA_MUTATED', intendedAssertion: 'MISSING', reason: `mutated process status=${result.status} signal=${result.signal || 'none'}${result.error ? ` error=${result.error.message}` : ''}` };
  // Crash screening applies to every kind (owner review P2-2), so an unrelated uncaught exception cannot be credited.
  const uncaught = uncaughtErrors(result.output);
  const allowed = expectedUncaughtError(check);
  if (uncaught.length > 0 && !(allowed && uncaught.length === 1 && allowed(uncaught[0]))) {
    const [first] = uncaught;
    return { verdict: 'INFRA_MUTATED', intendedAssertion: 'MISSING', reason: `uncaught Node exception unrelated to the selected assertion: ${first.name}${first.code ? ` [${first.code}]` : ''}` };
  }

  if (check.legacy && check.legacy.kind === 'output') {
    const lines = outputLines(result.output);
    const expected = regexMatches(lines, check.legacy.fail);
    const failLines = lines.filter(line => /^FAIL(?:\s|$)/.test(line));
    const unrelated = failLines.filter(line => {
      check.legacy.fail.lastIndex = 0;
      return !check.legacy.fail.test(line);
    });
    if (result.status === 1 && expected.length > 0 && unrelated.length === 0) {
      return { verdict: 'KILLED', intendedAssertion: 'FAIL' };
    }
    if (result.status === 0 && expected.length === 0) return { verdict: 'SURVIVED', intendedAssertion: 'PASS' };
    return { verdict: 'INFRA_MUTATED', intendedAssertion: expected.length ? 'FAIL' : 'MISSING', reason: `expected legacy failure signature; hits=${expected.length}, unrelated failures=${unrelated.length}, status=${result.status}` };
  }

  const events = readJsonLines(result.eventFile);
  if (!Array.isArray(events)) return { verdict: 'INFRA_MUTATED', intendedAssertion: 'MISSING', reason: events.error };
  const selected = matchingAssertionEvents(events, check);
  if (selected.error) return { verdict: 'INFRA_MUTATED', intendedAssertion: 'MISSING', reason: selected.error };
  if (selected.matching.length === 1 && selected.matching[0].event === 'assertion-failure' &&
      result.status === 1) {
    return { verdict: 'KILLED', intendedAssertion: 'FAIL' };
  }
  if (selected.matching.length === 1 && selected.matching[0].event === 'assertion-pass' &&
      result.status === 0 && selected.failures.length === 0) {
    return { verdict: 'SURVIVED', intendedAssertion: 'PASS' };
  }
  return {
    verdict: 'INFRA_MUTATED',
    intendedAssertion: selected.matching.length ? selected.matching[0].event === 'assertion-failure' ? 'FAIL' : 'PASS' : 'MISSING',
    reason: `no unique intended failure; selected events=${selected.matching.length}, failures=${selected.failures.length}, status=${result.status}`,
  };
}

function readLoaderEvidence(file, check, mutation) {
  const records = readJsonLines(file);
  if (!Array.isArray(records) || records.length === 0) return { loaded: false, reason: Array.isArray(records) ? 'no selected target load evidence' : records.error };
  for (const evidence of records) {
    const targetMatches = typeof evidence.target === 'string' && isSamePath(evidence.target, check.absoluteTarget);
    const hashesMatch = evidence.sourceHash === mutation.sourceHash && evidence.transformedHash === mutation.transformedHash &&
      SHA256.test(evidence.sourceHash || '') && SHA256.test(evidence.transformedHash || '');
    if (!targetMatches || evidence.mutantId !== check.mutantId || evidence.applied !== true || evidence.parses !== true || !hashesMatch) {
      return { loaded: false, reason: 'loader evidence does not match the selected target, mutant, transform, or source hashes' };
    }
  }
  return { loaded: true, records };
}

function failedReport(check, verdict, reason, fields = {}) {
  return {
    label: check.label,
    target: check.target,
    mutantId: check.mutantId,
    test: check.test,
    caseId: check.caseId,
    assertionId: check.assertionId,
    control: fields.control || 'NOT_RUN',
    applied: fields.applied === true,
    parses: fields.parses === true,
    loaded: fields.loaded === true,
    intendedAssertion: fields.intendedAssertion || 'NOT_REACHED',
    verdict,
    reason,
  };
}

function runCheck(rawCheck, {
  root = ROOT,
  allowTestMutations = false,
  timeoutMs = 60000,
  testEnv = {},
  legacyAssertions = LEGACY_ASSERTIONS,
} = {}) {
  const absoluteRoot = path.resolve(root);
  let check;
  try {
    check = validateCheck(rawCheck, absoluteRoot, legacyAssertions);
  } catch (error) {
    return failedReport(rawCheck || {}, 'INVALID_CHECK', error.message);
  }

  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-mutation-run-'));
  try {
    const controlResult = runChild({ check, root: absoluteRoot, tempDir, testEnv, allowTestMutations, timeoutMs });
    const control = evaluateControl(controlResult, check);
    if (!control.passed) return failedReport(check, 'CONTROL_FAILED', control.reason, { control: 'FAIL' });

    let mutation;
    try {
      mutation = prepareMutation({
        root: absoluteRoot,
        target: check.target,
        mutantId: check.mutantId,
        allowTestMutations,
      });
    } catch (error) {
      return failedReport(check, 'INVALID_MUTANT', error.message, { control: 'PASS' });
    }
    if (!mutation.applied) return failedReport(check, 'INVALID_MUTANT', 'transform did not change source bytes', { control: 'PASS', applied: false, parses: mutation.parses });
    if (!mutation.parses) return failedReport(check, 'INVALID_MUTANT', `transformed source does not parse: ${mutation.parseError}`, { control: 'PASS', applied: true, parses: false });

    const mutantResult = runChild({
      check,
      root: absoluteRoot,
      tempDir,
      mutation,
      testEnv,
      allowTestMutations,
      timeoutMs,
    });
    const loader = readLoaderEvidence(mutantResult.evidenceFile, check, mutation);
    if (!loader.loaded) {
      const detail = outputLines(mutantResult.output).filter(Boolean).slice(-5).join(' | ').slice(0, 700);
      const processDetail = `child status=${mutantResult.status} signal=${mutantResult.signal || 'none'}${mutantResult.error ? ` error=${mutantResult.error.message}` : ''}${detail ? ` output=${detail}` : ''}`;
      return failedReport(check, 'UNLOADED', `${loader.reason}; ${processDetail}`, { control: 'PASS', applied: true, parses: true, loaded: false });
    }

    const assessment = evaluateMutated(mutantResult, check);
    return failedReport(check, assessment.verdict, assessment.reason || 'qualified', {
      control: 'PASS',
      applied: true,
      parses: true,
      loaded: true,
      intendedAssertion: assessment.intendedAssertion,
    });
  } catch (error) {
    return failedReport(check, 'INFRASTRUCTURE_ERROR', error && error.message ? error.message : String(error));
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

function runChecks({
  checks = CHECKS,
  root = ROOT,
  allowTestMutations = false,
  timeoutMs = 60000,
  testEnv = {},
  legacyAssertions = LEGACY_ASSERTIONS,
} = {}) {
  return checks.map(check => runCheck(check, { root, allowTestMutations, timeoutMs, testEnv, legacyAssertions }));
}

function printReport(report) {
  const intended = report.intendedAssertion === 'NOT_REACHED' ? 'not-reached' : report.intendedAssertion.toLowerCase();
  console.log(`${report.label}: control=${report.control.toLowerCase()} applied=${report.applied} parses=${report.parses} loaded=${report.loaded} intended=${intended} verdict=${report.verdict}`);
  if (report.reason && report.verdict !== 'KILLED') console.error(`  ${report.reason}`);
}

function selectChecks(argv) {
  const filters = [];
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];
    if (arg === '--filter' && argv[index + 1]) filters.push(argv[++index]);
    else if (arg.startsWith('--filter=')) filters.push(arg.slice('--filter='.length));
    else throw new Error(`Unknown mutation-check argument: ${arg}`);
  }
  if (!filters.length) return CHECKS;
  const selected = CHECKS.filter(check => filters.some(filter => check.mutantId === filter || check.label === filter));
  if (!selected.length) throw new Error(`No mutation tuple matched filter: ${filters.join(', ')}`);
  return selected;
}

function main(argv = process.argv.slice(2)) {
  let selected;
  try {
    selected = selectChecks(argv);
  } catch (error) {
    console.error(error.message);
    process.exitCode = 2;
    return;
  }
  console.log(`Running ${selected.length} qualified mutation tuple(s)...`);
  const reports = runChecks({ checks: selected });
  reports.forEach(printReport);
  const failures = reports.filter(report => report.verdict !== 'KILLED');
  if (failures.length) {
    console.error(`Mutation check failed: ${failures.length} tuple(s) did not qualify.`);
    process.exitCode = 1;
  } else {
    console.log(`Mutation check passed: ${reports.length} production mutant(s) were rejected by their intended assertions.`);
  }
}

if (require.main === module) main();

module.exports = {
  CHECKS,
  isPrivateContract,
  LEGACY_ASSERTIONS,
  LEGACY_CASES,
  runCheck,
  runChecks,
  stripLoaderPreload,
  evaluateControl,
  evaluateMutated,
  addLoaderPreload,
};
