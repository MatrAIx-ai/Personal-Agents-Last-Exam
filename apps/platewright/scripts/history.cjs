'use strict';
// Authoring-time generator of the reference household's earlier history, from 2025-01-01 up to the
// hand-written five weeks that start on 2026-10-12. It is deterministic (a fixed seed and a small
// PRNG, no clock, no Math.random), so scripts/build-fixtures.cjs reproduces the same bytes every run.
//
// It produces replay steps in the same form as the hand-written ones (Agent writes by the account
// holder and events from the other members), which build-fixtures.cjs runs through the App's own
// hooks. What it generates:
//   - weekly menus planned on the Saturday before each week, cooked, skipped or cleared, with packed
//     lunches from the previous dinner's leftovers, weekend breakfasts and lunches, baking, guests;
//   - other members' changes to the plan, guests they bring, and five earlier dated constraints;
//   - pantry stock: a first stocking, regular shops (by the account or by another member) and
//     occasional cooking that takes from the pantry.
// Rules it obeys: a dish is chosen only if the App's own check finds nothing for anyone at the table
// on that date with the household's final constraint set (so no slot carries a flag), and nothing
// with an allergen any attendee is ever allergic to; a recipe is planned only after it was created
// and before it was archived; leftovers are eaten within the household's leftover_max_days and never
// more than were left; a pantry item is never touched after the hand-written row that ends its
// history; seasonal dishes follow the time of year and favourites come round more often.
const R = require('../src/recipes.cjs');
const {check} = require('../src/check.cjs');

const SEED = 20250101;
const START = '2025-01-01', LAST = '2026-10-11', CLEAR_OUT = '2026-10-10T15:00:00-04:00';
const NORA = 'person-nora', EVAN = 'person-evan', ELI = 'person-eli', ADA = 'person-ada';
const FAMILY = [NORA, EVAN, ELI, ADA];

