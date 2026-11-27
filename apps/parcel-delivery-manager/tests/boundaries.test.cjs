'use strict';
// Boundary values and behaviour that a mutation analysis of the business code showed no
// other test pinned down. Each test names the rule it fixes in place.
const test = require('node:test');
const assert = require('node:assert/strict');
const plugin = require('../plugin.cjs');
const {fixture, rejects, ev, submit, decide, authorize, actAs, T} = require('./harness.cjs');

const get = (f, id) => f.call('shipments.get', {id}).shipment;
const options = (f, id) => f.call('options.get', {id}).options;
const reason = (f, id, change) => f.call('change.preview', {id, ...change}).preview.reason;
const variant = mutate => { const seed = fixture().data; mutate(seed); return seed; };
const alex = until => ({collector_person_id: 'person-alex', expires_at: until});
const hold = f => decide(f, '2026-03-02T16:00:00Z', 'S001', submit(f, 'S001', {kind: 'hold', hold_until: '2026-03-08'}), 1);

test('date windows include their first and last day and nothing outside', () => {
  const f = fixture(), o = options(f, 'S001');
  assert.deepEqual([o.reschedule.earliest_date, o.reschedule.latest_date, o.hold.latest_date], ['2026-03-05', '2026-03-09', '2026-03-09']);
  const date = day => reason(f, 'S001', {kind: 'reschedule', delivery_date: day});
  assert.deepEqual([date('2026-03-05'), date('2026-03-09'), date('2026-03-10'), date('2026-03-04')], [null, null, 'date_out_of_range', 'no_change']);
  const until = day => reason(f, 'S001', {kind: 'hold', hold_until: day});
  assert.deepEqual([until('2026-03-03'), until('2026-03-09'), until('2026-03-10'), until('2026-03-02')], [null, null, 'date_out_of_range', 'date_out_of_range']);
  // A one-day window is still a window.
  const tight = fixture({seed: variant(d => { Object.assign(d.policies.find(p => p.id === 'pol-standard'), {max_reschedule_days: 1, max_hold_days: 1}); })});
  const t = options(tight, 'S001');
  assert.deepEqual([t.reschedule, t.hold], [{allowed: true, reason: null, earliest_date: '2026-03-05', latest_date: '2026-03-05'}, {allowed: true, reason: null, latest_date: '2026-03-03'}]);
});

test('bringing a parcel home: who may, to which addresses and on which dates', () => {
  // From a pickup plan it is the reverse of a redirect, so the redirect permission governs it.
  const signature = fixture();
  assert.equal(options(signature, 'S003').hold.reason, 'not_permitted', 'This profile allows redirects but not holds');
  decide(signature, '2026-03-02T15:00:00Z', 'S003', submit(signature, 'S003', {kind: 'redirect', point_id: 'P03'}), 1);
  assert.deepEqual(options(signature, 'S003').home_delivery, {allowed: true, reason: null, address_ids: ['addr-maya-home', 'addr-maya-work']});
  // From a hold it ends the hold, so the hold permission governs it, and the held address is still a choice.
  const noRedirect = fixture({seed: variant(d => { d.policies.find(p => p.id === 'pol-standard').allow_pickup_redirect = false; })});
  hold(noRedirect);
  const o = options(noRedirect, 'S001');
  assert.deepEqual([o.home_delivery.allowed, o.home_delivery.address_ids, o.redirect.reason], [true, ['addr-maya-home', 'addr-maya-work'], 'not_permitted']);
  // A date outside the window is refused here too.
  const f = fixture(), home = day => reason(f, 'S002', {kind: 'home_delivery', address_id: 'addr-maya-home', delivery_date: day});
  assert.deepEqual([home('2026-03-03'), home('2026-03-07'), home('2026-03-08'), home('2026-03-02')], [null, null, 'date_out_of_range', 'date_out_of_range']);
  // With nowhere eligible to deliver, it is not offered.
  const nowhere = fixture({seed: variant(d => { for (const a of d.addresses) if (a.person_id === 'person-maya') a.delivery_restricted = true; })});
  assert.deepEqual(options(nowhere, 'S002').home_delivery, {allowed: false, reason: 'no_eligible_destination', address_ids: []});
});

