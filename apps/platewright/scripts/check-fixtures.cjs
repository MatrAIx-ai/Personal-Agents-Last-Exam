#!/usr/bin/env node
'use strict';
// Consistency checks for fixtures/minimal.json and fixtures/reference.json, beyond validateSeed:
// recipe lines convert to grams (or are listed as not convertible on purpose), diet tags follow from
// the lines, titles and ingredient lists are distinct, constraint states and slot states agree with
// the loaded time, every timestamp is on or after 2025-01-01 (where the household's history starts),
// the only flags present are the ones each fixture is meant to show, every record obeys the App's
// rules as of its own date, hand-written and generated alike (see recordProblems), notification text
// reads as words rather than record IDs (see unreadable), the reference's two years read as lived-in
// (see historyProfile), and the reference fits its declared counts and its size budget.
//   node scripts/check-fixtures.cjs [--output FILE]
const fs = require('node:fs'), path = require('node:path');
const plugin = require('../plugin.cjs');
const {compile} = require('../tests/schema-validator.cjs');
const {constraintState} = require('../src/check.cjs');
const {toGrams} = require('../src/units.cjs');
const {DIETS, localDate} = require('../src/common.cjs');
const root = path.resolve(__dirname, '..');
const FLOOR = '2025-01-01';
// Size budget: the file (one record per line) and the compact JSON that Infra sends in one
// env.load_seed request. Core validates the whole seed on every call, so its size is its speed.
const MAX_FILE_BYTES = 1100000, MAX_COMPACT_BYTES = 1048576;
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
    states: {'con-nora-01': 'expired', 'con-nora-06': 'active', 'con-nora-02': 'scheduled', 'con-nora-03': 'active', 'con-nora-04': 'active', 'con-nora-h1': 'expired',
      'con-evan-01': 'scheduled', 'con-evan-02': 'active', 'con-evan-03': 'expired', 'con-evan-04': 'ended', 'con-evan-h1': 'expired', 'con-evan-h2': 'expired',
      'con-eli-01': 'active', 'con-eli-02': 'ended', 'con-eli-h1': 'ended', 'con-eli-03': 'active', 'con-eli-04': 'scheduled',
      'con-ada-01': 'active', 'con-ada-02': 'expired', 'con-ada-03': 'ended', 'con-ada-04': 'active', 'con-ada-05': 'active', 'con-ada-h1': 'ended'},
    stale: true, history: true
  }
};

// Text a person reads (notification titles and bodies) names things in words: no record IDs, no
// slot IDs, no ISO dates and no vocabulary keys with underscores. Returns what is wrong, or null.
function unreadable(text) {
  const rules = [[/\d{4}-\d{2}-\d{2}/, 'an ISO date'], [/\b(ing|rec|person|con|guest|sl|ntf|ev|rule)-[a-z0-9]/, 'a record ID'],
    [/:(breakfast|lunch|snack|dinner)\b/, 'a slot ID'], [/[a-z]_[a-z]/, 'a vocabulary key'], [/\b(null|undefined)\b|\[object/, 'a missing value']];
  const hit = rules.find(([re]) => re.test(text));
  return hit ? `contains ${hit[1]}: ${text}` : null;
}

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
  // Every timestamp and date in the records is on or after 2025-01-01.
  (function walk(x, where) {
    if (typeof x === 'string' && /^\d{4}-\d{2}-\d{2}(T|$)/.test(x) && x.slice(0, 10) < FLOOR) fail(`${where}: ${x} is before ${FLOOR}`);
    else if (x && typeof x === 'object') for (const [k, v] of Object.entries(x)) walk(v, where + '.' + k);
  })(data, 'seed');
  // The only flags present are the intended ones.
  const flags = Object.fromEntries(Object.entries(plugin.flagsFromSnapshot(data)).map(([id, list]) => [id, list.map(f => (f.type === 'person' ? f.id + ':' + f.verdict : f.type === 'limit_unchecked' ? f.type + ':' + f.id : f.type))]));
  if (JSON.stringify(flags) !== JSON.stringify(expected.flags)) fail('flags ' + JSON.stringify(flags));
  if (expected.stale !== undefined) {
    const stale = require('../src/shopping.cjs').view({virtual_now: now}, data).list.stale;
    if (stale !== expected.stale) fail('shopping list stale ' + stale);
  }
  recordProblems(data, fail);
  if (expected.history) Object.assign(counts, historyProfile(data, today, fail));
  const bytes = fs.statSync(path.join(root, file)).size, compact = Buffer.byteLength(JSON.stringify(data));
  Object.assign(counts, {bytes, compact_bytes: compact, ingredients: data.ingredients.length, substitution_rules: data.substitution_rules.length, recipes: data.recipes.length,
    variants: data.recipes.filter(r => r.variant).length, members: data.members.length, constraints: Object.keys(states).length, plan_slots: data.plan.length,
    pantry_items: data.pantry.length, shopping_lines: data.shopping ? data.shopping.lines.length : 0, notifications: data.notifications.length,
    activity_rows: data.activity.length, records: plugin.records(data).length});
  if (bytes > MAX_FILE_BYTES || compact > MAX_COMPACT_BYTES) fail(`fixture over its size budget (${bytes} bytes, ${compact} compact)`);
  return {file, passed: !problems.length, problems, counts};
}

