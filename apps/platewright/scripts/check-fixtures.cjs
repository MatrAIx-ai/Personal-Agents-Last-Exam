#!/usr/bin/env node
'use strict';
// Consistency checks for fixtures/minimal.json and fixtures/reference.json, beyond validateSeed:
// recipe lines convert to grams (or are listed as not convertible on purpose), diet tags follow from
// the lines, titles and ingredient lists are distinct, constraint states and slot states agree with
// the loaded time, every timestamp is on or after 2025-01-01 (where the household's history starts),
// the only flags present are the ones each fixture is meant to show, every record obeys the App's
// rules as of its own date, hand-written and generated alike (see recordProblems), notification text
// reads as words rather than record IDs (see unreadable), the reference's two years read as lived-in
// (see historyProfile), the reference fits its declared counts, and the fixtures fit their size budget.
//   node scripts/check-fixtures.cjs [--output FILE]
const fs = require('node:fs'), path = require('node:path');
const plugin = require('../plugin.cjs');
const {compile} = require('../tests/schema-validator.cjs');
const {constraintState} = require('../src/check.cjs');
const {toGrams} = require('../src/units.cjs');
const {DIETS, localDate} = require('../src/common.cjs');
const root = path.resolve(__dirname, '..');
const FLOOR = '2025-01-01';
// Size budget: all files in fixtures/ together on disk, and each seed as the compact JSON that Infra
// sends in one env.load_seed request (Core validates the whole seed on every call, so its size is its
// speed). The budget sits just above the current size: the plan asked for under 1 MB, and the
// two-year history with complete meal histories needs slightly more (VALIDATION.md, deviations).
const MAX_TOTAL_FILE_BYTES = 1075000, MAX_COMPACT_BYTES = 1015000;
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
  if (compact > MAX_COMPACT_BYTES) fail(`fixture over its size budget (${compact} bytes as compact JSON)`);
  return {file, passed: !problems.length, problems, counts};
}

// Every record obeys the App's rules as of its own date, whether it was written by hand or generated.
// Flags of planned and cooked slots are checked above with the App's own check (constraints as they
// stood on each meal's date); here: recipes planned only once created and before archived, cooked
// revisions, each slot's history replayed under the App's transitions (see slotHistoryProblems),
// event rows that belong to notified events, leftovers within the household's limit
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
  // Each slot's history replays under the App's own rules, and ends in the slot as it stands.
  for (const s of data.plan) slotHistoryProblems(s, data.household.time_zone).forEach(fail);
  // A row written by an event belongs to an event that left a notification.
  const events = new Set(data.notifications.map(n => n.event_id));
  for (const s of data.plan) for (const h of s.history) if (h.actor === 'event' && !events.has(h.event_id)) fail(`${s.id}: ${h.action} at ${h.at} names no notified event`);
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

