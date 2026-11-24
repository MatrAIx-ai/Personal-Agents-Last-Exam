'use strict';
// W4 weekly meal plan: slots, default servings, flags from the one check, leftovers, cooking.
const c = require('./common.cjs');
const u = require('./units.cjs');
const R = require('./recipes.cjs');
const H = require('./household.cjs');
const {check, worst} = require('./check.cjs');
const {fail, copy, exact} = c;

function parseSlotId(id) {
  const [date, meal] = id.split(':');
  if (!c.isDate(date) || !c.MEALS.includes(meal)) fail('invalid_arguments', `${id} is not a slot ID of the form YYYY-MM-DD:meal.`);
  return {date, meal};
}
const order = s => s.date + ':' + c.MEALS.indexOf(s.meal);
const before = (a, b) => order(a) < order(b);
const slotOf = (data, id) => data.plan.find(s => s.id === id);
const isLeftover = dish => dish.leftovers_of !== undefined;

// Default servings: the portion factors of the attendees plus one per guest, rounded up to a half.
function defaultPortions(data, slot) {
  const factors = slot.attendees.map(id => data.members.find(m => m.person_id === id).portion_factor);
  return c.ceilHalf(factors.reduce((a, b) => a + b, 0) + slot.guests.length);
}
const dishServings = (data, slot, dish) => dish.servings ?? defaultPortions(data, slot);

// The recipe content a dish is eaten from: the cooked revision once cooked, else the current one.
function dishContent(data, slot, recipeId) {
  const r = data.recipes.find(x => x.id === recipeId);
  const cooked = slot.cooked && slot.cooked.portions.find(p => p.recipe_id === recipeId);
  return R.contentAt(r, cooked ? cooked.revision : r.revision);
}

// Portions a source slot leaves of a recipe: made minus eaten once cooked; while still planned,
// its servings minus its default portions; nothing once skipped or cleared.
function portionsLeft(data, source, recipeId) {
  if (source.state === 'cooked') {
    const p = source.cooked.portions.find(x => x.recipe_id === recipeId);
    return p ? exact(Math.max(0, p.made - p.eaten)) : 0;
  }
  if (source.state === 'planned') {
    const dish = source.dishes.find(d => !isLeftover(d) && d.recipe_id === recipeId);
    return dish ? exact(Math.max(0, dishServings(data, source, dish) - defaultPortions(data, source))) : 0;
  }
  return 0;
}
// Planned or eaten takes of a source's leftovers, in meal order.
function takes(data, sourceId, recipeId) {
  return data.plan.filter(s => ['planned', 'cooked'].includes(s.state))
    .flatMap(s => s.dishes.filter(d => isLeftover(d) && d.leftovers_of === sourceId && d.recipe_id === recipeId).map(d => ({slot: s, portions: d.portions})))
    .sort((a, b) => order(a.slot).localeCompare(order(b.slot)));
}

function people(data, slot) {
  return R.people(data, slot.attendees, slot.guests);
}

