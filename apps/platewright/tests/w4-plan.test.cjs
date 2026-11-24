'use strict';
// W4 weekly meal plan: T11 setting, replacing and clearing slots, default servings, flags;
// T12 cooked and skipped slots, leftovers and the date rules.
const test = require('node:test');
const assert = require('node:assert/strict');
const {fixture} = require('./harness.cjs');

const P = 'platewright.';
const MAYA = {guest_id: 'guest-maya', name: 'Maya', constraints: [{kind: 'allergy', allergen: 'tree_nut', strict: true}]};
const GUESTS = [MAYA, {guest_id: 'guest-ines', name: 'Ines', constraints: [{kind: 'diet', diet: 'vegetarian'}]},
  {guest_id: 'guest-kofi', name: 'Kofi', constraints: []}, {guest_id: 'guest-lea', name: 'Lea', constraints: []}];
const SAT = '2026-11-14:dinner';
const slotOf = (f, id) => f.call(P + 'plan.get', {start: id.slice(0, 10), end: id.slice(0, 10)}).slots.find(s => s.id === id);
const person = (slot, id) => slot.flags.find(x => x.type === 'person' && x.id === id);

test('T11 set, replace and clear slots; default servings; flags per person; a wrong dish is planned, not refused', () => {
  const f = fixture();
  // Two members (factors 1 + 1) and four guests: 6 servings by default.
  const set = f.call(P + 'plan.slot.set', {id: SAT, dishes: [{recipe_id: 'rec-green-curry'}], attendees: ['person-nora', 'person-eli'], guests: GUESTS});
  assert.deepEqual([set.id, set.state, set.default_servings], [SAT, 'planned', 6]);
  let slot = slotOf(f, SAT);
  assert.deepEqual([slot.state, slot.phase, slot.dishes[0].servings, slot.dishes[0].servings_source], ['planned', 'upcoming', 6, 'default']);
  // The nut-allergic guest is flagged unsafe with the line behind it, and the slot is still planned.
  const maya = person(slot, 'guest-maya');
  assert.equal(maya.verdict, 'unsafe');
  assert.deepEqual(maya.dishes[0].findings.find(x => x.reason === 'may_contain_allergen').lines, [{line: 1, ingredient_id: 'ing-green-curry-paste', optional: false}]);
  assert.equal(person(slot, 'guest-ines').verdict, 'unsuitable');
  assert.equal(person(slot, 'guest-kofi'), undefined, 'only people whose verdict is not ok are flagged');
  assert.deepEqual(set.flags, slot.flags, 'the write returns the same flags a read shows');
  // The nut-free variant (paste from a nut-free kitchen, sunflower seeds for cashews) clears her flag.
  const variant = f.call(P + 'recipes.variant.create', {id: 'rec-green-curry', title: 'Nut-free green curry',
    swaps: [{ingredient_id: 'ing-green-curry-paste', rule_id: 'rule-paste-nut-free'}, {ingredient_id: 'ing-cashews', rule_id: 'rule-cashews-sunflower'}]});
  const replaced = f.call(P + 'plan.slot.set', {id: SAT, dishes: [{recipe_id: variant.id}], attendees: ['person-nora', 'person-eli'], guests: GUESTS});
  slot = slotOf(f, SAT);
  assert.equal(person(slot, 'guest-maya'), undefined);
  assert.equal(replaced.state, 'planned');
  assert.deepEqual(slot.history.map(h => h.action), ['set', 'replaced']);
  // An explicit number of servings replaces the default; attendees default to every member.
  f.call(P + 'plan.slot.set', {id: '2026-11-12:dinner', dishes: [{recipe_id: 'rec-shakshuka', servings: 5}]});
  const thu = slotOf(f, '2026-11-12:dinner');
  assert.deepEqual([thu.attendees, thu.default_servings, thu.dishes[0].servings, thu.dishes[0].servings_source],
    [['person-nora', 'person-evan', 'person-eli', 'person-ada'], 4, 5, 'explicit']);
  // Default servings round up to a half: Evan 1.5 + Ada 0.5 + one guest = 3; Evan + Ada = 2; Ada alone 0.5.
  f.call(P + 'plan.slot.set', {id: '2026-11-13:lunch', dishes: [{recipe_id: 'rec-yogurt-parfait'}], attendees: ['person-ada']});
  assert.equal(slotOf(f, '2026-11-13:lunch').default_servings, 0.5);
  // Clearing: no dishes leaves the slot cleared with its history; setting it again plans it.
  const cleared = f.call(P + 'plan.slot.set', {id: '2026-11-12:dinner', dishes: []});
  assert.equal(cleared.state, 'cleared');
  const c = slotOf(f, '2026-11-12:dinner');
  assert.deepEqual([c.state, c.dishes, c.flags, c.history.map(h => h.action)], ['cleared', [], [], ['set', 'cleared']]);
  assert.equal(f.call(P + 'plan.slot.set', {id: '2026-11-12:dinner', dishes: [{recipe_id: 'rec-shakshuka'}]}).state, 'planned');
  assert.deepEqual(slotOf(f, '2026-11-12:dinner').history.map(h => h.action), ['set', 'cleared', 'set']);
  // A skipped slot can be planned again.
  f.call(P + 'plan.slot.mark', {id: '2026-11-10:dinner', status: 'skipped'});
  assert.equal(f.call(P + 'plan.slot.set', {id: '2026-11-10:dinner', dishes: [{recipe_id: 'rec-banana-bread'}]}).state, 'planned');
  // An archived recipe is planned and flagged.
  f.call(P + 'recipes.update', {id: 'rec-banana-bread', patch: {archived: true}});
  assert.deepEqual(slotOf(f, '2026-11-10:dinner').flags.filter(x => x.type === 'archived_recipe'), [{type: 'archived_recipe', dish: 0, recipe_id: 'rec-banana-bread'}]);
  // Refusals: unknown recipe or member, servings out of range, clearing what is not planned; nothing changes.
  const before = f.data;
  assert.equal(f.refuse(P + 'plan.slot.set', {id: '2026-11-16:dinner', dishes: [{recipe_id: 'rec-nope'}]}), 'not_found');
  assert.equal(f.refuse(P + 'plan.slot.set', {id: '2026-11-16:dinner', dishes: [{recipe_id: 'rec-shakshuka'}], attendees: ['person-zed']}), 'unknown_member');
  assert.equal(f.refuse(P + 'plan.slot.set', {id: '2026-11-16:dinner', dishes: [{recipe_id: 'rec-shakshuka', servings: 0}]}), 'invalid_servings');
  assert.equal(f.refuse(P + 'plan.slot.set', {id: '2026-11-16:dinner', dishes: []}), 'not_found');
  assert.equal(f.refuse(P + 'plan.slot.set', {id: '2026-11-12:dinner', dishes: [{recipe_id: 'rec-shakshuka'}], attendees: ['person-eli', 'person-eli']}), 'invalid_arguments');
  assert.equal(f.refuse(P + 'plan.slot.set', {id: '2026-02-30:dinner', dishes: [{recipe_id: 'rec-shakshuka'}]}), 'invalid_arguments');
  f.call(P + 'plan.slot.set', {id: '2026-11-16:dinner', dishes: [{recipe_id: 'rec-shakshuka'}]});
  f.call(P + 'plan.slot.mark', {id: '2026-11-16:dinner', status: 'skipped'});
  const mid = f.data;
  assert.equal(f.refuse(P + 'plan.slot.set', {id: '2026-11-16:dinner', dishes: []}), 'invalid_state');
  assert.deepEqual(f.data, mid);
  assert.notDeepEqual(before, mid);
  // The default week window starts on the household's week start (Monday 2026-11-02 for Sunday 2026-11-08).
  const week = f.call(P + 'plan.get', {});
  assert.deepEqual([week.start, week.end, week.today], ['2026-11-02', '2026-11-08', '2026-11-08']);
  assert.deepEqual(week.slots.map(s => [s.id, s.state, s.phase]), [['2026-11-05:lunch', 'cleared', 'past'], ['2026-11-07:dinner', 'cooked', 'past']]);
  assert.equal(f.refuse(P + 'plan.get', {start: '2026-11-10', end: '2026-11-01'}), 'invalid_window');
  assert.equal(f.refuse(P + 'plan.get', {start: '2026-11-01', end: '2026-12-31'}), 'invalid_window');
});

