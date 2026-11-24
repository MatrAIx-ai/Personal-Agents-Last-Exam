'use strict';
// W3 Pickup authorization and dismissal changes: T09–T13, the person_id identity mapping and
// dismissal-relative cut-offs.
const test = require('node:test');
const assert = require('node:assert/strict');
const {fixture, ev} = require('./harness.cjs');

function refused(f, name, args, code) {
  const before = f.data, rev = f.revision, r = f.try(name, args);
  assert.equal(r.status, code, name + ' should be refused with ' + code + ': ' + r.message);
  assert.deepEqual(f.data, before); assert.equal(f.revision, rev);
}
const add = (f, args) => f.call('bellnote.pickup.person_add', {id: 'child-theo', name: 'Lena Marsh', relationship: 'aunt', phone: '555-0155', ...args});
const review = (f, id, decision, at) => f.event(ev('pickup.person_reviewed', at, {pickup_person_id: id, decision, reviewed_by: 'staff-office-alder'}));
const set = (f, args) => f.call('bellnote.dismissal.set', {id: 'child-theo', date: '2026-11-20', mode: 'pickup', ...args});
const plan = (f, child, date) => f.call('bellnote.pickup.get', {id: child, start: date, end: date}).days[0].plan;

test('T09 pickup.get per child: guardians, pickup people by state, restrictions, default way home; non-custodial is refused', () => {
  const f = fixture();
  const theo = f.call('bellnote.pickup.get', {id: 'child-theo', start: '2026-11-17', end: '2026-11-20'});
  assert.deepEqual(theo.guardians.map(g => [g.person_id, g.is_me]), [['person-maya', true], ['person-dana', false]]);
  assert.deepEqual(theo.pickup_people.map(p => [p.id, p.status]), [['pp-0001', 'approved']]);
  assert.deepEqual(theo.restrictions, [{id: 'rs-0001', person_id: 'person-rex', display_name: 'Rex Halvorsen', note: 'on file with the school office'}]);
  assert.equal(theo.default_dismissal, 'bus');
  assert.deepEqual(theo.days.map(d => d.plan.mode), ['bus', 'bus', 'bus', 'bus']);
  const ines = f.call('bellnote.pickup.get', {id: 'child-ines'});
  assert.deepEqual(ines.pickup_people.map(p => [p.person_id, p.status]), [['person-june', 'pending_review']]);
  assert.deepEqual(ines.restrictions, []);
  refused(f, 'bellnote.pickup.get', {id: 'child-nico'}, 'not_permitted');
  refused(f, 'bellnote.pickup.person_add', {id: 'child-nico', name: 'A B', relationship: 'aunt', phone: '555-0150'}, 'not_permitted');
  refused(f, 'bellnote.dismissal.set', {id: 'child-nico', date: '2026-11-20', mode: 'bus'}, 'not_permitted');
});

test('T10 add, review and remove a pickup person, with and without office review; conflict; in_use', () => {
  const f = fixture();
  const a = add(f);
  assert.equal(a.state, 'pending_review'); assert.equal(a.person_record, 'created');
  refused(f, 'bellnote.pickup.person_add', {id: 'child-theo', name: 'Lena M.', relationship: 'aunt', phone: '(555) 0155'}, 'conflict'); // same phone, same person
  refused(f, 'bellnote.pickup.person_add', {id: 'child-theo', name: 'Dana Okafor', relationship: 'father', phone: '555-0142'}, 'conflict'); // a guardian
  const n0 = f.data.notifications.length;
  review(f, a.id, 'approve', '2026-11-17T11:00:00-08:00');
  assert.equal(f.data.pickup_people.find(p => p.id === a.id).status, 'approved');
  assert.equal(f.data.notifications.length, n0 + 1);
  assert.equal(f.tryEvent(ev('pickup.person_reviewed', '2026-11-17T11:05:00-08:00', {pickup_person_id: a.id, decision: 'approve', reviewed_by: 'staff-office-alder'})).status, 'invalid_event');
  // Named in a change still ahead: cannot be removed.
  const d = set(f, {person_id: a.person_id});
  refused(f, 'bellnote.pickup.person_remove', {id: a.id}, 'in_use');
  f.call('bellnote.dismissal.cancel', {id: d.id});
  assert.equal(f.call('bellnote.pickup.person_remove', {id: a.id}).state, 'removed');
  refused(f, 'bellnote.pickup.person_remove', {id: a.id}, 'invalid_state');
  // A denied person.
  const b = add(f, {name: 'Owen Pike', phone: '555-0177'});
  review(f, b.id, 'deny', '2026-11-17T12:00:00-08:00');
  assert.equal(f.data.pickup_people.find(p => p.id === b.id).status, 'denied');
  refused(f, 'bellnote.dismissal.set', {id: 'child-theo', date: '2026-11-20', mode: 'pickup', person_id: b.person_id}, 'not_authorized_person');
  // A district that asks for no review approves at once.
  const g = fixture({mutate: d2 => { d2.district.policy.pickup_person_review = false; }});
  assert.equal(add(g).state, 'approved');
});

