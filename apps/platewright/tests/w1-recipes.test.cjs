'use strict';
// W1 recipe box: T01 search, T02 scaling and units, T03 nutrition, T04 create / revise / archive.
const test = require('node:test');
const assert = require('node:assert/strict');
const {fixture} = require('./harness.cjs');

const P = 'platewright.';
const ids = r => r.items.map(i => i.id);
const LINES = [{ingredient_id: 'ing-chickpeas-canned', quantity: 400, unit: 'g'}, {ingredient_id: 'ing-onion', quantity: 1, unit: 'each'},
  {ingredient_id: 'ing-cumin', quantity: 1, unit: 'tsp'}];
const NEW = {title: 'Chickpea skillet', servings: 2, lines: LINES, method_tags: ['fry'], steps: ['Fry the onion.', 'Add the chickpeas and cumin.'], tags: ['weeknight'], active_minutes: 10, total_minutes: 15};

test('T01 search by text, ingredient, tag, time, allergen-free and diet; pagination; archived only on request', () => {
  const f = fixture();
  assert.deepEqual(ids(f.call(P + 'recipes.search', {query: 'curry'})), ['rec-green-curry']);
  assert.deepEqual(ids(f.call(P + 'recipes.search', {query: 'garbanzo'})), [], 'alias text of an unused ingredient finds nothing');
  assert.deepEqual(ids(f.call(P + 'recipes.search', {query: 'coriander leaves'})), ['rec-black-bean-tacos'], 'ingredient aliases are searched');
  assert.deepEqual(ids(f.call(P + 'recipes.search', {ingredient_id: 'ing-egg'})).sort(), ['rec-banana-bread', 'rec-shakshuka', 'rec-tofu-fried-rice']);
  assert.deepEqual(ids(f.call(P + 'recipes.search', {tags: ['weeknight', 'curry']})), ['rec-green-curry']);
  const quick = f.call(P + 'recipes.search', {max_total_minutes: 25});
  assert.ok(quick.items.every(r => r.total_minutes <= 25) && ids(quick).includes('rec-black-bean-tacos') && !ids(quick).includes('rec-green-curry'));
  // allergen_free leaves out every recipe with a line that contains the allergen (optional lines too).
  const nutFree = ids(f.call(P + 'recipes.search', {allergen_free: ['tree_nut'], limit: 100}));
  assert.ok(!nutFree.includes('rec-green-curry') && !nutFree.includes('rec-banana-bread'), 'cashews and walnuts are optional lines but contain tree nuts');
  assert.ok(nutFree.includes('rec-shakshuka'));
  const all = f.call(P + 'recipes.search', {limit: 100});
  assert.equal(nutFree.length, all.items.filter(r => !r.contains.includes('tree_nut')).length);
  // strict also leaves out may-contain: oats may contain wheat.
  assert.ok(ids(f.call(P + 'recipes.search', {allergen_free: ['wheat'], limit: 100})).includes('rec-yogurt-parfait'));
  assert.ok(!ids(f.call(P + 'recipes.search', {allergen_free: ['wheat'], strict: true, limit: 100})).includes('rec-yogurt-parfait'));
  const veg = ids(f.call(P + 'recipes.search', {diet: ['vegetarian'], limit: 100}));
  assert.ok(!veg.includes('rec-chicken-traybake') && !veg.includes('rec-green-curry') && veg.includes('rec-shakshuka'));
  assert.ok(!ids(f.call(P + 'recipes.search', {diet: ['vegan'], limit: 100})).includes('rec-shakshuka'));
  // Pagination is stable and complete.
  const p1 = f.call(P + 'recipes.search', {limit: 4}), p2 = f.call(P + 'recipes.search', {limit: 4, offset: 4}), p3 = f.call(P + 'recipes.search', {limit: 4, offset: 8});
  assert.equal(p1.total, 9); assert.equal(p1.next_offset, 4); assert.equal(p3.next_offset, null);
  assert.deepEqual([...ids(p1), ...ids(p2), ...ids(p3)], ids(all));
  // Archived recipes appear only on request.
  f.call(P + 'recipes.update', {id: 'rec-shakshuka', patch: {archived: true}});
  assert.ok(!ids(f.call(P + 'recipes.search', {limit: 100})).includes('rec-shakshuka'));
  const withArchived = f.call(P + 'recipes.search', {limit: 100, include_archived: true});
  assert.equal(withArchived.items.find(r => r.id === 'rec-shakshuka').state, 'archived');
  assert.equal(f.refuse(P + 'recipes.search', {allergen_free: ['coconut']}), 'invalid_arguments');
  // The ingredient table search.
  const ing = f.call(P + 'ingredients.search', {query: 'yogurt'});
  assert.deepEqual(ids(ing).sort(), ['ing-yogurt', 'ing-yogurt-lf']);
  assert.deepEqual(ids(f.call(P + 'ingredients.search', {query: 'yogurt', diet: 'lactose_free'})), ['ing-yogurt-lf']);
  assert.deepEqual(ids(f.call(P + 'ingredients.search', {query: 'yogurt', allergen_free: ['milk']})), []);
  assert.deepEqual(ids(f.call(P + 'ingredients.search', {tag: 'mushroom'})), ['ing-mushroom']);
  assert.ok(ids(f.call(P + 'ingredients.search', {flag: 'gluten', limit: 100})).includes('ing-flour-ap'));
});