// Every record obeys the App's rules as of its own date, whether it was written by hand or generated.
// Flags of planned and cooked slots are checked above with the App's own check (constraints as they
// stood on each meal's date); here: recipes planned only once created and before archived, cooked
// revisions, a slot's last history row agreeing with its state, leftovers within the household's limit
// and never more than were left, pantry rows that are possible, notifications in time order with one
// activity row each, and notification text that reads as words.
function recordProblems(data, fail) {
  const recipes = new Map(data.recipes.map(r => [r.id, r])), slots = new Map(data.plan.map(s => [s.id, s]));
  for (const s of data.plan) {
    const set = s.history.filter(h => h.dishes.length && ['set', 'replaced'].includes(h.action));
    for (const h of set) for (const d of h.dishes) {
      const r = recipes.get(d.recipe_id), archived = r.history.find(x => x.action === 'archived');
      if (Date.parse(h.at) < Date.parse(r.origin.at)) fail(`${s.id}: ${r.id} planned at ${h.at}, before it was created`);
      if (archived && Date.parse(h.at) > Date.parse(archived.at)) fail(`${s.id}: ${r.id} planned after it was archived`);
    }
    if (s.cooked) for (const p of s.cooked.portions) {
      const r = recipes.get(p.recipe_id), current = r.revisions.filter(x => Date.parse(x.at) <= Date.parse(s.cooked.at)).length;
      if (p.revision !== current) fail(`${s.id}: cooked from revision ${p.revision}, but revision ${current} was current`);
    }
  }
  // A slot's last change of state is the state it is in (guest rows do not change the state).
  const STATE_OF = {set: 'planned', replaced: 'planned', cleared: 'cleared', cooked: 'cooked', skipped: 'skipped'};
  for (const s of data.plan) {
    const last = s.history.filter(h => STATE_OF[h.action]).at(-1);
    if (!last || STATE_OF[last.action] !== s.state) fail(`${s.id}: its history ends ${last ? last.action : 'without a change of state'}, but it is ${s.state}`);
    if (s.history.some((h, i) => i && Date.parse(h.at) < Date.parse(s.history[i - 1].at))) fail(`${s.id}: history rows out of order`);
  }
  // Leftovers eaten: within leftover_max_days of the source and never more than it left.
  const taken = new Map();
  for (const s of data.plan.filter(x => x.state === 'cooked')) for (const d of s.dishes.filter(x => x.leftovers_of)) {
    const src = slots.get(d.leftovers_of);
    if (src.state !== 'cooked') fail(`${s.id}: ate leftovers of ${src.id}, which was ${src.state}`);
    if (require('../src/common.cjs').daysBetween(src.date, s.date) > data.household.leftover_max_days) fail(`${s.id}: leftovers older than leftover_max_days`);
    taken.set(src.id, (taken.get(src.id) || 0) + d.portions);
  }
  for (const [id, n] of taken) {
    const src = slots.get(id), left = src.cooked ? src.cooked.portions.reduce((a, p) => a + p.made - p.eaten, 0) : 0;
    if (n > left) fail(`${id}: ${n} portions of leftovers eaten, ${left} left`);
  }
  // Pantry rows: in time order, never negative, cooking only takes, the item is its last row.
  for (const p of data.pantry) {
    p.history.forEach((h, i) => {
      if (h.quantity < 0) fail(`pantry ${p.ingredient_id}: negative stock at ${h.at}`);
      if (i && Date.parse(h.at) < Date.parse(p.history[i - 1].at)) fail(`pantry ${p.ingredient_id}: rows out of order at ${h.at}`);
      if (h.action === 'cooked' && (!i || h.quantity > p.history[i - 1].quantity)) fail(`pantry ${p.ingredient_id}: cooking at ${h.at} added stock`);
    });
    const last = p.history.at(-1);
    if (last.quantity !== p.quantity || last.use_by !== p.use_by || last.at !== p.updated_at) fail(`pantry ${p.ingredient_id}: the item differs from its last row`);
  }
  // Notifications: one per event, in time order, each with an activity row, worded for a person.
  data.notifications.forEach((n, i) => { if (i && Date.parse(n.at) < Date.parse(data.notifications[i - 1].at)) fail(`notification ${n.id} out of order`); });
  if (data.notifications.map(n => n.event_id).join() !== data.activity.map(a => a.event_id).join()) fail('notifications and activity rows do not match one to one');
  for (const n of data.notifications) for (const text of [n.title, n.body]) { const problem = unreadable(text); if (problem) fail(`notification ${n.id} ${problem}`); }
}