// Replays a slot's history with the transitions of src/plan.cjs (plan.slot.set, plan.slot.mark, the
// plan.changed event) and of the guest.changed event, and returns what the App would have refused:
// a meal is set when it is not planned and replaced when it is; only a planned meal is cleared,
// skipped, cooked or given guests; cooking and skipping keep the planned dishes and people; clearing
// empties the dishes and keeps the people; a guest row adds, changes or removes exactly one guest;
// nothing is planned, cleared or changed after the meal's date, and nothing is cooked before it.
// The slot itself is its last row: state, dishes, people, guests, updated_at and cooked time.
// One shortening is allowed, only for meals before the hand-written weeks: a meal cooked or skipped
// exactly as planned may start from that row, since the dropped planning row carried the same
// dishes, people and guests (scripts/build-fixtures.cjs).
const LAST_GENERATED = require('./history.cjs').LAST;
function slotHistoryProblems(s, zone) {
  const out = [], rows = s.history;
  const people = r => ({dishes: r.dishes, attendees: r.attendees, guest_ids: r.guest_ids});
  const same = (a, b) => JSON.stringify([a.dishes, a.attendees, a.guest_ids]) === JSON.stringify([b.dishes, b.attendees, b.guest_ids]);
  let state = null, cur = null;
  if (rows.length && s.date <= LAST_GENERATED && ['cooked', 'skipped'].includes(rows[0].action)) { state = 'planned'; cur = people(rows[0]); }
  rows.forEach((h, i) => { if (i && Date.parse(h.at) < Date.parse(rows[i - 1].at)) out.push(`${s.id}: history rows out of order at ${h.at}`); });
  for (const h of rows) {
    const day = localDate(h.at, zone), bad = message => out.push(`${s.id}: ${h.action} at ${h.at} ${message}`);
    const was = `a meal that was ${state || 'not planned'}`;
    if (['set', 'replaced', 'cleared', 'guest_added', 'guest_changed', 'guest_removed'].includes(h.action) && day > s.date) bad('comes after the meal\'s date');
    if (h.actor === 'event' ? !h.event_id : h.event_id !== null) bad('does not match its actor');
    if (h.action === 'set' || h.action === 'replaced') {
      if (state === 'cooked') bad('changes a cooked meal');
      else if ((h.action === 'replaced') !== (state === 'planned')) bad(`${h.action === 'set' ? 'sets' : 'replaces'} ${was}`);
      if (!h.dishes.length) bad('has no dishes');
      state = 'planned'; cur = people(h);
    } else if (h.action === 'cleared') {
      if (state !== 'planned') bad(`clears ${was}`);
      else if (h.dishes.length || !same({...cur, dishes: []}, h)) bad('changes more than the dishes');
      state = 'cleared'; cur = people(h);
    } else if (h.action === 'cooked' || h.action === 'skipped') {
      if (state !== 'planned') bad(`marks ${was}`);
      else if (!same(cur, h)) bad('records other dishes or people than were planned');
      if (h.action === 'cooked' && day < s.date) bad('comes before the meal\'s date');
      state = h.action; cur = people(h);
    } else if (h.action.startsWith('guest_')) {
      if (state !== 'planned') bad(`changes the guests of ${was}`);
      else {
        const before = cur.guest_ids, after = h.guest_ids;
        const ok = h.action === 'guest_added' ? after.length === before.length + 1 && before.every(g => after.includes(g)) && !before.includes(after.at(-1))
          : h.action === 'guest_removed' ? after.length === before.length - 1 && after.every(g => before.includes(g))
          : JSON.stringify(after) === JSON.stringify(before) && before.length > 0;
        if (!ok || !same({...cur, guest_ids: after}, h)) bad('does not change exactly one guest');
      }
      cur = people(h);
    } else bad('is not a slot action');
  }
  if (state !== s.state) out.push(`${s.id}: its history ends ${state || 'empty'}, but it is ${s.state}`);
  else if (!same(cur, {dishes: s.dishes, attendees: s.attendees, guest_ids: s.guests.map(g => g.guest_id)})) out.push(`${s.id}: differs from its last history row`);
  if (rows.length && rows.at(-1).at !== s.updated_at) out.push(`${s.id}: updated_at is not the time of its last row`);
  const cookedRow = rows.find(h => h.action === 'cooked');
  if ((s.state === 'cooked') !== !!s.cooked || (s.cooked && s.cooked.at !== cookedRow.at)) out.push(`${s.id}: its cooked record does not match its history`);
  return out;
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
  const files = fs.readdirSync(path.join(root, 'fixtures')).sort();
  const sizes = Object.fromEntries(files.map(f => [f, fs.statSync(path.join(root, 'fixtures', f)).size]));
  const total = Object.values(sizes).reduce((a, b) => a + b, 0);
  const size = {passed: total <= MAX_TOTAL_FILE_BYTES, total_bytes: total, budget_bytes: MAX_TOTAL_FILE_BYTES, files: sizes};
  return {schema: 'platewright.fixture-check.v1', passed: results.every(r => r.passed) && declared.passed && size.passed, results, declared_counts: declared, size};
}
module.exports = {run, checkFixture, unreadable, recordProblems, slotHistoryProblems};
if (require.main === module) {
  const report = run(), text = JSON.stringify(report, null, 2) + '\n';
  const i = process.argv.indexOf('--output');
  if (i > 0) fs.writeFileSync(path.resolve(process.argv[i + 1]), text);
  process.stdout.write(text);
  if (!report.passed) process.exitCode = 1;
}