test('T02 scaling and rounding in both unit systems; exact values; whole pieces round up; no_conversion', () => {
  const f = fixture(), before = JSON.stringify(f.data);
  const six = f.call(P + 'recipes.get', {id: 'rec-green-curry', servings: 6}).recipe;
  const line = id => six.lines.find(l => l.ingredient_id === id);
  assert.deepEqual([line('ing-coconut-milk').quantity, line('ing-coconut-milk').unit, line('ing-coconut-milk').exact], [1050, 'ml', 1050]);
  assert.deepEqual([line('ing-green-curry-paste').quantity, line('ing-green-curry-paste').unit, line('ing-green-curry-paste').exact], [9, 'tbsp', 9]);
  assert.deepEqual([line('ing-lime').quantity, line('ing-lime').unit], [6, 'each']);
  assert.deepEqual(line('ing-lime').as_written, {quantity: 2, unit: 'each'});
  assert.equal(six.base_servings, 2);
  // Whole pieces round up: 3 servings of tacos for 4 = 0.75 onion -> 1 onion, exact 0.75.
  const tacos = f.call(P + 'recipes.get', {id: 'rec-black-bean-tacos', servings: 3}).recipe;
  assert.deepEqual(['quantity', 'exact'].map(k => tacos.lines[1][k]), [1, 0.75]);
  // 5 servings of a 4-serving 1 tsp cumin = 1.25 tsp; 1 serving = 0.25 tsp; banana bread 1/10 -> 0.1 tsp soda -> an eighth.
  assert.equal(f.call(P + 'recipes.get', {id: 'rec-black-bean-tacos', servings: 5}).recipe.lines[2].quantity, 1.25);
  const slice = f.call(P + 'recipes.get', {id: 'rec-banana-bread', servings: 1}).recipe;
  assert.deepEqual(['quantity', 'unit', 'exact'].map(k => slice.lines[5][k]), [0.125, 'tsp', 0.1]);
  // Grams: nearest 1, or 0.5 below 10. 7 servings of a 10-serving 50 g walnuts = 35 g; 1 serving = 5 g; 250 g flour / 10 * 3 = 75.
  assert.equal(f.call(P + 'recipes.get', {id: 'rec-banana-bread', servings: 1}).recipe.lines[6].quantity, 5);
  assert.deepEqual(['quantity', 'exact'].map(k => f.call(P + 'recipes.get', {id: 'rec-green-curry', servings: 1}).recipe.lines[6][k]), [5, 5]);
  assert.deepEqual(['quantity', 'exact'].map(k => f.call(P + 'recipes.get', {id: 'rec-tofu-fried-rice', servings: 1.5}).recipe.lines[5][k]), [0.375, 0.375]);
  assert.deepEqual(['quantity', 'exact'].map(k => f.call(P + 'recipes.get', {id: 'rec-black-bean-tacos', servings: 3}).recipe.lines[4][k]), [11, 11.25]);
  assert.deepEqual(['quantity', 'exact'].map(k => f.call(P + 'recipes.get', {id: 'rec-tofu-fried-rice', servings: 1}).recipe.lines[0][k]), [75, 75]);
  assert.deepEqual(['quantity', 'exact'].map(k => f.call(P + 'recipes.get', {id: 'rec-chicken-traybake', servings: 1}).recipe.lines[5][k]), [1, 0.75]);
  assert.deepEqual(['quantity', 'exact'].map(k => f.call(P + 'recipes.get', {id: 'rec-chicken-traybake', servings: 3}).recipe.lines[5][k]), [2.5, 2.25]);
  // Metric: spoons and litres become ml, within the line's own dimension.
  const metric = f.call(P + 'recipes.get', {id: 'rec-green-curry', unit_system: 'metric'}).recipe;
  assert.deepEqual([metric.lines[1].quantity, metric.lines[1].unit], [45, 'ml']);
  assert.deepEqual([f.call(P + 'recipes.get', {id: 'rec-mushroom-risotto', unit_system: 'metric'}).recipe.lines[4].quantity, 'ml'], [1000, 'ml']);
  // US: grams become oz (lb from a pound), ml become tsp, tbsp or cups; pieces stay pieces.
  const us = f.call(P + 'recipes.get', {id: 'rec-green-curry', unit_system: 'us'}).recipe;
  assert.deepEqual(['quantity', 'unit', 'exact'].map(k => us.lines[0][k]), [1.5, 'cup', 1.458333]);
  assert.deepEqual(['quantity', 'unit', 'exact'].map(k => us.lines[1][k]), [3, 'tbsp', 3]);
  assert.deepEqual(['quantity', 'unit', 'exact'].map(k => us.lines[2][k]), [8.75, 'oz', 8.818342]);
  assert.deepEqual(['quantity', 'unit'].map(k => us.lines[5][k]), [2, 'each']);
  const usBig = f.call(P + 'recipes.get', {id: 'rec-chicken-traybake', unit_system: 'us', servings: 4}).recipe;
  assert.deepEqual(['quantity', 'unit', 'exact'].map(k => usBig.lines[0][k]), [1.25, 'lb', 1.322751]);
  const flakes = f.call(P + 'recipes.get', {id: 'rec-tofu-fried-rice', unit_system: 'us'}).recipe.lines[5];
  assert.deepEqual([flakes.quantity, flakes.unit], [0.5, 'tsp']);
  // An explicit unit across dimensions uses the density or the weight per piece, never a guess.
  const asGrams = f.call(P + 'recipes.get', {id: 'rec-green-curry', units: {'ing-coconut-milk': 'g', 'ing-lime': 'g'}}).recipe;
  assert.deepEqual([asGrams.lines[0].quantity, asGrams.lines[0].unit], [350, 'g']);
  assert.deepEqual([asGrams.lines[5].quantity, asGrams.lines[5].exact], [134, 134]);
  assert.equal(f.call(P + 'recipes.get', {id: 'rec-banana-bread', units: {'ing-sugar': 'cup'}}).recipe.lines[4].quantity, 0.75);
  assert.equal(f.refuse(P + 'recipes.get', {id: 'rec-banana-bread', units: {'ing-flour-ap': 'cup'}}), 'no_conversion');
  assert.equal(f.refuse(P + 'recipes.get', {id: 'rec-red-lentil-soup', units: {'ing-bay-leaf': 'g'}}), 'no_conversion');
  assert.equal(f.refuse(P + 'recipes.get', {id: 'rec-banana-bread', units: {'ing-tamari': 'ml'}}), 'not_in_recipe');
  assert.equal(f.refuse(P + 'recipes.get', {id: 'rec-banana-bread', servings: 0}), 'invalid_servings');
  assert.equal(f.refuse(P + 'recipes.get', {id: 'rec-banana-bread', servings: 201}), 'invalid_servings');
  assert.equal(f.refuse(P + 'recipes.get', {id: 'rec-missing'}), 'not_found');
  assert.equal(JSON.stringify(f.data), before, 'reads leave business data byte-identical');
});