test('T11 dismissal changes: set, replace, cancel, each mode; refusals; the list is per child', () => {
  const f = fixture();
  // Main path: a new person, approved, collects Theo on Friday.
  const a = add(f);
  review(f, a.id, 'approve', '2026-11-17T11:00:00-08:00');
  const first = set(f, {person_id: a.person_id});
  assert.equal(first.state, 'active'); assert.equal(first.cutoff_at, '2026-11-20T13:40:00-08:00');
  assert.deepEqual(plan(f, 'child-theo', '2026-11-20'), {source: 'dismissal_change', change_id: first.id, mode: 'pickup', person_id: a.person_id});
  const second = set(f, {person_id: 'person-rosa'});
  assert.equal(second.replaced_id, first.id);
  const changes = f.call('bellnote.pickup.get', {id: 'child-theo', start: '2026-11-20', end: '2026-11-20'}).dismissal_changes;
  assert.deepEqual(changes.map(c => [c.id, c.status]), [[first.id, 'replaced'], [second.id, 'active']]);
  const cancelled = f.call('bellnote.dismissal.cancel', {id: second.id});
  assert.equal(cancelled.state, 'cancelled'); assert.equal(cancelled.default_dismissal, 'bus');
  assert.deepEqual(plan(f, 'child-theo', '2026-11-20'), {source: 'default', change_id: null, mode: 'bus', person_id: null});
  refused(f, 'bellnote.dismissal.cancel', {id: second.id}, 'invalid_state');
  for (const mode of ['bus', 'after_care', 'walker']) assert.equal(f.call('bellnote.dismissal.set', {id: 'child-ines', date: '2026-11-19', mode}).state, 'active');
  assert.equal(f.call('bellnote.dismissal.set', {id: 'child-ines', date: '2026-11-19', mode: 'pickup', person_id: 'person-dana'}).state, 'active');
  // Refusals, each leaving state and version unchanged.
  refused(f, 'bellnote.dismissal.set', {id: 'child-ines', date: '2026-11-20', mode: 'pickup', person_id: a.person_id}, 'not_authorized_person'); // approved for Theo only
  refused(f, 'bellnote.dismissal.set', {id: 'child-ines', date: '2026-11-20', mode: 'pickup', person_id: 'person-rosa'}, 'not_authorized_person');
  refused(f, 'bellnote.dismissal.set', {id: 'child-ines', date: '2026-11-20', mode: 'pickup', person_id: 'person-june'}, 'pending_review');
  refused(f, 'bellnote.dismissal.set', {id: 'child-theo', date: '2026-11-21', mode: 'bus'}, 'not_school_day');
  refused(f, 'bellnote.dismissal.set', {id: 'child-theo', date: '2026-11-26', mode: 'bus'}, 'not_school_day');
  refused(f, 'bellnote.dismissal.set', {id: 'child-theo', date: '2026-11-20', mode: 'bus', person_id: 'person-rosa'}, 'invalid_arguments');
  refused(f, 'bellnote.dismissal.set', {id: 'child-theo', date: '2026-11-20', mode: 'pickup'}, 'invalid_arguments');
  // The cut-off: 90 minutes before dismissal (13:40 on a regular day).
  f.advance('2026-11-20T13:39:00-08:00');
  const late = set(f, {person_id: 'person-rosa'});
  f.advance('2026-11-20T13:40:00-08:00');
  refused(f, 'bellnote.dismissal.set', {id: 'child-theo', date: '2026-11-20', mode: 'bus'}, 'too_late');
  refused(f, 'bellnote.dismissal.cancel', {id: late.id}, 'too_late');
});

