'use strict';
// The committed coverage report (evidence/coverage.json and coverage.md)
// matches a fresh run of scripts/coverage-report.cjs over the committed seeds,
// and the delivered data covers every month of 2025-01..2026-12.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {report, markdown} = require('../scripts/coverage-report.cjs');
const dataset = require('../contribution/dataset.json');

const root = path.resolve(__dirname, '..');
const r = report();

test('the committed coverage report matches a fresh run', () => {
  assert.equal(fs.readFileSync(path.join(root, 'evidence/coverage.json'), 'utf8'), JSON.stringify(r, null, 2) + '\n');
  assert.equal(fs.readFileSync(path.join(root, 'evidence/coverage.md'), 'utf8'), markdown(r));
});

test('every month of the window has records, through December 2026', () => {
  assert.equal(r.time_zone, 'America/New_York');
  assert.deepEqual(r.global_gaps, []);
  assert.equal(r.totals.months_with_records, 24);
  assert.ok(r.totals.earliest >= '2025-01-01' && r.totals.latest >= '2026-12-01' && r.totals.latest <= '2026-12-31');
  assert.equal(r.totals.excluded, 0);
});

test('each seed in the report carries the SHA-256 dataset.json records, and all data is synthetic', () => {
  for (const s of r.seeds) {
    const source = dataset.sources.find(x => x.generation.parameters.seed_id === s.seed_id);
    assert.equal(s.sha256, source.generation.parameters.sha256, s.seed_id);
    assert.equal(source.kind, 'synthetic');
    assert.equal(source.generation.parameters.provenance.human_read_through, 'pending');
    assert.equal(s.real_records, 0);
  }
  assert.equal(dataset.review.status, 'pending');
});
