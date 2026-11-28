'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const plugin = require('../plugin.cjs');
const {fixture} = require('./harness.cjs');

const code = c => e => e.code === c;
function unchanged(f, fn, c) {
  const before = f.data;
  assert.throws(fn, code(c));
  assert.deepEqual(f.data, before);
}
function book(f, site, arrival, departure, previewArgs = {}) {
  const hold = f.call('cart.hold', {site_id: site, arrival, departure}).hold;
  const preview = f.call('reservations.preview', {hold_id: hold.id, ...previewArgs}).preview;
  return f.call('reservations.confirm', {preview_id: preview.id});
}

// ---- Workflow 1: search and site detail --------------------------------------

test('reads are side-effect free, and attribute filters never match an unknown value', () => {
  const f = fixture(), before = f.data;
  const all = f.call('sites.search', {facility_id: 'cedar-flat', arrival: '2027-06-25', departure: '2027-06-27'}).sites;
  assert.equal(all.length, 6);
  const long = f.call('sites.search', {facility_id: 'cedar-flat', arrival: '2027-06-25', departure: '2027-06-27', min_vehicle_ft: 26}).sites.map(s => s.id);
  assert.deepEqual(long, ['cf-B10', 'cf-B12']);  // cf-C07's length is unknown and is not returned
  const powered = f.call('sites.search', {facility_id: 'cedar-flat', arrival: '2027-06-25', departure: '2027-06-27', electric_min_amps: 30}).sites.map(s => s.id);
  assert.deepEqual(powered, ['cf-B10', 'cf-B12', 'cf-C07']);
  assert.equal(f.call('sites.get', {site_id: 'cf-C07'}).site.max_vehicle_ft, null);
  for (const op of ['facilities.search', 'account.get', 'wallet.list', 'reservations.list', 'alerts.list', 'policy.get']) f.call(op, {});
  assert.deepEqual(f.data, before);
});

test('night states: unreleased, open, held, booked and closed', () => {
  const f = fixture();
  const states = (site, a, b) => f.call('sites.get', {site_id: site, arrival: a, departure: b}).nights.map(n => n.state);
  assert.deepEqual(states('cf-B10', '2027-11-20', '2027-11-21'), ['unreleased']);  // 180 days ahead at 07:00
  assert.deepEqual(states('cf-B14', '2027-06-18', '2027-06-20'), ['booked', 'booked']);
  f.call('cart.hold', {site_id: 'cf-B10', arrival: '2027-06-25', departure: '2027-06-26'});
  assert.deepEqual(states('cf-B10', '2027-06-25', '2027-06-26'), ['held']);
  f.at('2027-05-20T09:16:00-07:00');  // the 15-minute hold has lapsed
  assert.deepEqual(states('cf-B10', '2027-06-25', '2027-06-26'), ['open']);
  f.event({event_id: 'cl', at: '2027-05-20T10:00:00-07:00', operation: 'switchback.closure.ordered',
    payload: {closure_id: 'cl-1', facility_id: 'cedar-flat', site_ids: ['cf-B10'], from: '2027-06-25', to: '2027-06-26', reason: 'tree work'}});
  assert.deepEqual(states('cf-B10', '2027-06-25', '2027-06-26'), ['closed']);
  unchanged(f, () => f.call('cart.hold', {site_id: 'cf-B10', arrival: '2027-06-25', departure: '2027-06-26'}), 'site_closed');
  unchanged(f, () => f.call('cart.hold', {site_id: 'cf-B14', arrival: '2027-06-18', departure: '2027-06-19'}), 'site_taken');
  unchanged(f, () => f.call('cart.hold', {site_id: 'cf-B12', arrival: '2027-11-20', departure: '2027-11-21'}), 'not_yet_released');
});

// ---- Workflow 2: reservation lifecycle ---------------------------------------

