'use strict';

const crypto = require('crypto');

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

// #335 P3: the candidate inventory provenance check is deliberately stricter than the shared
// `isPlainObject` helper. Baseline-only evidence requires a real plain object or a
// null-prototype dictionary; object-like values (Map, Date, RegExp, class instances) must not
// masquerade as an empty inventory. The shared normalizer and `artifactMap` fallback remain
// unchanged for non-baseline callers.
// A Proxy (or host object) whose `getPrototypeOf` trap throws cannot be proven to be a plain
// object, so it is classified as unknown inventory rather than aborting the whole check.
function isCandidateInventory(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  let prototype;
  try {
    prototype = Object.getPrototypeOf(value);
  } catch {
    return false;
  }
  return prototype === Object.prototype || prototype === null;
}

function isRecord(value) {
  return isPlainObject(value)
    && typeof value.id === 'string' && value.id.length > 0
    && typeof value.obligationId === 'string' && value.obligationId.length > 0;
}

function nonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

// #335: per-path baseline digests are SHA256 values. Trust still follows the whole-baseline
// identity, so an invalid per-path value fails the baseline path closed.
const SHA256_DIGEST = /^[a-f0-9]{64}$/i;

function isSha256(value) {
  return typeof value === 'string' && SHA256_DIGEST.test(value);
}

// #335 P2: per-path baseline and rename evidence must be carried explicitly. Inherited
// properties (including prototype-injected digests) are not declared evidence, so every
// trust-boundary map lookup uses own-key membership rather than bracket lookup alone.
function hasOwnEntry(map, key) {
  return Boolean(map) && typeof map === 'object' && typeof key === 'string'
    && Object.prototype.hasOwnProperty.call(map, key);
}

