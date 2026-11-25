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


// ---- Reference household ----------------------------------------------------------------------------
// The reference fixture starts from seeded records (tables, recipes, profiles) and then replays the
// household's life through the App's own hooks: generated history from 2025-01-01 (scripts/history.cjs,
// fixed seed) and five hand-written weeks from 2026-10-12, with the account's plan, pantry and list
// writes and the other members' events. Replaying keeps every history row, slot state, pantry row,
// notification and activity row consistent with the rules. Rows written by the account during the
// replay are then marked `seed` (they happened before any run), and only the event rows stay in the
// activity log, one per notification.
const plugin = require('../plugin.cjs');
const BINDING = require('../fixtures/binding.json');
const History = require('./history.cjs');
const ts = (date, time) => `${date}T${time}:00${History.offset(date)}`;
const NORA = 'person-nora', EVAN = 'person-evan', ELI = 'person-eli', ADA = 'person-ada';
const FAMILY = [NORA, EVAN, ELI, ADA];
const EVENT_RECIPES = ['rec-soba-salad', 'rec-gochujang-chicken'];

function referenceBase() {
  const allIngredients = [...D.MINIMAL_INGREDIENTS, ...D.MORE_INGREDIENTS].map(ingredient);
  const originals = [...D.MINIMAL_RECIPES, ...D.MORE_RECIPES];
  const seeded = originals.filter(x => !EVENT_RECIPES.includes(x.id));
  const revised = {
    'rec-shakshuka': [['2026-05-03T10:00:00-04:00', {servings: 2, lines: content(D.MINIMAL_RECIPES.find(x => x.id === 'rec-shakshuka')).lines.map(l => l.ingredient_id === 'ing-egg' ? {...l, quantity: 4} : l)}]],
    'rec-chili-con-carne': [['2026-03-08T17:00:00-05:00', {title: 'Chili'}], ['2026-06-14T17:00:00-04:00', {total_minutes: 90}]],
    'rec-pesto-pasta': [['2026-07-21T19:00:00-04:00', {tags: ['dinner', 'quick']}]]
  };
  const archived = {'rec-focaccia': '2026-09-02T20:00:00-04:00'};
  const recipes = seeded.map((x, i) => {
    const at = History.recipeCreated(i);
    const hist = (revised[x.id] || []).map(([when, change]) => [when, change]);
    // The given row is the latest content; the change object is what the earlier revision had.
    return recipe(x, at, i % 3 ? NORA : EVAN, {revisions: hist, archived: archived[x.id]});
  });
  const c = (id, body, at, by, opts) => constraint(id, body, at, by, opts);
  return {
    account_id: 'platewright-nora', owner_person_id: NORA,
    household: {name: 'Arden-Okafor household', time_zone: 'America/New_York', week_start: 'monday', unit_system: 'recipe', leftover_max_days: 3, use_soon_days: 2},
    members: [
      {person_id: NORA, display_name: 'Nora', portion_factor: 1, constraints: [
        c('con-nora-01', {kind: 'diet', diet: 'lactose_free', effective_from: '2026-03-02', expires_on: '2026-09-30', note: 'Six-month trial from the March check-up'}, '2026-03-02T08:00:00-05:00', NORA),
        c('con-nora-06', {kind: 'diet', diet: 'no_pork', effective_from: '2026-10-01', expires_on: null, note: null}, '2026-09-30T20:00:00-04:00', NORA),
        c('con-nora-02', {kind: 'limit', nutrient: 'sodium_mg', max: 800, effective_from: '2026-11-20', expires_on: null, note: 'Trying a lower-salt month'}, '2026-10-05T21:00:00-04:00', NORA),
        c('con-nora-03', {kind: 'dislike', tag: 'shellfish', effective_from: '2026-01-05', expires_on: null, note: null}, '2026-01-05T19:00:00-05:00', NORA),
        c('con-nora-04', {kind: 'medical', ingredient_id: 'ing-grapefruit', effective_from: '2026-09-15', expires_on: null, note: 'Pharmacist: no grapefruit with the new prescription'}, '2026-09-15T18:00:00-04:00', NORA)]},
      {person_id: EVAN, display_name: 'Evan', portion_factor: 1.5, constraints: [
        c('con-evan-01', {kind: 'limit', nutrient: 'kcal', max: 700, effective_from: '2026-11-09', expires_on: null, note: "Dietitian's cap per sitting, from the 9th"}, '2026-10-08T18:30:00-04:00', EVAN),
        c('con-evan-02', {kind: 'dislike', ingredient_id: 'ing-beetroot', effective_from: '2026-01-01', expires_on: null, note: null}, '2026-01-02T12:00:00-05:00', EVAN),
        c('con-evan-03', {kind: 'diet', diet: 'no_alcohol', effective_from: '2026-10-01', expires_on: '2026-10-31', note: 'Sober October'}, '2026-09-30T21:00:00-04:00', EVAN),
        c('con-evan-04', {kind: 'dislike', tag: 'mushroom', effective_from: '2026-04-10', expires_on: null, note: null}, '2026-04-10T19:00:00-04:00', EVAN)]},
      {person_id: ELI, display_name: 'Eli', portion_factor: 1, constraints: [
        c('con-eli-01', {kind: 'allergy', allergen: 'soy', strict: false, effective_from: '2026-01-10', expires_on: null, note: 'Mild; confirmed by the clinic'}, '2026-01-10T12:00:00-05:00', NORA),
        c('con-eli-02', {kind: 'dislike', tag: 'mushroom', effective_from: '2026-02-01', expires_on: null, note: null}, '2026-02-01T18:00:00-05:00', ELI, {ended: '2026-09-01T18:00:00-04:00'})]},
      {person_id: ADA, display_name: 'Ada', portion_factor: 0.5, constraints: [
        c('con-ada-01', {kind: 'dislike', tag: 'spicy', effective_from: '2026-04-01', expires_on: '2026-12-31', note: 'Going through a no-spice phase'}, '2026-04-01T09:00:00-04:00', NORA),
        c('con-ada-02', {kind: 'dislike', ingredient_id: 'ing-green-beans', effective_from: '2026-05-01', expires_on: '2026-06-30', note: null}, '2026-05-01T09:00:00-04:00', NORA),
        c('con-ada-03', {kind: 'allergy', allergen: 'sesame', strict: false, effective_from: '2026-01-01', expires_on: null, note: 'Mild reaction to tahini last winter'}, '2026-01-03T10:00:00-05:00', NORA),
        c('con-ada-04', {kind: 'allergy', allergen: 'peanut', strict: true, effective_from: '2026-01-01', expires_on: null, note: 'Carries an auto-injector'}, '2026-01-03T10:00:00-05:00', NORA),
        c('con-ada-05', {kind: 'dislike', ingredient_id: 'ing-mushroom', effective_from: '2026-09-01', expires_on: null, note: null}, '2026-08-30T19:00:00-04:00', ADA)]}
    ],
    ingredients: allIngredients, substitution_rules: [...D.MINIMAL_RULES, ...D.MORE_RULES].map(rule), recipes, plan: [],
    pantry: [],
    shopping: null, notifications: [], activity: []
  };
}

