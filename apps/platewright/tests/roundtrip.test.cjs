'use strict';
// A record read from the App can be written back unchanged. For every read tool that returns a record
// some write tool takes, each record of the reference and the minimal household is sent back with the
// fields that write accepts copied as they were read (nulls included). The write must commit, or
// refuse for the record's business state (a meal in the past, a cooked meal, a line that comes from
// the plan, a constraint that has ended); a refusal of the arguments themselves fails the test.
// Reads that take guests (recipes.check, recipes.variant.preview) get each meal's guests the same way.
// The web page's form check must let the same arguments through.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {fixture} = require('./harness.cjs');
const tools = require('../tools.json');

// The web page's own check of a form's arguments against the tool's input schema (gui/src/app.js),
// loaded from the page's source so the test runs exactly that code.
const source = fs.readFileSync(path.join(__dirname, '../gui/src/app.js'), 'utf8');
const schemaProblem = new Function(`const words=s=>String(s??'').replace(/_/g,' ');const cap=s=>words(s).replace(/^./,c=>c.toUpperCase());
${source.slice(source.indexOf('const FIELD_WORDS='), source.indexOf('// A modal form for one write.'))}
return schemaProblem;`)();
const inputSchema = name => tools.find(t => t.name === 'platewright.' + name).inputSchema;

const SEEDS = {reference: require('../fixtures/reference.json'), minimal: require('../fixtures/minimal.json')};
// Refusals about the record's state, never about the shape of the arguments. recipes.update refuses a
// patch that leaves the recipe as it is, which is what an unchanged recipe sent back is.
const BUSINESS = new Set(['invalid_state', 'past_slot', 'not_yet', 'derived_line', 'leftover_unavailable']);
const business = e => BUSINESS.has(e.code) || (e.code === 'invalid_arguments' && e.message === 'The patch does not change the recipe.');
const pick = (record, keys) => Object.fromEntries(keys.filter(k => record[k] !== undefined).map(k => [k, record[k]]));
const CONSTRAINT_KEYS = ['id', 'kind', 'allergen', 'strict', 'ingredient_id', 'flag', 'tag', 'diet', 'nutrient', 'max', 'effective_from', 'expires_on', 'note'];
const GUEST_CONSTRAINT_KEYS = ['kind', 'allergen', 'strict', 'ingredient_id', 'flag', 'tag', 'diet', 'nutrient', 'max', 'note'];
const guestsOf = slot => slot.guests.map(g => ({guest_id: g.guest_id, name: g.name, constraints: g.constraints.map(c => pick(c, GUEST_CONSTRAINT_KEYS))}));
// A dish as read; its servings are sent only when they were given, so default servings stay default.
const dishOf = d => (d.kind === 'leftovers' ? {leftovers_of: d.leftovers_of, recipe_id: d.recipe_id, portions: d.portions}
  : {recipe_id: d.recipe_id, ...(d.servings_source === 'explicit' ? {servings: d.servings} : {})});

