#!/usr/bin/env node
'use strict';

const RETIRED_MESSAGE = 'E1 pilot retired. Finish on the previous release or start a new session.';

function main(_argv = []) {
  throw new Error(RETIRED_MESSAGE);
}

if (require.main === module) {
  try {
    main(process.argv.slice(2));
  } catch (error) {
    console.error('[W6 State Operation] ' + error.message);
    process.exitCode = 2;
  }
}

module.exports = { main };