function compareText(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function uniqueSorted(values) {
  return [...new Set(values.filter(value => typeof value === 'string'))].sort(compareText);
}

function scopePathsOf(obligation) {
  if (isPlainObject(obligation.scope) && Array.isArray(obligation.scope.paths)) {
    return uniqueSorted(obligation.scope.paths);
  }
  if (typeof obligation.scope === 'string') return [obligation.scope];
  return [];
}

function artifact(entry) {
  return entry && typeof entry.digest === 'string' && entry.digest.length > 0 ? entry.digest : '';
}

// #335 P2: a baseline-bound rename destination must declare its own digest. An inherited
// `digest` (for example Object.create({ digest })) is not explicit candidate evidence.
function ownArtifactDigest(entry) {
  return isPlainObject(entry) && hasOwnEntry(entry, 'digest') ? artifact(entry) : '';
}

function provenanceText(record) {
  return nonEmptyString(record.provenance) ? record.provenance : `record ${record.id}`;
}


function provenanceJoin(records, fallback) {
  return records.length ? uniqueSorted(records.map(provenanceText)).join('; ') : fallback;
}

function reqIdsOf(value) {
  if (!Array.isArray(value)) return null;
  return uniqueSorted(value.map(item => {
    if (typeof item === 'string') return item;
    if (isPlainObject(item) && typeof item.id === 'string') return item.id;
    return null;
  }).filter(Boolean));
}

// R4 (§11): an execution record counts as evidence only with a non-empty command, a non-empty
// provenance, and an integer exitCode. Otherwise it is diagnosed (`execution-record-incomplete`)
// and never passes.
function completeExecution(item) {
  return nonEmptyString(item.command)
    && nonEmptyString(item.provenance)
    && typeof item.exitCode === 'number' && Number.isInteger(item.exitCode);
}

// R4 diagnostics name exactly which required fields the record is missing.
function incompleteFields(item) {
  const missing = [];
  if (!nonEmptyString(item.command)) missing.push('command');
  if (!nonEmptyString(item.provenance)) missing.push('provenance');
  if (typeof item.exitCode !== 'number' || !Number.isInteger(item.exitCode)) missing.push('integer exitCode');
  return missing.join(', ');
}

// F2 (§11): the candidate PRD-set identity is the digest over the sorted [path, digest] pairs
// of the artifacts under docs/prd/. The envelope must carry this exact digest to attest that
// the inventory describes the candidate being checked.
function prdSetDigest(artifactMap) {
  const pairs = Object.keys(artifactMap)
    .filter(path => path.startsWith('docs/prd/'))
    .sort()
    .map(path => [path, artifact(artifactMap[path])]);
  return crypto.createHash('sha256').update(JSON.stringify(pairs)).digest('hex');
}

function checkDocObligations({ obligations, artifacts, baseline, executionRecords, reviewRecords } = {}) {
  const diagnostics = [];
  const results = [];
  // P3: distinguish a caller-supplied plain-object or null-prototype inventory (including an
  // explicit {}) from an absent, malformed, or object-like value that the pre-existing
  // normalizer would coerce to (or treat as) an empty map. The provenance check is deferred to
  // applicable obligations that actually declare baseline paths, so non-baseline and
  // inapplicable callers never read the candidate inventory's prototype (a throwing Proxy trap
  // must not abort an unrelated obligation). It is resolved at most once so every obligation
  // sees the same classification. `artifactMap` keeps the original `isPlainObject` fallback for
  // non-baseline callers.
  const artifactMap = isPlainObject(artifacts) ? artifacts : {};
  let candidateInventoryKnown;
  const isCandidateInventoryKnown = () => {
    if (candidateInventoryKnown === undefined) {
      candidateInventoryKnown = isCandidateInventory(artifacts);
    }
    return candidateInventoryKnown;
  };
  const baselineDigest = isPlainObject(baseline) && nonEmptyString(baseline.digest) ? baseline.digest : '';
  const executionList = Array.isArray(executionRecords) ? executionRecords.filter(isRecord) : [];
  const reviewList = Array.isArray(reviewRecords) ? reviewRecords.filter(isRecord) : [];

  const obligationList = Array.isArray(obligations) ? obligations.filter(isPlainObject) : [];
  const knownIds = new Set(obligationList.map(item => nonEmptyString(item.id) ? item.id : item.capability)
    .filter(value => typeof value === 'string' && value.length > 0));

  for (const waiver of reviewList.filter(item => item.kind === 'waiver' && !knownIds.has(item.obligationId))) {
    diagnostics.push({
      code: 'waiver-unmatched',
      obligationId: waiver.obligationId,
      message: `waiver ${waiver.id} references obligation ${JSON.stringify(waiver.obligationId)} which is not in the input; it attaches to nothing and satisfies no obligation`
    });
  }

  for (const obligation of obligationList) {
    results.push(evaluateObligation(obligation, {
      artifactMap, isCandidateInventoryKnown, baseline, baselineDigest, executionList, reviewList, diagnostics
    }));
  }
  return { diagnostics, results };
}

function evaluateObligation(obligation, context) {
  const { artifactMap, isCandidateInventoryKnown, baseline, baselineDigest, executionList, reviewList, diagnostics } = context;
  const capability = typeof obligation.capability === 'string' ? obligation.capability : '';
  const obligationId = nonEmptyString(obligation.id) ? obligation.id : capability;
  const scopePaths = scopePathsOf(obligation);
  const applicability = obligation.applicability;

  // #335: baseline-only paths are declared by the obligation. Every declared entry is validated
  // before any outcome is decided; a malformed or contradictory annotation fails the whole
  // obligation closed instead of being silently ignored.
  const scopeObject = isPlainObject(obligation.scope) ? obligation.scope : null;
  const declaresBaselinePaths = Boolean(scopeObject && Object.prototype.hasOwnProperty.call(scopeObject, 'baselinePaths'));
  const declaredBaselinePaths = declaresBaselinePaths ? scopeObject.baselinePaths : undefined;
  const baselineArtifactsMap = isPlainObject(baseline) && isPlainObject(baseline.artifacts) ? baseline.artifacts : null;
  const baselineEntries = new Map();
  // #340: every accepted entry sharing a rename destination must validate the same own digest,
  // or the shared-destination snapshot is contradictory and the obligation fails closed.
  const validatedDestinationDigestMap = new Map();
  let baselineMetadataError = false;
  let candidateInventoryUnknown = false;
  // #335 P3: a candidate inventory can pass the prototype check and still throw from an
  // own-property descriptor trap or a nested digest accessor. Any such failure is treated as
  // unknown inventory rather than escaping the checker; the diagnostic is emitted only for
  // applicable obligations that declare baseline-only paths.
  let candidateInventoryInspectionFailed = false;

  const baselineMetadataDiagnostic = (code, path, message) => {
    baselineMetadataError = true;
    diagnostics.push({ code, obligationId, ...(path ? { path } : {}), message });
  };

  if (declaresBaselinePaths) {
    if (!Array.isArray(declaredBaselinePaths)) {
      baselineMetadataDiagnostic('baseline-path-invalid', undefined,
        'scope.baselinePaths is present but not an array; baseline-bound evidence cannot be evaluated');
    } else if (declaredBaselinePaths.length) {
      if (!nonEmptyString(baselineDigest)) {
        baselineMetadataDiagnostic('baseline-identity-missing', undefined,
          'baselinePaths are declared but the baseline carries no whole-baseline digest; baseline-bound evidence cannot be trusted');
      }
      if (!baselineArtifactsMap) {
        baselineMetadataDiagnostic('baseline-artifacts-missing', undefined,
          'baselinePaths are declared but the baseline carries no artifacts map; per-path baseline digests are unavailable');
      }
      const seen = new Set();
      for (const rawEntry of declaredBaselinePaths) {
        const invalid = (path, reason) => baselineMetadataDiagnostic('baseline-path-invalid', path,
          `baselinePaths entry ${path ? JSON.stringify(path) : '(malformed)'} is invalid: ${reason}; the path fails closed`);
        if (!isPlainObject(rawEntry) || !nonEmptyString(rawEntry.path)) {
          invalid(undefined, 'it is not an object with a non-empty path');
          continue;
        }
        const entryPath = rawEntry.path;
        if (seen.has(entryPath)) {
          invalid(entryPath, 'the same path is declared more than once');
          continue;
        }
        seen.add(entryPath);
        if (!scopePaths.includes(entryPath)) {
          invalid(entryPath, 'it is not a member of scope.paths');
          continue;
        }
        if (rawEntry.reason !== 'deleted' && rawEntry.reason !== 'rename-from') {
          invalid(entryPath, `reason ${JSON.stringify(rawEntry.reason)} is not deleted or rename-from`);
          continue;
        }
        if (rawEntry.reason === 'deleted' && Object.prototype.hasOwnProperty.call(rawEntry, 'renameTo')) {
          invalid(entryPath, 'a deleted entry must not carry renameTo');
          continue;
        }
        // #340: the validated rename destination digest is carried on the entry; the
        // destination candidate map is not read again after metadata validation.
        let renameDestinationDigest = '';
        if (rawEntry.reason === 'rename-from') {
          if (!nonEmptyString(rawEntry.renameTo) || rawEntry.renameTo === entryPath) {
            invalid(entryPath, 'a rename-from entry needs a distinct non-empty renameTo');
            continue;
          }
          if (!scopePaths.includes(rawEntry.renameTo)) {
            invalid(entryPath, `its rename destination ${JSON.stringify(rawEntry.renameTo)} is not a member of scope.paths`);
            continue;
          }
          let destinationDigest = '';
          try {
            if (hasOwnEntry(artifactMap, rawEntry.renameTo)) {
              destinationDigest = ownArtifactDigest(artifactMap[rawEntry.renameTo]);
            }
          } catch {
            candidateInventoryInspectionFailed = true;
            continue;
          }
          // #340: the captured own value must be a usable non-empty string; `artifact()` can read
          // a stateful accessor three times, so a non-string result is not carried or seeded.
          if (!nonEmptyString(destinationDigest)) {
            invalid(entryPath, `its rename destination ${JSON.stringify(rawEntry.renameTo)} has no candidate artifact`);
            continue;
          }
          // #340: entries that share one rename destination must agree on the validated own
          // digest. A conflicting validated value is a contradictory snapshot and fails the
          // whole obligation closed before any binding; equal values are allowed.
          const sharedDestinationDigest = validatedDestinationDigestMap.get(rawEntry.renameTo);
          if (sharedDestinationDigest === undefined) {
            validatedDestinationDigestMap.set(rawEntry.renameTo, destinationDigest);
          } else if (sharedDestinationDigest !== destinationDigest) {
            invalid(entryPath, `its rename destination ${JSON.stringify(rawEntry.renameTo)} was validated to conflicting own digests by another accepted baseline entry; the shared destination snapshot is not consistent`);
            continue;
          }
          renameDestinationDigest = destinationDigest;
        }
        let candidatePathPresent = false;
        try {
          candidatePathPresent = hasOwnEntry(artifactMap, entryPath);
        } catch {
          candidateInventoryInspectionFailed = true;
          continue;
        }
        if (candidatePathPresent) {
          baselineMetadataDiagnostic('baseline-path-candidate-present', entryPath,
            `baseline path ${entryPath} is declared baseline-only but the candidate artifact map has an entry for it (own key, regardless of digest validity); the contradictory path state fails closed`);
          continue;
        }
        if (baselineArtifactsMap) {
          const trusted = hasOwnEntry(baselineArtifactsMap, entryPath) ? baselineArtifactsMap[entryPath] : undefined;
          if (trusted === undefined) {
            baselineMetadataDiagnostic('baseline-artifact-missing', entryPath,
              `the baseline carries no per-path digest for declared baseline path ${entryPath}; the path fails closed`);
            continue;
          }
          if (!isSha256(trusted)) {
            baselineMetadataDiagnostic('baseline-artifact-invalid', entryPath,
              `the baseline digest for ${entryPath} is not a SHA256 value; the path fails closed`);
            continue;
          }
        }
        baselineEntries.set(entryPath, {
          path: entryPath,
          reason: rawEntry.reason,
          // #340: the metadata check above confirmed this path has no own-key candidate entry;
          // carry that validated source-absence proof explicitly (never spread from rawEntry) so
          // binding and the audit identity reuse it instead of re-inspecting the candidate map.
          candidatePathPresent: false,
          ...(rawEntry.reason === 'rename-from' ? { renameTo: rawEntry.renameTo, renameDestinationDigest } : {})
        });
      }
    }
  }

  // #335 P3: a mixed scope combines baseline-only paths with ordinary candidate paths. Capture
  // every ordinary scoped candidate digest before evidence binding, so a throwing accessor in
  // the legacy candidate lane fails the inventory closed instead of aborting the obligation.
  const candidateDigestCache = new Map();
  if (applicability === 'applicable' && Array.isArray(declaredBaselinePaths)
    && declaredBaselinePaths.length > 0) {
    // #340: a rename destination was already validated as an own-key candidate entry carrying
    // its own digest during metadata. Seed the captured snapshot from that validated value and
    // never read the destination through the raw candidate map again, so a destination accessor
    // that throws or changes after validation cannot make capture/binding/audit disagree. The
    // seeded value is the validated own digest, never a caller-asserted rawEntry field.
    for (const entry of baselineEntries.values()) {
      if (entry.reason === 'rename-from' && nonEmptyString(entry.renameDestinationDigest)
        && !candidateDigestCache.has(entry.renameTo)) {
        candidateDigestCache.set(entry.renameTo, entry.renameDestinationDigest);
      }
    }
    for (const path of scopePaths) {
      if (baselineEntries.has(path) || candidateDigestCache.has(path)) continue;
      try {
        candidateDigestCache.set(path, artifact(artifactMap[path]));
      } catch {
        candidateInventoryInspectionFailed = true;
      }
    }
  }

  // P3: an applicable obligation that actually declares baseline-only paths needs a known
  // candidate inventory. Explicit {} is known and remains the legitimate empty deletion
  // inventory; omitted/undefined/null/array/string/other malformed values are unknown input.
  // The prototype read happens here, not up front, so unrelated obligations never touch it.
  if (applicability === 'applicable' && Array.isArray(declaredBaselinePaths)
    && declaredBaselinePaths.length > 0
    && (candidateInventoryInspectionFailed || !isCandidateInventoryKnown())) {
    candidateInventoryUnknown = true;
    diagnostics.push({
      code: 'candidate-artifacts-invalid',
      obligationId,
      message: 'this obligation declares baseline-only paths, but the top-level artifacts argument is not a plain object or cannot be inspected safely; the candidate inventory is unknown, so baseline-bound evidence fails closed'
    });
  }

  const baselineAudit = {};
  if (Array.isArray(declaredBaselinePaths)) {
    for (const rawEntry of declaredBaselinePaths) {
      if (isPlainObject(rawEntry) && nonEmptyString(rawEntry.path)
        && hasOwnEntry(baselineArtifactsMap, rawEntry.path)
        && isSha256(baselineArtifactsMap[rawEntry.path])) {
        baselineAudit[rawEntry.path] = baselineArtifactsMap[rawEntry.path];
      }
    }
  }

  // An uninspectable candidate entry must not abort an N/A or unknown obligation while the
  // audit key is built; the baseline-bound lanes fail closed through the inventory diagnostic.
  // When a baseline-annotated obligation captured the ordinary candidate digests before binding
  // (candidateDigestCache), the audit identity and stale diagnostics use that same snapshot, so a
  // nested digest accessor that only later throws or changes can never make the audit key or the
  // stale verdict disagree with the digest that actually bound evidence. Untouched paths and
  // unannotated callers keep the legacy read.
  const candidateDigestOf = (path) => {
    if (candidateDigestCache.has(path)) return candidateDigestCache.get(path);
    // #340: only an applicable baseline-annotated obligation validated the source absence as
    // part of its captured snapshot. `N/A` and `unknown` obligations never bind evidence, so they
    // keep the legacy candidate read for their audit identity and stay `outcome: 'none'`.
    if (applicability === 'applicable' && baselineEntries.has(path)) return '';
    try {
      return artifact(artifactMap[path]);
    } catch {
      return '';
    }
  };
  const artifactDigestKey = scopePaths.length
    ? scopePaths.map(path => `${path}=${candidateDigestOf(path) || 'missing'}`).join('|')
    : (baselineDigest || 'no-scope-paths');
  const baseDigestKey = baselineDigest || 'no-baseline';
  const result = (observation, outcome, provenance, recordRefs) => ({
    obligationId,
    observation,
    outcome,
    artifactDigest: artifactDigestKey,
    baseDigest: baseDigestKey,
    ...(declaresBaselinePaths ? { baselineArtifacts: { ...baselineAudit } } : {}),
    provenance,
    recordRefs: [...recordRefs]
  });

  if (applicability === 'N/A') {
    return result('not-observed', 'none', 'obligation is not applicable to this change set', []);
  }
  if (applicability === 'unknown') {
    return result('not-observed', 'none',
      'applicability unknown; fail-closed, pilot 3a defines no completion policy for this state', []);
  }

  const matching = [...executionList, ...reviewList].filter(item => item.obligationId === obligationId);
  const candidateBound = (item, path) => {
    if (!nonEmptyString(item.baseDigest) || item.baseDigest !== baselineDigest) return false;
    if (!isPlainObject(item.artifactDigests)) return false;
    if (candidateDigestCache.has(path)) {
      // Baseline-annotated obligations use the digest captured before binding, so a mixed
      // delete+edit scope never re-reads a throwing accessor from the legacy lane.
      const digest = candidateDigestCache.get(path);
      return digest.length > 0
        && item.artifactDigests[path] === digest
        && Array.isArray(item.paths) && item.paths.includes(path);
    }
    return artifact(artifactMap[path]).length > 0
      && item.artifactDigests[path] === artifactMap[path].digest
      && Array.isArray(item.paths) && item.paths.includes(path);
  };

  // A baseline-only path is satisfied only by a record bound to the trusted baseline digest.
  // A rename-from path additionally needs the same single record to carry the current
  // destination candidate digest, so destination-only, source-only and split records fail.
  const baselineBound = (item, entry) => {
    if (!nonEmptyString(item.baseDigest) || item.baseDigest !== baselineDigest) return false;
    if (!Array.isArray(item.paths) || !item.paths.includes(entry.path)) return false;
    // #340: metadata validation confirmed this baseline-only path has no own-key candidate
    // entry. Reuse that carried absence proof instead of re-inspecting the candidate map, so a
    // descriptor trap that only throws on a later inspection cannot abort the check. A path
    // whose metadata was malformed never reaches here; it fails closed earlier.
    if (entry.candidatePathPresent !== false) return false;
    if (isPlainObject(item.artifactDigests)
      && Object.prototype.hasOwnProperty.call(item.artifactDigests, entry.path)) return false;
    const trusted = hasOwnEntry(baselineArtifactsMap, entry.path) ? baselineArtifactsMap[entry.path] : undefined;
    if (!isSha256(trusted)) return false;
    if (!isPlainObject(item.baselineArtifacts)
      || !hasOwnEntry(item.baselineArtifacts, entry.path)
      || item.baselineArtifacts[entry.path] !== trusted) return false;
    if (entry.reason === 'rename-from') {
      if (!item.paths.includes(entry.renameTo)) return false;
      if (!isPlainObject(item.artifactDigests)
        || !hasOwnEntry(item.artifactDigests, entry.renameTo)
        || !nonEmptyString(item.artifactDigests[entry.renameTo])) return false;
      // #340 P3: the destination binds to the same captured candidate digest that the ordinary
      // candidate lane, the audit identity, and the stale diagnostics use, so a stateful nested
      // accessor cannot make binding disagree with them. Metadata validation already required the
      // destination to be an own-key candidate inventory entry carrying its own digest
      // (ownArtifactDigest), so a non-empty captured digest is required here and the accessor is
      // never re-read; a missing destination skips capture and lands on this guard.
      const capturedDestination = candidateDigestCache.get(entry.renameTo);
      if (!nonEmptyString(capturedDestination)) return false;
      if (item.artifactDigests[entry.renameTo] !== capturedDestination) return false;
    }
    return true;
  };

  const boundToScopePath = (item, path) => {
    const entry = baselineEntries.get(path);
    return entry ? baselineBound(item, entry) : candidateBound(item, path);
  };

  for (const item of matching) {
    if (executionList.includes(item) && !completeExecution(item)) {
      diagnostics.push({
        code: 'execution-record-incomplete',
        obligationId,
        message: `execution record ${item.id} is incomplete (missing: ${incompleteFields(item)}); a minimal record needs a non-empty command, a non-empty provenance, and an integer exitCode, and it therefore counts as no evidence`
      });
    }
  }

  for (const item of matching) {
    if (nonEmptyString(item.baseDigest) && item.baseDigest !== baselineDigest) {
      diagnostics.push({
        code: 'stale-base-digest',
        obligationId,
        message: `record ${item.id} was made against a different baseline and cannot match`
      });
      continue;
    }
    if (Array.isArray(item.paths) && isPlainObject(item.artifactDigests)) {
      const mismatch = item.paths.find(path => candidateDigestOf(path).length > 0
        && nonEmptyString(item.artifactDigests[path]) && item.artifactDigests[path] !== candidateDigestOf(path));
      if (mismatch) {
        diagnostics.push({
          code: 'stale-artifact-digest',
          obligationId,
          message: `record ${item.id} was made for a previous candidate; digest differs for path ${mismatch}`
        });
      }
    }
  }

  // #335: a record that names a baseline-only path but carries no per-path baseline digest is
  // visible as an attempt, and a record whose per-path digest disagrees with the trusted value
  // is stale. Both fail closed through missing-path-coverage and stale-baseline-artifact-digest.
  for (const item of matching) {
    const baselineNamed = Array.isArray(item.paths) ? item.paths.filter(path => baselineEntries.has(path)) : [];
    if (isPlainObject(item.baselineArtifacts)) {
      for (const [path, value] of Object.entries(item.baselineArtifacts)) {
        if (!baselineEntries.has(path)) continue;
        const trusted = hasOwnEntry(baselineArtifactsMap, path) ? baselineArtifactsMap[path] : undefined;
        if (!isSha256(trusted)) continue;
        if (nonEmptyString(value) && value !== trusted) {
          diagnostics.push({
            code: 'stale-baseline-artifact-digest',
            obligationId,
            message: `record ${item.id} carries a baseline digest for path ${path} that differs from the trusted baseline value`
          });
        }
      }
    }
    for (const path of baselineNamed) {
      const bound = isPlainObject(item.baselineArtifacts)
        && hasOwnEntry(item.baselineArtifacts, path)
        && nonEmptyString(item.baselineArtifacts[path]);
      if (!bound) {
        diagnostics.push({
          code: 'baseline-binding-missing',
          obligationId,
          message: `record ${item.id} names baseline path ${path} but carries no trusted baseline digest for it`
        });
      }
      if (isPlainObject(item.artifactDigests)
        && Object.prototype.hasOwnProperty.call(item.artifactDigests, path)) {
        diagnostics.push({
          code: 'baseline-path-candidate-digest',
          obligationId,
          message: `record ${item.id} carries a candidate artifactDigests entry for baseline-only path ${path}; the contradictory record cannot bind that path`
        });
      }
    }
  }

  if (baselineMetadataError || candidateInventoryUnknown) {
    return result('unresolved', 'none',
      candidateInventoryUnknown && !baselineMetadataError
        ? 'the top-level candidate artifacts inventory is absent or malformed; baseline-bound evidence fails closed'
        : 'baseline path metadata is missing, invalid, or contradictory; baseline-bound evidence fails closed',
      []);
  }

  const usedExec = matching.filter(item => executionList.includes(item)
    && completeExecution(item)
    && scopePaths.some(path => boundToScopePath(item, path)));
  const failingExec = usedExec.filter(item => item.exitCode !== 0);
  const boundReviews = matching.filter(item => reviewList.includes(item) && item.kind === 'review'
    && scopePaths.some(path => boundToScopePath(item, path)));
  const validReviews = boundReviews.filter(item => item.verdict === 'approve' && nonEmptyString(item.summary));
  const invalidReviews = boundReviews.filter(item => !validReviews.includes(item));
  const oddKindRecords = matching.filter(item => reviewList.includes(item)
    && item.kind !== 'review' && item.kind !== 'waiver');

  for (const item of invalidReviews) {
    diagnostics.push({
      code: item.verdict === 'approve' ? 'review-summary-missing' : 'review-not-approved',
      obligationId,
      message: `review record ${item.id} does not carry an approve verdict with a non-empty summary`
    });
  }
  for (const item of oddKindRecords) {
    diagnostics.push({
      code: 'unsupported-review-kind',
      obligationId,
      message: `record ${item.id} has kind ${JSON.stringify(item.kind)} and cannot act as review evidence`
    });
  }

  const boundAny = (path) => matching.some(item => boundToScopePath(item, path));
  const unmetPaths = scopePaths.filter(path => !boundAny(path));
  for (const path of unmetPaths) {
    const entry = baselineEntries.get(path);
    diagnostics.push({
      code: 'missing-path-coverage',
      obligationId,
      message: entry
        ? `no observed record is bound to baseline path ${path} (${entry.reason}${entry.renameTo ? ` -> ${entry.renameTo}` : ''}) with the trusted baseline digest`
        : `no observed record is bound to path ${path} with the current candidate and baseline digests`
    });
  }

  const recordIndex = new Map(matching.map(item => [item.id, item]));
  const citedResolves = item => {
    const target = recordIndex.get(item);
    return Boolean(target) && target.obligationId === obligationId
      && executionList.includes(target) && completeExecution(target) && target.exitCode === 0
      && scopePaths.some(path => boundToScopePath(target, path));
  };
  const waiverCandidates = reviewList.filter(item => item.kind === 'waiver'
    && item.obligationId === obligationId);
  const waiverQualifies = item => nonEmptyString(item.reason)
    && Array.isArray(item.citedRecordIds) && item.citedRecordIds.length > 0
    && item.citedRecordIds.every(citedResolves);
  const validWaivers = waiverCandidates.filter(waiverQualifies);
  const brokenWaivers = waiverCandidates.filter(item => !waiverQualifies(item));
  for (const item of brokenWaivers) {
    const message = !nonEmptyString(item.reason)
      ? `waiver ${item.id} has no non-empty reason`
      : !Array.isArray(item.citedRecordIds) || item.citedRecordIds.length === 0
        ? `waiver ${item.id} cites no observed record`
        : `waiver ${item.id} cites records that do not resolve to observed evidence for this obligation`;
    diagnostics.push({ code: 'unsupported-waiver', obligationId, message });
  }

  const observation = () => {
    if (brokenWaivers.length) return 'unresolved';
    if (!matching.length) return 'not-observed';
    return scopePaths.some(boundAny) ? 'unresolved' : 'unavailable';
  };

  // F1 (round 10): for requirement-sync, an explicitly unknown requirement scope is completed
  // by nothing and attributes nothing — the check runs before ANY outcome branch, including
  // the shared bound-failing-execution lane: outcome is none whether the bound records pass,
  // fail, or contradict each other. Other capabilities keep observed fail on a bound failing
  // execution.
  const requirementScopeUnknown = capability === 'requirement-sync'
    && (obligation.requirementScopeUnknown === true
      || (isPlainObject(obligation.scope) && obligation.scope.requirementIds === 'unknown'));
  if (requirementScopeUnknown) {
    return result('not-observed', 'none',
      'requirement scope unknown; evidence for a known subset neither passes nor attributes absence', []);
  }

  // F1 (§11): resolution authority, hoisted ahead of the shared failing-execution lane (PR #334
  // round 2, finding 4307059310). A cited REQ is resolved only when the entry is an object with a
  // non-null PRD file and no overriding resolution label ('ambiguous', 'analysis-error', 'missing'
  // are unresolved), and the id is declared by exactly one entry (duplicates are ambiguous).
  // Unresolved cited REQs never pass and are never an observed absence or an observed fail.
  const citedEntries = Array.isArray(obligation.citedReqs) ? obligation.citedReqs : [];
  const idCounts = new Map();
  for (const item of citedEntries) {
    if (isPlainObject(item) && nonEmptyString(item.id)) {
      idCounts.set(item.id, (idCounts.get(item.id) || 0) + 1);
    }
  }
  const entryResolved = item => isPlainObject(item)
    && nonEmptyString(item.id) && nonEmptyString(item.file)
    && (item.resolution === undefined || item.resolution === 'resolved')
    && idCounts.get(item.id) === 1;
  const unresolvedReqs = citedEntries.filter(item => !entryResolved(item));
  // An absent, null, or empty cited identity is unknown rather than resolved, so it never reaches
  // the observed-fail lane for requirement-sync; other capabilities are unaffected.
  const identityKnown = citedEntries.length > 0 && unresolvedReqs.length === 0;

  if (usedExec.length && failingExec.length && (capability !== 'requirement-sync' || identityKnown)) {
    return result('observed', 'fail', provenanceJoin(failingExec, 'observed failing evidence'),
      uniqueSorted([...failingExec.map(item => item.id)]));
  }

  if (capability === 'requirement-sync') {
    const citedIds = reqIdsOf(obligation.citedReqs);
    const updatedIds = reqIdsOf(obligation.reqUpdates);
    const revisionDataKnown = Array.isArray(citedIds) && Array.isArray(updatedIds);
    const revisionSatisfied = revisionDataKnown && citedIds.length > 0
      && citedIds.every(id => updatedIds.includes(id));
    if (!revisionDataKnown) {
      diagnostics.push({
        code: 'req-sync-unverified',
        obligationId,
        message: 'the obligation carries no citedReqs/reqUpdates status; the REQ revision lane is unavailable (fail-closed)'
      });
    } else if (!revisionSatisfied) {
      diagnostics.push({
        code: 'req-sync-unverified',
        obligationId,
        message: `cited REQ ids ${citedIds.join(', ') || '(none)'} are not all updated in this change; the REQ revision lane is unavailable`
      });
    }

    if (unresolvedReqs.length) {
      for (const item of unresolvedReqs) {
        const id = isPlainObject(item) ? item.id : item;
        const reason = isPlainObject(item) && idCounts.get(item.id) > 1
          ? 'the id is declared by more than one current PRD'
          : isPlainObject(item) && typeof item.resolution === 'string' && item.resolution !== 'resolved'
            ? `resolution is ${JSON.stringify(item.resolution)}`
            : 'it has no non-null PRD file';
        diagnostics.push({
          code: 'req-unresolved',
          obligationId,
          message: `cited requirement ${JSON.stringify(id)} is unresolved: ${reason}; no waiver alternative and no absence fail can rest on it`
        });
      }
      return result('unresolved', 'none',
        'requirement-sync cites an unresolved REQ (ambiguous, analysis error, or missing declaration); a no-REQ-change waiver cannot satisfy it',
        []);
    }

    const waiverSelfBound = item => scopePaths.length > 0 && scopePaths.every(path => boundToScopePath(item, path));
    const citationsCoverScope = item => {
      const covered = new Set();
      for (const id of Array.isArray(item.citedRecordIds) ? item.citedRecordIds : []) {
        const target = recordIndex.get(id);
        if (target && target.obligationId === obligationId && target.exitCode === 0
          && completeExecution(target) && !failingExec.includes(target)) {
          for (const path of scopePaths) if (boundToScopePath(target, path)) covered.add(path);
        }
      }
      return covered.size === scopePaths.length;
    };
    const syncWaivers = waiverCandidates.filter(item => waiverQualifies(item)
      && Array.isArray(item.requirementIds) && item.requirementIds.length > 0
      && citationsCoverScope(item) && waiverSelfBound(item));
    for (const item of waiverCandidates.filter(entry => waiverQualifies(entry) && !syncWaivers.includes(entry))) {
      const listsRequirements = Array.isArray(item.requirementIds) && item.requirementIds.length > 0;
      diagnostics.push({
        code: 'unsupported-waiver',
        obligationId,
        message: !listsRequirements
          ? `waiver ${item.id} carries no requirementIds and covers no requirement; a no-REQ-change waiver must list the REQ ids it covers`
          : waiverSelfBound(item)
            ? `waiver ${item.id}'s cited evidence does not bind every scope path`
            : `waiver ${item.id} is not bound itself to the current candidate digests and baseline (self-binding fails)`
      });
    }

    // T3 (§11): a no-REQ-change waiver must carry requirementIds (a non-empty list) and covers
    // only those REQs. A waiver without requirementIds covers nothing. Every cited REQ that is
    // not revised must be covered by a valid current-bound waiver that lists it; path, digest,
    // and execution checks stay unchanged (waiverQualifies/citationsCoverScope/waiverSelfBound).
    const missingIds = (Array.isArray(citedIds) && Array.isArray(updatedIds))
      ? citedIds.filter(id => !updatedIds.includes(id))
      : [];
    const waiverCoversId = (item, id) => Array.isArray(item.requirementIds)
      && item.requirementIds.length > 0 && item.requirementIds.includes(id);
    const uncoveredMissing = missingIds.filter(id => !syncWaivers.some(item => waiverCoversId(item, id)));

    const passingExec = usedExec.filter(item => item.exitCode === 0);
    const execCoveredAll = scopePaths.length > 0
      && scopePaths.every(path => passingExec.some(item => boundToScopePath(item, path)));
    // S3 (§11): identity data gates every per-REQ coverage claim. A waiver lane pass requires a
    // known non-empty cited identity list, known update data, and coverage of every uncovered
    // missing REQ by a listing valid waiver. Absent or empty cited data, or an absent
    // reqUpdates field, leaves the obligation unknown: no pass and no absence fail.
    const waiverPass = syncWaivers.length > 0
      && Array.isArray(citedIds) && citedIds.length > 0
      && Array.isArray(updatedIds)
      && uncoveredMissing.length === 0;
    if (usedExec.length && execCoveredAll && (revisionSatisfied || waiverPass)) {
      const contributors = [...usedExec, ...syncWaivers];
      return result('observed', 'pass', provenanceJoin(contributors, 'observed requirement-sync evidence'),
        uniqueSorted(contributors.map(item => item.id)));
    }

    // F2 (§11): the absence-fail lane requires an attested envelope on the obligation.
    // Envelope: obligation.inventory = { complete, waiverInventoryComplete, baseDigest,
    // candidateDigest, configDigest }; baseDigest must equal the selected baseline digest and
    // candidateDigest must equal the current candidate PRD-set digest. Any missing or
    // mismatched field yields none with req-sync-envelope-unattested, never a fail. An empty
    // cited list is never an observed absence (every() on [] is vacuous).
    const envelope = isPlainObject(obligation.inventory) ? obligation.inventory : null;
    const envelopeAttested = Boolean(envelope)
      && envelope.complete === true
      && envelope.waiverInventoryComplete === true
      && nonEmptyString(envelope.baseDigest) && envelope.baseDigest === baselineDigest
      && nonEmptyString(envelope.candidateDigest) && envelope.candidateDigest === prdSetDigest(artifactMap)
      && nonEmptyString(envelope.configDigest);
    // Q2 (§11): the absence fail is per cited REQ. A REQ that is neither revised in this
    // change nor covered by a valid waiver that lists it (T3 per-REQ coverage; a waiver
    // without requirementIds covers nothing) is missing, so uncovering any missing REQ keeps
    // the fail lane open.
    // P2 (round 9): an explicit trigger is authoritative. When the obligation carries the field
    // at all, only 'new-test' and 'assertion-change' open the fail lane; null, 'unknown', or any
    // other value never fails, even with assertionChanged true. An ABSENT field (distinguished
    // with a property check) keeps the legacy behavior: assertionChanged true may fail.
    const triggerPresent = Object.prototype.hasOwnProperty.call(obligation, 'requirementSyncTrigger');
    const activeTrigger = obligation.requirementSyncTrigger === 'new-test'
      || obligation.requirementSyncTrigger === 'assertion-change';
    const failTrigger = triggerPresent
      ? activeTrigger
      : (obligation.assertionChanged === true || activeTrigger);
    const failCandidate = revisionDataKnown && citedIds.length > 0
      && failTrigger
      && obligation.inventoryComplete === true
      && citedEntries.every(entryResolved)
      && missingIds.length > 0;
    if (failCandidate && !envelopeAttested) {
      diagnostics.push({
        code: 'req-sync-envelope-unattested',
        obligationId,
        message: 'the absence-fail lane is unavailable: the obligation carries no attested inventory envelope (complete, waiverInventoryComplete, baseDigest equal to the selected baseline, candidateDigest equal to the current candidate PRD-set digest, and a present configDigest)'
      });
    } else if (failCandidate && envelopeAttested && uncoveredMissing.length > 0) {
      diagnostics.push({
        code: 'req-sync-no-revision-or-waiver',
        obligationId,
        message: `requirement-sync is unmet: the trigger is ${obligation.requirementSyncTrigger === 'new-test' ? 'a new REQ-citing test' : 'a changed assertion'} and the inventory is complete, and cited requirement${uncoveredMissing.length === 1 ? '' : 's'} ${uncoveredMissing.map(id => {
          const entry = citedEntries.find(item => isPlainObject(item) && item.id === id);
          return `${JSON.stringify(id)} (${entry.file})`;
        }).join(', ')} are not revised in this change and not covered by a valid waiver listing them`
      });
      return result('observed', 'fail',
        'requirement-sync unmet: attested inventory, requirement-sync trigger fired, cited REQ(s) not revised and not covered',
        []);
    }

    const contributors = [...usedExec, ...validReviews, ...syncWaivers];
    return result(observation(), 'none',
      provenanceJoin(contributors,
        'requirement-sync demands a revised cited REQ with matching evidence or a current-bound supported waiver; a passing command alone is insufficient'),
      uniqueSorted(contributors.map(item => item.id)));
  }

  const reviewsRequired = capability === 'quality-review';
  if (reviewsRequired) {
    const reviewCovers = (path) => matching.some(item => reviewList.includes(item) && item.kind === 'review'
      && item.verdict === 'approve' && nonEmptyString(item.summary) && boundToScopePath(item, path));
    if (!invalidReviews.length && !oddKindRecords.length
      && validReviews.length && scopePaths.every(reviewCovers)) {
      const contributors = [...validReviews, ...usedExec.filter(item => !failingExec.includes(item))];
      return result('observed', 'pass', provenanceJoin(contributors, 'observed review evidence'),
        uniqueSorted(contributors.map(item => item.id)));
    }
    const contributors = [...validReviews, ...usedExec];
    return result(observation(), 'none',
      provenanceJoin(contributors, 'review obligation is unresolved without an approving, path-bound review record'),
      uniqueSorted(contributors.map(item => item.id)));
  }

  const execCovers = (path) => matching.some(item => executionList.includes(item)
    && completeExecution(item)
    && !failingExec.includes(item) && boundToScopePath(item, path));
  const execCovered = scopePaths.every(execCovers);
  if (usedExec.length && execCovered) {
    const contributors = [...usedExec.filter(item => !failingExec.includes(item)), ...validWaivers];
    return result('observed', 'pass', provenanceJoin(contributors, 'observed passing evidence'),
      uniqueSorted(contributors.map(item => item.id)));
  }

  const contributors = [...usedExec, ...validReviews, ...validWaivers];
  return result(observation(), 'none',
    provenanceJoin(contributors, 'no qualifying observed evidence; fail-closed outcome'),
    uniqueSorted(contributors.map(item => item.id)));
}

module.exports = { checkDocObligations };
