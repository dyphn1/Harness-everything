'use strict';

const fs = require('node:fs');

const args = process.argv.slice(2);
const outputFlag = args.indexOf('-o');
const outputPath = outputFlag >= 0 ? args[outputFlag + 1] : null;
const prompt = args.at(-1) || '';
const input = fs.readFileSync(0, 'utf8');

fs.appendFileSync(process.env.DISPATCH_FIXTURE_LOG, `${JSON.stringify({
  args,
  cwd: process.cwd(),
  tmpdir: process.env.TMPDIR,
  stdin: input,
  stdinIsCharacterDevice: fs.fstatSync(0).isCharacterDevice(),
})}\n`);

if (!outputPath) process.exit(2);
fs.writeFileSync(outputPath, prompt === 'Reply exactly with READY.'
  ? 'READY\n'
  : 'Fixture completed the packet.\nSTATUS: DONE\n');
process.stdout.write('fixture child output\n');