test('a hold has ended at its first instant, not after it', () => {
  const f = fixture();
  hold(f); // ends at 2026-03-08T05:00:00Z
  f.advance('2026-03-08T04:59:59Z');
  assert.equal(reason(f, 'S001', {kind: 'redirect', point_id: 'P01'}), 'cutoff_passed');
  f.advance('2026-03-08T05:00:00Z');
  assert.equal(reason(f, 'S001', {kind: 'redirect', point_id: 'P01'}), 'deadline_passed');
  assert.equal(get(f, 'S001').deadlines[0].passed, true);
  f.event(ev('deadline_reached', '2026-03-08T05:00:00Z', {shipment_id: 'S001', deadline: 'hold_end'}));
  const s = get(f, 'S001');
  assert.deepEqual([s.timeline.at(-1).kind, s.updated_at, s.estimated_delivery], ['hold_ended', '2026-03-08T05:00:00Z', null]);
});

test('a point is open from its opening minute up to, not including, its closing minute', () => {
  const open = when => fixture({virtual_now: when}).call('points.list', {query: 'P01'}).items[0].open_now; // 09:00 to 21:00 in Toronto
  assert.deepEqual([open('2026-03-02T13:59:00Z'), open('2026-03-02T14:00:00Z'), open('2026-03-03T01:59:00Z'), open('2026-03-03T02:00:00Z')], [false, true, true, false]);
  const f = fixture();
  const at = when => ev('collected', when, {shipment_id: 'S002', point_id: 'P01', pickup_epoch: 1, collector_person_id: 'person-maya', pass_code: 'K7QM-4R2X'});
  rejects(f, () => f.event(at('2026-03-03T02:00:00Z')), 'invalid_event', /closed at this time/);
  f.event(at('2026-03-03T14:00:00Z'));
  assert.equal(get(f, 'S002').status, 'collected');
});

test('estimated delivery follows the applied plan and the carrier\'s updates', () => {
  const f = fixture();
  decide(f, '2026-03-02T15:00:00Z', 'S001', submit(f, 'S001', {kind: 'reschedule', delivery_date: '2026-03-06'}), 1);
  assert.equal(get(f, 'S001').estimated_delivery, '2026-03-06');
  f.event(ev('transit_update', '2026-03-02T16:00:00Z', {shipment_id: 'S001', plan_revision: 2, status: 'in_transit', estimated_delivery: '2026-03-07'}));
  assert.equal(get(f, 'S001').estimated_delivery, '2026-03-07');
  decide(f, '2026-03-02T17:00:00Z', 'S001', submit(f, 'S001', {kind: 'redirect', point_id: 'P03'}), 2);
  assert.equal(get(f, 'S001').estimated_delivery, null, 'A pickup plan has no delivery day');
});

test('a failed delivery is recorded once, for the current home plan only', () => {
  const f = fixture();
  const failed = (when, id, revision) => ev('delivery_failed', when, {shipment_id: id, plan_revision: revision, reason: 'Nobody was available.'});
  decide(f, '2026-03-02T15:00:00Z', 'S001', submit(f, 'S001', {kind: 'reschedule', delivery_date: '2026-03-06'}), 1);
  decide(f, '2026-03-02T16:00:00Z', 'S003', submit(f, 'S003', {kind: 'redirect', point_id: 'P03'}), 1);
  rejects(f, () => f.event(failed('2026-03-04T20:00:00Z', 'S001', 1)), 'invalid_event', /superseded/);
  rejects(f, () => f.event(failed('2026-03-04T20:00:00Z', 'S002', 2)), 'invalid_event', /home address/);
  f.event(failed('2026-03-06T20:00:00Z', 'S001', 2));
  const deadline = get(f, 'S001').attempt.action_deadline;
  // A second report cannot push the action deadline back.
  rejects(f, () => f.event(failed('2026-03-07T20:00:00Z', 'S001', 2)), 'invalid_event', /home address/);
  assert.equal(get(f, 'S001').attempt.action_deadline, deadline);
  // A parcel on its way to a pickup point, or waiting at one, cannot fail a home delivery.
  rejects(f, () => f.event(failed('2026-03-07T20:00:00Z', 'S003', 2)), 'invalid_event', /home address/);
});

