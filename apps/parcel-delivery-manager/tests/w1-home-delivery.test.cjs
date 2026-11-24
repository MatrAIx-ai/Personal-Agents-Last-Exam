'use strict';
// W1 — Change home delivery: reschedule, address change and temporary hold, with the
// carrier's asynchronous decision. Fixture clock: 2026-03-02T14:00Z (09:00 in Toronto).
// S001: home delivery planned for 2026-03-04, standard policy (12 h cutoff = 03-03T17:00Z).
const test = require('node:test');
const assert = require('node:assert/strict');
const {fixture, rejects, ev, submit, decide} = require('./harness.cjs');

const get = (f, id) => f.call('shipments.get', {id}).shipment;
const preview = (f, id, change) => f.call('change.preview', {id, ...change}).preview;
const reschedule = day => ({kind: 'reschedule', delivery_date: day});

test('W1 options list what the policy allows without changing state', () => {
  const f = fixture(), before = f.data;
  const standard = f.call('options.get', {id: 'S001'}).options;
  assert.equal(standard.cutoff_at, '2026-03-03T17:00:00.000Z');
  assert.deepEqual(standard.reschedule, {allowed: true, reason: null, earliest_date: '2026-03-05', latest_date: '2026-03-09'});
  assert.deepEqual(standard.address.address_ids, ['addr-maya-work'], 'Only verified, unrestricted, different addresses of the recipient');
  assert.deepEqual(standard.redirect.point_ids, ['P01', 'P02', 'P03']);
  assert.equal(standard.home_delivery.reason, 'not_applicable');
  const signature = f.call('options.get', {id: 'S003'}).options;
  assert.equal(signature.address.reason, 'not_permitted');
  assert.equal(signature.hold.reason, 'not_permitted');
  assert.deepEqual(signature.redirect.point_ids, ['P01', 'P03'], 'Signature parcels cannot go to a locker');
  assert.deepEqual(f.data, before);
});

test('W1 reschedule: pending until the carrier applies it, then delivered by a trusted event', () => {
  const f = fixture();
  const id = submit(f, 'S001', reschedule('2026-03-06'));
  let s = get(f, 'S001');
  assert.equal(s.plan.delivery_date, '2026-03-04', 'A submitted request does not change the plan');
  assert.equal(s.plan.revision, 1);
  assert.equal(s.pending_change.status, 'pending');
  assert.equal(preview(f, 'S001', reschedule('2026-03-07')).reason, 'change_pending');
  rejects(f, () => f.call('change.submit', {id: 'S001', ...reschedule('2026-03-07'), confirmation: 'cf-any'}), 'change_pending');

  decide(f, '2026-03-02T16:00:00Z', 'S001', id, 1);
  s = get(f, 'S001');
  assert.deepEqual(s.plan, {revision: 2, mode: 'home', address_id: 'addr-maya-home', point_id: null, delivery_date: '2026-03-06', hold_until: null});
  assert.equal(s.pending_change, null);
  assert.equal(s.status, 'in_transit', 'Applying a change is not delivery');
  assert.equal(f.call('changes.list', {shipment_id: 'S001'}).items[0].status, 'applied');
  assert.equal(f.call('notices.list', {shipment_id: 'S001'}).items.at(-1).type, 'change_applied');

  // Events for the superseded plan cannot move the parcel.
  rejects(f, () => f.event(ev('delivered', '2026-03-04T15:00:00Z', {shipment_id: 'S001', plan_revision: 1})), 'invalid_event', /superseded/);
  f.event(ev('transit_update', '2026-03-06T13:00:00Z', {shipment_id: 'S001', plan_revision: 2, status: 'out_for_delivery', estimated_delivery: '2026-03-06'}));
  assert.equal(preview(f, 'S001', reschedule('2026-03-08')).reason, 'out_for_delivery');
  f.event(ev('delivered', '2026-03-06T15:00:00Z', {shipment_id: 'S001', plan_revision: 2}));
  s = get(f, 'S001');
  assert.equal(s.status, 'delivered');
  assert.equal(s.completed_at, '2026-03-06T15:00:00Z');
  // A terminal outcome cannot be reopened.
  rejects(f, () => f.event(ev('transit_update', '2026-03-06T16:00:00Z', {shipment_id: 'S001', plan_revision: 2, status: 'in_transit', estimated_delivery: null})), 'invalid_event', /terminal/);
  rejects(f, () => f.event(ev('delivery_failed', '2026-03-06T16:00:00Z', {shipment_id: 'S001', plan_revision: 2, reason: 'Late report.'})), 'invalid_event');
  assert.equal(preview(f, 'S001', reschedule('2026-03-08')).reason, 'parcel_closed');
});