// [ingredient, quantity, unit, use_by, last set]
const PANTRY = [
  ['ing-coconut-milk', 800, 'ml', '2027-06-30', '2026-10-03T11:00:00-04:00'], ['ing-yogurt-lf', 500, 'g', '2026-11-12', '2026-11-06T17:00:00-05:00'],
  ['ing-egg', 6, 'each', '2026-11-20', '2026-09-12T10:00:00-04:00'], ['ing-flour-ap', 1000, 'g', null, '2026-09-12T10:00:00-04:00'],
  ['ing-butter', 0, 'g', null, '2026-11-04T19:00:00-05:00'], ['ing-black-beans-canned', 800, 'g', '2027-03-01', '2026-09-12T10:00:00-04:00'],
  ['ing-cumin', 40, 'g', null, '2026-09-20T10:00:00-04:00'], ['ing-lime', 2, 'each', '2026-11-09', '2026-11-06T17:00:00-05:00'],
  ['ing-onion', 4, 'each', '2026-11-30', '2026-11-01T11:00:00-05:00'], ['ing-garlic', 12, 'each', '2026-11-25', '2026-11-01T11:00:00-05:00'],
  ['ing-olive-oil', 750, 'ml', null, '2026-08-20T10:00:00-04:00'], ['ing-vegetable-oil', 500, 'ml', null, '2026-08-20T10:00:00-04:00'],
  ['ing-salt', 500, 'g', null, '2026-06-01T10:00:00-04:00'], ['ing-black-pepper', 50, 'g', null, '2026-06-01T10:00:00-04:00'],
  ['ing-sugar', 900, 'g', null, '2026-09-12T10:00:00-04:00'], ['ing-brown-sugar', 300, 'g', null, '2026-09-12T10:00:00-04:00'],
  ['ing-baking-powder', 100, 'g', '2027-04-30', '2026-09-12T10:00:00-04:00'], ['ing-baking-soda', 200, 'g', null, '2026-09-12T10:00:00-04:00'],
  ['ing-oats', 400, 'g', '2027-02-28', '2026-09-12T10:00:00-04:00'], ['ing-jasmine-rice', 1500, 'g', null, '2026-09-12T10:00:00-04:00'],
  ['ing-basmati-rice', 500, 'g', null, '2026-09-12T10:00:00-04:00'], ['ing-spaghetti', 500, 'g', '2027-08-31', '2026-09-12T10:00:00-04:00'],
  ['ing-penne', 0, 'g', '2027-08-31', '2026-10-30T19:00:00-04:00'], ['ing-lentils-red', 500, 'g', '2027-05-31', '2026-09-12T10:00:00-04:00'],
  ['ing-tomato-canned', 1200, 'g', '2027-09-30', '2026-09-12T10:00:00-04:00'], ['ing-passata', 0, 'g', '2027-01-31', '2026-11-02T19:00:00-05:00'],
  ['ing-chickpeas-canned', 400, 'g', '2027-04-30', '2026-09-12T10:00:00-04:00'], ['ing-veg-stock', 500, 'ml', '2026-11-11', '2026-11-03T19:00:00-05:00'],
  ['ing-soy-sauce', 250, 'ml', '2027-03-31', '2026-08-20T10:00:00-04:00'], ['ing-tamari', 150, 'ml', '2027-05-31', '2026-10-15T18:00:00-04:00'],
  ['ing-fish-sauce', 200, 'ml', '2027-10-31', '2026-08-20T10:00:00-04:00'], ['ing-green-curry-paste', 60, 'g', '2026-12-15', '2026-10-03T11:00:00-04:00'],
  ['ing-milk', 1000, 'ml', '2026-11-10', '2026-11-06T17:00:00-05:00'], ['ing-cheddar', 200, 'g', '2026-11-21', '2026-11-01T11:00:00-05:00'],
  ['ing-parmesan', 120, 'g', '2026-12-20', '2026-09-12T10:00:00-04:00'], ['ing-spinach', 150, 'g', '2026-11-08', '2026-11-05T18:00:00-05:00'],
  ['ing-carrot', 600, 'g', '2026-11-18', '2026-11-01T11:00:00-05:00'], ['ing-potato', 1500, 'g', '2026-11-28', '2026-11-01T11:00:00-05:00'],
  ['ing-tofu-firm', 400, 'g', '2026-11-07', '2026-09-12T10:00:00-04:00'], ['ing-peanut-butter', 340, 'g', '2027-02-28', '2026-07-10T10:00:00-04:00']
];

