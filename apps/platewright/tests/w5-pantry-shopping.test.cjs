'use strict';
// W5 pantry and shopping list: T13 pantry and freshness, deduction on cooking; T14 list derivation;
// T15 regeneration, stale lists, manual lines, ticks and exclusions.
const test = require('node:test');
const assert = require('node:assert/strict');
const {fixture, ev} = require('./harness.cjs');

const P = 'platewright.';
const WEEK = {start: '2026-11-09', end: '2026-11-15'};
const GUESTS = ['maya', 'ines', 'kofi', 'lea'].map(n => ({guest_id: 'guest-' + n, name: n, constraints: []}));
// A week of planned meals (clock: Sunday 2026-11-08, 08:00).
function planWeek(f) {
  f.call(P + 'plan.slot.set', {id: '2026-11-09:dinner', dishes: [{recipe_id: 'rec-black-bean-tacos', servings: 2}]});
  f.call(P + 'plan.slot.set', {id: '2026-11-10:dinner', dishes: [{recipe_id: 'rec-red-lentil-soup', servings: 2}]});
  f.call(P + 'plan.slot.set', {id: '2026-11-12:dinner', dishes: [{recipe_id: 'rec-shakshuka', servings: 1.5}]});
  f.call(P + 'plan.slot.set', {id: '2026-11-14:breakfast', dishes: [{recipe_id: 'rec-yogurt-parfait'}], attendees: ['person-nora', 'person-ada']});
  f.call(P + 'plan.slot.set', {id: '2026-11-14:dinner', dishes: [{recipe_id: 'rec-green-curry'}], attendees: ['person-nora', 'person-eli'], guests: GUESTS});
  f.call(P + 'plan.slot.set', {id: '2026-11-15:lunch', dishes: [{leftovers_of: '2026-11-14:dinner', portions: 2}], attendees: ['person-nora', 'person-evan']});
}
const lineFor = (list, ingredient, unit) => list.lines.find(l => l.ingredient_id === ingredient && (!unit || l.unit === unit));
const pantryItem = (f, id) => f.call(P + 'pantry.list', {include_out: true}).items.find(i => i.ingredient_id === id);

test('T13 pantry set and zero; freshness at each boundary; deduct_pantry on cooking, never below zero, with the shortfall', () => {
  const f = fixture();
  let list = f.call(P + 'pantry.list', {});
  assert.ok(!list.items.some(i => i.ingredient_id === 'ing-butter'), 'used-up items only with include_out');
  assert.equal(pantryItem(f, 'ing-butter').state, 'out');
  const fresh = id => pantryItem(f, id).freshness;
  // use_soon_days = 2. Yogurt use-by 2026-11-12; limes 2026-11-09; flour has no date and never expires.
  assert.deepEqual([fresh('ing-yogurt-lf'), pantryItem(f, 'ing-yogurt-lf').days_left, fresh('ing-lime'), fresh('ing-flour-ap')], ['fresh', 4, 'use_soon', 'no_date']);
  f.advance('2026-11-09T23:59:00-05:00');
  assert.deepEqual([fresh('ing-yogurt-lf'), fresh('ing-lime')], ['fresh', 'use_soon']);
  f.advance('2026-11-10T00:00:00-05:00');
  assert.deepEqual([fresh('ing-yogurt-lf'), fresh('ing-lime')], ['use_soon', 'expired']);
  f.advance('2026-11-12T23:00:00-05:00');
  assert.deepEqual([fresh('ing-yogurt-lf'), pantryItem(f, 'ing-yogurt-lf').days_left], ['use_soon', 0]);
  f.advance('2026-11-13T00:00:00-05:00');
  assert.deepEqual([fresh('ing-yogurt-lf'), pantryItem(f, 'ing-yogurt-lf').days_left, fresh('ing-flour-ap')], ['expired', -1, 'no_date']);
  assert.deepEqual(f.call(P + 'pantry.list', {freshness: 'expired'}).items.map(i => i.ingredient_id).sort(), ['ing-lime', 'ing-yogurt-lf']);
  // Set, keep the date when omitted, clear it with null, and zero it.
  let r = f.call(P + 'pantry.set', {id: 'ing-lime', quantity: 4, unit: 'each', use_by: '2026-11-20'});
  assert.deepEqual([r.id, r.state, r.quantity, r.freshness, r.days_left], ['ing-lime', 'in_stock', 4, 'fresh', 7]);
  r = f.call(P + 'pantry.set', {id: 'ing-lime', quantity: 3, unit: 'each'});
  assert.equal(r.use_by, '2026-11-20');
  r = f.call(P + 'pantry.set', {id: 'ing-lime', quantity: 0, unit: 'each'});
  assert.deepEqual([r.state, r.quantity], ['out', 0]);
  r = f.call(P + 'pantry.set', {id: 'ing-tofu-firm', quantity: 400, unit: 'g', use_by: null});
  assert.deepEqual([r.state, r.freshness, r.days_left], ['in_stock', 'no_date', null]);
  assert.deepEqual(pantryItem(f, 'ing-lime').history.map(h => [h.action, h.quantity]), [['seed', 1], ['set', 4], ['set', 3], ['set', 0]]);
  const before = f.data;
  assert.equal(f.refuse(P + 'pantry.set', {id: 'ing-durian', quantity: 1, unit: 'each'}), 'unknown_ingredient');
  assert.equal(f.refuse(P + 'pantry.set', {id: 'ing-flour-ap', quantity: 2, unit: 'cup'}), 'invalid_quantity');
  assert.equal(f.refuse(P + 'pantry.set', {id: 'ing-flour-ap', quantity: -5, unit: 'g'}), 'invalid_quantity');
  assert.equal(f.refuse(P + 'pantry.set', {id: 'ing-flour-ap', quantity: 5, unit: 'g', use_by: '2026-13-01'}), 'invalid_arguments');
  assert.deepEqual(f.data, before);
});

