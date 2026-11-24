#!/usr/bin/env node
'use strict';
// Authoring-time builder of fixtures/minimal.json (the small household the business tests start
// from) and fixtures/reference.json (the package's full reference household). The JSON files are the
// fixtures; this script only keeps them reproducible. `--check` reports drift instead of writing.
const fs = require('node:fs'), path = require('node:path');
const D = require('./fixture-data.cjs');
const root = path.resolve(__dirname, '..');

const NUTRIENTS = ['kcal', 'protein_g', 'carbs_g', 'fat_g', 'sodium_mg'];
function ingredient([id, name, category, measures, density, piece, buy, whole, n, x]) {
  return {id, name, aliases: x.aliases || [], category, allergens: x.al || [], may_contain: x.may || [], flags: x.fl || [], tags: x.tags || [],
    measures: [...measures].map(m => ({m: 'mass', v: 'volume', c: 'count'})[m]), density_g_per_ml: density, piece_g: piece, buy_unit: buy,
    whole_pieces: whole, nutrition_per_100g: Object.fromEntries(NUTRIENTS.map((k, i) => [k, n[i]]))};
}
const rule = ([id, from, to, ratio, methods, note]) => ({id, from_ingredient_id: from, to_ingredient_id: to, ratio, methods, note});
const seedOrigin = (at, by) => ({at, actor: 'seed', by, request_id: null, event_id: null});
function content(r) {
  return {title: r.title, servings: r.servings, lines: r.lines.map(([ingredient_id, quantity, unit, optional]) => ({ingredient_id, quantity, unit, optional: !!optional, note: null})),
    method_tags: r.methods, steps: r.steps, tags: r.tags, active_minutes: r.active, total_minutes: r.total};
}
// A recipe with its revision history. `revisions` lists earlier contents as [at, partial change].
function recipe(r, at, by, {revisions = [], archived = null, variant = null} = {}) {
  const contents = [], o = seedOrigin(at, by);
  let current = content(r);
  if (revisions.length) {
    // The given row is the latest content; earlier revisions are rebuilt by undoing each change.
    const chain = [current];
    for (const [, before] of [...revisions].reverse()) { current = {...current, ...before}; chain.unshift(current); }
    current = chain[0];
    contents.push([o, chain[0]]);
    revisions.forEach(([when], i) => contents.push([seedOrigin(when, by), chain[i + 1]]));
  } else contents.push([o, current]);
  const last = contents.at(-1)[1];
  const out = {id: r.id, ...last, archived: !!archived, revision: contents.length,
    revisions: contents.map(([who, c], i) => ({revision: i + 1, ...who, content: c})), variant, origin: o,
    history: contents.map(([who], i) => ({...who, action: i ? 'revised' : 'created', revision: i + 1}))};
  if (archived) out.history.push({...seedOrigin(archived, by), action: 'archived', revision: contents.length});
  return out;
}
function constraint(id, body, at, by, {ended = null} = {}) {
  const c = {id, ...body, note: body.note ?? null, set_by: by, ended_at: ended,
    history: [{at, actor: 'seed', by, action: 'created', note: body.note ?? null, request_id: null, event_id: null, previous: null}]};
  if (ended) c.history.push({at: ended, actor: 'seed', by, action: 'ended', note: null, request_id: null, event_id: null, previous: null});
  return c;
}
function slot(id, state, dishes, at, by, {attendees, guests = [], cooked = null, note = null, history = null} = {}) {
  const [date, meal] = id.split(':');
  const row = action => ({...seedOrigin(at, by), action, dishes, attendees, guest_ids: guests.map(g => g.guest_id)});
  const s = {id, date, meal, state, dishes: state === 'cleared' ? [] : dishes, attendees, guests, note, cooked, updated_at: at, history: history || [row('set')]};
  if (!history && state !== 'planned') s.history.push({...row(state), dishes: s.dishes});
  return s;
}
function pantry(ingredient_id, quantity, unit, use_by, at, by) {
  return {ingredient_id, quantity, unit, use_by, updated_at: at,
    history: [{...seedOrigin(at, by), action: 'seed', quantity, unit, use_by, slot_id: null}]};
}

