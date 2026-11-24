'use strict';
// Package-level checks: generated contracts and fixtures match their builders, the operation table
// matches tools.json, every read leaves data byte-identical, seed validation rejects what the plan
// lists, and optional diagnostics never change business results.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const {compile} = require('./schema-validator.cjs');
const plugin = require('../plugin.cjs');
const tools = require('../tools.json');
const {fixture, ev} = require('./harness.cjs');
const P = 'platewright.';

test('generated tools, schemas and fixtures match their builders; 22 operations, 11 reads and 11 writes', () => {
  assert.deepEqual(require('../scripts/build-contracts.cjs').build({check: true}), []);
  assert.deepEqual(require('../scripts/build-fixtures.cjs').build({check: true}), []);
  assert.equal(tools.length, 22);
  assert.deepEqual(tools.filter(t => t.read_only).map(t => t.name.slice(P.length)).sort(), Object.keys(plugin.READS).sort());
  assert.deepEqual(tools.filter(t => !t.read_only).map(t => t.name.slice(P.length)).sort(), Object.keys(plugin.WRITES).sort());
  for (const t of tools.filter(x => !x.read_only)) {
    assert.ok(t.inputSchema.required.includes('request_id') && t.inputSchema.required.includes('expected_version'), t.name);
    assert.deepEqual(t.inputSchema.properties.expected_version.required, ['epoch', 'revision'], t.name + ' takes Core\'s {epoch, revision}');
    assert.ok(t.outputSchema.required.includes('id'), t.name + ' returns the object id');
  }
  assert.ok(!JSON.stringify(tools).includes('$ref'), 'published tool schemas are self-contained');
  assert.ok(tools.every(t => t.name.startsWith(P) && t.inputSchema.additionalProperties === false));
});

test('every read leaves business data byte-identical', () => {
  const f = fixture(), before = JSON.stringify(f.data);
  const reads = {
    'household.get': {}, 'ingredients.search': {query: 'lime'}, 'recipes.search': {}, 'recipes.get': {id: 'rec-green-curry', servings: 6, unit_system: 'us'},
    'recipes.check': {id: 'rec-green-curry'}, 'substitutions.list': {id: 'rec-green-curry'},
    'recipes.variant.preview': {id: 'rec-green-curry', swaps: [{ingredient_id: 'ing-fish-sauce', rule_id: 'rule-fish-sauce-tamari'}]},
    'plan.get': {}, 'pantry.list': {include_out: true}, 'shopping.get': {}, 'notifications.list': {}
  };
  assert.deepEqual(Object.keys(reads).sort(), Object.keys(plugin.READS).sort());
  for (const [name, args] of Object.entries(reads)) assert.equal(f.call(P + name, args).status, 'ok', name);
  assert.equal(JSON.stringify(f.data), before);
});

