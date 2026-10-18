'use strict';

const crypto = require('crypto');

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function isRecord(value) {
  return isPlainObject(value)
    && typeof value.id === 'string' && value.id.length > 0
    && typeof value.obligationId === 'string' && value.obligationId.length > 0;
}

function nonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
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
  const artifactMap = isPlainObject(artifacts) ? artifacts : {};
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
      artifactMap, baselineDigest, executionList, reviewList, diagnostics
    }));
  }
  return { diagnostics, results };
}

function evaluateObligation(obligation, context) {
  const { artifactMap, baselineDigest, executionList, reviewList, diagnostics } = context;
  const capability = typeof obligation.capability === 'string' ? obligation.capability : '';
  const obligationId = nonEmptyString(obligation.id) ? obligation.id : capability;
  const scopePaths = scopePathsOf(obligation);
  const applicability = obligation.applicability;

  const artifactDigestKey = scopePaths.length
    ? scopePaths.map(path => `${path}=${artifact(artifactMap[path]) || 'missing'}`).join('|')
    : (baselineDigest || 'no-scope-paths');
  const baseDigestKey = baselineDigest || 'no-baseline';
  const result = (observation, outcome, provenance, recordRefs) => ({
    obligationId,
    observation,
    outcome,
    artifactDigest: artifactDigestKey,
    baseDigest: baseDigestKey,
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
  const bound = (item, path) => nonEmptyString(item.baseDigest) && item.baseDigest === baselineDigest
    && isPlainObject(item.artifactDigests) && artifact(artifactMap[path]).length > 0
    && item.artifactDigests[path] === artifactMap[path].digest
    && Array.isArray(item.paths) && item.paths.includes(path);

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
      const mismatch = item.paths.find(path => artifact(artifactMap[path]).length > 0
        && nonEmptyString(item.artifactDigests[path]) && item.artifactDigests[path] !== artifactMap[path].digest);
      if (mismatch) {
        diagnostics.push({
          code: 'stale-artifact-digest',
          obligationId,
          message: `record ${item.id} was made for a previous candidate; digest differs for path ${mismatch}`
        });
      }
    }
  }

  const usedExec = matching.filter(item => executionList.includes(item)
    && completeExecution(item)
    && scopePaths.some(path => bound(item, path)));
  const failingExec = usedExec.filter(item => item.exitCode !== 0);
  const boundReviews = matching.filter(item => reviewList.includes(item) && item.kind === 'review'
    && scopePaths.some(path => bound(item, path)));
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

  const boundAny = (path) => matching.some(item => bound(item, path));
  const unmetPaths = scopePaths.filter(path => !boundAny(path));
  for (const path of unmetPaths) {
    diagnostics.push({
      code: 'missing-path-coverage',
      obligationId,
      message: `no observed record is bound to path ${path} with the current candidate and baseline digests`
    });
  }

  const recordIndex = new Map(matching.map(item => [item.id, item]));
  const citedResolves = item => {
    const target = recordIndex.get(item);
    return Boolean(target) && target.obligationId === obligationId
      && executionList.includes(target) && completeExecution(target) && target.exitCode === 0
      && scopePaths.some(path => bound(target, path));
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

  if (usedExec.length && failingExec.length) {
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

    // F1 (§11): resolution authority. A cited REQ is resolved only when the entry is an object
    // with a non-null PRD file and no overriding resolution label ('ambiguous', 'analysis-error',
    // 'missing' are unresolved), and the id is declared by exactly one entry (duplicates are
    // ambiguous). Unresolved cited REQs never pass and are never an observed absence.
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

    const waiverSelfBound = item => scopePaths.length > 0 && scopePaths.every(path => bound(item, path));
    const citationsCoverScope = item => {
      const covered = new Set();
      for (const id of Array.isArray(item.citedRecordIds) ? item.citedRecordIds : []) {
        const target = recordIndex.get(id);
        if (target && target.obligationId === obligationId && target.exitCode === 0
          && completeExecution(target) && !failingExec.includes(target)) {
          for (const path of scopePaths) if (bound(target, path)) covered.add(path);
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
      && scopePaths.every(path => passingExec.some(item => bound(item, path)));
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
      && item.verdict === 'approve' && nonEmptyString(item.summary) && bound(item, path));
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
    && !failingExec.includes(item) && bound(item, path));
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
