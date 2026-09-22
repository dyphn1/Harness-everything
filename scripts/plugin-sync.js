#!/usr/bin/env node
'use strict';

/**
 * Synchronize the native Harness Everything plugin on Claude Code and Codex.
 *
 * This is deliberately separate from installer.js: installer.js manages the
 * portable skills layout, while this command talks to each host's native
 * marketplace/plugin CLI. The installed-state branch is intentionally
 * explicit: an existing plugin is updated, never silently re-added.
 */

const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const DEFAULTS = Object.freeze({
  marketplace: 'harness-everything',
  plugin: 'harness-everything',
  repository: process.env.HARNESS_PLUGIN_REPOSITORY || 'dyphn1/Harness-everything',
  ref: process.env.HARNESS_PLUGIN_REF || 'main'
});

// Windows CLIs that ship as a .cmd/.bat shim are not executable via the same
// direct CreateProcess call Node uses for a .exe, and — unlike a real shell —
// Node's non-shell spawnSync does not search PATHEXT-suffixed candidates for
// a bare command name at all. When more than one `codex`/`claude` is on
// PATH (an npm shim plus a separately installed .exe is a common pairing),
// the non-shell spawn silently resolves whichever entry happens to be a real
// .exe, regardless of PATH order — so an unrelated, older standalone install
// can shadow a newer npm-updated shim with no error to signal it.
//
// resolveOnPath() replicates what a real shell / `where.exe` does instead:
// walk PATH directories in order, and within each directory try PATHEXT
// extensions in order, returning the first match. Directory order wins over
// extension preference, exactly like cmd.exe and PowerShell's own lookup, so
// the result matches what typing the command in a terminal would run.
function resolveOnPath(command, { pathValue = process.env.PATH || process.env.Path || '', pathExt = process.env.PATHEXT || '.COM;.EXE;.BAT;.CMD' } = {}) {
  if (path.isAbsolute(command)) return fs.existsSync(command) ? command : null;

  const dirs = pathValue.split(path.delimiter).filter(Boolean);
  const extensions = pathExt.split(';').map(ext => ext.trim()).filter(Boolean);
  const hasKnownExtension = extensions.some(ext => command.toLowerCase().endsWith(ext.toLowerCase()));

  for (const dir of dirs) {
    if (hasKnownExtension) {
      const candidate = path.join(dir, command);
      if (fs.existsSync(candidate)) return candidate;
      continue;
    }
    for (const ext of extensions) {
      const candidate = path.join(dir, command + ext);
      if (fs.existsSync(candidate)) return candidate;
    }
  }
  return null;
}

// A .bat/.cmd target is not a Win32 executable image; Windows requires the
// cmd.exe interpreter to run one at all, the same way a shebang-less script
// needs an explicit interpreter on POSIX. This is the one case a shell is
// unavoidable, and only that resolved file is passed to it — never the bare
// command name or user-controlled arguments re-interpreted as a command line.
const SHELL_REQUIRED_EXTENSIONS = new Set(['.bat', '.cmd']);

function runResolved(resolved, args, options) {
  const ext = path.extname(resolved).toLowerCase();
  if (SHELL_REQUIRED_EXTENSIONS.has(ext)) {
    const comspec = process.env.ComSpec || process.env.COMSPEC || 'cmd.exe';
    return spawnSync(comspec, ['/d', '/c', resolved, ...args], options);
  }
  return spawnSync(resolved, args, options);
}

function defaultRunner(command, args) {
  const options = {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true
  };

  if (process.platform === 'win32') {
    const resolved = resolveOnPath(command);
    if (resolved) {
      const result = runResolved(resolved, args, options);
      return {
        status: result.status === null ? 1 : result.status,
        stdout: result.stdout || '',
        stderr: result.stderr || '',
        error: result.error || null
      };
    }
  }

  let result = spawnSync(command, args, options);

  // Resolution above only checks the filesystem; if PATH itself could not be
  // read, or the command is reachable through a mechanism resolveOnPath does
  // not model (e.g. an App Execution Alias), fall back to letting the shell
  // do its own resolution rather than failing outright.
  if (process.platform === 'win32' && result.error && ['EACCES', 'EINVAL', 'ENOENT'].includes(result.error.code)) {
    const comspec = process.env.ComSpec || process.env.COMSPEC || 'cmd.exe';
    result = spawnSync(comspec, ['/d', '/c', command, ...args], options);
  }

  return {
    status: result.status === null ? 1 : result.status,
    stdout: result.stdout || '',
    stderr: result.stderr || '',
    error: result.error || null
  };
}