test('W1 a stale or mismatched confirmation is rejected without partial changes', () => {
  const f = fixture();
  const first = preview(f, 'S001', reschedule('2026-03-06'));
  rejects(f, () => f.call('change.submit', {id: 'S001', ...reschedule('2026-03-06'), confirmation: 'cf-000000000000000000000000'}), 'stale_confirmation');
  rejects(f, () => f.call('change.submit', {id: 'S001', ...reschedule('2026-03-07'), confirmation: first.confirmation}), 'stale_confirmation');
  // The parcel changes after the preview.
  f.event(require('../examples/scenario.json'));
  rejects(f, () => f.call('change.submit', {id: 'S001', ...reschedule('2026-03-06'), confirmation: first.confirmation}), 'stale_confirmation');
  const fresh = preview(f, 'S001', reschedule('2026-03-06'));
  assert.notEqual(fresh.confirmation, first.confirmation);
  assert.equal(f.call('change.submit', {id: 'S001', ...reschedule('2026-03-06'), confirmation: fresh.confirmation}).change_status, 'pending');
});

test('W1 change cutoff: the last second is allowed, the cutoff instant is not', () => {
  const f = fixture();
  const early = preview(f, 'S001', reschedule('2026-03-06'));
  f.advance('2026-03-03T16:59:59Z');
  assert.equal(preview(f, 'S001', reschedule('2026-03-06')).allowed, true);
  f.advance('2026-03-03T17:00:00Z');
  assert.equal(preview(f, 'S001', reschedule('2026-03-06')).reason, 'cutoff_passed');
  // Time alone does not change the parcel, so the old confirmation still matches; the cutoff still blocks it.
  rejects(f, () => f.call('change.submit', {id: 'S001', ...reschedule('2026-03-06'), confirmation: early.confirmation}), 'cutoff_passed');
  assert.equal(f.call('options.get', {id: 'S001'}).options.redirect.reason, 'cutoff_passed');
});

test('W1 destination, date and argument rules', () => {
  const f = fixture();
  const reason = change => preview(f, 'S001', change).reason;
  assert.equal(reason({kind: 'address', address_id: 'addr-maya-pobox'}), 'restricted_destination');
  assert.equal(reason({kind: 'address', address_id: 'addr-maya-cottage'}), 'address_not_verified');
  assert.equal(reason({kind: 'address', address_id: 'addr-alex-home'}), 'unknown_address', 'Another person\'s address is not revealed');
  assert.equal(reason({kind: 'address', address_id: 'addr-nowhere'}), 'unknown_address');
  assert.equal(reason({kind: 'address', address_id: 'addr-maya-home'}), 'no_change');
  assert.equal(reason(reschedule('2026-03-04')), 'no_change');
  assert.equal(reason(reschedule('2026-03-03')), 'date_out_of_range', 'Cannot move a delivery earlier');
  assert.equal(reason(reschedule('2026-03-10')), 'date_out_of_range');
  assert.equal(reason({kind: 'hold', hold_until: '2026-03-10'}), 'date_out_of_range');
  assert.equal(reason({kind: 'home_delivery', address_id: 'addr-maya-work'}), 'not_applicable');
  assert.equal(preview(f, 'S003', {kind: 'address', address_id: 'addr-maya-work'}).reason, 'not_permitted');
  assert.equal(preview(f, 'S003', {kind: 'hold', hold_until: '2026-03-05'}).reason, 'not_permitted');
  rejects(f, () => preview(f, 'S001', {kind: 'reschedule'}), 'invalid_arguments');
  rejects(f, () => preview(f, 'S001', {kind: 'reschedule', delivery_date: '2026-03-06', point_id: 'P01'}), 'invalid_arguments');
  rejects(f, () => preview(f, 'S001', reschedule('2026-02-30')), 'invalid_arguments');
  rejects(f, () => f.call('change.submit', {id: 'S001', kind: 'address', address_id: 'addr-maya-pobox', confirmation: 'cf-any'}), 'restricted_destination');

  // A verified address of the recipient is accepted and keeps the planned date.
  const id = submit(f, 'S001', {kind: 'address', address_id: 'addr-maya-work'});
  decide(f, '2026-03-02T15:00:00Z', 'S001', id, 1);
  assert.deepEqual(get(f, 'S001').plan, {revision: 2, mode: 'home', address_id: 'addr-maya-work', point_id: null, delivery_date: '2026-03-04', hold_until: null});
});

test('W1 cancel first: a later approval cannot apply', () => {
  const f = fixture();
  const id = submit(f, 'S001', reschedule('2026-03-06'));
  assert.equal(f.call('change.cancel', {id}).change_status, 'cancelled');
  assert.equal(get(f, 'S001').pending_change, null);
  rejects(f, () => decide(f, '2026-03-02T16:00:00Z', 'S001', id, 1), 'invalid_event', /already cancelled/);
  rejects(f, () => decide(f, '2026-03-02T16:00:00Z', 'S001', id, 1, 'rejected', 'Too late.'), 'invalid_event', /already cancelled/);
  rejects(f, () => f.call('change.cancel', {id}), 'too_late');
  assert.equal(get(f, 'S001').plan.revision, 1);
  // The parcel is free for a new request.
  assert.equal(submit(f, 'S001', reschedule('2026-03-07')), 'C003');
});