test('the preview pre-fills saved defaults, and the booking form checks only length, party and pets', () => {
  const f = fixture();
  const hold = f.call('cart.hold', {site_id: 'cf-B14', arrival: '2027-06-25', departure: '2027-06-27'}).hold;
  const p = f.call('reservations.preview', {hold_id: hold.id}).preview;
  assert.equal(p.card_id, 'card-carol-visa');  // another person's card is the default
  assert.equal(p.equipment.id, 'equip-0001');  // the old trailer
  assert.deepEqual(p.companions.map(c => c.id), ['comp-0001', 'comp-0002']);
  assert.equal(p.party_size, 3);
  assert.equal(p.ladder.length, 4);
  f.call('equipment.save', {label: 'New trailer', kind: 'trailer', length_ft: 26});
  unchanged(f, () => f.call('reservations.preview', {hold_id: hold.id, equipment_id: 'equip-0003'}), 'equipment_exceeds_site');
  unchanged(f, () => f.call('reservations.preview', {hold_id: hold.id, additional_guests: 4}), 'occupancy_exceeded');
  const walk = f.call('cart.hold', {site_id: 'cf-W02', arrival: '2027-06-25', departure: '2027-06-26'}).hold;
  unchanged(f, () => f.call('reservations.preview', {hold_id: walk.id, equipment_id: null, pets: 1}), 'pets_not_allowed');
  f.at('2027-05-20T09:20:00-07:00');
  unchanged(f, () => f.call('reservations.preview', {hold_id: hold.id}), 'hold_expired');
});

test('confirm charges the previewed card once; a consumed or lapsed preview cannot be reused', () => {
  const f = fixture();
  const hold = f.call('cart.hold', {site_id: 'cf-B12', arrival: '2027-06-25', departure: '2027-06-27'}).hold;
  const p = f.call('reservations.preview', {hold_id: hold.id, card_id: 'card-dana-visa'}).preview;
  const out = f.call('reservations.confirm', {preview_id: p.id});
  assert.equal(out.reservation.state, 'confirmed');
  assert.equal(out.receipt.amount_cents, 8400);
  assert.equal(out.receipt.card_id, 'card-dana-visa');
  unchanged(f, () => f.call('reservations.confirm', {preview_id: p.id}), 'preview_consumed');
  const n = f.data.notices.at(-1);
  assert.equal(n.kind, 'confirmation');
  assert.match(n.message.data.content.body.text, /Charged: \$84\.00 to Visa ending 4417/);
  // A preview made on an expired card is declined at confirm, and nothing is charged.
  const h2 = f.call('cart.hold', {site_id: 'cf-B10', arrival: '2027-06-25', departure: '2027-06-27'}).hold;
  const p2 = f.call('reservations.preview', {hold_id: h2.id, card_id: 'card-dana-mc'}).preview;
  unchanged(f, () => f.call('reservations.confirm', {preview_id: p2.id}), 'payment_declined');
  // A preview whose hold lapses is stale.
  const p3 = f.call('reservations.preview', {hold_id: h2.id, card_id: 'card-dana-visa'}).preview;
  f.at('2027-05-20T09:30:00-07:00');
  unchanged(f, () => f.call('reservations.confirm', {preview_id: p3.id}), 'preview_stale');
});

// ---- Workflow 3: modify, cancel and no-show ----------------------------------

test('the refund ladder: each rung refunds its amount and names the next rung change', () => {
  const at = ['2027-05-20T09:00:00-07:00', '2027-06-10T09:00:00-07:00', '2027-06-16T09:00:00-07:00', '2027-06-18T16:00:00-07:00'];
  const expected = [5600, 4600, 1800, 0];  // all; all but $10; all but $10 and the first night; nothing
  at.forEach((time, i) => {
    const f = fixture();
    f.at(time);
    const p = f.call('reservations.cancel.preview', {reservation_id: 'res-0001'}).preview;
    assert.equal(p.rung, i + 1);
    assert.equal(p.refund_cents, expected[i]);
    assert.equal(p.next_rung_change_at === null, i === 3);
  });
});

test('a per-facility policy record: free until 18:00 three days out, then 50%', () => {
  const f = fixture();
  f.at('2027-06-29T17:59:00-07:00');
  assert.equal(f.call('reservations.cancel.preview', {reservation_id: 'res-0002'}).preview.refund_cents, 13800);
  f.at('2027-06-29T18:00:00-07:00');
  assert.equal(f.call('reservations.cancel.preview', {reservation_id: 'res-0002'}).preview.refund_cents, 6900);
});

