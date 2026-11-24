'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { createV2Driver } = require('./lib/opencode-v2-driver');

const FAILING_TEST = { test: 'node -e "process.exit(1)"' };
// Optional override so the mutation check can point at a scratch plugin copy.
const PLUGIN = process.env.OPENCODE_V2_DRIVER_PLUGIN || undefined;

async function editCycle(d, sessionID, id) {
  const file = path.join(d.workspace, 'a.js');
  await d.toolHook('execute.before')({ tool: 'edit', sessionID, id: `b-${id}`, input: { filePath: file } });
  await d.toolHook('execute.after')({ tool: 'edit', sessionID, id: `a-${id}`, status: 'completed', input: { filePath: file }, result: {} });
}

test('453 row 1: setup captures V2 hooks; teardown disposes them and ends the stream', async () => {
  const d = await createV2Driver({ plugin: PLUGIN, scripts: FAILING_TEST });
  assert.ok(d.toolHook('execute.before') && d.toolHook('execute.after'));
  assert.ok(d.sessionHook('prompt') && d.sessionHook('context'));
  assert.equal(d.subscribeCount(), 1);
  assert.equal(d.eventStreamEnded(), false);
  await d.teardown();
  assert.equal(d.eventStreamEnded(), true);
});

test('453 row 2: edit then session.execution.succeeded delivers the verification reminder', async () => {
  const d = await createV2Driver({ plugin: PLUGIN, scripts: FAILING_TEST });
  try {
    await editCycle(d, 's1', 1);
    d.emit('session.execution.succeeded', 's1');
    await d.waitFor(() => d.prompts.length >= 1, { label: 'verification reminder prompt' });
    assert.equal(d.prompts.length, 1);
    assert.equal(d.prompts[0].sessionID, 's1');
    assert.match(d.prompts[0].text, /verification failed/i);
  } finally {
    await d.teardown();
  }
});

test('453 row 3: session.execution.succeeded without an edit sends no prompt', async () => {
  const d = await createV2Driver({ plugin: PLUGIN, scripts: FAILING_TEST });
  try {
    d.emit('session.execution.succeeded', 's1');
    await d.settled();
    assert.equal(d.prompts.length, 0);
  } finally {
    await d.teardown();
  }
});
