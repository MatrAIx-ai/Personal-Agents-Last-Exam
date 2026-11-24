'use strict';
// W4 — Recover from failure or expiry. Fixture clock: 2026-03-02T14:00Z.
// S001: home delivery planned for 2026-03-04 (48 h to act after a failed attempt).
// S002: ready at P01 until 2026-03-04T15:00Z. Recovery reuses the W1/W2/W3 operations;
// if the applicable deadline expires, a trusted event starts the return and another completes it.
const test = require('node:test');
const assert = require('node:assert/strict');
const {fixture, rejects, ev, submit, decide, authorize, actAs} = require('./harness.cjs');

const get = (f, id) => f.call('shipments.get', {id}).shipment;
const preview = (f, id, change) => f.call('change.preview', {id, ...change}).preview;
const failed = (f, at = '2026-03-04T20:00:00Z') => f.event(ev('delivery_failed', at, {shipment_id: 'S001', plan_revision: 1, reason: 'Nobody was available to receive the parcel.'}));
const deadline = (at, shipment_id, kind) => ev('deadline_reached', at, {shipment_id, deadline: kind});
const collect = (at, fields = {}) => ev('collected', at, {shipment_id: 'S002', point_id: 'P01', pickup_epoch: 1, collector_person_id: 'person-maya', pass_code: 'K7QM-4R2X', ...fields});

test('W4 a failed delivery shows its reason, deadline and next actions', () => {
  const f = fixture();
  failed(f);
  const s = get(f, 'S001');
  assert.equal(s.status, 'attempt_failed');
  assert.deepEqual(s.attempt, {at: '2026-03-04T20:00:00Z', reason: 'Nobody was available to receive the parcel.', action_deadline: '2026-03-06T20:00:00.000Z'});
  assert.deepEqual(s.deadlines, [{kind: 'failure_action', at: '2026-03-06T20:00:00.000Z', passed: false}]);
  assert.match(s.timeline.at(-1).summary, /Delivery attempt failed: Nobody was available.*by 2026-03-06T20:00:00.000Z, or the parcel will be returned/);
  const notice = f.call('notices.list', {shipment_id: 'S001'}).items.at(-1);
  assert.equal(notice.type, 'delivery_failed');
  const options = f.call('options.get', {id: 'S001'}).options;
  assert.equal(options.cutoff_at, '2026-03-06T20:00:00.000Z');
  assert.deepEqual([options.reschedule.allowed, options.hold.allowed, options.redirect.allowed, options.address.allowed], [true, true, true, true]);
  assert.equal(f.call('shipments.list').items.find(x => x.id === 'S001').deadline_passed, false);
});

test('W4 recovery by redelivery completes through W1', () => {
  const f = fixture();
  failed(f);
  decide(f, '2026-03-04T22:00:00Z', 'S001', submit(f, 'S001', {kind: 'reschedule', delivery_date: '2026-03-06'}), 1);
  let s = get(f, 'S001');
  assert.deepEqual([s.status, s.attempt, s.plan.revision, s.plan.delivery_date], ['in_transit', null, 2, '2026-03-06']);
  assert.ok(s.timeline.some(x => x.kind === 'delivery_failed'), 'The failure stays in the timeline');
  // The old failure deadline no longer applies to the recovered parcel.
  rejects(f, () => f.event(deadline('2026-03-06T20:00:00Z', 'S001', 'failure_action')), 'invalid_event', /no failed delivery/);
  f.event(ev('delivered', '2026-03-06T16:00:00Z', {shipment_id: 'S001', plan_revision: 2}));
  s = get(f, 'S001');
  assert.deepEqual([s.status, s.completed_at], ['delivered', '2026-03-06T16:00:00Z']);
});

test('W4 recovery by pickup redirect completes through W2 and W3', () => {
  const f = fixture();
  failed(f);
  decide(f, '2026-03-04T22:00:00Z', 'S001', submit(f, 'S001', {kind: 'redirect', point_id: 'P01'}), 1);
  f.event(ev('pickup_ready', '2026-03-05T15:00:00Z', {shipment_id: 'S001', plan_revision: 2, point_id: 'P01', pickup_epoch: 1}));
  assert.equal(get(f, 'S001').pickup.deadline, '2026-03-08T15:00:00.000Z');
  authorize(f, 'S001', {collector_person_id: 'person-alex', expires_at: '2026-03-07T12:00:00Z'});
  const code = f.data.passes.find(p => p.shipment_id === 'S001' && p.holder_person_id === 'person-alex').code;
  f.event(ev('collected', '2026-03-06T16:00:00Z', {shipment_id: 'S001', point_id: 'P01', pickup_epoch: 1, collector_person_id: 'person-alex', pass_code: code}));
  assert.equal(get(f, 'S001').status, 'collected');
});

