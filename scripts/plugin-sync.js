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

const DEFAULTS = Object.freeze({
  marketplace: 'harness-everything',
  plugin: 'harness-everything',
  repository: process.env.HARNESS_PLUGIN_REPOSITORY || 'dyphn1/Harness-everything',
  ref: process.env.HARNESS_PLUGIN_REF || 'main'
});

function defaultRunner(command, args) {
  const result = spawnSync(command, args, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true
  });
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

function invoke(context, command, args, { mutate = false, label = command } = {}) {
  const rendered = commandLine(command, args);
  if (mutate && context.dryRun) {
    context.log(`[dry-run] ${rendered}`);
    return { status: 0, stdout: '', stderr: '', dryRun: true };
  }
  const result = context.runner(command, args, { label });
  if (!result || result.status !== 0) {
    context.warn(`[failed] ${rendered}\n  ${resultError(result)}`);
  }
  return result || { status: 1, stdout: '', stderr: 'runner returned no result' };
}

function query(context, command, args) {
  return context.runner(command, args, { query: true }) || { status: 1, stdout: '', stderr: 'runner returned no result' };
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
    const added = invoke(context, 'codex', [
      'plugin', 'marketplace', 'add', context.repositorySource,
      '--ref', context.ref,
      '--json'
    ], { mutate: true, label: 'codex marketplace add' });
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
  const upgraded = invoke(context, 'codex', [
    'plugin', 'marketplace', 'upgrade', context.marketplace,
    '--json'
  ], { mutate: true, label: 'codex marketplace upgrade' });
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
  if (!context.commandAvailable('claude')) return { host: 'claude', status: 'skipped', reason: 'claude CLI not found' };
  const marketplace = ensureClaudeMarketplace(context);
  if (!marketplace.ok) return { host: 'claude', status: 'failed', error: marketplace.error };
  const installed = queryClaudePlugin(context);
  if (!installed.known) return { host: 'claude', status: 'failed', error: `Claude plugin state could not be determined: ${installed.error}` };
  const refreshed = refreshClaudeMarketplace(context);
  if (!refreshed.ok) return { host: 'claude', status: 'failed', error: refreshed.error };

  const action = installed.value ? 'update' : 'install';
  const result = invoke(context, 'claude', [
    'plugin', action, `${context.plugin}@${context.marketplace}`,
    '--scope', 'user', '--yes', '--json'
  ], { mutate: true, label: `claude plugin ${action}` });
  if (result.status !== 0) return { host: 'claude', status: 'failed', error: resultError(result) };

  const verification = verifyPlugin(context, 'Claude', queryClaudePlugin);
  if (!verification.ok) return { host: 'claude', status: 'failed', error: verification.error };
  return { host: 'claude', status: 'synchronized', action };
}

function syncCodex(context) {
  if (!context.commandAvailable('codex')) return { host: 'codex', status: 'skipped', reason: 'codex CLI not found' };
  const marketplace = ensureCodexMarketplace(context);
  if (!marketplace.ok) return { host: 'codex', status: 'failed', error: marketplace.error };
  const installed = queryCodexPlugin(context);
  if (!installed.known) return { host: 'codex', status: 'failed', error: `Codex plugin state could not be determined: ${installed.error}` };

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
      result = invoke(context, 'codex', [
        'plugin', 'add', `${context.plugin}@${context.marketplace}`, '--json'
      ], { mutate: true, label: 'codex plugin install' });
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
  const results = hosts.map(host => host === 'claude' ? syncClaude(context) : syncCodex(context));
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
      console.error('No supported host CLI was found. Install Claude Code and/or Codex, then retry.');
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
  sync,
  textHasMarketplace,
  textHasPlugin
};
