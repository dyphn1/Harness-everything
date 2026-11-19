#!/usr/bin/env node
'use strict';

const crypto = require('node:crypto');
const childProcess = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const ERRORS = path.join('.agents', 'harness-everything', 'errors');
const INDEX = 'index.jsonl';
const RECORD_NAME = /^E-(\d{4})-[a-z0-9-]+\.md$/;
const HASH = /^[a-f0-9]{64}$/i;
const COMMIT = /^[a-f0-9]{40}$/i;
const SIGNATURE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const SCOPES = new Set(['in', 'out', 'unresolved']);
const STATUSES = new Set(['open', 'lesson', 'mechanism']);
const LOCK = '.promote.lock';

function problem(message, exitCode = 2) {
  const error = new Error(message);
  error.exitCode = exitCode;
  throw error;
}

function canonical(file) {
  return fs.realpathSync.native ? fs.realpathSync.native(file) : fs.realpathSync(file);
}

function samePath(left, right) {
  return process.platform === 'win32'
    ? left.toLowerCase() === right.toLowerCase()
    : left === right;
}

function isWithin(root, candidate, api = path) {
  const windows = api === path.win32 || process.platform === 'win32';
  const left = windows ? root.toLowerCase() : root;
  const right = windows ? candidate.toLowerCase() : candidate;
  const relative = api.relative(left, right);
  return relative === '' || (!api.isAbsolute(relative) && relative !== '..' && !relative.startsWith(`..${api.sep}`));
}

function parseArgs(args) {
  const options = {};
  const seen = new Set();
  for (let i = 0; i < args.length; i++) {
    const name = args[i];
    if (name === '--json') {
      if (seen.has(name)) problem('duplicate option: --json');
      seen.add(name);
      options.json = true;
      continue;
    }
    if (!['--target', '--report', '--approval', '--harness'].includes(name)) problem(`unknown option: ${name}`);
    if (seen.has(name)) problem(`duplicate option: ${name}`);
    if (!args[i + 1] || args[i + 1].startsWith('--')) problem(`${name} requires a value`);
    seen.add(name);
    options[name.slice(2)] = args[++i];
  }
  for (const name of ['target', 'report', 'approval', 'harness']) {
    if (!options[name]) problem(`--${name} is required`);
  }
  return options;
}

function readInput(file, label) {
  try {
    return fs.readFileSync(file);
  } catch (error) {
    problem(`${label} cannot be read: ${error.message}`);
  }
}

function readJson(bytes, label) {
  try {
    return JSON.parse(bytes.toString('utf8'));
  } catch (error) {
    problem(`${label} is not valid JSON: ${error.message}`);
  }
}

function nonempty(value) {
  return typeof value === 'string' && value.trim().length > 0 && !value.includes('\0');
}

