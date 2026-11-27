'use strict';
// Walkthrough on fresh synthetic data: Evan says he wants no cilantro from tomorrow. The taco night
// tonight is still fine for him and tomorrow's is not; the plan's flags follow the date of the meal.
const assert = require('node:assert/strict');
const {fixture} = require('../tests/harness.cjs');
const f = fixture();
const check = date => f.call('platewright.recipes.check', {id: 'rec-black-bean-tacos', date, members: ['person-evan']}).verdicts[0];
const before = check('2026-11-09');
f.event(require('./scenario.json'));
const tonight = check('2026-11-08'), tomorrow = check('2026-11-09');
assert.deepEqual([before.verdict, tonight.verdict, tomorrow.verdict], ['ok', 'ok', 'disliked']);
const slot = f.call('platewright.plan.get', {start: '2026-11-09', end: '2026-11-09'}).slots[0];
const evan = slot.flags.find(x => x.type === 'person' && x.id === 'person-evan');
assert.equal(evan.verdict, 'disliked');
console.log(JSON.stringify({app: 'platewright',
  evan_tacos: {before_event: before.verdict, on_2026_11_08: tonight.verdict, on_2026_11_09: tomorrow.verdict, lines: tomorrow.findings[0].lines},
  slot_flags_2026_11_09: slot.flags.map(x => ({type: x.type, id: x.id, verdict: x.verdict})),
  notifications: f.data.notifications, activity: f.data.activity}, null, 2));
