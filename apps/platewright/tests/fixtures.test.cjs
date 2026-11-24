'use strict';
// Both fixtures pass scripts/check-fixtures.cjs, and the reference household reads as intended.
const test = require('node:test');
const assert = require('node:assert/strict');
const {run} = require('../scripts/check-fixtures.cjs');
const {fixture} = require('./harness.cjs');
const P = 'platewright.';

test('fixtures pass the consistency checks and match their declared counts', () => {
  const report = run();
  assert.deepEqual(report.results.map(r => [r.file, r.problems]), [['fixtures/minimal.json', []], ['fixtures/reference.json', []]]);
  assert.equal(report.declared_counts.passed, true, report.declared_counts.detail);
  assert.equal(report.passed, true);
});

test('the reference household: Saturday\'s guests, a stale list after Friday changed, and reads that write nothing', () => {
  const f = fixture({seed: require('../fixtures/reference.json')}), before = JSON.stringify(f.data);
  const six = f.call(P + 'recipes.get', {id: 'rec-green-curry', servings: 6}).recipe;
  assert.deepEqual(six.lines.slice(0, 2).map(l => [l.quantity, l.unit]), [[1050, 'ml'], [9, 'tbsp']]);
  assert.deepEqual([six.revision, six.lines[5].quantity], [2, 6]);
  const sat = f.call(P + 'plan.get', {start: '2026-11-14', end: '2026-11-14'}).slots.find(s => s.meal === 'dinner');
  assert.deepEqual([sat.default_servings, sat.flags.map(x => x.id + ':' + x.verdict)], [6, ['guest-ines:unsuitable', 'guest-maya:unsafe']]);
  const list = f.call(P + 'shopping.get', {}).list;
  assert.deepEqual([list.stale, list.start, list.end, list.lines.filter(l => l.state === 'ticked').length, list.lines.filter(l => l.kind === 'manual').length], [true, '2026-11-09', '2026-11-15', 2, 2]);
  const variants = f.call(P + 'recipes.search', {query: 'curry', limit: 100}).items.filter(r => r.variant_of === 'rec-green-curry');
  assert.deepEqual(variants.map(v => [v.id, f.call(P + 'recipes.get', {id: v.id}).recipe.variant.stale_base]).sort(),
    [['rec-green-curry-with-tamari', true], ['rec-nut-free-green-curry', false]]);
  assert.equal(f.call(P + 'notifications.list', {}).notifications.length, 14);
  assert.equal(JSON.stringify(f.data), before);
});