test('events at the same instant apply in order, and stale revisions are refused for every event kind', () => {
  const f = fixture();
  f.event(ev('transit_update', '2026-03-04T15:00:00Z', {shipment_id: 'S001', plan_revision: 1, status: 'out_for_delivery', estimated_delivery: '2026-03-04'}));
  f.event(ev('delivered', '2026-03-04T15:00:00Z', {shipment_id: 'S001', plan_revision: 1}));
  assert.equal(get(f, 'S001').status, 'delivered');
  f.event(ev('point_status', '2026-03-04T15:00:00Z', {point_id: 'P03', status: 'closed', note: null}));
  f.event(ev('point_status', '2026-03-04T15:00:00Z', {point_id: 'P03', status: 'open', note: null}));
  assert.equal(f.call('points.list', {query: 'P03'}).items[0].status, 'open');
  rejects(f, () => f.event(ev('relocated', '2026-03-04T16:00:00Z', {shipment_id: 'S002', plan_revision: 1, to_point_id: 'P03', reason: 'Old plan.'})), 'invalid_event', /superseded/);
  rejects(f, () => f.event(ev('pickup_ready', '2026-03-04T16:00:00Z', {shipment_id: 'S002', plan_revision: 1, point_id: 'P01', pickup_epoch: 2})), 'invalid_event', /superseded/);
});

test('a closure notice goes only to open parcels planned for that point and to people who may collect now', () => {
  const f = fixture();
  decide(f, '2026-03-02T15:00:00Z', 'S001', submit(f, 'S001', {kind: 'redirect', point_id: 'P01'}), 1); // on its way to P01
  const grant = authorize(f, 'S002', alex('2026-03-04T12:00:00Z'));
  f.call('grant.revoke', {id: grant.grant_id});
  const before = f.data.notices.length;
  f.event(ev('point_status', '2026-03-02T16:00:00Z', {point_id: 'P01', status: 'closed', note: 'Closed for a stock count.'}));
  const sent = f.data.notices.slice(before);
  assert.deepEqual(sent.map(n => [n.shipment_id, n.type, n.audience]).sort(), [['S001', 'point_closed', ['person-maya']], ['S002', 'point_closed', ['person-maya']]],
    'Not the home parcel S003, and not the collector whose authorization was revoked');
  // A parcel already collected or being returned gets no notice.
  const closed = fixture();
  closed.event(ev('collected', '2026-03-02T15:00:00Z', {shipment_id: 'S002', point_id: 'P01', pickup_epoch: 1, collector_person_id: 'person-maya', pass_code: 'K7QM-4R2X'}));
  const count = closed.data.notices.length;
  closed.event(ev('point_status', '2026-03-02T16:00:00Z', {point_id: 'P01', status: 'closed', note: null}));
  assert.equal(closed.data.notices.length, count);
  const returning = fixture();
  returning.event(ev('deadline_reached', '2026-03-04T15:00:00Z', {shipment_id: 'S002', deadline: 'pickup'}));
  const kept = returning.data.notices.length;
  returning.event(ev('point_status', '2026-03-04T16:00:00Z', {point_id: 'P01', status: 'closed', note: null}));
  assert.equal(returning.data.notices.length, kept);
});

test('a request the system closes is recorded like a carrier decision', () => {
  const f = fixture();
  hold(f);
  const pending = submit(f, 'S001', {kind: 'redirect', point_id: 'P01'});
  f.event(ev('deadline_reached', '2026-03-08T06:00:00Z', {shipment_id: 'S001', deadline: 'hold_end'}));
  const change = f.data.changes.find(c => c.id === pending);
  assert.deepEqual([change.status, change.decided_at, change.updated_at, change.history.at(-1)], ['rejected', '2026-03-08T06:00:00Z', '2026-03-08T06:00:00Z', {at: '2026-03-08T06:00:00Z', action: 'rejected'}]);
});

