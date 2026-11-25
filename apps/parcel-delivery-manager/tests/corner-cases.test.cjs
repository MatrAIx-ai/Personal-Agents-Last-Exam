'use strict';
// Corner cases: time zones and day boundaries, opening hours, options with nothing to choose,
// data a Task may supply (names, long text, odd IDs, clocks with offsets or before the
// history), people with two roles, and every rule that makes a seed incoherent.
const test = require('node:test');
const assert = require('node:assert/strict');
const plugin = require('../plugin.cjs');
const time = require('../src/time.cjs');
const {fixture, rejects, ev, submit, decide, authorize, actAs} = require('./harness.cjs');

const get = (f, id) => f.call('shipments.get', {id}).shipment;
const options = (f, id) => f.call('options.get', {id}).options;
const preview = (f, id, change) => f.call('change.preview', {id, ...change}).preview;
const at = ms => new Date(ms).toISOString();
const variant = mutate => { const seed = fixture().data; mutate(seed); return seed; };
const alexUntil = until => ({collector_person_id: 'person-alex', expires_at: until});
const ready = (f, when, id, revision, point, epoch = 1) => f.event(ev('pickup_ready', when, {shipment_id: id, plan_revision: revision, point_id: point, pickup_epoch: epoch}));

test('a calendar day starts at local midnight across daylight-saving changes and far-off zones', () => {
  const start = (day, zone) => at(time.startOfDay(day, zone));
  assert.equal(start('2026-03-08', 'America/Toronto'), '2026-03-08T05:00:00.000Z'); // clocks go forward later that day
  assert.equal(start('2026-03-09', 'America/Toronto'), '2026-03-09T04:00:00.000Z');
  assert.equal(start('2026-11-01', 'America/Toronto'), '2026-11-01T04:00:00.000Z'); // clocks go back later that day
  assert.equal(start('2026-11-02', 'America/Toronto'), '2026-11-02T05:00:00.000Z');
  assert.equal(start('2026-03-02', 'Asia/Kolkata'), '2026-03-01T18:30:00.000Z');
  assert.equal(start('2026-03-02', 'Pacific/Kiritimati'), '2026-03-01T10:00:00.000Z');
  assert.equal(start('2026-03-02', 'UTC'), '2026-03-02T00:00:00.000Z');
  assert.deepEqual([time.validDay('2028-02-29'), time.validDay('2026-02-29'), time.validDay('2026-13-01'), time.validZone('Mars/Olympus')], [true, false, false, false]);
  assert.equal(time.addDays('2026-12-31', 1), '2027-01-01');
  assert.equal(time.localDate(Date.parse('2026-03-03T03:00:00Z'), 'America/Toronto'), '2026-03-02');
});

test('service days follow the carrier time zone, not UTC', () => {
  // 03:00Z on 3 March is still 2 March in Toronto, so the week of holds counts from 2 March.
  const evening = fixture({virtual_now: '2026-03-03T03:00:00Z'});
  assert.equal(options(evening, 'S001').hold.latest_date, '2026-03-09');
  assert.equal(preview(evening, 'S001', {kind: 'hold', hold_until: '2026-03-03'}).allowed, true, 'Tomorrow, locally, is 3 March');
  // The same ledger for a carrier in Tokyo: the delivery day of 4 March starts at 15:00Z on 3 March.
  const tokyo = fixture({seed: variant(d => { d.carrier.time_zone = 'Asia/Tokyo'; })});
  assert.equal(options(tokyo, 'S001').cutoff_at, '2026-03-03T03:00:00.000Z');
});