// [read, how to list its records, write, the arguments built from one record]
const CASES = [
  ['household.get', f => f.call('platewright.household.get', {}).members.flatMap(m => m.constraints.map(c => ({m, c}))),
    'members.constraint.set', ({m, c}) => ({id: m.person_id, constraint: pick(c, CONSTRAINT_KEYS)})],
  ['household.get', f => f.call('platewright.household.get', {}).members.flatMap(m => m.constraints.map(c => ({m, c}))),
    'members.constraint.remove', ({m, c}) => ({id: m.person_id, constraint_id: c.id})],
  ['recipes.get', f => recipes(f, true),
    'recipes.update', r => ({id: r.id, patch: {...pick(r, ['title', 'servings', 'method_tags', 'steps', 'tags', 'active_minutes', 'total_minutes']),
      lines: r.lines.map(l => pick(l, ['ingredient_id', 'quantity', 'unit', 'optional', 'note']))}})],
  // The same with the title changed, so the unchanged lines (notes included) are saved as a revision.
  ['recipes.get', f => recipes(f, false),
    'recipes.update', r => ({id: r.id, patch: {title: r.title + ' (family)', lines: r.lines.map(l => pick(l, ['ingredient_id', 'quantity', 'unit', 'optional', 'note']))}})],
  ['plan.get', f => plan(f), 'plan.slot.set', s => ({id: s.id, dishes: s.dishes.map(dishOf), attendees: s.attendees, guests: guestsOf(s), note: s.note})],
  ['plan.get', f => plan(f).filter(s => s.cooked), 'plan.slot.mark',
    s => ({id: s.id, status: 'cooked', portions: s.cooked.portions.map(p => pick(p, ['recipe_id', 'made', 'eaten'])), deduct_pantry: s.cooked.deducted})],
  ['plan.get', f => plan(f).filter(s => s.guests.length && s.dishes.length), 'recipes.check',
    s => ({id: s.dishes[0].recipe_id, date: s.date, members: s.attendees, guests: guestsOf(s)})],
  // The preview swaps the first line that has an applicable rule.
  ['plan.get', f => plan(f).filter(s => s.guests.length).flatMap(s => s.dishes.filter(d => d.kind === 'recipe').slice(0, 1).flatMap(d => {
    const line = f.call('platewright.substitutions.list', {id: d.recipe_id}).lines.find(l => l.rules.some(r => r.applicable));
    return line ? [{s, id: d.recipe_id, swap: {ingredient_id: line.ingredient_id, rule_id: line.rules.find(r => r.applicable).id}}] : [];
  })), 'recipes.variant.preview', ({s, id, swap}) => ({id, swaps: [swap], date: s.date, members: s.attendees, guests: guestsOf(s)})],
  ['pantry.list', f => f.call('platewright.pantry.list', {include_out: true}).items, 'pantry.set', i => ({id: i.ingredient_id, ...pick(i, ['quantity', 'unit', 'use_by'])})],
  ['shopping.get', f => lines(f), 'shopping.item.set', l => ({id: l.id, ...pick(l, ['ingredient_id', 'text', 'quantity', 'unit'])})],
  ['shopping.get', f => lines(f), 'shopping.item.remove', l => ({id: l.id})],
  ['shopping.get', f => [f.call('platewright.shopping.get', {}).list].filter(Boolean), 'shopping.generate', l => ({start: l.start, end: l.end})]
];
// Whether an input is accepted depends on its shape: which fields are present and which are null, text,
// numbers or lists. Records are sent once per shape and state (a slot's state and phase, a
// constraint's state, a line's kind and state, a recipe's state and whether it is a variant), so every
// shape a read returns is written back without sending hundreds of records that look the same.
const shape = v => (v === null ? 'null' : Array.isArray(v) ? [...new Set(v.map(x => JSON.stringify(shape(x))))].sort()
  : typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort().map(k => [k, shape(v[k])])) : typeof v);