test('W1 apply first: cancellation is too late and cannot reverse the plan', () => {
  const f = fixture();
  const id = submit(f, 'S001', reschedule('2026-03-06'));
  decide(f, '2026-03-02T16:00:00Z', 'S001', id, 1);
  rejects(f, () => f.call('change.cancel', {id}), 'too_late');
  assert.equal(get(f, 'S001').plan.delivery_date, '2026-03-06');
  // Revising the applied plan takes a new request against the new revision.
  const second = submit(f, 'S001', reschedule('2026-03-07'));
  rejects(f, () => decide(f, '2026-03-02T17:00:00Z', 'S001', second, 1), 'invalid_event', /different plan revision/);
  decide(f, '2026-03-02T17:00:00Z', 'S001', second, 2);
  assert.equal(get(f, 'S001').plan.revision, 3);
});

test('W1 a rejected request keeps the prior plan and gives a reason', () => {
  const f = fixture();
  const id = submit(f, 'S001', reschedule('2026-03-06'));
  rejects(f, () => decide(f, '2026-03-02T16:00:00Z', 'S001', id, 1, 'rejected', null), 'invalid_event');
  decide(f, '2026-03-02T16:00:00Z', 'S001', id, 1, 'rejected', 'No delivery capacity on that day.');
  const s = get(f, 'S001'), change = f.call('changes.list', {shipment_id: 'S001'}).items[0];
  assert.equal(s.plan.revision, 1);
  assert.equal(s.plan.delivery_date, '2026-03-04');
  assert.equal(change.status, 'rejected');
  assert.equal(change.reason, 'No delivery capacity on that day.');
  assert.equal(f.call('notices.list', {shipment_id: 'S001'}).items.at(-1).type, 'change_rejected');
  rejects(f, () => decide(f, '2026-03-02T17:00:00Z', 'S001', id, 1), 'invalid_event');
  assert.equal(preview(f, 'S001', reschedule('2026-03-07')).allowed, true);
});

test('W1 decisions must name the right request and plan revision', () => {
  const f = fixture();
  const id = submit(f, 'S001', reschedule('2026-03-06'));
  rejects(f, () => decide(f, '2026-03-02T16:00:00Z', 'S001', 'C999', 1), 'invalid_event');
  rejects(f, () => decide(f, '2026-03-02T16:00:00Z', 'S003', id, 1), 'invalid_event');
  rejects(f, () => decide(f, '2026-03-02T16:00:00Z', 'S001', id, 2), 'invalid_event');
  rejects(f, () => decide(f, '2026-03-02T16:00:00Z', 'S001', 'C001', 1), 'invalid_event');
});

test('W1 hold: ending it resumes delivery but never delivers the parcel', () => {
  const f = fixture();
  const id = submit(f, 'S001', {kind: 'hold', hold_until: '2026-03-08'});
  decide(f, '2026-03-02T16:00:00Z', 'S001', id, 1);
  let s = get(f, 'S001');
  assert.deepEqual(s.plan, {revision: 2, mode: 'hold', address_id: 'addr-maya-home', point_id: null, delivery_date: null, hold_until: '2026-03-08'});
  // Hold ends at the start of 03-08 in the carrier's zone (Toronto, UTC-5 before DST starts that day).
  assert.deepEqual(s.deadlines, [{kind: 'hold_end', at: '2026-03-08T05:00:00.000Z', passed: false}]);
  rejects(f, () => f.event(ev('delivered', '2026-03-05T15:00:00Z', {shipment_id: 'S001', plan_revision: 2})), 'invalid_event');
  rejects(f, () => f.event(ev('transit_update', '2026-03-05T15:00:00Z', {shipment_id: 'S001', plan_revision: 2, status: 'out_for_delivery', estimated_delivery: null})), 'invalid_event');
  rejects(f, () => f.event(ev('deadline_reached', '2026-03-08T04:59:59Z', {shipment_id: 'S001', deadline: 'hold_end'})), 'invalid_event', /not ended yet/);
  const options = f.call('options.get', {id: 'S001'}).options;
  assert.equal(options.reschedule.reason, 'not_applicable');
  assert.equal(options.hold.allowed, true);
  assert.equal(options.home_delivery.allowed, true);

  // The clock passes the hold end before its event arrives: nothing is written, changes are blocked.
  f.advance('2026-03-08T06:00:00Z');
  const before = f.data;
  s = get(f, 'S001');
  assert.equal(s.plan.mode, 'hold');
  assert.equal(s.deadlines[0].passed, true);
  assert.equal(preview(f, 'S001', {kind: 'redirect', point_id: 'P01'}).reason, 'cutoff_passed');
  assert.deepEqual(f.data, before);

  f.event(ev('deadline_reached', '2026-03-08T06:00:00Z', {shipment_id: 'S001', deadline: 'hold_end'}));
  s = get(f, 'S001');
  assert.deepEqual(s.plan, {revision: 3, mode: 'home', address_id: 'addr-maya-home', point_id: null, delivery_date: null, hold_until: null});
  assert.equal(s.status, 'in_transit');
  assert.equal(s.completed_at, null);
  assert.equal(f.call('notices.list', {shipment_id: 'S001'}).items.at(-1).type, 'hold_ended');
  rejects(f, () => f.event(ev('deadline_reached', '2026-03-08T07:00:00Z', {shipment_id: 'S001', deadline: 'hold_end'})), 'invalid_event');
  assert.equal(preview(f, 'S001', reschedule('2026-03-10')).allowed, true, 'Delivery can be planned again');
  f.event(ev('delivered', '2026-03-09T15:00:00Z', {shipment_id: 'S001', plan_revision: 3}));
  assert.equal(get(f, 'S001').status, 'delivered');
});

