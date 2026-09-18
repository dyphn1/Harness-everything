#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const {
  readEvents,
  telemetryFile,
} = require('../../hooks/scripts/lib/telemetry');

function percentile(values, p) {
  const sorted = values.filter(Number.isFinite).slice().sort((a, b) => a - b);
  if (!sorted.length) return null;
  const index = Math.max(0, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[index];
}

function metric(values) {
  const clean = values.filter(Number.isFinite);
  return {
    count: clean.length,
    p50: percentile(clean, 50),
    p95: percentile(clean, 95),
  };
}

function buildReport(events) {
  const valid = events.filter(event => event && !event.invalid);
  const invalid = events.filter(event => event && event.invalid);
  const groups = new Map();

  for (const event of valid) {
    const key = `${event.host}::${event.skillName || '(unknown)'}`;
    if (!groups.has(key)) groups.set(key, {
      host: event.host,
      skillName: event.skillName,
      skillVersion: event.skillVersion,
      invocationIds: new Set(),
      invokes: 0,
      loads: 0,
      completes: 0,
      status: { success: 0, failure: 0, aborted: 0, unknown: 0 },
      loadDurations: [],
      activeWindows: [],
      attributedToolDurations: [],
      toolEvents: 0,
      maxRetry: 0,
    });
    const g = groups.get(key);
    if (event.invocationId) g.invocationIds.add(event.invocationId);
    if (event.skillVersion) g.skillVersion = event.skillVersion;
    if (event.event === 'skill.invoke') g.invokes++;
    if (event.event === 'skill.loaded') {
      g.loads++;
      if (Number.isFinite(event.timing.skillLoadDurationMs)) g.loadDurations.push(event.timing.skillLoadDurationMs);
    }
    if (event.event === 'skill.complete') {
      g.completes++;
      g.status[event.status] = (g.status[event.status] || 0) + 1;
      if (Number.isFinite(event.timing.activeWindowMs)) g.activeWindows.push(event.timing.activeWindowMs);
      if (Number.isFinite(event.timing.attributedToolDurationMs)) g.attributedToolDurations.push(event.timing.attributedToolDurationMs);
    }
    if (event.event === 'tool.observed') g.toolEvents++;
    g.maxRetry = Math.max(g.maxRetry, event.retryCount || 0);
  }

  const skills = [...groups.values()].map(g => ({
    host: g.host,
    skillName: g.skillName,
    skillVersion: g.skillVersion,
    invocationCount: g.invocationIds.size || g.invokes,
    invokeEvents: g.invokes,
    loadEvents: g.loads,
    completeEvents: g.completes,
    status: g.status,
    retryMax: g.maxRetry,
    toolEventCount: g.toolEvents,
    skillLoadDurationMs: metric(g.loadDurations),
    activeWindowMs: metric(g.activeWindows),
    attributedToolDurationMs: metric(g.attributedToolDurations),
  })).sort((a, b) => `${a.host}/${a.skillName}`.localeCompare(`${b.host}/${b.skillName}`));

  return {
    schemaVersion: 1,
    eventCount: valid.length,
    invalidEventCount: invalid.length,
    skills,
    semantics: {
      skillLoadDurationMs: 'PreToolUse(Skill) to correlated PostToolUse(Skill); framework/load latency only.',
      activeWindowMs: 'Successful skill load to host Stop/turn boundary; context exposure window, not CPU time.',
      attributedToolDurationMs: 'Sum of host-reported tool durations observed while the skill invocation is active; overlapping skills may each receive the same tool observation.',
    },
  };
}

function markdown(report) {
  const lines = [
    '# Harness Telemetry Report',
    '',
    '| Host | Skill | Invocations | Complete | Failure | Load P50/P95 ms | Active P50/P95 ms | Tool P50/P95 ms |',
    '| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |',
  ];
  for (const row of report.skills) {
    const pair = value => value.count ? `${value.p50}/${value.p95}` : '-';
    lines.push(`| ${row.host} | ${row.skillName || '(unknown)'} | ${row.invocationCount} | ${row.completeEvents} | ${row.status.failure} | ${pair(row.skillLoadDurationMs)} | ${pair(row.activeWindowMs)} | ${pair(row.attributedToolDurationMs)} |`);
  }
  lines.push('', `Events: ${report.eventCount}; invalid lines: ${report.invalidEventCount}.`);
  lines.push('', '> Active window is not CPU/runtime. Attributed tool time is observational and non-exclusive when skills overlap.');
  return `${lines.join('\n')}\n`;
}

function option(args, name) {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : null;
}

function main() {
  try {
    const args = process.argv.slice(2);
    const workspace = option(args, '--workspace');
    const file = option(args, '--file') || (workspace ? telemetryFile(path.resolve(workspace), { cwd: workspace }) : null);
    if (!file) throw new Error('Usage: report.js --file <events.jsonl> [--markdown] or --workspace <root>');
    const report = buildReport(readEvents(path.resolve(file)));
    process.stdout.write(args.includes('--markdown') ? markdown(report) : `${JSON.stringify(report, null, 2)}\n`);
  } catch (error) {
    console.error(`[telemetry] ${error.message}`);
    process.exitCode = 1;
  }
}

if (require.main === module) main();

module.exports = { buildReport, markdown, metric, percentile };
