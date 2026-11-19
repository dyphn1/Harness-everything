#!/usr/bin/env node
'use strict';

const crypto = require('node:crypto');
const childProcess = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const USAGE = 'usage: node scan.js --root <repo> [--out <dir>] [--no-memory] [--memory <path>]... [--instructions <path>]... [--tracker <file.json>]... [--hide-ledger] [--home <dir>] [--json]';
const HASH = /^[0-9a-f]{40}$/i;
const SOURCE_STATUSES = new Set(['used', 'missing', 'disabled', 'unverified']);

function failure(message, exitCode = 2) {
  const error = new Error(message);
  error.exitCode = exitCode;
  throw error;
}

function parseArgs(args) {
  const options = { memory: [], instructions: [], tracker: [], noMemory: false, hideLedger: false, json: false };
  const seen = new Set();
  const values = new Set(['--root', '--out', '--home', '--memory', '--instructions', '--tracker']);
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--no-memory' || arg === '--hide-ledger' || arg === '--json') {
      if (seen.has(arg)) failure(`duplicate option: ${arg}`);
      seen.add(arg);
      if (arg === '--no-memory') options.noMemory = true;
      if (arg === '--hide-ledger') options.hideLedger = true;
      if (arg === '--json') options.json = true;
      continue;
    }
    if (!values.has(arg)) failure(`unknown option: ${arg}`);
    if (i + 1 >= args.length || args[i + 1].startsWith('--')) failure(`missing value for ${arg}`);
    const value = args[++i];
    if (arg === '--memory' || arg === '--instructions' || arg === '--tracker') {
      options[arg.slice(2)].push(value);
      continue;
    }
    if (seen.has(arg)) failure(`duplicate option: ${arg}`);
    seen.add(arg);
    options[arg.slice(2)] = value;
  }
  if (!options.root) failure(`--root is required; ${USAGE}`);
  return options;
}

function git(root, args, encoding = 'utf8', exitCode = 1) {
  try {
    return childProcess.execFileSync('git', ['-C', root, ...args], { encoding, stdio: ['ignore', 'pipe', 'pipe'] });
  } catch (cause) {
    failure(`git ${args[0] || 'command'} failed for the target repository`, exitCode);
  }
}

function canonical(file) {
  return fs.realpathSync.native ? fs.realpathSync.native(file) : fs.realpathSync(file);
}

function isWithin(root, candidate, pathApi) {
  const api = pathApi || (process.platform === 'win32' ? path.win32 : path);
  const windows = api === path.win32 || (!pathApi && process.platform === 'win32');
  const comparisonRoot = windows ? root.toLowerCase() : root;
  const comparisonCandidate = windows ? candidate.toLowerCase() : candidate;
  const relative = api.relative(comparisonRoot, comparisonCandidate);
  return relative === '' || (!api.isAbsolute(relative) && relative !== '..' && !relative.startsWith(`..${api.sep}`));
}

function resolveWithSymlinks(candidate) {
  let current = path.resolve(candidate);
  const suffix = [];
  while (true) {
    try {
      fs.lstatSync(current);
      return path.join(canonical(current), ...suffix);
    } catch (cause) {
      if (cause.code !== 'ENOENT' && cause.code !== 'ENOTDIR') throw cause;
      const parent = path.dirname(current);
      if (parent === current) throw cause;
      suffix.unshift(path.basename(current));
      current = parent;
    }
  }
}