// One week's menu: [date, meal, recipe or {leftovers}, options]. outcome: cooked (default for past
// dates), skipped, cleared (cleared the day before) or planned.
const W = (date, meal, dish, o = {}) => ({date, meal, dish, ...o});
const LEFT = (of, portions) => ({leftovers_of: of, portions});
const MENU = [
  // Week of 2026-10-12
  W('2026-10-12', 'dinner', 'rec-spaghetti-bolognese'), W('2026-10-13', 'dinner', 'rec-dal'), W('2026-10-14', 'dinner', 'rec-salmon-traybake'),
  W('2026-10-15', 'dinner', 'rec-black-bean-tacos'), W('2026-10-16', 'dinner', 'rec-bacon-leek-pasta', {attendees: [EVAN, ELI, ADA]}),
  W('2026-10-17', 'breakfast', 'rec-banana-pancakes'), W('2026-10-17', 'lunch', 'rec-greek-salad', {outcome: 'skipped'}),
  W('2026-10-17', 'dinner', 'rec-margherita-pizza', {servings: 4}), W('2026-10-18', 'breakfast', 'rec-scrambled-eggs-toast', {servings: 3, attendees: [NORA, EVAN]}),
  W('2026-10-18', 'lunch', 'rec-minestrone', {servings: 6, made: 6, eaten: 3.5}), W('2026-10-18', 'dinner', 'rec-chicken-traybake'),
  W('2026-10-14', 'lunch', 'rec-hummus-wraps', {attendees: [NORA, EVAN]}),
  W('2026-10-19', 'lunch', LEFT('2026-10-18:lunch', 2), {attendees: [NORA, EVAN]}),
  // Week of 2026-10-19
  W('2026-10-19', 'dinner', 'rec-chana-masala'), W('2026-10-20', 'dinner', 'rec-turkey-meatballs'), W('2026-10-21', 'dinner', 'rec-mushroom-risotto', {outcome: 'cleared'}),
  W('2026-10-21', 'breakfast', 'rec-overnight-oats', {attendees: [NORA, EVAN]}), W('2026-10-22', 'dinner', 'rec-tofu-fried-rice', {servings: 4}),
  W('2026-10-23', 'dinner', 'rec-fish-tacos'), W('2026-10-24', 'breakfast', 'rec-yogurt-parfait'), W('2026-10-24', 'lunch', 'rec-quinoa-salad'),
  W('2026-10-24', 'dinner', 'rec-veg-lasagne', {made: 6, eaten: 5}),
  W('2026-10-25', 'breakfast', 'rec-baked-oatmeal', {servings: 6, made: 6, eaten: 3}), W('2026-10-25', 'lunch', LEFT('2026-10-24:dinner', 1), {attendees: [EVAN]}),
  W('2026-10-25', 'dinner', 'rec-beef-stew', {servings: 6, made: 6, eaten: 4}), W('2026-10-23', 'lunch', 'rec-lentil-salad', {attendees: [NORA, ELI]}),
  // Week of 2026-10-26
  W('2026-10-26', 'dinner', 'rec-red-lentil-soup'), W('2026-10-26', 'lunch', LEFT('2026-10-25:dinner', 2), {attendees: [NORA, EVAN]}),
  W('2026-10-27', 'dinner', 'rec-stuffed-peppers'), W('2026-10-28', 'dinner', 'rec-herb-cod'), W('2026-10-29', 'dinner', 'rec-peanut-noodles', {attendees: [NORA, EVAN]}),
  W('2026-10-30', 'lunch', 'rec-tabbouleh', {attendees: [NORA, EVAN], outcome: 'event-cleared'}), W('2026-10-30', 'dinner', 'rec-chicken-curry'),
  W('2026-10-31', 'breakfast', 'rec-green-smoothie'), W('2026-10-31', 'lunch', 'rec-tomato-soup-grilled-cheese'),
  W('2026-10-31', 'dinner', 'rec-chili-con-carne', {servings: 6, made: 6, eaten: 4, guests: [{guest_id: 'guest-sam', name: 'Sam', constraints: []}]}),
  W('2026-11-01', 'breakfast', 'rec-frittata'), W('2026-11-01', 'lunch', LEFT('2026-10-31:dinner', 2), {attendees: [EVAN, ELI]}),
  W('2026-11-01', 'dinner', 'rec-mushroom-risotto', {outcome: 'skipped'}), W('2026-10-28', 'lunch', 'rec-couscous-salad', {attendees: [NORA]}),
  // Week of 2026-11-02 (the loaded time is Sunday 2026-11-08, 08:00)
  W('2026-11-02', 'dinner', 'rec-miso-salmon', {attendees: [NORA, EVAN]}), W('2026-11-03', 'dinner', 'rec-ratatouille'),
  W('2026-11-04', 'dinner', 'rec-shepherds-pie', {servings: 6, made: 6, eaten: 4, deduct: true}), W('2026-11-05', 'lunch', LEFT('2026-11-04:dinner', 2), {attendees: [NORA, EVAN]}),
  W('2026-11-05', 'dinner', 'rec-halloumi-skewers'), W('2026-11-06', 'dinner', 'rec-pesto-pasta'),
  W('2026-11-07', 'breakfast', 'rec-overnight-oats'), W('2026-11-07', 'lunch', 'rec-hummus-wraps'), W('2026-11-07', 'dinner', 'rec-shakshuka', {servings: 6, made: 6, eaten: 4}),
  W('2026-11-08', 'breakfast', 'rec-banana-pancakes'), W('2026-11-08', 'lunch', LEFT('2026-11-07:dinner', 2), {attendees: [NORA, ELI]}),
  W('2026-11-08', 'dinner', 'rec-chicken-noodle-soup'),
  // Week of 2026-11-09 (upcoming)
  W('2026-11-09', 'dinner', 'rec-black-bean-tacos'), W('2026-11-10', 'dinner', 'rec-red-lentil-soup'), W('2026-11-11', 'dinner', 'rec-salmon-traybake'),
  W('2026-11-12', 'dinner', 'rec-spaghetti-bolognese'), W('2026-11-13', 'dinner', 'rec-frittata'), W('2026-11-14', 'breakfast', 'rec-yogurt-parfait', {attendees: [NORA, ADA]}),
  W('2026-11-14', 'dinner', 'rec-green-curry', {attendees: [NORA, ELI], guests: [{guest_id: 'guest-ines', name: 'Ines', constraints: [{kind: 'diet', diet: 'vegetarian'}]},
    {guest_id: 'guest-kofi', name: 'Kofi', constraints: []}, {guest_id: 'guest-lea', name: 'Lea', constraints: []}]}),
  W('2026-11-15', 'lunch', LEFT('2026-11-14:dinner', 2), {attendees: [NORA, EVAN]}), W('2026-11-15', 'dinner', 'rec-dal'),
  // Packed lunches and snacks across the five weeks
  W('2026-10-13', 'lunch', 'rec-quinoa-salad', {attendees: [NORA, EVAN]}), W('2026-10-15', 'snack', 'rec-carrot-muffins', {servings: 12, made: 12, eaten: 3}),
  W('2026-10-20', 'lunch', 'rec-soba-salad', {attendees: [NORA, EVAN]}), W('2026-10-22', 'lunch', 'rec-greek-salad', {attendees: [NORA, EVAN]}),
  W('2026-10-27', 'lunch', 'rec-lentil-salad', {attendees: [NORA, EVAN]}), W('2026-10-29', 'snack', 'rec-guacamole', {attendees: [ELI, ADA]}),
  W('2026-11-03', 'lunch', 'rec-tabbouleh', {attendees: [NORA, EVAN]}), W('2026-11-04', 'lunch', 'rec-minestrone', {servings: 6, made: 6, eaten: 2}),
  W('2026-11-10', 'lunch', 'rec-couscous-salad', {attendees: [NORA, EVAN]}), W('2026-11-12', 'snack', 'rec-brownies', {servings: 16, attendees: [EVAN, ADA]})
];