// mulberry32: a tiny deterministic PRNG.
function prng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const addDays = (date, n) => { const d = new Date(date + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const weekday = date => new Date(date + 'T12:00:00Z').getUTCDay(); // 0 = Sunday
// America/New_York offset on a date (second Sunday of March to first Sunday of November is EDT).
function nthSunday(year, month, n) {
  const first = new Date(Date.UTC(year, month - 1, 1)).getUTCDay();
  return `${year}-${String(month).padStart(2, '0')}-${String(1 + ((7 - first) % 7) + 7 * (n - 1)).padStart(2, '0')}`;
}
function offset(date) {
  const y = Number(date.slice(0, 4));
  return date >= nthSunday(y, 3, 2) && date < nthSunday(y, 11, 1) ? '-04:00' : '-05:00';
}
const at = (date, time) => `${date}T${time}:00${offset(date)}`;
const MEAL_TIME = {breakfast: '09:30', lunch: '13:00', snack: '16:00', dinner: '19:30'};

// Recipe roles in the generated menus. Seasonal weights: winter dishes from November to March,
// summer dishes from May to September; favourites come round more often.
const ROLES = {
  breakfast: ['rec-yogurt-parfait', 'rec-overnight-oats', 'rec-scrambled-eggs-toast', 'rec-banana-pancakes', 'rec-green-smoothie', 'rec-baked-oatmeal', 'rec-frittata', 'rec-shakshuka'],
  lunch: ['rec-lentil-salad', 'rec-hummus-wraps', 'rec-minestrone', 'rec-chicken-noodle-soup', 'rec-quinoa-salad', 'rec-squash-soup', 'rec-tomato-soup-grilled-cheese',
    'rec-greek-salad', 'rec-tabbouleh', 'rec-couscous-salad', 'rec-red-lentil-soup'],
  baking: ['rec-banana-bread', 'rec-brownies', 'rec-apple-crumble', 'rec-carrot-muffins', 'rec-focaccia'],
  dinner: ['rec-green-curry', 'rec-black-bean-tacos', 'rec-mushroom-risotto', 'rec-shakshuka', 'rec-chicken-traybake', 'rec-red-lentil-soup', 'rec-tofu-fried-rice',
    'rec-minestrone', 'rec-chicken-noodle-soup', 'rec-spaghetti-bolognese', 'rec-chili-con-carne', 'rec-salmon-traybake', 'rec-fish-tacos', 'rec-shrimp-stir-fry',
    'rec-pork-carnitas', 'rec-beef-stew', 'rec-chicken-curry', 'rec-veg-lasagne', 'rec-mac-cheese', 'rec-pesto-pasta', 'rec-peanut-noodles', 'rec-teriyaki-tofu',
    'rec-falafel-bowls', 'rec-dal', 'rec-chana-masala', 'rec-ratatouille', 'rec-stuffed-peppers', 'rec-shepherds-pie', 'rec-turkey-meatballs',
    'rec-mushroom-stroganoff', 'rec-miso-salmon', 'rec-herb-cod', 'rec-frittata', 'rec-bean-burgers', 'rec-margherita-pizza', 'rec-squash-soup',
    'rec-halloumi-skewers', 'rec-mussels-white-wine', 'rec-bacon-leek-pasta']
};
const FAVOURITES = ['rec-spaghetti-bolognese', 'rec-black-bean-tacos', 'rec-dal', 'rec-chicken-traybake', 'rec-red-lentil-soup', 'rec-pesto-pasta', 'rec-chana-masala', 'rec-salmon-traybake'];
const WINTER = ['rec-beef-stew', 'rec-chili-con-carne', 'rec-shepherds-pie', 'rec-chicken-noodle-soup', 'rec-minestrone', 'rec-squash-soup', 'rec-red-lentil-soup',
  'rec-mushroom-risotto', 'rec-veg-lasagne', 'rec-mac-cheese', 'rec-tomato-soup-grilled-cheese', 'rec-dal', 'rec-apple-crumble', 'rec-baked-oatmeal'];
const SUMMER = ['rec-halloumi-skewers', 'rec-greek-salad', 'rec-tabbouleh', 'rec-couscous-salad', 'rec-quinoa-salad', 'rec-lentil-salad', 'rec-fish-tacos',
  'rec-salmon-traybake', 'rec-ratatouille', 'rec-green-smoothie', 'rec-yogurt-parfait', 'rec-mussels-white-wine', 'rec-stuffed-peppers'];
const ONLY_IN_SEASON = {'rec-squash-soup': 'winter', 'rec-halloumi-skewers': 'summer', 'rec-greek-salad': 'summer'};
const BATCH = ['rec-red-lentil-soup', 'rec-minestrone', 'rec-spaghetti-bolognese', 'rec-chili-con-carne', 'rec-beef-stew', 'rec-dal', 'rec-chana-masala',
  'rec-veg-lasagne', 'rec-shepherds-pie', 'rec-chicken-curry', 'rec-squash-soup', 'rec-pork-carnitas'];
const season = date => { const m = Number(date.slice(5, 7)); return m >= 11 || m <= 3 ? 'winter' : m >= 5 && m <= 9 ? 'summer' : 'between'; };

// Earlier constraints, ended or expired long before the loaded time. `via` says how each was made:
// by the account (a write, part of the seed) or by another member (an event, with a notification).
const CONSTRAINTS = [
  {member: EVAN, by: EVAN, via: 'event', at: '2025-01-01T10:30:00-05:00',
    constraint: {id: 'con-evan-h1', kind: 'diet', diet: 'no_alcohol', effective_from: '2025-01-01', expires_on: '2025-01-31', note: 'Dry January'}},
  {member: NORA, by: NORA, via: 'account', at: '2025-01-30T20:00:00-05:00',
    constraint: {id: 'con-nora-h1', kind: 'diet', diet: 'vegetarian', effective_from: '2025-02-03', expires_on: '2025-03-02', note: 'Meat-free February'}},
  {member: ADA, by: NORA, via: 'account', at: '2025-03-14T19:00:00-04:00',
    constraint: {id: 'con-ada-h1', kind: 'dislike', ingredient_id: 'ing-zucchini', effective_from: '2025-03-15', expires_on: null, note: 'Picks it out of everything'},
    ended: {at: '2025-08-20T18:30:00-04:00', by: NORA, via: 'event', note: 'Ate the whole ratatouille at Grandma\'s'}},
  {member: ELI, by: ELI, via: 'event', at: '2025-05-09T17:00:00-04:00',
    constraint: {id: 'con-eli-h1', kind: 'dislike', ingredient_id: 'ing-eggplant', effective_from: '2025-05-10', expires_on: null, note: null},
    ended: {at: '2025-12-01T19:00:00-05:00', by: ELI, via: 'event', note: 'Fine with it again'}},
  {member: EVAN, by: EVAN, via: 'event', at: '2025-08-28T21:00:00-04:00',
    constraint: {id: 'con-evan-h2', kind: 'limit', nutrient: 'kcal', max: 1000, effective_from: '2025-09-01', expires_on: '2025-12-31', note: 'Training block for the autumn race'}}
];

// Pantry: what a shop brings home, [ingredient, quantity, unit, shelf life in days or null].
const SHOP = [
  ['ing-egg', 12, 'each', 21], ['ing-milk', 2000, 'ml', 8], ['ing-yogurt-lf', 500, 'g', 14], ['ing-spinach', 200, 'g', 5], ['ing-carrot', 1000, 'g', 21],
  ['ing-potato', 2000, 'g', 30], ['ing-onion', 6, 'each', 30], ['ing-garlic', 12, 'each', 30], ['ing-cheddar', 250, 'g', 30], ['ing-tofu-firm', 400, 'g', 14],
  ['ing-lime', 4, 'each', 10], ['ing-parmesan', 150, 'g', 60]
];
const STAPLES = [
  ['ing-coconut-milk', 800, 'ml', 540], ['ing-flour-ap', 1500, 'g', null], ['ing-butter', 250, 'g', null], ['ing-black-beans-canned', 800, 'g', 420],
  ['ing-cumin', 50, 'g', null], ['ing-olive-oil', 1000, 'ml', null], ['ing-jasmine-rice', 2000, 'g', null], ['ing-spaghetti', 1000, 'g', 600],
  ['ing-penne', 500, 'g', 600], ['ing-lentils-red', 1000, 'g', 480], ['ing-tomato-canned', 1600, 'g', 600], ['ing-chickpeas-canned', 800, 'g', 540],
  ['ing-oats', 1000, 'g', 300], ['ing-sugar', 1000, 'g', null], ['ing-soy-sauce', 500, 'ml', 365]
];

function generate(base, finalPantryAt) {
  const rand = prng(SEED);
  const pick = list => list[Math.floor(rand() * list.length)];
  const chance = p => rand() < p;
  const recipes = new Map(base.recipes.map(r => [r.id, r]));
  const ingredients = R.ingredientsMap(base);
  const zone = base.household.time_zone;
  // The household's final constraint set: the base constraints plus the generated ones with their
  // end dates, so the check sees what the finished fixture will hold.
  const members = base.members.map(m => ({...m, constraints: [...m.constraints, ...CONSTRAINTS.filter(x => x.member === m.person_id)
    .map(x => ({...x.constraint, ended_at: x.ended ? x.ended.at : null}))]}));
  const allergies = id => members.find(m => m.person_id === id).constraints.filter(c => c.kind === 'allergy').map(c => c.allergen);
  const revisionAt = (r, when) => r.revisions.filter(x => Date.parse(x.at) <= Date.parse(when)).length || 1;
  const available = (id, when) => {
    const r = recipes.get(id);
    if (!r || Date.parse(r.origin.at) > Date.parse(when)) return false;
    const archived = r.history.find(h => h.action === 'archived');
    return !archived || Date.parse(archived.at) > Date.parse(when);
  };
  // Fits: nothing found for anyone at the table on that date, and no allergen anyone is ever allergic to.
  function fits(id, date, attendees, guests) {
    const r = recipes.get(id), content = R.contentAt(r, revisionAt(r, at(date, '12:00')));
    const banned = new Set(attendees.flatMap(allergies).concat(guests.flatMap(g => g.constraints.filter(c => c.kind === 'allergy').map(c => c.allergen))));
    for (const line of content.lines) {
      const ing = ingredients.get(line.ingredient_id);
      if (ing.allergens.concat(ing.may_contain).some(a => banned.has(a))) return false;
    }
    const people = R.people({members}, attendees, guests);
    return check(content, people, date, {ingredients, zone}).every(v => v.verdict === 'ok' && !v.unchecked.length);
  }
  const recent = [];
  function choose(role, date, attendees, guests, plannedAt, extra = []) {
    const s = season(date);
    // Nothing from the last eight dishes, or from the last three when the table's needs leave few choices.
    const allowed = ROLES[role].filter(id => available(id, plannedAt) && !extra.includes(id) && (!ONLY_IN_SEASON[id] || ONLY_IN_SEASON[id] === s) &&
      fits(id, date, attendees, guests));
    let pool = allowed.filter(id => !recent.slice(-8).includes(id));
    if (!pool.length) pool = allowed.filter(id => !recent.slice(-3).includes(id));
    if (!pool.length) return null;
    const weights = pool.map(id => (FAVOURITES.includes(id) ? 3 : 1) * (s === 'winter' && WINTER.includes(id) ? 2.5 : s === 'summer' && SUMMER.includes(id) ? 2.5 : 1) *
      (s === 'summer' && WINTER.includes(id) ? 0.3 : s === 'winter' && SUMMER.includes(id) ? 0.3 : 1));
    let x = rand() * weights.reduce((a, b) => a + b, 0);
    for (let i = 0; i < pool.length; i++) { x -= weights[i]; if (x <= 0) return pool[i]; }
    return pool.at(-1);
  }

  const steps = [], events = [];
  let ev = 0;
  const event = (when, op, payload) => events.push({at: when, order: '', event: {event_id: 'ev-pw-h' + String(++ev).padStart(4, '0'), at: when, operation: 'platewright.' + op, payload}});
  const write = (when, tool, args, order = '') => steps.push({at: when, order, tool, args});

  // Earlier constraints.
  for (const x of CONSTRAINTS) {
    if (x.via === 'event') event(x.at, 'member.updated', {member_id: x.member, action: 'set', constraint: x.constraint, by: x.by});
    else write(x.at, 'members.constraint.set', {id: x.member, constraint: x.constraint});
    if (x.ended) {
      if (x.ended.via === 'event') event(x.ended.at, 'member.updated', {member_id: x.member, action: 'remove', constraint_id: x.constraint.id, note: x.ended.note, by: x.ended.by});
      else write(x.ended.at, 'members.constraint.remove', {id: x.member, constraint_id: x.constraint.id, note: x.ended.note});
    }
  }

  // Pantry: the first stocking on 2 January 2025, then a shop every twelve to sixteen days. A pantry
  // item whose hand-written row comes later keeps that row as the end of its history.
  const touchable = (id, when) => !finalPantryAt.has(id) || Date.parse(when) < Date.parse(finalPantryAt.get(id));
  const stockRow = ([id, q, unit, life], date) => ({ingredient_id: id, quantity: q, unit, use_by: life === null ? null : addDays(date, life)});
  for (const row of [...STAPLES, ...SHOP]) {
    const when = at('2025-01-02', '11:00');
    if (touchable(row[0], when)) write(when, 'pantry.set', (({ingredient_id, ...rest}) => ({id: ingredient_id, ...rest}))(stockRow(row, '2025-01-02')), row[0]);
  }
  const lastShop = new Map();
  for (let date = addDays('2025-01-02', 10); date < CLEAR_OUT.slice(0, 10); date = addDays(date, 12 + Math.floor(rand() * 5))) {
    const when = at(date, '10:30');
    // Perishables bought most recently longest ago first; a staple now and then.
    const due = SHOP.filter(r => touchable(r[0], when)).sort((a, b) => (lastShop.get(a[0]) || '').localeCompare(lastShop.get(b[0]) || '') || a[0].localeCompare(b[0]));
    const items = due.slice(0, 2 + Math.floor(rand() * 2));
    if (chance(0.3)) { const s = pick(STAPLES); if (touchable(s[0], when)) items.push(s); }
    if (!items.length) continue;
    items.forEach(r => lastShop.set(r[0], date));
    const rows = items.map(r => stockRow(r, date));
    const shopper = pick([NORA, NORA, EVAN, ELI]);
    if (shopper === NORA) rows.forEach(r => write(when, 'pantry.set', {id: r.ingredient_id, quantity: r.quantity, unit: r.unit, use_by: r.use_by}, r.ingredient_id));
    else event(when, 'pantry.changed', {items: rows, by: shopper, ...(chance(0.5) ? {note: pick(['Saturday market', 'On the way home', 'Corner shop', 'Big weekly shop'])} : {})});
  }
  // Items whose hand-written row comes after the hand-written weeks start are used up by then, so
  // those weeks begin from the same pantry as before the history was added.
  for (const [id] of [...STAPLES, ...SHOP]) {
    if (Date.parse(finalPantryAt.get(id)) > Date.parse(CLEAR_OUT)) write(CLEAR_OUT, 'pantry.set', {id, quantity: 0, unit: [...STAPLES, ...SHOP].find(r => r[0] === id)[2]}, id);
  }

  // Menus, planned on the Saturday before each week (the first week on New Year's Day itself).
  const GUESTS = [
    {guest_id: 'guest-ruth', name: 'Ruth', constraints: []},
    {guest_id: 'guest-tomas', name: 'Tomas', constraints: [{kind: 'diet', diet: 'vegetarian'}]},
    {guest_id: 'guest-priya', name: 'Priya', constraints: [{kind: 'allergy', allergen: 'crustacean_shellfish', strict: true}]},
    {guest_id: 'guest-owen', name: 'Owen', constraints: [{kind: 'dislike', tag: 'spicy'}]},
    {guest_id: 'guest-hana', name: 'Hana', constraints: [{kind: 'diet', diet: 'no_pork'}]}
  ];
  let week = START;
  const counts = {slots: 0, cooked: 0, skipped: 0, cleared: 0, leftovers: 0, guests: 0, deducted: 0, member_changes: 0};
  while (week <= LAST) {
    const monday = addDays(week, -((weekday(week) + 6) % 7));
    const planAt = week === START ? at(START, '10:00') : at(addDays(monday, -2), '17:00');
    const away = chance(0.12) ? pick([EVAN, ELI]) : null; // someone away for part of the week
    let previous = null;
    for (let i = 0; i < 7; i++) {
      const date = addDays(monday, i);
      if (date < week || date > LAST) continue;
      const day = weekday(date), weekend = day === 0 || day === 6;
      const family = away && i >= 2 && i <= 4 ? FAMILY.filter(p => p !== away) : FAMILY;
      const slots = [];
      // Packed lunch from yesterday's batch dinner on a weekday.
      if (previous && !weekend) slots.push({meal: 'lunch', leftovers: previous, attendees: [NORA, EVAN].filter(p => family.includes(p))});
      previous = null;
      if (weekend && chance(0.4)) slots.push({meal: 'breakfast', role: 'breakfast', attendees: family});
      if (weekend && !slots.some(s => s.meal === 'lunch') && chance(0.25)) slots.push({meal: 'lunch', role: 'lunch', attendees: family});
      if (day === 0 && chance(0.3)) slots.push({meal: 'snack', role: 'baking', attendees: family, baking: true});
      if (date === START || chance(0.9)) { // the household started on New Year's Day with a dinner
        const guests = day === 6 && chance(0.2) ? [pick(GUESTS)] : [];
        slots.push({meal: 'dinner', role: 'dinner', attendees: family, guests});
      }
      for (const s of slots) {
        const id = date + ':' + s.meal;
        let dish, guests = s.guests || [];
        if (s.leftovers) {
          if (!s.attendees.length) continue;
          dish = {leftovers_of: s.leftovers.id, recipe_id: s.leftovers.recipe_id, portions: Math.min(s.attendees.length, 2)};
        } else {
          const recipe = choose(s.role, date, s.attendees, guests, planAt);
          if (!recipe) continue;
          recent.push(recipe);
          const r = recipes.get(recipe);
          dish = {recipe_id: recipe};
          if (s.baking) dish.servings = r.servings;
          else if (s.meal === 'dinner' && BATCH.includes(recipe) && chance(0.55)) {
            const own = Math.ceil(2 * (s.attendees.map(p => members.find(m => m.person_id === p).portion_factor).reduce((a, b) => a + b, 0) + guests.length)) / 2;
            dish.servings = own + 2;
            previous = {id, recipe_id: recipe};
          }
        }
        // A guest who is mentioned only after the plan is made arrives by event.
        const lateGuest = guests.length && chance(0.4);
        write(planAt, 'plan.slot.set', {id, dishes: [dish], attendees: s.attendees, ...(guests.length && !lateGuest ? {guests} : {})}, id);
        counts.slots++;
        if (guests.length) counts.guests++;
        if (lateGuest) event(at(addDays(date, -2), '18:00'), 'guest.changed', {id, action: 'set', guest: guests[0]});
        const mealAt = at(date, MEAL_TIME[s.meal]);
        // What happened: another member changes a dinner, it is cleared or skipped, or it is cooked.
        const roll = rand();
        if (s.meal === 'dinner' && !dish.servings && !guests.length && roll < 0.03) {
          const other = choose('dinner', date, s.attendees, [], at(addDays(date, -1), '18:00'), [dish.recipe_id]);
          if (other) {
            recent.push(other);
            event(at(addDays(date, -1), '18:00'), 'plan.changed', {id, action: 'set', dishes: [{recipe_id: other}], attendees: s.attendees, by: pick([EVAN, ELI])});
            dish = {recipe_id: other};
            counts.member_changes++;
          }
        }
        const outcome = previous && previous.id === id ? 'cooked' : roll > 0.97 ? 'cleared' : roll > 0.94 ? 'skipped' : 'cooked';
        if (outcome === 'cleared') {
          if (chance(0.5)) event(at(addDays(date, -1), '19:00'), 'plan.changed', {id, action: 'clear', by: EVAN});
          else write(at(addDays(date, -1), '19:00'), 'plan.slot.set', {id, dishes: []}, id);
          counts.cleared++;
        } else if (outcome === 'skipped') {
          write(mealAt, 'plan.slot.mark', {id, status: 'skipped'}, id);
          counts.skipped++;
        } else {
          const args = {id, status: 'cooked'};
          if (s.baking) args.portions = [{recipe_id: dish.recipe_id, made: dish.servings, eaten: Math.min(dish.servings, 4)}];
          // Now and then the account lets cooking take from the pantry, while every item it would
          // touch is still before its hand-written last row.
          if (!dish.leftovers_of && chance(0.03)) {
            const r = recipes.get(dish.recipe_id);
            if (r.lines.every(l => touchable(l.ingredient_id, mealAt))) { args.deduct_pantry = true; counts.deducted++; }
          }
          write(mealAt, 'plan.slot.mark', args, id);
          counts.cooked++;
          if (dish.leftovers_of) counts.leftovers++;
        }
      }
    }
    week = addDays(monday, 7);
  }
  return {steps: steps.concat(events), counts: {...counts, events: ev, constraints: CONSTRAINTS.length}};
}

// When each seeded recipe joined the box: the first 24 on 1 January 2025, when the household started
// using Platewright, then one every ten days through 2025.
function recipeCreated(index) {
  const date = index < 24 ? START : addDays(START, (index - 23) * 10);
  return at(date, index < 24 ? '09:00' : '20:00');
}

module.exports = {generate, recipeCreated, offset, SEED, START, LAST, CONSTRAINTS};