test('T12 restrictions: refused on adding and naming, for events too; matched by person_id, never by name', () => {
  const f = fixture();
  refused(f, 'bellnote.pickup.person_add', {id: 'child-theo', name: 'Rex Halvorsen', relationship: 'family friend', phone: '555-0191', person_id: 'person-rex'}, 'restricted_person');
  // Same person, different display name: the phone the school holds maps to person-rex.
  refused(f, 'bellnote.pickup.person_add', {id: 'child-theo', name: 'R. Halvorsen', relationship: 'uncle', phone: '+1 (555) 0191'}, 'restricted_person');
  refused(f, 'bellnote.pickup.person_add', {id: 'child-theo', name: 'Uncle Rex', relationship: 'uncle', phone: '555 0100', person_id: 'person-rex'}, 'restricted_person');
  refused(f, 'bellnote.dismissal.set', {id: 'child-theo', date: '2026-11-20', mode: 'pickup', person_id: 'person-rex'}, 'restricted_person');
  // A different person who shares the restricted person's name is not restricted.
  const namesake = f.call('bellnote.pickup.person_add', {id: 'child-theo', name: 'Rex Halvorsen', relationship: 'coach', phone: '555-0122'});
  assert.notEqual(namesake.person_id, 'person-rex'); assert.equal(namesake.state, 'pending_review');
  // The restriction is per child: Rex may be added for Ines (subject to review).
  assert.equal(f.call('bellnote.pickup.person_add', {id: 'child-ines', name: 'Rex Halvorsen', relationship: 'family friend', phone: '555-0191'}).person_id, 'person-rex');
  // Events: the other guardian or the office cannot name a restricted person either.
  const before = f.data;
  const r = f.tryEvent(ev('dismissal.recorded', '2026-11-17T21:15:00-08:00', {change_id: 'dc-0031', child_id: 'child-theo', date: '2026-11-20', mode: 'pickup', person_id: 'person-rex', recorded_by: 'person-dana'}));
  assert.equal(r.status, 'invalid_event'); assert.deepEqual(f.data, before);
  // A seed that lists a restricted person as approved is rejected.
  assert.throws(() => fixture({mutate: d => { d.pickup_people.push({...d.pickup_people[0], id: 'pp-0099', person_id: 'person-rex'}); }}), e => e.code === 'invalid_seed');
});