// Flags of a slot. Person flags (one per attendee or guest whose verdict is not ok) for planned and
// cooked slots; archived_recipe, stale_base, leftover_short and leftover_expired for planned slots.
function flags(data, slot) {
  if (!['planned', 'cooked'].includes(slot.state)) return [];
  const opts = {ingredients: R.ingredientsMap(data), zone: data.household.time_zone};
  const who = people(data, slot), perPerson = new Map(who.map(p => [p.kind + ':' + p.id, []]));
  const out = [];
  for (const [index, dish] of slot.dishes.entries()) {
    const source = isLeftover(dish) ? slotOf(data, dish.leftovers_of) : null;
    const content = source ? dishContent(data, source, dish.recipe_id) : dishContent(data, slot, dish.recipe_id);
    for (const v of check(content, who, slot.date, opts)) {
      if (v.verdict !== 'ok') perPerson.get(v.kind + ':' + v.id).push({dish: index, recipe_id: dish.recipe_id, verdict: v.verdict, findings: v.findings, omit_lines: v.omit_lines});
    }
    if (slot.state !== 'planned') continue;
    const r = data.recipes.find(x => x.id === dish.recipe_id);
    if (r.archived) out.push({type: 'archived_recipe', dish: index, recipe_id: r.id});
    if (r.variant) {
      const base = data.recipes.find(x => x.id === r.variant.base_recipe_id);
      if (base.revision > r.variant.base_revision) out.push({type: 'stale_base', dish: index, recipe_id: r.id, base_recipe_id: base.id, base_revision: r.variant.base_revision, base_current_revision: base.revision});
    }
    if (source) {
      const left = portionsLeft(data, source, dish.recipe_id);
      let used = 0;
      for (const t of takes(data, source.id, dish.recipe_id)) {
        used = exact(used + t.portions);
        if (t.slot.id === slot.id) break;
      }
      if (used > left) out.push({type: 'leftover_short', dish: index, recipe_id: dish.recipe_id, leftovers_of: source.id, planned: dish.portions, available: exact(Math.max(0, left - (used - dish.portions)))});
      const age = c.daysBetween(source.date, slot.date);
      if (age > data.household.leftover_max_days) out.push({type: 'leftover_expired', dish: index, recipe_id: dish.recipe_id, leftovers_of: source.id, age_days: age, leftover_max_days: data.household.leftover_max_days});
    }
  }
  const personFlags = who.map(p => ({p, dishes: perPerson.get(p.kind + ':' + p.id)})).filter(x => x.dishes.length)
    .map(({p, dishes}) => ({type: 'person', kind: p.kind, id: p.id, name: p.name, verdict: worst(dishes.map(d => d.verdict)), dishes}));
  return personFlags.concat(out);
}

function slotView(data, slot, todayDate) {
  const titles = new Map(data.recipes.map(r => [r.id, r.title]));
  return {
    id: slot.id, date: slot.date, meal: slot.meal, state: slot.state, phase: slot.date < todayDate ? 'past' : 'upcoming',
    attendees: copy(slot.attendees), guests: copy(slot.guests), note: slot.note, default_servings: defaultPortions(data, slot),
    dishes: slot.dishes.map((d, index) => isLeftover(d)
      ? {dish: index, kind: 'leftovers', leftovers_of: d.leftovers_of, recipe_id: d.recipe_id, title: titles.get(d.recipe_id), portions: d.portions}
      : {dish: index, kind: 'recipe', recipe_id: d.recipe_id, title: titles.get(d.recipe_id), servings: dishServings(data, slot, d), servings_source: d.servings === null ? 'default' : 'explicit'}),
    leftovers: slot.dishes.filter(d => !isLeftover(d)).map(d => {
      const left = portionsLeft(data, slot, d.recipe_id), taken = takes(data, slot.id, d.recipe_id);
      return {recipe_id: d.recipe_id, portions_left: left, taken_by: taken.map(t => ({slot_id: t.slot.id, portions: t.portions})),
        unclaimed: exact(Math.max(0, left - taken.reduce((a, t) => a + t.portions, 0))), usable_until: c.addDays(slot.date, data.household.leftover_max_days)};
    }),
    cooked: copy(slot.cooked), flags: flags(data, slot), history: copy(slot.history), updated_at: slot.updated_at
  };
}

// The window of a plan read: the current week from the household's week start by default.
function window(ctx, data, args, maxDays) {
  const t = c.today(ctx, data);
  let start = args.start, end = args.end;
  if (!start) {
    const back = (c.WEEKDAYS.indexOf(c.weekday(t)) - c.WEEKDAYS.indexOf(data.household.week_start) + 7) % 7;
    start = c.addDays(t, -back);
  }
  if (!end) end = c.addDays(start, 6);
  for (const d of [start, end]) if (!c.isDate(d)) fail('invalid_arguments', `${d} is not a calendar date.`);
  if (end < start) fail('invalid_window', `The window ends (${end}) before it starts (${start}).`);
  if (c.daysBetween(start, end) + 1 > maxDays) fail('invalid_window', `A window can cover at most ${maxDays} days.`);
  return {start, end};
}

function get(ctx, data, args) {
  const {start, end} = window(ctx, data, args, 42), t = c.today(ctx, data);
  const slots = data.plan.filter(s => s.date >= start && s.date <= end).sort((a, b) => order(a).localeCompare(order(b)));
  return {start, end, today: t, slots: slots.map(s => slotView(data, s, t))};
}

