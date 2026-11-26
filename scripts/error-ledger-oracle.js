#!/usr/bin/env node
'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const yaml = require('js-yaml');

const USAGE = 'usage: node scripts/error-ledger-oracle.js --report <scan-report.json> --ledger <errors dir> [--labels <labels.json>] [--process-view] [--json] [--out <file>] [--platform <platform>]';
const METRIC_NOTE = 'Path overlap is a proxy and may link distinct lessons. Both recall rates are path-linked proxies: recall (all) = linked records / all records; recall (comparable) = linked records / comparable records.';
const PROCESS_METRIC_NOTE = 'All process-view coverage rates are structural coverage proxies and may link distinct lessons. The conservative syntax-only site classifier is a proxy; unsupported or ambiguous site strings are treated as non-comparable for path overlap. Path-comparable coverage uses only path-comparable records as its denominator; overall coverage uses all records. Multi-record signature matches are disclosed as ambiguous and are not counted as resolved or as unique-link credit.';
const SHA256_HEX = /^[0-9a-f]{64}$/i;
const REPO_SHA_HEX = /^[0-9a-f]{40}$/i;
const LOCAL_IDENTIFIER = /^[a-z0-9][a-z0-9_-]{0,63}$/;
const GENERIC_SIGNATURES = new Set([
  'local-memory-lead',
  'local-instruction-lead',
  'local-tool-failure-lead',
  'local-provisional-lesson',
  'lesson',
  'unverified-lesson'
]);
const LABEL_OUTCOMES = new Set([
  'true-positive-existing',
  'true-positive-new',
  'false-positive',
  'uncertain'
]);

function failure(message) {
  const error = new Error(message);
  error.exitCode = 2;
  throw error;
}

function parseArgs(args) {
  const options = { json: false, processView: false, platform: process.platform };
  const values = new Set(['--report', '--ledger', '--labels', '--out', '--platform']);
  const seen = new Set();
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--json' || arg === '--process-view') {
      if (seen.has(arg)) failure(`duplicate option: ${arg}`);
      seen.add(arg);
      if (arg === '--json') options.json = true;
      if (arg === '--process-view') options.processView = true;
      continue;
    }
    if (!values.has(arg)) failure(`unknown option: ${arg}`);
    if (seen.has(arg)) failure(`duplicate option: ${arg}`);
    if (i + 1 >= args.length || !args[i + 1] || args[i + 1].startsWith('--')) failure(`missing value for ${arg}`);
    seen.add(arg);
    options[arg.slice(2)] = args[++i];
  }
  if (!options.report || !options.ledger) failure(`${USAGE}; --report and --ledger are required`);
  return options;
}

