#!/usr/bin/env node
'use strict';
// Compatibility no-op: mutation reservations were removed by #190.
const { readHookInput } = require('./lib/workflow-runtime');
readHookInput(() => {});