// ---- Writes ------------------------------------------------------------------------------------------
function normalizeDishes(data, slotId, slotPos, dishes) {
  return dishes.map(d => {
    if (!isLeftover(d)) {
      c.recipe(data, d.recipe_id);
      if (d.servings !== undefined) R.checkServings(d.servings);
      return {recipe_id: d.recipe_id, servings: d.servings ?? null};
    }
    const source = slotOf(data, d.leftovers_of);
    if (!source) fail('leftover_unavailable', `There is no slot ${d.leftovers_of} to take leftovers from.`);
    if (!before(source, slotPos)) fail('leftover_unavailable', `${d.leftovers_of} is not earlier than ${slotId}.`);
    if (!['planned', 'cooked'].includes(source.state)) fail('leftover_unavailable', `${d.leftovers_of} is ${source.state}; it leaves no leftovers.`);
    const cooked = source.dishes.filter(x => !isLeftover(x));
    if (!cooked.length) fail('leftover_unavailable', `${d.leftovers_of} is itself only leftovers.`);
    let recipeId = d.recipe_id;
    if (recipeId === undefined) {
      if (cooked.length > 1) fail('leftover_unavailable', `${d.leftovers_of} has several dishes; name the recipe_id of the leftovers.`);
      recipeId = cooked[0].recipe_id;
    } else if (!cooked.some(x => x.recipe_id === recipeId)) fail('leftover_unavailable', `${d.leftovers_of} did not plan ${recipeId}.`);
    if (!(d.portions > 0) || !Number.isFinite(d.portions)) fail('invalid_quantity', 'Leftover portions must be positive.');
    return {leftovers_of: source.id, recipe_id: recipeId, portions: d.portions};
  });
}

function historyRow(who, action, slot) {
  return {at: who.at, actor: who.actor, by: who.by, action, request_id: who.request_id, event_id: who.event_id,
    dishes: copy(slot.dishes), attendees: copy(slot.attendees), guest_ids: slot.guests.map(g => g.guest_id)};
}

// Shared by plan.slot.set and the plan.changed event; decides every refusal before writing.
// dishes = [] clears the slot. Returns the slot.
function setSlot(data, id, input, who, todayDate) {
  const pos = parseSlotId(id), existing = slotOf(data, id);
  if (pos.date < todayDate) fail('past_slot', `${id} has passed; past slots cannot be set or cleared.`);
  if (existing && existing.state === 'cooked') fail('invalid_state', `${id} was cooked and cannot change.`);
  if (!input.dishes.length) {
    if (!existing) fail('not_found', `There is no slot ${id} to clear.`);
    if (existing.state !== 'planned') fail('invalid_state', `${id} is ${existing.state}; only a planned slot can be cleared.`);
    existing.state = 'cleared';
    existing.dishes = [];
    existing.updated_at = who.at;
    existing.history.push(historyRow(who, 'cleared', existing));
    return existing;
  }
  const attendees = input.attendees || data.members.map(m => m.person_id);
  for (const a of attendees) c.member(data, a);
  if (new Set(attendees).size !== attendees.length) fail('invalid_arguments', 'An attendee is listed twice.');
  const guests = H.normalizeGuests(data, input.guests || []);
  const dishes = normalizeDishes(data, id, pos, input.dishes);
  const slot = existing || {id, date: pos.date, meal: pos.meal, state: 'planned', dishes: [], attendees: [], guests: [], note: null, cooked: null, updated_at: who.at, history: []};
  const action = existing && existing.state === 'planned' ? 'replaced' : 'set';
  Object.assign(slot, {state: 'planned', dishes, attendees, guests, note: input.note ?? null, updated_at: who.at});
  slot.history.push(historyRow(who, action, slot));
  if (!existing) data.plan.push(slot);
  return slot;
}

const agentWho = (ctx, data, args) => ({at: ctx.virtual_now, actor: 'agent', by: data.owner_person_id, request_id: args.request_id, event_id: null});

function setTool(ctx, data, args) {
  const slot = setSlot(data, args.id, args, agentWho(ctx, data, args), c.today(ctx, data));
  return {id: slot.id, state: slot.state, default_servings: defaultPortions(data, slot), flags: flags(data, slot)};
}

