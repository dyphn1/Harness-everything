#!/usr/bin/env node
'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const yaml = require('js-yaml');

const STATUSES = new Set(['proposed', 'accepted', 'retired']);
const ALIAS = /^[A-Z]$/;
const MERMAID_ID = /^[A-Za-z_][A-Za-z0-9_-]*$/;
const IDENTIFIER = /^ERR-\d{8}-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const USAGE = 'Usage: node scripts/error-handling-map.js <new|set-status|check> [--map <nodes.yaml>] [--diagram <README.md>] [--alias <X> --name <text> [--date YYYYMMDD] | --id <identifier> --status <proposed|accepted|retired>]';

function parseArgs(argv) {
  const verb = argv[0];
  if (!['new', 'set-status', 'check'].includes(verb)) throw new Error(USAGE);
  const options = {};
  const allowed = new Set(['map', 'diagram', ...(verb === 'new' ? ['alias', 'name', 'date'] : []), ...(verb === 'set-status' ? ['id', 'status'] : [])]);
  for (let i = 1; i < argv.length; i++) {
    const flag = argv[i];
    if (!flag.startsWith('--') || !allowed.has(flag.slice(2))) throw new Error('Unknown option: ' + flag + '\n' + USAGE);
    const key = flag.slice(2);
    if (Object.hasOwn(options, key)) throw new Error('Duplicate option: ' + flag);
    if (argv[i + 1] === undefined || argv[i + 1].startsWith('--')) throw new Error('Missing value for ' + flag);
    options[key] = argv[++i];
  }
  if (verb === 'new') {
    if (!options.alias || !options.name) throw new Error('new requires --alias and --name');
    if (!ALIAS.test(options.alias)) throw new Error('Invalid Action alias: ' + options.alias + ' (use one uppercase letter)');
    if (!options.name.trim()) throw new Error('Action name must not be empty');
    if (options.date && !validDate(options.date)) throw new Error('Invalid date: ' + options.date + ' (expected a real YYYYMMDD date)');
  }
  if (verb === 'set-status') {
    if (!options.id || !options.status) throw new Error('set-status requires --id and --status');
    if (!STATUSES.has(options.status)) throw new Error('Invalid status: ' + options.status + ' (use proposed, accepted, or retired)');
  }
  return { verb, options };
}

function validDate(value) {
  if (!/^\d{8}$/.test(value)) return false;
  const year = Number(value.slice(0, 4));
  const month = Number(value.slice(4, 6));
  const day = Number(value.slice(6, 8));
  if (year < 1000 || month < 1 || month > 12 || day < 1 || day > 31) return false;
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.toISOString().slice(0, 10).replace(/-/g, '') === value;
}

function readMap(file) {
  const realPath = fs.realpathSync(file);
  const source = fs.readFileSync(realPath, 'utf8');
  let data;
  try {
    data = yaml.load(source);
  } catch (error) {
    throw new Error('Invalid map YAML: ' + error.message);
  }
  validateMap(data);
  return { file: realPath, source, data };
}

function validateMap(data) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('Map root must be a YAML object');
  if (!data.actions || typeof data.actions !== 'object' || Array.isArray(data.actions)) throw new Error('Map must contain an actions object');
  const identifiers = new Map();
  for (const [alias, action] of Object.entries(data.actions)) {
    if (!ALIAS.test(alias)) throw new Error('Invalid Action alias in map: ' + alias);
    if (!action || typeof action !== 'object' || Array.isArray(action)) throw new Error('Action ' + alias + ' must be an object');
    if (typeof action.identifier !== 'string' || !IDENTIFIER.test(action.identifier)) {
      throw new Error('Action ' + alias + ' has an invalid identifier: ' + String(action.identifier));
    }
    const identity = action.identifier.toLowerCase();
    const previousAlias = identifiers.get(identity);
    if (previousAlias) throw new Error('Duplicate identifier ' + action.identifier + ' on aliases ' + previousAlias + ' and ' + alias);
    identifiers.set(identity, alias);
    if (typeof action.name !== 'string' || !action.name.trim()) throw new Error('Action ' + alias + ' must have a non-empty name');
    if (!STATUSES.has(action.status)) throw new Error('Action ' + alias + ' has invalid status: ' + String(action.status));
  }
  if (!Array.isArray(data.links)) throw new Error('Map must contain a links array');
  const links = new Set();
  for (let i = 0; i < data.links.length; i++) {
    const link = data.links[i];
    if (!link || typeof link !== 'object' || Array.isArray(link)) throw new Error('links[' + i + '] must contain from and to aliases');
    for (const field of ['from', 'to']) {
      if (typeof link[field] !== 'string' || !ALIAS.test(link[field])) {
        throw new Error('links[' + i + '].' + field + ' must be a one-letter Action alias');
      }
      if (!Object.hasOwn(data.actions, link[field])) {
        throw new Error('links[' + i + '].' + field + ' uses unknown Action alias: ' + link[field]);
      }
    }
    const key = pairKey(link.from, link.to);
    if (links.has(key)) throw new Error('Duplicate link ' + link.from + ' -> ' + link.to);
    links.add(key);
  }
}

