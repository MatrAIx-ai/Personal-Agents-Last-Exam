'use strict';
// W3 substitutions: T09 rules, preview equals create, allergen trade-offs, custom swaps;
// T10 refusals and stale_base.
const test = require('node:test');
const assert = require('node:assert/strict');
const {fixture} = require('./harness.cjs');

const P = 'platewright.';
const VEG_GUEST = {guest_id: 'guest-ines', name: 'Ines', constraints: [{kind: 'diet', diet: 'vegetarian'}]};
const FISH_GUEST = {guest_id: 'guest-oto', name: 'Oto', constraints: [{kind: 'allergy', allergen: 'fish'}]};
const TAMARI = [{ingredient_id: 'ing-fish-sauce', rule_id: 'rule-fish-sauce-tamari'}];

test('T09 rules per line with reasons; preview equals what create saves; a swap trading one allergen for another; custom swaps', () => {
  const f = fixture();
  // For the curry: fish sauce -> tamari 1:1 for simmer, with what tamari brings.
  const curry = f.call(P + 'substitutions.list', {id: 'rec-green-curry'});
  const fish = curry.lines.find(l => l.ingredient_id === 'ing-fish-sauce').rules;
  assert.deepEqual(fish.map(r => [r.id, r.to_ingredient_id, r.ratio, r.applicable, r.reason, r.to_allergens]),
    [['rule-fish-sauce-tamari', 'ing-tamari', 1, true, null, ['soy']]]);
  assert.deepEqual(curry.lines.find(l => l.ingredient_id === 'ing-coconut-milk').rules, []);
  // For the risotto (simmer): butter -> applesauce is valid only for bake, and says why.
  const risotto = f.call(P + 'substitutions.list', {id: 'rec-mushroom-risotto'}).lines.find(l => l.ingredient_id === 'ing-butter').rules;
  assert.deepEqual(risotto.map(r => [r.id, r.applicable]), [['rule-butter-applesauce', false], ['rule-butter-coconut-oil', true]]);
  assert.match(risotto[0].reason, /Valid only for bake; this recipe is also simmer/);
  // By ingredient: every rule, no recipe to judge against.
  assert.deepEqual(f.call(P + 'substitutions.list', {ingredient_id: 'ing-butter'}).rules.map(r => [r.id, r.applicable]), [['rule-butter-applesauce', true], ['rule-butter-coconut-oil', true]]);
  assert.equal(f.refuse(P + 'substitutions.list', {}), 'invalid_arguments');
  assert.equal(f.refuse(P + 'substitutions.list', {ingredient_id: 'ing-nope'}), 'unknown_ingredient');
  // Preview: the vegetarian guest moves from unsuitable to ok, Eli (soy allergy) from ok to unsafe; the fish-allergic guest to ok.
  const before = JSON.stringify(f.data);
  const pv = f.call(P + 'recipes.variant.preview', {id: 'rec-green-curry', swaps: TAMARI, guests: [VEG_GUEST, FISH_GUEST], date: '2026-11-14'});
  assert.equal(JSON.stringify(f.data), before, 'a preview writes nothing');
  const change = id => pv.changes.find(c => c.id === id);
  assert.deepEqual(change('guest-ines'), {kind: 'guest', id: 'guest-ines', from: 'unsuitable', to: 'ok'});
  assert.deepEqual(change('guest-oto'), {kind: 'guest', id: 'guest-oto', from: 'unsafe', to: 'ok'});
  assert.deepEqual(change('person-eli'), {kind: 'member', id: 'person-eli', from: 'ok', to: 'unsafe'});
  assert.equal(change('person-nora'), undefined);
  assert.deepEqual(pv.check.find(v => v.id === 'person-eli').findings[0].lines, [{line: 4, ingredient_id: 'ing-tamari', optional: false}]);
  assert.deepEqual([pv.lines[4].ingredient_id, pv.lines[4].quantity, pv.lines[4].unit], ['ing-tamari', 2, 'tbsp']);
  assert.deepEqual([pv.title, pv.unverified, pv.base_revision], ['Sweet potato green curry (Tamari for Fish sauce)', false, 1]);
  assert.notDeepEqual(pv.nutrition, f.call(P + 'recipes.get', {id: 'rec-green-curry'}).recipe.nutrition);
  // Create saves exactly the previewed content and swaps.
  const made = f.call(P + 'recipes.variant.create', {id: 'rec-green-curry', swaps: TAMARI});
  assert.deepEqual([made.state, made.revision, made.base_recipe_id, made.base_revision, made.unverified], ['active', 1, 'rec-green-curry', 1, false]);
  const saved = f.data.recipes.find(r => r.id === made.id);
  assert.deepEqual(Object.fromEntries(Object.keys(pv.content).map(k => [k, saved[k]])), pv.content);
  assert.deepEqual(saved.variant, {base_recipe_id: 'rec-green-curry', base_revision: 1, swaps: pv.swaps, unverified: false});
  const view = f.call(P + 'recipes.get', {id: made.id}).recipe;
  assert.deepEqual([view.variant.stale_base, view.nutrition], [false, pv.nutrition]);
  // The variant is checked like any recipe.
  assert.equal(f.call(P + 'recipes.check', {id: made.id, members: ['person-eli']}).verdicts[0].verdict, 'unsafe');
  // A custom swap (no rule) can be previewed and saved, and the variant is unverified.
  const custom = {id: 'rec-banana-bread', swaps: [{ingredient_id: 'ing-egg', to_ingredient_id: 'ing-banana', ratio: 0.5}, {ingredient_id: 'ing-walnuts', rule_id: 'rule-walnuts-sunflower'}], title: 'Egg-free banana bread'};
  const cp = f.call(P + 'recipes.variant.preview', custom);
  assert.deepEqual([cp.unverified, cp.swaps.map(s => [s.custom, s.rule_id])], [true, [[true, null], [false, 'rule-walnuts-sunflower']]]);
  assert.deepEqual([cp.content.lines[2].ingredient_id, cp.content.lines[2].quantity], ['ing-banana', 1]);
  const cv = f.call(P + 'recipes.variant.create', custom);
  assert.deepEqual([cv.id, cv.unverified], ['rec-egg-free-banana-bread', true]);
  assert.equal(f.call(P + 'recipes.check', {id: cv.id, guests: [{guest_id: 'guest-n', name: 'N', constraints: [{kind: 'allergy', allergen: 'egg'}, {kind: 'allergy', allergen: 'tree_nut', strict: true}]}], members: []}).verdicts[0].verdict, 'ok');
});