test('T12 cooked and skipped; leftovers available, short, expired and unavailable; cooked slots cannot change; not_yet and past_slot', () => {
  const f = fixture();
  // Saturday: 8 servings for 2 members and 4 guests (6 portions), so 2 are left while planned.
  f.call(P + 'plan.slot.set', {id: SAT, dishes: [{recipe_id: 'rec-green-curry', servings: 8}], attendees: ['person-nora', 'person-eli'], guests: GUESTS.slice(1)});
  let sat = slotOf(f, SAT);
  assert.deepEqual(sat.leftovers, [{recipe_id: 'rec-green-curry', portions_left: 3, taken_by: [], unclaimed: 3, usable_until: '2026-11-17'}],
    'planned: 8 servings minus 5 default portions');
  f.call(P + 'plan.slot.set', {id: '2026-11-15:lunch', dishes: [{leftovers_of: SAT, portions: 2}], attendees: ['person-nora', 'person-evan']});
  let sun = slotOf(f, '2026-11-15:lunch');
  assert.deepEqual([sun.dishes[0].kind, sun.dishes[0].recipe_id, sun.dishes[0].portions], ['leftovers', 'rec-green-curry', 2]);
  assert.equal(sun.flags.filter(x => x.type.startsWith('leftover')).length, 0);
  // Taking more than is left reads leftover_short on the later slot.
  f.call(P + 'plan.slot.set', {id: '2026-11-16:lunch', dishes: [{leftovers_of: SAT, recipe_id: 'rec-green-curry', portions: 2}], attendees: ['person-evan']});
  const mon = slotOf(f, '2026-11-16:lunch');
  assert.deepEqual(mon.flags.filter(x => x.type === 'leftover_short'), [{type: 'leftover_short', dish: 0, recipe_id: 'rec-green-curry', leftovers_of: SAT, planned: 2, available: 1}]);
  assert.equal(slotOf(f, '2026-11-15:lunch').flags.filter(x => x.type === 'leftover_short').length, 0, 'the earlier take is covered');
  // Older than leftover_max_days (3) on the day they are planned for.
  f.call(P + 'plan.slot.set', {id: '2026-11-18:lunch', dishes: [{leftovers_of: SAT, portions: 1}], attendees: ['person-ada']});
  const wed = slotOf(f, '2026-11-18:lunch');
  assert.deepEqual(wed.flags.filter(x => x.type === 'leftover_expired'), [{type: 'leftover_expired', dish: 0, recipe_id: 'rec-green-curry', leftovers_of: SAT, age_days: 4, leftover_max_days: 3}]);
  // Leftovers are checked against the person who eats them: Evan is over his cap on the leftover lunch too.
  assert.equal(person(slotOf(f, '2026-11-15:lunch'), 'person-evan').verdict, 'over_limit');
  // leftover_unavailable: from a later slot, from a slot that is only leftovers, from nothing, from a skipped slot.
  const before = f.data;
  const take = (id, from, extra = {}) => f.refuse(P + 'plan.slot.set', {id, dishes: [{leftovers_of: from, portions: 1, ...extra}]});
  assert.equal(take('2026-11-13:dinner', SAT), 'leftover_unavailable');
  assert.equal(take(SAT.replace('dinner', 'lunch'), SAT), 'leftover_unavailable', 'lunch is earlier than dinner on the same day');
  assert.equal(take('2026-11-17:dinner', '2026-11-15:lunch'), 'leftover_unavailable');
  assert.equal(take('2026-11-17:dinner', '2026-11-11:dinner'), 'leftover_unavailable');
  assert.equal(take('2026-11-17:dinner', SAT, {recipe_id: 'rec-shakshuka'}), 'leftover_unavailable');
  assert.equal(take('2026-11-17:dinner', SAT, {portions: 0}), 'invalid_quantity');
  f.call(P + 'plan.slot.mark', {id: '2026-11-10:dinner', status: 'skipped'});
  const skipped = f.data;
  assert.equal(take('2026-11-17:dinner', '2026-11-10:dinner'), 'leftover_unavailable');
  assert.deepEqual(f.data, skipped);
  assert.notDeepEqual(before, skipped);
  // A future slot cannot be marked cooked.
  assert.equal(f.refuse(P + 'plan.slot.mark', {id: SAT, status: 'cooked'}), 'not_yet');
  // Saturday evening: cook it, recording portions; Sunday's lunch can take 2 of what is left.
  f.advance('2026-11-14T20:30:00-05:00');
  assert.equal(f.refuse(P + 'plan.slot.mark', {id: SAT, status: 'cooked', portions: [{recipe_id: 'rec-green-curry', made: 4, eaten: 6}]}), 'invalid_quantity');
  assert.equal(f.refuse(P + 'plan.slot.mark', {id: SAT, status: 'cooked', portions: [{recipe_id: 'rec-shakshuka', made: 4}]}), 'invalid_arguments');
  const cooked = f.call(P + 'plan.slot.mark', {id: SAT, status: 'cooked', portions: [{recipe_id: 'rec-green-curry', made: 8, eaten: 5}]});
  assert.deepEqual([cooked.state, cooked.portions, cooked.deducted, cooked.short], ['cooked', [{recipe_id: 'rec-green-curry', revision: 1, made: 8, eaten: 5}], false, []]);
  sat = slotOf(f, SAT);
  assert.deepEqual([sat.state, sat.phase, sat.cooked.portions[0].eaten, sat.leftovers[0].portions_left, sat.leftovers[0].unclaimed], ['cooked', 'upcoming', 5, 3, 0]);
  sun = slotOf(f, '2026-11-15:lunch');
  assert.equal(sun.flags.filter(x => x.type === 'leftover_short').length, 0);
  // Default portions eaten: the attendees' portion sum.
  f.call(P + 'plan.slot.set', {id: '2026-11-14:lunch', dishes: [{recipe_id: 'rec-black-bean-tacos'}], attendees: ['person-evan', 'person-ada']});
  assert.deepEqual(f.call(P + 'plan.slot.mark', {id: '2026-11-14:lunch', status: 'cooked'}).portions, [{recipe_id: 'rec-black-bean-tacos', revision: 1, made: 2, eaten: 2}]);
  // A cooked slot cannot change, be cleared or be marked again.
  const done = f.data;
  assert.equal(f.refuse(P + 'plan.slot.set', {id: SAT, dishes: [{recipe_id: 'rec-shakshuka'}]}), 'invalid_state');
  assert.equal(f.refuse(P + 'plan.slot.set', {id: SAT, dishes: []}), 'invalid_state');
  assert.equal(f.refuse(P + 'plan.slot.mark', {id: SAT, status: 'skipped'}), 'invalid_state');
  assert.equal(f.refuse(P + 'plan.slot.mark', {id: '2026-11-10:dinner', status: 'cooked'}), 'invalid_state', 'a skipped slot is not cooked');
  assert.equal(f.refuse(P + 'plan.slot.mark', {id: '2026-11-19:dinner', status: 'skipped'}), 'not_found');
  // A slot whose date has passed cannot be set or cleared; it reads past.
  assert.equal(f.refuse(P + 'plan.slot.set', {id: '2026-11-13:dinner', dishes: [{recipe_id: 'rec-shakshuka'}]}), 'past_slot');
  assert.equal(f.refuse(P + 'plan.slot.set', {id: '2026-11-09:dinner', dishes: []}), 'past_slot');
  assert.deepEqual(f.data, done);
  assert.equal(slotOf(f, '2026-11-09:dinner').phase, 'past');
  // A past planned slot that was never marked can still be marked cooked late; skipped needs no date check.
  assert.equal(f.call(P + 'plan.slot.mark', {id: '2026-11-09:dinner', status: 'cooked'}).state, 'cooked');
  // Clock passes the end of Saturday: the cooked slot reads past.
  f.advance('2026-11-15T00:00:00-05:00');
  assert.equal(slotOf(f, SAT).phase, 'past');
  // Clearing or replacing a leftover source is allowed; the later slot then reads leftover_short with nothing available.
  f.call(P + 'plan.slot.set', {id: '2026-11-15:dinner', dishes: [{recipe_id: 'rec-red-lentil-soup', servings: 6}], attendees: ['person-nora']});
  f.call(P + 'plan.slot.set', {id: '2026-11-16:dinner', dishes: [{leftovers_of: '2026-11-15:dinner', portions: 2}], attendees: ['person-nora']});
  assert.equal(slotOf(f, '2026-11-16:dinner').flags.filter(x => x.type === 'leftover_short').length, 0);
  f.call(P + 'plan.slot.set', {id: '2026-11-15:dinner', dishes: []});
  assert.deepEqual(slotOf(f, '2026-11-16:dinner').flags.filter(x => x.type === 'leftover_short').map(x => [x.planned, x.available]), [[2, 0]]);
  // Flags recomputed from a snapshot match what plan.get shows.
  const fromSnapshot = require('../plugin.cjs').flagsFromSnapshot(f.data);
  assert.deepEqual(fromSnapshot['2026-11-16:lunch'], slotOf(f, '2026-11-16:lunch').flags);
});