function shellQuote(value) {
  const text = String(value);
  return /^[A-Za-z0-9_./:@%+=,-]+$/.test(text) ? text : JSON.stringify(text);
}

function commandLine(command, args) {
  return [command, ...args].map(shellQuote).join(' ');
}

function parseJsonOutput(output) {
  const text = String(output || '').trim();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch (_) {
    // Some host versions print a short status line before one-line JSON.
    const lines = text.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
    for (let index = lines.length - 1; index >= 0; index--) {
      try {
        return JSON.parse(lines[index]);
      } catch (__) {
        // Keep looking for the machine-readable line.
      }
    }
  }
  return null;
}

function collectObjects(value, out = [], keyHint = '') {
  if (Array.isArray(value)) {
    value.forEach((entry, index) => collectObjects(entry, out, String(index)));
  } else if (value && typeof value === 'object') {
    out.push({ value, keyHint });
    for (const [key, child] of Object.entries(value)) collectObjects(child, out, key);
  }
  return out;
}

function collectStrings(value, out = []) {
  if (typeof value === 'string') out.push(value);
  else if (Array.isArray(value)) value.forEach(entry => collectStrings(entry, out));
  else if (value && typeof value === 'object') Object.values(value).forEach(entry => collectStrings(entry, out));
  return out;
}

function exactString(value, expected) {
  return typeof value === 'string' && value.trim() === expected;
}

function findMarketplace(payload, marketplace) {
  if (collectStrings(payload).some(value => exactString(value, marketplace))) return true;
  return collectObjects(payload).some(({ value }) => {
    const candidates = [
      value.name,
      value.marketplace,
      value.marketplaceName,
      value.slug,
      value.id,
      value.source && value.source.name,
      value.source && value.source.id
    ];
    return candidates.some(candidate => exactString(candidate, marketplace));
  });
}

