'use strict';
// W5 shopping list: derived from the planned slots of a window and the pantry; what a person did
// to it (manual lines, ticks, exclusions) survives regeneration.
const crypto = require('node:crypto');
const c = require('./common.cjs');
const u = require('./units.cjs');
const R = require('./recipes.cjs');
const P = require('./plan.cjs');
const {fail, copy, exact} = c;

const LIST_ID = 'shopping-list';

function plannedSlots(data, start, end) {
  return data.plan.filter(s => s.state === 'planned' && s.date >= start && s.date <= end).sort((a, b) => P.order(a).localeCompare(P.order(b)));
}

// Everything the list is built from. Any committed change to it makes a current list read stale.
function fingerprint(data, start, end) {
  const slots = data.plan.filter(s => s.date >= start && s.date <= end).sort((a, b) => a.id.localeCompare(b.id))
    .map(s => ({id: s.id, state: s.state, dishes: s.dishes, attendees: s.attendees, guests: s.guests}));
  const ids = new Set(slots.flatMap(s => s.dishes.map(d => d.recipe_id)));
  const recipes = data.recipes.filter(r => ids.has(r.id)).map(r => ({id: r.id, revision: r.revision, archived: r.archived}));
  const inputs = {start, end, slots, recipes, pantry: [...data.pantry].sort((a, b) => a.ingredient_id.localeCompare(b.ingredient_id)).map(p => [p.ingredient_id, p.quantity, p.unit, p.use_by]),
    members: data.members.map(m => ({id: m.person_id, factor: m.portion_factor, constraints: m.constraints.map(x => ({...x, history: x.history.length}))}))};
  return crypto.createHash('sha256').update(JSON.stringify(inputs)).digest('hex');
}

// Adds up the exact quantities of every planned recipe dish per ingredient in the unit it is bought in
// (or the base unit of the line's dimension when that cannot be converted), subtracts usable pantry
// stock, and rounds up once at the end.
function derive(data, start, end) {
  const ingredients = R.ingredientsMap(data), groups = new Map(), optional = [];
  for (const slot of plannedSlots(data, start, end)) {
    for (const dish of slot.dishes.filter(d => !P.isLeftover(d))) {
      const content = P.dishContent(data, slot, dish.recipe_id), factor = P.dishServings(data, slot, dish) / content.servings;
      for (const line of content.lines) {
        const ing = ingredients.get(line.ingredient_id), need = exact(line.quantity * factor);
        if (line.optional) {
          optional.push({ingredient_id: ing.id, name: ing.name, ...u.shown(need, line.unit, ing), slot_id: slot.id, recipe_id: dish.recipe_id});
          continue;
        }
        let unit = ing.buy_unit, value = u.tryConvert(need, line.unit, unit, ing);
        if (value === null) { unit = u.BASE[u.dimension(line.unit)]; value = u.tryConvert(need, line.unit, unit, ing); }
        const key = ing.id + '|' + unit;
        const g = groups.get(key) || {ingredient_id: ing.id, unit, total: 0, slots: [], first_needed: slot.date};
        g.total = exact(g.total + value);
        if (!g.slots.includes(slot.id)) g.slots.push(slot.id);
        groups.set(key, g);
      }
    }
  }
  const expiring = [], uncounted = [], lines = [];
  const ordered = [...groups.values()].sort((a, b) => a.first_needed.localeCompare(b.first_needed) || a.ingredient_id.localeCompare(b.ingredient_id) || a.unit.localeCompare(b.unit));
  const stock = new Map(data.pantry.filter(p => p.quantity > 0).map(p => [p.ingredient_id, {...p}]));
  for (const g of ordered) {
    const ing = ingredients.get(g.ingredient_id), item = stock.get(g.ingredient_id);
    let used = 0;
    if (item && item.quantity > 0) {
      if (item.use_by && item.use_by < g.first_needed) {
        if (!expiring.some(e => e.ingredient_id === ing.id)) expiring.push({ingredient_id: ing.id, name: ing.name, quantity: item.quantity, unit: item.unit, use_by: item.use_by, first_needed: g.first_needed});
      } else {
        const available = u.tryConvert(item.quantity, item.unit, g.unit, ing);
        if (available === null) uncounted.push({ingredient_id: ing.id, name: ing.name, quantity: item.quantity, unit: item.unit, needed_unit: g.unit, reason: 'no_conversion'});
        else {
          used = Math.min(available, g.total);
          item.quantity = exact(item.quantity - u.tryConvert(used, g.unit, item.unit, ing));
        }
      }
    }
    const remaining = exact(g.total - used);
    if (remaining > 1e-9) lines.push({ingredient_id: ing.id, unit: g.unit, quantity: u.roundUp(remaining, g.unit, ing), exact: remaining,
      needed_total: g.total, from_pantry: exact(used), slots: g.slots, first_needed: g.first_needed});
  }
  return {lines, optional_lines: optional, expiring_before_use: expiring, stock_not_counted: uncounted};
}

