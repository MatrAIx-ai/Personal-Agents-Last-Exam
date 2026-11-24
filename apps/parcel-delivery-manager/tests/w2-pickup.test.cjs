'use strict';
// W2 — Redirect to a pickup point: request, carrier decision, actual arrival, collection pass
// and trusted handoff. Fixture clock: 2026-03-02T14:00Z (09:00 in Toronto, UTC-5).
// S002 is ready at P01 (epoch 1, deadline 2026-03-04T15:00Z, pass K7QM-4R2X, plan revision 2).
// P01 is open 09:00-21:00 local every day; P03 08:00-18:00 Monday to Saturday.
const test = require('node:test');
const assert = require('node:assert/strict');
const {fixture, rejects, ev, submit, decide} = require('./harness.cjs');

const get = (f, id) => f.call('shipments.get', {id}).shipment;
const preview = (f, id, change) => f.call('change.preview', {id, ...change}).preview;
const pass = (f, id) => f.call('pass.get', {id}).pass;
const collect = (at, fields = {}) => ev('collected', at, {shipment_id: 'S002', point_id: 'P01', pickup_epoch: 1, collector_person_id: 'person-maya', pass_code: 'K7QM-4R2X', ...fields});
const ready = (at, shipment_id, plan_revision, point_id, pickup_epoch) => ev('pickup_ready', at, {shipment_id, plan_revision, point_id, pickup_epoch});
const activePasses = (f, id) => f.data.passes.filter(p => p.shipment_id === id && p.status === 'active');

test('W2 redirect: an applied redirect is not readiness; arrival starts the deadline once', () => {
  const f = fixture();
  const id = submit(f, 'S001', {kind: 'redirect', point_id: 'P03'});
  assert.equal(get(f, 'S001').plan.mode, 'home', 'Pending redirect leaves the plan alone');
  decide(f, '2026-03-02T16:00:00Z', 'S001', id, 1);
  let s = get(f, 'S001');
  assert.deepEqual(s.plan, {revision: 2, mode: 'pickup', address_id: null, point_id: 'P03', delivery_date: null, hold_until: null});
  assert.equal(s.status, 'in_transit');
  assert.equal(s.pickup, null);
  rejects(f, () => pass(f, 'S001'), 'not_available');
  assert.equal(f.call('options.get', {id: 'S001'}).options.delegation.reason, 'not_ready');
  // A home-delivery outcome no longer applies to this plan.
  rejects(f, () => f.event(ev('delivered', '2026-03-03T15:00:00Z', {shipment_id: 'S001', plan_revision: 2})), 'invalid_event');

  rejects(f, () => f.event(ready('2026-03-03T15:00:00Z', 'S001', 2, 'P01', 1)), 'invalid_event');
  rejects(f, () => f.event(ready('2026-03-03T15:00:00Z', 'S001', 1, 'P03', 1)), 'invalid_event');
  rejects(f, () => f.event(ready('2026-03-03T15:00:00Z', 'S001', 2, 'P03', 2)), 'invalid_event', /must start pickup epoch 1/);
  f.event(ready('2026-03-03T15:00:00Z', 'S001', 2, 'P03', 1));
  s = get(f, 'S001');
  assert.equal(s.status, 'at_pickup');
  assert.deepEqual(s.pickup, {point_id: 'P03', epoch: 1, ready_at: '2026-03-03T15:00:00Z', deadline: '2026-03-06T15:00:00.000Z'});
  const mine = pass(f, 'S001');
  assert.equal(mine.role, 'recipient');
  assert.equal(mine.point_name, 'Quay Street depot counter');
  assert.equal(mine.expires_at, s.pickup.deadline);
  assert.equal(mine.valid_now, true);
  assert.match(mine.code, /^[A-Z0-9]{4}-[A-Z0-9]{4}$/);
  assert.equal(f.call('notices.list', {shipment_id: 'S001'}).items.at(-1).type, 'pickup_ready');

  // A repeated arrival report, even with a new event ID, cannot extend the deadline.
  rejects(f, () => f.event(ready('2026-03-04T15:00:00Z', 'S001', 2, 'P03', 2)), 'invalid_event', /repeated arrival/);
  assert.equal(get(f, 'S001').pickup.deadline, '2026-03-06T15:00:00.000Z');
  assert.equal(activePasses(f, 'S001').length, 1);
});

