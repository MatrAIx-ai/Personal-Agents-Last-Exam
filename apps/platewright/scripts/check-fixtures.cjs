#!/usr/bin/env node
'use strict';
// Consistency checks for fixtures/minimal.json and fixtures/reference.json, beyond validateSeed:
// recipe lines convert to grams (or are listed as not convertible on purpose), diet tags follow from
// the lines, titles and ingredient lists are distinct, constraint states and slot states agree with
// the loaded time, every timestamp is on or after 2026-01-01, the only flags present are the ones
// each fixture is meant to show, and the reference fits its declared counts and the 1 MiB budget.
//   node scripts/check-fixtures.cjs [--output FILE]
const fs = require('node:fs'), path = require('node:path');
const plugin = require('../plugin.cjs');
const {compile} = require('../tests/schema-validator.cjs');
const {constraintState} = require('../src/check.cjs');
const {toGrams} = require('../src/units.cjs');
const {DIETS, localDate} = require('../src/common.cjs');
const root = path.resolve(__dirname, '..');
const read = f => JSON.parse(fs.readFileSync(path.join(root, f), 'utf8'));

// Ingredients counted without a weight per piece: their lines are not convertible to grams on purpose.
const NOT_CONVERTIBLE = ['ing-bay-leaf', 'ing-veg-stock-cube'];
// Recipe tags that claim something about every line, optional lines included.
const TAG_RULES = {
  vegetarian: ing => !ing.flags.some(f => DIETS.vegetarian.includes(f)),
  vegan: ing => !ing.flags.some(f => DIETS.vegan.includes(f)),
  'gluten-free': ing => !ing.flags.includes('gluten'),
  'dairy-free': ing => !ing.allergens.includes('milk')
};
const EXPECTED = {
  'fixtures/minimal.json': {
    // Nora's lactose-free diet against optional dairy; Eli's soy allergy against a tortilla that may contain soy;
    // Evan's kcal limit cannot be checked on the lentil soup, whose bay leaves have no weight.
    flags: {'2026-11-07:dinner': ['person-nora:ok_if_omitted'], '2026-11-09:dinner': ['person-nora:ok_if_omitted', 'person-eli:may_contain'],
      '2026-11-10:dinner': ['limit_unchecked:person-evan']},
    states: {'con-nora-01': 'active', 'con-nora-02': 'scheduled', 'con-evan-01': 'active', 'con-eli-01': 'active', 'con-eli-02': 'ended', 'con-ada-01': 'active', 'con-ada-02': 'expired'}
  },
  'fixtures/reference.json': {
    // Evan's cap cannot be checked on Tuesday's lentil soup (bay leaves have no weight).
    // History: optional wine in October (Evan's alcohol-free month), tortillas and wraps that may contain soy (Eli),
    // optional jalapeño and chili powder (Ada's no-spice phase). Upcoming: Evan's 700 kcal cap from the 9th,
    // Friday's dinner changed by Evan to a soy-glazed dish (Eli), Saturday's guests Ines (vegetarian) and Maya
    // (strict tree-nut allergy, added after the shopping list), and Sunday's leftovers that Saturday no longer leaves.
    flags: {'2026-10-12:dinner': ['person-evan:ok_if_omitted'], '2026-10-15:dinner': ['person-eli:may_contain'], '2026-10-29:snack': ['person-ada:ok_if_omitted'],
      '2026-10-31:dinner': ['person-ada:disliked'], '2026-11-07:lunch': ['person-eli:may_contain'], '2026-11-09:dinner': ['person-eli:may_contain'],
      '2026-11-10:dinner': ['limit_unchecked:person-evan'], '2026-11-10:lunch': ['person-evan:over_limit'], '2026-11-12:dinner': ['person-evan:over_limit'],
      '2026-11-13:dinner': ['person-evan:over_limit', 'person-eli:unsafe', 'person-ada:disliked'], '2026-11-14:dinner': ['guest-ines:unsuitable', 'guest-maya:unsafe'],
      '2026-11-15:dinner': ['person-evan:over_limit'], '2026-11-15:lunch': ['person-evan:over_limit', 'leftover_short']},
    states: {'con-nora-01': 'expired', 'con-nora-06': 'active', 'con-nora-02': 'scheduled', 'con-nora-03': 'active', 'con-nora-04': 'active', 'con-evan-01': 'scheduled',
      'con-evan-02': 'active', 'con-evan-03': 'expired', 'con-evan-04': 'ended', 'con-eli-01': 'active', 'con-eli-02': 'ended', 'con-eli-03': 'active',
      'con-eli-04': 'scheduled', 'con-ada-01': 'active', 'con-ada-02': 'expired', 'con-ada-03': 'ended', 'con-ada-04': 'active', 'con-ada-05': 'active'},
    stale: true
  }
};

