'use strict';
// Deliberately synthetic transport fixture, never model-quality evidence.
const mode = process.argv[2];
if (mode === 'timeout') setInterval(() => {}, 1000);
else if (mode === 'overflow') process.stdout.write('x'.repeat(2 * 1024 * 1024));
else if (mode === 'exit') process.exit(3);
else if (mode === 'invalid') console.log('not-json');
else { let input = ''; process.stdin.on('data', c => { input += c; }); process.stdin.on('end', () => {
  const req = JSON.parse(input);
  console.log(JSON.stringify({ schemaVersion: 1, requestHash: req.requestHash, catalogHash: req.catalogHash,
    model: { id: 'fixture', revision: 'fixture-v1', domain: mode === 'forms' ? 'forms-v1' : 'harness-routing-v1' },
    scores: req.options.map((o, i) => ({ id: o.id, probability: i === 0 ? 1 : 0 })) }));
}); }