// Takes a cooked dish's exact quantities from the pantry, never below zero; returns what was short.
function deduct(data, slot) {
  const short = [], ingredients = R.ingredientsMap(data);
  for (const dish of slot.dishes.filter(d => !isLeftover(d))) {
    const content = dishContent(data, slot, dish.recipe_id), factor = dishServings(data, slot, dish) / content.servings;
    for (const line of content.lines.filter(l => !l.optional)) {
      const ing = ingredients.get(line.ingredient_id), need = exact(line.quantity * factor);
      const item = data.pantry.find(p => p.ingredient_id === ing.id);
      if (!item || item.quantity === 0) { short.push({ingredient_id: ing.id, quantity: need, unit: line.unit, reason: 'not_in_pantry'}); continue; }
      const needIn = u.tryConvert(need, line.unit, item.unit, ing);
      if (needIn === null) { short.push({ingredient_id: ing.id, quantity: need, unit: line.unit, reason: 'no_conversion'}); continue; }
      const take = Math.min(item.quantity, needIn);
      item.quantity = exact(item.quantity - take);
      if (needIn - take > 1e-9) short.push({ingredient_id: ing.id, quantity: exact(needIn - take), unit: item.unit, reason: 'not_enough'});
    }
  }
  return short;
}

function markTool(ctx, data, args) {
  const slot = slotOf(data, args.id), t = c.today(ctx, data);
  if (!slot) fail('not_found', `There is no slot ${args.id}.`);
  if (slot.state !== 'planned') fail('invalid_state', `${slot.id} is ${slot.state}; only a planned slot can be marked.`);
  const who = agentWho(ctx, data, args);
  if (args.status === 'skipped') {
    if (args.portions || args.deduct_pantry) fail('invalid_arguments', 'Portions and pantry deduction apply only to a cooked slot.');
    slot.state = 'skipped';
    slot.updated_at = who.at;
    slot.history.push(historyRow(who, 'skipped', slot));
    return {id: slot.id, state: 'skipped', deducted: false, short: []};
  }
  if (slot.date > t) fail('not_yet', `${slot.id} is in the future; it cannot be marked cooked before its date.`);
  const recipeDishes = slot.dishes.filter(d => !isLeftover(d));
  const given = new Map();
  for (const p of args.portions || []) {
    if (!recipeDishes.some(d => d.recipe_id === p.recipe_id)) fail('invalid_arguments', `${p.recipe_id} is not a dish cooked in ${slot.id}.`);
    if (given.has(p.recipe_id)) fail('invalid_arguments', `${p.recipe_id} is listed twice.`);
    given.set(p.recipe_id, p);
  }
  const portions = recipeDishes.map(d => {
    const p = given.get(d.recipe_id) || {};
    const made = p.made ?? dishServings(data, slot, d), eaten = p.eaten ?? defaultPortions(data, slot);
    if (!(made >= 0 && eaten >= 0) || eaten > made) fail('invalid_quantity', `Portions eaten (${eaten}) must be between 0 and portions made (${made}).`);
    return {recipe_id: d.recipe_id, revision: data.recipes.find(r => r.id === d.recipe_id).revision, made, eaten};
  });
  slot.state = 'cooked';
  slot.cooked = {at: who.at, portions, deducted: !!args.deduct_pantry, short: []};
  if (args.deduct_pantry) {
    const previous = new Map(data.pantry.map(p => [p.ingredient_id, p.quantity]));
    slot.cooked.short = deduct(data, slot);
    for (const item of data.pantry) {
      if (previous.get(item.ingredient_id) !== item.quantity) {
        item.updated_at = who.at;
        item.history.push({at: who.at, actor: 'agent', by: who.by, action: 'cooked', quantity: item.quantity, unit: item.unit, use_by: item.use_by, request_id: who.request_id, event_id: null, slot_id: slot.id});
      }
    }
  }
  slot.updated_at = who.at;
  slot.history.push(historyRow(who, 'cooked', slot));
  return {id: slot.id, state: 'cooked', portions: copy(portions), deducted: !!args.deduct_pantry, short: copy(slot.cooked.short)};
}

// Flags of every planned or cooked slot, recomputed from a snapshot with the same check (evaluator use).
function flagsFromSnapshot(data) {
  return Object.fromEntries(data.plan.map(s => [s.id, flags(data, s)]).filter(([, f]) => f.length));
}

module.exports = {parseSlotId, order, slotOf, isLeftover, defaultPortions, dishServings, dishContent, flags, window, get, setSlot, setTool, markTool, flagsFromSnapshot};