test('a cancel preview goes stale when the rung changes; the refund posts three days later with a notice', () => {
  const f = fixture();
  f.at('2027-06-03T23:59:00-07:00');
  const p = f.call('reservations.cancel.preview', {reservation_id: 'res-0001'}).preview;
  f.at('2027-06-04T00:00:00-07:00');
  unchanged(f, () => f.call('reservations.cancel.confirm', {preview_id: p.id}), 'preview_stale');
  const q = f.call('reservations.cancel.preview', {reservation_id: 'res-0001'}).preview;
  f.call('reservations.cancel.confirm', {preview_id: q.id});
  const refund = f.data.payments.at(-1);
  assert.deepEqual([refund.kind, refund.amount_cents, refund.status], ['refund', 4600, 'pending']);
  unchanged(f, () => f.call('reservations.cancel.preview', {reservation_id: 'res-0001'}), 'already_cancelled');
  f.at('2027-06-08T00:00:00-07:00');
  assert.equal(f.view().payments.at(-1).status, 'posted');  // computed on read
  assert.equal(f.data.payments.at(-1).status, 'pending');   // not stored by a read
  f.call('equipment.save', {label: 'Spare tent', kind: 'tent', length_ft: 0});  // the next write commits it
  assert.equal(f.data.payments.at(-1).status, 'posted');
  assert.equal(f.data.notices.at(-1).kind, 'refund_posted');
});

test('a change costs $10, holds the new nights, releases the old ones and is refused after the change window', () => {
  const f = fixture();
  const p = f.call('reservations.modify.preview', {reservation_id: 'res-0001', site_id: 'cf-B10', arrival: '2027-06-25', departure: '2027-06-27'}).preview;
  assert.deepEqual([p.price_difference_cents, p.change_fee_cents, p.charge_cents], [2000, 1000, 3000]);
  f.call('reservations.modify.confirm', {preview_id: p.id});
  const r = f.call('reservations.get', {reservation_id: 'res-0001'}).reservation;
  assert.deepEqual([r.site_id, r.arrival, r.total_cents], ['cf-B10', '2027-06-25', 7600]);
  const nights = f.call('sites.get', {site_id: 'cf-B14', arrival: '2027-06-18', departure: '2027-06-20'}).nights.map(n => n.state);
  assert.deepEqual(nights, ['open', 'open']);
  f.at('2027-06-22T00:00:00-07:00');  // rung 3 for the new arrival
  unchanged(f, () => f.call('reservations.modify.preview', {reservation_id: 'res-0001', arrival: '2027-06-26', departure: '2027-06-28'}), 'outside_change_window');
});

test('no check-in releases the site at 21:00; a late-arrival notice moves it to 12:00 the next day', () => {
  const f = fixture();
  f.at('2027-06-18T21:00:00-07:00');
  assert.equal(f.call('reservations.get', {reservation_id: 'res-0001'}).reservation.state, 'no_show');
  unchanged(f, () => f.call('reservations.late_arrival', {reservation_id: 'res-0001'}), 'notice_too_late');
  const g = fixture();
  g.at('2027-06-18T19:00:00-07:00');
  g.call('reservations.late_arrival', {reservation_id: 'res-0001'});
  g.at('2027-06-19T11:59:00-07:00');
  assert.equal(g.call('reservations.get', {reservation_id: 'res-0001'}).reservation.state, 'confirmed');
  g.at('2027-06-19T12:00:00-07:00');
  assert.equal(g.call('reservations.get', {reservation_id: 'res-0001'}).reservation.state, 'no_show');
  const h = fixture();
  h.at('2027-06-18T16:10:00-07:00');
  h.event({event_id: 'ci', at: '2027-06-18T16:10:00-07:00', operation: 'switchback.reservation.checked_in', payload: {reservation_id: 'res-0001'}});
  unchanged(h, () => h.call('reservations.cancel.preview', {reservation_id: 'res-0001'}), 'already_checked_in');
  h.at('2027-06-20T12:00:00-07:00');
  assert.equal(h.view().reservations.find(r => r.id === 'res-0001').state, 'completed');
});

// ---- Workflow 4: conditions and alerts ---------------------------------------

