'use strict';
// applyEvent: what other household members do arrives as one of six events, each applied at its own
// time (ctx.virtual_now is the event's `at`). Each applied event writes one notification and one
// activity row. Any refusal is invalid_event, decided before the data is changed.
const c = require('./common.cjs');
const R = require('./recipes.cjs');
const H = require('./household.cjs');
const P = require('./plan.cjs');
const Pantry = require('./pantry.cjs');
const S = require('./shopping.cjs');
const Rec = require('./records.cjs');
const {log} = require('./diagnostics.cjs');
const {fail, copy} = c;

const nameOf = (data, id) => (id ? data.members.find(m => m.person_id === id).display_name : 'A household member');
const ingName = (data, id) => data.ingredients.find(i => i.id === id).name;

function describe(data, con) {
  const what = {
    allergy: () => `${con.strict ? 'strict ' : ''}allergy to ${con.allergen}`,
    medical: () => `medical restriction on ${con.ingredient_id ? ingName(data, con.ingredient_id) : con.flag}`,
    diet: () => `${con.diet} diet`,
    limit: () => `limit of ${con.max} ${con.nutrient} per meal`,
    dislike: () => `dislike of ${con.ingredient_id ? ingName(data, con.ingredient_id) : con.tag}`
  }[con.kind]();
  const from = con.effective_from ? ` from ${con.effective_from}` : '';
  const to = con.expires_on ? ` until ${con.expires_on}` : '';
  return what + from + to;
}

// "Evan added a constraint" when Evan acts for himself, "Nora added a constraint for Evan" otherwise.
const aConstraint = (who, m, own) => (who.by === m.person_id ? own : 'a constraint for ' + m.display_name);