function findPlugin(payload, plugin, marketplace) {
  const pluginId = `${plugin}@${marketplace}`;
  return collectStrings(payload).some(value => value.trim() === pluginId) || collectObjects(payload).some(({ value, keyHint }) => {
    const identifiers = [value.id, value.pluginId, value.identifier, keyHint];
    if (identifiers.some(candidate => exactString(candidate, pluginId))) return true;
    const names = [value.name, value.plugin, value.pluginName];
    if (!names.some(candidate => exactString(candidate, plugin))) return false;
    const sources = [
      value.marketplace,
      value.marketplaceName,
      value.source && value.source.name,
      value.source && value.source.id
    ].filter(Boolean);
    return sources.length === 0 || sources.some(source => exactString(source, marketplace));
  });
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function textHasMarketplace(output, marketplace) {
  const expression = new RegExp(`(^|[\\s"'])${escapeRegExp(marketplace)}($|[\\s"'@])`, 'm');
  return expression.test(String(output || ''));
}

function textHasPlugin(output, plugin, marketplace) {
  const text = String(output || '');
  if (text.includes(`${plugin}@${marketplace}`)) return true;
  const expression = new RegExp(`(^|[\\s"'])${escapeRegExp(plugin)}($|[\\s"'@])`, 'm');
  return expression.test(text);
}

function resultError(result) {
  const detail = [result && result.stderr, result && result.stdout, result && result.error && result.error.message]
    .map(value => String(value || '').trim())
    .find(Boolean);
  return detail || `exit status ${result && result.status !== undefined ? result.status : 'unknown'}`;
}

function createContext(options = {}) {
  const runner = options.runner || defaultRunner;
  const log = options.log || (message => console.log(message));
  const warn = options.warn || (message => console.warn(message));
  const context = {
    ...DEFAULTS,
    ...options,
    runner,
    log,
    warn,
    dryRun: Boolean(options.dryRun),
    commandAvailable: options.commandAvailable || (command => {
      const result = runner(command, ['--version'], { probe: true });
      return result && result.status === 0 && !result.error;
    })
  };
  context.repositorySource = options.repositorySource || (
    /^https?:\/\//.test(context.repository) || /^git@/.test(context.repository)
      ? context.repository
      : `https://github.com/${context.repository}.git`
  );
  return context;
}

function invoke(context, command, args, { mutate = false, label = command, warnOnFailure = true } = {}) {
  const rendered = commandLine(command, args);
  if (mutate && context.dryRun) {
    context.log(`[dry-run] ${rendered}`);
    return { status: 0, stdout: '', stderr: '', dryRun: true };
  }
  const result = context.runner(command, args, { label });
  if (warnOnFailure && (!result || result.status !== 0)) {
    context.warn(`[failed] ${rendered}\n  ${resultError(result)}`);
  }
  return result || { status: 1, stdout: '', stderr: 'runner returned no result' };
}

function query(context, command, args) {
  return context.runner(command, args, { query: true }) || { status: 1, stdout: '', stderr: 'runner returned no result' };
}

function resultText(result) {
  return [result && result.stderr, result && result.stdout, result && result.error && result.error.message]
    .map(value => String(value || ''))
    .join('\n');
}

// Host CLIs disagree on how they reject an option they never implemented:
// commander-based CLIs (Claude) say "unknown option '--json'", while
// clap-based CLIs (Codex) say "unexpected argument '--json' found". Both mean
// the same thing, so compatibility retries must recognize either wording.
function hasUnsupportedOption(result, option) {
  const output = resultText(result);
  const name = escapeRegExp(option);
  return [
    `unknown option\\s+['"]?${name}['"]?`,
    `unrecognized option\\s+['"]?${name}['"]?`,
    `unexpected argument\\s+['"]?${name}['"]?`,
    `found argument\\s+['"]?${name}['"]?`
  ].some(pattern => new RegExp(pattern, 'i').test(output));
}

// A host build that never shipped the subcommand is a capability boundary, not
// a transient failure, so it must be reported differently from a broken call.
function hasUnsupportedSubcommand(result, subcommand) {
  const expression = new RegExp(
    `(unrecognized|unknown|invalid)\\s+(sub)?command\\s+['"]?${escapeRegExp(subcommand)}['"]?`,
    'i'
  );
  return expression.test(resultText(result));
}

// Optional arguments are dropped one at a time so a host that implements only
// some of them still reaches a command it accepts.
function runHostMutation(context, command, baseArgs, optionalArgs, label) {
  let args = [...baseArgs, ...optionalArgs];
  let attempt = 0;

  while (true) {
    const result = invoke(context, command, args, {
      mutate: true,
      label: attempt === 0 ? label : `${label} compatibility retry`,
      warnOnFailure: false
    });
    if (result.status === 0) return result;

    const unsupported = optionalArgs.find(option => args.includes(option) && hasUnsupportedOption(result, option));
    if (!unsupported) {
      context.warn(`[failed] ${commandLine(command, args)}\n  ${resultError(result)}`);
      return result;
    }

    args = args.filter(arg => arg !== unsupported);
    attempt += 1;
    context.warn(`[notice] ${command} CLI does not support ${unsupported}; retrying ${label} without that option.`);
  }
}

function runClaudePluginMutation(context, action, pluginId) {
  return runHostMutation(
    context,
    'claude',
    ['plugin', action, pluginId, '--scope', 'user'],
    ['--yes', '--json'],
    `claude plugin ${action}`
  );
}

function listState(context, { command, jsonArgs, plainArgs, detectJson, detectText }) {
  const jsonResult = query(context, command, jsonArgs);
  if (jsonResult.status === 0) {
    const payload = parseJsonOutput(jsonResult.stdout);
    if (payload !== null) return { known: true, value: detectJson(payload), result: jsonResult };
  }

  const plainResult = query(context, command, plainArgs);
  if (plainResult.status === 0 && String(plainResult.stdout || '').trim()) {
    return { known: true, value: detectText(plainResult.stdout), result: plainResult };
  }

  return {
    known: false,
    value: false,
    attempts: [jsonResult, plainResult],
    error: `${resultError(jsonResult)}; fallback: ${resultError(plainResult)}`
  };
}

function queryClaudeMarketplace(context) {
  return listState(context, {
    command: 'claude',
    jsonArgs: ['plugin', 'marketplace', 'list', '--json'],
    plainArgs: ['plugin', 'marketplace', 'list'],
    detectJson: payload => findMarketplace(payload, context.marketplace),
    detectText: output => textHasMarketplace(output, context.marketplace)
  });
}

function queryClaudePlugin(context) {
  return listState(context, {
    command: 'claude',
    jsonArgs: ['plugin', 'list', '--json'],
    plainArgs: ['plugin', 'list'],
    detectJson: payload => findPlugin(payload, context.plugin, context.marketplace),
    detectText: output => textHasPlugin(output, context.plugin, context.marketplace)
  });
}

function queryCodexMarketplace(context) {
  return listState(context, {
    command: 'codex',
    jsonArgs: ['plugin', 'marketplace', 'list', '--json'],
    plainArgs: ['plugin', 'marketplace', 'list'],
    detectJson: payload => findMarketplace(payload, context.marketplace),
    detectText: output => textHasMarketplace(output, context.marketplace)
  });
}

function queryCodexPlugin(context) {
  const state = listState(context, {
    command: 'codex',
    jsonArgs: ['plugin', 'list', '--marketplace', context.marketplace, '--json'],
    plainArgs: ['plugin', 'list', '--marketplace', context.marketplace],
    detectJson: payload => findPlugin(payload, context.plugin, context.marketplace),
    detectText: output => textHasPlugin(output, context.plugin, context.marketplace)
  });
  if (state.known) return state;

  // Older Codex builds may not accept --marketplace on plugin list. A full
  // list still lets us fail closed while supporting those builds when JSON is
  // available.
  return listState(context, {
    command: 'codex',
    jsonArgs: ['plugin', 'list', '--json'],
    plainArgs: ['plugin', 'list'],
    detectJson: payload => findPlugin(payload, context.plugin, context.marketplace),
    detectText: output => textHasPlugin(output, context.plugin, context.marketplace)
  });
}

function ensureClaudeMarketplace(context) {
  const state = queryClaudeMarketplace(context);
  if (!state.known) context.warn(`[notice] Claude marketplace state is unavailable; ensuring ${context.marketplace} is configured.`);
  if (!state.known || !state.value) {
    const added = invoke(context, 'claude', [
      'plugin', 'marketplace', 'add', context.repository,
      '--scope', 'user'
    ], { mutate: true, label: 'claude marketplace add' });
    if (added.status !== 0) return { ok: false, error: resultError(added) };
  }
  return { ok: true };
}

function ensureCodexMarketplace(context) {
  const state = queryCodexMarketplace(context);
  if (!state.known) context.warn(`[notice] Codex marketplace state is unavailable; ensuring ${context.marketplace} is configured.`);
  if (!state.known || !state.value) {
    const added = runHostMutation(
      context,
      'codex',
      ['plugin', 'marketplace', 'add', context.repositorySource, '--ref', context.ref],
      ['--json'],
      'codex marketplace add'
    );
    if (added.status !== 0) return { ok: false, error: resultError(added) };
  }
  return { ok: true };
}

function refreshClaudeMarketplace(context) {
  const updated = invoke(context, 'claude', [
    'plugin', 'marketplace', 'update', context.marketplace
  ], { mutate: true, label: 'claude marketplace update' });
  return updated.status === 0
    ? { ok: true }
    : { ok: false, error: resultError(updated) };
}

function refreshCodexMarketplace(context) {
  const upgraded = runHostMutation(
    context,
    'codex',
    ['plugin', 'marketplace', 'upgrade', context.marketplace],
    ['--json'],
    'codex marketplace upgrade'
  );
  return upgraded.status === 0
    ? { ok: true }
    : { ok: false, error: resultError(upgraded) };
}

function verifyPlugin(context, host, queryPlugin) {
  if (context.dryRun) return { ok: true, skipped: true };
  const state = queryPlugin(context);
  if (!state.known) return { ok: false, error: `${host} plugin state could not be verified: ${state.error}` };
  if (!state.value) return { ok: false, error: `${host} reports ${context.plugin}@${context.marketplace} is not installed after synchronization` };
  return { ok: true };
}

function syncClaude(context) {
  if (!context.commandAvailable('claude')) return { host: 'claude', status: 'skipped', reasonCode: 'cli-not-found', reason: 'claude CLI not found' };
  const marketplace = ensureClaudeMarketplace(context);
  if (!marketplace.ok) return { host: 'claude', status: 'failed', error: marketplace.error };
  const installed = queryClaudePlugin(context);
  if (!installed.known) return { host: 'claude', status: 'failed', error: `Claude plugin state could not be determined: ${installed.error}` };
  const refreshed = refreshClaudeMarketplace(context);
  if (!refreshed.ok) return { host: 'claude', status: 'failed', error: refreshed.error };

  const action = installed.value ? 'update' : 'install';
  const result = runClaudePluginMutation(
    context,
    action,
    `${context.plugin}@${context.marketplace}`
  );
  if (result.status !== 0) return { host: 'claude', status: 'failed', error: resultError(result) };

  const verification = verifyPlugin(context, 'Claude', queryClaudePlugin);
  if (!verification.ok) return { host: 'claude', status: 'failed', error: verification.error };
  return { host: 'claude', status: 'synchronized', action };
}

function syncCodex(context) {
  if (!context.commandAvailable('codex')) return { host: 'codex', status: 'skipped', reasonCode: 'cli-not-found', reason: 'codex CLI not found' };
  const marketplace = ensureCodexMarketplace(context);
  if (!marketplace.ok) return { host: 'codex', status: 'failed', error: marketplace.error };
  const installed = queryCodexPlugin(context);
  if (!installed.known) {
    // A Codex build that ships only `codex plugin marketplace` cannot report
    // or change plugin state at all. The marketplace source is now registered,
    // which is everything this build supports, so report the host boundary
    // instead of a generic failure.
    if ((installed.attempts || []).some(attempt => hasUnsupportedSubcommand(attempt, 'list'))) {
      return {
        host: 'codex',
        status: 'skipped',
        reasonCode: 'host-capability-boundary',
        reason: `this Codex CLI has no \`codex plugin list\` command, so plugin state cannot be read; ${context.marketplace} is registered as a marketplace source — enable the plugin from Codex, or upgrade the Codex CLI to a build that ships \`codex plugin list\`/\`codex plugin add\``
      };
    }
    return { host: 'codex', status: 'failed', error: `Codex plugin state could not be determined: ${installed.error}` };
  }

  let action;
  let result;
  if (installed.value) {
    // Codex currently refreshes an installed marketplace plugin through the
    // marketplace upgrade command. Do not fall back to `plugin add` here:
    // an installed plugin must take the update path.
    action = 'update';
    result = refreshCodexMarketplace(context);
    if (result.ok) result = { status: 0, stdout: '', stderr: '' };
    else result = { status: 1, stdout: '', stderr: result.error };
  } else {
    action = 'install';
    result = refreshCodexMarketplace(context);
    if (result.ok) {
      result = runHostMutation(
        context,
        'codex',
        ['plugin', 'add', `${context.plugin}@${context.marketplace}`],
        ['--json'],
        'codex plugin install'
      );
    } else {
      result = { status: 1, stdout: '', stderr: result.error };
    }
  }
  if (result.status !== 0) return { host: 'codex', status: 'failed', error: resultError(result) };

  const verification = verifyPlugin(context, 'Codex', queryCodexPlugin);
  if (!verification.ok) return { host: 'codex', status: 'failed', error: verification.error };
  return { host: 'codex', status: 'synchronized', action };
}

function parseArgs(argv) {
  const options = { host: 'all', dryRun: false, json: false };
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];
    if (arg === '--help' || arg === '-h') options.help = true;
    else if (arg === '--dry-run') options.dryRun = true;
    else if (arg === '--json') options.json = true;
    else if (arg === '--host') {
      options.host = argv[++index];
      if (!options.host) throw new Error('--host requires all, claude, or codex');
    } else if (arg === '--repository') {
      options.repository = argv[++index];
      if (!options.repository) throw new Error('--repository requires a repository or URL');
    } else if (arg === '--ref') {
      options.ref = argv[++index];
      if (!options.ref) throw new Error('--ref requires a git ref');
    } else {
      throw new Error(`Unknown option: ${arg}`);
    }
  }
  options.host = String(options.host).toLowerCase();
  if (!['all', 'claude', 'codex'].includes(options.host)) throw new Error(`Unsupported host: ${options.host}`);
  return options;
}

