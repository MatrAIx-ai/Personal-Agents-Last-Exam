'use strict';
// W2 household profiles and the suitability check: T05 verdicts, T06 date of the meal, T07 profiles
// and constraint history, T08 guests and limits with portion factors.
const test = require('node:test');
const assert = require('node:assert/strict');
const {fixture, ev} = require('./harness.cjs');

const P = 'platewright.';
const guest = (id, constraints) => ({guest_id: id, name: id.replace('guest-', ''), constraints});
const verdictFor = (f, recipe, constraints, extra = {}) =>
  f.call(P + 'recipes.check', {id: recipe, members: [], guests: [guest('guest-x', constraints)], date: '2026-11-14', ...extra}).verdicts[0];
const lines = v => v.findings.flatMap(x => x.lines.map(l => l.line)).sort((a, b) => a - b);

test('T05 each constraint kind, the order of seriousness, strict and may_contain, lactose versus milk, ok_if_omitted', () => {
  const f = fixture(), before = JSON.stringify(f.data);
  // allergy -> unsafe, with the line named.
  const egg = verdictFor(f, 'rec-shakshuka', [{kind: 'allergy', allergen: 'egg'}]);
  assert.deepEqual([egg.verdict, lines(egg), egg.findings[0].reason], ['unsafe', [4], 'contains_allergen']);
  // may contain: may_contain when not strict, unsafe when strict (tortillas may contain soy).
  const soy = verdictFor(f, 'rec-black-bean-tacos', [{kind: 'allergy', allergen: 'soy'}]);
  assert.deepEqual([soy.verdict, lines(soy)], ['may_contain', [3]]);
  assert.equal(verdictFor(f, 'rec-black-bean-tacos', [{kind: 'allergy', allergen: 'soy', strict: true}]).verdict, 'unsafe');
  // The verdict is the most serious finding: the optional cashews contain tree nuts, so the curry is unsafe
  // for a tree-nut allergy even though only the paste is a firm line; the cashews are named in omit_lines.
  const nut = verdictFor(f, 'rec-green-curry', [{kind: 'allergy', allergen: 'tree_nut'}]);
  assert.deepEqual([nut.verdict, nut.omit_lines.map(l => l.ingredient_id)], ['unsafe', ['ing-cashews']]);
  assert.deepEqual(nut.findings.map(x => [x.verdict, x.reason, x.lines.map(l => l.line)]), [['unsafe', 'contains_allergen', [7]], ['may_contain', 'may_contain_allergen', [1]]]);
  // A firm mild finding does not hide an optional severe one (strict tree-nut allergy and a dislike of banana).
  const bread = verdictFor(f, 'rec-banana-bread', [{kind: 'allergy', allergen: 'tree_nut', strict: true}, {kind: 'dislike', ingredient_id: 'ing-banana'}]);
  assert.deepEqual([bread.verdict, bread.omit_lines.map(l => l.ingredient_id), bread.findings.map(x => x.verdict)], ['unsafe', ['ing-walnuts'], ['unsafe', 'disliked']]);
  const strict = verdictFor(f, 'rec-green-curry', [{kind: 'allergy', allergen: 'tree_nut', strict: true}]);
  assert.equal(strict.verdict, 'unsafe');
  assert.deepEqual(strict.findings[1], {verdict: 'unsafe', reason: 'may_contain_allergen', constraint_id: null, kind: 'allergy', lines: [{line: 1, ingredient_id: 'ing-green-curry-paste', optional: false}], allergen: 'tree_nut', strict: true});
  // medical: an ingredient, or a flag.
  assert.deepEqual([verdictFor(f, 'rec-green-curry', [{kind: 'medical', ingredient_id: 'ing-lime'}])].map(v => [v.verdict, lines(v)]), [['unsafe', [5]]]);
  assert.equal(verdictFor(f, 'rec-chicken-traybake', [{kind: 'medical', flag: 'poultry'}]).verdict, 'unsafe');
  // diet -> unsuitable.
  const veg = verdictFor(f, 'rec-green-curry', [{kind: 'diet', diet: 'vegetarian'}]);
  assert.deepEqual([veg.verdict, lines(veg)], ['unsuitable', [4]]);
  // lactose is a flag and milk an allergen: lactose-free yogurt suits a lactose-free diet and is unsafe for a milk allergy.
  assert.equal(verdictFor(f, 'rec-yogurt-parfait', [{kind: 'diet', diet: 'lactose_free'}]).verdict, 'ok');
  assert.deepEqual([verdictFor(f, 'rec-yogurt-parfait', [{kind: 'allergy', allergen: 'milk'}])].map(v => [v.verdict, lines(v)]), [['unsafe', [0]]]);
  assert.equal(verdictFor(f, 'rec-yogurt-parfait', [{kind: 'diet', diet: 'vegan'}]).verdict, 'unsuitable');
  // limit -> over_limit with the value; a guest counts portion factor 1.
  const lim = verdictFor(f, 'rec-green-curry', [{kind: 'limit', nutrient: 'kcal', max: 500}]);
  assert.deepEqual([lim.verdict, lim.findings[0].value, lim.findings[0].lines], ['over_limit', 519.4, []]);
  assert.equal(verdictFor(f, 'rec-green-curry', [{kind: 'limit', nutrient: 'kcal', max: 520}]).verdict, 'ok');
  // A limit cannot be checked where nutrition is unknown: reported as unchecked, never counted as zero.
  const soup = verdictFor(f, 'rec-red-lentil-soup', [{kind: 'limit', nutrient: 'sodium_mg', max: 1}]);
  assert.deepEqual([soup.verdict, soup.unchecked], ['ok', [{constraint_id: null, nutrient: 'sodium_mg', reason: 'nutrition_unknown'}]]);
  // dislike: an ingredient or an ingredient tag.
  assert.deepEqual([verdictFor(f, 'rec-green-curry', [{kind: 'dislike', tag: 'spicy'}])].map(v => [v.verdict, lines(v)]), [['disliked', [1]]]);
  assert.equal(verdictFor(f, 'rec-mushroom-risotto', [{kind: 'dislike', ingredient_id: 'ing-mushroom'}]).verdict, 'disliked');
  // Order of seriousness: unsafe > may_contain > unsuitable > over_limit > disliked; all findings are listed.
  const order = [
    [[{kind: 'dislike', tag: 'spicy'}, {kind: 'limit', nutrient: 'kcal', max: 100}], 'over_limit'],
    [[{kind: 'dislike', tag: 'spicy'}, {kind: 'limit', nutrient: 'kcal', max: 100}, {kind: 'diet', diet: 'pescatarian'}, {kind: 'diet', diet: 'vegetarian'}], 'unsuitable'],
    [[{kind: 'diet', diet: 'vegetarian'}, {kind: 'allergy', allergen: 'peanut'}, {kind: 'dislike', tag: 'citrus'}], 'unsuitable'],
    [[{kind: 'diet', diet: 'vegetarian'}, {kind: 'allergy', allergen: 'tree_nut'}, {kind: 'allergy', allergen: 'fish'}], 'unsafe']
  ];
  for (const [cons, expected] of order) {
    const v = verdictFor(f, 'rec-green-curry', cons);
    assert.equal(v.verdict, expected, JSON.stringify(cons));
  }
  assert.equal(verdictFor(f, 'rec-black-bean-tacos', [{kind: 'allergy', allergen: 'soy'}, {kind: 'diet', diet: 'lactose_free'}, {kind: 'dislike', ingredient_id: 'ing-cilantro'}]).verdict, 'may_contain');
  assert.equal(verdictFor(f, 'rec-green-curry', order[3][0]).findings.length, 4, 'every finding is listed, not only the worst');
  // ok_if_omitted: all causing lines optional -> names them.
  const wine = verdictFor(f, 'rec-mushroom-risotto', [{kind: 'medical', flag: 'alcohol'}]);
  assert.deepEqual([wine.verdict, wine.omit_lines.map(l => l.ingredient_id)], ['ok_if_omitted', ['ing-white-wine']]);
  const both = verdictFor(f, 'rec-black-bean-tacos', [{kind: 'diet', diet: 'lactose_free'}, {kind: 'allergy', allergen: 'milk'}]);
  assert.deepEqual([both.verdict, both.omit_lines.map(l => l.line)], ['ok_if_omitted', [6]]);
  const mixed = verdictFor(f, 'rec-black-bean-tacos', [{kind: 'diet', diet: 'lactose_free'}, {kind: 'dislike', ingredient_id: 'ing-cilantro'}]);
  assert.deepEqual([mixed.verdict, mixed.omit_lines.map(l => l.line)], ['unsuitable', [6]],
    'with a firm finding present, the most serious finding decides, and the optional sour cream is still named');
  assert.equal(verdictFor(f, 'rec-shakshuka', []).verdict, 'ok', 'a person with no constraints is ok for everything');
  // Constraints a check cannot know are refused before anything is read.
  assert.equal(f.refuse(P + 'recipes.check', {id: 'rec-green-curry', guests: [guest('guest-x', [{kind: 'allergy', allergen: 'coconut'}])]}), 'invalid_constraint');
  assert.equal(f.refuse(P + 'recipes.check', {id: 'rec-green-curry', members: ['person-zed']}), 'unknown_member');
  assert.equal(f.refuse(P + 'recipes.check', {id: 'rec-green-curry', date: '2026-02-30'}), 'invalid_arguments');
  assert.equal(JSON.stringify(f.data), before);
});

