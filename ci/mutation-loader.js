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
  M01: docEvidenceMutation([replacement(
    'if (nonEmptyString(declaredBaselineDigest)) baselineDigest = declaredBaselineDigest;',
    'if (nonEmptyString(declaredBaselineDigest)) baselineDigest = baseline.digest; // mutation: re-read R1'
  )]),
  'M01-stateful': docEvidenceMutation([replacement(
    'if (nonEmptyString(declaredBaselineDigest)) baselineDigest = declaredBaselineDigest;',
    'if (nonEmptyString(declaredBaselineDigest)) baselineDigest = baseline.digest; // mutation: re-read R1'
  )]),
  M02: docEvidenceMutation([replacement(
    'if (candidateInventoryKnown === undefined) {',
    'if (true) { // mutation: repeat the R2 prototype inspection'
  )]),
  M03: docEvidenceMutation([replacement(
    'const digest = entry.digest;',
    'const digest = artifact(entry); // mutation: re-read the R3 destination digest'
  )]),
  M04: docEvidenceMutation([replacement(
    `  for (const [baselineAuditPath, baselineAuditDigest] of validatedBaselineDigests) {
    baselineAudit[baselineAuditPath] = baselineAuditDigest;
  }`,
    `  for (let baselineAuditIndex = 0; baselineAuditIndex < validatedBaselineDigests.size; baselineAuditIndex++) {
    const rawEntry = declaredBaselinePaths[baselineAuditIndex];
    baselineAudit[rawEntry.path] = baselineArtifactsMap[rawEntry.path];
  } // mutation: re-read the raw R4 audit path`
  )]),
  M05: docEvidenceMutation([replacement(
    'const trusted = entry.trustedBaselineDigest;',
    'const trusted = baselineArtifactsMap[entry.path]; // mutation: use the live R5 map'
  )]),
  M06: docEvidenceMutation([replacement(
    '} else if (sharedDestinationDigest !== destinationDigest) {',
    '} else if (false) { // mutation: accept disagreeing R3 snapshots'
  )]),
  'M06-observation': docEvidenceMutation([replacement(
    '} else if (sharedDestinationDigest !== destinationDigest) {',
    '} else if (false) { // mutation: accept disagreeing R3 snapshots'
  )]),
  'M07a': docEvidenceMutation([replacement(
    'if (failedDestinationDigests.has(entryRenameTo)) {',
    'if (false) { // mutation: reread an earlier failed destination'
  )]),
  'M07b': docEvidenceMutation([replacement(
    '    if (failedDestinationDigests.has(path)) return \'\';',
    '    // mutation: allow a cached value to outrank a poisoned destination'
  )]),
  'M07b-audit-output': docEvidenceMutation([replacement(
    '    if (failedDestinationDigests.has(path)) return \'\';',
    '    // mutation: allow a cached value to outrank a poisoned destination'
  )]),
  M08: docEvidenceMutation([replacement(
    '    && Object.prototype.hasOwnProperty.call(map, key);',
    '    && key in map; // mutation: accept inherited evidence'
  )]),
  M09: docEvidenceMutation([replacement(
    '    if (entry.candidatePathPresent !== false) return false;',
    '    if (hasOwnEntry(artifactMap, entry.path)) return false; // mutation: re-inspect the captured source absence'
  )]),
  'M09-descriptor-count': docEvidenceMutation([replacement(
    '    if (entry.candidatePathPresent !== false) return false;',
    '    if (hasOwnEntry(artifactMap, entry.path)) return false; // mutation: re-inspect the captured source absence'
  )]),
  M10: docEvidenceMutation([replacement(
    "Boolean(scopeObject && Object.prototype.hasOwnProperty.call(scopeObject, 'baselinePaths'))",
    'Boolean(scopeObject && scopeObject.baselinePaths) // mutation: treat present-undefined as absent'
  )]),
  'M10-rename-to': docEvidenceMutation([replacement(
    "if (entryReason === 'deleted' && snapshot.hasOwnRenameTo) {",
    "if (entryReason === 'deleted' && snapshot.renameTo) { // mutation: use renameTo truthiness"
  )]),
  M11: docEvidenceMutation([replacement(
    '        } catch {\n          snapshot = null;\n        }',
    '        } catch (error) {\n          throw error; // mutation: let entry metadata inspection escape\n        }'
  )]),
  'M11-entry-exception': docEvidenceMutation([replacement(
    '        } catch {\n          snapshot = null;\n        }',
    '        } catch (error) {\n          throw error; // mutation: let entry metadata inspection escape\n        }'
  )]),
  'M11-baseline-map': docEvidenceMutation([replacement(
    "          } catch {\n            // #340 P2: a throwing baseline inspection is a metadata error, never an escape.\n            baselineMetadataDiagnostic('baseline-artifact-invalid', entryPath,",
    "          } catch (error) {\n            throw error; // mutation: let baseline-map inspection escape\n            // #340 P2: a throwing baseline inspection is a metadata error, never an escape.\n            baselineMetadataDiagnostic('baseline-artifact-invalid', entryPath,"
  )]),
  'M11-candidate-descriptor': docEvidenceMutation([replacement(
    '            } catch {\n              candidateInventoryInspectionFailed = true;\n              // #342 P3: the destination is a visited snapshot even when its digest read threw;\n              // record it so the capture and audit lanes never re-read it.\n              failedDestinationDigests.set(entryRenameTo, \'\');\n              continue;\n            }',
    '            } catch (error) {\n              throw error; // mutation: let destination descriptor inspection escape\n            }'
  )]),
  'M11-destination': docEvidenceMutation([replacement(
    '            } catch {\n              candidateInventoryInspectionFailed = true;\n              // #342 P3: the destination is a visited snapshot even when its digest read threw;\n              // record it so the capture and audit lanes never re-read it.\n              failedDestinationDigests.set(entryRenameTo, \'\');\n              continue;\n            }',
    '            } catch (error) {\n              throw error; // mutation: let destination inspection escape\n            }'
  )]),
  'M11-ordinary-capture': docEvidenceMutation([replacement(
    '      } catch {\n        candidateInventoryInspectionFailed = true;\n      }\n    }\n  }',
    '      } catch (error) {\n        throw error; // mutation: let ordinary candidate capture escape\n      }\n    }\n  }'
  )]),
  M12: docEvidenceMutation([replacement(
    '    if (candidateDigestCache.has(path)) return candidateDigestCache.get(path);',
    '    if (candidateDigestCache.has(path)) return artifact(artifactMap[path]); // mutation: re-read R6'
  )]),
  M13: docEvidenceMutation([replacement(
    '      if (!item.paths.includes(entry.renameTo)) return false;',
    '      return true; // mutation: let a source-only rename record bind'
  )]),
  M14: docEvidenceMutation([replacement(
    '  return prototype === Object.prototype || prototype === null;',
    '  return true; // mutation: accept every object-like inventory'
  )]),
  'M14-diagnostic': docEvidenceMutation([replacement(
    '  return prototype === Object.prototype || prototype === null;',
    '  return true; // mutation: accept every object-like inventory'
  )]),
  M15: docEvidenceMutation([replacement(
    "          if (applicability === 'applicable') {",
    '          if (true) { // mutation: inspect destination metadata for every applicability state'
  )]),
  M16: docEvidenceMutation([replacement(
    "  return entry && typeof entry.digest === 'string' && entry.digest.length > 0 ? entry.digest : '';",
    "  const digest = entry && entry.digest;\n  return typeof digest === 'string' && digest.length > 0 ? digest : ''; // mutation: cache legacy digest reads"
  )]),
  'M16-trace': docEvidenceMutation([replacement(
    "  return entry && typeof entry.digest === 'string' && entry.digest.length > 0 ? entry.digest : '';",
    "  const digest = entry && entry.digest;\n  return typeof digest === 'string' && digest.length > 0 ? digest : ''; // mutation: cache legacy digest reads"
  )]),
  M17: docEvidenceMutation([replacement(
    "function isRecord(value) {\n  return isPlainObject(value)\n    && typeof value.id === 'string' && value.id.length > 0\n    && typeof value.obligationId === 'string' && value.obligationId.length > 0;\n}",
    "function isRecord(value) {\n  if (!isPlainObject(value)) return false;\n  const id = value.id;\n  const obligationId = value.obligationId;\n  return typeof id === 'string' && id.length > 0\n    && typeof obligationId === 'string' && obligationId.length > 0; // mutation: cache record identity reads\n}"
  )]),
  M18: docEvidenceMutation([replacement(
    'const mismatch = item.paths.find(path => candidateDigestOf(path).length > 0',
    'const mismatch = item.paths.filter(path => scopePaths.includes(path)).find(path => candidateDigestOf(path).length > 0 // mutation: ignore out-of-scope stale paths'
  )]),
  M19: docEvidenceMutation([replacement(
    ".filter(path => path.startsWith('docs/prd/'))",
    ".filter(path => path.startsWith('docs/prd/') && path !== 'docs/prd/extra.md') // mutation: omit an out-of-scope PRD"
  )]),
  'M19-eager': docEvidenceMutation([replacement(
    '    const revisionSatisfied = revisionDataKnown && citedIds.length > 0\n      && citedIds.every(id => updatedIds.includes(id));',
    '    prdSetDigest(artifactMap); // mutation: enumerate PRDs before the revision fast path\n    const revisionSatisfied = revisionDataKnown && citedIds.length > 0\n      && citedIds.every(id => updatedIds.includes(id));'
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

module.exports = {
  MUTATIONS,
  TEST_MUTATIONS,
  mutationSpec,
  prepareMutation,
  installMutationLoader,
};
