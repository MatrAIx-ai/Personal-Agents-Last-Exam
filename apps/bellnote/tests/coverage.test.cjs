'use strict';
// The committed dataset coverage report (evidence/dataset-coverage.{json,md}) is computed from the
// reference fixture by scripts/dataset-coverage.cjs and must match it.
const test = require('node:test');
const assert = require('node:assert/strict');
const coverage = require('../scripts/dataset-coverage.cjs');

test('the committed dataset coverage report matches the reference fixture', () => {
  assert.deepEqual(coverage.check(), []);
  const r = coverage.compute();
  assert.equal(r.totals.records, r.dataset.expected_records, 'every record of contribution/dataset.json is counted');
  assert.equal(r.totals.history_records_in_window + r.totals.scheduled_records_after_clock + r.totals.out_of_window_or_invalid, r.totals.dated_records);
  assert.equal(r.totals.authored + r.totals.generated, r.totals.records);
  assert.equal(r.monthly['2026-12'].records, 0, 'nothing after the dataset clock is reported as history');
});