test('T06 the check uses the date of the meal: scheduled, active, expired and ended on either side of each boundary', () => {
  const f = fixture();
  const member = (id, recipe, date) => f.call(P + 'recipes.check', {id: recipe, members: [id], date}).verdicts[0].verdict;
  // Scheduled: Nora's 800 mg sodium limit starts on 2026-11-20 (the curry has about 2100 mg a serving).
  assert.equal(member('person-nora', 'rec-green-curry', '2026-11-19'), 'ok');
  assert.equal(member('person-nora', 'rec-green-curry', '2026-11-20'), 'over_limit');
  // Active until expires_on inclusive, then expired: Ada's no-spice phase ends after 2026-12-31.
  assert.equal(member('person-ada', 'rec-green-curry', '2026-03-31'), 'ok');
  assert.equal(member('person-ada', 'rec-green-curry', '2026-04-01'), 'disliked');
  assert.equal(member('person-ada', 'rec-green-curry', '2026-12-31'), 'disliked');
  assert.equal(member('person-ada', 'rec-green-curry', '2027-01-01'), 'ok');
  // Already expired: green beans were disliked only in May and June.
  assert.equal(member('person-ada', 'rec-tofu-fried-rice', '2026-06-30'), 'disliked');
  assert.equal(member('person-ada', 'rec-tofu-fried-rice', '2026-07-01'), 'ok_if_omitted', 'only the optional chili flakes (spicy) remain');
  // Ended: Eli's mushroom dislike was ended on 2026-09-01 and stops applying from that date.
  assert.equal(member('person-eli', 'rec-mushroom-risotto', '2026-08-31'), 'disliked');
  assert.equal(member('person-eli', 'rec-mushroom-risotto', '2026-09-01'), 'ok');
  // Evan's cilantro dislike from tomorrow (event) does not flag tonight's tacos and does flag tomorrow's.
  f.event(require('../examples/scenario.json'));
  assert.equal(member('person-evan', 'rec-black-bean-tacos', '2026-11-08'), 'ok');
  assert.equal(member('person-evan', 'rec-black-bean-tacos', '2026-11-09'), 'disliked');
  // A constraint removed today stops applying from today's date; earlier meals still see it.
  f.call(P + 'members.constraint.set', {id: 'person-eli', constraint: {kind: 'dislike', ingredient_id: 'ing-lime', effective_from: '2026-11-01', note: 'Too sour'}});
  assert.equal(member('person-eli', 'rec-green-curry', '2026-11-08'), 'disliked');
  const con = f.data.members.find(m => m.person_id === 'person-eli').constraints.at(-1);
  f.call(P + 'members.constraint.remove', {id: 'person-eli', constraint_id: con.id});
  assert.equal(member('person-eli', 'rec-green-curry', '2026-11-08'), 'ok');
  assert.equal(member('person-eli', 'rec-green-curry', '2026-11-07'), 'disliked');
  // Time moved by Infra with no App event: states read as the new date requires and data is unchanged.
  const states = () => Object.fromEntries(f.call(P + 'household.get', {}).members.flatMap(m => m.constraints.map(x => [x.id, x.state])));
  assert.deepEqual(states(), {'con-nora-01': 'active', 'con-nora-02': 'scheduled', 'con-evan-01': 'active', 'con-evan-07': 'scheduled', 'con-eli-01': 'active',
    'con-eli-02': 'ended', 'con-0001': 'ended', 'con-ada-01': 'active', 'con-ada-02': 'expired'});
  const data = JSON.stringify(f.data);
  f.advance('2027-01-01T06:00:00-05:00');
  assert.deepEqual(states(), {'con-nora-01': 'active', 'con-nora-02': 'active', 'con-evan-01': 'active', 'con-evan-07': 'active', 'con-eli-01': 'active',
    'con-eli-02': 'ended', 'con-0001': 'ended', 'con-ada-01': 'expired', 'con-ada-02': 'expired'});
  assert.equal(member('person-ada', 'rec-green-curry', '2027-01-01'), 'ok', 'an expired constraint no longer reports');
  assert.equal(JSON.stringify(f.data), data, 'the passing of time writes nothing');
});