test('a clock or event time written with a UTC offset behaves like the same instant in Z', () => {
  const f = fixture({virtual_now: '2026-03-02T09:00:00-05:00'});
  const id = submit(f, 'S001', {kind: 'redirect', point_id: 'P03'});
  f.event(ev('change_resolved', '2026-03-02T11:00:00-05:00', {shipment_id: 'S001', change_id: id, base_plan_revision: 1, decision: 'applied', reason: null}));
  ready(f, '2026-03-03T10:00:00-05:00', 'S001', 2, 'P03');
  assert.equal(get(f, 'S001').pickup.deadline, '2026-03-06T15:00:00.000Z');
  const grant = authorize(f, 'S001', {collector_person_id: 'person-alex', expires_at: '2026-03-05T12:00:00-05:00'});
  assert.equal(f.call('grants.list', {shipment_id: 'S001'}).items.find(g => g.id === grant.grant_id).valid_now, true);
  // The pickup deadline is 10:00:00-05:00 on 6 March; one second later is too long.
  const longer = until => f.call('grant.preview', {id: 'S001', collector_person_id: 'person-alex', expires_at: until, replaces_grant_id: grant.grant_id}).preview.reason;
  assert.deepEqual([longer('2026-03-06T10:00:00-05:00'), longer('2026-03-06T10:00:01-05:00')], [null, 'expiry_out_of_range']);
  const code = f.data.passes.find(p => p.holder_person_id === 'person-alex' && p.status === 'active').code;
  rejects(f, () => f.event(ev('collected', '2026-03-05T12:00:00-05:00', {shipment_id: 'S001', point_id: 'P03', pickup_epoch: 1, collector_person_id: 'person-alex', pass_code: code})), 'invalid_event', /pass has expired/);
  f.event(ev('collected', '2026-03-05T11:59:59-05:00', {shipment_id: 'S001', point_id: 'P03', pickup_epoch: 1, collector_person_id: 'person-alex', pass_code: code}));
  assert.equal(get(f, 'S001').status, 'collected');
});

test('a point open until 24:00 is open in the last minute of the day, and hours can run past midnight', () => {
  const lastMinute = fixture({virtual_now: '2026-03-03T04:59:30Z'}); // 23:59:30 in Toronto
  assert.equal(lastMinute.call('points.list', {query: 'P02'}).items[0].open_now, true);
  // Collect from the all-day locker at 23:59:30 local.
  const f = fixture();
  decide(f, '2026-03-02T15:00:00Z', 'S001', submit(f, 'S001', {kind: 'redirect', point_id: 'P02'}), 1);
  ready(f, '2026-03-02T20:00:00Z', 'S001', 2, 'P02');
  f.event(ev('collected', '2026-03-03T04:59:30Z', {shipment_id: 'S001', point_id: 'P02', pickup_epoch: 1, collector_person_id: 'person-maya', pass_code: f.call('pass.get', {id: 'S001'}).pass.code}));
  assert.equal(get(f, 'S001').status, 'collected');
  // Monday 22:00 to Tuesday 02:00, written as two entries.
  const late = variant(d => { d.pickup_points.find(p => p.id === 'P03').hours = [{weekday: 1, opens: '22:00', closes: '24:00'}, {weekday: 2, opens: '00:00', closes: '02:00'}]; });
  const open = when => fixture({seed: late, virtual_now: when}).call('points.list', {query: 'P03'}).items[0].open_now;
  assert.deepEqual([open('2026-03-03T03:30:00Z'), open('2026-03-03T05:30:00Z'), open('2026-03-03T07:30:00Z'), open('2026-03-02T23:00:00Z')], [true, true, false, false]);
  // 24:00 is only a closing time, and nothing later exists.
  for (const hours of [{weekday: 1, opens: '24:00', closes: '24:00'}, {weekday: 1, opens: '09:00', closes: '24:01'}, {weekday: 1, opens: '09:00', closes: '25:00'}]) {
    assert.throws(() => fixture({seed: variant(d => { d.pickup_points[0].hours = [hours]; })}), /Seed schema/);
  }
});

test('an option is offered only when something can be chosen for it', () => {
  const nothing = fixture({seed: variant(d => {
    Object.assign(d.policies.find(p => p.id === 'pol-standard'), {max_reschedule_days: 0, max_hold_days: 0, allowed_point_kinds: []});
    d.addresses = d.addresses.filter(a => a.id !== 'addr-maya-work');
  })});
  const o = options(nothing, 'S001');
  assert.deepEqual([o.reschedule, o.hold], [{allowed: false, reason: 'no_available_date', earliest_date: null, latest_date: null}, {allowed: false, reason: 'no_available_date', latest_date: null}]);
  assert.deepEqual([o.address, o.redirect], [{allowed: false, reason: 'no_eligible_destination', address_ids: []}, {allowed: false, reason: 'no_eligible_destination', point_ids: []}]);
  // A specific request is still judged on its own terms.
  assert.equal(preview(nothing, 'S001', {kind: 'reschedule', delivery_date: '2026-03-05'}).reason, 'date_out_of_range');
  assert.equal(preview(nothing, 'S001', {kind: 'redirect', point_id: 'P01'}).reason, 'point_not_eligible');
  // A parcel sent straight to a pickup point can still be brought home.
  const direct = fixture({seed: variant(d => { Object.assign(d.shipments.find(s => s.id === 'S001'), {plan: {revision: 1, mode: 'pickup', address_id: null, point_id: 'P03', delivery_date: null, hold_until: null}, estimated_delivery: null}); })});
  const home = options(direct, 'S001');
  assert.deepEqual([home.home_delivery.allowed, home.home_delivery.address_ids, home.reschedule.reason, home.redirect.point_ids], [true, ['addr-maya-home', 'addr-maya-work'], 'not_applicable', ['P01', 'P02']]);
});