test('T03 nutrition per serving; optional lines left out and listed; null with missing_for', () => {
  const f = fixture();
  const curry = f.call(P + 'recipes.get', {id: 'rec-green-curry'}).recipe;
  // 350 ml coconut milk (1 g/ml, 190 kcal) + 45 ml paste (1.1 g/ml, 120) + 250 g sweet potato (86) + 150 g beans (31)
  // + 30 ml fish sauce (1.2 g/ml, 35) + 2 limes (67 g each, 30), over 2 servings.
  const kcal = (350 * 190 + 49.5 * 120 + 250 * 86 + 150 * 31 + 36 * 35 + 134 * 30) / 100 / 2;
  assert.equal(curry.nutrition_exact.kcal, Math.round(kcal * 1e6) / 1e6);
  assert.equal(curry.nutrition.kcal, Math.round(kcal));
  assert.deepEqual(curry.optional_excluded.map(l => l.ingredient_id), ['ing-thai-basil', 'ing-cashews']);
  assert.deepEqual(curry.missing_for, []);
  // Scaling does not change nutrition per serving.
  assert.deepEqual(f.call(P + 'recipes.get', {id: 'rec-green-curry', servings: 6}).recipe.nutrition, curry.nutrition);
  const soup = f.call(P + 'recipes.get', {id: 'rec-red-lentil-soup'}).recipe;
  assert.equal(soup.nutrition, null);
  assert.deepEqual(soup.missing_for, [{line: 5, ingredient_id: 'ing-bay-leaf', unit: 'each'}]);
  // recipes.check reports the same nutrition.
  assert.deepEqual(f.call(P + 'recipes.check', {id: 'rec-green-curry', members: ['person-nora']}).nutrition, curry.nutrition);
});

