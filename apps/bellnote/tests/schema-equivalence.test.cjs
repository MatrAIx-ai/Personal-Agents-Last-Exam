'use strict';
// The published seed schema has its definitions inlined (scripts/build-contracts.cjs). These tests
// show it means the same as the schema written with `$defs` and file references: structurally (the
// references resolved by pointer give the published schema) and in behaviour (Core's validator gives
// the same answer for both on the fixtures and on mutated copies of them).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {compile} = require('./schema-validator.cjs');
const {seed, seedPublished} = require('../scripts/build-contracts.cjs');
const {resolveRefs, withDefsOnDisk, mutants} = require('./seed-mutants.cjs');
const plugin = require('../plugin.cjs');
const binding = require('../fixtures/binding.json');
const pkg = path.resolve(__dirname, '..');
const published = JSON.parse(fs.readFileSync(path.join(pkg, 'schemas/seed.schema.json'), 'utf8'));

test('the published seed schema is the $defs schema with its references resolved', () => {
  assert.ok(seed.$defs && JSON.stringify(seed).includes('seed.schema.json#/$defs/'));
  assert.ok(!JSON.stringify(published).includes('$ref') && !('$defs' in published));
  assert.deepEqual(published, seedPublished);
  assert.deepEqual(published, resolveRefs(seed));
});

test('Core\'s validator answers the same for both seed schema forms on fixtures and mutated copies', () => {
  const disk = withDefsOnDisk(seed);
  try {
    const withDefs = compile(JSON.parse(fs.readFileSync(path.join(disk.dir, 'seed.schema.json'), 'utf8')), disk.dir);
    const inlined = compile(published, path.join(pkg, 'schemas'));
    const counts = {valid: 0, invalid: 0};
    const same = (doc, label) => {
      const a = withDefs(doc), b = inlined(doc);
      assert.equal(b, a, label);
      counts[a ? 'valid' : 'invalid']++;
    };
    const minimal = require('../fixtures/minimal.json'), reference = require('../fixtures/reference.json');
    same(minimal, 'minimal'); same(reference, 'reference');
    mutants(minimal, 1500, 1).forEach((doc, i) => same(doc, 'minimal mutant ' + i));
    mutants(reference, 60, 2).forEach((doc, i) => same(doc, 'reference mutant ' + i));
    // Both outcomes are exercised, so agreement is not agreement on "always invalid".
    assert.ok(counts.valid > 100 && counts.invalid > 500, JSON.stringify(counts));
  } finally { disk.cleanup(); }
});

test('validateSeed names the first timestamp without a UTC offset', () => {
  const data = structuredClone(require('../fixtures/minimal.json'));
  const i = data.attendance.findIndex(a => typeof a.marked_at === 'string');
  data.attendance[i].marked_at = data.attendance[i].marked_at.replace(/(Z|[+-]\d{2}:\d{2})$/, '');
  data.attendance[i].history.push({at: '2026-11-17T08:00:00', action: 'later'});
  const ctx = {app_id: 'bellnote', binding, virtual_now: require('../fixtures/clock.json').initial_time, run_id: 'x', role: 'agent'};
  assert.throws(() => plugin.validateSeed(ctx, data), {code: 'invalid_seed', message: 'Timestamp without a UTC offset at data.attendance[' + i + '].marked_at'});
  assert.doesNotThrow(() => plugin.validateSeed(ctx, require('../fixtures/minimal.json')));
});