test('an electrical outage marks stays affected and leaves the electric filter while active; update and cancel recompute both', () => {
  const f = fixture();
  const b = book(f, 'cf-B12', '2027-06-25', '2027-06-27', {card_id: 'card-dana-visa'}).reservation;
  const powered = () => f.call('sites.search', {facility_id: 'cedar-flat', arrival: '2027-06-25', departure: '2027-06-27', electric_min_amps: 30}).sites.map(s => s.id);
  const affected = () => f.call('reservations.get', {reservation_id: b.id}).reservation.affected_by_alerts;
  f.event({event_id: 'a1', at: '2027-06-01T09:00:00-07:00', operation: 'switchback.alert.posted', payload: {alert_id: 'al-7',
    kind: 'electrical_outage', facility_id: 'cedar-flat', site_ids: ['cf-B10', 'cf-B12'], from: '2027-06-01T09:00:00-07:00', to: '2027-06-28T12:00:00-07:00', text: 'Transformer repair on loop B.'}});
  assert.deepEqual(powered(), ['cf-C07']);
  assert.deepEqual(affected(), ['al-7']);
  assert.equal(f.data.reservations.find(r => r.id === b.id).state, 'confirmed');
  assert.equal(f.data.notices.at(-1).kind, 'alert_posted');
  f.event({event_id: 'a2', at: '2027-06-02T09:00:00-07:00', operation: 'switchback.alert.updated', payload: {alert_id: 'al-7', site_ids: ['cf-B10']}});
  assert.deepEqual(powered(), ['cf-B12', 'cf-C07']);
  assert.deepEqual(affected(), []);
  assert.equal(f.data.notices.at(-1).kind, 'alert_updated');
  f.event({event_id: 'a3', at: '2027-06-03T09:00:00-07:00', operation: 'switchback.alert.cancelled', payload: {alert_id: 'al-7'}});
  assert.deepEqual(powered(), ['cf-B10', 'cf-B12', 'cf-C07']);
  assert.throws(() => f.event({event_id: 'a4', at: '2027-06-03T09:00:00-07:00', operation: 'switchback.alert.cancelled', payload: {alert_id: 'al-7'}}), code('invalid_event'));
});

test('a closure cancels the whole stay with a full refund and a Mail notice; a competing claim takes only open nights', () => {
  const f = fixture();
  f.event(require('../examples/scenario.json'));
  const r = f.data.reservations.find(x => x.id === 'res-0001');
  assert.equal(r.state, 'closure_cancelled');
  assert.equal(f.data.payments.at(-1).amount_cents, r.total_cents);
  const msg = f.data.notices.at(-1).message;
  assert.equal(msg.type, 'org.pale.mail.notification.v1');
  assert.equal(msg.data.recipient.id, 'person-dana');
  unchanged(f, () => f.call('reservations.cancel.preview', {reservation_id: 'res-0001'}), 'already_cancelled');
  f.call('cart.hold', {site_id: 'cf-B10', arrival: '2027-06-25', departure: '2027-06-26'});
  f.event({event_id: 'c1', at: '2027-05-21T06:05:00-07:00', operation: 'switchback.inventory.claimed', payload: {site_id: 'cf-B10', nights: ['2027-06-25', '2027-06-26']}});
  assert.deepEqual(f.data.claims.at(-1).nights, ['2027-06-26']);  // the held night was skipped
});

test('events cannot rewrite history, name unknown records or move the clock back', () => {
  const f = fixture();
  assert.throws(() => f.event({event_id: 'x', at: '2027-05-21T00:00:00-07:00', operation: 'switchback.alert.updated', payload: {alert_id: 'missing'}}), code('invalid_event'));
  assert.throws(() => f.event({event_id: 'x', at: '2027-05-21T00:00:00-07:00', operation: 'switchback.reservation.checked_in', payload: {reservation_id: 'res-0002'}}), code('invalid_event'));
  assert.throws(() => f.event({event_id: 'x', at: '2027-05-01T00:00:00-07:00', operation: 'switchback.alert.cancelled', payload: {alert_id: 'al-0001'}}), /backwards/);
  const bad = f.data;
  bad.reservations.push({...bad.reservations[0], id: 'res-9999'});
  assert.throws(() => plugin.validateSeed(f.ctx, bad), /Two live reservations/);
});

