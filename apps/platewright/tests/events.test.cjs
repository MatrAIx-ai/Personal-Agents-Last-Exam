'use strict';
// T16 events: each of the six applied with one notification and one activity row; invalid events
// leave everything unchanged; no notification for the account's own writes or for a read.
// T17 (App side): time moved by Infra with no App event changes derived states only.
const test = require('node:test');
const assert = require('node:assert/strict');
const {fixture, ev} = require('./harness.cjs');
const {unreadable} = require('../scripts/check-fixtures.cjs');

const P = 'platewright.';
const at = hhmm => `2026-11-08T${hhmm}:00-05:00`;

test('T16 each of the six events applies with one notification and one activity row', () => {
  const f = fixture();
  f.call(P + 'shopping.generate', {start: '2026-11-09', end: '2026-11-15'});
  const quiet = f.data;
  assert.equal(quiet.notifications.length, 0, 'no notification for the account\'s own write');
  const events = [
    require('../examples/scenario.json'),
    ev('member.updated', at('09:05'), {member_id: 'person-ada', action: 'remove', constraint_id: 'con-ada-01', note: 'Likes a little heat now', by: 'person-ada'}, 'ev-pw-102'),
    ev('recipe.added', at('09:10'), {recipe: {id: 'rec-eli-chili', title: "Eli's bean chili", servings: 4, method_tags: ['simmer'],
      lines: [{ingredient_id: 'ing-black-beans-canned', quantity: 800, unit: 'g'}, {ingredient_id: 'ing-onion', quantity: 1, unit: 'each'}],
      steps: ['Soften the onion.', 'Add the beans and simmer for 25 minutes.'], tags: ['weeknight']}, by: 'person-eli'}, 'ev-pw-110'),
    ev('plan.changed', at('09:20'), {id: '2026-11-13:dinner', action: 'set', dishes: [{recipe_id: 'rec-eli-chili', servings: 4}], attendees: ['person-nora', 'person-eli'], by: 'person-eli'}, 'ev-pw-120'),
    ev('guest.changed', at('09:30'), {id: '2026-11-13:dinner', action: 'set', guest: {guest_id: 'guest-maya', name: 'Maya', constraints: [{kind: 'allergy', allergen: 'tree_nut', strict: true}]}}, 'ev-pw-130'),
    ev('pantry.changed', at('09:40'), {items: [{ingredient_id: 'ing-egg', quantity: 12, unit: 'each', use_by: '2026-12-03'}, {ingredient_id: 'ing-coconut-milk', quantity: 800, unit: 'ml', use_by: '2027-06-30'}], by: 'person-eli', note: 'Corner market this morning'}, 'ev-pw-140'),
    ev('shopping.changed', at('09:50'), {action: 'tick', line_id: 'sl-0001', by: 'person-eli'}, 'ev-pw-150'),
    ev('shopping.changed', at('09:55'), {action: 'add', text: 'Birthday candles', quantity: 1, unit: 'each', by: 'person-evan'}, 'ev-pw-151'),
    ev('guest.changed', at('10:00'), {id: '2026-11-13:dinner', action: 'remove', guest_id: 'guest-maya', by: 'person-nora'}, 'ev-pw-131'),
    ev('plan.changed', at('10:05'), {id: '2026-11-10:dinner', action: 'clear', by: 'person-evan'}, 'ev-pw-121')
  ];
  for (const [i, e] of events.entries()) {
    const before = f.data;
    f.event(e);
    const after = f.data;
    assert.equal(after.notifications.length, before.notifications.length + 1, e.event_id);
    assert.equal(after.activity.length, before.activity.length + 1, e.event_id);
    const n = after.notifications.at(-1), a = after.activity.at(-1);
    assert.deepEqual([n.at, n.kind, n.event_id, n.id], [e.at, e.operation.slice(P.length), e.event_id, 'ntf-' + String(i + 1).padStart(4, '0')]);
    assert.deepEqual([a.at, a.actor, a.action, a.event_id, a.request_id, a.object_id], [e.at, 'event', e.operation.slice(P.length), e.event_id, null, n.object_id]);
  }
  const d = f.data;
  // Effects.
  const evan = d.members.find(m => m.person_id === 'person-evan').constraints.find(c => c.id === 'con-evan-07');
  assert.deepEqual([evan.ingredient_id, evan.effective_from, evan.set_by, evan.history[0].actor, evan.history[0].event_id], ['ing-cilantro', '2026-11-09', 'person-evan', 'event', 'ev-pw-101']);
  assert.equal(d.members.find(m => m.person_id === 'person-ada').constraints.find(c => c.id === 'con-ada-01').ended_at, at('09:05'));
  const chili = d.recipes.find(r => r.id === 'rec-eli-chili');
  assert.deepEqual([chili.revision, chili.archived, chili.origin.actor, chili.origin.by, chili.origin.event_id], [1, false, 'event', 'person-eli', 'ev-pw-110']);
  const fri = d.plan.find(s => s.id === '2026-11-13:dinner');
  assert.deepEqual(fri.history.map(h => [h.action, h.actor, h.event_id]), [['set', 'event', 'ev-pw-120'], ['guest_added', 'event', 'ev-pw-130'], ['guest_removed', 'event', 'ev-pw-131']]);
  assert.deepEqual(fri.guests, []);
  assert.equal(d.plan.find(s => s.id === '2026-11-10:dinner').state, 'cleared');
  assert.deepEqual(['quantity', 'use_by'].map(k => d.pantry.find(p => p.ingredient_id === 'ing-egg')[k]), [12, '2026-12-03']);
  assert.deepEqual(d.pantry.find(p => p.ingredient_id === 'ing-egg').history.at(-1).event_id, 'ev-pw-140');
  assert.equal(d.shopping.lines.find(l => l.id === 'sl-0001').state, 'ticked');
  assert.deepEqual(['kind', 'text', 'state'].map(k => d.shopping.lines.at(-1)[k]), ['manual', 'Birthday candles', 'needed']);
  // Notification wording names who did what.
  const n = Object.fromEntries(d.notifications.map(x => [x.event_id, x]));
  assert.equal(n['ev-pw-101'].title, 'Evan added a constraint');
  assert.equal(n['ev-pw-102'].title, 'Ada ended one of their constraints');
  assert.equal(n['ev-pw-101'].body, 'Evan: dislike of cilantro from Mon 9 Nov 2026. Note: Told Maya at lunch');
  assert.equal(n['ev-pw-130'].body, 'Maya is coming to dinner on Fri 13 Nov 2026.');
  assert.equal(n['ev-pw-140'].body, 'Egg 12, Coconut milk (canned) 800 ml. Note: Corner market this morning');
  assert.equal(n['ev-pw-131'].title, 'Guest update for dinner on Fri 13 Nov 2026');
  // People read the same text in the App's activity: no record IDs, slot IDs, ISO dates or vocabulary keys.
  assert.deepEqual(d.notifications.flatMap(x => [x.title, x.body]).map(unreadable).filter(Boolean), []);
  // Reads write nothing, including no notification.
  const snap = JSON.stringify(f.data);
  f.call(P + 'notifications.list', {});
  f.call(P + 'plan.get', {start: '2026-11-09', end: '2026-11-15'});
  assert.equal(JSON.stringify(f.data), snap);
  assert.deepEqual(f.call(P + 'notifications.list', {kind: 'guest.changed'}).notifications.map(x => x.event_id), ['ev-pw-130', 'ev-pw-131']);
  assert.deepEqual(f.call(P + 'notifications.list', {start: '2026-11-09'}).notifications, []);
  assert.equal(f.refuse(P + 'notifications.list', {start: '2026-11-09', end: '2026-11-01'}), 'invalid_window');
});