// What makes the reference read as two lived-in years: every month from January 2025 has a plan,
// soups and stews follow the seasons, and default reads stay sized for a week or a page.
function historyProfile(data, today, fail) {
  const pantryRows = data.pantry.reduce((n, p) => n + p.history.length, 0);
  // Every month from January 2025 to the loaded month has a lived-in plan.
  const months = {};
  for (const s of data.plan) months[s.date.slice(0, 7)] = (months[s.date.slice(0, 7)] || 0) + 1;
  for (let m = FLOOR.slice(0, 7); m < today.slice(0, 7); m = new Date(Date.parse(m + '-15') + 31 * 864e5).toISOString().slice(0, 7)) {
    if ((months[m] || 0) < 25) fail(`only ${months[m] || 0} plan slots in ${m}`);
  }
  // Seasonality: soups and stews come round more in winter than in summer.
  const WARM = ['rec-beef-stew', 'rec-chili-con-carne', 'rec-shepherds-pie', 'rec-chicken-noodle-soup', 'rec-minestrone', 'rec-squash-soup', 'rec-red-lentil-soup'];
  const share = test => { const xs = data.plan.filter(s => s.state === 'cooked' && test(Number(s.date.slice(5, 7))) && s.dishes.some(d => !d.leftovers_of));
    return xs.filter(s => s.dishes.some(d => !d.leftovers_of && WARM.includes(d.recipe_id))).length / xs.length; };
  const winter = share(m => m === 12 || m <= 2), summer = share(m => m >= 6 && m <= 8);
  if (!(winter > 2 * summer)) fail(`soups and stews are not seasonal (winter ${winter}, summer ${summer})`);
  // Default reads stay sized for a week or a page, not two years.
  const ctx = {app_id: 'platewright', virtual_now: read('fixtures/clock.json').initial_time};
  const size = (op, args) => Buffer.byteLength(JSON.stringify(plugin.handleTool(ctx, data, 'platewright.' + op, args).result));
  const week = plugin.handleTool(ctx, data, 'platewright.plan.get', {}).result;
  if (week.slots.some(s => s.date < week.start || s.date > week.end) || require('../src/common.cjs').daysBetween(week.start, week.end) !== 6) fail('plan.get by default is not one week');
  return {history_from: data.plan.map(s => s.date).sort()[0], months_covered: Object.keys(months).length, pantry_history_rows: pantryRows,
    winter_soup_share: Math.round(winter * 100) / 100, summer_soup_share: Math.round(summer * 100) / 100,
    default_read_bytes: {'plan.get': size('plan.get', {}), 'recipes.search': size('recipes.search', {}), 'pantry.list': size('pantry.list', {}),
      'household.get': size('household.get', {}), 'notifications.list': size('notifications.list', {}), 'shopping.get': size('shopping.get', {})}};
}

function run() {
  const results = Object.keys(EXPECTED).map(checkFixture);
  const app = read('app.json'), dataset = read('contribution/dataset.json');
  const seed = results.find(r => r.file === app.fixtures.seed);
  const declared = {passed: !!seed && dataset.expected_counts.records === seed.counts.records && dataset.expected_counts.assets === 0,
    detail: `${app.fixtures.seed}: ${seed && seed.counts.records} records; dataset.json expects ${dataset.expected_counts.records}`};
  return {schema: 'platewright.fixture-check.v1', passed: results.every(r => r.passed) && declared.passed, results, declared_counts: declared};
}
module.exports = {run, checkFixture, unreadable};
if (require.main === module) {
  const report = run(), text = JSON.stringify(report, null, 2) + '\n';
  const i = process.argv.indexOf('--output');
  if (i > 0) fs.writeFileSync(path.resolve(process.argv[i + 1]), text);
  process.stdout.write(text);
  if (!report.passed) process.exitCode = 1;
}