test('diagnostics are optional and never change business results', () => {
  const on = fixture(), off = fixture({logging: false});
  on.event(require('../examples/scenario.json'));
  off.event(require('../examples/scenario.json'));
  assert.deepEqual(on.data, off.data);
  assert.ok(on.logs.length);
});

// ---- Check (a): anchor runs over the example outcome checks -------------------

const {SCENARIOS, run} = require('./scenarios.cjs');
// Check (b), the fixture and schedule checks, and the rule-text map run with these tests.
require('./mutation-checks.cjs');
require('./fixture-checks.cjs');

for (const [name, s] of Object.entries(SCENARIOS)) {
  test(`check (a), ${name}: reference passes, do-nothing fails exactly the checks that need a write, wrong runs fail exactly their checks`, () => {
    const ok = Object.fromEntries(s.checks.map(c => [c, true]));
    assert.deepEqual(run(s, s.reference), ok, 'reference');
    assert.deepEqual(run(s, () => {}), Object.fromEntries(s.checks.map(c => [c, !s.writes.includes(c)])), 'do-nothing');
    for (const [wrong, fn] of Object.entries(s.wrong)) {
      assert.deepEqual(run(s, fn), Object.fromEntries(s.checks.map(c => [c, !s.fails[wrong].includes(c)])), wrong);
    }
  });
}

test('every fixture dates its history on or after 2025-01-01; task clocks and scheduled events are on or after 2026-01-01', () => {
  const history = Date.parse('2025-01-01T00:00:00Z'), task = Date.parse('2026-01-01T00:00:00Z');
  const instant = stamp => Date.parse(stamp.length === 10 ? stamp + 'T00:00:00Z' : stamp);
  const stamps = value => [...JSON.stringify(value).matchAll(/\d{4}-\d{2}-\d{2}(T[0-9:.]+(Z|[+-]\d{2}:\d{2}))?/g)].map(m => m[0]);
  assert.ok(instant(require('../fixtures/clock.json').initial_time) >= task);
  for (const name of ['minimal', 'high-country', 'desert-rivers']) {
    const seed = require(`../fixtures/${name}.json`), schedule = require(`../fixtures/schedules/${name}.json`);
    for (const stamp of stamps(seed)) assert.ok(instant(stamp) >= history, `${name}: history before 2025-01-01: ${stamp}`);
    assert.ok(instant(schedule.initial_time) >= task, `${name}: task clock`);
    for (const e of schedule.events) {
      assert.ok(instant(e.at) >= instant(schedule.initial_time), `${name}: ${e.event_id} before the task clock`);
      for (const stamp of stamps(e)) assert.ok(instant(stamp) >= task, `${name}: ${e.event_id} dates ${stamp}`);
    }
    for (const stamp of stamps(require(`../fixtures/evaluator/${name}.claim-times.json`).times)) assert.ok(instant(stamp) >= task);
  }
  for (const stamp of stamps(require('../examples/scenario.json'))) assert.ok(instant(stamp) >= task, stamp);  // scenario events are on the task timeline
});

test('nights before today, facility time, cannot be held or moved to', () => {
  const f = fixture();  // clock 2027-05-20 09:00 -07:00
  unchanged(f, () => f.call('cart.hold', {site_id: 'cf-B10', arrival: '2027-05-01', departure: '2027-05-03'}), 'night_in_past');
  unchanged(f, () => f.call('cart.hold', {site_id: 'cf-B10', arrival: '2027-05-19', departure: '2027-05-21'}), 'night_in_past');
  f.call('cart.hold', {site_id: 'cf-B10', arrival: '2027-05-20', departure: '2027-05-21'});  // tonight is fine
  unchanged(f, () => f.call('reservations.modify.preview', {reservation_id: 'res-0001', arrival: '2027-05-10', departure: '2027-05-12'}), 'night_in_past');
  const g = fixture({now: '2027-05-20T23:30:00-07:00'});  // still the 20th at the facility, already the 21st in UTC
  g.call('cart.hold', {site_id: 'cf-B10', arrival: '2027-05-20', departure: '2027-05-21'});
  // The night states say which nights are already past, and search counts them as unavailable.
  const n = f.call('sites.get', {site_id: 'cf-B12', arrival: '2027-05-19', departure: '2027-05-22'}).nights;
  assert.deepEqual(n.map(x => [x.date, x.past]), [['2027-05-19', true], ['2027-05-20', false], ['2027-05-21', false]]);
  const s = f.call('sites.search', {facility_id: 'cedar-flat', arrival: '2027-05-18', departure: '2027-05-19'}).sites;
  assert.ok(s.length && s.every(x => x.available === false && x.nights[0].past === true));
  assert.equal(f.call('sites.search', {facility_id: 'cedar-flat', arrival: '2027-05-18', departure: '2027-05-19', available_only: true}).sites.length, 0);
});

