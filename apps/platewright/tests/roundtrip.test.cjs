'use strict';
// Business suite: records read from the App are written back unchanged (tests/roundtrip-table.cjs).
// Every pair on the minimal household; on the reference household the pairs the minimal household
// has no record for (meals with guests sent to recipes.check and recipes.variant.preview, the saved
// list's window sent to shopping.generate), and Saturday's dinner. Every pair on the reference
// household runs in the deep suite (tests/roundtrip.deep.test.cjs, `npm run test:deep`).
const test = require('node:test');
const assert = require('node:assert/strict');
const {fixture} = require('./harness.cjs');
const {SEEDS, writeBack, dishOf} = require('./roundtrip-table.cjs');

test('every record read from the minimal household is written back unchanged or refused for its state', () => {
  assert.deepEqual(writeBack('minimal').failures, []);
});

test('meals with guests and the saved list read from the reference household are written back unchanged', () => {
  const pairs = ['recipes.check', 'recipes.variant.preview', 'shopping.generate'];
  const {failures, outcomes} = writeBack('reference', ([, , write]) => pairs.includes(write));
  assert.deepEqual(failures, []);
  assert.equal(outcomes.filter(o => o.ok > 0).length, pairs.length, 'each pair writes back a record');
});

// The meal from the reference household that a person would change: Saturday 14 November 2026's
// dinner, whose guests Ines and Maya have recorded needs that read with no note.
test('Saturday\'s dinner with its guests is changed by sending back what plan.get returned', () => {
  const f = fixture({seed: SEEDS.reference});
  const [slot] = f.call('platewright.plan.get', {start: '2026-11-14', end: '2026-11-14'}).slots.filter(s => s.meal === 'dinner');
  assert.deepEqual(slot.guests.filter(g => g.constraints.length).map(g => [g.name, g.constraints.map(c => c.note)]), [['Ines', [null]], ['Maya', [null]]]);
  const before = f.data.plan.find(s => s.id === slot.id);
  const out = f.call('platewright.plan.slot.set', {id: slot.id, dishes: slot.dishes.map(dishOf), attendees: slot.attendees, guests: slot.guests, note: slot.note});
  assert.equal(out.state, 'planned');
  const after = f.data.plan.find(s => s.id === slot.id);
  // The meal is stored exactly as it was; the change is one history row.
  assert.deepEqual(after.guests, before.guests);
  assert.deepEqual(after.dishes, before.dishes);
  assert.deepEqual(after.attendees, before.attendees);
  assert.equal(after.note, null);
  assert.equal(after.history.length, before.history.length + 1);
  assert.equal(after.history.at(-1).action, 'replaced');
  // A note given as text is still a note, and a guest need without one still reads null.
  f.call('platewright.plan.slot.set', {id: slot.id, dishes: slot.dishes.map(dishOf), attendees: slot.attendees,
    guests: slot.guests.map(g => ({...g, constraints: g.constraints.map(({note, ...c}) => c)})), note: 'Birthday'});
  const read = f.call('platewright.plan.get', {start: '2026-11-14', end: '2026-11-14'}).slots.find(s => s.id === slot.id);
  assert.equal(read.note, 'Birthday');
  assert.deepEqual(read.guests, slot.guests);
});
