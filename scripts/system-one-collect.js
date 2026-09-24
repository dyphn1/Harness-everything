#!/usr/bin/env node
'use strict';
// Collects the owner's own prompts from local assistant histories into a local training dataset.
// See docs/system-one-training.md. The dataset is never written inside the repository.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { StringDecoder } = require('node:string_decoder');

const REPO = path.resolve(__dirname, '..');
const MAX_BYTES = 1024;
const VALIDATION_PERCENT = 15;
// Whole-text wrappers injected by hosts or hooks; text that starts with one is not typed by the owner.
const WRAPPER = /^(<(environment_context|user_instructions|recommended_plugins|send_user_message_question_reply|command-|local-command|task-notification|bash-|turn_aborted|user_shell_command|skill)|\[Terminal [0-9a-f-]+ notification)/i;
// Codex sessions typed by the owner: interactive IDE/desktop/terminal ones, not exec lanes, sub-agents or agent-started sessions.
const interactiveCodex = meta => !!meta && ['vscode', 'cli'].includes(meta.source) && !['Claude Code', 'codex_exec'].includes(meta.originator);
// Blocks a host inserts inside typed text; they are removed and the rest is kept.
const INSERTED = /<(system-reminder|ide_[a-z_]+)>[\s\S]*?<\/\1>/gi;
const sha = text => createHash('sha256').update(text, 'utf8').digest('hex');

function* readLines(file) {
  let fd;
  try { fd = fs.openSync(file, 'r'); } catch (_) { return; }
  const decoder = new StringDecoder('utf8'); const buf = Buffer.alloc(4 * 1024 * 1024); let rest = '';
  try {
    for (let n; (n = fs.readSync(fd, buf, 0, buf.length, null)) > 0;) {
      const parts = (rest + decoder.write(buf.subarray(0, n))).split('\n');
      rest = parts.pop();
      yield* parts;
    }
    rest += decoder.end();
    if (rest) yield rest;
  } finally { fs.closeSync(fd); }
}
const parse = line => { try { return JSON.parse(line); } catch (_) { return null; } };
function walk(dir, pred, out = [], depth = 0) {
  if (depth > 8) return out;
  let entries = [];
  try { entries = fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name)); } catch (_) { return out; }
  for (const e of entries) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, pred, out, depth + 1); else if (pred(p)) out.push(p);
  }
  return out;
}
// Typed text after removing inserted blocks; null when the text is a wrapper or nothing is left.
function typed(text) {
  if (typeof text !== 'string') return null;
  const t = text.replace(INSERTED, '').trim();
  return !t || WRAPPER.test(t) ? null : t;
}

function fromClaude(file) {
  const rows = [];
  for (const line of readLines(file)) {
    const e = parse(line);
    if (!e || e.type !== 'user' || e.isMeta || e.isSidechain) continue;
    const c = e.message && e.message.content;
    const raw = typeof c === 'string' ? c : Array.isArray(c) ? c.filter(p => p && p.type === 'text').map(p => p.text).join('\n') : null;
    const t = typed(raw); if (t) rows.push(t);
  }
  return rows;
}
function fromCodex(file) {
  const events = []; const items = []; let meta = null;
  for (const line of readLines(file)) {
    const e = parse(line); if (!e || !e.payload) continue;
    if (e.type === 'session_meta' && !meta) { meta = e.payload; if (!interactiveCodex(meta)) return []; continue; }
    if (e.type === 'event_msg' && e.payload.type === 'user_message') { const t = typed(e.payload.message); if (t) events.push(t); }
    if (e.type === 'response_item' && e.payload.role === 'user') for (const c of e.payload.content || []) { const t = typed(c && c.text); if (t) items.push(t); }
  }
  if (!interactiveCodex(meta)) return [];
  // Event messages are the typed text; response items repeat it with injected context, so they are a fallback only.
  return events.length ? events : items;
}
function fromCopilotCli(file) {
  const rows = [];
  for (const line of readLines(file)) {
    const e = parse(line);
    if (e && e.type === 'user.message' && e.data) { const t = typed(e.data.content); if (t) rows.push(t); }
  }
  return rows;
}
function fromVscode(file) {
  const rows = [];
  const take = requests => { for (const r of Array.isArray(requests) ? requests : [requests]) { const t = typed(r && r.message && r.message.text); if (t) rows.push(t); } };
  if (file.endsWith('.json')) {
    let j = null; try { j = JSON.parse(fs.readFileSync(file, 'utf8')); } catch (_) { /* unreadable snapshot */ }
    if (j) take(j.requests || []);
    return rows;
  }
  for (const line of readLines(file)) {
    const e = parse(line); if (!e) continue;
    if (e.kind === 0 && e.v) take(e.v.requests || []);
    else if (e.kind === 2 && Array.isArray(e.k) && e.k.length === 1 && e.k[0] === 'requests') take(e.v);
  }
  return rows;
}

// Every prompt with its source and a family derived from its session file (no path is stored).
function readSources({ home, appdata }) {
  const sources = [
    ['claude', walk(path.join(home, '.claude', 'projects'), p => p.endsWith('.jsonl')), fromClaude],
    ['codex', walk(path.join(home, '.codex', 'sessions'), p => p.endsWith('.jsonl')), fromCodex],
    ['copilot-cli', walk(path.join(home, '.copilot', 'session-state'), p => path.basename(p) === 'events.jsonl'), fromCopilotCli],
    ['vscode', [
      ...walk(path.join(appdata, 'Code', 'User', 'workspaceStorage'), p => /[\\/]chatSessions[\\/][^\\/]+\.jsonl?$/.test(p)),
      ...walk(path.join(appdata, 'Code', 'User', 'globalStorage', 'emptyWindowChatSessions'), p => /\.jsonl?$/.test(p)),
    ], fromVscode],
  ];
  const rows = [];
  for (const [source, files, read] of sources) {
    for (const file of files) {
      const family = `${source}:${sha(path.relative(home, file)).slice(0, 16)}`;
      for (const text of read(file)) rows.push({ source, family, text });
    }
  }
  return rows;
}

