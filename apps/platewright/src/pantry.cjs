'use strict';
// W5 pantry: one item per ingredient with a quantity, a unit and an optional use-by date.
const c = require('./common.cjs');
const u = require('./units.cjs');
const {fail, copy} = c;

// Derived from the use-by date and today: expired after it, use_soon within use_soon_days of it.
function freshness(data, item, todayDate) {
  if (!item.use_by) return {freshness: 'no_date', days_left: null};
  const days = c.daysBetween(todayDate, item.use_by);
  return {freshness: days < 0 ? 'expired' : days <= data.household.use_soon_days ? 'use_soon' : 'fresh', days_left: days};
}

function list(ctx, data, args) {
  const t = c.today(ctx, data), names = new Map(data.ingredients.map(i => [i.id, i.name]));
  const items = data.pantry.map(p => ({ingredient_id: p.ingredient_id, name: names.get(p.ingredient_id), quantity: p.quantity, unit: p.unit,
    use_by: p.use_by, state: p.quantity > 0 ? 'in_stock' : 'out', ...freshness(data, p, t), updated_at: p.updated_at, history: copy(p.history)}))
    .filter(p => (args.include_out || p.state === 'in_stock') && (!args.freshness || p.freshness === args.freshness))
    .sort((a, b) => a.name.localeCompare(b.name));
  return {today: t, use_soon_days: data.household.use_soon_days, items};
}

// Shared by pantry.set and the pantry.changed event. Validates before writing.
function check(data, entry) {
  const ing = c.ingredient(data, entry.ingredient_id);
  if (!(entry.quantity >= 0) || !Number.isFinite(entry.quantity)) fail('invalid_quantity', `The quantity of ${ing.name} cannot be negative.`);
  if (entry.quantity > c.LIMITS.quantity) fail('invalid_quantity', `The quantity of ${ing.name} can be at most 1,000,000.`);
  if (!u.measurable(ing, entry.unit)) fail('invalid_quantity', `${ing.name} cannot be measured in ${entry.unit}.`);
  if (entry.use_by !== undefined && entry.use_by !== null && !c.isDate(entry.use_by)) fail('invalid_arguments', `${entry.use_by} is not a calendar date.`);
  return ing;
}
function apply(data, entry, who, action) {
  let item = data.pantry.find(p => p.ingredient_id === entry.ingredient_id);
  if (!item) {
    item = {ingredient_id: entry.ingredient_id, quantity: 0, unit: entry.unit, use_by: null, updated_at: who.at, history: []};
    data.pantry.push(item);
  }
  Object.assign(item, {quantity: entry.quantity, unit: entry.unit, use_by: entry.use_by !== undefined ? entry.use_by : item.use_by, updated_at: who.at});
  item.history.push({at: who.at, actor: who.actor, by: who.by, action, quantity: item.quantity, unit: item.unit, use_by: item.use_by,
    request_id: who.request_id, event_id: who.event_id, slot_id: null});
  return item;
}

function setTool(ctx, data, args) {
  const entry = {ingredient_id: args.id, quantity: args.quantity, unit: args.unit, use_by: args.use_by};
  check(data, entry);
  const item = apply(data, entry, {at: ctx.virtual_now, actor: 'agent', by: data.owner_person_id, request_id: args.request_id, event_id: null}, 'set');
  return {id: item.ingredient_id, state: item.quantity > 0 ? 'in_stock' : 'out', quantity: item.quantity, unit: item.unit, use_by: item.use_by,
    ...freshness(data, item, c.today(ctx, data))};
}

module.exports = {list, check, apply, setTool};