test('T04 create, update with revisions, archive and restore without a revision; refusals change nothing', () => {
  const f = fixture();
  const created = f.call(P + 'recipes.create', NEW);
  assert.deepEqual([created.id, created.state, created.revision, created.status], ['rec-chickpea-skillet', 'active', 1, 'committed']);
  const second = f.call(P + 'recipes.create', NEW);
  assert.equal(second.id, 'rec-chickpea-skillet-2', 'a second recipe with the same title gets its own ID');
  const r1 = f.call(P + 'recipes.get', {id: created.id}).recipe;
  assert.equal(r1.origin.request_id !== null && r1.origin.actor, 'agent');
  const up = f.call(P + 'recipes.update', {id: created.id, patch: {servings: 3, lines: [...LINES, {ingredient_id: 'ing-lemon', quantity: 1, unit: 'each', optional: true}]}});
  assert.deepEqual([up.revision, up.state, up.new_revision], [2, 'active', true]);
  const now = f.call(P + 'recipes.get', {id: created.id}).recipe, old = f.call(P + 'recipes.get', {id: created.id, revision: 1}).recipe;
  assert.deepEqual([now.revision, now.base_servings, now.lines.length], [2, 3, 4]);
  assert.deepEqual([old.revision_shown, old.base_servings, old.lines.length], [1, 2, 3], 'revision 1 stays readable');
  assert.deepEqual(now.revisions.map(r => r.revision), [1, 2]);
  // Archive and restore change only `archived` and add no revision.
  const arch = f.call(P + 'recipes.update', {id: created.id, patch: {archived: true}});
  assert.deepEqual([arch.state, arch.revision, arch.new_revision], ['archived', 2, false]);
  assert.equal(f.call(P + 'recipes.get', {id: created.id}).recipe.state, 'archived', 'an archived recipe stays readable');
  const before = f.data;
  assert.equal(f.refuse(P + 'recipes.update', {id: created.id, patch: {title: 'Renamed'}}), 'invalid_state');
  assert.equal(f.refuse(P + 'recipes.update', {id: created.id, patch: {archived: false, title: 'Renamed'}}), 'invalid_state');
  assert.equal(f.refuse(P + 'recipes.update', {id: created.id, patch: {archived: true}}), 'invalid_state');
  assert.deepEqual(f.data, before);
  const restored = f.call(P + 'recipes.update', {id: created.id, patch: {archived: false}});
  assert.deepEqual([restored.state, restored.revision], ['active', 2]);
  assert.deepEqual(f.call(P + 'recipes.get', {id: created.id}).recipe.history.map(h => h.action), ['created', 'revised', 'archived', 'restored']);
  // Errors: unknown recipe or ingredient, quantities, units, servings; nothing changes.
  const snapshot = f.data;
  assert.equal(f.refuse(P + 'recipes.update', {id: 'rec-nope', patch: {title: 'x'}}), 'not_found');
  assert.equal(f.refuse(P + 'recipes.create', {...NEW, lines: [{ingredient_id: 'ing-dragonfruit', quantity: 1, unit: 'each'}]}), 'unknown_ingredient');
  assert.equal(f.refuse(P + 'recipes.create', {...NEW, lines: [{ingredient_id: 'ing-onion', quantity: -1, unit: 'each'}]}), 'invalid_quantity');
  assert.equal(f.refuse(P + 'recipes.create', {...NEW, lines: [{ingredient_id: 'ing-onion', quantity: 0, unit: 'each'}]}), 'invalid_quantity');
  assert.equal(f.refuse(P + 'recipes.create', {...NEW, lines: [{ingredient_id: 'ing-flour-ap', quantity: 2, unit: 'cup'}]}), 'invalid_quantity');
  assert.equal(f.refuse(P + 'recipes.create', {...NEW, servings: 0.5}), 'invalid_servings');
  assert.equal(f.refuse(P + 'recipes.create', {...NEW, servings: 250}), 'invalid_servings');
  assert.equal(f.refuse(P + 'recipes.update', {id: created.id, patch: {servings: 300}}), 'invalid_servings');
  assert.equal(f.refuse(P + 'recipes.update', {id: created.id, patch: {}}), 'invalid_arguments');
  assert.equal(f.refuse(P + 'recipes.update', {id: created.id, patch: {servings: 3}}), 'invalid_arguments', 'a patch that changes nothing');
  assert.equal(f.refuse(P + 'recipes.create', {...NEW, active_minutes: 30, total_minutes: 10}), 'invalid_arguments');
  assert.deepEqual(f.data, snapshot);
  assert.equal(f.revision, 5, 'only the five committed writes advanced the version');
  // One activity row per committed write, with its request_id.
  assert.deepEqual(f.data.activity.map(a => [a.action, a.object_id, a.actor]), [
    ['recipes.create', 'rec-chickpea-skillet', 'agent'], ['recipes.create', 'rec-chickpea-skillet-2', 'agent'], ['recipes.update', 'rec-chickpea-skillet', 'agent'],
    ['recipes.update', 'rec-chickpea-skillet', 'agent'], ['recipes.update', 'rec-chickpea-skillet', 'agent']]);
  const requests = f.data.activity.map(a => a.request_id);
  assert.ok(requests.every(r => /^local-\d+$/.test(r)) && new Set(requests).size === requests.length);
  assert.equal(f.data.notifications.length, 0, 'no notification for the account\'s own writes');
});

