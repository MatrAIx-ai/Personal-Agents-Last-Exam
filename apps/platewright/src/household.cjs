'use strict';
// W2 household profiles: members, dated constraints with history, and guests' constraints.
const c = require('./common.cjs');
const {NUTRIENTS} = require('./common.cjs');
const {constraintState} = require('./check.cjs');
const {fail, copy} = c;

const TARGETS = ['allergen', 'strict', 'ingredient_id', 'flag', 'tag', 'diet', 'nutrient', 'max'];

// Validates what a constraint names and returns only the fields of its kind. Anything that is not in
// the tables (allergen, diet, ingredient, flag, ingredient tag, nutrient) is invalid_constraint.
function target(data, input) {
  const bad = message => fail('invalid_constraint', message);
  const only = (...allowed) => {
    const extra = TARGETS.filter(k => input[k] !== undefined && !allowed.includes(k));
    if (extra.length) bad(`A ${input.kind} constraint does not take ${extra.join(', ')}.`);
  };
  const ingredientOrOther = other => {
    if ((input.ingredient_id === undefined) === (input[other] === undefined)) bad(`A ${input.kind} constraint names exactly one of ingredient_id or ${other}.`);
    if (input.ingredient_id !== undefined) {
      if (!data.ingredients.some(i => i.id === input.ingredient_id)) bad(`${input.ingredient_id} is not in the ingredient table.`);
      return {ingredient_id: input.ingredient_id};
    }
    return null;
  };
  switch (input.kind) {
    case 'allergy':
      only('allergen', 'strict');
      if (!c.ALLERGENS.includes(input.allergen)) bad(`${input.allergen} is not one of the nine allergens (${c.ALLERGENS.join(', ')}).`);
      return {allergen: input.allergen, strict: !!input.strict};
    case 'medical': {
      only('ingredient_id', 'flag');
      const ing = ingredientOrOther('flag');
      if (ing) return ing;
      if (!c.FLAGS.includes(input.flag)) bad(`${input.flag} is not a content flag.`);
      return {flag: input.flag};
    }
    case 'diet':
      only('diet');
      if (!c.DIETS[input.diet]) bad(`${input.diet} is not a known diet.`);
      return {diet: input.diet};
    case 'limit':
      only('nutrient', 'max');
      if (!NUTRIENTS.includes(input.nutrient)) bad(`${input.nutrient} is not one of ${NUTRIENTS.join(', ')}.`);
      if (!(typeof input.max === 'number' && input.max > 0)) bad('A limit needs a positive max per meal.');
      return {nutrient: input.nutrient, max: input.max};
    case 'dislike': {
      only('ingredient_id', 'tag');
      const ing = ingredientOrOther('tag');
      if (ing) return ing;
      if (!data.ingredients.some(i => i.tags.includes(input.tag))) bad(`No ingredient carries the tag ${input.tag}.`);
      return {tag: input.tag};
    }
    default:
      return bad(`${input.kind} is not a constraint kind.`);
  }
}

function dates(from, to) {
  for (const d of [from, to]) if (d !== null && !c.isDate(d)) fail('invalid_arguments', `${d} is not a calendar date.`);
  if (from !== null && to !== null && to < from) fail('invalid_window', `The end date (${c.dateText(to)}) is before the start date (${c.dateText(from)}).`);
}

// A constraint in words, as notifications and messages name it: "strict allergy to tree nut",
// "dislike of mushroom from Sun 1 Feb 2026".
const AMOUNT = {kcal: 'kcal', protein_g: 'g protein', carbs_g: 'g carbohydrate', fat_g: 'g fat', sodium_mg: 'mg sodium'};
const DIET_WORDS = {gluten_free: 'gluten-free', lactose_free: 'lactose-free'};
function describe(data, con) {
  const what = {
    allergy: () => `${con.strict ? 'strict ' : ''}allergy to ${c.words(con.allergen)}`,
    medical: () => `medical restriction on ${con.ingredient_id ? data.ingredients.find(i => i.id === con.ingredient_id).name.toLowerCase() : c.words(con.flag)}`,
    diet: () => `${DIET_WORDS[con.diet] || c.words(con.diet)} diet`,
    limit: () => `limit of ${con.max} ${AMOUNT[con.nutrient]} per meal`,
    dislike: () => `dislike of ${con.ingredient_id ? data.ingredients.find(i => i.id === con.ingredient_id).name.toLowerCase() : c.words(con.tag)}`
  }[con.kind]();
  const from = con.effective_from ? ` from ${c.dateText(con.effective_from)}` : '';
  const to = con.expires_on ? ` until ${c.dateText(con.expires_on)}` : '';
  return what + from + to;
}
// Guests carry a name and constraints of the same five kinds, without dates.
// The checks are on guest_id, so their messages repeat the ID that was sent next to the guests' names.
function normalizeGuests(data, guests) {
  const ids = new Map();
  return guests.map(g => {
    if (!g.name.trim()) fail('invalid_arguments', 'Every guest needs a name.');
    if (ids.has(g.guest_id)) fail('invalid_arguments', `Two guests, ${ids.get(g.guest_id)} and ${g.name.trim()}, have the same guest ID ${g.guest_id}; give each guest an ID of their own.`);
    ids.set(g.guest_id, g.name.trim());
    const member = data.members.find(m => m.person_id === g.guest_id);
    if (member) fail('invalid_arguments', `The guest ${g.name.trim()} has the guest ID ${g.guest_id}, which is household member ${member.display_name}'s; list members as attendees, and give a guest an ID of their own.`);
    return {guest_id: g.guest_id, name: g.name.trim(), constraints: (g.constraints || []).map(x => ({kind: x.kind, ...target(data, x), note: x.note ?? null}))};
  });
}

