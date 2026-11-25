#!/usr/bin/env node
'use strict';
// Local error CLI (#496 C2): add provisional local lessons, list workspace-scoped
// records, and export bounded redacted JSONL for triage / #498 bootstrap input.
// Exit codes: 0 ok, 2 usage/validation error, 1 runtime error.

const crypto = require('node:crypto');
const path = require('node:path');
const localErrors = require(path.join(__dirname, '..', 'hooks', 'scripts', 'lib', 'local-errors.js'));
const observations = require(path.join(__dirname, '..', 'hooks', 'scripts', 'lib', 'observations.js'));

const IDENTIFIER_PATTERN = /^[a-z0-9][a-z0-9_-]{0,63}$/;
const KINDS = new Set(['occurrence', 'provisional-lesson']);
const DESTINATIONS = new Set(localErrors.DESTINATIONS);

class UsageError extends Error {
  constructor(message) {
    super(message);
    this.name = 'UsageError';
  }
}

function usageText() {
  return [
    'Usage:',
    '  node scripts/errors-local.js add (--match-json <json> | --executable <id> --subcommand <id> [--diagnostic <id>...]) --lesson <text> [--cue <text>] [--issue <https-url>] [--destination harness|project|unknown] [--signature <id>] [--promotion-id <E-xxxx>] [--json]',
    '  node scripts/errors-local.js list [--kind occurrence|provisional-lesson] [--destination harness|project|unknown] [--signature <id>] [--limit <n>] [--json]',
    '  node scripts/errors-local.js export [--kind occurrence|provisional-lesson] [--destination harness|project|unknown] [--signature <id>] [--limit <n>]',
  ].join('\n');
}

function requireValue(argv, index, flag) {
  if (index + 1 >= argv.length) throw new UsageError(`missing value for ${flag}`);
  return argv[index + 1];
}

function parseLimit(raw) {
  if (!/^\d+$/.test(String(raw))) throw new UsageError(`invalid --limit: ${raw}`);
  const value = Number.parseInt(raw, 10);
  if (!Number.isSafeInteger(value) || value < 0) throw new UsageError(`invalid --limit: ${raw}`);
  return Math.min(value, localErrors.LIMITS.maxRecordsPerWorkspace);
}

function deriveSignature(match, lesson) {
  const firstRule = (match.failures && match.failures[0]) || (match.actions && match.actions[0]);
  const hash = crypto.createHash('sha256').update(JSON.stringify([match, lesson])).digest('hex').slice(0, 8);
  if (firstRule && firstRule.executable && firstRule.subcommand) {
    const base = `local-${firstRule.executable}-${firstRule.subcommand}-${hash}`;
    if (base.length <= 64 && IDENTIFIER_PATTERN.test(base)) return base;
  }
  return `local-${hash}`;
}

function sanitizeExportRecord(record, env) {
  const limits = localErrors.LIMITS;
  if (!record || typeof record !== 'object') return null;

  if (record.kind === 'provisional-lesson') {
    const out = {
      schemaVersion: record.schemaVersion,
      kind: 'provisional-lesson',
      provisionalId: record.provisionalId,
      workspaceKey: record.workspaceKey,
      destination: record.destination,
      createdAt: record.createdAt,
      signature: record.signature,
      match: record.match,
      lesson: localErrors.redactErrorText(String(record.lesson || ''), env).slice(0, limits.maxLessonChars),
      issueUrl: record.issueUrl ?? null,
      promotionId: record.promotionId ?? null,
    };
    if (typeof record.cue === 'string') {
      out.cue = localErrors.redactErrorText(record.cue, env).slice(0, limits.maxCueChars);
    }
    return out;
  }

  if (record.kind === 'occurrence') {
    const redactedExcerpt = localErrors.redactErrorText(String(record.outputExcerpt || ''), env);
    return {
      schemaVersion: record.schemaVersion,
      kind: 'occurrence',
      provisionalId: record.provisionalId,
      workspaceKey: record.workspaceKey,
      destination: record.destination,
      createdAt: record.createdAt,
      signature: record.signature,
      source: record.source,
      host: record.host,
      sessionKey: record.sessionKey ?? null,
      toolUseId: record.toolUseId ?? null,
      commandClass: record.commandClass,
      exitCode: Number.isInteger(record.exitCode) ? record.exitCode : null,
      outputExcerpt: observations.tailBytes(redactedExcerpt, limits.maxExcerptBytes),
      matchedLedgerIds: Array.isArray(record.matchedLedgerIds) ? record.matchedLedgerIds.slice(0, limits.maxMatchedLedgerIds) : [],
    };
  }

  return null;
}