test('W1 a hold can be ended early, and a request still pending at hold end is closed', () => {
  const early = fixture();
  decide(early, '2026-03-02T16:00:00Z', 'S001', submit(early, 'S001', {kind: 'hold', hold_until: '2026-03-08'}), 1);
  decide(early, '2026-03-03T16:00:00Z', 'S001', submit(early, 'S001', {kind: 'home_delivery', address_id: 'addr-maya-home', delivery_date: '2026-03-05'}), 2);
  assert.deepEqual(get(early, 'S001').plan, {revision: 3, mode: 'home', address_id: 'addr-maya-home', point_id: null, delivery_date: '2026-03-05', hold_until: null});

  const f = fixture();
  decide(f, '2026-03-02T16:00:00Z', 'S001', submit(f, 'S001', {kind: 'hold', hold_until: '2026-03-08'}), 1);
  const pending = submit(f, 'S001', {kind: 'redirect', point_id: 'P01'});
  f.event(ev('deadline_reached', '2026-03-08T06:00:00Z', {shipment_id: 'S001', deadline: 'hold_end'}));
  const change = f.call('changes.list', {shipment_id: 'S001'}).items.find(x => x.id === pending);
  assert.equal(change.status, 'rejected');
  assert.match(change.reason, /hold ended/);
  assert.equal(get(f, 'S001').pending_change, null);
  // The old request can no longer be applied over the newer plan.
  rejects(f, () => decide(f, '2026-03-08T07:00:00Z', 'S001', pending, 2), 'invalid_event');
});

test('W1 failed delivery: redelivery can be requested until the action deadline', () => {
  const f = fixture();
  f.event(ev('transit_update', '2026-03-04T13:00:00Z', {shipment_id: 'S001', plan_revision: 1, status: 'out_for_delivery', estimated_delivery: '2026-03-04'}));
  f.event(ev('delivery_failed', '2026-03-04T20:00:00Z', {shipment_id: 'S001', plan_revision: 1, reason: 'Nobody was available to receive the parcel.'}));
  let s = get(f, 'S001');
  assert.equal(s.status, 'attempt_failed');
  assert.deepEqual(s.deadlines, [{kind: 'failure_action', at: '2026-03-06T20:00:00.000Z', passed: false}]);
  rejects(f, () => f.event(ev('delivered', '2026-03-04T21:00:00Z', {shipment_id: 'S001', plan_revision: 1})), 'invalid_event');
  const options = f.call('options.get', {id: 'S001'}).options;
  assert.equal(options.cutoff_at, '2026-03-06T20:00:00.000Z');
  assert.equal(options.reschedule.earliest_date, '2026-03-05');
  const id = submit(f, 'S001', reschedule('2026-03-06'));
  decide(f, '2026-03-04T22:00:00Z', 'S001', id, 1);
  s = get(f, 'S001');
  assert.equal(s.status, 'in_transit');
  assert.equal(s.attempt, null);
  assert.equal(s.plan.delivery_date, '2026-03-06');

  // Without a request, the deadline passing by the clock blocks changes but writes nothing.
  const late = fixture();
  late.event(ev('delivery_failed', '2026-03-04T20:00:00Z', {shipment_id: 'S001', plan_revision: 1, reason: 'Nobody was available to receive the parcel.'}));
  late.advance('2026-03-06T20:00:00Z');
  assert.equal(preview(late, 'S001', reschedule('2026-03-08')).reason, 'deadline_passed');
  assert.equal(get(late, 'S001').status, 'attempt_failed');
});