function keep(text) {
  const t = typeof text === 'string' ? text.trim() : '';
  return t.length > 0 && Buffer.byteLength(t, 'utf8') <= MAX_BYTES && !/^\/\S/.test(t) && !t.startsWith('This session is being continued');
}
function redact(text) {
  return text
    .replace(/[\w.+-]+@[\w-]+\.[\w.-]+/g, '<email>')
    .replace(/[A-Za-z]:\\Users\\[^\\\s]+/gi, '<home>')
    .replace(/[A-Za-z]:\/Users\/[^/\s]+/gi, '<home>')
    .replace(/\/(home|Users)\/[^/\s]+/g, '<home>');
}
const squash = text => text.replace(/\s+/g, ' ').trim();
function dedupe(rows) {
  const seen = new Set();
  return rows.filter(r => { const k = squash(r.text); if (seen.has(k)) return false; seen.add(k); return true; });
}
const normalize = text => text.toLowerCase().replace(/[\p{P}\p{S}]+/gu, ' ').replace(/\s+/g, ' ').trim();
function trigrams(text) {
  const s = new Set();
  if (text.length < 3) { if (text) s.add(text); return s; }
  for (let i = 0; i <= text.length - 3; i++) s.add(text.slice(i, i + 3));
  return s;
}
function jaccard(a, b) {
  const x = trigrams(a); const y = trigrams(b);
  if (!x.size && !y.size) return 1;
  let inter = 0; for (const g of x) if (y.has(g)) inter++;
  return inter / (x.size + y.size - inter);
}
// True when a prompt near-duplicates any holdout prompt (evaluation data must not leak into training).
function leakGuard(holdoutTexts) {
  const held = holdoutTexts.map(t => { const n = normalize(t); return { n, g: trigrams(n) }; });
  return text => {
    const n = normalize(text); const g = trigrams(n);
    return held.some(h => {
      const [short, long] = n.length <= h.n.length ? [n, h.n] : [h.n, n];
      if (short.length > 12 && long.includes(short)) return true;
      let inter = 0; for (const x of g) if (h.g.has(x)) inter++;
      return inter / (g.size + h.g.size - inter) >= 0.5;
    });
  };
}
const splitFor = family => (parseInt(sha(family).slice(0, 8), 16) % 100 < VALIDATION_PERCENT ? 'validation' : 'train');

function build({ home, appdata, holdoutTexts }) {
  const raw = readSources({ home, appdata });
  const dropped = { filtered: 0, duplicate: 0, leak: 0 };
  const kept = raw.filter(r => keep(r.text) || (dropped.filtered++, false)).map(r => ({ ...r, text: redact(r.text.trim()) }));
  const unique = dedupe(kept); dropped.duplicate = kept.length - unique.length;
  const leaks = leakGuard(holdoutTexts);
  const rows = unique.filter(r => !leaks(r.text) || (dropped.leak++, false))
    .map(r => ({ id: sha(squash(r.text)).slice(0, 16), family: r.family, source: r.source, split: splitFor(r.family), text: r.text }));
  const count = key => rows.reduce((a, r) => ((a[r[key]] = (a[r[key]] || 0) + 1), a), {});
  return { rows, stats: { extracted: raw.length, kept: rows.length, dropped, bySource: count('source'), bySplit: count('split'),
    families: new Set(rows.map(r => r.family)).size, zhShare: rows.length ? +(rows.filter(r => /[一-鿿]/.test(r.text)).length / rows.length).toFixed(3) : 0 } };
}

// Every committed holdout; a training prompt must not near-duplicate any of them.
const defaultHoldouts = () => ['system-one-holdout.json', 'system-one-intent-holdout.json'].map(f => path.join(REPO, 'benchmarks', 'fixtures', f));

if (require.main === module) {
  const args = process.argv.slice(2);
  const opt = name => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
  try {
    const out = path.resolve(opt('--out') || path.join(os.homedir(), '.agents', 'harness-everything', 'system-one', 'training'));
    const rel = path.relative(REPO, out);
    if (!rel.startsWith('..') && !path.isAbsolute(rel)) throw new Error('refusing to write the dataset inside the repository');
    const given = args.flatMap((a, i) => (a === '--holdout' && args[i + 1] ? [args[i + 1]] : []));
    const holdoutTexts = (given.length ? given : defaultHoldouts())
      .flatMap(file => JSON.parse(fs.readFileSync(file, 'utf8')).cases.map(c => c.request.context));
    const { rows, stats } = build({ home: opt('--home') || os.homedir(), appdata: opt('--appdata') || process.env.APPDATA || '', holdoutTexts });
    fs.mkdirSync(out, { recursive: true });
    const body = rows.map(r => JSON.stringify(r)).join('\n') + '\n';
    fs.writeFileSync(path.join(out, 'prompts.jsonl'), body, { mode: 0o600 });
    const report = { ...stats, sha256: sha(body) };
    fs.writeFileSync(path.join(out, 'collect-stats.json'), `${JSON.stringify(report, null, 2)}\n`);
    console.log(JSON.stringify(report));
  } catch (err) {
    console.error(`system-one-collect: ${err.message}`);
    process.exitCode = 1;
  }
}
module.exports = { readSources, keep, redact, dedupe, leakGuard, jaccard, splitFor, build, defaultHoldouts };
