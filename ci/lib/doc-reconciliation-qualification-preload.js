'use strict';

// #325 Phase 3b F4 CI-only qualification preloader (docs/doc-workflow-reconciliation.md, F4 "Test transport").
//
// Loaded only by the test driver: `node --require <this file> <real entry> ...`. It is not packaged, no
// production code reads it, and no environment or argv switch enables it.
//
// Boundary: it supplies only the explicitly fake qualification object through the origin-provider factory,
// and only when the caller omitted qualification. It never touches the snapshot, resolveEvent outcomes,
// principals, capability, accepted records or core eligibility.

const fs = require('fs');
const path = require('path');

const FAKE_QUALIFICATION = Object.freeze({
  source: 'fake-test-fixture',
  faked: true,
  ref: 'ci-qualification-preload',
  toolUseIdPopulated: true,
  agentIdPopulated: true,
});

// The entry decides which provider copy is patched, so the canonical and packaged legs are each covered.
const entry = process.argv[1] ? path.resolve(process.argv[1]) : '';
const providerFile = path.join(path.dirname(entry), 'lib', 'doc-reconciliation-provider.js');

if (fs.existsSync(providerFile)) {
  const provider = require(providerFile);
  const factory = provider.createClaudeOriginProvider;
  provider.createClaudeOriginProvider = input => {
    const safe = input && typeof input === 'object' && !Array.isArray(input) ? input : {};
    return factory({
      ...safe,
      qualification: safe.qualification === undefined ? FAKE_QUALIFICATION : safe.qualification,
    });
  };
}