test('W4 recovery by hold completes after the hold ends', () => {
  const f = fixture();
  failed(f);
  decide(f, '2026-03-04T22:00:00Z', 'S001', submit(f, 'S001', {kind: 'hold', hold_until: '2026-03-09'}), 1);
  assert.deepEqual([get(f, 'S001').status, get(f, 'S001').plan.mode], ['in_transit', 'hold']);
  f.event(deadline('2026-03-09T04:00:00Z', 'S001', 'hold_end')); // 03-09 00:00 in Toronto after the DST change
  f.event(ev('delivered', '2026-03-10T15:00:00Z', {shipment_id: 'S001', plan_revision: 3}));
  assert.equal(get(f, 'S001').status, 'delivered');
});

test('W4 an unanswered failed delivery: the deadline event starts the return, a later event completes it', () => {
  const f = fixture();
  failed(f);
  // The clock passes the deadline first: nothing is written and nothing can be requested.
  f.advance('2026-03-06T20:00:00Z');
  const before = f.data;
  assert.equal(get(f, 'S001').status, 'attempt_failed');
  assert.equal(get(f, 'S001').deadlines[0].passed, true);
  assert.equal(f.call('shipments.list').items.find(x => x.id === 'S001').deadline_passed, true);
  assert.equal(preview(f, 'S001', {kind: 'reschedule', delivery_date: '2026-03-08'}).reason, 'deadline_passed');
  assert.deepEqual(f.data, before);

  rejects(f, () => f.event(deadline('2026-03-06T20:00:00Z', 'S001', 'pickup')), 'invalid_event', /not waiting at a pickup point/);
  f.event(deadline('2026-03-06T20:00:00Z', 'S001', 'failure_action'));
  let s = get(f, 'S001');
  assert.equal(s.status, 'returning');
  assert.equal(s.attempt, null);
  assert.deepEqual(s.return_info, {started_at: '2026-03-06T20:00:00Z', completed_at: null,
    reason: 'No delivery option was chosen by 2026-03-06T20:00:00.000Z after the failed delivery attempt (Nobody was available to receive the parcel.).'});
  assert.equal(s.completed_at, null, 'Expiry starts the return; it does not fabricate the physical return');
  assert.deepEqual(s.deadlines, []);
  assert.equal(f.call('notices.list', {shipment_id: 'S001'}).items.at(-1).type, 'return_started');

  // A returning parcel rejects recipient changes and every event except return completion.
  for (const kind of ['reschedule', 'address', 'hold', 'redirect', 'home_delivery']) assert.equal(f.call('options.get', {id: 'S001'}).options[kind].reason, 'return_started');
  assert.equal(f.call('options.get', {id: 'S001'}).options.delegation.reason, 'return_started');
  assert.equal(preview(f, 'S001', {kind: 'redirect', point_id: 'P01'}).reason, 'return_started');
  rejects(f, () => f.call('change.submit', {id: 'S001', kind: 'redirect', point_id: 'P01', confirmation: 'cf-any'}), 'return_started');
  rejects(f, () => f.call('grant.create', {id: 'S001', collector_person_id: 'person-alex', expires_at: '2026-03-07T12:00:00Z', confirmation: 'cf-any'}), 'return_started');
  for (const event of [
    ev('delivered', '2026-03-07T15:00:00Z', {shipment_id: 'S001', plan_revision: 1}),
    ev('transit_update', '2026-03-07T15:00:00Z', {shipment_id: 'S001', plan_revision: 1, status: 'out_for_delivery', estimated_delivery: null}),
    ev('delivery_failed', '2026-03-07T15:00:00Z', {shipment_id: 'S001', plan_revision: 1, reason: 'Again.'}),
    ev('pickup_ready', '2026-03-07T15:00:00Z', {shipment_id: 'S001', plan_revision: 1, point_id: 'P01', pickup_epoch: 1}),
    deadline('2026-03-07T15:00:00Z', 'S001', 'failure_action')
  ]) rejects(f, () => f.event(event), 'invalid_event', /only return completion/);

  f.event(ev('return_completed', '2026-03-09T15:00:00Z', {shipment_id: 'S001'}));
  s = get(f, 'S001');
  assert.deepEqual([s.status, s.completed_at, s.return_info.completed_at], ['returned', '2026-03-09T15:00:00Z', '2026-03-09T15:00:00Z']);
  assert.match(s.return_info.reason, /Nobody was available/, 'The failure reason remains visible on the terminal record');
  assert.equal(f.call('notices.list', {shipment_id: 'S001'}).items.at(-1).type, 'returned');
  rejects(f, () => f.event(ev('return_completed', '2026-03-09T16:00:00Z', {shipment_id: 'S001'})), 'invalid_event', /terminal/);
  assert.equal(preview(f, 'S001', {kind: 'redirect', point_id: 'P01'}).reason, 'parcel_closed');
  assert.equal(f.call('shipments.list').items.some(x => x.id === 'S001'), false);
  assert.equal(f.call('shipments.list', {include_closed: true}).items.find(x => x.id === 'S001').status, 'returned');
});