function parseAddArgs(argv) {
  const opts = {
    matchJson: null,
    executable: null,
    subcommand: null,
    diagnostics: [],
    lesson: null,
    cue: undefined,
    issueUrl: undefined,
    destination: 'unknown',
    signature: null,
    promotionId: undefined,
    json: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--match-json') { opts.matchJson = requireValue(argv, i, arg); i += 1; }
    else if (arg === '--executable') { opts.executable = requireValue(argv, i, arg); i += 1; }
    else if (arg === '--subcommand') { opts.subcommand = requireValue(argv, i, arg); i += 1; }
    else if (arg === '--diagnostic') { opts.diagnostics.push(requireValue(argv, i, arg)); i += 1; }
    else if (arg === '--lesson') { opts.lesson = requireValue(argv, i, arg); i += 1; }
    else if (arg === '--cue') { opts.cue = requireValue(argv, i, arg); i += 1; }
    else if (arg === '--issue') { opts.issueUrl = requireValue(argv, i, arg); i += 1; }
    else if (arg === '--destination') { opts.destination = requireValue(argv, i, arg); i += 1; }
    else if (arg === '--signature') { opts.signature = requireValue(argv, i, arg); i += 1; }
    else if (arg === '--promotion-id') { opts.promotionId = requireValue(argv, i, arg); i += 1; }
    else if (arg === '--json') { opts.json = true; }
    else if (arg === '--help' || arg === '-h') { return { help: true }; }
    else { throw new UsageError(`unknown option for add: ${arg}`); }
  }

  const hasMatchJson = opts.matchJson !== null;
  const hasFlagRule = opts.executable !== null || opts.subcommand !== null || opts.diagnostics.length > 0;
  if (hasMatchJson && hasFlagRule) {
    throw new UsageError('use either --match-json or --executable/--subcommand[/--diagnostic], not both');
  }
  if (!hasMatchJson && !hasFlagRule) {
    throw new UsageError('match rule required: provide --match-json or --executable and --subcommand');
  }

  let match;
  if (hasMatchJson) {
    try {
      match = JSON.parse(opts.matchJson);
    } catch (error) {
      throw new UsageError(`invalid --match-json: ${error.message}`);
    }
  } else {
    if (!opts.executable || !opts.subcommand) {
      throw new UsageError('both --executable and --subcommand are required');
    }
    if (opts.diagnostics.length > 0) {
      match = {
        failures: [{
          tool: 'shell',
          executable: opts.executable,
          subcommand: opts.subcommand,
          diagnostics: opts.diagnostics,
        }],
      };
    } else {
      match = {
        actions: [{
          tool: 'shell',
          executable: opts.executable,
          subcommand: opts.subcommand,
        }],
      };
    }
  }

  try {
    match = localErrors.validateMatch(match);
  } catch (error) {
    throw new UsageError(error.message);
  }

  if (typeof opts.lesson !== 'string' || !opts.lesson.trim()) {
    throw new UsageError('--lesson is required and must be non-empty');
  }
  if (!DESTINATIONS.has(opts.destination)) {
    throw new UsageError(`invalid --destination: ${opts.destination} (expected harness|project|unknown)`);
  }

  const signature = opts.signature || deriveSignature(match, opts.lesson.trim());
  if (!IDENTIFIER_PATTERN.test(signature)) {
    throw new UsageError(`invalid --signature: ${signature}`);
  }

  return { ...opts, match, signature };
}

function parseQueryArgs(subcommand, argv, allowJson) {
  const opts = {
    kind: null,
    destination: null,
    signature: null,
    limit: localErrors.LIMITS.maxRecordsPerWorkspace,
    json: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--kind') {
      const value = requireValue(argv, i, arg);
      if (!KINDS.has(value)) throw new UsageError(`invalid --kind: ${value} (expected occurrence|provisional-lesson)`);
      opts.kind = value;
      i += 1;
    } else if (arg === '--destination') {
      const value = requireValue(argv, i, arg);
      if (!DESTINATIONS.has(value)) throw new UsageError(`invalid --destination: ${value} (expected harness|project|unknown)`);
      opts.destination = value;
      i += 1;
    } else if (arg === '--signature') {
      opts.signature = requireValue(argv, i, arg);
      i += 1;
    } else if (arg === '--limit') {
      opts.limit = parseLimit(requireValue(argv, i, arg));
      i += 1;
    } else if (allowJson && arg === '--json') {
      opts.json = true;
    } else if (arg === '--help' || arg === '-h') {
      return { help: true };
    } else {
      throw new UsageError(`unknown option for ${subcommand}: ${arg}`);
    }
  }

  return opts;
}

