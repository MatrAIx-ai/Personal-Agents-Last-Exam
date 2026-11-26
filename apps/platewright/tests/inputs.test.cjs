'use strict';
// Business suite: every tool on the reduced input table and the extreme numbers that matter most on
// the reference household (tests/inputs-table.cjs). The full tables run in the deep suite
// (tests/inputs.deep.test.cjs, `npm run test:deep`).
const test = require('node:test');
const assert = require('node:assert/strict');
const tools = require('../tools.json');
const {fixture} = require('./harness.cjs');
const {REDUCED, sweep, swap, extremeChains, runChains} = require('./inputs-table.cjs');

test('all 22 tools answer a reduced table of schema-valid input with a valid result or a documented refusal', () => {
  assert.equal(tools.length, 22);
  const {sent, perTool, failures} = sweep(REDUCED);
  assert.ok(sent > 400, `only ${sent} inputs were sent`);
  assert.deepEqual(Object.entries(perTool).filter(([, n]) => !n), [], 'every tool is sent input');
  assert.deepEqual(failures, []);
});

// Every kind of chain at 1e300, and the swap ratio at 1e-7 (a ratio that small used to round a
// quantity down to zero); the bounds themselves follow.
test('extreme numbers on the reference household give a valid result or a documented refusal', () => {
  const rows = extremeChains([1e300, 1e-7]).filter(([kind, n]) => n === 1e300 || kind.startsWith('swap'));
  assert.equal(rows.length, 10);
  assert.deepEqual(runChains(rows), []);
  // The bounds themselves: a ratio of 1e300 used to overflow the scaled quantities to Infinity.
  const f = fixture({seed: require('../fixtures/reference.json'), logging: false});
  assert.equal(f.refuse('platewright.recipes.variant.preview', swap(1e300)), 'invalid_quantity');
  assert.equal(f.refuse('platewright.recipes.variant.create', swap(1e300)), 'invalid_quantity');
  assert.equal(f.refuse('platewright.recipes.variant.create', swap(1e-7)), 'invalid_quantity');
  assert.equal(f.refuse('platewright.pantry.set', {id: 'ing-butter', quantity: 1000001, unit: 'g'}), 'invalid_quantity');
  assert.equal(f.call('platewright.recipes.variant.create', swap(100)).state, 'active');
  assert.equal(f.call('platewright.pantry.set', {id: 'ing-butter', quantity: 1000000, unit: 'g'}).quantity, 1000000);
});