test('names from the binding may be missing, empty or very long', () => {
  const named = name => { const binding = structuredClone(require('../fixtures/binding.json')); const alex = binding.people.find(p => p.person_id === 'person-alex'); if (name === undefined) delete alex.name; else alex.name = name; return fixture({binding}); };
  for (const [name, expected] of [['', null], ['   ', null], [undefined, null], ['A'.repeat(300), 'A'.repeat(120)], ['  Alex Rivera  ', 'Alex Rivera']]) {
    const f = named(name);
    assert.equal(f.call('collectors.list').items[0].name, expected);
    const grant = authorize(f, 'S002', {collector_person_id: 'person-alex', expires_at: '2026-03-04T12:00:00Z'});
    assert.equal(f.call('grants.list').items.find(g => g.id === grant.grant_id).collector_name, expected);
    assert.match(get(f, 'S002').timeline.at(-1).summary, expected ? /authorized to collect/ : /^person-alex authorized to collect/);
  }
});

test('the longest texts a seed and a carrier may supply still fit every record', () => {
  const f = fixture({seed: variant(d => {
    Object.assign(d.shipments.find(s => s.id === 'S001'), {contents_label: 'C'.repeat(200), sender_label: 'S'.repeat(120)});
    Object.assign(d.addresses.find(a => a.id === 'addr-maya-work'), {label: 'L'.repeat(80), line1: 'X'.repeat(200), city: 'Y'.repeat(100)});
    Object.assign(d.pickup_points.find(p => p.id === 'P03'), {name: 'N'.repeat(120), address_text: 'T'.repeat(300)});
  })});
  const reason = 'R'.repeat(300);
  decide(f, '2026-03-02T15:00:00Z', 'S001', submit(f, 'S001', {kind: 'address', address_id: 'addr-maya-work'}), 1, 'rejected', reason);
  decide(f, '2026-03-02T16:00:00Z', 'S001', submit(f, 'S001', {kind: 'address', address_id: 'addr-maya-work'}), 1);
  decide(f, '2026-03-02T17:00:00Z', 'S001', submit(f, 'S001', {kind: 'redirect', point_id: 'P03'}), 2);
  ready(f, '2026-03-03T15:00:00Z', 'S001', 3, 'P03');
  f.event(ev('point_status', '2026-03-03T16:00:00Z', {point_id: 'P03', status: 'closed', note: 'Z'.repeat(300)}));
  f.event(ev('relocated', '2026-03-03T17:00:00Z', {shipment_id: 'S001', plan_revision: 3, to_point_id: 'P01', reason}));
  f.event(ev('transit_update', '2026-03-03T18:00:00Z', {shipment_id: 'S001', plan_revision: 4, status: 'in_transit', estimated_delivery: null}));
  assert.equal(get(f, 'S001').plan.point_id, 'P01');
  const failed = fixture();
  failed.event(ev('delivery_failed', '2026-03-04T20:00:00Z', {shipment_id: 'S001', plan_revision: 1, reason: 'F'.repeat(200)}));
  failed.event(ev('deadline_reached', '2026-03-06T20:00:00Z', {shipment_id: 'S001', deadline: 'failure_action'}));
  assert.equal(get(failed, 'S001').status, 'returning');
});