const agentWho = (ctx, data, args) => ({at: ctx.virtual_now, actor: 'agent', by: data.owner_person_id, request_id: args.request_id, event_id: null});
function lineRow(who, action) {
  return {at: who.at, actor: who.actor, by: who.by, action, request_id: who.request_id, event_id: who.event_id};
}
function newLineId(list) {
  const id = 'sl-' + String(list.next_line).padStart(4, '0');
  list.next_line += 1;
  return id;
}

function generate(ctx, data, args) {
  const {start, end} = P.window(ctx, data, args, 28);
  const who = agentWho(ctx, data, args), d = derive(data, start, end);
  const list = data.shopping || {id: LIST_ID, start, end, generated_at: who.at, generation: 0, fingerprint: '', next_line: 1, lines: [], optional_lines: [], expiring_before_use: [], stock_not_counted: []};
  const old = list.lines, kept = [], added = [], dropped = [], surplus = [];
  const derivedKey = l => l.ingredient_id + '|' + l.unit;
  const previous = new Map(old.filter(l => l.kind === 'derived').map(l => [derivedKey(l), l]));
  const fresh = d.lines.map(n => {
    const was = previous.get(derivedKey(n));
    previous.delete(derivedKey(n));
    const line = was || {id: newLineId(list), kind: 'derived', ingredient_id: n.ingredient_id, text: null, state: 'needed', excluded_reason: null, origin: who, history: [lineRow(who, 'derived')]};
    (was ? kept : added).push(line.id);
    if (was && was.surplus) line.history.push(lineRow(who, 'needed_again'));
    return Object.assign(line, {quantity: n.quantity, unit: n.unit, exact: n.exact, needed_total: n.needed_total, from_pantry: n.from_pantry,
      slots: n.slots, first_needed: n.first_needed, surplus: false});
  });
  // Derived lines no longer needed: a ticked one stays and reads surplus; the others are dropped.
  for (const line of previous.values()) {
    if (line.state === 'ticked') {
      if (!line.surplus) line.history.push(lineRow(who, 'surplus'));
      line.surplus = true;
      surplus.push(line.id);
      fresh.push(line);
    } else dropped.push(line.id);
  }
  list.lines = [...fresh, ...old.filter(l => l.kind === 'manual')];
  Object.assign(list, {start, end, generated_at: who.at, generation: list.generation + 1, fingerprint: fingerprint(data, start, end),
    optional_lines: d.optional_lines, expiring_before_use: d.expiring_before_use, stock_not_counted: d.stock_not_counted});
  data.shopping = list;
  return {id: list.id, state: 'current', start, end, generation: list.generation, line_count: list.lines.length, added, kept, dropped, surplus};
}

function view(ctx, data) {
  const list = data.shopping;
  if (!list) return {list: null};
  const names = new Map(data.ingredients.map(i => [i.id, i.name]));
  return {list: {...copy(list), stale: fingerprint(data, list.start, list.end) !== list.fingerprint,
    lines: list.lines.map(l => ({...copy(l), name: l.ingredient_id ? names.get(l.ingredient_id) : l.text}))}};
}