test('T16 invalid events are invalid_event and leave data, notifications and activity unchanged', () => {
  const f = fixture();
  f.call(P + 'shopping.generate', {start: '2026-11-09', end: '2026-11-15'});
  f.advance('2026-11-09T20:00:00-05:00');
  f.call(P + 'plan.slot.mark', {id: '2026-11-09:dinner', status: 'cooked'});
  f.call(P + 'shopping.item.set', {id: 'sl-0001', ticked: true});
  const before = f.data;
  let n = 0;
  const bad = (op, payload) => {
    const code = f.refuseEvent(ev(op, '2026-11-09T21:' + String(n++).padStart(2, '0') + ':00-05:00', payload));
    assert.equal(code, 'invalid_event', op + ' ' + JSON.stringify(payload));
  };
  const C = {kind: 'dislike', ingredient_id: 'ing-lime', note: 'x'};
  bad('member.updated', {member_id: 'person-zed', action: 'set', constraint: C});
  bad('member.updated', {member_id: 'person-eli', action: 'set', constraint: C, by: 'person-zed'});
  bad('member.updated', {member_id: 'person-eli', action: 'set', constraint: {kind: 'allergy', allergen: 'coconut', note: 'x'}});
  bad('member.updated', {member_id: 'person-eli', action: 'set', constraint: {...C, effective_from: '2026-12-02', expires_on: '2026-12-01'}});
  bad('member.updated', {member_id: 'person-eli', action: 'remove', constraint_id: 'con-eli-02'});
  bad('member.updated', {member_id: 'person-eli', action: 'remove', constraint_id: 'con-nora-01'});
  bad('recipe.added', {recipe: {id: 'rec-green-curry', title: 'Another curry', servings: 2, method_tags: ['simmer'], lines: [{ingredient_id: 'ing-onion', quantity: 1, unit: 'each'}], steps: ['Cook.']}});
  bad('recipe.added', {recipe: {id: 'rec-new', title: 'Mystery stew', servings: 2, method_tags: ['simmer'], lines: [{ingredient_id: 'ing-unicorn', quantity: 1, unit: 'each'}], steps: ['Cook.']}});
  bad('recipe.added', {recipe: {id: 'rec-new', title: 'Flour soup', servings: 2, method_tags: ['simmer'], lines: [{ingredient_id: 'ing-flour-ap', quantity: 1, unit: 'cup'}], steps: ['Cook.']}});
  bad('plan.changed', {id: '2026-11-12:dinner', action: 'set', dishes: [{recipe_id: 'rec-nope'}]});
  bad('plan.changed', {id: '2026-11-12:dinner', action: 'set', dishes: [{recipe_id: 'rec-shakshuka'}], attendees: ['person-zed']});
  bad('plan.changed', {id: '2026-11-09:dinner', action: 'set', dishes: [{recipe_id: 'rec-shakshuka'}]});
  bad('plan.changed', {id: '2026-11-09:dinner', action: 'clear'});
  bad('plan.changed', {id: '2026-11-08:dinner', action: 'set', dishes: [{recipe_id: 'rec-shakshuka'}]});
  bad('plan.changed', {id: '2026-11-12:dinner', action: 'clear'});
  bad('guest.changed', {id: '2026-11-12:dinner', action: 'set', guest: {guest_id: 'guest-x', name: 'X', constraints: []}});
  bad('guest.changed', {id: '2026-11-09:dinner', action: 'set', guest: {guest_id: 'guest-x', name: 'X', constraints: []}});
  bad('guest.changed', {id: '2026-11-07:dinner', action: 'set', guest: {guest_id: 'guest-x', name: 'X', constraints: []}});
  bad('guest.changed', {id: '2026-11-10:dinner', action: 'remove', guest_id: 'guest-nobody'});
  bad('guest.changed', {id: '2026-11-10:dinner', action: 'set', guest: {guest_id: 'guest-x', name: 'X', constraints: [{kind: 'diet', diet: 'carnivore'}]}});
  bad('pantry.changed', {items: [{ingredient_id: 'ing-egg', quantity: 12, unit: 'each'}, {ingredient_id: 'ing-unicorn', quantity: 1, unit: 'each'}]});
  bad('pantry.changed', {items: [{ingredient_id: 'ing-egg', quantity: 12, unit: 'each'}, {ingredient_id: 'ing-flour-ap', quantity: 1, unit: 'cup'}]});
  bad('pantry.changed', {items: [{ingredient_id: 'ing-egg', quantity: 12, unit: 'each'}, {ingredient_id: 'ing-egg', quantity: 6, unit: 'each'}]});
  bad('shopping.changed', {action: 'tick', line_id: 'sl-0999'});
  bad('shopping.changed', {action: 'tick', line_id: 'sl-0001'});
  bad('shopping.changed', {action: 'add', quantity: 2, unit: 'each'});
  assert.deepEqual(f.data, before);
  assert.equal(f.now, '2026-11-09T20:00:00-05:00', 'a rejected event leaves the clock where it was');
});

test('T17 (App side) time moved with no App event: constraint states, slot phases and pantry freshness follow; business data unchanged', () => {
  const f = fixture();
  const read = () => ({
    states: f.call(P + 'household.get', {}).members.flatMap(m => m.constraints.map(c => c.state)),
    phases: f.call(P + 'plan.get', {start: '2026-11-07', end: '2026-11-10'}).slots.map(s => s.phase),
    fresh: f.call(P + 'pantry.list', {}).items.map(i => i.freshness)
  });
  const data = JSON.stringify(f.data), first = read();
  assert.deepEqual(first.phases, ['past', 'upcoming', 'upcoming']);
  f.advance('2026-11-21T09:00:00-05:00');
  const later = read();
  assert.deepEqual(later.phases, ['past', 'past', 'past']);
  assert.notDeepEqual(later.states, first.states);
  assert.notDeepEqual(later.fresh, first.fresh);
  assert.equal(JSON.stringify(f.data), data);
  assert.equal(f.data.notifications.length, 0, 'the passing of time writes no notification');
});