function isLedgerPath(relative) {
  const rel = relative.replace(/\\/g, '/').replace(/^\.\//, '');
  return rel === '.agents/harness-everything/errors' ||
    rel.startsWith('.agents/harness-everything/errors/') ||
    rel === 'docs/error-handling' || rel.startsWith('docs/error-handling/');
}

function isDocumentationPath(relative) {
  return relative.toLowerCase().endsWith('.md') || relative.startsWith('docs/');
}

function normalizedRepoPath(relative) {
  return relative.replace(/\\/g, '/').replace(/^\.\//, '');
}

function parseHistory(root, hideLedger) {
  const tokens = git(root, ['log', '-z', '--name-status', '--format=%H%x00%s']).split('\0');
  const groups = new Map();
  for (let i = 0; i < tokens.length;) {
    const sha = tokens[i++];
    if (!sha) continue;
    if (!HASH.test(sha) || i >= tokens.length) failure('git history returned an invalid record', 1);
    const subject = tokens[i++];
    const relevant = /^(?:fix(?:\([^\r\n)]*\))?!?:\s|revert(?:\([^\r\n)]*\))?!?:\s|Revert ".+"$)/.test(subject);
    const changed = new Set();
    while (i < tokens.length && !HASH.test(tokens[i])) {
      const status = tokens[i++].replace(/^\r?\n/, '');
      if (!status) continue;
      if (!/^[ACDMRTUXB]\d*$/.test(status)) failure('git history returned an invalid file status', 1);
      const count = /^[RC]/.test(status) ? 2 : 1;
      for (let n = 0; n < count; n++) {
        if (i >= tokens.length) failure('git history returned an incomplete file record', 1);
        const site = normalizedRepoPath(tokens[i++]);
        if (!hideLedger || !isLedgerPath(site)) changed.add(site);
      }
    }
    if (relevant) {
      for (const site of changed) {
        const type = isDocumentationPath(site) ? 'doc' : 'git';
        const key = `${type}\0${site}`;
        const commits = groups.get(key) || new Map();
        commits.set(sha, { sha, subject });
        groups.set(key, commits);
      }
    }
  }
  return [...groups.entries()]
    .filter(([, commits]) => commits.size >= 2)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, commits]) => {
      const [type, site] = key.split('\0');
      return makeCandidate({
        title: `Repeated fix history for ${site}`,
        signature: `repeated-fix:${site}`,
        sites: [site],
        sources: [...commits.values()].sort((a, b) => a.sha.localeCompare(b.sha)).map(commit => type === 'doc'
          ? { type, path: site, sha: commit.sha }
          : { type, sha: commit.sha, subject: commit.subject })
      });
    });
}

function repoFiles(root) {
  return git(root, ['ls-files', '--cached', '--others', '--exclude-standard', '-z'])
    .split('\0').filter(Boolean).map(normalizedRepoPath);
}

function safeRead(file) {
  try {
    if (fs.lstatSync(file).isSymbolicLink()) return null;
    return fs.readFileSync(file, 'utf8');
  } catch (_) {
    return null;
  }
}

function walkMarkdown(directory) {
  const found = [];
  function visit(dir) {
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch (_) { return; }
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      const file = path.join(dir, entry.name);
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) visit(file);
      else if (entry.isFile() && entry.name.toLowerCase().endsWith('.md')) found.push(file);
    }
  }
  visit(directory);
  return found;
}

function flatMarkdown(directory) {
  try {
    return fs.readdirSync(directory, { withFileTypes: true })
      .filter(entry => entry.isFile() && entry.name.toLowerCase().endsWith('.md'))
      .map(entry => path.join(directory, entry.name))
      .sort((a, b) => a.localeCompare(b));
  } catch (_) {
    return [];
  }
}

function explicitFiles(input, root, hideLedger) {
  const absolute = path.resolve(input);
  let stat;
  try { stat = fs.statSync(absolute); } catch (_) { return []; }
  const files = stat.isDirectory() ? walkMarkdown(absolute) : stat.isFile() ? [absolute] : [];
  return files.filter(file => {
    if (!hideLedger) return true;
    let resolved;
    try { resolved = resolveWithSymlinks(file); } catch (_) { resolved = file; }
    return !isWithin(root, resolved) || !isLedgerPath(normalizedRepoPath(path.relative(root, resolved)));
  });
}

function localSourceId(file) {
  return `local/${crypto.createHash('sha256').update(path.resolve(file)).digest('hex')}`;
}

function labelPath(file, root) {
  const resolved = path.resolve(file);
  if (isWithin(root, resolved)) return `repo/${normalizedRepoPath(path.relative(root, resolved)) || '.'}`;
  return localSourceId(resolved);
}