test('W4 deadline events are rejected before their deadline and for the wrong parcel state', () => {
  const f = fixture();
  failed(f);
  rejects(f, () => f.event(deadline('2026-03-06T19:59:59Z', 'S001', 'failure_action')), 'invalid_event', /not been reached/);
  rejects(f, () => f.event(deadline('2026-03-06T20:00:00Z', 'S002', 'failure_action')), 'invalid_event', /no failed delivery/);
  rejects(f, () => f.event(deadline('2026-03-06T20:00:00Z', 'S003', 'pickup')), 'invalid_event', /not waiting at a pickup point/);
  rejects(f, () => f.event(deadline('2026-03-06T20:00:00Z', 'S003', 'hold_end')), 'invalid_event', /not on hold/);
  rejects(f, () => f.event(ev('return_completed', '2026-03-06T20:00:00Z', {shipment_id: 'S003'})), 'invalid_event', /not being returned/);
  const early = fixture();
  rejects(early, () => early.event(deadline('2026-03-04T14:59:59Z', 'S002', 'pickup')), 'invalid_event', /not been reached/);
});

test('W4 a request still pending at the deadline is closed with return_started', () => {
  const f = fixture();
  failed(f);
  const pending = submit(f, 'S001', {kind: 'reschedule', delivery_date: '2026-03-06'});
  f.event(deadline('2026-03-06T20:00:00Z', 'S001', 'failure_action'));
  const change = f.call('changes.list', {shipment_id: 'S001'}).items.find(x => x.id === pending);
  assert.equal(change.status, 'rejected');
  assert.match(change.reason, /^return_started: /);
  assert.equal(get(f, 'S001').pending_change, null);
  rejects(f, () => decide(f, '2026-03-06T21:00:00Z', 'S001', pending, 1), 'invalid_event', /only return completion/);
  rejects(f, () => f.call('change.cancel', {id: pending}), 'too_late');
});

test('W4 pickup expiry: passes and authorizations end, the parcel returns', () => {
  const f = fixture();
  authorize(f, 'S002', {collector_person_id: 'person-alex', expires_at: '2026-03-04T15:00:00Z'});
  const alexCode = f.data.passes.find(p => p.holder_person_id === 'person-alex').code;
  const pending = submit(f, 'S002', {kind: 'redirect', point_id: 'P03'});
  f.event(deadline('2026-03-04T15:00:00Z', 'S002', 'pickup'));
  const s = get(f, 'S002');
  assert.equal(s.status, 'returning');
  assert.equal(s.pickup, null);
  assert.match(s.return_info.reason, /not collected from Larchmere Pharmacy counter by the pickup deadline 2026-03-04T15:00:00Z/);
  assert.deepEqual(f.data.passes.map(p => [p.status, p.end_reason]), [['invalidated', 'return_started'], ['invalidated', 'return_started']]);
  assert.deepEqual(f.call('grants.list', {shipment_id: 'S002'}).items.map(g => [g.status, g.valid_now, g.end_reason]), [['invalidated', false, 'return_started']]);
  assert.match(f.call('changes.list', {shipment_id: 'S002'}).items.find(x => x.id === pending).reason, /^return_started: /);
  rejects(f, () => f.call('pass.get', {id: 'S002'}), 'not_available');
  rejects(f, () => f.event(collect('2026-03-04T15:30:00Z')), 'invalid_event', /only return completion/);
  rejects(f, () => f.event(collect('2026-03-04T15:30:00Z', {collector_person_id: 'person-alex', pass_code: alexCode})), 'invalid_event', /only return completion/);
  const d = actAs(f, 'person-alex');
  assert.equal(d.call('shipments.list', {include_closed: true}).items.length, 0);
  f.event(ev('return_completed', '2026-03-07T15:00:00Z', {shipment_id: 'S002'}));
  assert.equal(get(f, 'S002').status, 'returned');
});