const stateOf = r => JSON.stringify(['state', 'phase', 'kind', 'variant_of', 'freshness'].map(k => (r.c || r.s || r)[k] ?? null).concat(r.variant ? 'variant' : []));
// The recipes read with recipes.get: one per shape of what is stored for it (archived or not, a
// variant or not, which fields and line notes are empty), chosen from the recipes recipes.search lists.
function recipes(f, includeArchived) {
  const stored = new Map(f.data.recipes.map(r => [r.id, r]));
  const seen = new Set();
  return f.call('platewright.recipes.search', {include_archived: includeArchived, limit: 100}).items.filter(item => {
    const r = stored.get(item.id), key = JSON.stringify([shape({...r, revisions: null, history: null, origin: null}), r.archived, !!r.variant]);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).map(item => f.call('platewright.recipes.get', {id: item.id}).recipe);
}
// Every slot of the reference household's last six weeks and the minimal household's plan.
function plan(f) {
  return [['2026-10-04', '2026-11-14'], ['2026-11-15', '2026-12-26']].flatMap(([start, end]) => f.call('platewright.plan.get', {start, end}).slots);
}
// The list's lines; the minimal household starts without a list, so one is made from its week first.
function lines(f) {
  if (!f.call('platewright.shopping.get', {}).list) {
    f.call('platewright.shopping.generate', {start: '2026-11-08', end: '2026-11-14'});
    f.call('platewright.shopping.item.set', {text: 'Birthday candles'});
    f.call('platewright.shopping.item.set', {ingredient_id: 'ing-egg', quantity: 6, unit: 'each'});
  }
  return f.call('platewright.shopping.get', {}).list.lines;
}

for (const [seedName, seed] of Object.entries(SEEDS)) {
  test(`every record read from the ${seedName} household is written back unchanged or refused for its state`, () => {
    const failures = [], outcomes = CASES.map(() => ({}));
    for (const [index, [read, records, write, build]] of CASES.entries()) {
      const f = fixture({seed, logging: false});
      const sent = new Set();
      for (const record of records(f)) {
        const args = build(record), key = JSON.stringify(shape(args)) + stateOf(record);
        if (sent.has(key)) continue;
        sent.add(key);
        // The page accepts what the contract accepts: a form re-sending this record is not stopped.
        const problem = schemaProblem(inputSchema(write), args);
        if (problem) failures.push(`${read} -> ${write} ${JSON.stringify(args).slice(0, 300)}: the page's form check says "${problem}"`);
        let outcome;
        try { f.call('platewright.' + write, args); outcome = 'ok'; } catch (e) {
          outcome = e.code || 'internal_error';
          if (!business(e)) failures.push(`${read} -> ${write} ${JSON.stringify(args).slice(0, 300)}: ${outcome}: ${e.message}`);
        }
        outcomes[index][outcome] = (outcomes[index][outcome] || 0) + 1;
      }
    }
    assert.deepEqual(failures, []);
    if (process.env.PW_ROUNDTRIP_REPORT) console.log(seedName, JSON.stringify(CASES.map(([read, , write], i) => [read + ' -> ' + write, outcomes[i]])));
    // On the reference household every pair meets records, and each write but plan.slot.mark (only
    // cooked meals carry portions) and the unchanged recipe goes through for some of them.
    if (seedName === 'reference') {
      for (const [index, [read, , write]] of CASES.entries()) {
        assert.ok(Object.keys(outcomes[index]).length, `${read} -> ${write} met no record`);
        if (write !== 'plan.slot.mark' && index !== 2) assert.ok(outcomes[index].ok > 0, `${read} -> ${write}: nothing was written back`);
      }
    }
  });
}

// The meal from the reference household that a person would change: Saturday 14 November 2026's
// dinner, whose guests Ines and Maya have recorded needs that read with no note.
test('Saturday\'s dinner with its guests is changed by sending back what plan.get returned', () => {
  const f = fixture({seed: SEEDS.reference});
  const [slot] = f.call('platewright.plan.get', {start: '2026-11-14', end: '2026-11-14'}).slots.filter(s => s.meal === 'dinner');
  assert.deepEqual(slot.guests.filter(g => g.constraints.length).map(g => [g.name, g.constraints.map(c => c.note)]), [['Ines', [null]], ['Maya', [null]]]);
  const before = f.data.plan.find(s => s.id === slot.id);
  const out = f.call('platewright.plan.slot.set', {id: slot.id, dishes: slot.dishes.map(dishOf), attendees: slot.attendees, guests: slot.guests, note: slot.note});
  assert.equal(out.state, 'planned');
  const after = f.data.plan.find(s => s.id === slot.id);
  // The meal is stored exactly as it was; the change is one history row.
  assert.deepEqual(after.guests, before.guests);
  assert.deepEqual(after.dishes, before.dishes);
  assert.deepEqual(after.attendees, before.attendees);
  assert.equal(after.note, null);
  assert.equal(after.history.length, before.history.length + 1);
  assert.equal(after.history.at(-1).action, 'replaced');
  // A note given as text is still a note, and a guest need without one still reads null.
  f.call('platewright.plan.slot.set', {id: slot.id, dishes: slot.dishes.map(dishOf), attendees: slot.attendees,
    guests: slot.guests.map(g => ({...g, constraints: g.constraints.map(({note, ...c}) => c)})), note: 'Birthday'});
  const read = f.call('platewright.plan.get', {start: '2026-11-14', end: '2026-11-14'}).slots.find(s => s.id === slot.id);
  assert.equal(read.note, 'Birthday');
  assert.deepEqual(read.guests, slot.guests);
});