function pairKey(from, to) {
  return from + '\0' + to;
}

function parseView1(diagramText) {
  const lines = diagramText.split(/\r?\n/);
  const fence = String.fromCharCode(96).repeat(3);
  let view1 = false;
  let inside = false;
  const diagram = [];
  for (const line of lines) {
    if (!view1) {
      if (/^## View 1(?:[ \t]|$)/.test(line)) view1 = true;
      continue;
    }
    if (/^## View 2(?:[ \t]|$)/.test(line)) break;
    if (!inside) {
      if (line.trim() === fence + 'mermaid') inside = true;
      continue;
    }
    if (line.trim() === fence) return diagram.join('\n');
    diagram.push(line);
  }
  throw new Error('Could not find the View 1 Mermaid block before View 2');
}

function endpoint(raw, lineNumber, side) {
  let value = raw.trim();
  if (side === 'to' && value.startsWith('|')) {
    const end = value.indexOf('|', 1);
    if (end < 0) throw new Error('Invalid Mermaid edge label at View 1 line ' + lineNumber);
    value = value.slice(end + 1).trim();
  }
  const match = /^([A-Za-z_][A-Za-z0-9_-]*)([\s\S]*)$/.exec(value);
  if (!match) throw new Error('Invalid Mermaid ' + side + ' node at View 1 line ' + lineNumber);
  const suffix = match[2].trim();
  const declaration = /^\[[\s\S]*\]$/.test(suffix) ||
    /^\{[\s\S]*\}$/.test(suffix) ||
    /^\(\([\s\S]*\)\)$/.test(suffix);
  if (suffix && !declaration) throw new Error('Unsupported Mermaid node declaration at View 1 line ' + lineNumber);
  return match[1];
}

function diagramEdges(diagramText) {
  const adjacency = new Map();
  const lines = parseView1(diagramText).split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line || line.startsWith('%%')) continue;
    const arrows = line.match(/-->/g) || [];
    if (arrows.length > 1) throw new Error('Unsupported chained Mermaid edges at View 1 line ' + (i + 1));
    if (arrows.length === 0) {
      if (/(?:---|==>|-\.\-|--[ox]|<--|<==)/.test(line)) {
        throw new Error('Unsupported Mermaid edge operator at View 1 line ' + (i + 1));
      }
      continue;
    }
    const arrowAt = line.indexOf('-->');
    const from = endpoint(line.slice(0, arrowAt), i + 1, 'from');
    const to = endpoint(line.slice(arrowAt + 3), i + 1, 'to');
    if (!adjacency.has(from)) adjacency.set(from, new Set());
    adjacency.get(from).add(to);
  }
  return adjacency;
}

function expectedLinks(actions, adjacency) {
  const expected = new Set();
  const aliases = new Set(actions);
  for (const from of aliases) {
    const pending = [...(adjacency.get(from) || [])];
    const visited = new Set();
    while (pending.length) {
      const node = pending.shift();
      if (aliases.has(node)) {
        if (node !== from) expected.add(pairKey(from, node));
      } else if (!visited.has(node)) {
        visited.add(node);
        pending.push(...(adjacency.get(node) || []));
      }
    }
  }
  return expected;
}

function check(mapPath, diagramPath) {
  const { data } = readMap(mapPath);
  const diagram = fs.readFileSync(fs.realpathSync(diagramPath), 'utf8');
  const expected = expectedLinks(Object.keys(data.actions), diagramEdges(diagram));
  const actual = new Set(data.links.map(link => pairKey(link.from, link.to)));
  const labels = key => key.split('\0').join(' -> ');
  const missing = [...expected].filter(key => !actual.has(key)).sort();
  const extra = [...actual].filter(key => !expected.has(key)).sort();
  if (missing.length || extra.length) {
    const errors = [
      ...missing.map(key => 'Missing link ' + labels(key) + ' (present in View 1)'),
      ...extra.map(key => 'Extra link ' + labels(key) + ' (not present in View 1)'),
    ];
    throw new Error(errors.join('\n'));
  }
  console.log('OK: ' + expected.size + ' Action link(s) match View 1.');
}

