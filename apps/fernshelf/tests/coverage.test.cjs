'use strict';
// The committed dataset coverage report (evidence/coverage/report.{json,md}) is the one
// scripts/coverage-report.cjs computes from the reference fixture as the App loads it.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path');
const {build, markdown} = require('../scripts/coverage-report.cjs');

test('committed coverage report matches the reference fixture', () => {
  const r = build(), dir = path.join(__dirname, '../evidence/coverage');
  assert.equal(fs.readFileSync(path.join(dir, 'report.json'), 'utf8'), JSON.stringify(r, null, 2) + '\n');
  assert.equal(fs.readFileSync(path.join(dir, 'report.md'), 'utf8'), markdown(r));
  assert.equal(r.exclusions.length, 0);
  assert.equal(r.after_clock.history_records_after_clock, 0, 'no history is dated after the fixture clock');
  assert.equal(r.provenance.real_records, 0);
});