function hasAbsolutePath(value) {
  return /(?:^|[\s("'`=(:,;])(?:\/(?!\/)|[A-Za-z]:[\\/]|\\\\)/.test(value);
}

function safeRepoPath(value) {
  if (!nonempty(value) || hasAbsolutePath(value)) return false;
  const normalized = value.replace(/\\/g, '/');
  return !path.posix.isAbsolute(normalized) && !/^[A-Za-z]:/.test(normalized) &&
    !normalized.split('/').includes('..') && normalized !== '.';
}

function validateApproval(approval) {
  if (!approval || approval.schemaVersion !== 1) problem('approval schemaVersion must be 1');
  if (typeof approval.candidateId !== 'string' || !/^[a-f0-9]{20}$/i.test(approval.candidateId)) {
    problem('approval candidateId must be a 20-character report id');
  }
  if (typeof approval.reportSha256 !== 'string' || !HASH.test(approval.reportSha256)) {
    problem('approval reportSha256 must be a SHA-256 hex digest');
  }
  if (typeof approval.targetRoot !== 'string' || !path.isAbsolute(approval.targetRoot)) {
    problem('approval targetRoot must be an absolute path');
  }
  if (!nonempty(approval.approvedBy) || !nonempty(approval.approvedAt) || !Number.isFinite(Date.parse(approval.approvedAt))) {
    problem('approval must include approvedBy and a valid approvedAt timestamp');
  }
  const record = approval.record;
  if (!record || typeof record !== 'object' || Array.isArray(record)) problem('approval record must be an object');
  if (!nonempty(record.signature) || !SIGNATURE.test(record.signature)) problem('record signature must be kebab-case');
  for (const field of ['class', 'title', 'violates', 'sourcesNote']) {
    if (!nonempty(record[field])) problem(`record ${field} is required`);
  }
  if (!SCOPES.has(record.scope)) problem('record scope must be in, out or unresolved');
  if (!STATUSES.has(record.status)) problem('record status must be open, lesson or mechanism');
  if (!Array.isArray(record.sites) || record.sites.some(site => !safeRepoPath(site))) {
    problem('record sites must be repository-relative paths');
  }
  for (const field of ['approvedBy', 'approvedAt']) {
    if (hasAbsolutePath(approval[field])) problem(`approval ${field} must not contain an absolute path`);
  }
  for (const field of ['class', 'title', 'violates', 'sourcesNote']) {
    if (hasAbsolutePath(record[field])) problem(`record ${field} must not contain an absolute path`);
  }
}

function directoryInfo(targetRoot) {
  const errorsPath = path.join(targetRoot, ERRORS);
  let errorsDir;
  try {
    errorsDir = canonical(errorsPath);
    if (!fs.statSync(errorsDir).isDirectory()) problem(`target must contain ${ERRORS}/`);
  } catch (error) {
    if (error.exitCode) throw error;
    problem(`target must contain an existing ${ERRORS}/ directory`);
  }
  if (!isWithin(targetRoot, errorsDir)) problem('errors directory resolves outside the target root');
  const index = path.join(errorsDir, INDEX);
  inspectIndex(index);
  return { errorsDir, index };
}

function inspectIndex(index) {
  try {
    const stat = fs.lstatSync(index);
    if (stat.isSymbolicLink() || !stat.isFile()) problem('target index must be a regular file inside the errors directory');
  } catch (error) {
    if (error.code !== 'ENOENT') {
      if (error.exitCode) throw error;
      problem(`target index cannot be inspected: ${error.message}`);
    }
  }
}

function harnessTool(harnessInput) {
  let root;
  try {
    root = canonical(path.resolve(harnessInput));
    if (!fs.statSync(root).isDirectory()) problem('--harness must be a Harness checkout directory');
  } catch (error) {
    if (error.exitCode) throw error;
    problem(`Harness checkout is unavailable: ${error.message}; pass --harness to an installed Harness checkout with Node dependencies`);
  }
  const script = path.join(root, 'scripts', 'errors-sync.js');
  try {
    if (!fs.statSync(script).isFile() || !isWithin(root, canonical(script))) {
      problem('Harness checkout is missing scripts/errors-sync.js; pass --harness to a trusted Harness checkout');
    }
  } catch (error) {
    if (error.exitCode) throw error;
    problem(`Harness checkout is missing scripts/errors-sync.js; pass --harness to a trusted Harness checkout (${error.message})`);
  }
  try { require.resolve('js-yaml', { paths: [path.dirname(script)] }); }
  catch (error) {
    problem(`Harness checkout cannot resolve js-yaml; install its Node dependencies and retry with that checkout (${error.message})`);
  }
  return script;
}

function durableSources(candidate) {
  const sources = new Set();
  for (const source of Array.isArray(candidate.sources) ? candidate.sources : []) {
    if (source && source.type === 'git' && typeof source.sha === 'string' && COMMIT.test(source.sha)) {
      sources.add(`commit ${source.sha.toLowerCase()}`);
    } else if (source && source.type !== 'memory' && typeof source.ref === 'string' &&
      source.ref.startsWith('repo/') && safeRepoPath(source.ref.slice(5))) {
      sources.add(`repo/${source.ref.slice(5).replace(/\\/g, '/')}`);
    }
  }
  for (const site of Array.isArray(candidate.sites) ? candidate.sites : []) {
    if (safeRepoPath(site)) sources.add(`repo/${site.replace(/\\/g, '/')}`);
  }
  return [...sources].sort();
}

function assertApprovalUnused(errorsDir, approvalHash) {
  for (const name of fs.readdirSync(errorsDir)) {
    if (!RECORD_NAME.test(name)) continue;
    const file = path.join(errorsDir, name);
    const stat = fs.lstatSync(file);
    if (stat.isSymbolicLink()) problem(`ledger record is a symlink: ${name}`);
    if (fs.readFileSync(file, 'utf8').includes(`approval-sha256: ${approvalHash}`)) {
      problem('this approval has already been promoted');
    }
  }
}

function yaml(value) {
  return JSON.stringify(value);
}

function recordText(approval, candidate, id, reportHash, approvalHash) {
  const record = approval.record;
  const sources = durableSources(candidate);
  if (!sources.length) problem('selected report candidate has no durable source evidence');
  return [
    '---',
    `id: ${yaml(id)}`,
    `signature: ${yaml(record.signature)}`,
    `class: ${yaml(record.class)}`,
    `title: ${yaml(record.title)}`,
    `violates: ${yaml(record.violates)}`,
    `scope: ${yaml(record.scope)}`,
    `status: ${yaml(record.status)}`,
    'mechanism_ref: null',
    ...(record.sites.length ? ['sites:', ...record.sites.map(site => `  - ${yaml(site)}`)] : ['sites: []']),
    'episodes: []',
    '---',
    '',
    '## Cue',
    '',
    record.title,
    '',
    '## What happened',
    '',
    `Owner-approved promotion of report candidate \`${candidate.id}\`.`,
    '',
    '## Lesson',
    '',
    record.sourcesNote,
    '',
    '## Evidence',
    '',
    `- Approved by \`${approval.approvedBy}\` at \`${approval.approvedAt}\``,
    `- Report SHA-256: \`${reportHash}\``,
    `- Durable candidate sources: ${sources.map(source => `\`${source}\``).join(', ')}`,
    `- approval-sha256: ${approvalHash}`,
    ''
  ].join('\n');
}

function hash(bytes) {
  return crypto.createHash('sha256').update(bytes).digest('hex');
}

function candidateFrom(report, approval) {
  if (!report || report.schemaVersion !== 1 || !Array.isArray(report.candidates)) {
    problem('report must be a schemaVersion 1 candidate report');
  }
  const matches = report.candidates.filter(item => item && item.id === approval.candidateId);
  if (!matches.length) problem(`approved candidate ${approval.candidateId} is not present in the report`);
  if (matches.length !== 1) problem(`approved candidate ${approval.candidateId} is ambiguous in the report`);
  return matches[0];
}

function nextId(errorsDir, index) {
  let maximum = 0;
  for (const name of fs.readdirSync(errorsDir)) {
    const match = /^E-(\d{4})-/.exec(name);
    if (match) maximum = Math.max(maximum, Number(match[1]));
  }
  try {
    for (const line of fs.readFileSync(index, 'utf8').split(/\r?\n/)) {
      const match = /"id":"E-(\d{4})"/.exec(line);
      if (match) maximum = Math.max(maximum, Number(match[1]));
    }
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  if (maximum >= 9999) problem('no unused E-NNNN ids remain');
  const number = maximum + 1;
  return { id: `E-${String(number).padStart(4, '0')}`, number };
}

function checkDestination(errorsDir, id, signature, lockPath) {
  const file = `${id}-${signature}.md`;
  const destination = path.join(errorsDir, file);
  if (path.dirname(destination) !== errorsDir || !isWithin(errorsDir, destination)) problem('record destination escapes the errors directory');
  if (samePath(destination, lockPath)) problem('record destination conflicts with the promotion lock');
  try {
    const stat = fs.lstatSync(destination);
    if (stat.isSymbolicLink()) problem('record destination is a symlink and may escape the errors directory');
    problem(`record destination already exists: ${file}`);
  } catch (error) {
    if (error.code !== 'ENOENT') {
      if (error.exitCode) throw error;
      problem(`record destination cannot be inspected: ${error.message}`);
    }
  }
  return { file, destination };
}

function preflight(options) {
  const reportBytes = readInput(options.report, 'report');
  const approvalBytes = readInput(options.approval, 'approval');
  const reportHash = hash(reportBytes);
  const approvalHash = hash(approvalBytes);
  const report = readJson(reportBytes, 'report');
  const approval = readJson(approvalBytes, 'approval');
  validateApproval(approval);
  if (reportHash.toLowerCase() !== approval.reportSha256.toLowerCase()) problem('report SHA-256 does not match the approval');
  const candidate = candidateFrom(report, approval);
  if (!durableSources(candidate).length) problem('selected report candidate has no durable source evidence');
  let targetRoot;
  try {
    targetRoot = canonical(path.resolve(options.target));
    if (!fs.statSync(targetRoot).isDirectory()) problem('--target must be a repository directory');
  } catch (error) {
    if (error.exitCode) throw error;
    problem(`--target must be an existing repository directory: ${error.message}`);
  }
  if (!samePath(targetRoot, approval.targetRoot)) problem('approval targetRoot does not match the resolved --target');
  const { errorsDir, index } = directoryInfo(targetRoot);
  const syncScript = harnessTool(options.harness);
  const lockPath = path.join(errorsDir, LOCK);
  try {
    fs.lstatSync(lockPath);
    problem('another promotion is active or a stale .promote.lock remains; verify no promotion is running, then remove it and retry');
  } catch (error) {
    if (error.code !== 'ENOENT') {
      if (error.exitCode) throw error;
      problem(`promotion lock cannot be inspected: ${error.message}`);
    }
  }
  const next = nextId(errorsDir, index);
  const destination = checkDestination(errorsDir, next.id, approval.record.signature, lockPath);
  assertApprovalUnused(errorsDir, approvalHash);
  return { approval, candidate, targetRoot, errorsDir, index, syncScript, lockPath, destination, reportHash, approvalHash };
}

function runSync(script, targetRoot, check) {
  const result = childProcess.spawnSync(process.execPath, [
    script,
    ...(check ? ['--check'] : []),
    '--root', targetRoot
  ], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  if (result.error || result.status !== 0) {
    const detail = (result.stderr || result.error && result.error.message || result.stdout || `exit ${result.status}`).trim();
    throw new Error(`errors-sync${check ? ' --check' : ''} failed: ${detail}`);
  }
}

function savedIndex(index) {
  try {
    const stat = fs.lstatSync(index);
    if (stat.isSymbolicLink() || !stat.isFile()) problem('target index must be a regular file inside the errors directory');
    return { bytes: fs.readFileSync(index), stat };
  } catch (error) {
    if (error.code === 'ENOENT') return { bytes: null, stat: null };
    if (error.exitCode) throw error;
    problem(`target index cannot be saved: ${error.message}`);
  }
}

function restoreIndex(index, saved) {
  try {
    const current = fs.lstatSync(index);
    if (current.isSymbolicLink() || !current.isFile()) throw new Error('index was replaced with a non-regular file');
    if (saved.stat && (current.dev !== saved.stat.dev || current.ino !== saved.stat.ino)) {
      throw new Error('index was replaced by another writer');
    }
    if (saved.bytes === null) fs.unlinkSync(index);
    else fs.writeFileSync(index, saved.bytes);
  } catch (error) {
    if (error.code === 'ENOENT' && saved.bytes === null) return null;
    return error.message;
  }
  return null;
}

function rollback(context, saved, destination, identity, beforeNames) {
  const problems = [];
  if (identity) {
    try {
      const current = fs.lstatSync(destination);
      if (current.dev !== identity.dev || current.ino !== identity.ino || current.isSymbolicLink()) {
        problems.push('new record was replaced by another writer');
      } else fs.unlinkSync(destination);
    } catch (error) {
      if (error.code !== 'ENOENT') problems.push(`new record could not be removed: ${error.message}`);
    }
  }
  const indexProblem = restoreIndex(context.index, saved);
  if (indexProblem) problems.push(indexProblem);
  try {
    if (JSON.stringify(fs.readdirSync(context.errorsDir).filter(name => name !== LOCK).sort()) !== JSON.stringify(beforeNames)) {
      problems.push('errors directory listing differs from its pre-promotion state');
    }
  } catch (error) {
    problems.push(`errors directory state could not be verified: ${error.message}`);
  }
  return problems;
}

function promote(context) {
  let lockFd;
  let lockAcquired = false;
  let destination;
  let identity;
  let saved;
  let beforeNames;
  let indexUpdated = false;
  let syncStarted = false;
  let failure;
  try {
    lockFd = fs.openSync(context.lockPath, 'wx', 0o600);
    lockAcquired = true;
    fs.closeSync(lockFd);
    lockFd = undefined;

    beforeNames = fs.readdirSync(context.errorsDir).filter(name => name !== LOCK).sort();
    saved = savedIndex(context.index);
    assertApprovalUnused(context.errorsDir, context.approvalHash);
    const next = nextId(context.errorsDir, context.index);
    destination = checkDestination(context.errorsDir, next.id, context.approval.record.signature, context.lockPath);
    const text = recordText(context.approval, context.candidate, next.id, context.reportHash, context.approvalHash);
    let recordFd;
    try {
      recordFd = fs.openSync(destination.destination, 'wx', 0o644);
      identity = fs.fstatSync(recordFd);
      fs.writeFileSync(recordFd, text, 'utf8');
      fs.closeSync(recordFd);
      recordFd = undefined;
    } catch (error) {
      if (recordFd !== undefined) fs.closeSync(recordFd);
      if (error.code === 'EEXIST') problem(`record destination already exists: ${destination.file}`);
      throw error;
    }

    syncStarted = true;
    runSync(context.syncScript, context.targetRoot, false);
    runSync(context.syncScript, context.targetRoot, true);
    indexUpdated = true;
  } catch (error) {
    if (error.code === 'EEXIST' && !lockAcquired) {
      failure = Object.assign(new Error('another promotion is active or a stale .promote.lock remains; verify no promotion is running, then remove it and retry'), { exitCode: 2 });
    } else {
      failure = error;
    }
  }

  if (lockFd !== undefined) {
    try { fs.closeSync(lockFd); } catch (_) { /* already closed */ }
  }
  if (lockAcquired) {
    try { fs.unlinkSync(context.lockPath); } catch (error) {
      if (error.code !== 'ENOENT') failure = new Error(`${failure ? `${failure.message}; ` : ''}promotion lock cleanup failed: ${error.message}`);
    }
  }

  if (failure) {
    const rollbackProblems = saved && beforeNames && (identity || syncStarted)
      ? rollback(context, saved, destination && destination.destination, identity, beforeNames)
      : saved && beforeNames
        ? (JSON.stringify(fs.readdirSync(context.errorsDir).filter(name => name !== LOCK).sort()) === JSON.stringify(beforeNames)
          ? [] : ['errors directory listing differs from its pre-promotion state'])
        : [];
    const lockStale = failure.message.includes('promotion lock cleanup failed');
    const detail = rollbackProblems.length || lockStale
      ? `; recovery needed: ${[...rollbackProblems, ...(lockStale ? ['verify no promotion is running, then remove .promote.lock'] : [])].join('; ')}`
      : '; ledger restored to its pre-promotion state';
    problem(`${failure.message}${detail}`, failure.exitCode || 1);
  }

  return {
    ok: true,
    id: path.basename(destination.file).slice(0, 6),
    file: path.posix.join(ERRORS.split(path.sep).join('/'), destination.file),
    indexUpdated
  };
}

function main() {
  const json = process.argv.includes('--json');
  try {
    const result = promote(preflight(parseArgs(process.argv.slice(2))));
    if (json) process.stdout.write(`${JSON.stringify(result)}\n`);
    else process.stdout.write(`Promoted ${result.id} to ${result.file}; target index is current.\n`);
  } catch (error) {
    const payload = { ok: false, error: error.message };
    if (json) process.stdout.write(`${JSON.stringify(payload)}\n`);
    else process.stderr.write(`error-ledger promote: ${error.message}\n`);
    process.exitCode = error.exitCode || 1;
  }
}

if (require.main === module) main();

module.exports = { isWithin };
