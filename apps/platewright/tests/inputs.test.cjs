'use strict';
// Every one of the 22 tools answers every schema-valid input in the table below either with a result
// that passes the harness's checks (the tool's output schema, the seed schema and validateSeed on the
// data a write commits) or with a refusal carrying one of the App's documented error codes. Anything
// else fails the test: a thrown error without a code (Core's internal_error), a harness assertion
// (Core's invalid_plugin_result) or any other code. The inputs are built from each tool's own
// inputSchema: a value is only sent when the schema accepts it, and the table of values covers what a
// schema cannot rule out (impossible calendar dates, unknown and wrong-kind IDs, empty and blank
// strings, zero, negative, fractional, tiny and huge numbers up to 1e300, empty and duplicate lists)
// as well as optional fields given alone, without the fields they usually come with.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const tools = require('../tools.json');
const {compile} = require('./schema-validator.cjs');
const {fixture} = require('./harness.cjs');
const pkg = path.resolve(__dirname, '..');

const DATES = ['2026-11-10', '2026-11-07', '2026-13-01', '2026-02-30', '2026-00-10', '0000-01-01', '9999-12-31', '2025-01-01'];
const SLOTS = ['2026-11-10:dinner', '2026-11-07:dinner', '2026-11-01:dinner', '2026-11-05:lunch', '2026-11-20:lunch', '2026-13-01:dinner', '2026-02-30:lunch', '2026-11-09:breakfast'];
const IDS = ['rec-red-lentil-soup', 'rec-shakshuka', 'rec-missing', 'person-nora', 'person-eli', 'person-missing', 'ing-egg', 'ing-butter', 'ing-missing',
  'con-eli-01', 'con-eli-02', 'con-ada-02', 'con-nora-02', 'con-missing', 'rule-flour-gf', 'rule-missing', 'sl-0001', 'guest-sam', '2026-11-10:dinner', 'x'];
const TEXTS = ['Tuesday soup', ' ', 'x', 'bake', 'tree_nut', 'soy', 'vegetarian', 'gluten_free', 'mushroom', 'sodium_mg', 'kcal', 'gluten', '<b>&amp;</b>'];
const NUMBERS = [2, 0, -1, 0.5, 1e9, 200, 201, 1, 1e300, 1e-7, 1000001];
// The value a field starts from, so that the other fields are varied around a call that can succeed.
const FIRST = {
  'members.constraint.set.id': 'person-eli', 'members.constraint.remove.id': 'person-eli', 'members.constraint.remove.constraint_id': 'con-eli-01',
  'pantry.set.id': 'ing-egg', 'pantry.set.unit': 'each', 'shopping.item.set.id': 'sl-0001', 'shopping.item.remove.id': 'sl-0001',
  'household.get.id': 'person-nora', 'substitutions.list.ingredient_id': 'ing-butter', 'recipes.create.lines.ingredient_id': 'ing-egg',
  'recipes.create.lines.unit': 'each', 'recipes.update.patch.lines.ingredient_id': 'ing-egg', 'recipes.update.patch.lines.unit': 'each',
  'recipes.variant.preview.swaps.ingredient_id': 'ing-egg', 'recipes.variant.create.swaps.ingredient_id': 'ing-egg', 'plan.slot.set.attendees': 'person-nora'
};

// The App's error codes (README "Tools") and invalid_arguments, which the App also returns.
const CODES = new Set(['not_found', 'unknown_ingredient', 'unknown_member', 'unknown_rule', 'invalid_quantity', 'invalid_servings',
  'invalid_constraint', 'invalid_window', 'invalid_state', 'no_conversion', 'not_in_recipe', 'rule_not_applicable', 'conflict',
  'past_slot', 'not_yet', 'leftover_unavailable', 'derived_line', 'no_list', 'invalid_arguments']);
const problem = e => (CODES.has(e.code) ? null : `${e.code || 'no code'}: ${e.message}`);