test('new record IDs never collide with IDs a seed already uses', () => {
  const f = fixture({seed: variant(d => { d.changes[0].id = 'C002'; d.notices[0].id = 'N002'; d.passes[0].id = 'PASS002'; })});
  assert.equal(submit(f, 'S001', {kind: 'reschedule', delivery_date: '2026-03-06'}), 'C003');
  assert.deepEqual(authorize(f, 'S002', {collector_person_id: 'person-alex', expires_at: '2026-03-04T12:00:00Z'}), {grant_id: 'G001', pass_id: 'PASS003'});
  f.event(ev('delivery_failed', '2026-03-02T15:00:00Z', {shipment_id: 'S003', plan_revision: 1, reason: 'Nobody could sign.'}));
  assert.deepEqual(f.data.notices.map(n => n.id), ['N002', 'N003', 'N004']);
});

test('a run whose clock precedes the loaded history can read but not request anything', () => {
  const f = fixture({virtual_now: '1970-01-01T00:00:00Z'});
  assert.equal(f.call('shipments.list').items.length, 3);
  assert.equal(f.call('pass.get', {id: 'S002'}).pass.valid_now, true);
  assert.equal(preview(f, 'S001', {kind: 'reschedule', delivery_date: '2026-03-06'}).reason, 'invalid_time');
  assert.equal(options(f, 'S001').redirect.reason, 'invalid_time');
  assert.equal(f.call('grant.preview', {id: 'S002', collector_person_id: 'person-alex', expires_at: '2026-03-04T12:00:00Z'}).preview.reason, 'invalid_time');
  rejects(f, () => f.call('change.submit', {id: 'S001', kind: 'reschedule', delivery_date: '2026-03-06', confirmation: 'cf-any'}), 'invalid_time');
  rejects(f, () => f.event(ev('delivered', '1970-01-02T00:00:00Z', {shipment_id: 'S001', plan_revision: 1})), 'invalid_event', /precedes the last update/);
});

test('an empty ledger is a valid starting point', () => {
  const empty = fixture({seed: variant(d => { for (const key of ['shipments', 'changes', 'grants', 'passes', 'notices']) d[key] = []; })});
  assert.deepEqual([empty.call('shipments.list', {include_closed: true}).items, empty.call('notices.list').items, empty.call('changes.list').items, empty.call('grants.list').items], [[], [], [], []]);
  assert.equal(empty.call('points.list').items.length, 3);
  rejects(empty, () => empty.call('shipments.get', {id: 'S001'}), 'not_found');
  empty.event(ev('point_status', '2026-03-02T15:00:00Z', {point_id: 'P01', status: 'closed', note: null}));
  assert.equal(empty.data.notices.length, 0);
});

test('a request that is still pending follows the parcel through delivery, failure and dispatch', () => {
  const delivered = fixture();
  const first = submit(delivered, 'S001', {kind: 'reschedule', delivery_date: '2026-03-06'});
  delivered.event(ev('delivered', '2026-03-04T15:00:00Z', {shipment_id: 'S001', plan_revision: 1}));
  const closed = delivered.call('changes.list', {shipment_id: 'S001'}).items.find(c => c.id === first);
  assert.deepEqual([closed.status, closed.reason.split(':')[0], get(delivered, 'S001').pending_change], ['rejected', 'delivered', null]);
  rejects(delivered, () => delivered.call('change.cancel', {id: first}), 'too_late');

  // Requested before a failed attempt, applied after it: the failure is cleared.
  const failed = fixture();
  const second = submit(failed, 'S001', {kind: 'redirect', point_id: 'P03'});
  failed.event(ev('delivery_failed', '2026-03-04T20:00:00Z', {shipment_id: 'S001', plan_revision: 1, reason: 'Nobody was available.'}));
  assert.deepEqual([get(failed, 'S001').status, get(failed, 'S001').pending_change.status], ['attempt_failed', 'pending']);
  decide(failed, '2026-03-04T21:00:00Z', 'S001', second, 1);
  assert.deepEqual([get(failed, 'S001').status, get(failed, 'S001').attempt, get(failed, 'S001').plan.mode], ['in_transit', null, 'pickup']);

  // Requested in time, applied after the parcel went out: it comes back off the vehicle.
  const out = fixture();
  const third = submit(out, 'S001', {kind: 'hold', hold_until: '2026-03-08'});
  out.event(ev('transit_update', '2026-03-04T13:00:00Z', {shipment_id: 'S001', plan_revision: 1, status: 'out_for_delivery', estimated_delivery: '2026-03-04'}));
  decide(out, '2026-03-04T14:00:00Z', 'S001', third, 1);
  assert.deepEqual([get(out, 'S001').status, get(out, 'S001').plan.mode], ['in_transit', 'hold']);
});