test('T10 not_in_recipe, unknown_rule, rule_not_applicable, conflict, a variant of a variant; stale_base after the base changes', () => {
  const f = fixture();
  const v = f.call(P + 'recipes.variant.create', {id: 'rec-green-curry', swaps: TAMARI});
  const before = f.data;
  const preview = swaps => f.refuse(P + 'recipes.variant.preview', {id: 'rec-green-curry', swaps});
  const create = (id, swaps) => f.refuse(P + 'recipes.variant.create', {id, swaps});
  assert.equal(preview([{ingredient_id: 'ing-butter', rule_id: 'rule-butter-coconut-oil'}]), 'not_in_recipe');
  assert.equal(preview([{ingredient_id: 'ing-fish-sauce', line: 0, rule_id: 'rule-fish-sauce-tamari'}]), 'not_in_recipe');
  assert.equal(preview([{ingredient_id: 'ing-fish-sauce', rule_id: 'rule-nope'}]), 'unknown_rule');
  assert.equal(preview([{ingredient_id: 'ing-fish-sauce', rule_id: 'rule-butter-applesauce'}]), 'unknown_rule');
  assert.equal(create('rec-mushroom-risotto', [{ingredient_id: 'ing-butter', rule_id: 'rule-butter-applesauce'}]), 'rule_not_applicable');
  assert.equal(preview([...TAMARI, {ingredient_id: 'ing-fish-sauce', to_ingredient_id: 'ing-salt'}]), 'conflict');
  assert.equal(preview([{ingredient_id: 'ing-fish-sauce', to_ingredient_id: 'ing-durian'}]), 'unknown_ingredient');
  assert.equal(preview([{ingredient_id: 'ing-fish-sauce', to_ingredient_id: 'ing-tamari', ratio: 0}]), 'invalid_quantity');
  assert.equal(preview([{ingredient_id: 'ing-lime', to_ingredient_id: 'ing-tamari'}]), 'invalid_quantity', 'tamari cannot be counted in pieces');
  assert.equal(preview([{ingredient_id: 'ing-fish-sauce'}]), 'invalid_arguments');
  assert.equal(create(v.id, [{ingredient_id: 'ing-tamari', to_ingredient_id: 'ing-salt'}]), 'invalid_state', 'a variant of a variant');
  assert.equal(f.refuse(P + 'recipes.update', {id: v.id, patch: {servings: 4}}), 'invalid_state', 'a variant records its swaps and is not edited');
  assert.deepEqual(f.data, before);
  // The base changes: the variant keeps its lines and reads stale_base, in recipes.get and in a plan slot.
  const lines = f.data.recipes.find(r => r.id === v.id).lines;
  f.call(P + 'recipes.update', {id: 'rec-green-curry', patch: {servings: 3}});
  const view = f.call(P + 'recipes.get', {id: v.id}).recipe;
  assert.deepEqual([view.variant.stale_base, view.variant.base_revision, view.variant.base_current_revision], [true, 1, 2]);
  assert.deepEqual(f.data.recipes.find(r => r.id === v.id).lines, lines);
  f.call(P + 'plan.slot.set', {id: '2026-11-12:dinner', dishes: [{recipe_id: v.id}]});
  const flags = f.call(P + 'plan.get', {start: '2026-11-12', end: '2026-11-12'}).slots[0].flags.filter(x => x.type === 'stale_base');
  assert.deepEqual(flags, [{type: 'stale_base', dish: 0, recipe_id: v.id, base_recipe_id: 'rec-green-curry', base_revision: 1, base_current_revision: 2}]);
  // Cancel = archive the variant; an archived base cannot start a new variant.
  assert.equal(f.call(P + 'recipes.update', {id: v.id, patch: {archived: true}}).state, 'archived');
  f.call(P + 'recipes.update', {id: 'rec-shakshuka', patch: {archived: true}});
  assert.equal(create('rec-shakshuka', [{ingredient_id: 'ing-egg', to_ingredient_id: 'ing-tofu-firm'}]), 'invalid_state');
});