test('W4 point closure: reason and unchanged deadline are visible; another point completes pickup', () => {
  const f = fixture();
  f.event(ev('point_status', '2026-03-02T15:00:00Z', {point_id: 'P01', status: 'closed', note: 'Water damage; closed until further notice.'}));
  let s = get(f, 'S002');
  assert.deepEqual([s.point.id, s.point.status, s.point.status_note], ['P01', 'closed', 'Water damage; closed until further notice.']);
  assert.deepEqual(s.deadlines, [{kind: 'pickup', at: '2026-03-04T15:00:00Z', passed: false}], 'A closure alone does not extend the deadline');
  const options = f.call('options.get', {id: 'S002'}).options;
  assert.deepEqual(options.redirect.point_ids, ['P02', 'P03']);
  assert.equal(options.home_delivery.allowed, true);
  decide(f, '2026-03-02T17:00:00Z', 'S002', submit(f, 'S002', {kind: 'redirect', point_id: 'P03'}), 2);
  f.event(ev('pickup_ready', '2026-03-03T14:00:00Z', {shipment_id: 'S002', plan_revision: 3, point_id: 'P03', pickup_epoch: 2}));
  s = get(f, 'S002');
  assert.deepEqual([s.pickup.point_id, s.pickup.epoch, s.pickup.deadline, s.point.status], ['P03', 2, '2026-03-06T14:00:00.000Z', 'open']);
  // The old point's deadline no longer exists; its deadline event cannot return the parcel.
  rejects(f, () => f.event(deadline('2026-03-04T15:00:00Z', 'S002', 'pickup')), 'invalid_event', /not been reached/);
  const pass = f.call('pass.get', {id: 'S002'}).pass;
  f.event(collect('2026-03-04T16:00:00Z', {point_id: 'P03', pickup_epoch: 2, pass_code: pass.code}));
  assert.equal(get(f, 'S002').status, 'collected');
});

test('W4 a point that closes while the parcel is on its way cannot receive it', () => {
  const f = fixture();
  decide(f, '2026-03-02T15:00:00Z', 'S001', submit(f, 'S001', {kind: 'redirect', point_id: 'P03'}), 1);
  f.event(ev('point_status', '2026-03-02T16:00:00Z', {point_id: 'P03', status: 'closed', note: 'Staff shortage.'}));
  assert.equal(f.call('notices.list', {shipment_id: 'S001'}).items.at(-1).type, 'point_closed');
  assert.equal(get(f, 'S001').point.status, 'closed');
  rejects(f, () => f.event(ev('pickup_ready', '2026-03-03T15:00:00Z', {shipment_id: 'S001', plan_revision: 2, point_id: 'P03', pickup_epoch: 1})), 'invalid_event', /closed pickup point cannot receive/);
  decide(f, '2026-03-02T18:00:00Z', 'S001', submit(f, 'S001', {kind: 'redirect', point_id: 'P01'}), 2);
  f.event(ev('pickup_ready', '2026-03-03T15:00:00Z', {shipment_id: 'S001', plan_revision: 3, point_id: 'P01', pickup_epoch: 1}));
  assert.equal(get(f, 'S001').status, 'at_pickup');
});

test('W4 replaying the same seed and ordered events reproduces the same outcome', () => {
  const run = () => {
    const f = fixture();
    authorize(f, 'S002', {collector_person_id: 'person-alex', expires_at: '2026-03-04T12:00:00Z'});
    const change = submit(f, 'S001', {kind: 'redirect', point_id: 'P03'});
    const events = [
      ['change_resolved', '2026-03-02T16:00:00Z', {shipment_id: 'S001', change_id: change, base_plan_revision: 1, decision: 'applied', reason: null}],
      ['pickup_ready', '2026-03-03T15:00:00Z', {shipment_id: 'S001', plan_revision: 2, point_id: 'P03', pickup_epoch: 1}],
      ['point_status', '2026-03-03T16:00:00Z', {point_id: 'P01', status: 'closed', note: null}],
      ['deadline_reached', '2026-03-04T15:00:00Z', {shipment_id: 'S002', deadline: 'pickup'}],
      ['return_completed', '2026-03-06T15:00:00Z', {shipment_id: 'S002'}]
    ];
    events.forEach(([operation, at, payload], i) => f.event({event_id: 'replay-' + i, at, operation: 'carrier.' + operation, payload}));
    return f.data;
  };
  assert.deepEqual(run(), run());
});