test('the carrier can move a parcel that has not reached its pickup point yet', () => {
  const f = fixture();
  decide(f, '2026-03-02T15:00:00Z', 'S001', submit(f, 'S001', {kind: 'redirect', point_id: 'P03'}), 1);
  const pending = submit(f, 'S001', {kind: 'home_delivery', address_id: 'addr-maya-home'});
  f.event(ev('relocated', '2026-03-02T16:00:00Z', {shipment_id: 'S001', plan_revision: 2, to_point_id: 'P01', reason: 'The depot is full.'}));
  const s = get(f, 'S001');
  assert.deepEqual([s.status, s.plan.revision, s.plan.point_id, s.pending_change, f.data.passes.filter(p => p.shipment_id === 'S001').length], ['in_transit', 3, 'P01', null, 0]);
  assert.match(f.call('changes.list', {shipment_id: 'S001'}).items.find(c => c.id === pending).reason, /^relocated: /);
  rejects(f, () => ready(f, '2026-03-03T15:00:00Z', 'S001', 2, 'P03'), 'invalid_event', /superseded/);
  rejects(f, () => ready(f, '2026-03-03T15:00:00Z', 'S001', 3, 'P03'), 'invalid_event', /not planned for that pickup point/);
  ready(f, '2026-03-03T15:00:00Z', 'S001', 3, 'P01');
  assert.equal(get(f, 'S001').pickup.epoch, 1, 'The first actual arrival is epoch 1');
  rejects(f, () => f.event(ev('relocated', '2026-03-03T16:00:00Z', {shipment_id: 'S003', plan_revision: 1, to_point_id: 'P01', reason: 'x'})), 'invalid_event', /bound for or waiting at a pickup point/);
  rejects(f, () => f.event(ev('relocated', '2026-03-03T16:00:00Z', {shipment_id: 'S001', plan_revision: 3, to_point_id: 'P99', reason: 'x'})), 'not_found');
});

test('a pickup point note can change without a status change, and unknown points are refused', () => {
  const f = fixture(), notices = f.data.notices.length;
  f.event(ev('point_status', '2026-03-02T15:00:00Z', {point_id: 'P01', status: 'open', note: 'Entrance moved to the side door.'}));
  assert.equal(get(f, 'S002').point.status_note, 'Entrance moved to the side door.');
  assert.equal(f.data.notices.length, notices, 'A note alone sends no notice');
  rejects(f, () => f.event(ev('point_status', '2026-03-02T16:00:00Z', {point_id: 'P99', status: 'closed', note: null})), 'not_found');
});

test('one person can be a recipient and a collector at once, with each role kept apart', () => {
  const seed = variant(d => {
    d.shipments.push({...structuredClone(d.shipments.find(s => s.id === 'S003')), id: 'S900', tracking_number: 'NL4471200900', recipient_person_id: 'person-alex', contents_label: 'Alex\'s own parcel',
      plan: {revision: 1, mode: 'home', address_id: 'addr-alex-home', point_id: null, delivery_date: '2026-03-06', hold_until: null}});
  });
  const maya = fixture({seed});
  authorize(maya, 'S002', {collector_person_id: 'person-alex', expires_at: '2026-03-04T12:00:00Z'});
  const alex = actAs(maya, 'person-alex');
  assert.deepEqual(alex.call('shipments.list').items.map(s => [s.id, s.access]).sort(), [['S002', 'delegate'], ['S900', 'recipient']]);
  assert.equal(options(alex, 'S900').reschedule.allowed, true);
  rejects(alex, () => alex.call('options.get', {id: 'S002'}), 'not_found');
  assert.equal(submit(alex, 'S900', {kind: 'reschedule', delivery_date: '2026-03-07'}), 'C002');
  assert.deepEqual(alex.call('changes.list').items.map(c => c.shipment_id), ['S900'], 'Only requests on the person\'s own parcels');
  assert.deepEqual(alex.call('grants.list').items.map(g => [g.shipment_id, g.replaces_grant_id]), [['S002', null]]);
  rejects(alex, () => alex.call('grant.preview', {id: 'S002', collector_person_id: 'person-sam', expires_at: '2026-03-04T12:00:00Z'}), 'not_found');
  // Maya, in her own run, never sees Alex's parcel or his request.
  const back = actAs(alex, 'person-maya');
  assert.ok(!back.call('shipments.list', {include_closed: true}).items.some(s => s.id === 'S900'));
  assert.ok(!back.call('changes.list').items.some(c => c.shipment_id === 'S900'));
});