test('T13 deduct_pantry takes exact quantities, never below zero, and returns what was short; without it the pantry is unchanged', () => {
  const f = fixture();
  f.call(P + 'pantry.set', {id: 'ing-black-beans-canned', quantity: 300, unit: 'g', use_by: '2027-03-01'});
  f.call(P + 'pantry.set', {id: 'ing-cumin', quantity: 2, unit: 'tsp'});
  f.advance('2026-11-09T19:30:00-05:00');
  const pantryBefore = f.data.pantry;
  f.call(P + 'plan.slot.mark', {id: '2026-11-10:dinner', status: 'skipped'});
  const r = f.call(P + 'plan.slot.mark', {id: '2026-11-09:dinner', status: 'cooked', deduct_pantry: true});
  assert.equal(r.deducted, true);
  // Tacos for 4: 400 g beans (300 in stock), 1 onion (none), 1 tsp cumin (2 tsp in stock), 8 tortillas, 15 g cilantro, 1 lime (1 in stock).
  assert.deepEqual(r.short, [
    {ingredient_id: 'ing-black-beans-canned', quantity: 100, unit: 'g', reason: 'not_enough'},
    {ingredient_id: 'ing-onion', quantity: 1, unit: 'each', reason: 'not_in_pantry'},
    {ingredient_id: 'ing-tortilla-flour', quantity: 8, unit: 'each', reason: 'not_in_pantry'},
    {ingredient_id: 'ing-cilantro', quantity: 15, unit: 'g', reason: 'not_in_pantry'}]);
  const after = Object.fromEntries(f.data.pantry.map(p => [p.ingredient_id, p.quantity]));
  assert.deepEqual([after['ing-black-beans-canned'], after['ing-cumin'], after['ing-lime']], [0, 1, 0]);
  assert.equal(pantryItem(f, 'ing-black-beans-canned').history.at(-1).slot_id, '2026-11-09:dinner');
  assert.equal(pantryItem(f, 'ing-black-beans-canned').state, 'out');
  // The optional sour cream is not deducted; ingredients the dish does not use are untouched.
  assert.deepEqual(f.data.pantry.find(p => p.ingredient_id === 'ing-coconut-milk'), pantryBefore.find(p => p.ingredient_id === 'ing-coconut-milk'));
  // Without deduct_pantry the pantry is unchanged.
  f.call(P + 'plan.slot.set', {id: '2026-11-09:lunch', dishes: [{recipe_id: 'rec-shakshuka'}]});
  const pantry = JSON.stringify(f.data.pantry);
  const plain = f.call(P + 'plan.slot.mark', {id: '2026-11-09:lunch', status: 'cooked'});
  assert.deepEqual([plain.deducted, plain.short, JSON.stringify(f.data.pantry)], [false, [], pantry]);
  assert.equal(f.refuse(P + 'plan.slot.mark', {id: '2026-11-11:dinner', status: 'skipped', deduct_pantry: true}), 'not_found');
});