test('T02 as written, a small amount in tablespoons or cups moves down to a smaller spoon', () => {
  const f = fixture();
  f.call(P + 'recipes.create', {title: 'Dressing for ten', servings: 10, method_tags: ['raw'], steps: ['Whisk.'],
    lines: [{ingredient_id: 'ing-tamari', quantity: 1, unit: 'tbsp'}, {ingredient_id: 'ing-olive-oil', quantity: 0.5, unit: 'cup'}]});
  // 0.1 tbsp = 0.3 tsp shows as 0.25 tsp (not 0.25 tbsp); 0.05 cup = 12 ml = 2.4 tsp shows as 2.5 tsp.
  const one = f.call(P + 'recipes.get', {id: 'rec-dressing-for-ten', servings: 1}).recipe.lines;
  assert.deepEqual(one.map(l => [l.quantity, l.unit, l.exact]), [[0.25, 'tsp', 0.3], [2.5, 'tsp', 2.4]]);
  assert.deepEqual(f.call(P + 'recipes.get', {id: 'rec-dressing-for-ten'}).recipe.lines.map(l => [l.quantity, l.unit]), [[1, 'tbsp'], [0.5, 'cup']]);
  assert.deepEqual(f.call(P + 'recipes.get', {id: 'rec-dressing-for-ten', servings: 3}).recipe.lines.map(l => [l.quantity, l.unit]), [[0.875, 'tsp'], [2.5, 'tbsp']]);
});
