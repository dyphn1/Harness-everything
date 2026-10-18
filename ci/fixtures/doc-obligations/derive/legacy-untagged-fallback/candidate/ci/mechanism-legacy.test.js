test('REQ-GRPH-001 check', () => {
  assert.equal(run(), 1);
});
test('ordinary check', () => {
  assert.equal(other(), 2);
});