test('T14 derivation: merge by ingredient and unit, usable stock, stock expiring before use, rounding up once, optional lines, slots per line', () => {
  // Cilantro is also measurable by volume here, without a density, to show a second line in another unit.
  const f = fixture({mutate: d => { const c = d.ingredients.find(i => i.id === 'ing-cilantro'); c.measures = ['mass', 'volume']; }});
  planWeek(f);
  f.call(P + 'recipes.create', {title: 'Green salsa', servings: 2, method_tags: ['raw'], steps: ['Blend.'], lines: [{ingredient_id: 'ing-cilantro', quantity: 0.5, unit: 'cup'}, {ingredient_id: 'ing-lime', quantity: 1, unit: 'each'}]});
  f.call(P + 'plan.slot.set', {id: '2026-11-13:lunch', dishes: [{recipe_id: 'rec-green-salsa', servings: 2}], attendees: ['person-nora']});
  f.call(P + 'pantry.set', {id: 'ing-cilantro', quantity: 60, unit: 'ml'});
  const before = JSON.stringify(f.data);
  assert.deepEqual(f.call(P + 'shopping.get', {}), {list: null, status: 'ok', app_id: 'platewright', version: {epoch: 1, revision: 9}});
  const gen = f.call(P + 'shopping.generate', WEEK);
  assert.notEqual(JSON.stringify(f.data), before);
  assert.deepEqual([gen.id, gen.state, gen.generation, gen.dropped, gen.surplus], ['shopping-list', 'current', 1, [], []]);
  const {list} = f.call(P + 'shopping.get', {});
  assert.equal(list.stale, false);
  // 1050 ml coconut milk for Saturday's 6 servings, 800 ml in the pantry: 250 ml, for that slot.
  const coconut = lineFor(list, 'ing-coconut-milk');
  assert.deepEqual([coconut.quantity, coconut.unit, coconut.exact, coconut.needed_total, coconut.from_pantry, coconut.slots], [250, 'ml', 250, 1050, 800, ['2026-11-14:dinner']]);
  // Onions: 0.5 + 0.5 + 0.5 = 1.5, rounded up once to 2 (not 3), with the three slots.
  const onion = lineFor(list, 'ing-onion');
  assert.deepEqual([onion.quantity, onion.exact, onion.slots], [2, 1.5, ['2026-11-09:dinner', '2026-11-10:dinner', '2026-11-12:dinner']]);
  // Limes: 0.5 (tacos) + 1 (salsa) + 6 (curry) = 7.5; the lime in the pantry (use-by Monday, first needed Monday) counts.
  const lime = lineFor(list, 'ing-lime');
  assert.deepEqual([lime.quantity, lime.exact, lime.from_pantry], [7, 6.5, 1]);
  // Merged in the unit the ingredient is bought in: tbsp of paste -> g through its density; tbsp of fish sauce -> ml.
  assert.deepEqual(['quantity', 'unit', 'exact'].map(k => lineFor(list, 'ing-green-curry-paste')[k]), [149, 'g', 148.5]);
  assert.deepEqual(['quantity', 'unit'].map(k => lineFor(list, 'ing-fish-sauce')[k]), [90, 'ml']);
  assert.deepEqual(['quantity', 'exact', 'slots'].map(k => lineFor(list, 'ing-tomato-canned')[k]), [600, 600, ['2026-11-10:dinner', '2026-11-12:dinner']]);
  assert.deepEqual(['quantity', 'exact'].map(k => lineFor(list, 'ing-berries')[k]), [113, 112.5]);
  assert.deepEqual(['quantity', 'unit'].map(k => lineFor(list, 'ing-veg-stock')[k]), [600, 'ml'], '0.6 l of stock is bought in ml');
  // Cilantro in cups cannot become grams: a separate line in ml; pantry ml stock counts only for that line.
  assert.deepEqual(['quantity', 'unit'].map(k => lineFor(list, 'ing-cilantro', 'g')[k]), [7.5, 'g']);
  assert.deepEqual(['quantity', 'unit', 'from_pantry'].map(k => lineFor(list, 'ing-cilantro', 'ml')[k]), [60, 'ml', 60]);
  assert.deepEqual(list.stock_not_counted, [{ingredient_id: 'ing-cilantro', name: 'Cilantro', quantity: 60, unit: 'ml', needed_unit: 'g', reason: 'no_conversion'}]);
  // Stock fully covering a need leaves no line: cumin (40 g), eggs (6), black beans (400 g).
  for (const id of ['ing-cumin', 'ing-egg', 'ing-black-beans-canned']) assert.equal(lineFor(list, id), undefined, id);
  // Yogurt expiring on the 12th is not counted for the 14th's breakfast, and is listed.
  assert.deepEqual(['quantity', 'from_pantry'].map(k => lineFor(list, 'ing-yogurt-lf')[k]), [225, 0]);
  assert.deepEqual(list.expiring_before_use, [{ingredient_id: 'ing-yogurt-lf', name: 'Lactose-free plain yogurt', quantity: 500, unit: 'g', use_by: '2026-11-12', first_needed: '2026-11-14'}]);
  // Optional lines are listed separately, never bought; leftovers add nothing.
  assert.deepEqual(list.optional_lines.map(l => [l.ingredient_id, l.quantity, l.unit, l.slot_id]), [
    ['ing-sour-cream', 50, 'g', '2026-11-09:dinner'], ['ing-feta', 30, 'g', '2026-11-12:dinner'], ['ing-honey', 0.75, 'tbsp', '2026-11-14:breakfast'],
    ['ing-thai-basil', 30, 'g', '2026-11-14:dinner'], ['ing-cashews', 90, 'g', '2026-11-14:dinner']]);
  for (const id of ['ing-sour-cream', 'ing-feta', 'ing-honey', 'ing-thai-basil', 'ing-cashews']) assert.equal(lineFor(list, id), undefined);
  assert.ok(list.lines.every(l => !l.slots.includes('2026-11-15:lunch')));
  assert.ok(list.lines.every(l => l.kind === 'derived' && l.state === 'needed' && l.slots.length));
});