function markdownTitle(text) {
  const frontmatter = /^---\s*\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(text);
  if (frontmatter) {
    const title = /^title:\s*(.+?)\s*$/m.exec(frontmatter[1]);
    if (title) return title[1].replace(/^['"]|['"]$/g, '');
  }
  const section = /^#{1,6}\s*(?:cue|lesson)\s*\r?\n+([\s\S]*?)(?=\r?\n#{1,6}\s|$)/im.exec(text);
  if (section) return section[1].trim().split(/\r?\n/).find(Boolean) || '';
  const heading = /^#\s+(.+)$/m.exec(text);
  return heading ? heading[1].trim() : '';
}

function lessonSites(text, knownFiles) {
  const sites = new Set();
  const expression = /(?<![A-Za-z0-9_.:/\\])((?:[A-Za-z0-9_.-]+\/)+[A-Za-z0-9_.-]+\.[A-Za-z0-9_-]+)\b/g;
  for (const match of text.matchAll(expression)) {
    const site = path.posix.normalize(match[1]);
    if (!path.posix.isAbsolute(site) && !site.split('/').includes('..') && !/^[A-Za-z]:/.test(site) &&
      (!knownFiles || knownFiles.has(site))) sites.add(site);
  }
  return [...sites].sort();
}

function isLesson(text, file) {
  const frontmatter = /^---\s*\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(text);
  const feedback = frontmatter && /^type:\s*['"]?feedback(?:['"]?\s|$)/mi.test(frontmatter[1]);
  return Boolean(feedback || /^lesson-/i.test(path.basename(file)) || /^#{1,6}\s*(?:cue|lesson)\b/im.test(text));
}

function publicText(value, root, home) {
  let text = String(value || '');
  for (const [absolute, label] of [[root, '<repo>'], [home, '<home>']]) {
    if (absolute) text = text.split(absolute).join(label);
  }
  return text
    .replace(/\b[A-Za-z]:[\\/][^\s"'`<>]+/g, '[path]')
    .replace(/(?<![A-Za-z0-9])\/(?:[^/\s"'`<>]+\/)*[^/\s"'`<>]+/g, '[path]')
    .replace(/[\r\n\t]+/g, ' ')
    .trim();
}

function shortTitle(value, root, home) {
  return publicText(value, root, home).slice(0, 120) || 'Unverified lesson';
}

function slug(value) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 80) || 'lesson';
}

function makeCandidate({ title, signature, sites, sources }) {
  const sortedSites = [...new Set(sites)].sort();
  const sortedSources = [...sources].sort((a, b) => `${a.type}:${a.sha || a.ref}`.localeCompare(`${b.type}:${b.sha || b.ref}`));
  const identity = JSON.stringify(['error-candidate', sortedSites, sortedSources.map(source => `${source.type}:${source.sha || source.ref}`)]);
  return {
    id: crypto.createHash('sha256').update(identity).digest('hex').slice(0, 20),
    kind: 'error-candidate',
    domain: sortedSites.length ? sortedSites[0].split('/')[0] : 'unknown',
    title,
    signature,
    sites: sortedSites,
    sources: sortedSources,
    attachments: [],
    status: 'UNVERIFIED'
  };
}

function candidatesFromFiles(files, type, root, home, knownFiles, privateInput = false) {
  const candidates = [];
  for (const file of files) {
    const text = safeRead(file);
    if (text === null || !isLesson(text, file)) continue;
    const privateSource = type === 'memory' || privateInput || !isWithin(root, path.resolve(file));
    const title = privateSource ? `Local ${type} lead` :
      shortTitle(markdownTitle(text) || path.basename(file, path.extname(file)), root, home);
    const ref = privateSource ? localSourceId(file) : labelPath(file, root);
    candidates.push(makeCandidate({
      title,
      signature: slug(title),
      sites: lessonSites(text, privateSource ? knownFiles : undefined),
      sources: [{ type, ref }]
    }));
  }
  return candidates;
}

function autoMemory(root, home) {
  const slugDir = path.join(home, '.claude', 'projects', path.resolve(root).replace(/[^a-z0-9]/gi, '-'));
  const directory = path.join(slugDir, 'memory');
  const files = flatMarkdown(directory);
  let reason = fs.existsSync(directory) ? 'hinted memory directory contains no Markdown files' : 'hinted memory directory is missing';
  const marker = path.join(slugDir, 'MEMORY.md');
  let verified = fs.existsSync(marker);
  let verificationRef = verified ? marker : undefined;
  if (verified) reason = 'automatic memory marker found';
  else if (files.length) {
    for (const file of files) {
      const text = safeRead(file) || '';
      if (text.includes(path.basename(root)) || text.includes(root)) {
        verified = true;
        verificationRef = file;
        reason = 'a memory file names the target repository';
        break;
      }
    }
    if (!verified) reason = 'automatic memory marker absent and no memory file names the target repository';
  }
  return { directory, files, verified, reason, verificationRef };
}

function sourceStatus(type, origin, status, details = {}) {
  return { type, origin, status, ...details };
}

function trackerSites(body, root, files) {
  const text = typeof body === 'string' ? body : '';
  return files.filter(file => {
    if (!fs.existsSync(path.join(root, file))) return false;
    const escaped = file.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp(`(?<![A-Za-z0-9_./-])(?:\\.\\/)?${escaped}(?![A-Za-z0-9_./-])`).test(text);
  });
}

function collectTracker(options, root, home, files) {
  const candidates = [];
  if (!options.tracker.length) {
    return {
      sources: [sourceStatus('tracker', 'offline', 'missing', { reason: 'no --tracker file provided' })],
      candidates
    };
  }

  const sources = [];
  for (const input of options.tracker) {
    const file = path.resolve(input);
    let issues;
    try {
      issues = JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch (_) {
      failure('cannot read tracker export as JSON', 2);
    }
    if (!Array.isArray(issues)) failure('tracker export must be a JSON array', 2);
    sources.push(sourceStatus('tracker', 'offline', 'used', { ref: labelPath(file, root) }));
    for (const issue of issues) {
      if (!issue || typeof issue !== 'object' || Array.isArray(issue)) failure('tracker export contains an invalid issue', 2);
      const title = typeof issue.title === 'string' ? issue.title : '';
      const labels = Array.isArray(issue.labels) ? issue.labels : [];
      const qualifies = labels.some(label => /^(?:bug|regression|flake)$/i.test(String(label && label.name || ''))) ||
        /^\s*(?:fix|bug)\b/i.test(title);
      if (!qualifies) continue;
      if (!Number.isSafeInteger(issue.number) || issue.number < 1 || !title.trim()) {
        failure('tracker issue is missing a valid number or title', 2);
      }
      const ref = `#${issue.number}`;
      const candidateTitle = shortTitle(title, root, home);
      candidates.push(makeCandidate({
        title: candidateTitle,
        signature: slug(candidateTitle),
        sites: trackerSites(issue.body, root, files),
        sources: [{ type: 'tracker', ref }]
      }));
    }
  }
  return { sources, candidates };
}

function collectSources(options, root, home, files, historyCandidates) {
  const documentation = historyCandidates.some(item => item.sources.some(source => source.type === 'doc'));
  const knownFiles = new Set(files);
  const tracker = collectTracker(options, root, home, files);
  const sources = [
    sourceStatus('git', 'history', 'used'),
    sourceStatus('doc', 'history', documentation ? 'used' : 'missing',
      documentation ? {} : { reason: 'no repeated Markdown or docs paths found' }),
    ...tracker.sources
  ];
  const candidates = [...tracker.candidates];
  if (options.noMemory) {
    sources.push(sourceStatus('memory', 'auto', 'disabled', { verified: false, reason: 'disabled by --no-memory' }));
    sources.push(sourceStatus('instruction', 'repository', 'disabled', { reason: 'disabled by --no-memory' }));
    sources.push(sourceStatus('instruction', 'global-explicit', 'disabled', { reason: 'disabled by --no-memory' }));
    for (const input of options.memory) sources.push(sourceStatus('memory', 'explicit', 'disabled', { ref: localSourceId(input), reason: 'disabled by --no-memory' }));
    for (const input of options.instructions) sources.push(sourceStatus('instruction', 'global-explicit', 'disabled', { ref: localSourceId(input), reason: 'disabled by --no-memory' }));
    return { sources, candidates };
  }

  const auto = autoMemory(root, home);
  sources.push(sourceStatus('memory', 'auto', auto.files.length ? (auto.verified ? 'used' : 'unverified') : 'missing', {
    verified: auto.verified, reason: auto.reason,
    ref: localSourceId(auto.directory),
    ...(auto.verificationRef ? { verificationRef: localSourceId(auto.verificationRef) } : {})
  }));
  if (auto.verified) candidates.push(...candidatesFromFiles(auto.files, 'memory', root, home, knownFiles));

  if (options.memory.length) {
    for (const input of options.memory) {
      const selected = explicitFiles(input, root, options.hideLedger);
      sources.push(sourceStatus('memory', 'explicit', selected.length ? 'used' : 'missing', {
        ref: localSourceId(input),
        ...(selected.length ? {} : { reason: 'no readable files at the selected path' })
      }));
      candidates.push(...candidatesFromFiles(selected, 'memory', root, home, knownFiles));
    }
  } else {
    sources.push(sourceStatus('memory', 'explicit', 'missing', { reason: 'no --memory path provided' }));
  }

  const instructionFiles = files.filter(file => ['AGENTS.md', 'CLAUDE.md'].includes(path.posix.basename(file)) &&
    (!options.hideLedger || !isLedgerPath(file)));
  sources.push(sourceStatus('instruction', 'repository', instructionFiles.length ? 'used' : 'missing', {
    ...(instructionFiles.length ? { refs: instructionFiles } : { reason: 'no repository AGENTS.md or CLAUDE.md files found' })
  }));
  candidates.push(...candidatesFromFiles(instructionFiles.map(file => path.join(root, file)), 'instruction', root, home, knownFiles));

  if (options.instructions.length) {
    for (const input of options.instructions) {
      const selected = explicitFiles(input, root, options.hideLedger);
      sources.push(sourceStatus('instruction', 'global-explicit', selected.length ? 'used' : 'missing', {
        ref: localSourceId(input),
        ...(selected.length ? {} : { reason: 'no readable files at the selected path' })
      }));
      candidates.push(...candidatesFromFiles(selected, 'instruction', root, home, knownFiles, true));
    }
  } else {
    sources.push(sourceStatus('instruction', 'global-explicit', 'disabled', { reason: 'global instructions require --instructions' }));
  }
  return { sources, candidates };
}

function addAttachments(candidates, files, root, hideLedger) {
  const testFiles = files.filter(file => {
    const base = path.posix.basename(file);
    const testLike = /(?:^|[./_-])(?:test|tests|spec)(?:[./_-]|$)/i.test(base) || /(^|\/)(?:test|tests|__tests__)\//i.test(file);
    return testLike && (!hideLedger || !isLedgerPath(file));
  });
  for (const file of testFiles) {
    const full = path.join(root, file);
    const text = safeRead(full);
    if (text === null) continue;
    for (const item of candidates) {
      if (item.sites.some(site => text.includes(site) || importsSite(text, file, site)) &&
        !item.attachments.some(link => link.ref === file)) {
        item.attachments.push({ type: 'test-link', ref: file });
      }
    }
  }
  for (const item of candidates) item.attachments.sort((a, b) => a.ref.localeCompare(b.ref));
}

function importsSite(text, testFile, site) {
  const specifiers = /(?:\brequire(?:\.resolve)?\s*\(\s*|\bfrom\s+|\bimport\s*(?:\(\s*)?)['"]([^'"]+)['"]/g;
  for (const match of text.matchAll(specifiers)) {
    if (!match[1].startsWith('.')) continue;
    const resolved = path.posix.normalize(path.posix.join(path.posix.dirname(testFile), match[1]));
    if (resolved === site || (!path.posix.extname(resolved) &&
      (site.startsWith(`${resolved}.`) || site.startsWith(`${resolved}/index.`)))) return true;
  }
  return false;
}

function markdownReport(report) {
  const lines = [
    '# Error ledger candidate report',
    '',
    `- Schema version: ${report.schemaVersion}`,
    `- Root: \`${report.root}\``,
    `- Generated: ${report.generatedAt}`,
    `- Candidates: ${report.candidates.length}`,
    '',
    '## Options',
    '',
    `- hideLedger: ${report.options.hideLedger}`,
    `- noMemory: ${report.options.noMemory}`,
    `- memory: ${report.options.memory.length ? report.options.memory.map(value => `\`${value}\``).join(', ') : 'none'}`,
    `- instructions: ${report.options.instructions.length ? report.options.instructions.map(value => `\`${value}\``).join(', ') : 'none'}`,
    `- homeOverridden: ${report.options.homeOverridden}`,
    '',
    '## Sources',
    ''
  ];
  for (const source of report.sources) {
    const label = source.ref || (source.refs && source.refs.join(', ')) || source.origin;
    lines.push(`- \`${source.type}\` (${source.origin}) — **${source.status}** — ${label}${source.reason ? ` — ${source.reason}` : ''}${source.verified === undefined ? '' : ` — verified: ${source.verified}`}${source.verificationRef ? ` — verification: ${source.verificationRef}` : ''}`);
  }
  lines.push('', '## Candidates', '');
  for (const item of report.candidates) {
    lines.push(`### ${item.title}`, '', `- ID: \`${item.id}\``, `- Kind: \`${item.kind}\``, `- Domain: \`${item.domain}\``, `- Signature: \`${item.signature}\``, `- Status: **${item.status}**`, `- Sites: ${item.sites.length ? item.sites.map(site => `\`${site}\``).join(', ') : 'none'}`, '- Sources:');
    for (const source of item.sources) {
      lines.push(`  - \`${source.type}\` ${source.ref || source.path || source.sha}${source.path && source.sha ? ` — ${source.sha}` : ''}${source.subject ? ` — ${source.subject}` : ''}`);
    }
    lines.push('- Attachments:');
    if (item.attachments.length) {
      for (const attachment of item.attachments) lines.push(`  - \`${attachment.type}\` \`${attachment.ref}\``);
    } else lines.push('  - none');
    lines.push('');
  }
  return `${lines.join('\n')}\n`;
}

function reportOptions(options, root, home) {
  return {
    hideLedger: options.hideLedger,
    noMemory: options.noMemory,
    memory: options.memory.map(localSourceId),
    instructions: options.instructions.map(localSourceId),
    homeOverridden: Boolean(options.home)
  };
}

function outputDirectory(options, root) {
  if (!options.out) {
    const tempRoot = path.resolve(os.tmpdir());
    const physicalTempRoot = resolveWithSymlinks(tempRoot);
    if (isWithin(root, tempRoot) || isWithin(root, physicalTempRoot)) {
      failure('system temporary directory is inside the target repository', 2);
    }
    const directory = fs.mkdtempSync(path.join(tempRoot, 'error-ledger-candidates-'));
    const physical = resolveWithSymlinks(directory);
    if (isWithin(root, directory) || isWithin(root, physical)) {
      fs.rmSync(directory, { recursive: true, force: true });
      failure('refusing output inside the target repository', 2);
    }
    try { fs.chmodSync(directory, 0o700); } catch (_) { /* mode bits are not available on every host */ }
    return { directory: physical, privateDefault: true };
  }
  const lexical = path.resolve(options.out);
  const resolved = resolveWithSymlinks(lexical);
  if (isWithin(root, lexical) || isWithin(root, resolved)) failure('refusing output inside the target repository', 2);
  fs.mkdirSync(resolved, { recursive: true, mode: 0o700 });
  const physical = resolveWithSymlinks(resolved);
  if (isWithin(root, physical)) failure('refusing output inside the target repository', 2);
  return { directory: physical, privateDefault: false };
}

function writeReports(directory, report, root) {
  const jsonPath = path.join(directory, 'candidates.json');
  const markdownPath = path.join(directory, 'candidates.md');
  for (const target of [jsonPath, markdownPath]) {
    const lexical = path.resolve(target);
    const resolved = resolveWithSymlinks(target);
    if (isWithin(root, lexical) || isWithin(root, resolved)) failure('refusing report file inside the target repository', 2);
    if (fs.existsSync(target)) failure(`report output already exists: ${path.basename(target)}`, 2);
  }
  const files = [
    [jsonPath, `${JSON.stringify(report, null, 2)}\n`],
    [markdownPath, markdownReport(report)]
  ];
  const temps = [];
  const written = [];
  try {
    for (const [target, contents] of files) {
      const temp = path.join(directory, `.scan-${process.pid}-${crypto.randomBytes(6).toString('hex')}.tmp`);
      temps.push(temp);
      fs.writeFileSync(temp, contents, { flag: 'wx', mode: 0o600 });
      fs.renameSync(temp, target);
      written.push(target);
    }
  } catch (cause) {
    for (const file of [...temps, ...written]) {
      try { fs.rmSync(file, { force: true }); } catch (_) {}
    }
    failure(`cannot write candidate reports: ${cause.message}`, 1);
  }
  return { reportJson: jsonPath, reportMd: markdownPath };
}

function scan(options) {
  const rootInput = path.resolve(options.root);
  let root;
  try {
    if (!fs.statSync(rootInput).isDirectory()) failure('--root must be a directory');
    root = canonical(rootInput);
  } catch (cause) {
    if (cause.exitCode) throw cause;
    failure('--root must be an existing Git repository directory');
  }
  const top = canonical(git(root, ['rev-parse', '--show-toplevel'], 'utf8', 2).trim());
  if (top !== root) failure('--root must be the Git repository root');
  const home = options.home ? path.resolve(options.home) : os.homedir();
  const historyCandidates = parseHistory(root, options.hideLedger);
  const files = repoFiles(root);
  const selected = collectSources(options, root, home, files, historyCandidates);
  const candidates = [...new Map([...historyCandidates, ...selected.candidates].map(item => [item.id, item])).values()];
  addAttachments(candidates, files, root, options.hideLedger);
  for (const item of candidates) {
    for (const source of item.sources) {
      if (source.subject) source.subject = publicText(source.subject, root, home);
    }
  }
  candidates.sort((a, b) => a.id.localeCompare(b.id));
  if (selected.sources.some(source => !SOURCE_STATUSES.has(source.status))) failure('invalid source status', 1);
  const report = {
    schemaVersion: 1,
    root: path.basename(root),
    generatedAt: new Date().toISOString(),
    options: reportOptions(options, root, home),
    sources: selected.sources,
    candidates
  };
  const output = outputDirectory(options, root);
  const paths = writeReports(output.directory, report, root);
  return {
    report,
    ...paths,
    counts: {
      candidates: candidates.length,
      git: historyCandidates.filter(item => item.sources.some(source => source.type === 'git')).length,
      doc: historyCandidates.filter(item => item.sources.some(source => source.type === 'doc')).length,
      tracker: candidates.filter(item => item.sources.some(source => source.type === 'tracker')).length,
      memory: candidates.filter(item => item.sources.some(source => source.type === 'memory')).length,
      instruction: candidates.filter(item => item.sources.some(source => source.type === 'instruction')).length
    }
  };
}

function main(args) {
  const jsonRequested = args.includes('--json');
  try {
    const options = parseArgs(args);
    const result = scan(options);
    if (options.json) {
      process.stdout.write(`${JSON.stringify({ ok: true, reportJson: result.reportJson, reportMd: result.reportMd, counts: result.counts })}\n`);
    } else {
      process.stdout.write('Candidate reports written.\n');
    }
    return 0;
  } catch (cause) {
    const message = String(cause && cause.message || 'scan failed').replace(/[\r\n]+/g, ' ').trim() || 'scan failed';
    process.stderr.write(`${message}\n`);
    if (jsonRequested) process.stdout.write(`${JSON.stringify({ ok: false, error: message })}\n`);
    return cause && cause.exitCode === 2 ? 2 : 1;
  }
}

if (require.main === module) process.exitCode = main(process.argv.slice(2));

module.exports = { isWithin };