test('one collector can hold separate authorizations for two parcels', () => {
  const f = fixture();
  decide(f, '2026-03-02T15:00:00Z', 'S001', submit(f, 'S001', {kind: 'redirect', point_id: 'P01'}), 1);
  ready(f, '2026-03-02T16:00:00Z', 'S001', 2, 'P01');
  const a = authorize(f, 'S001', alexUntil('2026-03-04T12:00:00Z')), b = authorize(f, 'S002', alexUntil('2026-03-04T12:00:00Z'));
  const codes = f.data.passes.filter(p => p.holder_person_id === 'person-alex').map(p => [p.shipment_id, p.code]);
  assert.equal(new Set(codes.map(c => c[1])).size, 2, 'Each parcel has its own pass');
  assert.equal(f.call('grant.preview', {id: 'S002', ...alexUntil('2026-03-04T11:00:00Z'), replaces_grant_id: a.grant_id}).preview.reason, 'unknown_grant', 'A grant on another parcel cannot be replaced here');
  // The pass for one parcel does not open the other.
  rejects(f, () => f.event(ev('collected', '2026-03-03T15:00:00Z', {shipment_id: 'S002', point_id: 'P01', pickup_epoch: 1, collector_person_id: 'person-alex', pass_code: codes.find(c => c[0] === 'S001')[1]})), 'invalid_event', /No valid collection pass/);
  f.event(ev('collected', '2026-03-03T15:00:00Z', {shipment_id: 'S002', point_id: 'P01', pickup_epoch: 1, collector_person_id: 'person-alex', pass_code: codes.find(c => c[0] === 'S002')[1]}));
  assert.deepEqual(f.call('grants.list').items.map(g => [g.id, g.status, g.valid_now]), [[a.grant_id, 'active', true], [b.grant_id, 'consumed', false]]);
  assert.deepEqual(actAs(f, 'person-alex').call('shipments.list', {include_closed: true}).items.map(s => s.id), ['S001']);
});
test('every rule that makes a ledger incoherent is enforced when a seed is loaded', () => {
  // A ledger with a pending request and a current authorization, so every kind of record exists.
  const base = fixture();
  submit(base, 'S001', {kind: 'redirect', point_id: 'P03'});
  authorize(base, 'S002', alexUntil('2026-03-04T12:00:00Z'));
  const good = base.data;
  plugin.validateSeed(base.ctx, structuredClone(good));
  const find = (d, key, id) => d[key].find(x => x.id === id);
  const cases = [
    ['repeated tracking number', d => { d.shipments[1].tracking_number = d.shipments[0].tracking_number; }, /repeats a tracking number/],
    ['pending request on a superseded plan', d => { find(d, 'shipments', 'S001').plan.revision = 2; find(d, 'changes', 'C002').base_plan_revision = 1; }, /superseded plan/],
    ['pending request for a missing point', d => { find(d, 'changes', 'C002').target.point_id = 'P99'; }, /missing record/],
    ['pending request to another person\'s address', d => { find(d, 'changes', 'C002').target = {mode: 'home', address_id: 'addr-alex-home', point_id: null, delivery_date: null, hold_until: null}; }, /another person's address/],
    ['request based on a future revision', d => { find(d, 'changes', 'C001').base_plan_revision = 9; }, /future plan revision/],
    ['decided request without a decision time', d => { find(d, 'changes', 'C001').decided_at = null; }, /decision time/],
    ['two pending requests for one parcel', d => { d.changes.push({...structuredClone(find(d, 'changes', 'C002')), id: 'C009'}); }, /more than one pending/],
    ['pending reference that points nowhere', d => { find(d, 'shipments', 'S001').pending_change_id = null; }, /pending change reference/],
    ['request with a reversed timeline', d => { find(d, 'changes', 'C001').created_at = '2026-03-01T00:00:00Z'; }, /timestamps are reversed|history timeline/],
    ['pickup plan with an address', d => { find(d, 'shipments', 'S002').plan.address_id = 'addr-maya-home'; }, /must name only a point/],
    ['home plan without an address', d => { find(d, 'shipments', 'S001').plan.address_id = null; }, /must name only an address/],
    ['hold plan without an end', d => { find(d, 'shipments', 'S001').plan.mode = 'hold'; }, /carry hold_until/],
    ['plan to an unverified address', d => { find(d, 'shipments', 'S001').plan.address_id = 'addr-maya-cottage'; }, /verified address of its recipient/],
    ['plan to another person\'s address', d => { find(d, 'shipments', 'S001').plan.address_id = 'addr-alex-home'; }, /verified address of its recipient/],
    ['plan to a missing point', d => { find(d, 'shipments', 'S002').plan.point_id = 'P99'; }, /missing record/],
    ['unknown policy', d => { find(d, 'shipments', 'S001').policy_id = 'pol-none'; }, /missing record/],
    ['recipient outside the binding', d => { find(d, 'shipments', 'S003').recipient_person_id = 'person-nobody'; }, /binding/],
    ['ready status without a pickup record', d => { find(d, 'shipments', 'S002').pickup = null; }, /pickup readiness must match/],
    ['pickup record for another point', d => { find(d, 'shipments', 'S002').pickup.point_id = 'P03'; }, /does not match its current pickup plan/],
    ['deadline before readiness', d => { find(d, 'shipments', 'S002').pickup.deadline = '2026-03-01T14:00:00Z'; }, /deadline must follow readiness/],
    ['failed status without attempt details', d => { find(d, 'shipments', 'S001').status = 'attempt_failed'; }, /failed-delivery details/],
    ['returning status without return details', d => { find(d, 'shipments', 'S003').status = 'returning'; }, /return details/],
    ['return completed while still returning', d => { Object.assign(find(d, 'shipments', 'S003'), {status: 'returning', return_info: {started_at: '2026-03-01T18:00:00Z', reason: 'x', completed_at: '2026-03-01T19:00:00Z'}}); }, /return completion/],
    ['closed status without a completion time', d => { find(d, 'shipments', 'S003').status = 'delivered'; }, /completion time/],
    ['collected under a home plan', d => { Object.assign(find(d, 'shipments', 'S003'), {status: 'collected', completed_at: '2026-03-01T18:00:00Z'}); }, /only be collected under a pickup plan/],
    ['out for delivery under a pickup plan', d => { Object.assign(find(d, 'shipments', 'S003'), {status: 'out_for_delivery', plan: {revision: 1, mode: 'pickup', address_id: null, point_id: 'P03', delivery_date: null, hold_until: null}}); }, /requires a home delivery plan/],
    ['timeline out of order', d => { find(d, 'shipments', 'S001').timeline.reverse(); }, /timeline is out of order/],
    ['history that stops before the last update', d => { find(d, 'shipments', 'S003').history.pop(); }, /history must include its last update/],
    ['ready parcel without the recipient\'s pass', d => { d.passes = d.passes.filter(p => p.id !== 'PASS001'); }, /recipient has no active pass/],
    ['authorization for someone who is not a saved collector', d => { find(d, 'grants', 'G001').collector_person_id = 'person-sam'; }, /not a trusted collector/],
    ['ended authorization without an end time', d => { find(d, 'grants', 'G001').status = 'revoked'; }, /end time must match/],
    ['current authorization for an earlier arrival', d => { find(d, 'grants', 'G001').pickup_epoch = 2; }, /does not match the current pickup/],
    ['authorization that outlasts the pickup deadline', d => { find(d, 'grants', 'G001').expires_at = '2026-03-05T00:00:00Z'; }, /outlasts the pickup deadline/],
    ['authorization that expires before it starts', d => { find(d, 'grants', 'G001').expires_at = '2026-03-02T13:00:00Z'; }, /must expire after it is created/],
    ['current authorization without a pass', d => { d.passes = d.passes.filter(p => p.grant_id !== 'G001'); }, /must have one active pass/],
    ['authorization replacing a missing one', d => { find(d, 'grants', 'G001').replaces_grant_id = 'G999'; }, /missing record/],
    ['pass held by someone other than its grant names', d => { d.passes.find(p => p.grant_id === 'G001').holder_person_id = 'person-maya'; }, /does not match its grant/],
    ['pass that outlasts its authorization', d => { d.passes.find(p => p.grant_id === 'G001').expires_at = '2026-03-04T13:00:00Z'; }, /outlasts its grant/],
    ['active pass under an ended authorization', d => { Object.assign(find(d, 'grants', 'G001'), {status: 'revoked', ended_at: '2026-03-02T14:00:00Z'}); }, /outlived its grant/],
    ['pass without a grant for a non-recipient', d => { find(d, 'passes', 'PASS001').holder_person_id = 'person-alex'; }, /must belong to the recipient|More than one active pass/],
    ['active pass for an earlier arrival', d => { find(d, 'passes', 'PASS001').pickup_epoch = 2; }, /does not match the current pickup/],
    ['pass that outlasts the pickup deadline', d => { find(d, 'passes', 'PASS001').expires_at = '2026-03-05T00:00:00Z'; }, /outlasts the pickup deadline/],
    ['two active passes for one holder', d => { d.passes.push({...structuredClone(find(d, 'passes', 'PASS001')), id: 'PASS009'}); }, /More than one active pass/],
    ['ended pass without an end time', d => { find(d, 'passes', 'PASS001').status = 'invalidated'; }, /end time must match/],
    ['a recipient saved as their own collector', d => { d.collectors.push({recipient_person_id: 'person-maya', person_id: 'person-maya', relationship: 'Self'}); }, /own delegate/],
    ['the same collector saved twice', d => { d.collectors.push(structuredClone(d.collectors[0])); }, /Duplicate trusted collector/],
    ['collector outside the binding', d => { d.collectors.push({recipient_person_id: 'person-maya', person_id: 'person-nobody', relationship: 'x'}); }, /binding/],
    ['address owner outside the binding', d => { d.addresses[0].person_id = 'person-nobody'; }, /binding/],
    ['opening hours that close before they open', d => { d.pickup_points[0].hours[0] = {weekday: 0, opens: '21:00', closes: '09:00'}; }, /open before they close/],
    ['unknown time zone for a point', d => { d.pickup_points[0].time_zone = 'Nowhere/Here'; }, /time zone/],
    ['notice about a missing parcel', d => { d.notices[0].shipment_id = 'S999'; }, /missing record/],
    ['duplicate record ID', d => { d.passes.push(structuredClone(d.passes[0])); }, /Duplicate ID/],
    ['history entry later than the last update', d => { find(d, 'shipments', 'S003').history.push({at: '2026-03-02T00:00:00Z', action: 'late'}); }, /invalid history timeline/],
    ['opening hours of zero length', d => { d.pickup_points[0].hours[0] = {weekday: 0, opens: '09:00', closes: '09:00'}; }, /open before they close/],
    ['saved collector for a recipient outside the binding', d => { d.collectors.push({recipient_person_id: 'person-nobody', person_id: 'person-alex', relationship: 'x'}); }, /Collector recipient is not a person/],
    ['request by someone outside the binding', d => { find(d, 'changes', 'C001').requested_by_person_id = 'person-nobody'; }, /Change requester is not a person/],
    ['pickup plan with a delivery day', d => { find(d, 'shipments', 'S002').plan.delivery_date = '2026-03-05'; }, /must name only a point/],
    ['pickup plan with a hold', d => { find(d, 'shipments', 'S002').plan.hold_until = '2026-03-05'; }, /must name only a point/],
    ['pickup plan without a point', d => { find(d, 'shipments', 'S002').plan.point_id = null; }, /must name only a point/],
    ['deadline at the moment of readiness', d => { find(d, 'shipments', 'S002').pickup.deadline = find(d, 'shipments', 'S002').pickup.ready_at; }, /deadline must follow readiness/],
    ['authorization with no history', d => { find(d, 'grants', 'G001').history = []; }, /invalid history timeline/],
    ['authorization history before its creation', d => { find(d, 'grants', 'G001').history[0].at = '2026-03-01T00:00:00Z'; }, /invalid history timeline/],
    ['authorization that expires the moment it starts', d => { find(d, 'grants', 'G001').expires_at = find(d, 'grants', 'G001').created_at; }, /must expire after it is created/]
  ];
  for (const [name, mutate, pattern] of cases) {
    const bad = structuredClone(good);
    mutate(bad);
    assert.throws(() => plugin.validateSeed(base.ctx, bad), error => { assert.equal(error.code, 'invalid_seed', name); assert.match(error.message, pattern, name); return true; }, name);
  }
  assert.ok(cases.length >= 60);
});