test('T07 household.get for all members and one, on a date; constraint set and remove with history; refusals', () => {
  const f = fixture();
  const all = f.call(P + 'household.get', {});
  assert.deepEqual(all.members.map(m => [m.person_id, m.portion_factor, m.account_holder]),
    [['person-nora', 1, true], ['person-evan', 1.5, false], ['person-eli', 1, false], ['person-ada', 0.5, false]]);
  assert.deepEqual([all.today, all.date, all.household.time_zone, all.account_holder], ['2026-11-08', '2026-11-08', 'America/New_York', 'person-nora']);
  const one = f.call(P + 'household.get', {id: 'person-ada', date: '2026-06-15'});
  assert.deepEqual(one.members.map(m => m.constraints.map(x => [x.id, x.state])), [[['con-ada-01', 'active'], ['con-ada-02', 'active']]]);
  assert.equal(f.refuse(P + 'household.get', {id: 'person-zed'}), 'unknown_member');
  // Add a scheduled constraint for another member, with a note; then replace it by id; then end it.
  const added = f.call(P + 'members.constraint.set', {id: 'person-evan', constraint: {kind: 'allergy', allergen: 'sesame', strict: true, effective_from: '2026-11-10', note: 'Found out at the clinic'}});
  assert.deepEqual([added.id, added.member_id, added.state, added.action], ['con-0001', 'person-evan', 'scheduled', 'created']);
  const replaced = f.call(P + 'members.constraint.set', {id: 'person-evan', constraint: {id: added.id, kind: 'allergy', allergen: 'sesame', strict: false, expires_on: '2026-12-31', note: 'Clinic says mild'}});
  assert.deepEqual([replaced.state, replaced.action], ['scheduled', 'replaced']);
  let con = f.call(P + 'household.get', {id: 'person-evan'}).members[0].constraints.find(x => x.id === added.id);
  assert.deepEqual([con.strict, con.effective_from, con.expires_on, con.note, con.set_by], [false, '2026-11-10', '2026-12-31', 'Clinic says mild', 'person-nora'], 'omitted dates are kept on a replacement');
  assert.deepEqual(con.history.map(h => [h.action, h.actor, h.by, h.note]), [['created', 'agent', 'person-nora', 'Found out at the clinic'], ['replaced', 'agent', 'person-nora', 'Clinic says mild']]);
  assert.deepEqual(con.history[1].previous, {kind: 'allergy', allergen: 'sesame', strict: true, effective_from: '2026-11-10', expires_on: null, note: 'Found out at the clinic'});
  // A new constraint defaults to today and no expiry.
  const dflt = f.call(P + 'members.constraint.set', {id: 'person-nora', constraint: {kind: 'dislike', tag: 'herb', note: 'Not tonight'}});
  con = f.call(P + 'household.get', {id: 'person-nora'}).members[0].constraints.find(x => x.id === dflt.id);
  assert.deepEqual([con.effective_from, con.expires_on, dflt.state], ['2026-11-08', null, 'active']);
  const removed = f.call(P + 'members.constraint.remove', {id: 'person-evan', constraint_id: added.id, note: 'Wrong person'});
  assert.deepEqual([removed.state, removed.ended_at], ['ended', '2026-11-08T08:00:00-05:00']);
  con = f.call(P + 'household.get', {id: 'person-evan'}).members[0].constraints.find(x => x.id === added.id);
  assert.deepEqual([con.state, con.history.map(h => h.action)], ['ended', ['created', 'replaced', 'ended']]);
  // Refusals leave everything unchanged.
  const before = f.data;
  const set = c => f.refuse(P + 'members.constraint.set', {id: 'person-eli', constraint: {note: 'n', ...c}});
  assert.equal(f.refuse(P + 'members.constraint.set', {id: 'person-zed', constraint: {kind: 'diet', diet: 'vegan', note: 'n'}}), 'unknown_member');
  assert.equal(set({kind: 'allergy', allergen: 'coconut'}), 'invalid_constraint');
  assert.equal(set({kind: 'diet', diet: 'keto'}), 'invalid_constraint');
  assert.equal(set({kind: 'dislike', ingredient_id: 'ing-durian'}), 'invalid_constraint');
  assert.equal(set({kind: 'dislike', tag: 'slimy'}), 'invalid_constraint');
  assert.equal(set({kind: 'limit', nutrient: 'sugar_g', max: 10}), 'invalid_constraint');
  assert.equal(set({kind: 'limit', nutrient: 'kcal', max: 0}), 'invalid_constraint');
  assert.equal(set({kind: 'medical', flag: 'caffeine'}), 'invalid_constraint');
  assert.equal(set({kind: 'diet', diet: 'vegan', allergen: 'milk'}), 'invalid_constraint');
  assert.equal(set({kind: 'dislike', tag: 'herb', ingredient_id: 'ing-cilantro'}), 'invalid_constraint');
  assert.equal(set({kind: 'diet', diet: 'vegan', effective_from: '2026-12-01', expires_on: '2026-11-30'}), 'invalid_window');
  assert.equal(set({id: 'con-nora-01', kind: 'diet', diet: 'vegan'}), 'not_found');
  assert.equal(set({id: 'con-eli-02', kind: 'dislike', tag: 'mushroom'}), 'invalid_state');
  assert.equal(f.refuse(P + 'members.constraint.remove', {id: 'person-eli', constraint_id: 'con-eli-02'}), 'invalid_state');
  assert.equal(f.refuse(P + 'members.constraint.remove', {id: 'person-ada', constraint_id: 'con-ada-02'}), 'invalid_state');
  assert.equal(f.refuse(P + 'members.constraint.remove', {id: 'person-ada', constraint_id: 'con-nora-01'}), 'not_found');
  assert.equal(f.refuse(P + 'members.constraint.remove', {id: 'person-evan', constraint_id: added.id}), 'invalid_state');
  assert.deepEqual(f.data, before);
  assert.deepEqual(f.data.activity.map(a => [a.action, a.object_id]), [['members.constraint.set', 'con-0001'], ['members.constraint.set', 'con-0001'],
    ['members.constraint.set', 'con-0002'], ['members.constraint.remove', 'con-0001']]);
});

