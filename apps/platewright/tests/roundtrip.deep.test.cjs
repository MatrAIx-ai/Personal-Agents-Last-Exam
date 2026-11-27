'use strict';
// Deep suite: every record read from the reference household, one per shape and state, is written back
// to the tool that writes it (tests/roundtrip-table.cjs).
const test = require('node:test');
const assert = require('node:assert/strict');
const {CASES, writeBack} = require('./roundtrip-table.cjs');

test('every record read from the reference household is written back unchanged or refused for its state', () => {
  const {failures, outcomes} = writeBack('reference');
  assert.deepEqual(failures, []);
  // On the reference household every pair meets records, and each write but plan.slot.mark (only
  // cooked meals carry portions) and the unchanged recipe goes through for some of them.
  for (const [index, [read, , write]] of CASES.entries()) {
    assert.ok(Object.keys(outcomes[index]).length, `${read} -> ${write} met no record`);
    if (write !== 'plan.slot.mark' && index !== 2) assert.ok(outcomes[index].ok > 0, `${read} -> ${write}: nothing was written back`);
  }
});
