#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const yaml = require('js-yaml');

const USAGE = 'usage: node scripts/error-ledger-oracle.js --report <scan-report.json> --ledger <errors dir> [--json] [--out <file>] [--platform <platform>]';

function failure(message) {
  const error = new Error(message);
  error.exitCode = 2;
  throw error;
}

function parseArgs(args) {
  const options = { json: false, platform: process.platform };
  const values = new Set(['--report', '--ledger', '--out', '--platform']);
  const seen = new Set();
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--json') {
      if (seen.has(arg)) failure(`duplicate option: ${arg}`);
      seen.add(arg);
      options.json = true;
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

function readReport(file, platform) {
  let report;
  try {
    report = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (error) {
    failure(`could not read scan report: ${error.message}`);
  }
  if (!report || !Array.isArray(report.candidates)) failure('scan report must contain a candidates array');
  const ids = new Set();
  return report.candidates.map((candidate, index) => {
    if (!candidate || typeof candidate.id !== 'string' || !candidate.id || !Array.isArray(candidate.sites) ||
        !candidate.sites.every(site => typeof site === 'string')) {
      failure(`scan report candidate ${index + 1} must have a string id and sites array`);
    }
    if (ids.has(candidate.id)) failure(`duplicate candidate id: ${candidate.id}`);
    ids.add(candidate.id);
    return { id: candidate.id, sites: normalizedSites(candidate.sites, platform) };
  });
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
    return { id: metadata.id, sites: normalizedSites(metadata.sites, platform) };
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
      noise: rate(unmatchedCandidates, candidates.length)
    },
    nonComparable,
    linked,
    unlinked: records.filter(record => !linkedIds.has(record.id)).map(record => record.id).sort(),
    sharedPathHits
  };
}

function isWithin(root, candidate) {
  const relative = path.relative(root, candidate);
  const comparable = process.platform === 'win32' ? relative.toLowerCase() : relative;
  return comparable === '' || (!path.isAbsolute(relative) && comparable !== '..' && !comparable.startsWith(`..${path.sep}`));
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
    return path.join(fs.realpathSync.native(path.dirname(target)), path.basename(target));
  }
}

function safeOutput(file, ledgerDir, reportFile) {
  const output = path.resolve(file);
  const canonicalOutput = canonicalTarget(output);
  const canonicalLedger = fs.realpathSync.native(ledgerDir);
  if (isWithin(canonicalLedger, output) || isWithin(canonicalLedger, canonicalOutput)) {
    failure('--out path is inside the ledger directory');
  }
  const canonicalReport = fs.realpathSync.native(reportFile);
  if (canonicalOutput === canonicalReport ||
      (process.platform === 'win32' && canonicalOutput.toLowerCase() === canonicalReport.toLowerCase())) {
    failure('--out path cannot replace the scan report');
  }
  try {
    const outputStat = fs.statSync(output);
    const reportStat = fs.statSync(reportFile);
    if (outputStat.dev === reportStat.dev && outputStat.ino === reportStat.ino) {
      failure('--out path cannot replace the scan report');
    }
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
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
    ['noise', rate(result.rates.noise)]
  ];
  return `| Metric | Value |\n| --- | ---: |\n${rows.map(([label, value]) => `| ${label} | ${value} |`).join('\n')}\n`;
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  const reportFile = path.resolve(options.report);
  const ledgerDir = path.resolve(options.ledger);
  const candidates = readReport(reportFile, options.platform);
  const records = readLedger(ledgerDir, options.platform);
  const result = compare(records, candidates);
  const output = options.json ? `${JSON.stringify(result, null, 2)}\n` : markdown(result);
  if (options.out) fs.writeFileSync(safeOutput(options.out, ledgerDir, reportFile), output);
  process.stdout.write(output);
}

try {
  main();
} catch (error) {
  process.stderr.write(`${error.message}\n`);
  process.exitCode = error.exitCode || 1;
}