const MEAL_TIME = {breakfast: '09:30', lunch: '13:00', snack: '16:00', dinner: '20:30'};
const LOADED = '2026-11-08T08:00:00-05:00';
const WEEKS_START = '2026-10-10T16:00:00-04:00'; // the first hand-written step
const addDays = (date, n) => { const d = new Date(date + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const monday = date => { const d = new Date(date + 'T12:00:00Z'); return addDays(date, -((d.getUTCDay() + 6) % 7)); };
const MAYA = {guest_id: 'guest-maya', name: 'Maya', constraints: [{kind: 'allergy', allergen: 'tree_nut', strict: true}]};
const recipeEvent = (id, by) => {
  const x = D.MORE_RECIPES.find(y => y.id === id), c = content(x);
  return {recipe: {id, title: c.title, servings: c.servings, lines: c.lines.map(({ingredient_id, quantity, unit, optional}) => ({ingredient_id, quantity, unit, optional})),
    method_tags: c.method_tags, steps: c.steps, tags: c.tags, active_minutes: c.active_minutes, total_minutes: c.total_minutes}, by};
};
const EVENTS = [
  ['ev-pw-001', '2026-10-13T19:00:00-04:00', 'member.updated', {member_id: ELI, action: 'set', constraint: {id: 'con-eli-03', kind: 'dislike', ingredient_id: 'ing-olives', note: 'Says they taste like soap'}, by: ELI}],
  ['ev-pw-002', '2026-10-16T12:00:00-04:00', 'recipe.added', recipeEvent('rec-soba-salad', ELI)],
  ['ev-pw-003', '2026-10-17T09:00:00-04:00', 'pantry.changed', {items: [{ingredient_id: 'ing-spaghetti', quantity: 500, unit: 'g', use_by: '2027-08-31'},
    {ingredient_id: 'ing-tomato-canned', quantity: 1200, unit: 'g', use_by: '2027-09-30'}, {ingredient_id: 'ing-chickpeas-canned', quantity: 400, unit: 'g', use_by: '2027-04-30'},
    {ingredient_id: 'ing-parmesan', quantity: 120, unit: 'g', use_by: '2026-12-20'}], by: EVAN, note: 'Saturday shop'}],
  ['ev-pw-004', '2026-10-20T18:00:00-04:00', 'plan.changed', {id: '2026-10-22:dinner', action: 'set', dishes: [{recipe_id: 'rec-chicken-curry', servings: 4}], attendees: FAMILY, by: EVAN}],
  ['ev-pw-005', '2026-10-23T17:00:00-04:00', 'guest.changed', {id: '2026-10-24:dinner', action: 'set', guest: {guest_id: 'guest-ines', name: 'Ines', constraints: [{kind: 'diet', diet: 'vegetarian'}]}}],
  ['ev-pw-006', '2026-10-24T10:00:00-04:00', 'pantry.changed', {items: [{ingredient_id: 'ing-oats', quantity: 400, unit: 'g', use_by: '2027-02-28'},
    {ingredient_id: 'ing-egg', quantity: 12, unit: 'each', use_by: '2026-11-10'}], by: ELI, note: 'Farmers market'}],
  ['ev-pw-007', '2026-10-27T08:00:00-04:00', 'member.updated', {member_id: ADA, action: 'remove', constraint_id: 'con-ada-03', note: 'Allergist: outgrown', by: NORA}],
  ['ev-pw-008', '2026-10-29T18:00:00-04:00', 'plan.changed', {id: '2026-10-30:lunch', action: 'clear', by: EVAN}],
  ['ev-pw-009', '2026-10-31T12:00:00-04:00', 'pantry.changed', {items: [{ingredient_id: 'ing-tofu-firm', quantity: 400, unit: 'g', use_by: '2026-11-07'}], by: EVAN}],
  ['ev-pw-010', '2026-11-03T07:30:00-05:00', 'member.updated', {member_id: ELI, action: 'set', constraint: {id: 'con-eli-04', kind: 'diet', diet: 'vegetarian', effective_from: '2026-11-16', note: 'Going vegetarian from the 16th'}, by: ELI}],
  ['ev-pw-011', '2026-11-05T19:00:00-05:00', 'recipe.added', recipeEvent('rec-gochujang-chicken', EVAN)],
  ['ev-pw-012', '2026-11-07T21:00:00-05:00', 'shopping.changed', {action: 'tick', line_id: 'TICKED_BY_ELI', by: ELI}],
  ['ev-pw-013', '2026-11-07T21:30:00-05:00', 'plan.changed', {id: '2026-11-13:dinner', action: 'set', dishes: [{recipe_id: 'rec-gochujang-chicken'}], attendees: FAMILY, by: EVAN}],
  ['ev-pw-014', '2026-11-07T22:00:00-05:00', 'guest.changed', {id: '2026-11-14:dinner', action: 'set', guest: MAYA}]
];
const CURRY_LINES = content(D.MINIMAL_RECIPES.find(x => x.id === 'rec-green-curry')).lines;
const ACTIONS = [
  ['2026-10-12T09:00:00-04:00', 'members.constraint.remove', {id: EVAN, constraint_id: 'con-evan-04', note: 'Likes them now'}],
  ['2026-10-15T18:00:00-04:00', 'recipes.variant.create', {id: 'rec-green-curry', swaps: [{ingredient_id: 'ing-fish-sauce', rule_id: 'rule-fish-sauce-tamari'}], title: 'Green curry with tamari'}],
  ['2026-10-20T19:00:00-04:00', 'recipes.update', {id: 'rec-green-curry', patch: {lines: CURRY_LINES.map(l => l.ingredient_id === 'ing-sweet-potato' ? {...l, quantity: 300} : l)}}],
  ['2026-10-21T20:00:00-04:00', 'recipes.update', {id: 'rec-bacon-leek-pasta', patch: {archived: true}}],
  ['2026-10-22T20:00:00-04:00', 'recipes.variant.create', {id: 'rec-banana-bread', swaps: [{ingredient_id: 'ing-flour-ap', rule_id: 'rule-flour-gf'}], title: 'Gluten-free banana bread'}],
  ['2026-10-28T19:30:00-04:00', 'recipes.variant.create', {id: 'rec-green-curry', title: 'Nut-free green curry',
    swaps: [{ingredient_id: 'ing-green-curry-paste', rule_id: 'rule-paste-nut-free'}, {ingredient_id: 'ing-cashews', rule_id: 'rule-cashews-sunflower'}]}],
  ['2026-10-29T20:00:00-04:00', 'recipes.variant.create', {id: 'rec-mac-cheese', title: 'Mac and cheese with oat drink',
    swaps: [{ingredient_id: 'ing-milk', rule_id: 'rule-milk-oat'}, {ingredient_id: 'ing-butter', rule_id: 'rule-butter-plant'}]}],
  ['2026-11-02T19:00:00-05:00', 'recipes.variant.create', {id: 'rec-spaghetti-bolognese', title: 'Turkey bolognese', swaps: [{ingredient_id: 'ing-beef-mince', rule_id: 'rule-beef-turkey'}]}],
  ['2026-11-03T20:00:00-05:00', 'recipes.variant.create', {id: 'rec-chili-con-carne', title: 'Lentil chili',
    swaps: [{ingredient_id: 'ing-beef-mince', rule_id: 'rule-beef-lentils'}, {ingredient_id: 'ing-sour-cream', to_ingredient_id: 'ing-greek-yogurt', ratio: 1}]}],
  ['2026-11-07T18:00:00-05:00', 'shopping.generate', {start: '2026-11-09', end: '2026-11-15'}],
  ['2026-11-07T18:05:00-05:00', 'shopping.item.set', {text: 'Birthday candles', quantity: 1, unit: 'each'}],
  ['2026-11-07T18:06:00-05:00', 'shopping.item.set', {ingredient_id: 'ing-lemon', quantity: 2, unit: 'each'}],
  ['2026-11-07T18:07:00-05:00', 'shopping.item.set', {line: 'ing-cilantro', excluded: true, reason: 'Using parsley from the garden instead'}],
  ['2026-11-07T18:08:00-05:00', 'shopping.item.set', {line: 'ing-salmon', ticked: true}]
];

function reference() {
  let data = referenceBase(), seq = 0;
  const steps = [];
  for (const m of MENU) {
    const id = m.date + ':' + m.meal, dish = typeof m.dish === 'string' ? {recipe_id: m.dish, ...(m.servings ? {servings: m.servings} : {})} : m.dish;
    const args = {id, dishes: [dish], attendees: m.attendees || FAMILY, ...(m.guests ? {guests: m.guests} : {})};
    steps.push({at: ts(addDays(monday(m.date), -2), '17:00'), order: id, tool: 'plan.slot.set', args});
    const when = ts(m.date, MEAL_TIME[m.meal]);
    if (m.outcome === 'cleared') steps.push({at: ts(addDays(m.date, -1), '19:00'), order: id, tool: 'plan.slot.set', args: {id, dishes: []}});
    else if (m.outcome === 'skipped') steps.push({at: when, order: id, tool: 'plan.slot.mark', args: {id, status: 'skipped'}});
    else if (!m.outcome && Date.parse(when) < Date.parse(LOADED)) {
      const portions = m.made !== undefined ? [{recipe_id: dish.recipe_id, made: m.made, eaten: m.eaten}] : undefined;
      if (!dish.leftovers_of) steps.push({at: when, order: id, tool: 'plan.slot.mark', args: {id, status: 'cooked', ...(portions ? {portions} : {}), ...(m.deduct ? {deduct_pantry: true} : {})}});
      else steps.push({at: when, order: id, tool: 'plan.slot.mark', args: {id, status: 'cooked'}});
    }
  }
  for (const [at, tool, args] of ACTIONS) steps.push({at, order: '', tool, args});
  // Each pantry item's hand-written row is the last row of its history, set by the account at that time.
  for (const [id, quantity, unit, use_by, at] of PANTRY) steps.push({at, order: '', tool: 'pantry.set', args: {id, quantity, unit, use_by}});
  // The generated history before the hand-written weeks.
  const history = History.generate(data, new Map(PANTRY.map(([id, , , , at]) => [id, at])));
  for (const step of history.steps) steps.push(step);
  for (const [event_id, at, op, payload] of EVENTS) steps.push({at, order: '', event: {event_id, at, operation: 'platewright.' + op, payload}});
  steps.sort((a, b) => Date.parse(a.at) - Date.parse(b.at) || a.order.localeCompare(b.order));
  const ctx = (now, role = 'agent') => ({app_id: 'platewright', run_id: 'build', role, binding: BINDING, virtual_now: now});
  const lineOf = ingredientId => { const l = data.shopping.lines.find(x => x.ingredient_id === ingredientId && x.kind === 'derived'); if (!l) throw Error('No derived line for ' + ingredientId + ': ' + data.shopping.lines.map(x => x.ingredient_id).join(' ')); return l.id; };
  for (const step of steps) {
    if (Date.parse(step.at) >= Date.parse(LOADED)) throw Error('Replay step after the loaded time: ' + step.at);
    // A refused step stops the build, so steps before the hand-written weeks run on the data itself
    // (fast; the seeded base already holds records dated up to October 2026, so it is validated once
    // at the end); the hand-written weeks keep a working copy and a validation after each step.
    const careful = Date.parse(step.at) >= Date.parse(WEEKS_START);
    const work = careful ? structuredClone(data) : data;
    try {
      if (step.event) {
        const e = structuredClone(step.event);
        if (e.payload.line_id === 'TICKED_BY_ELI') e.payload.line_id = lineOf('ing-beef-mince');
        data = plugin.applyEvent(ctx(e.at, 'infra'), work, e);
      } else {
        const args = {...structuredClone(step.args), request_id: 'hist-' + String(++seq).padStart(3, '0'), expected_version: {epoch: 1, revision: seq}};
        if (args.line) { args.id = lineOf(args.line); delete args.line; }
        data = plugin.handleTool(ctx(step.at), work, 'platewright.' + step.tool, args).data;
      }
      if (careful) plugin.validateSeed(ctx(step.at), data);
    } catch (e) { e.message += ' (replay step ' + JSON.stringify(step).slice(0, 300) + ')'; throw e; }
  }
  // What the account did before the run is part of the seed: keep only the events' activity rows and
  // mark the account's history rows `seed`.
  data.activity = data.activity.filter(a => a.actor === 'event').map((a, i) => ({...a, seq: i + 1}));
  // A cooked dish records the recipe revision current when it was cooked (the base table already
  // holds later revisions while the history is replayed).
  for (const s of data.plan) if (s.cooked) for (const p of s.cooked.portions) {
    const r = data.recipes.find(x => x.id === p.recipe_id);
    p.revision = r.revisions.filter(x => Date.parse(x.at) <= Date.parse(s.cooked.at)).length;
  }
  // Meals before the hand-written weeks keep a shorter history: the account's planning row is dropped
  // when the row right after it carries the same dishes, people and guests (the meal was then cooked
  // or skipped as planned), since that row repeats everything it says except the time of planning. A
  // planning row stays whenever what follows changes something: a meal cleared, replaced by another
  // member, or with a guest added keeps the plan it started from. Changes by other members always stay.
  const same = (a, b) => JSON.stringify([a.dishes, a.attendees, a.guest_ids]) === JSON.stringify([b.dishes, b.attendees, b.guest_ids]);
  for (const s of data.plan) {
    if (s.date > History.LAST) continue;
    s.history = s.history.filter((row, i) => !(row.actor === 'agent' && row.action === 'set' && i < s.history.length - 1 && same(row, s.history[i + 1])));
  }
  // Generated notifications take their own ID series, so the hand-written ones keep ntf-0001 to ntf-0014.
  let own = 0, gen = 0;
  for (const n of data.notifications) n.id = n.event_id.startsWith('ev-pw-h') ? 'ntf-h' + String(++gen).padStart(4, '0') : 'ntf-' + String(++own).padStart(4, '0');
  (function mark(x) {
    if (Array.isArray(x)) return x.forEach(mark);
    if (!x || typeof x !== 'object') return;
    if (x.actor === 'agent') { x.actor = 'seed'; x.request_id = null; }
    Object.values(x).forEach(mark);
  })(data);
  plugin.validateSeed(ctx(LOADED), data);
  return data;
}

function outputs() {
  return {'fixtures/minimal.json': minimal(), 'fixtures/reference.json': reference()};
}
// One record per line: lists of records are written with each record as compact JSON on its own
// line, which keeps the files small and still lets a diff point at the record that changed.
const records = v => Array.isArray(v) && v.length > 0 && v.every(x => x && typeof x === 'object');
function layout(value, indent = '') {
  const inner = indent + '  ';
  if (records(value)) return '[\n' + value.map(x => inner + JSON.stringify(x)).join(',\n') + '\n' + indent + ']';
  if (value && typeof value === 'object' && !Array.isArray(value) && (!indent || Object.values(value).some(records))) {
    return '{\n' + Object.entries(value).map(([k, v]) => inner + JSON.stringify(k) + ': ' + layout(v, inner)).join(',\n') + '\n' + indent + '}';
  }
  return JSON.stringify(value);
}
function build({check = false} = {}) {
  const drift = [];
  for (const [file, value] of Object.entries(outputs())) {
    const text = layout(value) + '\n', target = path.join(root, file);
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