function help() {
  return `Usage: node scripts/plugin-sync.js [options]

Synchronize the native Harness Everything plugin on installed host CLIs.
Existing installations take the explicit update/upgrade path; absent
installations take the install path.

Options:
  --host <all|claude|codex>  Limit synchronization to one host (default: all)
  --repository <repo|url>   Marketplace source (default: dyphn1/Harness-everything)
  --ref <git-ref>           Codex marketplace ref (default: main)
  --dry-run                 Detect state and print mutating commands
  --json                    Print a machine-readable summary
  -h, --help                Show this help
`;
}

function sync(options, dependencies = {}) {
  const context = createContext({ ...options, ...dependencies });
  const hosts = context.host === 'all' ? ['claude', 'codex'] : [context.host];
  // Each host sync is fully synchronous and the marketplace update/refresh
  // step does real network I/O (observed ~10s+ for Claude alone), so without
  // this the terminal stays completely silent until every host finishes —
  // indistinguishable from a hang. This goes to stderr (context.warn), not
  // stdout, so `--json` consumers' stdout stays pure JSON.
  const results = hosts.map(host => {
    context.warn(`[...] ${host}: syncing`);
    return host === 'claude' ? syncClaude(context) : syncCodex(context);
  });
  const summary = {
    repository: context.repository,
    marketplace: context.marketplace,
    plugin: context.plugin,
    dryRun: context.dryRun,
    results,
    synchronized: results.filter(result => result.status === 'synchronized').length,
    skipped: results.filter(result => result.status === 'skipped').length,
    failed: results.filter(result => result.status === 'failed').length
  };
  return summary;
}

