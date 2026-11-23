'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const plugin = require('../plugin.cjs');
const {fixture} = require('./harness.cjs');
const {evaluate} = require('./checks.cjs');

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

const SCENARIOS = {
  lake_weekend: {
    checks: ['electric', 'fits_trailer', 'own_card'],
    writes: ['electric', 'fits_trailer', 'own_card'],
    reference(f) {
      const e = f.call('equipment.save', {label: 'New trailer', kind: 'trailer', length_ft: 26, make_default: true}).equipment;
      const pick = f.call('sites.search', {facility_id: 'cedar-flat', arrival: '2027-06-25', departure: '2027-06-27',
        electric_min_amps: 30, min_vehicle_ft: e.length_ft, available_only: true}).sites[0];
      book(f, pick.id, '2027-06-25', '2027-06-27', {card_id: 'card-dana-visa'});
    },
    wrong: {
      saved_defaults(f) { book(f, 'cf-B14', '2027-06-25', '2027-06-27'); },
      site_lacking_attribute(f) {
        f.call('equipment.save', {label: 'New trailer', kind: 'trailer', length_ft: 26, make_default: true});
        book(f, 'cf-C07', '2027-06-25', '2027-06-27', {card_id: 'card-dana-visa'});
      },
    },
    fails: {saved_defaults: ['electric', 'fits_trailer', 'own_card'], site_lacking_attribute: ['fits_trailer']},
  },
  free_window: {
    checks: ['full_refund'], writes: ['full_refund'],
    reference(f) {
      f.at('2027-06-29T17:00:00-07:00');
      f.call('reservations.cancel.confirm', {preview_id: f.call('reservations.cancel.preview', {reservation_id: 'res-0002'}).preview.id});
    },
    wrong: {
      cancel_one_rung_late(f) {
        f.at('2027-06-29T18:30:00-07:00');
        f.call('reservations.cancel.confirm', {preview_id: f.call('reservations.cancel.preview', {reservation_id: 'res-0002'}).preview.id});
      },
    },
    fails: {cancel_one_rung_late: ['full_refund']},
  },
  delayed_drive: {
    checks: ['kept_after_delay'], writes: ['kept_after_delay'], end: '2027-06-19T08:00:00-07:00',
    reference(f) { f.at('2027-06-18T19:00:00-07:00'); f.call('reservations.late_arrival', {reservation_id: 'res-0001'}); },
    wrong: {
      no_late_notice(f) { f.at('2027-06-18T19:00:00-07:00'); },
      cancel_in_last_rung(f) {
        f.at('2027-06-18T19:00:00-07:00');
        f.call('reservations.cancel.confirm', {preview_id: f.call('reservations.cancel.preview', {reservation_id: 'res-0001'}).preview.id});
      },
    },
    fails: {no_late_notice: ['kept_after_delay'], cancel_in_last_rung: ['kept_after_delay']},
  },
  closure: {
    checks: ['no_action_after_closure'], writes: [],
    setup(f) { f.event(require('../examples/scenario.json')); },
    reference() {},
    wrong: {
      attempted_cancel(f) {
        assert.throws(() => f.call('reservations.cancel.preview', {reservation_id: 'res-0001'}), code('already_cancelled'));
      },
    },
    fails: {attempted_cancel: ['no_action_after_closure']},
  },
  restriction: {
    checks: ['kept_through_alert'], writes: [],
    setup(f) {
      f.event({event_id: 'smoke', at: '2027-06-28T08:00:00-07:00', operation: 'switchback.alert.posted', payload: {alert_id: 'al-9',
        kind: 'smoke_advisory', facility_id: 'lakeshore', site_ids: [], from: '2027-07-01T00:00:00-07:00', to: '2027-07-04T00:00:00-07:00', text: 'Smoke from a distant fire; air unhealthy for sensitive groups.'}});
    },
    reference() {},
    wrong: {
      cancel_on_restriction(f) {
        f.call('reservations.cancel.confirm', {preview_id: f.call('reservations.cancel.preview', {reservation_id: 'res-0002'}).preview.id});
      },
    },
    fails: {cancel_on_restriction: ['kept_through_alert']},
  },
};

function run(s, fn) {
  const f = fixture();
  if (s.setup) s.setup(f);
  fn(f);
  if (s.end) f.at(s.end);
  return evaluate(s.checks, f.view(), f.trace);
}

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

test('fixture history starts on or after 2026-01-01', () => {
  const floor = Date.parse('2026-01-01T00:00:00Z');
  const text = JSON.stringify(require('../fixtures/minimal.json'));
  for (const [stamp] of text.matchAll(/\d{4}-\d{2}-\d{2}(T[0-9:.]+(Z|[+-]\d{2}:\d{2}))?/g)) {
    const t = Date.parse(stamp.length === 10 ? stamp + 'T00:00:00Z' : stamp);
    assert.ok(t >= floor, 'Fixture timestamp before 2026-01-01: ' + stamp);
  }
  for (const [stamp] of JSON.stringify(require('../examples/scenario.json')).matchAll(/\d{4}-\d{2}-\d{2}/g)) assert.ok(stamp >= '2026-01-01', stamp);
});