test('W2 collection needs the right pass, person, point, arrival and opening hours', () => {
  const f = fixture();
  rejects(f, () => f.event(collect('2026-03-02T15:00:00Z', {pass_code: 'AAAA-BBBB'})), 'invalid_event', /No valid collection pass/);
  rejects(f, () => f.event(collect('2026-03-02T15:00:00Z', {collector_person_id: 'person-alex'})), 'invalid_event', /No valid collection pass/);
  rejects(f, () => f.event(collect('2026-03-02T15:00:00Z', {pickup_epoch: 2})), 'invalid_event', /current pickup point and arrival/);
  rejects(f, () => f.event(collect('2026-03-02T15:00:00Z', {point_id: 'P03'})), 'invalid_event', /current pickup point and arrival/);
  rejects(f, () => f.event(collect('2026-03-03T03:00:00Z')), 'invalid_event', /closed at this time/); // 22:00 local, after closing
  // Failed attempts consume nothing.
  assert.equal(pass(f, 'S002').code, 'K7QM-4R2X');

  f.event(collect('2026-03-03T15:00:00Z'));
  const s = get(f, 'S002');
  assert.equal(s.status, 'collected');
  assert.equal(s.completed_at, '2026-03-03T15:00:00Z');
  assert.equal(f.data.passes.find(p => p.id === 'PASS001').status, 'consumed');
  rejects(f, () => pass(f, 'S002'), 'not_available');
  assert.equal(f.call('notices.list', {shipment_id: 'S002'}).items.at(-1).type, 'collected');
  // A second handoff of the same parcel can never succeed.
  rejects(f, () => f.event(collect('2026-03-03T15:00:00Z')), 'invalid_event', /terminal/);
  rejects(f, () => f.event(collect('2026-03-03T16:00:00Z')), 'invalid_event', /terminal/);
});

test('W2 collection exactly at the deadline fails; one second earlier succeeds', () => {
  const late = fixture();
  rejects(late, () => late.event(collect('2026-03-04T15:00:00Z')), 'invalid_event', /deadline has passed/);
  assert.equal(get(late, 'S002').status, 'at_pickup');
  const f = fixture();
  f.event(collect('2026-03-04T14:59:59Z'));
  assert.equal(get(f, 'S002').status, 'collected');
});

test('W2 a deadline passed by the clock blocks changes and the pass, without writing state', () => {
  const f = fixture();
  f.advance('2026-03-04T15:00:00Z');
  const before = f.data;
  assert.equal(pass(f, 'S002').valid_now, false);
  assert.equal(preview(f, 'S002', {kind: 'redirect', point_id: 'P03'}).reason, 'deadline_passed');
  assert.equal(f.call('options.get', {id: 'S002'}).options.delegation.reason, 'deadline_passed');
  assert.equal(get(f, 'S002').status, 'at_pickup');
  assert.deepEqual(f.data, before);
});

test('W2 a closed point cannot hand over parcels and does not extend the deadline', () => {
  const f = fixture();
  f.event(ev('point_status', '2026-03-02T15:00:00Z', {point_id: 'P01', status: 'closed', note: 'Water damage; closed until further notice.'}));
  assert.equal(get(f, 'S002').pickup.deadline, '2026-03-04T15:00:00Z');
  const notice = f.call('notices.list', {shipment_id: 'S002'}).items.at(-1);
  assert.equal(notice.type, 'point_closed');
  assert.match(notice.message, /deadline 2026-03-04T15:00:00Z is unchanged/);
  rejects(f, () => f.event(collect('2026-03-02T16:00:00Z')), 'invalid_event', /closed at this time/);
  rejects(f, () => f.event(ev('point_status', '2026-03-02T16:00:00Z', {point_id: 'P01', status: 'closed', note: 'Water damage; closed until further notice.'})), 'invalid_event');
  // The recipient can still ask for another eligible point; the closed one is not offered.
  assert.equal(preview(f, 'S001', {kind: 'redirect', point_id: 'P01'}).reason, 'point_closed');
  assert.deepEqual(f.call('options.get', {id: 'S002'}).options.redirect.point_ids, ['P02', 'P03']);
  f.event(ev('point_status', '2026-03-03T14:00:00Z', {point_id: 'P01', status: 'open', note: null}));
  assert.equal(f.call('notices.list', {shipment_id: 'S002'}).items.at(-1).type, 'point_reopened');
  f.event(collect('2026-03-03T15:00:00Z'));
  assert.equal(get(f, 'S002').status, 'collected');
});