function normalizeSite(value, platform) {
  let site = value.trim().replace(/\s+\(.*\)\s*$/, '').trim().replace(/\\/g, '/');
  site = site.replace(/^(?:\.\/)+/, '');
  if (!site || site.startsWith('/') || /^[a-z]:/i.test(site) || /^~(?:\/|$)/.test(site) ||
      /^[a-z][a-z\d+.-]*:\/\//i.test(site)) return null;
  site = path.posix.normalize(site);
  if (site === '.' || site === '..' || site.startsWith('../') || site.startsWith('/')) return null;
  return platform === 'win32' ? site.toLowerCase() : site;
}

function normalizedSites(sites, platform) {
  return new Set(sites.map(site => normalizeSite(site, platform)).filter(Boolean));
}

function normalizeProcessSite(value, platform) {
  if (typeof value !== 'string') return null;
  const raw = value.trim().replace(/\s+\(.*\)\s*$/, '').trim();
  if (!raw) return null;
  if (/^[a-z][a-z\d+.-]*:\/\//i.test(raw) || /^[a-z]:/i.test(raw) || /^[/\\]/.test(raw) || /^~(?:[/\\]|$)/.test(raw)) {
    return null;
  }
  const slashed = raw.replace(/\\/g, '/');
  if (slashed.includes('//') || /[*?[\]{}]/.test(slashed) || /[\x00-\x1f\x7f\t\r\n"'`<>|:;#=$!,]/.test(slashed)) {
    return null;
  }
  const parts = slashed.split('/');
  while (parts.length && parts[0] === '.') parts.shift();
  if (parts.length > 1 && parts[parts.length - 1] === '') parts.pop();
  if (!parts.length) return null;
  for (const segment of parts) {
    if (!segment || segment === '.' || segment === '..') return null;
    if (/^\s|\s$|\s{2,}/.test(segment)) return null;
    if (!/^[A-Za-z0-9._+@()-]+(?: [A-Za-z0-9._+@()-]+)*$/.test(segment)) return null;
  }
  const last = parts[parts.length - 1];
  const hasSpace = parts.some(segment => segment.includes(' '));
  const hasExtension = /^.+?\.[A-Za-z0-9]{1,12}$/.test(last) && !last.startsWith('.');
  const isDotfile = parts.length === 1 && /^\.[A-Za-z0-9][A-Za-z0-9._-]*$/.test(last) && !hasSpace;
  if (!hasExtension && !(parts.length >= 2 && !hasSpace) && !isDotfile) {
    return null;
  }
  const normalized = parts.join('/');
  return platform === 'win32' ? normalized.toLowerCase() : normalized;
}

function normalizedProcessSites(sites, platform) {
  return new Set(sites.map(site => normalizeProcessSite(site, platform)).filter(Boolean));
}

function extractLocalStoreSignature(candidate) {
  if (!Array.isArray(candidate.sources) || candidate.sources.length === 0) return null;
  if (!candidate.sources.every(source => source && typeof source === 'object' && source.type === 'local-store')) {
    return null;
  }
  if (typeof candidate.signature !== 'string' || !LOCAL_IDENTIFIER.test(candidate.signature)) {
    return null;
  }
  if (GENERIC_SIGNATURES.has(candidate.signature)) return null;
  if (!candidate.sources.every(source => source.signature === undefined || source.signature === candidate.signature)) {
    return null;
  }
  return candidate.signature;
}

function readReport(file, platform) {
  let rawBytes;
  let report;
  try {
    rawBytes = fs.readFileSync(file);
    report = JSON.parse(rawBytes.toString('utf8'));
  } catch (error) {
    failure(`could not read scan report: ${error.message}`);
  }
  const reportSha256 = crypto.createHash('sha256').update(rawBytes).digest('hex');
  if (!report || !Array.isArray(report.candidates)) failure('scan report must contain a candidates array');
  const ids = new Set();
  const candidates = report.candidates.map((candidate, index) => {
    if (!candidate || typeof candidate.id !== 'string' || !candidate.id || !Array.isArray(candidate.sites) ||
        !candidate.sites.every(site => typeof site === 'string')) {
      failure(`scan report candidate ${index + 1} must have a string id and sites array`);
    }
    if (ids.has(candidate.id)) failure(`duplicate candidate id: ${candidate.id}`);
    ids.add(candidate.id);
    return {
      id: candidate.id,
      sites: normalizedSites(candidate.sites, platform),
      processSites: normalizedProcessSites(candidate.sites, platform),
      localStoreSignature: extractLocalStoreSignature(candidate)
    };
  });
  return { candidates, reportSha256 };
}

function readLedger(dir, platform) {
  let files;
  try {
    files = fs.readdirSync(dir, { withFileTypes: true })
      .filter(entry => entry.isFile() && /^E-.*\.md$/i.test(entry.name))
      .map(entry => entry.name).sort();
  } catch (error) {
    failure(`could not read ledger directory: ${error.message}`);
  }
  const ids = new Set();
  return files.map(file => {
    let contents;
    try {
      contents = fs.readFileSync(path.join(dir, file), 'utf8');
    } catch (error) {
      failure(`could not read ledger record ${file}: ${error.message}`);
    }
    const frontmatter = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(contents);
    if (!frontmatter) failure(`ledger record has no YAML frontmatter: ${file}`);
    let metadata;
    try {
      metadata = yaml.load(frontmatter[1]);
    } catch (error) {
      failure(`invalid YAML frontmatter in ${file}: ${error.message.split('\n')[0]}`);
    }
    if (!metadata || typeof metadata.id !== 'string' || !metadata.id || !Array.isArray(metadata.sites) ||
        !metadata.sites.every(site => typeof site === 'string')) {
      failure(`ledger record ${file} must have a string id and sites array`);
    }
    if (ids.has(metadata.id)) failure(`duplicate ledger id: ${metadata.id}`);
    ids.add(metadata.id);
    return {
      id: metadata.id,
      sites: normalizedSites(metadata.sites, platform),
      processSites: normalizedProcessSites(metadata.sites, platform),
      signature: typeof metadata.signature === 'string' && metadata.signature.trim() ? metadata.signature.trim() : null
    };
  });
}

function contains(parent, child) {
  return child === parent || child.startsWith(parent.endsWith('/') ? parent : `${parent}/`);
}

function overlaps(left, right) {
  return contains(left, right) || contains(right, left);
}

function compare(records, candidates) {
  const linked = [];
  const linkedCandidates = new Set();
  for (const record of records) {
    const candidateIds = candidates.filter(candidate =>
      [...record.sites].some(recordSite => [...candidate.sites].some(candidateSite => overlaps(recordSite, candidateSite)))
    ).map(candidate => candidate.id).sort();
    if (candidateIds.length) {
      linked.push({ id: record.id, candidateIds });
      candidateIds.forEach(id => linkedCandidates.add(id));
    }
  }

  const recordSites = new Map();
  const candidateSites = new Map();
  for (const record of records) for (const site of record.sites) {
    const ids = recordSites.get(site) || new Set();
    ids.add(record.id);
    recordSites.set(site, ids);
  }
  for (const candidate of candidates) for (const site of candidate.sites) {
    const ids = candidateSites.get(site) || new Set();
    ids.add(candidate.id);
    candidateSites.set(site, ids);
  }
  const sharedPathHits = [...recordSites.entries()]
    .filter(([site, recordIds]) => recordIds.size > 1 && candidateSites.has(site))
    .map(([site, recordIds]) => ({
      site,
      recordIds: [...recordIds].sort(),
      candidateIds: [...candidateSites.get(site)].sort()
    }))
    .sort((a, b) => a.site.localeCompare(b.site));

  const nonComparable = records.filter(record => record.sites.size === 0).map(record => record.id).sort();
  const linkedIds = new Set(linked.map(record => record.id));
  const linkedRecords = linked.length;
  const unmatchedCandidates = candidates.length - linkedCandidates.size;
  const rate = (numerator, denominator) => denominator ? numerator / denominator : null;
  return {
    counts: {
      records: records.length,
      comparableRecords: records.length - nonComparable.length,
      linkedRecords,
      candidates: candidates.length,
      unmatchedCandidates
    },
    rates: {
      recallAll: rate(linkedRecords, records.length),
      recallComparable: rate(linkedRecords, records.length - nonComparable.length),
      unmatchedShare: rate(unmatchedCandidates, candidates.length)
    },
    metricNote: METRIC_NOTE,
    nonComparable,
    linked,
    unlinked: records.filter(record => !linkedIds.has(record.id)).map(record => record.id).sort(),
    sharedPathHits
  };
}

function compareProcessView(records, candidates) {
  const pathLinked = [];
  for (const record of records) {
    const candidateIds = candidates.filter(candidate =>
      [...record.processSites].some(recordSite =>
        [...candidate.processSites].some(candidateSite => overlaps(recordSite, candidateSite))
      )
    ).map(candidate => candidate.id).sort();
    if (candidateIds.length) {
      pathLinked.push({ id: record.id, candidateIds });
    }
  }
  pathLinked.sort((a, b) => a.id.localeCompare(b.id));

  const recordSites = new Map();
  const candidateSites = new Map();
  for (const record of records) for (const site of record.processSites) {
    const ids = recordSites.get(site) || new Set();
    ids.add(record.id);
    recordSites.set(site, ids);
  }
  for (const candidate of candidates) for (const site of candidate.processSites) {
    const ids = candidateSites.get(site) || new Set();
    ids.add(candidate.id);
    candidateSites.set(site, ids);
  }
  const sharedPathHits = [...recordSites.entries()]
    .filter(([site, recordIds]) => recordIds.size > 1 && candidateSites.has(site))
    .map(([site, recordIds]) => ({
      site,
      recordIds: [...recordIds].sort(),
      candidateIds: [...candidateSites.get(site)].sort()
    }))
    .sort((a, b) => a.site.localeCompare(b.site));

  const recordsBySignature = new Map();
  for (const record of records) {
    if (!record.signature) continue;
    const ids = recordsBySignature.get(record.signature) || [];
    ids.push(record.id);
    recordsBySignature.set(record.signature, ids);
  }
  for (const ids of recordsBySignature.values()) ids.sort();

  const uniqueSigByRecord = new Map();
  const ambiguousBySignature = new Map();
  for (const candidate of candidates) {
    if (!candidate.localStoreSignature) continue;
    const matchedIds = recordsBySignature.get(candidate.localStoreSignature);
    if (!matchedIds || matchedIds.length === 0) continue;
    if (matchedIds.length === 1) {
      const recordId = matchedIds[0];
      const entry = uniqueSigByRecord.get(recordId) || { signature: candidate.localStoreSignature, candidateIds: new Set() };
      entry.candidateIds.add(candidate.id);
      uniqueSigByRecord.set(recordId, entry);
    } else {
      const entry = ambiguousBySignature.get(candidate.localStoreSignature) || {
        signature: candidate.localStoreSignature,
        recordIds: [...matchedIds],
        candidateIds: new Set()
      };
      entry.candidateIds.add(candidate.id);
      ambiguousBySignature.set(candidate.localStoreSignature, entry);
    }
  }

  const uniqueSignatureLinked = [...uniqueSigByRecord.entries()]
    .map(([id, entry]) => ({ id, signature: entry.signature, candidateIds: [...entry.candidateIds].sort() }))
    .sort((a, b) => a.id.localeCompare(b.id));

  const ambiguousSignatureMatches = [...ambiguousBySignature.values()]
    .map(entry => ({
      signature: entry.signature,
      recordIds: entry.recordIds,
      candidateIds: [...entry.candidateIds].sort()
    }))
    .sort((a, b) => a.signature.localeCompare(b.signature));

  const pathByRecordId = new Map(pathLinked.map(item => [item.id, item.candidateIds]));
  const sigByRecordId = new Map(uniqueSignatureLinked.map(item => [item.id, item.candidateIds]));
  const unionLinked = [];
  const pathOnlyRecords = [];
  const uniqueSignatureOnlyRecords = [];
  const bothPathAndUniqueSignatureRecords = [];
  const unlinkedRecords = [];

  for (const record of [...records].sort((a, b) => a.id.localeCompare(b.id))) {
    const pathCands = pathByRecordId.get(record.id);
    const sigCands = sigByRecordId.get(record.id);
    if (pathCands && sigCands) {
      bothPathAndUniqueSignatureRecords.push(record.id);
      unionLinked.push({
        id: record.id,
        channels: ['path', 'unique-signature'],
        candidateIds: [...new Set([...pathCands, ...sigCands])].sort()
      });
    } else if (pathCands) {
      pathOnlyRecords.push(record.id);
      unionLinked.push({ id: record.id, channels: ['path'], candidateIds: pathCands });
    } else if (sigCands) {
      uniqueSignatureOnlyRecords.push(record.id);
      unionLinked.push({ id: record.id, channels: ['unique-signature'], candidateIds: sigCands });
    } else {
      unlinkedRecords.push(record.id);
    }
  }

  const pathNonComparable = records.filter(record => record.processSites.size === 0).map(record => record.id).sort();
  const pathComparableRecords = records.length - pathNonComparable.length;
  const ambiguousSignatureRecords = new Set(ambiguousSignatureMatches.flatMap(item => item.recordIds)).size;
  const ambiguousSignatureCandidates = new Set(ambiguousSignatureMatches.flatMap(item => item.candidateIds)).size;
  const rate = (numerator, denominator) => denominator ? numerator / denominator : null;

  return {
    counts: {
      records: records.length,
      pathComparableRecords,
      pathNonComparableRecords: pathNonComparable.length,
      signatureEligibleRecords: records.filter(record => Boolean(record.signature)).length,
      pathLinkedRecords: pathLinked.length,
      uniqueSignatureLinkedRecords: uniqueSignatureLinked.length,
      unionLinkedRecords: unionLinked.length,
      candidates: candidates.length,
      pathComparableCandidates: candidates.filter(candidate => candidate.processSites.size > 0).length,
      signatureEligibleCandidates: candidates.filter(candidate => Boolean(candidate.localStoreSignature)).length
    },
    coverage: {
      path: {
        linkedRecords: pathLinked.length,
        pathComparableDenominator: pathComparableRecords,
        allRecordsDenominator: records.length,
        ratePathComparable: rate(pathLinked.length, pathComparableRecords),
        rateAll: rate(pathLinked.length, records.length)
      },
      uniqueSignature: {
        linkedRecords: uniqueSignatureLinked.length,
        allRecordsDenominator: records.length,
        rateAll: rate(uniqueSignatureLinked.length, records.length)
      },
      union: {
        linkedRecords: unionLinked.length,
        allRecordsDenominator: records.length,
        rateAll: rate(unionLinked.length, records.length)
      }
    },
    breakdown: {
      counts: {
        pathOnly: pathOnlyRecords.length,
        uniqueSignatureOnly: uniqueSignatureOnlyRecords.length,
        bothPathAndUniqueSignature: bothPathAndUniqueSignatureRecords.length,
        unlinked: unlinkedRecords.length,
        sharedPathHits: sharedPathHits.length,
        ambiguousSignatureMatches: ambiguousSignatureMatches.length,
        ambiguousSignatureRecords,
        ambiguousSignatureCandidates
      },
      pathOnlyRecords,
      uniqueSignatureOnlyRecords,
      bothPathAndUniqueSignatureRecords,
      unlinkedRecords
    },
    metricNote: PROCESS_METRIC_NOTE,
    pathNonComparable,
    pathLinked,
    uniqueSignatureLinked,
    unionLinked,
    sharedPathHits,
    ambiguousSignatureMatches
  };
}

function readLabels(file, reportSha256, candidates, records) {
  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (error) {
    failure(`could not read labels file: ${error.message}`);
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    failure('labels file must contain a JSON object');
  }
  if (parsed.schemaVersion !== 1) {
    failure('labels schemaVersion must be 1');
  }
  if (typeof parsed.reportSha256 !== 'string' || !SHA256_HEX.test(parsed.reportSha256)) {
    failure('labels reportSha256 must be a 64-character hex SHA-256 digest');
  }
  if (parsed.reportSha256.toLowerCase() !== reportSha256) {
    failure(`labels reportSha256 mismatch: expected ${reportSha256}`);
  }
  if (typeof parsed.repoSha !== 'string' || !REPO_SHA_HEX.test(parsed.repoSha)) {
    failure('labels repoSha must be a 40-character hex commit SHA');
  }
  if (!Array.isArray(parsed.labels)) {
    failure('labels file must contain a labels array');
  }

  const candidateIds = new Set(candidates.map(candidate => candidate.id));
  const recordIds = new Set(records.map(record => record.id));
  const byCandidate = new Map();

  for (let index = 0; index < parsed.labels.length; index++) {
    const entry = parsed.labels[index];
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      failure(`label entry ${index + 1} must be an object`);
    }
    if (typeof entry.candidateId !== 'string' || !entry.candidateId) {
      failure(`label entry ${index + 1} must have a non-empty string candidateId`);
    }
    if (!candidateIds.has(entry.candidateId)) {
      failure(`unknown label candidateId: ${entry.candidateId}`);
    }
    if (byCandidate.has(entry.candidateId)) {
      failure(`duplicate label candidateId: ${entry.candidateId}`);
    }
    if (typeof entry.outcome !== 'string' || !LABEL_OUTCOMES.has(entry.outcome)) {
      failure(`invalid label outcome for ${entry.candidateId}: ${String(entry.outcome)}`);
    }
    const hasLinkedRecordId = Object.prototype.hasOwnProperty.call(entry, 'linkedRecordId');
    if (entry.outcome === 'true-positive-existing') {
      if (!hasLinkedRecordId || typeof entry.linkedRecordId !== 'string' || !entry.linkedRecordId) {
        failure(`linkedRecordId is required for true-positive-existing candidate: ${entry.candidateId}`);
      }
      if (!recordIds.has(entry.linkedRecordId)) {
        failure(`unknown linkedRecordId for ${entry.candidateId}: ${entry.linkedRecordId}`);
      }
      byCandidate.set(entry.candidateId, { outcome: entry.outcome, linkedRecordId: entry.linkedRecordId });
    } else {
      if (hasLinkedRecordId) {
        failure(`linkedRecordId is only allowed for true-positive-existing candidate: ${entry.candidateId}`);
      }
      byCandidate.set(entry.candidateId, { outcome: entry.outcome });
    }
  }

  return {
    schemaVersion: 1,
    reportSha256,
    repoSha: parsed.repoSha.toLowerCase(),
    byCandidate
  };
}

function evaluateLabels(result, candidates, labelsData) {
  let truePositiveExisting = 0;
  let truePositiveNew = 0;
  let falsePositive = 0;
  let uncertain = 0;
  for (const label of labelsData.byCandidate.values()) {
    if (label.outcome === 'true-positive-existing') truePositiveExisting += 1;
    else if (label.outcome === 'true-positive-new') truePositiveNew += 1;
    else if (label.outcome === 'false-positive') falsePositive += 1;
    else if (label.outcome === 'uncertain') uncertain += 1;
  }

  const labelled = labelsData.byCandidate.size;
  const decided = truePositiveExisting + truePositiveNew + falsePositive;
  const unlabelled = candidates.length - labelled;

  let totalPathPairs = 0;
  let auditedPairs = 0;
  let truePairs = 0;
  let falsePairs = 0;
  let uncertainPairs = 0;
  let unlabelledPairs = 0;
  for (const record of result.linked) {
    for (const candidateId of record.candidateIds) {
      totalPathPairs += 1;
      const label = labelsData.byCandidate.get(candidateId);
      if (!label) {
        unlabelledPairs += 1;
      } else if (label.outcome === 'uncertain') {
        uncertainPairs += 1;
      } else {
        auditedPairs += 1;
        if (label.outcome === 'true-positive-existing' && label.linkedRecordId === record.id) {
          truePairs += 1;
        } else {
          falsePairs += 1;
        }
      }
    }
  }

  const rate = (numerator, denominator) => denominator ? numerator / denominator : null;
  const falseLinkShare = rate(falsePairs, auditedPairs);
  return {
    schemaVersion: labelsData.schemaVersion,
    reportSha256: labelsData.reportSha256,
    repoSha: labelsData.repoSha,
    counts: {
      labelled,
      decided,
      truePositiveExisting,
      truePositiveNew,
      falsePositive,
      uncertain,
      unlabelled
    },
    rates: {
      coverage: rate(labelled, candidates.length),
      precision: rate(truePositiveExisting + truePositiveNew, decided),
      falsePositiveShare: rate(falsePositive, decided),
      falseLinkShare
    },
    pathLinkAudit: {
      totalPathPairs,
      auditedPairs,
      truePairs,
      falsePairs,
      uncertainPairs,
      unlabelledPairs,
      falseLinkShare
    }
  };
}

function isWithin(root, candidate, pathApi) {
  const api = pathApi || (process.platform === 'win32' ? path.win32 : path);
  const windows = api === path.win32 || (!pathApi && process.platform === 'win32');
  const comparisonRoot = windows ? root.toLowerCase() : root;
  const comparisonCandidate = windows ? candidate.toLowerCase() : candidate;
  const relative = api.relative(comparisonRoot, comparisonCandidate);
  return relative === '' || (!api.isAbsolute(relative) && relative !== '..' && !relative.startsWith(`..${api.sep}`));
}

function canonicalTarget(file) {
  const target = path.resolve(file);
  try {
    const stat = fs.lstatSync(target);
    if (stat.isSymbolicLink()) {
      try {
        return fs.realpathSync.native(target);
      } catch (error) {
        if (error.code === 'ENOENT') failure('--out path cannot be a dangling symlink');
        throw error;
      }
    }
    return fs.realpathSync.native(target);
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    let current = path.dirname(target);
    const suffix = [path.basename(target)];
    while (true) {
      try {
        fs.lstatSync(current);
        return path.join(fs.realpathSync.native(current), ...suffix);
      } catch (inner) {
        if (inner.code !== 'ENOENT' && inner.code !== 'ENOTDIR') throw inner;
        const parent = path.dirname(current);
        if (parent === current) throw inner;
        suffix.unshift(path.basename(current));
        current = parent;
      }
    }
  }
}

function listFilesRecursive(dir) {
  const files = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) files.push(...listFilesRecursive(full));
    else if (entry.isFile()) files.push(full);
  }
  return files;
}

