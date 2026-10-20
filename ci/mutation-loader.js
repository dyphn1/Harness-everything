'use strict';

const crypto = require('crypto');
const fs = require('fs');
const Module = require('module');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');

function replacement(anchor, value) {
  return { anchor, replacement: value };
}

const DOC_EVIDENCE_CANONICAL = 'harness-everything/scripts/doc-evidence.js';
const DOC_EVIDENCE_PACKAGED = 'plugins/harness-everything/skills/harness-everything/scripts/doc-evidence.js';

function docEvidenceMutation(replacements) {
  return {
    target: DOC_EVIDENCE_CANONICAL,
    alternateTargets: [DOC_EVIDENCE_PACKAGED],
    replacements,
  };
}

const DOC_EVIDENCE_CAPTURE_CANONICAL = 'harness-everything/scripts/doc-evidence-capture.js';
const DOC_EVIDENCE_CAPTURE_PACKAGED = 'plugins/harness-everything/skills/harness-everything/scripts/doc-evidence-capture.js';

function docCaptureMutation(replacements) {
  return {
    target: DOC_EVIDENCE_CAPTURE_CANONICAL,
    alternateTargets: [DOC_EVIDENCE_CAPTURE_PACKAGED],
    replacements,
  };
}

const MUTATIONS = {
  'path-boundary': {
    target: 'scripts/lib/path-boundary.js',
    replacements: [replacement(
      '  assertNoLinkComponents(root, candidate);',
      '  // mutation: skip physical link-component validation'
    )],
  },
  'execution-contract': {
    target: 'scripts/lib/execution-contract.js',
    replacements: [replacement(
      '  return left !== null && left === right;',
      '  return left !== null; // mutation: accept every non-null command'
    )],
  },
  'evidence-tool': {
    target: 'behavioral-evals/evidence-tool.js',
    replacements: [
      replacement(
        '  const containedDestination = assertContainedPath(archiveRoot, destination).target;',
        '  const containedDestination = destination; // mutation: skip destination boundary'
      ),
      replacement(
        '  const contained = assertContainedPath(archiveRoot, target).target;',
        '  const contained = target; // mutation: skip archive write boundary'
      ),
    ],
  },
  'scaffold-migration': {
    target: 'multi-agent-workspace/scripts/scaffold.js',
    replacements: [replacement(
      '  assertContainedPath(workspaceRoot, legacyRoot);',
      '  // mutation: skip linked legacy-root validation'
    )],
  },
  'installer-global': {
    target: 'scripts/installer.js',
    replacements: [replacement(
      'const workspaceRoot = detectedWorkspaceRoot || path.resolve(process.cwd());',
      'const workspaceRoot = detectedWorkspaceRoot; // mutation: restore null global workspace'
    )],
  },
  'transcript-command': {
    target: 'behavioral-evals/transcript-parser.js',
    replacements: [replacement(
      '    if (target.command !== undefined && (!isObject(call.input) || !commandMatches(call.input.command, target.command))) return false;',
      '    // mutation: ignore command qualifiers'
    )],
  },
  'runner-fixture': {
    target: 'behavioral-evals/run.js',
    replacements: [replacement(
      '    const relative = normalizeRepoPath(file && file.path);',
      '    const relative = file && file.path; // mutation: skip fixture path normalization'
    )],
  },
  'workspace-identity': {
    target: 'scripts/lib/workspace.js',
    replacements: [replacement(
      '  if (!workspaceRoot) return UNBOUND_WORKSPACE_KEY;',
      '  if (!workspaceRoot) return path.basename(process.cwd()); // mutation: derive unbound identity from cwd'
    )],
  },
  'submodule-reachability': {
    target: 'using-git-worktrees/scripts/submodule-reachability.js',
    replacements: [replacement(
      '    const externallyReachable = !linkedWorktree || reachableFromRemote || presentInPrimary;',
      '    const externallyReachable = true; // mutation: accept isolated worktree-only commits'
    )],
  },
  'verify-contract-precedence': {
    target: 'harness-everything/scripts/verify-gate.js',
    replacements: [replacement(
      '  finalize(contract ? contractPlan(contract) : discoveredPlan());',
      '  finalize(discoveredPlan()); // mutation: ignore the authoritative project contract'
    )],
  },
  'knowledge-signal-matcher': {
    target: 'harness-everything/scripts/tier-router.js',
    replacements: [replacement(
      "    if (matched && typeof group.id === 'string') {",
      "    if (matched && typeof group.id === 'string' && group.id !== 'tdd-test') { // mutation: remove the tdd-test matcher"
    )],
  },
  // Doc-evidence mutants bind to the file that owns the operation after the 0B refactor (plan §3): captures R1-R6,
  // the own-key helper, the PRD digest and the candidate-inventory predicate now live in doc-evidence-capture.js;
  // compatibility policy stays in doc-evidence.js. Each mutant keeps its intended assertion; only its target moved.
  M01: docCaptureMutation([replacement(
    'if (nonEmptyString(declaredBaselineDigest)) baselineDigest = declaredBaselineDigest;',
    'if (nonEmptyString(declaredBaselineDigest)) baselineDigest = baseline.digest; // mutation: re-read R1'
  )]),
  'M01-stateful': docCaptureMutation([replacement(
    'if (nonEmptyString(declaredBaselineDigest)) baselineDigest = declaredBaselineDigest;',
    'if (nonEmptyString(declaredBaselineDigest)) baselineDigest = baseline.digest; // mutation: re-read R1'
  )]),
  M02: docCaptureMutation([replacement(
    '    if (!candidateInventoryInitialized) {',
    '    if (true) { // mutation: repeat the R2 prototype inspection'
  )]),
  M03: docCaptureMutation([replacement(
    'const digest = entry.digest;',
    'const digest = artifact(entry); // mutation: re-read the R3 destination digest'
  )]),
  M04: docCaptureMutation([
    replacement(
      '            rawReason: snapshot.reason,',
      '            rawReason: snapshot.reason,\n            rawEntry, // mutation: retain the raw entry for audit materialization'
    ),
    replacement(
      '          return [...validatedBaselineDigests].map(([path, digest]) => Object.freeze([path, digest]));',
      '          return [...validatedBaselineDigests].map(([path, digest]) => { const live = [...entryFacts.values()].find(fact => fact.rawEntry && fact.rawEntry.path === path); return Object.freeze([live ? live.rawEntry.path : path, digest]); }); // mutation: re-read the raw R4 entry path at audit materialization'
    ),
  ]),
  M05: docCaptureMutation([replacement(
    "          const trustedBaselineDigest = typeof detachedEntry.trustedBaselineDigest === 'string'\n            ? detachedEntry.trustedBaselineDigest : undefined;",
    "          const trustedBaselineDigest = hasOwnEntry(baselineArtifactsMap, detachedEntry.path) && typeof baselineArtifactsMap[detachedEntry.path] === 'string'\n            ? baselineArtifactsMap[detachedEntry.path] : undefined; // mutation: live R5 per-path read at binding"
  )]),
  M06: docCaptureMutation([replacement(
    '          } else if (sharedDigest !== digest) {',
    '          } else if (false) { // mutation: accept disagreeing R3 snapshots'
  )]),
  'M06-observation': docCaptureMutation([replacement(
    '          } else if (sharedDigest !== digest) {',
    '          } else if (false) { // mutation: accept disagreeing R3 snapshots'
  )]),
  'M07a': docCaptureMutation([replacement(
    '          return failedDestinationDigests.has(path);',
    '          return false; // mutation: permit a later declaring entry to read a poisoned destination'
  )]),
  'M07b': docCaptureMutation([replacement(
    "    if (failedDestinationDigests.has(path)) return '';",
    '    // mutation: allow a cached value to outrank a poisoned destination'
  )]),
  'M07b-audit-output': docCaptureMutation([replacement(
    "    if (failedDestinationDigests.has(path)) return '';",
    '    // mutation: allow a cached value to outrank a poisoned destination'
  )]),
  M08: docCaptureMutation([replacement(
    '    && Object.prototype.hasOwnProperty.call(map, key);',
    '    && key in map; // mutation: accept inherited evidence'
  )]),
  M09: docCaptureMutation([replacement(
    '          return [...acceptedBaselineEntries.values()].map(entry => Object.freeze({ ...entry }));',
    '          return [...acceptedBaselineEntries.values()].map(entry => Object.freeze({ ...entry, candidatePathPresent: hasOwnEntry(artifactMap, entry.path) })); // mutation: re-inspect the raw candidate own membership at consumer use'
  )]),
  'M09-descriptor-count': docCaptureMutation([replacement(
    '          return [...acceptedBaselineEntries.values()].map(entry => Object.freeze({ ...entry }));',
    '          return [...acceptedBaselineEntries.values()].map(entry => Object.freeze({ ...entry, candidatePathPresent: hasOwnEntry(artifactMap, entry.path) })); // mutation: re-inspect the raw candidate own membership at consumer use'
  )]),
  M10: docEvidenceMutation([replacement(
    "Boolean(scopeObject && Object.prototype.hasOwnProperty.call(scopeObject, 'baselinePaths'))",
    'Boolean(scopeObject && scopeObject.baselinePaths) // mutation: treat present-undefined as absent'
  )]),
  'M10-rename-to': docEvidenceMutation([replacement(
    "if (entryReason === 'deleted' && entryCapture.hasOwnRenameTo) {",
    "if (entryReason === 'deleted' && entryCapture.renameTo) { // mutation: use renameTo truthiness"
  )]),
  M11: docCaptureMutation([replacement(
    '          } catch {\n            snapshot = null;\n          }',
    '          } catch (error) {\n            throw error; // mutation: let entry metadata inspection escape\n          }'
  )]),
  'M11-entry-exception': docCaptureMutation([replacement(
    '          } catch {\n            snapshot = null;\n          }',
    '          } catch (error) {\n            throw error; // mutation: let entry metadata inspection escape\n          }'
  )]),
  'M11-baseline-map': docCaptureMutation([replacement(
    "          } catch {\n            result = Object.freeze({ kind: 'unknown', reason: 'inspection' });",
    "          } catch (error) {\n            throw error; // mutation: let baseline-map inspection escape\n            result = Object.freeze({ kind: 'unknown', reason: 'inspection' });"
  )]),
  'M11-candidate-descriptor': docCaptureMutation([
    replacement(
      "          let digest = '';\n          try {",
      "          let digest = '';\n          const declared = hasOwnEntry(artifactMap, path); // mutation: let descriptor inspection escape\n          try {"
    ),
    replacement(
      '            if (hasOwnEntry(artifactMap, path)) digest = ownDigestOnce(artifactMap[path]);',
      '            if (declared) digest = ownDigestOnce(artifactMap[path]);'
    ),
  ]),
  'M11-destination': docCaptureMutation([replacement(
    "          } catch {\n            return Object.freeze({ kind: 'inspection-failed' });\n          }\n          if (!nonEmptyString(digest))",
    "          } catch (error) {\n            throw error; // mutation: let destination inspection escape\n          }\n          if (!nonEmptyString(digest))"
  )]),
  'M11-ordinary-capture': docCaptureMutation([replacement(
    '            } catch {\n              inspectionFailed = true;',
    '            } catch (error) {\n              throw error; // mutation: let ordinary candidate capture escape\n              inspectionFailed = true;'
  )]),
  M12: docCaptureMutation([replacement(
    '    if (candidateDigestCache.has(path)) return candidateDigestCache.get(path);',
    '    if (candidateDigestCache.has(path)) return artifact(artifactMap[path]); // mutation: re-read R6'
  )]),
  M13: docEvidenceMutation([replacement(
    '      if (!item.paths.includes(entry.renameTo)) return false;',
    '      return true; // mutation: let a source-only rename record bind'
  )]),
  M14: docCaptureMutation([replacement(
    '  return prototype === Object.prototype || prototype === null;',
    '  return true; // mutation: accept every object-like inventory'
  )]),
  'M14-diagnostic': docCaptureMutation([replacement(
    '  return prototype === Object.prototype || prototype === null;',
    '  return true; // mutation: accept every object-like inventory'
  )]),
  M15: docEvidenceMutation([replacement(
    "          if (applicability === 'applicable') {",
    '          if (true) { // mutation: inspect destination metadata for every applicability state'
  )]),
  M16: docCaptureMutation([replacement(
    "  return entry && typeof entry.digest === 'string' && entry.digest.length > 0 ? entry.digest : '';",
    "  const digest = entry && entry.digest;\n  return typeof digest === 'string' && digest.length > 0 ? digest : ''; // mutation: cache legacy digest reads"
  )]),
  'M16-trace': docCaptureMutation([replacement(
    "  return entry && typeof entry.digest === 'string' && entry.digest.length > 0 ? entry.digest : '';",
    "  const digest = entry && entry.digest;\n  return typeof digest === 'string' && digest.length > 0 ? digest : ''; // mutation: cache legacy digest reads"
  )]),
  M17: docEvidenceMutation([replacement(
    "function isRecord(value) {\n  return isPlainObject(value)\n    && typeof value.id === 'string' && value.id.length > 0\n    && typeof value.obligationId === 'string' && value.obligationId.length > 0;\n}",
    "function isRecord(value) {\n  if (!isPlainObject(value)) return false;\n  const id = value.id;\n  const obligationId = value.obligationId;\n  return typeof id === 'string' && id.length > 0\n    && typeof obligationId === 'string' && obligationId.length > 0; // mutation: cache record identity reads\n}"
  )]),
  M18: docEvidenceMutation([replacement(
    '      const mismatch = item.paths.find(path => obligationCapture.compatibilityStaleArtifactMismatch(item, path));',
    '      const mismatch = item.paths.filter(path => scopePaths.includes(path)).find(path => obligationCapture.compatibilityStaleArtifactMismatch(item, path)); // mutation: ignore out-of-scope stale paths'
  )]),
  M19: docCaptureMutation([replacement(
    ".filter(path => path.startsWith('docs/prd/'))",
    ".filter(path => path.startsWith('docs/prd/') && path !== 'docs/prd/extra.md') // mutation: omit an out-of-scope PRD"
  )]),
  'M19-eager': docEvidenceMutation([replacement(
    '    const revisionSatisfied = revisionDataKnown && citedIds.length > 0\n      && citedIds.every(id => updatedIds.includes(id));',
    '    capture.compatibilityPrdSetDigest(); // mutation: enumerate PRDs before the revision fast path\n    const revisionSatisfied = revisionDataKnown && citedIds.length > 0\n      && citedIds.every(id => updatedIds.includes(id));'
  )]),
  M20: docEvidenceMutation([replacement(
    'citedIds.every(id => updatedIds.includes(id))',
    'citedIds.some(id => updatedIds.includes(id)) // mutation: partial revision counts as complete'
  )]),
  'M20-partial-revision': docEvidenceMutation([replacement(
    'citedIds.every(id => updatedIds.includes(id))',
    'citedIds.some(id => updatedIds.includes(id)) // mutation: partial revision counts as complete'
  )]),
  'M20-unknown-scope': docEvidenceMutation([replacement(
    '  if (requirementScopeUnknown) {',
    '  if (false) { // mutation: ignore unknown requirement scope'
  )]),
  // New scope mutants (plan §3, required module-specific table). Their coverage is registered in
  // ci/mutation-check.js, not cases.json, so the pinned corpus bytes stay unchanged.
  'B01-r5-cross-obligation': docCaptureMutation([
    replacement(
      'function createInvocationCapture({ artifacts, baseline }) {\n  let artifactMap;',
      'function createInvocationCapture({ artifacts, baseline }) {\n  const sharedBaselinePathReads = new Map(); // mutation: share per-path baseline reads across obligations\n  let artifactMap;'
    ),
    replacement(
      '      const baselinePathReads = new Map();',
      '      const baselinePathReads = sharedBaselinePathReads;'
    ),
  ]),
  'B02-r3-per-destination-collapse': docCaptureMutation([replacement(
    '        captureDestination(entryToken, path) {\n          void entryToken;',
    "        captureDestination(entryToken, path) {\n          void entryToken;\n          const reused = [...validatedDestinationDigestMap.values()][0]; // mutation: reuse the first destination digest\n          if (reused !== undefined) return Object.freeze({ kind: 'accepted', digest: reused });"
  )]),
  'B02-observation': docCaptureMutation([replacement(
    '        captureDestination(entryToken, path) {\n          void entryToken;',
    "        captureDestination(entryToken, path) {\n          void entryToken;\n          const reused = [...validatedDestinationDigestMap.values()][0]; // mutation: reuse the first destination digest\n          if (reused !== undefined) return Object.freeze({ kind: 'accepted', digest: reused });"
  )]),
  'B03-r3-cross-obligation': docCaptureMutation([
    replacement(
      'function createInvocationCapture({ artifacts, baseline }) {\n  let artifactMap;',
      'function createInvocationCapture({ artifacts, baseline }) {\n  const sharedDestinationDigests = new Map(); // mutation: share destination agreement across evaluation tokens\n  const sharedFailedDestinations = new Map(); // mutation: share destination poison across evaluation tokens\n  let artifactMap;'
    ),
    replacement(
      '      const validatedDestinationDigestMap = new Map();',
      '      const validatedDestinationDigestMap = sharedDestinationDigests;'
    ),
    replacement(
      '      const failedDestinationDigests = new Map();',
      '      const failedDestinationDigests = sharedFailedDestinations;'
    ),
  ]),
  'B04-mutable-view': docCaptureMutation([replacement(
    '          return [...acceptedBaselineEntries.values()].map(entry => Object.freeze({ ...entry }));',
    '          return [...acceptedBaselineEntries.values()]; // mutation: return shared mutable views'
  )]),
  'B04-leak': docCaptureMutation([replacement(
    '            hasOwnRenameTo: snapshot.hasOwnRenameTo,',
    '            hasOwnRenameTo: snapshot.hasOwnRenameTo,\n            rawEntry, // mutation: leak the caller-owned entry into the returned view'
  )]),
};