function handleAdd(argv, env, cwd) {
  const opts = parseAddArgs(argv);
  if (opts.help) {
    process.stdout.write(`${usageText()}\n`);
    return 0;
  }

  let res;
  try {
    res = localErrors.addProvisionalLesson({
      workspaceRoot: cwd,
      destination: opts.destination,
      signature: opts.signature,
      match: opts.match,
      lesson: opts.lesson,
      ...(opts.cue !== undefined ? { cue: opts.cue } : {}),
      ...(opts.issueUrl !== undefined ? { issueUrl: opts.issueUrl } : {}),
      ...(opts.promotionId !== undefined ? { promotionId: opts.promotionId } : {}),
    }, { env });
  } catch (error) {
    throw new UsageError(error && error.message ? error.message : String(error));
  }

  if (res.status === 'lock-timeout' || !res.record) {
    process.stderr.write(`error: could not acquire local error store lock\n`);
    return 1;
  }

  const sanitized = sanitizeExportRecord(res.record, env);
  if (opts.json) {
    process.stdout.write(`${JSON.stringify({ status: res.status, record: sanitized })}\n`);
  } else {
    process.stdout.write(`${res.status} ${sanitized.provisionalId} ${sanitized.signature} (${sanitized.destination})\n`);
  }
  return 0;
}

function handleList(argv, env, cwd) {
  const opts = parseQueryArgs('list', argv, true);
  if (opts.help) {
    process.stdout.write(`${usageText()}\n`);
    return 0;
  }

  const records = localErrors.listRecords({
    env,
    workspaceRoot: cwd,
    ...(opts.kind ? { kind: opts.kind } : {}),
    ...(opts.destination ? { destination: opts.destination } : {}),
    ...(opts.signature ? { signature: opts.signature } : {}),
    limit: opts.limit,
  }).map(r => sanitizeExportRecord(r, env)).filter(Boolean);

  if (opts.json) {
    process.stdout.write(`${JSON.stringify(records)}\n`);
    return 0;
  }

  for (const record of records) {
    const summary = record.kind === 'provisional-lesson'
      ? record.lesson.replace(/\s+/g, ' ').slice(0, 120)
      : `${record.commandClass} exit=${record.exitCode === null ? 'unknown' : record.exitCode}`;
    process.stdout.write(`${record.provisionalId}\t${record.kind}\t${record.destination}\t${record.signature}\t${summary}\n`);
  }
  return 0;
}

function handleExport(argv, env, cwd) {
  const opts = parseQueryArgs('export', argv, false);
  if (opts.help) {
    process.stdout.write(`${usageText()}\n`);
    return 0;
  }

  const records = localErrors.listRecords({
    env,
    workspaceRoot: cwd,
    ...(opts.kind ? { kind: opts.kind } : {}),
    ...(opts.destination ? { destination: opts.destination } : {}),
    ...(opts.signature ? { signature: opts.signature } : {}),
    limit: opts.limit,
  }).map(r => sanitizeExportRecord(r, env)).filter(Boolean);

  for (const record of records) {
    process.stdout.write(`${JSON.stringify(record)}\n`);
  }
  return 0;
}

function main(argv = process.argv.slice(2), env = process.env, cwd = process.cwd()) {
  try {
    const [subcommand, ...rest] = argv;
    if (!subcommand || subcommand === '--help' || subcommand === '-h') {
      process.stdout.write(`${usageText()}\n`);
      return subcommand ? 0 : 2;
    }
    if (subcommand === 'add') return handleAdd(rest, env, cwd);
    if (subcommand === 'list') return handleList(rest, env, cwd);
    if (subcommand === 'export') return handleExport(rest, env, cwd);
    throw new UsageError(`unknown subcommand: ${subcommand}`);
  } catch (error) {
    if (error instanceof UsageError) {
      process.stderr.write(`usage error: ${error.message}\n`);
      return 2;
    }
    process.stderr.write(`error: ${error && error.message ? error.message : String(error)}\n`);
    return 1;
  }
}

if (require.main === module) {
  process.exit(main());
}

module.exports = { main, sanitizeExportRecord };
