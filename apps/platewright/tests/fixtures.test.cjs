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
  // 60 notifications from the generated history since 2025-01-01, then the 14 hand-written ones, which keep their IDs.
  const all = f.call(P + 'notifications.list', {}).notifications;
  assert.deepEqual([all.length, all[0].at.slice(0, 10) >= '2025-01-01', all.filter(n => n.id.startsWith('ntf-h')).length], [74, true, 60]);
  assert.deepEqual(f.call(P + 'notifications.list', {start: '2026-10-12'}).notifications.map(n => n.id), Array.from({length: 14}, (_, i) => 'ntf-' + String(i + 1).padStart(4, '0')));
  assert.equal(JSON.stringify(f.data), before);
});

test('two years of history: reads default to a week or a page, and past slots read from their own date', () => {
  const f = fixture({seed: require('../fixtures/reference.json')});
  const week = f.call(P + 'plan.get', {});
  assert.deepEqual([week.start, week.end], ['2026-11-02', '2026-11-08']);
  assert.equal(f.call(P + 'recipes.search', {}).items.length <= 20, true);
  assert.equal(f.refuse(P + 'plan.get', {start: '2025-01-01', end: '2025-03-31'}), 'invalid_window');
  const first = f.call(P + 'plan.get', {start: '2025-01-01', end: '2025-01-07'}).slots;
  assert.ok(first.length >= 7 && first.every(s => s.phase === 'past' && ['cooked', 'skipped', 'cleared'].includes(s.state) && !s.flags.length));
  // February 2025: Nora's meat-free month (con-nora-h1) is respected by every dinner she sat at.
  const feb = f.call(P + 'plan.get', {start: '2025-02-03', end: '2025-03-02'}).slots.filter(s => s.attendees.includes('person-nora') && s.state === 'cooked' && !s.dishes[0].leftovers_of);
  assert.ok(feb.length > 20 && feb.every(s => f.call(P + 'recipes.check', {id: s.dishes[0].recipe_id, members: ['person-nora'], date: s.date}).verdicts[0].verdict === 'ok'));
  const household = f.call(P + 'household.get', {date: '2025-02-10'}).members.find(m => m.person_id === 'person-nora');
  assert.equal(household.constraints.find(c => c.id === 'con-nora-h1').state, 'active');
});