test('T13 the other guardian replaces mine; a revoke voids changes ahead; an early-dismissal day keeps changes and moves the cut-off', () => {
  const f = fixture();
  const mine = set(f, {person_id: 'person-rosa'});
  const n0 = f.data.notifications.length;
  f.event(ev('dismissal.recorded', '2026-11-17T21:15:00-08:00', {change_id: 'dc-0031', child_id: 'child-theo', date: '2026-11-20', mode: 'pickup', person_id: 'person-dana', recorded_by: 'person-dana'}));
  const hist = f.call('bellnote.pickup.get', {id: 'child-theo', start: '2026-11-20', end: '2026-11-20'}).dismissal_changes;
  assert.deepEqual(hist.map(c => [c.id, c.status, c.recorded_by]), [[mine.id, 'replaced', 'person-maya'], ['dc-0031', 'active', 'person-dana']]);
  assert.equal(f.data.notifications.length, n0 + 1);
  assert.match(f.data.notifications.at(-1).body, /set by you/);
  assert.equal(f.tryEvent(ev('dismissal.recorded', '2026-11-17T21:20:00-08:00', {change_id: 'dc-0031', child_id: 'child-theo', date: '2026-11-19', mode: 'bus', recorded_by: 'person-dana'})).status, 'invalid_event', 'duplicate ID');
  assert.equal(f.tryEvent(ev('dismissal.recorded', '2026-11-17T21:20:00-08:00', {change_id: 'dc-0040', child_id: 'child-theo', date: '2026-11-19', mode: 'bus', recorded_by: 'person-sam'})).status, 'invalid_event', 'not a guardian of Theo');
  // Revoke: Rosa's change ahead becomes void (with a notification); a past one is untouched.
  const ahead = set(f, {date: '2026-11-19', person_id: 'person-rosa'});
  f.advance('2026-11-18T07:00:00-08:00');
  const n1 = f.data.notifications.length;
  f.event(ev('pickup.person_reviewed', '2026-11-18T08:00:00-08:00', {pickup_person_id: 'pp-0001', decision: 'revoke', reviewed_by: 'staff-office-alder'}));
  assert.equal(f.data.dismissal_changes.find(d => d.id === ahead.id).status, 'void');
  assert.equal(f.data.dismissal_changes.find(d => d.id === mine.id).status, 'replaced');
  assert.deepEqual(f.data.notifications.slice(n1).map(n => n.kind), ['pickup.person_reviewed', 'dismissal.void']);
  assert.deepEqual(f.data.activity.filter(a => a.event_id === f.data.notifications.at(-1).event_id).map(a => a.action),
    ['event.pickup.person_reviewed', 'effect.dismissal_change.void', 'effect.notification.written', 'effect.notification.written']);
  // Early dismissal on Friday: the active change stays active and the cut-off moves from 13:40 to 11:00.
  const g = fixture();
  const fri = set(g, {person_id: 'person-rosa'});
  g.event(ev('school.day_changed', '2026-11-18T13:05:00-08:00', {school_id: 'school-alder', date: '2026-11-20', kind: 'early_dismissal', dismissal_local: '12:30', reason: 'Staff training'}));
  const note = g.data.notifications.at(-1);
  assert.match(note.body, /dismiss at 12:30 on Friday, November 20 \(usually 15:10\)/);
  assert.match(note.body, new RegExp('collected by Rosa Delgado \\(' + fri.id + '\\)'));
  assert.match(note.body, /until 11:00/);
  const view = g.call('bellnote.pickup.get', {id: 'child-theo', start: '2026-11-20', end: '2026-11-20'});
  assert.equal(view.dismissal_changes[0].status, 'active'); assert.equal(view.days[0].cutoff_at, '2026-11-20T11:00:00-08:00');
  g.advance('2026-11-20T10:59:00-08:00');
  set(g, {mode: 'after_care'});
  g.advance('2026-11-20T11:00:00-08:00');
  refused(g, 'bellnote.dismissal.set', {id: 'child-theo', date: '2026-11-20', mode: 'bus'}, 'too_late');
  // Phase follows the clock: past once that day's (early) dismissal time is reached.
  g.advance('2026-11-20T12:30:00-08:00');
  assert.equal(g.call('bellnote.pickup.get', {id: 'child-theo', start: '2026-11-20', end: '2026-11-20'}).dismissal_changes.at(-1).phase, 'past');
  // The dismissal-relative cut-off across the fall-back weekend: Monday 2 November resolves in PST.
  const dst = fixture({now: '2026-10-30T12:00:00-07:00'});
  assert.equal(dst.call('bellnote.dismissal.set', {id: 'child-theo', date: '2026-11-02', mode: 'after_care'}).cutoff_at, '2026-11-02T13:40:00-08:00');
  assert.equal(dst.call('bellnote.dismissal.set', {id: 'child-theo', date: '2026-10-30', mode: 'after_care'}).cutoff_at, '2026-10-30T13:40:00-07:00');
  // A closed day makes the change moot (derived) and it cannot be cancelled.
  const h = fixture();
  const m = set(h, {person_id: 'person-rosa'});
  h.event(ev('school.day_changed', '2026-11-18T13:05:00-08:00', {school_id: 'school-alder', date: '2026-11-20', kind: 'closed', reason: 'Power outage'}));
  assert.equal(h.call('bellnote.pickup.get', {id: 'child-theo', start: '2026-11-20', end: '2026-11-20'}).dismissal_changes[0].status, 'moot');
  assert.equal(h.data.dismissal_changes.find(d => d.id === m.id).status, 'active', 'moot is never stored');
  refused(h, 'bellnote.dismissal.cancel', {id: m.id}, 'invalid_state');
});
