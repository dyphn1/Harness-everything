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

function nonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

// #335 P2: per-path baseline and rename evidence must be carried explicitly. Inherited
// properties (including prototype-injected digests) are not declared evidence, so every
// trust-boundary map lookup uses own-key membership rather than bracket lookup alone.
function hasOwnEntry(map, key) {
  return Boolean(map) && typeof map === 'object' && typeof key === 'string'
    && Object.prototype.hasOwnProperty.call(map, key);
}

function artifact(entry) {
  return entry && typeof entry.digest === 'string' && entry.digest.length > 0 ? entry.digest : '';
}

// #335 P2: a baseline-bound rename destination must declare its own digest. An inherited
// `digest` (for example Object.create({ digest })) is not explicit candidate evidence.
// P2(r4321077631): reads the own digest exactly once. `artifact()` inspects `entry.digest` up
// to three times (typeof, length, value), so a stateful accessor could validate one value and
// have the captured destination snapshot carry another. Only the applicable rename-destination
// snapshot uses this helper; non-baseline and inapplicable lanes keep the legacy `artifact()`
// reads for their audit identity. A throwing digest getter propagates to the caller's guarded
// block and fails the inspection closed there. This is the single authoritative own-digest
// helper; nothing else in this module reads a destination's own digest.
function ownDigestOnce(entry) {
  if (!isPlainObject(entry)) return '';
  if (!hasOwnEntry(entry, 'digest')) return '';
  const digest = entry.digest;
  return typeof digest === 'string' && digest.length > 0 ? digest : '';
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

function createInvocationCapture({ artifacts, baseline }) {
  let artifactMap;
  let baselineIdentityCaptured = false;
  let baselineDigest = '';
  let candidateInventoryInitialized = false;
  let candidateInventory = false;

  return Object.freeze({
    // This is the original E:147 plain-object fallback. The caller retains no raw map reference;
    // all legacy candidate operations below stay inside this closure.
    initializeArtifactFallback() {
      artifactMap = isPlainObject(artifacts) ? artifacts : {};
    },

    // R1: preserve the original E:155–168 guarded baseline.digest read and cache its scalar.
    captureBaselineIdentity() {
      if (!baselineIdentityCaptured) {
        baselineIdentityCaptured = true;
        if (isPlainObject(baseline)) {
          try {
            const declaredBaselineDigest = baseline.digest;
            if (nonEmptyString(declaredBaselineDigest)) baselineDigest = declaredBaselineDigest;
          } catch {
            baselineDigest = '';
          }
        }
      }
      return baselineDigest;
    },

    // R2: remain lazy at E:456–458 and cache both true and false exactly once per invocation.
    candidateInventoryKnown() {
      if (!candidateInventoryInitialized) {
        candidateInventory = isCandidateInventory(artifacts);
        candidateInventoryInitialized = true;
      }
      return candidateInventory;
    },

    beginObligation(applicability) {
      void applicability;
      let baselineArtifactsMap = null;
      const entryFacts = new Map();
      const baselinePathReads = new Map();
      const acceptedBaselineEntries = new Map();
      const validatedBaselineDigests = new Map();

      const obligationCapture = {
        prepareBaselineContainer() {
          baselineArtifactsMap = isPlainObject(baseline) && isPlainObject(baseline.artifacts)
            ? baseline.artifacts : null;
          return Boolean(baselineArtifactsMap);
        },

        captureEntry(rawEntry) {
          const token = Object.freeze(Object.create(null));
          if (!isPlainObject(rawEntry)) {
            entryFacts.set(token, { kind: 'not-object' });
            return Object.freeze({ kind: 'not-object', token });
          }

          let snapshot = null;
          try {
            snapshot = {
              path: rawEntry.path,
              reason: rawEntry.reason,
              hasOwnRenameTo: Object.prototype.hasOwnProperty.call(rawEntry, 'renameTo'),
              renameTo: rawEntry.renameTo
            };
          } catch {
            snapshot = null;
          }
          if (!snapshot) {
            entryFacts.set(token, { kind: 'inspection-failed' });
            return Object.freeze({ kind: 'inspection-failed', token });
          }

          entryFacts.set(token, {
            kind: 'captured',
            rawReason: snapshot.reason,
            rawRenameTo: snapshot.renameTo,
            sourceAbsence: undefined
          });
          return Object.freeze({
            kind: 'captured',
            token,
            path: typeof snapshot.path === 'string' ? snapshot.path : undefined,
            reason: typeof snapshot.reason === 'string' ? snapshot.reason : undefined,
            hasOwnRenameTo: snapshot.hasOwnRenameTo,
            renameTo: typeof snapshot.renameTo === 'string' ? snapshot.renameTo : undefined
          });
        },

        formatInvalidReason(entryToken) {
          return JSON.stringify(entryFacts.get(entryToken).rawReason);
        },

        formatInvalidRenameTo(entryToken) {
          return JSON.stringify(entryFacts.get(entryToken).rawRenameTo);
        },

        captureSourceAbsence(entryToken, path) {
          const present = hasOwnEntry(artifactMap, path);
          const result = Object.freeze({ kind: present ? 'present' : 'absent' });
          const entry = entryFacts.get(entryToken);
          if (entry && entry.kind === 'captured') entry.sourceAbsence = result;
          return result;
        },

        captureBaselinePath(path) {
          if (baselinePathReads.has(path)) return Object.freeze({ ...baselinePathReads.get(path) });
          let result;
          try {
            if (!hasOwnEntry(baselineArtifactsMap, path)) {
              result = Object.freeze({ kind: 'absent' });
            } else {
              const value = baselineArtifactsMap[path];
              result = value === undefined
                ? Object.freeze({ kind: 'present', value: undefined })
                : typeof value === 'string'
                  ? Object.freeze({ kind: 'present', value })
                  : Object.freeze({ kind: 'present', invalidValue: true });
            }
          } catch {
            result = Object.freeze({ kind: 'unknown', reason: 'inspection' });
          }
          baselinePathReads.set(path, result);
          return Object.freeze({ ...result });
        },

        acceptBaselineEntry(detachedEntry) {
          const entryFact = entryFacts.get(detachedEntry.entryToken);
          const sourceAbsence = entryFact && entryFact.sourceAbsence;
          const trustedBaselineDigest = typeof detachedEntry.trustedBaselineDigest === 'string'
            ? detachedEntry.trustedBaselineDigest : undefined;
          const acceptedEntry = Object.freeze({
            path: detachedEntry.path,
            reason: detachedEntry.reason,
            candidatePathPresent: !sourceAbsence || sourceAbsence.kind !== 'absent',
            trustedBaselineDigest,
            ...(detachedEntry.reason === 'rename-from' ? {
              renameTo: detachedEntry.renameTo,
              renameDestinationDigest: detachedEntry.renameDestinationDigest
            } : {})
          });
          acceptedBaselineEntries.set(acceptedEntry.path, acceptedEntry);
          if (trustedBaselineDigest !== undefined) {
            validatedBaselineDigests.set(acceptedEntry.path, acceptedEntry.trustedBaselineDigest);
          }
        },

        baselineEntries() {
          return [...acceptedBaselineEntries.values()].map(entry => Object.freeze({ ...entry }));
        },

        baselineAuditPairs() {
          return [...validatedBaselineDigests].map(([path, digest]) => Object.freeze([path, digest]));
        }
      };

      return Object.freeze(obligationCapture);
    },

    // Narrow legacy operations for the not-yet-migrated candidate lanes. They expose no raw map
    // or entry and preserve each original access at its caller's existing short-circuit site.
    hasOwnCandidateEntry(path) {
      return hasOwnEntry(artifactMap, path);
    },

    ownCandidateDigest(path) {
      return ownDigestOnce(artifactMap[path]);
    },

    candidateArtifact(path) {
      return artifact(artifactMap[path]);
    },

    candidateDigestProperty(path) {
      return artifactMap[path].digest;
    },

    compatibilityPrdSetDigest() {
      return prdSetDigest(artifactMap);
    }
  });
}

module.exports = { createInvocationCapture };