test('seed validation rejects what the plan lists (invalid_seed)', () => {
  const f = fixture(), base = f.data;
  const ctx = {app_id: 'platewright', binding: require('../fixtures/binding.json'), virtual_now: '2026-11-08T08:00:00-05:00'};
  const seedValid = compile(require('../schemas/seed.schema.json'), path.resolve(__dirname, '../schemas'));
  const rejects = (label, change, pattern) => {
    const d = structuredClone(base);
    change(d);
    let code = null;
    try { if (!seedValid(d)) code = 'schema'; else plugin.validateSeed(ctx, d); } catch (e) { code = e.code; if (pattern) assert.match(e.message, pattern, label); }
    assert.ok(code === 'invalid_seed' || code === 'schema', label + ' was accepted');
    return code;
  };
  plugin.validateSeed(ctx, base);
  rejects('duplicate recipe ID', d => d.recipes.push(structuredClone(d.recipes[0])), /Duplicate recipe/);
  rejects('duplicate constraint ID', d => d.members[1].constraints.push({...structuredClone(d.members[1].constraints[0]), id: 'con-nora-01'}), /Duplicate constraint/);
  rejects('recipe line with an unknown ingredient', d => { d.recipes[0].lines[0].ingredient_id = 'ing-nope'; d.recipes[0].revisions[0].content.lines[0].ingredient_id = 'ing-nope'; }, /not in the ingredient table/);
  rejects('slot with an unknown recipe', d => { d.plan[3].dishes[0].recipe_id = 'rec-nope'; }, /unknown recipe/);
  rejects('slot with an unknown member', d => { d.plan[3].attendees.push('person-zed'); }, /not a member/);
  rejects('variant whose base is missing', d => {
    const v = structuredClone(d.recipes[0]);
    v.id = 'rec-variant'; v.variant = {base_recipe_id: 'rec-gone', base_revision: 1, swaps: [{line: 0, from_ingredient_id: 'ing-x', to_ingredient_id: v.lines[0].ingredient_id, ratio: 1, rule_id: null, custom: true}], unverified: true};
    d.recipes.push(v);
  }, /missing recipe/);
  rejects('quantity in a unit its ingredient cannot be measured in', d => {
    const r = d.recipes.find(x => x.id === 'rec-banana-bread');
    r.lines[0].unit = 'cup'; r.revisions[0].content.lines[0].unit = 'cup';
  }, /cannot be measured in cup/);
  rejects('cooked slot dated after the loaded time', d => {
    Object.assign(d.plan[3], {state: 'cooked', cooked: {at: '2026-11-08T07:00:00-05:00', portions: [{recipe_id: 'rec-black-bean-tacos', revision: 1, made: 4, eaten: 4}], deducted: false, short: []}});
  }, /dated after the loaded time/);
  rejects('malformed date', d => { d.pantry[0].use_by = '2026-02-30'; }, /not a calendar date/);
  assert.equal(rejects('timestamp without a UTC offset', d => { d.plan[0].updated_at = '2026-10-30T20:00:00'; }), 'schema');
  rejects('account the binding does not declare', d => { d.account_id = 'platewright-other'; }, /binding/);
  rejects('constraint naming an allergen outside the nine', d => { d.members[2].constraints[0].allergen = 'tree_nut'; d.members[2].constraints[0].kind = 'medical'; }, /does not take/);
  rejects('invalid time zone', d => { d.household.time_zone = 'Mars/Olympus'; }, /IANA/);
  rejects('leftovers from a later slot', d => { d.plan[3].dishes.push({leftovers_of: '2026-11-10:dinner', recipe_id: 'rec-red-lentil-soup', portions: 1}); }, /earlier slot/);
  rejects('leftovers from a slot that does not exist', d => { d.plan[3].dishes.push({leftovers_of: '2026-11-02:dinner', recipe_id: 'rec-red-lentil-soup', portions: 1}); }, /earlier slot/);
  rejects('expires_on before effective_from', d => { d.members[0].constraints[0].expires_on = '2026-01-01'; }, /before effective_from/);
  rejects('revision content out of step', d => { d.recipes[0].title = 'Changed without a revision'; }, /differs from its last revision/);
});

test('optional diagnostics cannot change business results', () => {
  const run = opts => {
    const f = fixture(opts);
    f.call(P + 'pantry.set', {id: 'ing-lime', quantity: 4, unit: 'each', use_by: '2026-11-15'});
    f.event(ev('pantry.changed', '2026-11-08T09:00:00-05:00', {items: [{ingredient_id: 'ing-egg', quantity: 12, unit: 'each'}], by: 'person-evan'}, 'ev-diag'));
    return f;
  };
  const on = run(), off = run({logging: false});
  assert.deepEqual(on.data, off.data);
  assert.ok(on.logs.length > 0); assert.equal(off.logs.length, 0);
  assert.ok(on.logs.every(l => Object.values(l.details).every(v => typeof v === 'string' && v.length < 80)), 'diagnostics carry IDs only');
});
