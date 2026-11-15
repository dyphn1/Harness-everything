'use strict';

const fs = require('node:fs');
const path = require('node:path');
const obs = require('../hooks/scripts/lib/observations');
const { assertPrivateDataDir } = require('./system-one-cycle/common');

function parseSince(value) {
  if (typeof value !== 'string') throw new Error('invalid-since');
  const text = value;
  const timestamp = Date.parse(/^\d{4}-\d{2}-\d{2}$/.test(text) ? `${text}T00:00:00.000Z` : text);
  if (!Number.isFinite(timestamp)) throw new Error('invalid-since');
  return timestamp;
}

function bucket(byHost, host) {
  if (!Object.hasOwn(byHost, host)) {
    Object.defineProperty(byHost, host, {
      value: { persisted: 0, duplicate: 0, ambiguous: 0, importFailure: 0 }, enumerable: true, configurable: true, writable: true,
    });
  }
  return byHost[host];
}

function importStore({ sourceRoot = obs.storeRoot(), store, since, lockTimeoutMs } = {}) {
  const report = {
    source: { root: 'configured-private-store', status: 'absent' },
    byHost: {},
  };
  const fail = (host, code) => {
    bucket(report.byHost, host).importFailure++;
    report.source.status = 'error';
    report.source.error ||= code;
  };

  let cutoff;
  try { cutoff = parseSince(since); }
  catch { fail('unknown', 'invalid-since'); return report; }

  if (typeof store !== 'string' || !store.trim() || !path.isAbsolute(store)
      || typeof sourceRoot !== 'string' || !sourceRoot.trim()) {
    fail('unknown', typeof store !== 'string' || !store.trim() || !path.isAbsolute(store) ? 'invalid-destination' : 'invalid-source-root');
    return report;
  }
  let destination;
  let source;
  try { destination = assertPrivateDataDir(store); }
  catch { fail('unknown', 'destination-unavailable'); return report; }
  try { source = assertPrivateDataDir(sourceRoot, { create: false }); }
  catch { fail('unknown', 'source-unavailable'); return report; }

  const destinationIndex = path.join(destination, 'observations-index.json');
  try {
    fs.mkdirSync(destination, { recursive: true, mode: 0o700 });
    try { fs.writeFileSync(destinationIndex, '{"schemaVersion":1,"kind":"system-one-observations","records":[]}\n', { flag: 'wx', mode: 0o600 }); }
    catch (error) { if (error.code !== 'EEXIST') throw error; }
    const existing = JSON.parse(fs.readFileSync(destinationIndex, 'utf8'));
    if (existing.schemaVersion !== 1 || !Array.isArray(existing.records)) throw new Error('invalid destination index');
  } catch { fail('unknown', 'destination-unavailable'); return report; }

  const sourceIndex = path.join(source, 'observations-index.json');
  if (!fs.existsSync(sourceIndex)) return report;

  let index;
  try { index = JSON.parse(fs.readFileSync(sourceIndex, 'utf8')); }
  catch { fail('unknown', 'source-index-invalid'); return report; }
  if (!index || index.schemaVersion !== 1 || !Array.isArray(index.records)) {
    fail('unknown', 'source-index-invalid');
    return report;
  }

  report.source.status = 'ok';
  for (const record of index.records) {
    if (!record || typeof record !== 'object' || Array.isArray(record)) {
      fail('unknown', 'source-record-invalid');
      continue;
    }
    const host = typeof record.host === 'string' && record.host.trim() ? record.host : 'unknown';
    const observedAt = typeof record.observedAt === 'string' ? Date.parse(record.observedAt) : NaN;
    if (!Number.isFinite(observedAt)) { fail(host, 'source-record-invalid'); continue; }
    if (observedAt < cutoff) continue;
    const result = bucket(report.byHost, host);
    const writer = record.writer && typeof record.writer === 'object' ? record.writer : {};
    const sessionId = typeof writer.sessionId === 'string' ? writer.sessionId : '';
    if (typeof record.id !== 'string' || !record.id || typeof record.contentSha256 !== 'string'
        || !/^[a-f\d]{64}$/i.test(record.contentSha256)) {
      fail(host, 'source-record-invalid');
      continue;
    }
    if (host === 'unknown' || !sessionId || (writer.turnId !== undefined && typeof writer.turnId !== 'string')) {
      result.ambiguous++;
      report.source.status = 'error';
      report.source.error ||= 'ambiguous-records';
      continue;
    }

    const retained = Number.isFinite(Date.parse(record.validUntil || ''));
    const text = retained ? obs.recordText(source, record) : null;
    if (text !== null && (!text || typeof text.prompt !== 'string'
        || !(text.previous === undefined || typeof text.previous === 'string'))) {
      fail(host, 'source-text-invalid');
      continue;
    }
    let appended;
    try {
      appended = obs.appendRecordDetailed(destination, record, text, {
        dedupeByTurn: true,
        ...(lockTimeoutMs === undefined ? {} : { lockTimeoutMs }),
      });
    } catch {
      fail(host, 'append-failed');
      break;
    }
    if (appended.status === 'appended') result.persisted++;
    else if (appended.status === 'duplicate') result.duplicate++;
    else if (appended.status === 'ambiguous') {
      result.ambiguous++;
      report.source.status = 'error';
      report.source.error ||= 'ambiguous-records';
    } else {
      fail(host, 'append-failed');
      break;
    }
  }
  return report;
}

module.exports = { importStore };
