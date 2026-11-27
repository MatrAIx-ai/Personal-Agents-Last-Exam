'use strict';
// Refusals a person can meet in the web interface, which only offers records that exist: each is
// provoked on the reference household, returns its code, and its message names meals, dates,
// recipes, ingredients, people, constraints and shopping lines in words (scripts/check-fixtures.cjs
// unreadable(): no record IDs, slot IDs, ISO dates or vocabulary keys). A refusal about a guest ID
// the caller sent (two guests with one ID, a guest with a member's ID) repeats that ID next to the
// guests' names, since the ID is what the caller has to change; such a case names the ID it expects,
// and the rest of its message is held to the same rule. The page gives each guest an ID of its own,
// so it cannot send these.
const test = require('node:test');
const assert = require('node:assert/strict');
const {fixture} = require('./harness.cjs');
const {unreadable} = require('../scripts/check-fixtures.cjs');
const P = 'platewright.';

const curry = require('../fixtures/reference.json').recipes.find(r => r.id === 'rec-green-curry');
const CASES = [
  // Meal plan
  ['plan.slot.set', {id: '2026-11-05:dinner', dishes: [{recipe_id: 'rec-dal'}]}, 'past_slot'],
  ['plan.slot.set', {id: '2026-11-08:breakfast', dishes: []}, 'invalid_state'],
  ['plan.slot.set', {id: '2026-11-20:dinner', dishes: []}, 'not_found'],
  ['plan.slot.set', {id: '2026-11-14:lunch', dishes: [{leftovers_of: '2026-11-14:dinner', portions: 2}]}, 'leftover_unavailable'],
  ['plan.slot.set', {id: '2026-11-16:lunch', dishes: [{leftovers_of: '2026-11-09:breakfast', portions: 2}]}, 'leftover_unavailable'],
  ['plan.slot.set', {id: '2026-11-11:lunch', dishes: [{leftovers_of: '2026-11-09:dinner', recipe_id: 'rec-dal', portions: 1}]}, 'leftover_unavailable'],
  ['plan.slot.set', {id: '2026-11-16:dinner', dishes: [{recipe_id: 'rec-dal'}], guests: [{guest_id: 'guest-sam', name: 'Sam'}, {guest_id: 'guest-sam', name: 'Sam'}]}, 'invalid_arguments', 'guest-sam'],
  ['plan.slot.set', {id: '2026-11-16:dinner', dishes: [{recipe_id: 'rec-dal'}], guests: [{guest_id: 'person-eli', name: 'Eli'}]}, 'invalid_arguments', 'person-eli'],
  ['plan.slot.set', {id: '2026-11-16:dinner', dishes: [{recipe_id: 'rec-dal'}], attendees: ['person-eli', 'person-eli']}, 'invalid_arguments'],
  ['plan.slot.set', {id: '2026-11-16:dinner', dishes: [{recipe_id: 'rec-dal', servings: 0}]}, 'invalid_servings'],
  ['plan.slot.mark', {id: '2026-11-14:dinner', status: 'cooked'}, 'not_yet'],
  ['plan.slot.mark', {id: '2026-11-07:dinner', status: 'skipped'}, 'invalid_state'],
  ['plan.slot.mark', {id: '2026-11-20:dinner', status: 'skipped'}, 'not_found'],
  ['plan.slot.mark', {id: '2026-11-08:dinner', status: 'cooked', portions: [{recipe_id: 'rec-dal', made: 2}]}, 'invalid_arguments'],
  ['plan.slot.mark', {id: '2026-11-08:dinner', status: 'cooked', portions: [{recipe_id: 'rec-chicken-noodle-soup', made: 2, eaten: 3}]}, 'invalid_quantity'],
  ['plan.get', {start: '2026-11-20', end: '2026-11-10'}, 'invalid_window'],
  ['plan.get', {start: '2026-11-01', end: '2026-12-31'}, 'invalid_window'],
  // Household
  ['members.constraint.set', {id: 'person-evan', constraint: {kind: 'dislike', tag: 'spicy', effective_from: '2026-11-20', expires_on: '2026-11-10', note: 'x'}}, 'invalid_window'],
  ['members.constraint.set', {id: 'person-evan', constraint: {id: 'con-evan-04', kind: 'dislike', tag: 'mushroom', note: 'x'}}, 'invalid_state'],
  ['members.constraint.set', {id: 'person-evan', constraint: {id: 'con-nora-03', kind: 'dislike', tag: 'shellfish', note: 'x'}}, 'not_found'],
  ['members.constraint.set', {id: 'person-evan', constraint: {kind: 'dislike', tag: 'crunchy', note: 'x'}}, 'invalid_constraint'],
  ['members.constraint.set', {id: 'person-evan', constraint: {kind: 'limit', nutrient: 'kcal', max: 0, note: 'x'}}, 'invalid_constraint'],
  ['members.constraint.remove', {id: 'person-eli', constraint_id: 'con-eli-02'}, 'invalid_state'],
  ['members.constraint.remove', {id: 'person-ada', constraint_id: 'con-ada-02'}, 'invalid_state'],
  // Recipes
  ['recipes.update', {id: 'rec-focaccia', patch: {servings: 4}}, 'invalid_state'],
  ['recipes.update', {id: 'rec-green-curry-with-tamari', patch: {servings: 4}}, 'invalid_state'],
  ['recipes.update', {id: 'rec-green-curry', patch: {servings: curry.servings}}, 'invalid_arguments'],
  ['recipes.update', {id: 'rec-green-curry', patch: {active_minutes: 500, total_minutes: 30}}, 'invalid_arguments'],
  ['recipes.update', {id: 'rec-green-curry', patch: {lines: [{ingredient_id: 'ing-egg', quantity: 2, unit: 'ml'}]}}, 'invalid_quantity'],
  ['recipes.update', {id: 'rec-green-curry', patch: {lines: [{ingredient_id: 'ing-egg', quantity: 0, unit: 'each'}]}}, 'invalid_quantity'],
  ['recipes.variant.create', {id: 'rec-green-curry-with-tamari', swaps: [{ingredient_id: 'ing-tamari', to_ingredient_id: 'ing-soy-sauce'}]}, 'invalid_state'],
  ['recipes.variant.create', {id: 'rec-focaccia', swaps: [{ingredient_id: 'ing-flour-ap', rule_id: 'rule-flour-gf'}]}, 'invalid_state'],
  ['recipes.variant.create', {id: 'rec-mac-cheese', swaps: [{ingredient_id: 'ing-flour-ap', rule_id: 'rule-flour-gf'}]}, 'rule_not_applicable'],
  ['recipes.variant.create', {id: 'rec-mac-cheese', swaps: [{ingredient_id: 'ing-flour-ap', rule_id: 'rule-butter-plant'}]}, 'unknown_rule'],
  ['recipes.variant.create', {id: 'rec-mac-cheese', swaps: [{ingredient_id: 'ing-egg', to_ingredient_id: 'ing-tofu-firm'}]}, 'not_in_recipe'],
  ['recipes.variant.create', {id: 'rec-mac-cheese', swaps: [{ingredient_id: 'ing-milk', to_ingredient_id: 'ing-milk'}]}, 'invalid_arguments'],
  ['recipes.variant.create', {id: 'rec-mac-cheese', swaps: [{ingredient_id: 'ing-milk', to_ingredient_id: 'ing-egg'}]}, 'invalid_quantity'],
  ['recipes.get', {id: 'rec-green-curry', revision: 9}, 'not_found'],
  ['recipes.get', {id: 'rec-green-curry', units: {'ing-tofu-firm': 'g'}}, 'not_in_recipe'],
  // Pantry and shopping
  ['pantry.set', {id: 'ing-egg', quantity: -1, unit: 'each'}, 'invalid_quantity'],
  ['pantry.set', {id: 'ing-egg', quantity: 2, unit: 'ml'}, 'invalid_quantity'],
  ['shopping.generate', {start: '2026-11-20', end: '2026-11-10'}, 'invalid_window'],
  ['shopping.generate', {start: '2026-11-09', end: '2026-12-31'}, 'invalid_window'],
  ['shopping.item.set', {line: 'ing-cilantro', ticked: true}, 'invalid_state'],
  ['shopping.item.set', {line: 'ing-salmon', ticked: true}, 'invalid_state'],
  ['shopping.item.set', {line: 'ing-salmon', excluded: true, reason: 'x'}, 'invalid_state'],
  ['shopping.item.set', {line: 'ing-lime', excluded: false}, 'invalid_state'],
  ['shopping.item.set', {line: 'ing-lime', excluded: true}, 'invalid_arguments'],
  ['shopping.item.set', {line: 'ing-lime', quantity: 3}, 'derived_line'],
  ['shopping.item.set', {line: 'manual:Birthday candles', excluded: true, reason: 'x'}, 'invalid_state'],
  ['shopping.item.set', {line: 'manual:ing-lemon', ticked: false}, 'invalid_state'],
  ['shopping.item.set', {line: 'manual:ing-lemon', quantity: 2, unit: 'ml'}, 'invalid_quantity'],
  ['shopping.item.remove', {line: 'ing-lime'}, 'derived_line'],
  ['shopping.item.remove', {line: 'removed'}, 'not_found']
];