test('W2 the carrier cannot apply a redirect to a point that closed after the request', () => {
  const f = fixture();
  const id = submit(f, 'S001', {kind: 'redirect', point_id: 'P03'});
  f.event(ev('point_status', '2026-03-02T15:00:00Z', {point_id: 'P03', status: 'closed', note: null}));
  rejects(f, () => decide(f, '2026-03-02T16:00:00Z', 'S001', id, 1), 'invalid_event', /no longer eligible \(point_closed\)/);
  decide(f, '2026-03-02T16:00:00Z', 'S001', id, 1, 'rejected', 'The pickup point is closed.');
  assert.equal(get(f, 'S001').plan.mode, 'home');
});

test('W2 relocation: the old pass dies at once and the new one needs arrival at the new point', () => {
  const f = fixture();
  const pending = submit(f, 'S002', {kind: 'home_delivery', address_id: 'addr-maya-home'});
  rejects(f, () => f.event(ev('relocated', '2026-03-02T15:00:00Z', {shipment_id: 'S002', plan_revision: 2, to_point_id: 'P01', reason: 'No move.'})), 'invalid_event');
  f.event(ev('relocated', '2026-03-02T15:00:00Z', {shipment_id: 'S002', plan_revision: 2, to_point_id: 'P03', reason: 'The pharmacy counter is over capacity.'}));
  let s = get(f, 'S002');
  assert.deepEqual(s.plan, {revision: 3, mode: 'pickup', address_id: null, point_id: 'P03', delivery_date: null, hold_until: null});
  assert.equal(s.status, 'in_transit');
  assert.equal(s.pickup, null);
  const old = f.data.passes.find(p => p.id === 'PASS001');
  assert.equal(old.status, 'invalidated');
  assert.equal(old.end_reason, 'relocated');
  rejects(f, () => pass(f, 'S002'), 'not_available');
  assert.equal(f.call('notices.list', {shipment_id: 'S002'}).items.at(-1).type, 'relocated');
  // The request based on the old plan was closed and cannot be applied later.
  const superseded = f.call('changes.list', {shipment_id: 'S002'}).items.find(x => x.id === pending);
  assert.equal(superseded.status, 'rejected');
  assert.match(superseded.reason, /^relocated: /);
  rejects(f, () => decide(f, '2026-03-02T16:00:00Z', 'S002', pending, 2), 'invalid_event');

  // Nothing can be collected at either point until the parcel actually arrives.
  rejects(f, () => f.event(collect('2026-03-02T16:00:00Z')), 'invalid_event');
  rejects(f, () => f.event(collect('2026-03-02T16:00:00Z', {point_id: 'P03'})), 'invalid_event');
  rejects(f, () => f.event(ready('2026-03-03T14:00:00Z', 'S002', 2, 'P01', 2)), 'invalid_event');
  rejects(f, () => f.event(ready('2026-03-03T14:00:00Z', 'S002', 3, 'P01', 2)), 'invalid_event');

  rejects(f, () => f.event(ready('2026-03-03T14:00:00Z', 'S002', 3, 'P03', 1)), 'invalid_event', /must start pickup epoch 2/);
  f.event(ready('2026-03-03T14:00:00Z', 'S002', 3, 'P03', 2));
  s = get(f, 'S002');
  assert.deepEqual(s.pickup, {point_id: 'P03', epoch: 2, ready_at: '2026-03-03T14:00:00Z', deadline: '2026-03-06T14:00:00.000Z'});
  const fresh = pass(f, 'S002');
  assert.equal(fresh.pickup_epoch, 2);
  assert.notEqual(fresh.code, 'K7QM-4R2X');
  // The old code and the old arrival are useless at the new point.
  rejects(f, () => f.event(collect('2026-03-03T15:00:00Z', {point_id: 'P03', pickup_epoch: 2})), 'invalid_event', /No valid collection pass/);
  rejects(f, () => f.event(collect('2026-03-03T15:00:00Z', {point_id: 'P03', pickup_epoch: 1, pass_code: fresh.code})), 'invalid_event', /current pickup point and arrival/);
  f.event(collect('2026-03-03T15:00:00Z', {point_id: 'P03', pickup_epoch: 2, pass_code: fresh.code}));
  assert.equal(get(f, 'S002').status, 'collected');

  const closed = fixture();
  closed.event(ev('point_status', '2026-03-02T15:00:00Z', {point_id: 'P03', status: 'closed', note: null}));
  rejects(closed, () => closed.event(ev('relocated', '2026-03-02T16:00:00Z', {shipment_id: 'S002', plan_revision: 2, to_point_id: 'P03', reason: 'Move.'})), 'invalid_event');
});