const ALL = ['person-nora', 'person-evan', 'person-eli', 'person-ada'];
function minimal() {
  const by = 'person-nora';
  const ingredients = D.MINIMAL_INGREDIENTS.map(ingredient);
  const recipes = D.MINIMAL_RECIPES.map((r, i) => recipe(r, `2026-${String(1 + (i % 8)).padStart(2, '0')}-${10 + i}T23:00:00Z`, by));
  return {
    account_id: 'platewright-nora', owner_person_id: by,
    household: {name: 'Arden-Okafor household', time_zone: 'America/New_York', week_start: 'monday', unit_system: 'recipe', leftover_max_days: 3, use_soon_days: 2},
    members: [
      {person_id: 'person-nora', display_name: 'Nora', portion_factor: 1, constraints: [
        constraint('con-nora-01', {kind: 'diet', diet: 'lactose_free', effective_from: '2026-03-02', expires_on: null, note: 'Since the March check-up'}, '2026-03-02T08:00:00-05:00', by),
        constraint('con-nora-02', {kind: 'limit', nutrient: 'sodium_mg', max: 800, effective_from: '2026-11-20', expires_on: null, note: 'Trying a lower-salt month'}, '2026-11-06T21:00:00-05:00', by)]},
      {person_id: 'person-evan', display_name: 'Evan', portion_factor: 1.5, constraints: [
        constraint('con-evan-01', {kind: 'limit', nutrient: 'kcal', max: 700, effective_from: '2026-10-01', expires_on: null, note: "Dietitian's cap per sitting"}, '2026-09-28T18:30:00-04:00', 'person-evan')]},
      {person_id: 'person-eli', display_name: 'Eli', portion_factor: 1, constraints: [
        constraint('con-eli-01', {kind: 'allergy', allergen: 'soy', strict: false, effective_from: '2026-01-10', expires_on: null, note: 'Mild; confirmed by the clinic'}, '2026-01-10T12:00:00-05:00', by),
        constraint('con-eli-02', {kind: 'dislike', tag: 'mushroom', effective_from: '2026-02-01', expires_on: null, note: null}, '2026-02-01T18:00:00-05:00', 'person-eli', {ended: '2026-09-01T18:00:00-04:00'})]},
      {person_id: 'person-ada', display_name: 'Ada', portion_factor: 0.5, constraints: [
        constraint('con-ada-01', {kind: 'dislike', tag: 'spicy', effective_from: '2026-04-01', expires_on: '2026-12-31', note: 'Going through a no-spice phase'}, '2026-04-01T09:00:00-04:00', by),
        constraint('con-ada-02', {kind: 'dislike', ingredient_id: 'ing-green-beans', effective_from: '2026-05-01', expires_on: '2026-06-30', note: null}, '2026-05-01T09:00:00-04:00', by)]}
    ],
    ingredients, substitution_rules: D.MINIMAL_RULES.map(rule), recipes,
    plan: [
      slot('2026-11-01:dinner', 'skipped', [{recipe_id: 'rec-mushroom-risotto', servings: null}], '2026-10-30T20:00:00-04:00', by, {attendees: ALL}),
      slot('2026-11-05:lunch', 'cleared', [{recipe_id: 'rec-red-lentil-soup', servings: null}], '2026-11-03T20:00:00-05:00', by, {attendees: ['person-nora', 'person-evan']}),
      slot('2026-11-07:dinner', 'cooked', [{recipe_id: 'rec-shakshuka', servings: 6}], '2026-11-07T19:30:00-05:00', by,
        {attendees: ALL, cooked: {at: '2026-11-07T19:30:00-05:00', portions: [{recipe_id: 'rec-shakshuka', revision: 1, made: 6, eaten: 4}], deducted: false, short: []}}),
      slot('2026-11-09:dinner', 'planned', [{recipe_id: 'rec-black-bean-tacos', servings: null}], '2026-11-06T21:00:00-05:00', by, {attendees: ALL}),
      slot('2026-11-10:dinner', 'planned', [{recipe_id: 'rec-red-lentil-soup', servings: null}], '2026-11-06T21:00:00-05:00', by, {attendees: ALL})
    ],
    pantry: [
      pantry('ing-coconut-milk', 800, 'ml', '2027-06-30', '2026-11-02T11:00:00-05:00', by),
      pantry('ing-yogurt-lf', 500, 'g', '2026-11-12', '2026-11-06T17:00:00-05:00', by),
      pantry('ing-egg', 6, 'each', '2026-11-20', '2026-11-06T17:00:00-05:00', by),
      pantry('ing-flour-ap', 1000, 'g', null, '2026-10-12T10:00:00-04:00', by),
      pantry('ing-butter', 0, 'g', null, '2026-11-04T19:00:00-05:00', by),
      pantry('ing-black-beans-canned', 400, 'g', '2027-03-01', '2026-10-12T10:00:00-04:00', by),
      pantry('ing-cumin', 40, 'g', null, '2026-09-20T10:00:00-04:00', by),
      pantry('ing-lime', 1, 'each', '2026-11-09', '2026-11-06T17:00:00-05:00', by)
    ],
    shopping: null, notifications: [], activity: []
  };
}

function outputs() {
  return {'fixtures/minimal.json': minimal()};
}
function build({check = false} = {}) {
  const drift = [];
  for (const [file, value] of Object.entries(outputs())) {
    const text = JSON.stringify(value, null, 2) + '\n', target = path.join(root, file);
    if (check) { if (!fs.existsSync(target) || fs.readFileSync(target, 'utf8') !== text) drift.push(file); }
    else fs.writeFileSync(target, text);
  }
  return drift;
}
module.exports = {build};
if (require.main === module) {
  const drift = build({check: process.argv.includes('--check')});
  if (drift.length) { console.error('Fixture drift: ' + drift.join(', ')); process.exitCode = 1; }
  else console.log(process.argv.includes('--check') ? 'Fixtures match their builder.' : 'Fixtures written.');
}
