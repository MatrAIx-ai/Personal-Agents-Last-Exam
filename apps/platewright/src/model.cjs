'use strict';
// Seed validation and the record/object hooks. The seed schema checks shapes; validateSeed checks
// meaning: IDs, references, dates, units, revisions and that history agrees with the loaded time.
const c = require('./common.cjs');
const u = require('./units.cjs');
const H = require('./household.cjs');
const R = require('./recipes.cjs');
const {fail} = c;

const bad = message => fail('invalid_seed', message);
function unique(values, what) {
  const seen = new Set();
  for (const v of values) { if (seen.has(v)) bad(`Duplicate ${what} ${v}.`); seen.add(v); }
  return seen;
}
const date = (value, where) => { if (value !== null && !c.isDate(value)) bad(`${where}: ${value} is not a calendar date.`); };
// Converts App rule failures inside seed records to invalid_seed with their location.
function within(where, fn) {
  try { return fn(); } catch (e) { if (e.code === 'invalid_seed' || !e.code) throw e; return bad(`${where}: ${e.message}`); }
}

function validateSeed(ctx, data) {
  const binding = ctx.binding;
  if (!binding.people.some(p => p.person_id === data.owner_person_id) ||
      !binding.accounts.some(a => a.app_id === ctx.app_id && a.account_id === data.account_id && a.owner_person_id === data.owner_person_id)) {
    bad('The account and its owner must be declared in the trusted binding.');
  }
  const hh = data.household;
  if (!c.validTimeZone(hh.time_zone)) bad(`${hh.time_zone} is not an IANA time zone.`);
  const todayDate = c.localDate(ctx.virtual_now, hh.time_zone);

  // Reference tables.
  const ingredientIds = unique(data.ingredients.map(i => i.id), 'ingredient');
  for (const i of data.ingredients) {
    if (i.allergens.some(a => i.may_contain.includes(a))) bad(`${i.id} lists an allergen as both contained and may-contain.`);
    if (!u.measurable(i, i.buy_unit)) bad(`${i.id} is bought in ${i.buy_unit}, a unit it is not measured in.`);
    if (i.whole_pieces && !i.measures.includes('count')) bad(`${i.id} is sold in whole pieces but is not counted.`);
    if (i.measures.includes('count') && i.piece_g === null && i.buy_unit !== 'each') bad(`${i.id} is counted but has no weight per piece and is not bought by the piece.`);
  }
  unique(data.substitution_rules.map(r => r.id), 'substitution rule');
  for (const r of data.substitution_rules) {
    if (!ingredientIds.has(r.from_ingredient_id) || !ingredientIds.has(r.to_ingredient_id)) bad(`Rule ${r.id} names an unknown ingredient.`);
    if (r.from_ingredient_id === r.to_ingredient_id || !(r.ratio > 0)) bad(`Rule ${r.id} must change the ingredient at a positive ratio.`);
  }

  // Members and their constraints.
  const memberIds = unique(data.members.map(m => m.person_id), 'member');
  if (!memberIds.has(data.owner_person_id)) bad('The account holder must be a member of the household.');
  unique(data.members.flatMap(m => m.constraints.map(x => x.id)), 'constraint');
  for (const m of data.members) {
    for (const con of m.constraints) {
      const where = `Constraint ${con.id}`;
      within(where, () => H.target(data, con));
      date(con.effective_from, where); date(con.expires_on, where);
      if (con.effective_from && con.expires_on && con.expires_on < con.effective_from) bad(`${where}: expires_on is before effective_from.`);
      if (!con.history.length) bad(`${where} has no history.`);
      if (con.set_by !== null && !memberIds.has(con.set_by)) bad(`${where} was set by ${con.set_by}, who is not a member.`);
      if (con.ended_at && Date.parse(con.ended_at) > Date.parse(ctx.virtual_now)) bad(`${where} ended after the loaded time.`);
      if ((con.ended_at !== null) !== (con.history.at(-1).action === 'ended')) bad(`${where}: ended_at must match its last history row.`);
      for (const row of con.history) if (Date.parse(row.at) > Date.parse(ctx.virtual_now)) bad(`${where} has history after the loaded time.`);
    }
  }

  // Recipes, revisions and variants.
  const recipes = new Map(data.recipes.map(r => [r.id, r]));
  unique(data.recipes.map(r => r.id), 'recipe');
  for (const r of data.recipes) {
    const where = `Recipe ${r.id}`;
    for (const row of r.revisions) within(`${where} revision ${row.revision}`, () => R.normalizeContent(data, row.content));
    if (r.revisions.map(x => x.revision).join() !== r.revisions.map((x, i) => i + 1).join()) bad(`${where}: revisions must be numbered 1 to n.`);
    if (r.revision !== r.revisions.length) bad(`${where}: revision ${r.revision} is not its last revision.`);
    if (JSON.stringify(R.contentOf(r)) !== JSON.stringify(r.revisions.at(-1).content)) bad(`${where}: current content differs from its last revision.`);
    if (Date.parse(r.origin.at) > Date.parse(ctx.virtual_now)) bad(`${where} was created after the loaded time.`);
    if (r.variant) {
      const base = recipes.get(r.variant.base_recipe_id);
      if (!base) bad(`${where} is a variant of missing recipe ${r.variant.base_recipe_id}.`);
      if (base.variant) bad(`${where} is a variant of a variant.`);
      if (r.variant.base_revision > base.revision) bad(`${where} names base revision ${r.variant.base_revision}, which ${base.id} does not have.`);
      for (const s of r.variant.swaps) {
        if (!r.lines[s.line] || r.lines[s.line].ingredient_id !== s.to_ingredient_id) bad(`${where}: swap on line ${s.line} does not match the line.`);
        if (s.rule_id !== null && !data.substitution_rules.some(x => x.id === s.rule_id)) bad(`${where}: unknown rule ${s.rule_id}.`);
        if (s.custom !== (s.rule_id === null)) bad(`${where}: a swap is custom exactly when it has no rule.`);
      }
      if (r.variant.unverified !== r.variant.swaps.some(s => s.custom)) bad(`${where}: a variant is unverified exactly when it has a custom swap.`);
    }
  }

  // Plan slots.
  const slots = new Map(data.plan.map(s => [s.id, s]));
  unique(data.plan.map(s => s.id), 'plan slot');
  const pos = s => s.date + ':' + c.MEALS.indexOf(s.meal);
  for (const s of data.plan) {
    const where = `Slot ${s.id}`;
    date(s.date, where);
    if (s.id !== s.date + ':' + s.meal) bad(`${where}: its ID must be its date and meal.`);
    for (const a of s.attendees) if (!memberIds.has(a)) bad(`${where}: attendee ${a} is not a member.`);
    within(where, () => H.normalizeGuests(data, s.guests));
    if ((s.state === 'cleared') !== (s.dishes.length === 0)) bad(`${where}: only a cleared slot has no dishes.`);
    for (const d of s.dishes) {
      if (!recipes.has(d.recipe_id)) bad(`${where}: unknown recipe ${d.recipe_id}.`);
      if (d.servings !== undefined && d.servings !== null && (d.servings < 1 || d.servings > 200)) bad(`${where}: servings out of range.`);
      if (d.leftovers_of !== undefined) {
        const src = slots.get(d.leftovers_of);
        if (!src || pos(src) >= pos(s) || !src.dishes.some(x => x.leftovers_of === undefined && x.recipe_id === d.recipe_id)) bad(`${where}: leftovers of ${d.leftovers_of} are not available.`);
      }
    }
    if ((s.state === 'cooked') !== (s.cooked !== null)) bad(`${where}: cooked details must match its state.`);
    if (s.state === 'cooked') {
      if (s.date > todayDate) bad(`${where} is cooked but dated after the loaded time.`);
      for (const p of s.cooked.portions) {
        const r = recipes.get(p.recipe_id);
        if (!r || !s.dishes.some(d => d.leftovers_of === undefined && d.recipe_id === p.recipe_id) || p.revision > r.revision) bad(`${where}: cooked portions name ${p.recipe_id} incorrectly.`);
        if (p.eaten > p.made) bad(`${where}: more portions eaten than made.`);
      }
    }
    if (!s.history.length) bad(`${where} has no history.`);
    for (const row of s.history) if (Date.parse(row.at) > Date.parse(ctx.virtual_now)) bad(`${where} has history after the loaded time.`);
  }

  // Pantry.
  unique(data.pantry.map(p => p.ingredient_id), 'pantry item for');
  for (const p of data.pantry) {
    const ing = data.ingredients.find(i => i.id === p.ingredient_id);
    if (!ing) bad(`Pantry item for unknown ingredient ${p.ingredient_id}.`);
    if (!u.measurable(ing, p.unit)) bad(`Pantry ${p.ingredient_id} is stored in ${p.unit}, a unit it is not measured in.`);
    date(p.use_by, `Pantry ${p.ingredient_id}`);
  }

  // Shopping list.
  if (data.shopping) {
    const L = data.shopping;
    date(L.start, 'Shopping list'); date(L.end, 'Shopping list');
    if (L.end < L.start) bad('The shopping list window ends before it starts.');
    unique(L.lines.map(l => l.id), 'shopping line');
    for (const l of L.lines) {
      if (l.ingredient_id !== null && !ingredientIds.has(l.ingredient_id)) bad(`Line ${l.id}: unknown ingredient.`);
      if (!/^sl-\d{4,}$/.test(l.id) || Number(l.id.slice(3)) >= L.next_line) bad(`Line ${l.id}: IDs come from the list's counter.`);
      if (l.kind === 'derived' && (l.ingredient_id === null || l.quantity === null || l.unit === null)) bad(`Derived line ${l.id} needs an ingredient, a quantity and a unit.`);
      if (l.kind === 'manual' && (l.state === 'excluded' || l.slots.length)) bad(`Manual line ${l.id} cannot be excluded or name slots.`);
      if (l.ingredient_id === null && l.text === null) bad(`Line ${l.id} needs an ingredient or a text.`);
      if ((l.state === 'excluded') !== (l.excluded_reason !== null)) bad(`Line ${l.id}: an excluded line carries its reason.`);
      if (l.surplus && l.kind !== 'derived') bad(`Line ${l.id}: only a derived line can be surplus.`);
      for (const id of l.slots) if (!slots.has(id)) bad(`Line ${l.id}: unknown slot ${id}.`);
    }
  }

  // Notifications and activity.
  unique(data.notifications.map(n => n.id), 'notification');
  for (const n of data.notifications) if (Date.parse(n.at) > Date.parse(ctx.virtual_now)) bad(`Notification ${n.id} is dated after the loaded time.`);
  data.activity.forEach((a, i) => { if (a.seq !== i + 1) bad('Activity rows must be numbered from 1 without gaps.'); });
}

// Business records (one row each) and their IDs, for Core's dataset counts and object references.
function records(data) {
  return [...data.ingredients, ...data.substitution_rules, ...data.members, ...data.recipes, ...data.plan, ...data.pantry,
    ...(data.shopping ? data.shopping.lines : []), ...data.notifications];
}
function objects(data) {
  return [...data.ingredients.map(i => i.id), ...data.substitution_rules.map(r => r.id), ...data.members.map(m => m.person_id),
    ...data.recipes.map(r => r.id), ...data.plan.map(s => s.id), ...data.pantry.map(p => 'pantry:' + p.ingredient_id),
    ...(data.shopping ? data.shopping.lines.map(l => l.id) : []), ...data.notifications.map(n => n.id)];
}

module.exports = {validateSeed, records, objects, references: () => []};