const matches = (s, v) => {
  if (s.pattern && !new RegExp(s.pattern).test(v)) return false;
  return (s.minLength === undefined || v.length >= s.minLength) && (s.maxLength === undefined || v.length <= s.maxLength);
};
// Candidate values of a schema, the preferred one first, at most `cap` of them.
function values(s, key, cap = 40) {
  let out;
  if (s.anyOf || s.oneOf) out = (s.anyOf || s.oneOf).flatMap(x => values(x, key, cap));
  else if (s.enum) out = [...s.enum];
  else if (s.const !== undefined) out = [s.const];
  else if (s.type === 'string') {
    const pool = s.pattern && s.pattern.includes(':(breakfast') ? SLOTS : s.pattern && s.pattern.startsWith('^\\d{4}') ? DATES
      : [...IDS, ...TEXTS, ...(s.maxLength ? ['y'.repeat(s.maxLength), 'y'.repeat(s.maxLength + 1)] : []), ''];
    out = pool.filter(v => matches(s, v));
  } else if (s.type === 'number' || s.type === 'integer') {
    out = NUMBERS.filter(n => (s.type === 'number' || Number.isInteger(n)) && (s.minimum === undefined || n >= s.minimum) && (s.maximum === undefined || n <= s.maximum));
    if (s.minimum !== undefined) out.push(s.minimum);
    if (s.maximum !== undefined) out.push(s.maximum);
  } else if (s.type === 'boolean') out = [true, false];
  else if (s.type === 'null') out = [null];
  else if (s.type === 'array') {
    const items = values(s.items, key, 12);
    out = [[items[0]], [], [items[0], items[0]], ...items.slice(1).map(x => [x])];
    if (s.maxItems) out.push(Array.from({length: s.maxItems + 1}, (_, i) => items[i % items.length]));
  } else if (s.type === 'object') out = objects(s, key, cap);
  else out = [];
  const first = FIRST[key];
  if (first !== undefined) out = [first, ...out.filter(v => v !== first)];
  const seen = new Set();
  return out.filter(v => { const k = JSON.stringify(v); if (seen.has(k)) return false; seen.add(k); return true; }).slice(0, cap);
}
// An object with only its required fields, with every field, and each of those with one field varied.
function objects(s, key, cap) {
  const props = Object.entries(s.properties || {}), required = new Set(s.required || []);
  const first = Object.fromEntries(props.map(([k, v]) => [k, values(v, key + '.' + k, cap)]));
  const pick = keys => Object.fromEntries(keys.filter(k => first[k].length).map(k => [k, first[k][0]]));
  const bases = [pick(props.map(([k]) => k).filter(k => required.has(k))), pick(props.map(([k]) => k))];
  const out = [...bases];
  for (const base of bases) for (const [k] of props) for (const v of first[k].slice(1)) out.push({...base, [k]: v});
  for (const base of bases) for (const [k] of props) if (!required.has(k)) { const {[k]: _, ...rest} = base; out.push(rest); }
  return out;
}

test('all 22 tools answer schema-valid input with a valid result or a documented refusal', () => {
  assert.equal(tools.length, 22);
  const failures = [];
  let sent = 0;
  for (const tool of tools) {
    const op = tool.name.slice('platewright.'.length), valid = compile(tool.inputSchema, pkg);
    const {expected_version, request_id, ...props} = tool.inputSchema.properties;
    const schema = {...tool.inputSchema, properties: props, required: (tool.inputSchema.required || []).filter(k => !['expected_version', 'request_id'].includes(k))};
    for (const args of objects(schema, op, 1000)) {
      const full = tool.read_only ? args : {expected_version: {epoch: 1, revision: 0}, request_id: 'sweep-1', ...args};
      if (!valid(full)) continue;
      sent++;
      // A fresh household for every call, so each input meets the same records.
      const f = fixture({logging: false});
      try { f.call(tool.name, args); } catch (e) {
        if (problem(e)) failures.push(`${op} ${JSON.stringify(args).slice(0, 200)}: ${problem(e)}`);
      }
    }
  }
  assert.ok(sent > 1000, `only ${sent} inputs were sent`);
  assert.deepEqual(failures, []);
});