const TEST_MUTATIONS = {
  'test-noop': { target: 'synthetic-target.js', replacements: [replacement('module.exports = true;', 'module.exports = true;')] },
  'test-kill': { target: 'synthetic-target.js', replacements: [replacement('module.exports = true;', 'module.exports = false;')] },
  'test-survive': { target: 'synthetic-target.js', replacements: [replacement('module.exports = true;', 'module.exports = true; // unrelated synthetic change')] },
  'test-crash': { target: 'synthetic-target.js', replacements: [replacement('module.exports = true;', "throw new Error('synthetic module crash');")] },
  'test-syntax': { target: 'synthetic-target.js', replacements: [replacement('module.exports = true;', 'module.exports = ;')] },
  'test-exit': { target: 'synthetic-target.js', replacements: [replacement('module.exports = true;', 'process.exit(1);')] },
};

function mutationSpec(mutantId, allowTestMutations = false) {
  if (Object.prototype.hasOwnProperty.call(MUTATIONS, mutantId)) return MUTATIONS[mutantId];
  if (allowTestMutations && Object.prototype.hasOwnProperty.call(TEST_MUTATIONS, mutantId)) return TEST_MUTATIONS[mutantId];
  throw new Error(`Unknown mutant ID: ${mutantId}`);
}

function sha256(bytes) {
  return crypto.createHash('sha256').update(bytes).digest('hex');
}

