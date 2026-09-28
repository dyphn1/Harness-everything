'use strict';
const fs = require('fs');
const path = require('path');
fs.writeFileSync(path.join(process.cwd(), '.fixture-setup-ok'), 'ok\n');