test('a new change preview supersedes the earlier one: its hold is released, so previewing again does not collide with it', () => {
  const f = fixture();
  const first = f.call('reservations.modify.preview', {reservation_id: 'res-0001', arrival: '2027-06-19', departure: '2027-06-21'}).preview;
  const again = f.call('reservations.modify.preview', {reservation_id: 'res-0001', arrival: '2027-06-20', departure: '2027-06-22'}).preview;
  assert.equal(f.data.holds.find(h => h.id === first.hold_id).status, 'released');
  assert.equal(f.data.holds.find(h => h.id === again.hold_id).status, 'active');
  unchanged(f, () => f.call('reservations.modify.confirm', {preview_id: first.id}), 'preview_stale');
  f.call('reservations.modify.confirm', {preview_id: again.id});
  assert.equal(f.call('reservations.get', {reservation_id: 'res-0001'}).reservation.arrival, '2027-06-20');
  // Another reservation's change hold still blocks: only this reservation's own earlier previews are superseded.
  const other = f.call('reservations.modify.preview', {reservation_id: 'res-0002', site_id: 'ls-01', arrival: '2027-07-02', departure: '2027-07-04'}).preview;
  assert.ok(other.hold_id);
  unchanged(f, () => f.call('cart.hold', {site_id: 'ls-01', arrival: '2027-07-03', departure: '2027-07-04'}), 'site_taken');
});

test('a closure also cancels a stay already in progress, with a full refund and a notice', () => {
  const f = fixture();
  f.event({event_id: 'ci', at: '2027-06-18T16:10:00-07:00', operation: 'switchback.reservation.checked_in', payload: {reservation_id: 'res-0001'}});
  f.event({event_id: 'cl', at: '2027-06-19T07:00:00-07:00', operation: 'switchback.closure.ordered',
    payload: {closure_id: 'cl-2', facility_id: 'cedar-flat', site_ids: [], from: '2027-06-19', to: '2027-06-22', reason: 'flash flood warning'}});
  const r = f.data.reservations.find(x => x.id === 'res-0001');
  assert.equal(r.state, 'closure_cancelled');
  assert.equal(f.data.payments.at(-1).amount_cents, r.total_cents);
  assert.equal(f.data.notices.at(-1).kind, 'closure');
});

test('computed stamps are in facility time, so dates in notices are local', () => {
  const f = fixture({now: '2027-05-20T20:30:00-07:00'});  // 03:30 the next day in UTC
  f.event({event_id: 'cl', at: '2027-05-20T20:30:00-07:00', operation: 'switchback.closure.ordered',
    payload: {closure_id: 'cl-3', facility_id: 'cedar-flat', site_ids: [], from: '2027-06-15', to: '2027-06-22', reason: 'road washout'}});
  const pay = f.data.payments.at(-1);
  assert.equal(pay.posts_at, '2027-05-23T20:30:00-07:00');
  assert.match(f.data.notices.at(-1).message.data.content.body.text, /Refund posts: 2027-05-23/);
  const hold = f.call('cart.hold', {site_id: 'cf-B10', arrival: '2027-06-25', departure: '2027-06-26'}).hold;
  assert.equal(hold.expires_at, '2027-05-20T20:45:00-07:00');
});