test('T08 guests are checked on their slot only; limits use portion factors', () => {
  const f = fixture();
  const maya = guest('guest-maya', [{kind: 'allergy', allergen: 'tree_nut', strict: true}]);
  f.call(P + 'plan.slot.set', {id: '2026-11-14:dinner', dishes: [{recipe_id: 'rec-green-curry'}], attendees: ['person-nora', 'person-evan'], guests: [maya]});
  f.call(P + 'plan.slot.set', {id: '2026-11-15:dinner', dishes: [{recipe_id: 'rec-green-curry'}], attendees: ['person-nora', 'person-evan']});
  const plan = f.call(P + 'plan.get', {start: '2026-11-14', end: '2026-11-15'}).slots;
  const person = (slot, id) => slot.flags.find(x => x.type === 'person' && x.id === id);
  assert.deepEqual([person(plan[0], 'guest-maya').verdict, person(plan[0], 'guest-maya').kind], ['unsafe', 'guest']);
  assert.equal(person(plan[1], 'guest-maya'), undefined, 'a guest is checked only on the slot that names her');
  // Nothing a guest needs reaches a member's profile.
  assert.ok(f.call(P + 'household.get', {}).members.every(m => m.constraints.every(x => x.allergen !== 'tree_nut')));
  // Limits: Evan's 700 kcal cap at portion factor 1.5 against 519 kcal a serving.
  const evan = person(plan[0], 'person-evan').dishes[0].findings[0];
  assert.deepEqual([evan.verdict, evan.value, evan.max, evan.portion_factor], ['over_limit', 779, 700, 1.5]);
  // The same cap for a guest (factor 1) is fine, and for a member at factor 0.5 too.
  assert.equal(verdictFor(f, 'rec-green-curry', [{kind: 'limit', nutrient: 'kcal', max: 700}]).verdict, 'ok');
  f.call(P + 'members.constraint.set', {id: 'person-ada', constraint: {kind: 'limit', nutrient: 'kcal', max: 300, note: 'Small portions'}});
  assert.equal(f.call(P + 'recipes.check', {id: 'rec-green-curry', members: ['person-ada'], date: '2026-11-14'}).verdicts[0].verdict, 'disliked',
    'Ada: 519.4 x 0.5 = 259.7 kcal is under 300; her spicy dislike remains');
  assert.equal(f.call(P + 'recipes.check', {id: 'rec-green-curry', members: ['person-ada'], date: '2026-11-14'}).verdicts[0].findings.some(x => x.verdict === 'over_limit'), false);
  // Guest IDs must not be member IDs, and appear once per slot.
  assert.equal(f.refuse(P + 'plan.slot.set', {id: '2026-11-16:dinner', dishes: [{recipe_id: 'rec-shakshuka'}], guests: [guest('person-eli', [])]}), 'invalid_arguments');
  assert.equal(f.refuse(P + 'plan.slot.set', {id: '2026-11-16:dinner', dishes: [{recipe_id: 'rec-shakshuka'}], guests: [maya, maya]}), 'invalid_arguments');
  assert.equal(f.refuse(P + 'plan.slot.set', {id: '2026-11-16:dinner', dishes: [{recipe_id: 'rec-shakshuka'}], guests: [{guest_id: 'guest-b', name: '   ', constraints: []}]}), 'invalid_arguments');
  // A guest event changes only that slot; flags and default servings follow at the next read.
  f.event(ev('guest.changed', '2026-11-10T18:00:00-05:00', {id: '2026-11-15:dinner', action: 'set', guest: guest('guest-ruth', [{kind: 'limit', nutrient: 'sodium_mg', max: 600}])}));
  const after = f.call(P + 'plan.get', {start: '2026-11-14', end: '2026-11-15'}).slots;
  assert.equal(person(after[1], 'guest-ruth').verdict, 'over_limit');
  assert.equal(person(after[0], 'guest-ruth'), undefined);
  assert.deepEqual([after[1].default_servings, after[0].default_servings], [3.5, 3.5]);
});