test('T15 regeneration: stale after each kind of change; manual lines, ticks and exclusions kept; dropped and surplus; refusals', () => {
  const f = fixture();
  // No list yet: every line write is no_list, and so is a member's tick.
  assert.equal(f.refuse(P + 'shopping.item.set', {text: 'Birthday candles', quantity: 1, unit: 'each'}), 'no_list');
  assert.equal(f.refuse(P + 'shopping.item.remove', {id: 'sl-0001'}), 'no_list');
  assert.equal(f.refuseEvent(ev('shopping.changed', '2026-11-08T08:30:00-05:00', {action: 'tick', line_id: 'sl-0001', by: 'person-eli'})), 'invalid_event');
  assert.equal(f.refuse(P + 'shopping.generate', {start: '2026-11-09', end: '2026-12-18'}), 'invalid_window');
  assert.equal(f.refuse(P + 'shopping.generate', {start: '2026-11-15', end: '2026-11-09'}), 'invalid_window');
  planWeek(f);
  f.call(P + 'plan.slot.set', {id: '2026-11-13:dinner', dishes: [{recipe_id: 'rec-tofu-fried-rice', servings: 4}]});
  f.call(P + 'shopping.generate', WEEK);
  const get = () => f.call(P + 'shopping.get', {}).list;
  let list = get();
  const egg = lineFor(list, 'ing-egg'), tofu = lineFor(list, 'ing-tofu-firm'), fish = lineFor(list, 'ing-fish-sauce'), tomato = lineFor(list, 'ing-tomato-canned'), lemon = lineFor(list, 'ing-lemon');
  assert.deepEqual([egg.quantity, tofu.quantity], [1, 400], '3 + 4 eggs with 6 in the pantry; 400 g tofu');
  // Manual lines, a tick, an exclusion with its reason.
  const candles = f.call(P + 'shopping.item.set', {text: 'Birthday candles', quantity: 1, unit: 'each'});
  assert.deepEqual([candles.state, candles.kind], ['needed', 'manual']);
  const milk = f.call(P + 'shopping.item.set', {ingredient_id: 'ing-milk', quantity: 1, unit: 'l'});
  f.call(P + 'shopping.item.set', {id: milk.id, quantity: 2});
  assert.equal(lineFor(get(), 'ing-milk').quantity, 2);
  assert.equal(f.call(P + 'shopping.item.set', {id: tofu.id, ticked: true}).state, 'ticked');
  assert.equal(f.call(P + 'shopping.item.set', {id: fish.id, excluded: true, reason: 'A bottle is in the office kitchen'}).state, 'excluded');
  assert.equal(f.call(P + 'shopping.item.set', {id: tomato.id, ticked: true}).state, 'ticked');
  const reads = JSON.stringify(f.data);
  assert.equal(get().stale, false);
  assert.equal(JSON.stringify(f.data), reads, 'reading the list writes nothing');
  // A member adds a dozen eggs: the list reads stale; regenerating drops the unticked egg line and keeps the rest.
  f.event(ev('pantry.changed', '2026-11-08T10:00:00-05:00', {items: [{ingredient_id: 'ing-egg', quantity: 12, unit: 'each', use_by: '2026-11-28'}], by: 'person-evan', note: 'Market'}));
  assert.equal(get().stale, true);
  let gen = f.call(P + 'shopping.generate', WEEK);
  list = get();
  assert.deepEqual([list.stale, gen.dropped, gen.generation], [false, [egg.id], 2]);
  assert.equal(lineFor(list, 'ing-egg'), undefined);
  assert.deepEqual([lineFor(list, 'ing-tofu-firm').id, lineFor(list, 'ing-tofu-firm').state], [tofu.id, 'ticked']);
  assert.deepEqual([lineFor(list, 'ing-fish-sauce').state, lineFor(list, 'ing-fish-sauce').excluded_reason], ['excluded', 'A bottle is in the office kitchen']);
  assert.deepEqual(list.lines.filter(l => l.kind === 'manual').map(l => [l.id, l.text || l.ingredient_id, l.quantity]), [[candles.id, 'Birthday candles', 1], [milk.id, 'ing-milk', 2]]);
  // Each kind of input change makes the list stale: plan, pantry, recipe, constraint. A change outside the window does not.
  const staleAfter = (label, fn) => { assert.equal(get().stale, false); fn(); assert.equal(get().stale, true, label); f.call(P + 'shopping.generate', WEEK); };
  f.call(P + 'plan.slot.set', {id: '2026-11-20:dinner', dishes: [{recipe_id: 'rec-shakshuka'}]});
  assert.equal(get().stale, false, 'a slot outside the window');
  staleAfter('plan', () => f.call(P + 'plan.slot.set', {id: '2026-11-11:lunch', dishes: [{recipe_id: 'rec-yogurt-parfait'}]}));
  staleAfter('pantry', () => f.call(P + 'pantry.set', {id: 'ing-oats', quantity: 500, unit: 'g'}));
  staleAfter('recipe', () => f.call(P + 'recipes.update', {id: 'rec-shakshuka', patch: {servings: 4}}));
  staleAfter('constraint', () => f.call(P + 'members.constraint.set', {id: 'person-ada', constraint: {kind: 'diet', diet: 'vegetarian', note: 'From now on'}}));
  staleAfter('portion factor via attendees', () => f.call(P + 'plan.slot.set', {id: '2026-11-11:lunch', dishes: [{recipe_id: 'rec-yogurt-parfait'}], attendees: ['person-ada']}));
  // The soup and shakshuka are cleared: the ticked tomato line stays as surplus, the unticked lemon line is dropped,
  // and an excluded line that is no longer needed is dropped too.
  f.call(P + 'shopping.item.set', {id: lineFor(get(), 'ing-bay-leaf').id, excluded: true, reason: 'Plenty in the jar'});
  const tomatoQuantity = lineFor(get(), 'ing-tomato-canned').quantity;
  assert.equal(tomatoQuantity, 500, '200 g for the soup + 300 g for 1.5 servings of the four-serving shakshuka');
  f.call(P + 'plan.slot.set', {id: '2026-11-10:dinner', dishes: []});
  f.call(P + 'plan.slot.set', {id: '2026-11-12:dinner', dishes: []});
  gen = f.call(P + 'shopping.generate', WEEK);
  list = get();
  const bay = f.data.shopping.lines.find(l => l.ingredient_id === 'ing-bay-leaf');
  assert.equal(bay, undefined);
  assert.ok(gen.dropped.includes(lemon.id));
  assert.deepEqual(gen.surplus, [tomato.id]);
  assert.deepEqual(['state', 'surplus', 'quantity'].map(k => lineFor(list, 'ing-tomato-canned')[k]), ['ticked', true, tomatoQuantity]);
  // Unticking a surplus line keeps it until the next generation, which then drops it.
  f.call(P + 'shopping.item.set', {id: tomato.id, ticked: false});
  assert.ok(f.call(P + 'shopping.generate', WEEK).dropped.includes(tomato.id));
  // Line refusals; nothing changes.
  const before = f.data;
  assert.equal(f.refuse(P + 'shopping.item.remove', {id: tofu.id}), 'derived_line');
  assert.equal(f.refuse(P + 'shopping.item.set', {id: tofu.id, quantity: 100}), 'derived_line');
  assert.equal(f.refuse(P + 'shopping.item.remove', {id: 'sl-9999'}), 'not_found');
  assert.equal(f.refuse(P + 'shopping.item.set', {id: 'sl-9999', ticked: true}), 'not_found');
  assert.equal(f.refuse(P + 'shopping.item.set', {id: tofu.id, ticked: true}), 'invalid_state');
  assert.equal(f.refuse(P + 'shopping.item.set', {id: tofu.id, excluded: true, reason: 'x'}), 'invalid_state');
  assert.equal(f.refuse(P + 'shopping.item.set', {id: fish.id, ticked: true}), 'invalid_state');
  assert.equal(f.refuse(P + 'shopping.item.set', {id: lineFor(get(), 'ing-coconut-milk').id, excluded: true}), 'invalid_arguments');
  assert.equal(f.refuse(P + 'shopping.item.set', {id: candles.id, excluded: true, reason: 'x'}), 'invalid_state');
  assert.equal(f.refuse(P + 'shopping.item.set', {ingredient_id: 'ing-flour-ap', quantity: 1, unit: 'cup'}), 'invalid_quantity');
  assert.equal(f.refuse(P + 'shopping.item.set', {ingredient_id: 'ing-durian', quantity: 1, unit: 'each'}), 'unknown_ingredient');
  assert.equal(f.refuse(P + 'shopping.item.set', {text: 'Napkins', quantity: -1, unit: 'each'}), 'invalid_quantity');
  assert.equal(f.refuse(P + 'shopping.item.set', {quantity: 1, unit: 'each'}), 'invalid_arguments');
  assert.equal(f.refuse(P + 'shopping.item.set', {id: candles.id}), 'invalid_arguments');
  assert.deepEqual(f.data, before);
  // Manual lines: tick, untick and remove.
  assert.equal(f.call(P + 'shopping.item.set', {id: candles.id, ticked: true}).state, 'ticked');
  assert.equal(f.call(P + 'shopping.item.set', {id: candles.id, ticked: false}).state, 'needed');
  assert.deepEqual([f.call(P + 'shopping.item.remove', {id: candles.id}).state], ['removed']);
  assert.equal(get().lines.find(l => l.id === candles.id), undefined);
  // Line IDs are never reused.
  const again = f.call(P + 'shopping.item.set', {text: 'Candles', quantity: 1, unit: 'each'});
  assert.ok(Number(again.id.slice(3)) > Math.max(...before.shopping.lines.map(l => Number(l.id.slice(3)))));
});