test('refusals a person can meet return their code and name things in words', () => {
  const f = fixture({seed: require('../fixtures/reference.json'), logging: false});
  const lines = f.call(P + 'shopping.get', {}).list.lines;
  // Shopping lines are named by what they hold; the last case acts on a line removed meanwhile.
  const removed = f.call(P + 'shopping.item.set', {text: 'Napkins'}).id;
  f.call(P + 'shopping.item.remove', {id: removed});
  // Breakfast on the loaded day is cooked, so it can no longer change.
  f.call(P + 'plan.slot.mark', {id: '2026-11-08:breakfast', status: 'cooked'});
  const lineId = key => key === 'removed' ? removed : key.startsWith('manual:')
    ? lines.find(l => l.kind === 'manual' && (l.ingredient_id || l.text) === key.slice(7)).id : lines.find(l => l.kind === 'derived' && l.ingredient_id === key).id;
  const seen = [], wrong = [];
  for (const [op, args, code, id] of CASES) {
    const full = args.line ? (({line, ...rest}) => ({id: lineId(line), ...rest}))(args) : args;
    let got = null;
    try { f.call(P + op, full); } catch (e) { got = e; }
    const where = `${op} ${JSON.stringify(args)}`;
    if (!got) wrong.push(`${where} was not refused`);
    else if (got.code !== code) wrong.push(`${where}: ${got.code} instead of ${code}: ${got.message}`);
    else if (id && !got.message.includes(id)) wrong.push(`${where} does not name ${id}: ${got.message}`);
    else if (unreadable(got.message.split(id || '\0').join('that ID'))) wrong.push(`${where} ${unreadable(got.message)}`);
    seen.push(code);
    if (process.env.SHOW_MESSAGES && got) console.log(got.code, got.message);
  }
  assert.deepEqual(wrong, []);
  assert.ok(new Set(seen).size >= 14, [...new Set(seen)].join(' '));
});

// Two guests sent with one guest ID: the check is on the ID, so the message names the ID and both
// guests who share it, not a guest as if listed twice.
test('two guests with one guest ID are refused with the ID and both names', () => {
  const f = fixture({seed: require('../fixtures/reference.json'), logging: false});
  const args = {id: '2026-11-09:lunch', dishes: [{recipe_id: 'rec-dal'}], guests: [{guest_id: 'g1', name: 'A'}, {guest_id: 'g1', name: 'B'}]};
  assert.equal(f.refuse(P + 'plan.slot.set', args), 'invalid_arguments');
  assert.equal(f.message(P + 'plan.slot.set', args), 'Two guests, A and B, have the same guest ID g1; give each guest an ID of their own.');
  // Two different guests who happen to share a name are fine with IDs of their own.
  const ok = f.call(P + 'plan.slot.set', {...args, guests: [{guest_id: 'g1', name: 'Sam'}, {guest_id: 'g2', name: 'Sam'}]});
  assert.equal(ok.state, 'planned');
});
