'use strict';

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
      && executionList.includes(target) && target.exitCode === 0
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

    const waiverSelfBound = item => scopePaths.length > 0 && scopePaths.every(path => bound(item, path));
    const citationsCoverScope = item => {
      const covered = new Set();
      for (const id of Array.isArray(item.citedRecordIds) ? item.citedRecordIds : []) {
        const target = recordIndex.get(id);
        if (target && target.obligationId === obligationId && target.exitCode === 0
          && !failingExec.includes(target)) {
          for (const path of scopePaths) if (bound(target, path)) covered.add(path);
        }
      }
      return covered.size === scopePaths.length;
    };
    const syncWaivers = waiverCandidates.filter(item => waiverQualifies(item)
      && citationsCoverScope(item) && waiverSelfBound(item));
    for (const item of waiverCandidates.filter(entry => waiverQualifies(entry) && !syncWaivers.includes(entry))) {
      diagnostics.push({
        code: 'unsupported-waiver',
        obligationId,
        message: waiverSelfBound(item)
          ? `waiver ${item.id}'s cited evidence does not bind every scope path`
          : `waiver ${item.id} is not bound itself to the current candidate digests and baseline (self-binding fails)`
      });
    }

    const passingExec = usedExec.filter(item => item.exitCode === 0);
    const execCoveredAll = scopePaths.length > 0
      && scopePaths.every(path => passingExec.some(item => bound(item, path)));
    if (usedExec.length && execCoveredAll && (revisionSatisfied || syncWaivers.length)) {
      const contributors = [...usedExec, ...syncWaivers];
      return result('observed', 'pass', provenanceJoin(contributors, 'observed requirement-sync evidence'),
        uniqueSorted(contributors.map(item => item.id)));
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