test('each enforced rule is printed on the policy page and shown on the preview or page it affects', () => {
  const f = fixture();
  const page = f.call('policy.get', {facility_id: 'cedar-flat'}).policies[0], text = page.rules.join('\n');
  // Release schedule: policy text, and the site page's night state.
  assert.match(text, /released 180 days ahead at 07:00/);
  assert.equal(f.call('sites.get', {site_id: 'cf-B12', arrival: '2027-11-20', departure: '2027-11-21'}).nights[0].state, 'unreleased');
  // Cart hold: policy text, and the preview expiry is the hold's 15 minutes.
  assert.match(text, /hold lasts 15 minutes/);
  const hold = f.call('cart.hold', {site_id: 'cf-B12', arrival: '2027-06-25', departure: '2027-06-27'}).hold;
  const p = f.call('reservations.preview', {hold_id: hold.id, card_id: 'card-dana-visa'}).preview;
  assert.equal(p.expires_at, '2027-05-20T09:15:00-07:00');
  // The booking form's three checks, and the paying card with holder and expiry on the preview.
  assert.match(text, /checks only equipment length, party size and pets/);
  assert.deepEqual([p.card.holder_name, p.card.exp_month, p.card.exp_year, p.card.expired], ['Dana Okafor', 3, 2029, false]);
  // Refund ladder: the policy rungs and the preview's dated ladder agree.
  assert.deepEqual(page.ladder.map(r => r.cancel), p.ladder.map(r => r.cancel));
  assert.deepEqual(p.ladder.map(r => r.ends_at), ['2027-06-11T00:00:00-07:00', '2027-06-21T00:00:00-07:00', '2027-06-25T15:00:00-07:00', null]);
  assert.match(text, /three days later/);
  // Cancel preview names the rung, refund, card and next rung change.
  const c = f.call('reservations.cancel.preview', {reservation_id: 'res-0001'}).preview;
  assert.deepEqual([c.rung, c.refund_cents, c.card.label, c.next_rung_change_at], [1, 5600, 'Visa ending 4417', '2027-06-04T00:00:00-07:00']);
  // Change window and fee: the ladder's change terms and the modify preview.
  assert.match(text, /changes are allowed only in rungs that permit them/i);
  assert.match(text, /cannot be undone/);
  const m = f.call('reservations.modify.preview', {reservation_id: 'res-0001', arrival: '2027-06-19', departure: '2027-06-21'}).preview;
  assert.equal(m.change_fee_cents, page.ladder[0].change.fee_cents);
  assert.match(m.note, /cannot be undone/);
  // No-show and late arrival: policy text and the reservation page's release time.
  assert.match(text, /released at 21:00 on arrival day, or 12:00 the next day after a late-arrival notice/);
  assert.equal(f.call('reservations.get', {reservation_id: 'res-0001'}).reservation.release_at, '2027-06-18T21:00:00-07:00');
  // Alerts and closures.
  assert.match(text, /alert leaves a reservation confirmed and marks it affected/);
  assert.match(text, /closure covering any night cancels the whole stay with a full refund/);
});

test('the pages: one controller covers every tool, embeds its PNG icons and calls only the Host routes', () => {
  const fs = require('node:fs'), path = require('node:path');
  const controller = fs.readFileSync(path.join(__dirname, '../gui/src/app.js'), 'utf8');
  for (const t of require('../tools.json')) assert.ok(controller.includes(`'${t.name}'`), 'page uses ' + t.name);
  const icons = require('../gui/icons.cjs');
  assert.ok(controller.includes(icons.block()), 'embedded icons match gui/icons.cjs');
  for (const [, b64] of controller.matchAll(/^ \w+:'([A-Za-z0-9+/=]+)',$/gm)) assert.equal(Buffer.from(b64, 'base64').subarray(1, 4).toString(), 'PNG');
  assert.deepEqual([...new Set([...controller.matchAll(/request\('([^']+)'/g)].map(m => m[1]))].sort(), ['/api/call', '/api/tools', '/session']);
  assert.ok(!/<svg|localStorage|sessionStorage|indexedDB|innerHTML/.test(controller), 'no SVG, browser store or HTML injection');
  const gui = require('../contribution/gui.json'), web = gui.extensions.find(e => e.namespace === 'pale.web').data;
  assert.deepEqual([web.page, web.controller, gui.content_policy.svg], ['gui/index.html', 'gui/src/app.js', 'disabled']);
  assert.equal(require('../contribution/contribution.json').gui_ref, 'gui.json');
});