const HANDLERS = {
  'member.updated'(data, p, who, today) {
    const m = c.member(data, p.member_id);
    if (p.action === 'set') {
      const con = H.setConstraint(data, p.member_id, p.constraint, who, today);
      const verb = con.history.at(-1).action === 'created' ? 'added' : 'changed';
      return {object_id: con.id, title: `${nameOf(data, who.by)} ${verb} ${aConstraint(who, m, verb === 'added' ? 'a constraint' : 'one of their constraints')}`,
        body: `${m.display_name}: ${describe(data, con)}.${con.note ? ' Note: ' + con.note : ''}`};
    }
    const con = H.removeConstraint(data, p.member_id, p.constraint_id, p.note, who, today);
    return {object_id: con.id, title: `${nameOf(data, who.by)} ended ${aConstraint(who, m, 'one of their constraints')}`,
      body: `${m.display_name}: ${describe(data, con)} no longer applies.${p.note ? ' Note: ' + p.note : ''}`};
  },
  'recipe.added'(data, p, who) {
    if (data.recipes.some(r => r.id === p.recipe.id)) fail('conflict', `A recipe with ID ${p.recipe.id} already exists.`);
    const r = R.insertRecipe(data, R.normalizeContent(data, p.recipe), who, {id: p.recipe.id});
    return {object_id: r.id, title: `${nameOf(data, who.by)} added a recipe`, body: `${r.title} (serves ${r.servings}) is now in the recipe box.`};
  },
  'plan.changed'(data, p, who, today) {
    const slot = P.setSlot(data, p.id, {dishes: p.action === 'clear' ? [] : p.dishes, attendees: p.attendees, guests: p.guests, note: p.note}, who, today);
    const titles = slot.dishes.map(d => data.recipes.find(r => r.id === d.recipe_id).title);
    return {object_id: slot.id, title: `${nameOf(data, who.by)} ${p.action === 'clear' ? 'cleared' : 'changed'} ${slot.meal} on ${slot.date}`,
      body: p.action === 'clear' ? `Nothing is planned for ${slot.id} any more.` : `${slot.id}: ${titles.join(', ')}.`};
  },
  'guest.changed'(data, p, who, today) {
    const slot = P.slotOf(data, p.id);
    if (!slot) fail('not_found', `There is no slot ${p.id}.`);
    if (slot.date < today) fail('past_slot', `${slot.id} has passed.`);
    if (slot.state !== 'planned') fail('invalid_state', `${slot.id} is ${slot.state}; guests change only on a planned slot.`);
    let action, guestName;
    if (p.action === 'set') {
      const [guest] = H.normalizeGuests(data, [p.guest]);
      const index = slot.guests.findIndex(g => g.guest_id === guest.guest_id);
      action = index >= 0 ? 'guest_changed' : 'guest_added';
      if (index >= 0) slot.guests[index] = guest; else slot.guests.push(guest);
      guestName = guest.name;
    } else {
      const guest = slot.guests.find(g => g.guest_id === p.guest_id);
      if (!guest) fail('not_found', `${p.guest_id} is not a guest at ${slot.id}.`);
      slot.guests = slot.guests.filter(g => g.guest_id !== p.guest_id);
      action = 'guest_removed';
      guestName = guest.name;
    }
    slot.updated_at = who.at;
    slot.history.push({at: who.at, actor: who.actor, by: who.by, action, request_id: null, event_id: who.event_id,
      dishes: copy(slot.dishes), attendees: copy(slot.attendees), guest_ids: slot.guests.map(g => g.guest_id)});
    const verb = {guest_added: 'is coming to', guest_changed: 'changed their needs for', guest_removed: 'is no longer coming to'}[action];
    return {object_id: slot.id, title: `Guest update for ${slot.meal} on ${slot.date}`, body: `${guestName} ${verb} ${slot.id}.`};
  },
  'pantry.changed'(data, p, who) {
    const seen = new Set();
    for (const item of p.items) {
      if (seen.has(item.ingredient_id)) fail('invalid_arguments', `${item.ingredient_id} is listed twice.`);
      seen.add(item.ingredient_id);
      Pantry.check(data, item);
    }
    for (const item of p.items) Pantry.apply(data, item, who, 'event');
    const text = p.items.map(i => `${ingName(data, i.ingredient_id)} ${i.quantity} ${i.unit}`).join(', ');
    return {object_id: 'pantry', title: `${nameOf(data, who.by)} updated the pantry`, body: `${text}.${p.note ? ' Note: ' + p.note : ''}`};
  },
  'shopping.changed'(data, p, who) {
    const list = S.needList(data);
    if (p.action === 'tick') {
      const line = list.lines.find(l => l.id === p.line_id);
      if (!line) fail('not_found', `There is no line ${p.line_id} on the list.`);
      S.tick(line, true, who);
      return {object_id: line.id, title: `${nameOf(data, who.by)} ticked a shopping line`,
        body: `${line.ingredient_id ? ingName(data, line.ingredient_id) : line.text} is bought.`};
    }
    const line = S.addManual(data, {ingredient_id: p.ingredient_id, text: p.text, quantity: p.quantity, unit: p.unit}, who);
    return {object_id: line.id, title: `${nameOf(data, who.by)} added a shopping line`,
      body: `${line.text || ingName(data, line.ingredient_id)}${line.quantity !== null ? ' ' + line.quantity + (line.unit ? ' ' + line.unit : '') : ''}.`};
  }
};

function applyEvent(ctx, data, event) {
  const kind = event.operation.slice('platewright.'.length), p = event.payload;
  if (!HANDLERS[kind]) fail('invalid_event', `${event.operation} is not a Platewright event.`);
  const who = {at: event.at, actor: 'event', by: p.by ?? null, request_id: null, event_id: event.event_id};
  let out;
  try {
    if (who.by !== null) c.member(data, who.by);
    out = HANDLERS[kind](data, p, who, c.today(ctx, data));
  } catch (e) {
    if (!e.code) throw e;
    fail('invalid_event', `${e.code}: ${e.message}`);
  }
  Rec.notify(data, {at: event.at, kind, event_id: event.event_id, by: who.by, object_id: out.object_id, title: out.title, body: out.body});
  Rec.activity(data, {at: event.at, actor: 'event', by: who.by, action: kind, object_id: out.object_id, request_id: null, event_id: event.event_id});
  log(ctx, 'platewright.event_prepared', {event: kind, object_id: out.object_id});
  return data;
}

module.exports = {applyEvent};