test('authorization preview reports the latest time it could run to', () => {
  const f = fixture();
  const p = fields => f.call('grant.preview', {id: 'S002', ...fields}).preview;
  assert.equal(p(alex('2026-03-04T12:00:00Z')).latest_expires_at, '2026-03-04T15:00:00.000Z');
  assert.deepEqual([p(alex('2026-03-05T12:00:00Z')).reason, p(alex('2026-03-05T12:00:00Z')).latest_expires_at], ['expiry_out_of_range', '2026-03-04T15:00:00.000Z']);
  const notReady = f.call('grant.preview', {id: 'S001', ...alex('2026-03-04T12:00:00Z')}).preview;
  assert.deepEqual([notReady.reason, notReady.latest_expires_at, notReady.point_id, notReady.expires_at], ['not_ready', null, null, null]);
});

test('a collector sees the pickup deadline and never the recipient\'s pending request', () => {
  const f = fixture();
  authorize(f, 'S002', alex('2026-03-04T12:00:00Z'));
  submit(f, 'S002', {kind: 'redirect', point_id: 'P03'});
  assert.equal(f.call('shipments.list').items.find(s => s.id === 'S002').has_pending_change, true);
  const d = actAs(f, 'person-alex');
  assert.equal(d.call('shipments.list').items[0].has_pending_change, false);
  const s = get(d, 'S002');
  assert.deepEqual([s.pending_change, s.deadlines], [null, [{kind: 'pickup', at: '2026-03-04T15:00:00Z', passed: false}]]);
});

test('parcel and pickup-point searches match what they should', () => {
  const f = fixture();
  const found = query => f.call('shipments.list', {query}).items.map(s => s.id).sort();
  assert.deepEqual([found('NL4471200019'), found('brightleaf'), found('GLASSES'), found('at_pickup'), found('S003'), found('nothing-like-this')],
    [['S001'], ['S002'], ['S003'], ['S002'], ['S003'], []]);
  assert.deepEqual(found(''), ['S001', 'S002', 'S003']);
  f.event(ev('point_status', '2026-03-02T15:00:00Z', {point_id: 'P03', status: 'closed', note: null}));
  const points = args => f.call('points.list', args).items.map(p => p.id);
  assert.deepEqual([points({}), points({open_only: true}), points({accessible_only: true}), points({open_only: true, accessible_only: true}), points({query: 'quay'})],
    [['P01', 'P02', 'P03'], ['P01', 'P02'], ['P01', 'P03'], ['P01'], ['P03']]);
});

test('every write and event leaves an identifier-only diagnostic step', () => {
  const f = fixture();
  const change = submit(f, 'S001', {kind: 'reschedule', delivery_date: '2026-03-06'});
  f.call('change.cancel', {id: change});
  const grant = authorize(f, 'S002', alex('2026-03-04T12:00:00Z'));
  f.call('grant.revoke', {id: grant.grant_id});
  f.event(ev('point_status', '2026-03-02T15:00:00Z', {point_id: 'P01', status: 'closed', note: null}));
  const steps = f.logs.map(l => l.step.split('.').pop());
  for (const step of ['change_submitted', 'change_cancelled', 'grant_created', 'grant_revoked', 'notice', 'event_prepared']) assert.ok(steps.includes(step), step);
  const logged = f.logs.find(l => l.step.endsWith('.event_prepared')).details;
  assert.deepEqual([logged.operation, logged.shipment_id], ['carrier.point_status', null]);
  assert.doesNotMatch(JSON.stringify(f.logs), /K7QM|Larchmere|Maya|Alex|NL44/);
});

test('an operation the App does not know is refused', () => {
  const f = fixture();
  assert.throws(() => plugin.handleTool(f.ctx, f.data, T('parcels.teleport'), {}), error => error.code === 'unknown_tool');
});
