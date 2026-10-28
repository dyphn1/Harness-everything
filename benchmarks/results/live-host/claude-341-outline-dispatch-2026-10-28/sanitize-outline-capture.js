#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const [input, output, ...extra] = process.argv.slice(2);
if (!input || !output || extra.length) throw new Error('usage: node sanitize-outline-capture.js <raw-hooks.jsonl> <output.jsonl>');

const wrappers = fs.readFileSync(input, 'utf8').split(/\r?\n/).filter(line => line.trim()).map(line => JSON.parse(line));
const payloads = wrappers.map(item => {
  assert(item && item.payload && typeof item.payload === 'object' && !Array.isArray(item.payload), 'raw record has no payload object');
  assert(typeof item.payload.hook_event_name === 'string' && item.payload.hook_event_name, 'raw payload has no observed hook event');
  return item.payload;
});

const ids = new Map();
const sensitiveIds = new Set();
const nextId = (kind, value) => {
  const key = `${kind}\0${value}`;
  sensitiveIds.add(value);
  if (!ids.has(key)) ids.set(key, `<${kind}-${[...ids.keys()].filter(id => id.startsWith(`${kind}\0`)).length + 1}>`);
  return ids.get(key);
};
const collectIds = (value, key) => {
  if (typeof value === 'string') {
    if (value && ['session_id', 'prompt_id'].includes(key)) nextId(key === 'session_id' ? 'session' : 'prompt', value);
    if (value && ['agent_id', 'agentId'].includes(key)) nextId('agent', value);
    for (const match of value.matchAll(/toolu_[A-Za-z0-9]+/g)) nextId('tool-use', match[0]);
  } else if (Array.isArray(value)) value.forEach(item => collectIds(item, key));
  else if (value && typeof value === 'object') {
    for (const [childKey, child] of Object.entries(value)) collectIds(child, childKey);
  }
};
payloads.forEach(payload => collectIds(payload, ''));

const transcriptPaths = new Map();
const privateProjectSlugs = new Set();
const collectTranscriptPaths = (value, key = '') => {
  if (typeof value === 'string') {
    if (key === 'agent_transcript_path' && !transcriptPaths.has(value)) {
      transcriptPaths.set(value, `/sanitized/run8/agent-transcripts/transcript-${transcriptPaths.size + 1}.jsonl`);
      const projectsMarker = '/.claude/projects/';
      const projectsIndex = value.replace(/\\/g, '/').indexOf(projectsMarker);
      if (projectsIndex >= 0) {
        const slug = value.replace(/\\/g, '/').slice(projectsIndex + projectsMarker.length).split('/')[0];
        if (slug) privateProjectSlugs.add(slug);
      }
    }
  } else if (Array.isArray(value)) value.forEach(item => collectTranscriptPaths(item, key));
  else if (value && typeof value === 'object') {
    for (const [childKey, child] of Object.entries(value)) collectTranscriptPaths(child, childKey);
  }
};
payloads.forEach(payload => collectTranscriptPaths(payload));

const records = payloads.map(payload => {
  const { transcript_path, hook_event_name, ...record } = payload;
  return { ...record, event: hook_event_name };
});
let text = JSON.stringify(records);
for (const [original, replacement] of transcriptPaths) text = text.split(original).join(replacement);
for (const slug of privateProjectSlugs) text = text.split(slug).join('sanitized-run8-project');
const workerRoots = new Set();
for (const record of records) {
  if (typeof record.tool_input?.prompt !== 'string') continue;
  const match = record.tool_input.prompt.match(/(?:^|\s)workerRoot=(\S+)/);
  if (match && path.isAbsolute(match[1])) workerRoots.add(match[1]);
}
const runRoots = [...workerRoots].map(root => path.dirname(root)).sort((a, b) => b.length - a.length);
for (let i = 0; i < runRoots.length; i++) text = text.split(runRoots[i]).join(`/sanitized/run8${i ? `/root-${i + 1}` : ''}`);
text = text.replace(/\/Users\/[^/"\\\s]+/g, '/sanitized/home').replaceAll('/private/', '/sanitized/private/');
for (const [key, placeholder] of [...ids].sort((a, b) => b[0].length - a[0].length)) {
  const value = key.slice(key.indexOf('\0') + 1);
  text = text.split(value).join(placeholder);
}

const sanitized = JSON.parse(text);
assert(sanitized.length === records.length, 'sanitization changed record count');
assert(sanitized.every(record => record && typeof record === 'object' && !Array.isArray(record)), 'sanitized record is not an object');
assert(!/\/Users\/|\/private\/|toolu_/.test(text), 'sanitized output retains a private path or tool id');
assert([...sensitiveIds].every(value => !text.includes(value)), 'sanitized output retains a session or agent id');
assert([...transcriptPaths.keys(), ...privateProjectSlugs].every(value => !text.includes(value)), 'sanitized output retains a private transcript path');
fs.mkdirSync(path.dirname(path.resolve(output)), { recursive: true });
fs.writeFileSync(output, sanitized.map(record => JSON.stringify(record)).join('\n') + '\n');
console.log(`sanitized records=${sanitized.length}; privacy audit=clear`);