function editStatus(source, alias, status) {
  const actionStart = new RegExp('^  ' + alias + ':[ \\t]*(?:#[^\\r\\n]*)?$', 'm').exec(source);
  if (!actionStart) throw new Error('Could not locate Action ' + alias + ' in map text');
  const bodyStart = actionStart.index + actionStart[0].length;
  const remainder = source.slice(bodyStart);
  const boundary = /^(?:  [A-Z]:[ \t]*(?:#[^\r\n]*)?|links:[ \t]*(?:#[^\r\n]*)?)/m.exec(remainder);
  const end = boundary ? bodyStart + boundary.index : source.length;
  const block = source.slice(actionStart.index, end);
  const statusLines = [...block.matchAll(/^[ \t]{4}status:/gm)];
  if (statusLines.length !== 1) throw new Error('Action ' + alias + ' must have exactly one status line');
  const statusLine = /^([ \t]{4}status:[ \t]*)\S+([ \t]*(?:#.*)?)(\r?)$/m.exec(block);
  if (!statusLine) throw new Error('Could not read Action ' + alias + ' status line');
  const replacement = statusLine[1] + status + statusLine[2] + statusLine[3];
  const updatedBlock = block.slice(0, statusLine.index) + replacement + block.slice(statusLine.index + statusLine[0].length);
  return source.slice(0, actionStart.index) + updatedBlock + source.slice(end);
}

function addAction(source, alias, identifier, name) {
  const linksLine = /^links:[ \t]*(?:#[^\r\n]*)?$/m.exec(source);
  if (!linksLine) throw new Error('Could not locate root links section in map text');
  const newline = source.includes('\r\n') ? '\r\n' : '\n';
  const prefix = source.slice(0, linksLine.index);
  const separator = prefix && !prefix.endsWith('\n') ? newline : '';
  const block = [
    '  ' + alias + ':',
    '    identifier: ' + identifier,
    '    name: ' + JSON.stringify(name),
    '    status: proposed',
    '',
  ].join(newline);
  return prefix + separator + block + source.slice(linksLine.index);
}

function writeAtomically(file, contents) {
  const mode = fs.statSync(file).mode & 0o777;
  const temporary = path.join(path.dirname(file), '.' + path.basename(file) + '.' + process.pid + '.' + crypto.randomUUID() + '.tmp');
  let fd;
  try {
    fd = fs.openSync(temporary, 'wx', mode);
    fs.writeFileSync(fd, contents, 'utf8');
    fs.closeSync(fd);
    fd = undefined;
    fs.renameSync(temporary, file);
  } catch (error) {
    if (fd !== undefined) fs.closeSync(fd);
    try { fs.unlinkSync(temporary); } catch (_) {}
    throw new Error('Could not atomically update ' + file + ': ' + error.message);
  }
}

function create(mapPath, alias, name, requestedDate) {
  const { file, source, data } = readMap(mapPath);
  if (Object.hasOwn(data.actions, alias)) throw new Error('Action alias already exists: ' + alias);
  const date = requestedDate || new Date().toISOString().slice(0, 10).replace(/-/g, '');
  let identifier;
  do {
    identifier = 'ERR-' + date + '-' + crypto.randomUUID();
  } while (Object.values(data.actions).some(action => action.identifier.toLowerCase() === identifier.toLowerCase()));
  writeAtomically(file, addAction(source, alias, identifier, name));
  console.log(identifier);
}

function setStatus(mapPath, identifier, status) {
  const { file, source, data } = readMap(mapPath);
  const entry = Object.entries(data.actions).find(([, action]) => action.identifier.toLowerCase() === identifier.toLowerCase());
  if (!entry) throw new Error('No Action found with identifier: ' + identifier);
  writeAtomically(file, editStatus(source, entry[0], status));
  console.log('Updated ' + identifier + ' status to ' + status + '.');
}

function main() {
  const { verb, options } = parseArgs(process.argv.slice(2));
  const mapPath = path.resolve(options.map || 'docs/error-handling/nodes.yaml');
  const diagramPath = path.resolve(options.diagram || 'docs/error-handling/README.md');
  if (verb === 'check') check(mapPath, diagramPath);
  else if (verb === 'new') create(mapPath, options.alias, options.name, options.date);
  else setStatus(mapPath, options.id, options.status);
}

try {
  main();
} catch (error) {
  console.error('[error-handling-map] ' + error.message);
  process.exitCode = 1;
}