// ---- Line writes ------------------------------------------------------------------------------------------
function needList(data) {
  if (!data.shopping) fail('no_list', 'There is no shopping list yet; generate one first.');
  return data.shopping;
}
// Validates the item fields of a manual line; returns them normalized.
function manualFields(data, input, current = null) {
  const merged = {ingredient_id: current ? current.ingredient_id : null, text: current ? current.text : null,
    quantity: current ? current.quantity : null, unit: current ? current.unit : null};
  for (const k of ['ingredient_id', 'text', 'quantity', 'unit']) if (input[k] !== undefined) merged[k] = input[k];
  if (typeof merged.text === 'string') merged.text = merged.text.trim() || null;
  if (!merged.ingredient_id && !merged.text) fail('invalid_arguments', 'A manual line needs an ingredient_id or a text.');
  if (merged.quantity !== null && (!(merged.quantity > 0) || !Number.isFinite(merged.quantity))) fail('invalid_quantity', 'A line quantity must be positive.');
  if (merged.ingredient_id) {
    const ing = c.ingredient(data, merged.ingredient_id);
    if (merged.quantity !== null && merged.unit === null) fail('invalid_quantity', `Give the unit of the ${ing.name} quantity.`);
    if (merged.unit !== null && !u.measurable(ing, merged.unit)) fail('invalid_quantity', `${ing.name} cannot be measured in ${merged.unit}.`);
  }
  if (merged.unit !== null && merged.quantity === null) fail('invalid_quantity', 'A unit needs a quantity.');
  return merged;
}
function addManual(data, input, who) {
  const list = needList(data), fields = manualFields(data, input);
  const line = {id: newLineId(list), kind: 'manual', ...fields, exact: null, needed_total: null, from_pantry: null, state: input.ticked ? 'ticked' : 'needed',
    excluded_reason: null, surplus: false, slots: [], first_needed: null, origin: who, history: [lineRow(who, 'added')]};
  if (input.ticked) line.history.push(lineRow(who, 'ticked'));
  list.lines.push(line);
  return line;
}
// needed <-> ticked for any line; needed <-> excluded for derived lines only.
function tick(line, ticked, who) {
  if (line.state === 'excluded') fail('invalid_state', `${line.id} is excluded; include it again before ticking it.`);
  if ((line.state === 'ticked') === ticked) fail('invalid_state', `${line.id} is already ${line.state}.`);
  line.state = ticked ? 'ticked' : 'needed';
  line.history.push(lineRow(who, ticked ? 'ticked' : 'unticked'));
}

function itemSet(ctx, data, args) {
  const list = needList(data), who = agentWho(ctx, data, args);
  const itemKeys = ['ingredient_id', 'text', 'quantity', 'unit'].filter(k => args[k] !== undefined);
  if (args.ticked !== undefined && args.excluded !== undefined) fail('invalid_arguments', 'Tick and exclude a line in separate calls.');
  if (args.reason !== undefined && args.excluded !== true) fail('invalid_arguments', 'A reason goes with excluded: true.');
  if (!args.id) {
    if (args.excluded !== undefined) fail('invalid_arguments', 'Only a derived line can be excluded.');
    const line = addManual(data, args, who);
    return {id: line.id, state: line.state, kind: 'manual'};
  }
  const line = list.lines.find(l => l.id === args.id);
  if (!line) fail('not_found', `There is no line ${args.id} on the list.`);
  if (!itemKeys.length && args.ticked === undefined && args.excluded === undefined) fail('invalid_arguments', 'Nothing to change on the line.');
  if (line.kind === 'derived') {
    if (itemKeys.length) fail('derived_line', `${line.id} is derived from the plan and changes only when the list is generated again; exclude it or add a manual line.`);
    if (args.excluded !== undefined) {
      if (line.state === 'ticked') fail('invalid_state', `${line.id} is ticked; untick it before excluding it.`);
      if ((line.state === 'excluded') === args.excluded) fail('invalid_state', `${line.id} is already ${line.state}.`);
      if (args.excluded && !(args.reason && args.reason.trim())) fail('invalid_arguments', 'Excluding a derived line needs a reason.');
      line.state = args.excluded ? 'excluded' : 'needed';
      line.excluded_reason = args.excluded ? args.reason.trim() : null;
      line.history.push(lineRow(who, args.excluded ? 'excluded' : 'included'));
    } else tick(line, args.ticked, who);
    return {id: line.id, state: line.state, kind: 'derived'};
  }
  if (args.excluded !== undefined) fail('invalid_state', `${line.id} is a manual line; remove it instead of excluding it.`);
  const fields = itemKeys.length ? manualFields(data, args, line) : null;
  if (args.ticked !== undefined) {
    if (line.state === 'ticked' === args.ticked) fail('invalid_state', `${line.id} is already ${line.state}.`);
  }
  if (fields) { Object.assign(line, fields); line.history.push(lineRow(who, 'changed')); }
  if (args.ticked !== undefined) tick(line, args.ticked, who);
  return {id: line.id, state: line.state, kind: 'manual'};
}

function itemRemove(ctx, data, args) {
  const list = needList(data);
  const line = list.lines.find(l => l.id === args.id);
  if (!line) fail('not_found', `There is no line ${args.id} on the list.`);
  if (line.kind === 'derived') fail('derived_line', `${line.id} is derived from the plan; exclude it with a reason instead of removing it.`);
  list.lines = list.lines.filter(l => l.id !== line.id);
  return {id: line.id, state: 'removed', kind: 'manual'};
}

module.exports = {fingerprint, generate, view, needList, addManual, tick, itemSet, itemRemove};