function canonicalPath(filePath) {
  const absolutePath = path.resolve(filePath);
  return fs.existsSync(absolutePath) ? fs.realpathSync(absolutePath) : absolutePath;
}

function isWithin(root, candidate) {
  const relative = path.relative(root, candidate);
  return relative === '' || (relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
}

function prepareMutation({ root = ROOT, target, mutantId, allowTestMutations = false } = {}) {
  if (typeof target !== 'string' || !target) throw new Error('Mutation target must be a non-empty path');
  const spec = mutationSpec(mutantId, allowTestMutations);
  const absoluteRoot = path.resolve(root);
  const canonicalRoot = canonicalPath(absoluteRoot);
  const expectedTargets = [spec.target, ...(spec.alternateTargets || [])]
    .map(candidate => canonicalPath(path.resolve(canonicalRoot, candidate)));
  const requestedTarget = path.resolve(absoluteRoot, target);
  if (!isWithin(canonicalRoot, canonicalPath(requestedTarget))) {
    throw new Error(`Mutation target is outside the selected root: ${requestedTarget}`);
  }
  const actualTarget = canonicalPath(requestedTarget);
  const sameTarget = expectedTargets.some(expectedTarget => process.platform === 'win32'
    ? expectedTarget.toLowerCase() === actualTarget.toLowerCase()
    : expectedTarget === actualTarget);
  if (!sameTarget) throw new Error(`Wrong target for mutant ${mutantId}: expected ${expectedTargets.join(' or ')}, received ${actualTarget}`);
  if (!fs.existsSync(actualTarget) || !fs.statSync(actualTarget).isFile()) {
    throw new Error(`Mutation target does not exist as a file: ${actualTarget}`);
  }

  const sourceBuffer = fs.readFileSync(actualTarget);
  const source = sourceBuffer.toString('utf8');
  const replacements = Array.isArray(spec.replacements) ? spec.replacements : [];
  for (const entry of replacements) {
    if (!entry || typeof entry.anchor !== 'string' || !entry.anchor) {
      throw new Error(`Mutant ${mutantId} has an invalid source anchor`);
    }
    const count = source.split(entry.anchor).length - 1;
    if (count !== 1) {
      throw new Error(`Mutant ${mutantId} expected source anchor exactly once; found ${count} in ${actualTarget}`);
    }
  }

  let transformedSource = source;
  for (const entry of replacements) transformedSource = transformedSource.replace(entry.anchor, entry.replacement);
  const transformedBuffer = Buffer.from(transformedSource, 'utf8');
  const applied = !sourceBuffer.equals(transformedBuffer);
  let parses = false;
  let parseError = null;
  try {
    new vm.Script(transformedSource, { filename: actualTarget });
    parses = true;
  } catch (error) {
    parseError = error && error.message ? error.message : String(error);
  }

  return {
    target: actualTarget,
    mutantId,
    applied,
    parses,
    sourceHash: sha256(sourceBuffer),
    transformedHash: sha256(transformedBuffer),
    transformedSource,
    ...(parseError ? { parseError } : {}),
  };
}

function appendLoaderEvidence(file, evidence) {
  if (!file) throw new Error('HARNESS_MUTATION_EVIDENCE_FILE is required for loader evidence');
  fs.appendFileSync(file, `${JSON.stringify(evidence)}\n`, 'utf8');
}

function installMutationLoader(env = process.env) {
  const mutantId = env.HARNESS_MUTATION;
  const target = env.HARNESS_MUTATION_TARGET;
  if (!mutantId || !target) throw new Error('HARNESS_MUTATION and HARNESS_MUTATION_TARGET are required');

  const root = path.resolve(env.HARNESS_MUTATION_ROOT || ROOT);
  const canonicalRoot = canonicalPath(root);
  const requestedTarget = path.resolve(target);
  if (!isWithin(root, requestedTarget)) {
    throw new Error(`Mutation target is outside the selected root: ${requestedTarget}`);
  }
  const absoluteTarget = canonicalPath(requestedTarget);
  if (!isWithin(canonicalRoot, absoluteTarget)) {
    throw new Error(`Mutation target resolves outside the selected root: ${absoluteTarget}`);
  }
  const allowTestMutations = env.HARNESS_MUTATION_TEST_MODE === '1';
  const expectedSourceHash = env.HARNESS_MUTATION_EXPECT_SOURCE_HASH;
  const expectedTransformedHash = env.HARNESS_MUTATION_EXPECT_TRANSFORMED_HASH;
  const evidenceFile = env.HARNESS_MUTATION_EVIDENCE_FILE;
  const originalLoader = Module._extensions['.js'];

  Module._extensions['.js'] = function loadWithMutation(mod, filename) {
    const loadedPath = canonicalPath(filename);
    const isTarget = process.platform === 'win32'
      ? loadedPath.toLowerCase() === absoluteTarget.toLowerCase()
      : loadedPath === absoluteTarget;
    if (!isTarget) return originalLoader(mod, filename);

    const prepared = prepareMutation({
      root,
      target: absoluteTarget,
      mutantId,
      allowTestMutations,
    });
    if (!prepared.applied) throw new Error(`Mutation was not applied to ${absoluteTarget}`);
    if (!prepared.parses) throw new Error(`Mutated source does not parse: ${prepared.parseError}`);
    if (expectedSourceHash && prepared.sourceHash !== expectedSourceHash) {
      throw new Error(`Mutation source changed after preflight for ${absoluteTarget}`);
    }
    if (expectedTransformedHash && prepared.transformedHash !== expectedTransformedHash) {
      throw new Error(`Transformed source changed after preflight for ${absoluteTarget}`);
    }

    let evidenceWritten = false;
    const recordEvidence = () => {
      if (evidenceWritten) return;
      appendLoaderEvidence(evidenceFile, {
        target: absoluteTarget,
        mutantId,
        applied: prepared.applied,
        parses: prepared.parses,
        sourceHash: prepared.sourceHash,
        transformedHash: prepared.transformedHash,
      });
      evidenceWritten = true;
    };

    const originalExit = process.exit;
    process.exit = function exitAfterTargetLoad(...args) {
      recordEvidence();
      return originalExit.apply(this, args);
    };
    try {
      mod._compile(prepared.transformedSource, filename);
      recordEvidence();
    } finally {
      process.exit = originalExit;
    }
  };
}

if (process.env.HARNESS_MUTATION_LOADER_PRELOAD === '1') installMutationLoader();

// Each distribution gets its own registered tuple target (canonical file and its packaged twin).
function distributionTargets(mutantId) {
  const spec = mutationSpec(mutantId, false);
  if (!Array.isArray(spec.alternateTargets) || spec.alternateTargets.length !== 1) {
    throw new Error(`Mutant ${mutantId} does not declare exactly one packaged target`);
  }
  return { canonical: spec.target, packaged: spec.alternateTargets[0] };
}

module.exports = {
  MUTATIONS,
  TEST_MUTATIONS,
  distributionTargets,
  mutationSpec,
  prepareMutation,
  installMutationLoader,
};