function samePath(left, right) {
  return left === right || (process.platform === 'win32' && left.toLowerCase() === right.toLowerCase());
}

function safeOutput(file, ledgerDir, reportFile, labelsFile) {
  const output = path.resolve(file);
  const canonicalOutput = canonicalTarget(output);
  const canonicalLedger = fs.realpathSync.native(ledgerDir);
  if (isWithin(canonicalLedger, output) || isWithin(canonicalLedger, canonicalOutput)) {
    failure('--out path is inside the ledger directory');
  }
  const protectedFiles = [{ file: reportFile, label: 'the scan report' }];
  if (labelsFile) protectedFiles.push({ file: labelsFile, label: 'the labels file' });
  for (const item of protectedFiles) {
    const canonicalProtected = fs.realpathSync.native(item.file);
    if (samePath(canonicalOutput, canonicalProtected)) {
      failure(`--out path cannot replace ${item.label}`);
    }
  }
  let outputStat = null;
  try {
    outputStat = fs.statSync(output, { bigint: true });
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  if (outputStat) {
    for (const item of protectedFiles) {
      const protectedStat = fs.statSync(item.file, { bigint: true });
      if (outputStat.dev === protectedStat.dev && outputStat.ino === protectedStat.ino) {
        failure(`--out path cannot replace ${item.label}`);
      }
    }
    for (const ledgerFile of listFilesRecursive(canonicalLedger)) {
      const ledgerStat = fs.statSync(ledgerFile, { bigint: true });
      if (outputStat.dev === ledgerStat.dev && outputStat.ino === ledgerStat.ino) {
        failure('--out path cannot replace a ledger file');
      }
    }
  }
  return output;
}

function markdown(result) {
  const rate = value => value === null ? 'n/a' : `${(value * 100).toFixed(1)}%`;
  const rows = [
    ['records', result.counts.records],
    ['comparable records', result.counts.comparableRecords],
    ['linked records', result.counts.linkedRecords],
    ['candidates', result.counts.candidates],
    ['unmatched candidates', result.counts.unmatchedCandidates],
    ['recall (all)', rate(result.rates.recallAll)],
    ['recall (comparable)', rate(result.rates.recallComparable)],
    ['unmatched candidate share (path overlap)', rate(result.rates.unmatchedShare)]
  ];
  let out = `${result.metricNote}\n\n| Metric | Value |\n| --- | ---: |\n${rows.map(([label, value]) => `| ${label} | ${value} |`).join('\n')}\n`;
  if (result.labelled) {
    const { counts, rates, pathLinkAudit } = result.labelled;
    const labelledRows = [
      ['labelled candidates', counts.labelled],
      ['decided candidates', counts.decided],
      ['true-positive-existing', counts.truePositiveExisting],
      ['true-positive-new', counts.truePositiveNew],
      ['false-positive', counts.falsePositive],
      ['uncertain', counts.uncertain],
      ['unlabelled candidates', counts.unlabelled],
      ['label coverage', rate(rates.coverage)],
      ['candidate precision (decided candidates)', rate(rates.precision)],
      ['false-positive share among decided candidates', rate(rates.falsePositiveShare)],
      ['audited path pairs (decided)', pathLinkAudit.auditedPairs],
      ['true path pairs', pathLinkAudit.truePairs],
      ['false path pairs', pathLinkAudit.falsePairs],
      ['path-link false-link share (audited pairs)', rate(rates.falseLinkShare)]
    ];
    out += `\n## Labelled Evaluation\n\n| Metric | Value |\n| --- | ---: |\n${labelledRows.map(([label, value]) => `| ${label} | ${value} |`).join('\n')}\n`;
  }
  if (result.processView) {
    const pv = result.processView;
    const processRows = [
      ['records (all denominator)', pv.counts.records],
      ['path-comparable records (path-comparable denominator)', pv.counts.pathComparableRecords],
      ['path-non-comparable records', pv.counts.pathNonComparableRecords],
      ['path-linked records', pv.counts.pathLinkedRecords],
      ['unique-signature-linked records', pv.counts.uniqueSignatureLinkedRecords],
      ['union-linked records', pv.counts.unionLinkedRecords],
      ['path coverage (path-comparable)', rate(pv.coverage.path.ratePathComparable)],
      ['path coverage (all records)', rate(pv.coverage.path.rateAll)],
      ['unique-signature coverage (all records)', rate(pv.coverage.uniqueSignature.rateAll)],
      ['union coverage (all records)', rate(pv.coverage.union.rateAll)],
      ['overlap: path only', pv.breakdown.counts.pathOnly],
      ['overlap: unique-signature only', pv.breakdown.counts.uniqueSignatureOnly],
      ['overlap: both path and unique-signature', pv.breakdown.counts.bothPathAndUniqueSignature],
      ['unlinked records', pv.breakdown.counts.unlinked],
      ['shared path hits (ambiguous paths)', pv.breakdown.counts.sharedPathHits],
      ['ambiguous signature matches (unresolved)', pv.breakdown.counts.ambiguousSignatureMatches],
      ['ambiguous signature records (unresolved)', pv.breakdown.counts.ambiguousSignatureRecords],
      ['ambiguous signature candidates (unresolved)', pv.breakdown.counts.ambiguousSignatureCandidates]
    ];
    out += `\n## Process View\n\n${pv.metricNote}\n\n| Metric | Value |\n| --- | ---: |\n${processRows.map(([label, value]) => `| ${label} | ${value} |`).join('\n')}\n`;
  }
  return out;
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  const reportFile = path.resolve(options.report);
  const ledgerDir = path.resolve(options.ledger);
  const labelsFile = options.labels ? path.resolve(options.labels) : null;
  const { candidates, reportSha256 } = readReport(reportFile, options.platform);
  const records = readLedger(ledgerDir, options.platform);
  const labelsData = labelsFile ? readLabels(labelsFile, reportSha256, candidates, records) : null;
  const result = compare(records, candidates);
  if (labelsData) result.labelled = evaluateLabels(result, candidates, labelsData);
  if (options.processView) result.processView = compareProcessView(records, candidates);
  const output = options.json ? `${JSON.stringify(result, null, 2)}\n` : markdown(result);
  if (options.out) fs.writeFileSync(safeOutput(options.out, ledgerDir, reportFile, labelsFile), output);
  process.stdout.write(output);
}

try {
  main();
} catch (error) {
  process.stderr.write(`${error.message}\n`);
  process.exitCode = error.exitCode || 1;
}