function checkFixture(file) {
  const data = read(file), problems = [], counts = {};
  const fail = message => problems.push(message);
  const now = read('fixtures/clock.json').initial_time;
  const ctx = {app_id: 'platewright', binding: read('fixtures/binding.json'), virtual_now: now};
  const schema = compile(read('schemas/seed.schema.json'), path.join(root, 'schemas'));
  if (!schema(data)) fail('seed schema');
  try { plugin.validateSeed(ctx, data); } catch (e) { fail('validateSeed: ' + e.message); }
  const today = localDate(now, data.household.time_zone);
  const ingredients = new Map(data.ingredients.map(i => [i.id, i]));
  // Lines convert to grams, or the ingredient is not convertible on purpose.
  for (const r of data.recipes) for (const l of r.lines) {
    const ing = ingredients.get(l.ingredient_id);
    if (toGrams(l.quantity, l.unit, ing) === null && !NOT_CONVERTIBLE.includes(ing.id)) fail(`${r.id}: ${ing.id} in ${l.unit} does not convert to grams`);
  }
  for (const id of NOT_CONVERTIBLE) if (ingredients.has(id) && toGrams(1, 'each', ingredients.get(id)) !== null) fail(`${id} is listed as not convertible but converts`);
  // Diet tags follow from the lines.
  for (const r of data.recipes) for (const [tag, ok] of Object.entries(TAG_RULES)) {
    if (r.tags.includes(tag)) for (const l of r.lines) if (!ok(ingredients.get(l.ingredient_id))) fail(`${r.id} is tagged ${tag} but has ${l.ingredient_id}`);
  }
  // Distinct titles and ingredient lists.
  const titles = new Set(), lists = new Set();
  for (const r of data.recipes) {
    if (titles.has(r.title.toLowerCase())) fail('duplicate title ' + r.title);
    titles.add(r.title.toLowerCase());
    const key = r.lines.map(l => l.ingredient_id).sort().join(',');
    if (lists.has(key)) fail('duplicate ingredient list in ' + r.id);
    lists.add(key);
  }
  // Constraint states at the loaded time.
  const states = Object.fromEntries(data.members.flatMap(m => m.constraints.map(c => [c.id, constraintState(c, today, data.household.time_zone)])));
  const expected = EXPECTED[file];
  if (JSON.stringify(states) !== JSON.stringify(expected.states)) fail('constraint states ' + JSON.stringify(states));
  // Slot states agree with the loaded time: nothing planned in the past, nothing cooked in the future.
  for (const s of data.plan) {
    if (s.date < today && s.state === 'planned') fail(`${s.id} is planned but its date has passed`);
    if (s.date > today && s.state === 'cooked') fail(`${s.id} is cooked in the future`);
  }
  // Every timestamp and date in the records is on or after 2026-01-01.
  (function walk(x, where) {
    if (typeof x === 'string' && /^\d{4}-\d{2}-\d{2}(T|$)/.test(x) && x.slice(0, 10) < '2026-01-01') fail(`${where}: ${x} is before 2026-01-01`);
    else if (x && typeof x === 'object') for (const [k, v] of Object.entries(x)) walk(v, where + '.' + k);
  })(data, 'seed');
  // The only flags present are the intended ones.
  const flags = Object.fromEntries(Object.entries(plugin.flagsFromSnapshot(data)).map(([id, list]) => [id, list.map(f => (f.type === 'person' ? f.id + ':' + f.verdict : f.type === 'limit_unchecked' ? f.type + ':' + f.id : f.type))]));
  if (JSON.stringify(flags) !== JSON.stringify(expected.flags)) fail('flags ' + JSON.stringify(flags));
  if (expected.stale !== undefined) {
    const stale = require('../src/shopping.cjs').view({virtual_now: now}, data).list.stale;
    if (stale !== expected.stale) fail('shopping list stale ' + stale);
  }
  const bytes = fs.statSync(path.join(root, file)).size;
  Object.assign(counts, {bytes, ingredients: data.ingredients.length, substitution_rules: data.substitution_rules.length, recipes: data.recipes.length,
    variants: data.recipes.filter(r => r.variant).length, members: data.members.length, constraints: Object.keys(states).length, plan_slots: data.plan.length,
    pantry_items: data.pantry.length, shopping_lines: data.shopping ? data.shopping.lines.length : 0, notifications: data.notifications.length,
    activity_rows: data.activity.length, records: plugin.records(data).length});
  if (bytes > 1048576) fail('fixture larger than 1 MiB');
  return {file, passed: !problems.length, problems, counts};
}

function run() {
  const results = Object.keys(EXPECTED).map(checkFixture);
  const app = read('app.json'), dataset = read('contribution/dataset.json');
  const seed = results.find(r => r.file === app.fixtures.seed);
  const declared = {passed: !!seed && dataset.expected_counts.records === seed.counts.records && dataset.expected_counts.assets === 0,
    detail: `${app.fixtures.seed}: ${seed && seed.counts.records} records; dataset.json expects ${dataset.expected_counts.records}`};
  return {schema: 'platewright.fixture-check.v1', passed: results.every(r => r.passed) && declared.passed, results, declared_counts: declared};
}
module.exports = {run, checkFixture};
if (require.main === module) {
  const report = run(), text = JSON.stringify(report, null, 2) + '\n';
  const i = process.argv.indexOf('--output');
  if (i > 0) fs.writeFileSync(path.resolve(process.argv[i + 1]), text);
  process.stdout.write(text);
  if (!report.passed) process.exitCode = 1;
}