function main(argv = process.argv.slice(2)) {
  let options;
  try {
    options = parseArgs(argv);
  } catch (error) {
    console.error(`[Error] ${error.message}`);
    console.error(help());
    return 2;
  }
  if (options.help) {
    console.log(help());
    return 0;
  }

  const summary = sync(options);
  if (options.json) console.log(JSON.stringify(summary, null, 2));
  else {
    for (const result of summary.results) {
      if (result.status === 'synchronized') console.log(`[ok] ${result.host}: ${result.action}`);
      else if (result.status === 'skipped') console.log(`[skip] ${result.host}: ${result.reason}`);
      else console.error(`[fail] ${result.host}: ${result.error}`);
    }
    if (summary.synchronized === 0 && summary.failed === 0) {
      console.error(summary.results.every(result => result.reasonCode === 'cli-not-found')
        ? 'No supported host CLI was found. Install Claude Code and/or Codex, then retry.'
        : 'No host plugin was synchronized. Review the skip reasons above.');
    }
  }
  return summary.failed > 0 || summary.synchronized === 0 ? 1 : 0;
}

if (require.main === module) process.exitCode = main();

module.exports = {
  DEFAULTS,
  commandLine,
  createContext,
  findMarketplace,
  findPlugin,
  main,
  parseArgs,
  parseJsonOutput,
  resolveOnPath,
  sync,
  textHasMarketplace,
  textHasPlugin
};