// Numbers at the ends of their range on records of the reference household, where the generic table
// above may not reach a recipe line or a cooked meal: huge and tiny swap ratios and quantities, at the
// largest servings, each followed by the reads that scale them.
test('extreme numbers on the reference household give a valid result or a documented refusal', () => {
  const seed = require('../fixtures/reference.json');
  const swap = ratio => ({id: 'rec-green-curry', swaps: [{ingredient_id: 'ing-fish-sauce', to_ingredient_id: 'ing-tamari', ratio}]});
  const line = quantity => ({title: 'Big pot', servings: 1, method_tags: ['simmer'], steps: ['Cook.'], tags: [],
    lines: [{ingredient_id: 'ing-butter', quantity, unit: 'lb'}]});
  const CALLS = [];
  for (const n of [1e300, 1e200, 1e20, 1e7, 1e6, 100, 0.01, 1e-7, 1e-300]) {
    CALLS.push([['recipes.variant.preview', swap(n)]], [['recipes.variant.create', swap(n)], ['recipes.get', {id: '$', servings: 200, unit_system: 'metric'}]]);
    CALLS.push([['recipes.create', line(n)], ['recipes.get', {id: '$', servings: 200}], ['plan.slot.set', {id: '2026-11-16:dinner', dishes: [{recipe_id: '$', servings: 200}]}],
      ['shopping.generate', {start: '2026-11-16', end: '2026-11-16'}], ['recipes.check', {id: '$', members: ['person-nora']}]]);
    CALLS.push([['pantry.set', {id: 'ing-butter', quantity: n, unit: 'lb'}], ['shopping.generate', {start: '2026-11-09', end: '2026-11-15'}], ['pantry.list', {}]]);
    CALLS.push([['shopping.item.set', {ingredient_id: 'ing-butter', quantity: n, unit: 'lb'}], ['shopping.get', {}]]);
    CALLS.push([['plan.slot.set', {id: '2026-11-16:dinner', dishes: [{leftovers_of: '2026-11-08:dinner', portions: n}]}], ['plan.get', {start: '2026-11-16', end: '2026-11-16'}]]);
    CALLS.push([['plan.slot.mark', {id: '2026-11-08:dinner', status: 'cooked', portions: [{recipe_id: 'rec-chicken-noodle-soup', made: n, eaten: Math.min(n, 1)}]}],
      ['plan.slot.set', {id: '2026-11-16:dinner', dishes: [{leftovers_of: '2026-11-08:dinner', portions: 2}]}], ['plan.get', {start: '2026-11-08', end: '2026-11-16'}]]);
    CALLS.push([['members.constraint.set', {id: 'person-eli', constraint: {kind: 'limit', nutrient: 'kcal', max: n, note: 'x'}}], ['recipes.check', {id: 'rec-green-curry', members: ['person-eli']}]]);
  }
  const failures = [];
  for (const steps of CALLS) {
    const f = fixture({seed, logging: false});
    let id = null;
    for (const [name, args] of steps) {
      const full = JSON.parse(JSON.stringify(args).replace(/"\$"/g, JSON.stringify(id)));
      try { const out = f.call('platewright.' + name, full); if (out.id && !id) id = out.id; } catch (e) {
        // Every call here is meant to pass the input schema; a refusal by the schema is a mistake in the table.
        const bad = problem(e) || (/^Input schema/.test(e.message) ? e.message : null);
        if (bad) failures.push(`${name} ${JSON.stringify(args).slice(0, 200)}: ${bad}`);
        break;
      }
    }
  }
  assert.deepEqual(failures, []);
  // The bounds themselves: a ratio of 1e300 used to overflow the scaled quantities to Infinity.
  const f = fixture({seed, logging: false});
  assert.equal(f.refuse('platewright.recipes.variant.preview', swap(1e300)), 'invalid_quantity');
  assert.equal(f.refuse('platewright.recipes.variant.create', swap(1e300)), 'invalid_quantity');
  assert.equal(f.refuse('platewright.recipes.variant.create', swap(1e-7)), 'invalid_quantity');
  assert.equal(f.refuse('platewright.pantry.set', {id: 'ing-butter', quantity: 1000001, unit: 'g'}), 'invalid_quantity');
  assert.equal(f.call('platewright.recipes.variant.create', swap(100)).state, 'active');
  assert.equal(f.call('platewright.pantry.set', {id: 'ing-butter', quantity: 1000000, unit: 'g'}).quantity, 1000000);
});