test('W2 changing back to home delivery: the pass stays valid until the carrier applies it', () => {
  const f = fixture();
  assert.equal(preview(f, 'S002', {kind: 'redirect', point_id: 'P01'}).reason, 'no_change');
  assert.equal(preview(f, 'S002', {kind: 'reschedule', delivery_date: '2026-03-05'}).reason, 'not_applicable');
  const id = submit(f, 'S002', {kind: 'home_delivery', address_id: 'addr-maya-home', delivery_date: '2026-03-05'});
  assert.equal(pass(f, 'S002').valid_now, true, 'A pending request changes nothing');
  assert.equal(get(f, 'S002').status, 'at_pickup');
  decide(f, '2026-03-02T16:00:00Z', 'S002', id, 2);
  const s = get(f, 'S002');
  assert.deepEqual(s.plan, {revision: 3, mode: 'home', address_id: 'addr-maya-home', point_id: null, delivery_date: '2026-03-05', hold_until: null});
  assert.equal(s.status, 'in_transit');
  assert.equal(s.pickup, null);
  assert.equal(f.data.passes.find(p => p.id === 'PASS001').end_reason, 'plan_changed');
  rejects(f, () => pass(f, 'S002'), 'not_available');
  rejects(f, () => f.event(collect('2026-03-02T17:00:00Z')), 'invalid_event');
  rejects(f, () => f.event(ready('2026-03-02T17:00:00Z', 'S002', 2, 'P01', 2)), 'invalid_event');
  f.event(ev('delivered', '2026-03-05T16:00:00Z', {shipment_id: 'S002', plan_revision: 3}));
  assert.equal(get(f, 'S002').status, 'delivered');
});

test('W2 collecting while a change is pending closes that request', () => {
  const f = fixture();
  const id = submit(f, 'S002', {kind: 'redirect', point_id: 'P03'});
  f.event(collect('2026-03-02T15:00:00Z'));
  assert.equal(get(f, 'S002').status, 'collected');
  const change = f.call('changes.list', {shipment_id: 'S002'}).items.find(x => x.id === id);
  assert.equal(change.status, 'rejected');
  assert.match(change.reason, /^collected: /);
  rejects(f, () => decide(f, '2026-03-02T16:00:00Z', 'S002', id, 2), 'invalid_event');
});

test('W2 point directory filters and local opening hours', () => {
  const f = fixture({virtual_now: '2026-03-08T15:00:00Z'}); // Sunday 11:00 local, after the DST change
  const points = Object.fromEntries(f.call('points.list').items.map(p => [p.id, p]));
  assert.equal(points.P01.open_now, true);
  assert.equal(points.P03.open_now, false, 'Depot counter is closed on Sundays');
  assert.deepEqual(f.call('points.list', {accessible_only: true}).items.map(p => p.id), ['P01', 'P03']);
  assert.deepEqual(f.call('points.list', {query: 'locker'}).items.map(p => p.id), ['P02']);
});
