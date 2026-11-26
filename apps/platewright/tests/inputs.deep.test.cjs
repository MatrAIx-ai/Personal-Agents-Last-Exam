'use strict';
// Deep suite: the full input tables of tests/inputs-table.cjs (4,175 inputs to the 22 tools, and every
// extreme number in every chain on the reference household).
const test = require('node:test');
const assert = require('node:assert/strict');
const tools = require('../tools.json');
const {FULL, sweep, extremeChains, runChains} = require('./inputs-table.cjs');

test('all 22 tools answer schema-valid input with a valid result or a documented refusal', () => {
  assert.equal(tools.length, 22);
  const {sent, failures} = sweep(FULL);
  assert.ok(sent > 1000, `only ${sent} inputs were sent`);
  assert.deepEqual(failures, []);
});

test('extreme numbers on the reference household give a valid result or a documented refusal (every number, every chain)', () => {
  const rows = extremeChains();
  assert.equal(rows.length, 72);
  assert.deepEqual(runChains(rows), []);
});