function constraintView(data, con, date) {
  return {...copy(con), state: constraintState(con, date, data.household.time_zone)};
}
function memberView(data, m, date) {
  return {person_id: m.person_id, display_name: m.display_name, portion_factor: m.portion_factor, account_holder: m.person_id === data.owner_person_id,
    constraints: m.constraints.map(x => constraintView(data, x, date))};
}

function get(ctx, data, args) {
  const date = args.date || c.today(ctx, data);
  if (!c.isDate(date)) fail('invalid_arguments', `${date} is not a calendar date.`);
  const members = args.id ? [c.member(data, args.id)] : data.members;
  return {household: copy(data.household), today: c.today(ctx, data), date, account_holder: data.owner_person_id,
    members: members.map(m => memberView(data, m, date))};
}

const findOwner = (data, constraintId) => data.members.find(m => m.constraints.some(x => x.id === constraintId));
const allConstraintIds = data => data.members.flatMap(m => m.constraints.map(x => x.id));

// Shared by the tool and by the member.updated event. `who` = {at, actor, by, request_id, event_id}.
// Every refusal is decided before the member's record is touched.
function setConstraint(data, memberId, input, who, todayDate) {
  const m = c.member(data, memberId);
  const existing = input.id ? m.constraints.find(x => x.id === input.id) : null;
  if (input.id && !existing && findOwner(data, input.id)) fail('not_found', `That constraint belongs to ${findOwner(data, input.id).display_name}, not ${m.display_name}.`);
  if (existing && existing.ended_at) fail('invalid_state', `${m.display_name}'s ${describe(data, existing)} has ended; add a new constraint instead.`);
  const what = target(data, input);
  const from = input.effective_from !== undefined ? input.effective_from : existing ? existing.effective_from : todayDate;
  const to = input.expires_on !== undefined ? input.expires_on : existing ? existing.expires_on : null;
  dates(from, to);
  const body = {kind: input.kind, ...what, effective_from: from, expires_on: to, note: input.note ?? null};
  const row = {at: who.at, actor: who.actor, by: who.by, action: existing ? 'replaced' : 'created', note: body.note,
    request_id: who.request_id, event_id: who.event_id, previous: existing ? bodyOf(existing) : null};
  if (existing) {
    for (const k of TARGETS) delete existing[k];
    Object.assign(existing, body, {set_by: who.by});
    existing.history.push(row);
    return existing;
  }
  const con = {id: input.id || c.nextId('con-', allConstraintIds(data)), ...body, set_by: who.by, ended_at: null, history: [row]};
  m.constraints.push(con);
  return con;
}
function bodyOf(con) {
  const out = {kind: con.kind};
  for (const k of TARGETS) if (con[k] !== undefined) out[k] = con[k];
  return {...out, effective_from: con.effective_from, expires_on: con.expires_on, note: con.note};
}

function removeConstraint(data, memberId, constraintId, note, who, todayDate) {
  const m = c.member(data, memberId);
  const con = m.constraints.find(x => x.id === constraintId);
  if (!con) fail('not_found', `${m.display_name} has no constraint ${constraintId}.`);
  const st = constraintState(con, todayDate, data.household.time_zone);
  if (st === 'ended' || con.ended_at) fail('invalid_state', `${m.display_name}'s ${describe(data, con)} has already ended.`);
  if (st === 'expired') fail('invalid_state', `${m.display_name}'s ${describe(data, con)} has already expired.`);
  con.ended_at = who.at;
  con.history.push({at: who.at, actor: who.actor, by: who.by, action: 'ended', note: note ?? null, request_id: who.request_id, event_id: who.event_id, previous: null});
  return con;
}

const agentWho = (ctx, data, args) => ({at: ctx.virtual_now, actor: 'agent', by: data.owner_person_id, request_id: args.request_id, event_id: null});

function setTool(ctx, data, args) {
  const con = setConstraint(data, args.id, args.constraint, agentWho(ctx, data, args), c.today(ctx, data));
  return {id: con.id, member_id: args.id, state: constraintState(con, c.today(ctx, data), data.household.time_zone), action: con.history.at(-1).action};
}
function removeTool(ctx, data, args) {
  const con = removeConstraint(data, args.id, args.constraint_id, args.note, agentWho(ctx, data, args), c.today(ctx, data));
  return {id: con.id, member_id: args.id, state: 'ended', ended_at: con.ended_at};
}

module.exports = {describe, target, normalizeGuests, get, setConstraint, removeConstraint, setTool, removeTool};
