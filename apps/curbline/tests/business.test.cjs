'use strict';
// Business tests for the approved Curbline workflows: every row of the proposal's core examples table
// (named "Row n"), the validation list, and the rules settled in the 2026-11-23 plan review.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const plugin = require('../plugin.cjs');
const {fixture} = require('./harness.cjs');
const H = require('./helpers.cjs');
const {airportRide, bfaRide, book, flightStatus, assign, arrive, start, complete, noShow, driverCancelled, market, delivery, ev, PA218} = H;

const unchanged = (f, fn, code) => { const before = f.data; assert.throws(fn, e => e.code === code, 'expected ' + code); assert.deepEqual(f.data, before); };
const get = (f, id) => f.call('curbline.bookings.get', {booking_id: id}).booking;
const notes = (f, args = {}) => f.call('curbline.notifications.list', args).notifications;
const ledger = (f, id) => f.data.ledger.filter(e => e.booking_id === id);
const quote = (f, request) => f.call('curbline.rides.quote', request).quote;
// bk-7 on PA218, moved to 01:00 by a delay to 00:40 (rows 2 and 5).
function shifted() {
  const f = fixture();
  book(f, airportRide());
  f.event(flightStatus('2026-12-03T19:40:00-05:00', 'delayed', '2026-12-04T00:40:00-05:00'));
  return f;
}

test('generated contracts and fixtures match their generators', () => {
  const out = require('../scripts/build-contracts.cjs').build({check: true});
  assert.deepEqual(out, {tools: 22, reads: 12, writes: 10, events: 12});
  require('../scripts/generate-fixtures.cjs').build({check: true});
});

test('Mail wire schema copy is byte-identical to the receiver-owned schema', {skip: !fs.existsSync(path.resolve(__dirname, '../../../examples/apps/mail'))}, () => {
  const ours = fs.readFileSync(path.resolve(__dirname, '../schemas/mail-router-message.schema.json'));
  const mail = fs.readFileSync(path.resolve(__dirname, '../../../examples/apps/mail/schemas/router-message.schema.json'));
  assert.ok(ours.equals(mail));
});

test('manifest, contribution and handlers declare the same twelve events', () => {
  const app = require('../app.json'), contribution = require('../contribution/contribution.json');
  const handlers = Object.keys(require('../src/events.cjs').HANDLERS).sort();
  assert.deepEqual([...app.event_types].sort(), handlers);
  assert.deepEqual(contribution.events.accepts.map(e => e.type).sort(), handlers);
  const tools = require('../tools.json').map(t => t.name);
  const agentOps = contribution.interfaces.find(i => i.interface_id === 'agent-mcp').operations.map(o => o.name);
  assert.deepEqual(agentOps, tools);
});

// ---- Workflow 1: quote and book ----
test('Row 1: quote, book with the work card, then expired, stale and altered tokens', () => {
  const f = fixture();
  const q = quote(f, airportRide());
  assert.equal(q.fare_cents, 4935);
  assert.deepEqual(q.breakdown, {base_cents: 300, distance_cents: 2695, time_cents: 1190, multiplier: 1, surge_cents: 0, booking_fee_cents: 250, airport_fee_cents: 500});
  assert.equal(q.distance_km, 24.5);
  assert.equal(q.duration_min, 34);
  assert.equal(q.expires_at, '2026-12-03T19:10:00-05:00');
  assert.equal(f.data.bookings.length, 6, 'quoting stores nothing');
  const r = f.call('curbline.bookings.create', {quote_token: q.quote_token, payment_method_id: 'pm-work'});
  assert.equal(r.booking_id, 'bk-7');
  assert.equal(r.booking_status, 'scheduled');
  assert.deepEqual(ledger(f, 'bk-7').map(e => [e.entry_id, e.type, e.amount_cents, e.status]), [['le-bk-7-1', 'hold', 4935, 'authorized']]);
  assert.deepEqual(notes(f, {booking_id: 'bk-7'}).map(n => [n.notification_id, n.kind, n.recipient_person_id]), [['n-bk7-confirmed-1-maya', 'booking_confirmed', 'person-maya']]);
  assert.equal(get(f, 'bk-7').expense.profile, 'business');
  // The same token at 19:11 has expired.
  f.advance('2026-12-03T19:11:00-05:00');
  unchanged(f, () => f.call('curbline.bookings.create', {quote_token: q.quote_token, payment_method_id: 'pm-work'}), 'quote_expired');
  // A token taken before a market update for the pickup zone is stale.
  const q2 = quote(f, airportRide());
  f.event(market('2026-12-03T19:12:00-05:00', 'z-ngi', {multiplier: 1.2}));
  unchanged(f, () => f.call('curbline.bookings.create', {quote_token: q2.quote_token, payment_method_id: 'pm-work'}), 'quote_stale');
  // Altering the fare inside the token is detected by recomputation.
  const q3 = quote(f, airportRide());
  const body = JSON.parse(Buffer.from(q3.quote_token.slice(3), 'base64url'));
  body.fare_cents -= 1000;
  const forged = 'q1.' + Buffer.from(JSON.stringify(body)).toString('base64url');
  unchanged(f, () => f.call('curbline.bookings.create', {quote_token: forged, payment_method_id: 'pm-work'}), 'invalid_quote');
  unchanged(f, () => f.call('curbline.bookings.create', {quote_token: 'q1.not-json', payment_method_id: 'pm-work'}), 'invalid_quote');
  assert.equal(quote(f, airportRide()).fare_cents, Math.round(4185 * 1.2) + 750, 'the market multiplier applies to new quotes');
});

test('W1 booking errors', () => {
  const f = fixture();
  const q = r => () => quote(f, airportRide(r));
  unchanged(f, q({pickup_place_id: 'pl-nowhere'}), 'place_not_found');
  unchanged(f, q({dropoff_place_id: 'pl-pine-hollow'}), 'outside_service_area');
  unchanged(f, q({pickup_at: '2026-12-03T19:20:00-05:00', flight: undefined}), 'pickup_too_soon');
  unchanged(f, q({pickup_at: '2027-01-05T10:00:00-05:00', flight: undefined}), 'pickup_too_far');
  unchanged(f, q({child_seats: 2, passengers: 1}), 'invalid_passengers');
  const token = quote(f, airportRide()).quote_token;
  unchanged(f, () => f.call('curbline.bookings.create', {quote_token: token, payment_method_id: 'pm-gone'}), 'payment_method_not_found');
  unchanged(f, () => f.call('curbline.bookings.create', {quote_token: token, payment_method_id: 'pm-old'}), 'payment_declined');
  unchanged(f, () => f.call('curbline.bookings.create', {quote_token: token, payment_method_id: 'pm-work', rider_person_id: 'person-stranger'}), 'rider_not_found');
});

test('W1 no_vehicle_for_requirements returns up to three alternatives and no token', () => {
  const f = fixture();
  const q = quote(f, airportRide({passengers: 5, bags: 2}));
  assert.equal(q.available, false);
  assert.equal(q.code, 'no_vehicle_for_requirements');
  assert.equal(q.quote_token, null);
  assert.deepEqual(q.alternatives.map(a => a.option), ['xl']);
  assert.ok(q.alternatives.length <= 3);
});

test('W1 a reused token books again and both bookings are flagged as overlapping', () => {
  const f = fixture();
  const q = quote(f, airportRide());
  f.call('curbline.bookings.create', {quote_token: q.quote_token, payment_method_id: 'pm-work'});
  const second = f.call('curbline.bookings.create', {quote_token: q.quote_token, payment_method_id: 'pm-work'});
  assert.equal(second.booking_id, 'bk-8');
  assert.deepEqual(second.overlaps_with, ['bk-7']);
  assert.deepEqual(get(f, 'bk-7').overlaps_with, ['bk-8']);
  f.call('curbline.bookings.cancel', {booking_id: 'bk-8', reason: 'Duplicate'});
  assert.deepEqual(get(f, 'bk-7').overlaps_with, []);
  assert.ok(get(f, 'bk-7').history.some(h => h.action === 'overlap_flagged'), 'the flag stays in history for graders');
});

// ---- Workflow 3: flight-linked pickups ----
test('Row 2: a delay within 6 h moves the pickup to 01:00 at the same fare; the anchor stays', () => {
  const f = shifted();
  const b = get(f, 'bk-7');
  assert.equal(b.status, 'scheduled');
  assert.equal(b.pickup_at, '2026-12-04T01:00:00-05:00');
  assert.equal(b.anchor_pickup_at, '2026-12-03T23:15:00-05:00');
  assert.equal(b.fare.fare_cents, 4935);
  assert.equal(ledger(f, 'bk-7').length, 1, 'no new hold for an automatic shift');
  const changed = notes(f, {booking_id: 'bk-7'}).find(n => n.kind === 'booking_changed');
  assert.match(changed.body, /Fri Dec 4, 01:00 EST/);
});

test('Row 2: a shift beyond 6 h from the anchor needs attention; confirm makes it the new anchor', () => {
  const f = fixture();
  book(f, airportRide());
  f.event(flightStatus('2026-12-03T19:40:00-05:00', 'delayed', '2026-12-04T07:30:00-05:00'));
  let b = get(f, 'bk-7');
  assert.equal(b.status, 'needs_attention');
  assert.deepEqual([b.attention.reason, b.attention.proposed_pickup_at], ['large_shift', '2026-12-04T07:50:00-05:00']);
  assert.equal(b.pickup_at, '2026-12-03T23:15:00-05:00', 'not moved');
  f.call('curbline.bookings.confirm_adjustment', {booking_id: 'bk-7'});
  b = get(f, 'bk-7');
  assert.deepEqual([b.status, b.pickup_at, b.anchor_pickup_at], ['scheduled', '2026-12-04T07:50:00-05:00', '2026-12-04T07:50:00-05:00']);
  unchanged(f, () => f.call('curbline.bookings.confirm_adjustment', {booking_id: 'bk-7'}), 'not_in_needs_attention');
});

test('Row 2: with no action the booking reads as lapsed from 07:50; the next commit records it at 07:50', () => {
  const f = fixture();
  book(f, airportRide());
  f.event(flightStatus('2026-12-03T19:40:00-05:00', 'delayed', '2026-12-04T07:30:00-05:00'));
  f.advance('2026-12-04T07:49:00-05:00');
  assert.equal(get(f, 'bk-7').status, 'needs_attention');
  f.advance('2026-12-04T07:50:00-05:00');                         // env.advance_time runs no App code
  assert.equal(get(f, 'bk-7').status, 'lapsed');
  assert.equal(f.data.bookings.find(b => b.booking_id === 'bk-7').status, 'needs_attention', 'snapshot unchanged until the next commit');
  assert.equal(f.call('curbline.receipts.get', {booking_id: 'bk-7'}).receipt.held_cents, 0, 'the hold reads as released');
  f.event(market('2026-12-04T08:30:00-05:00', 'z-harbor', {multiplier: 1}));
  const stored = f.data.bookings.find(b => b.booking_id === 'bk-7');
  assert.equal(stored.status, 'lapsed');
  assert.deepEqual(stored.history.at(-1), {at: '2026-12-04T07:50:00-05:00', actor: 'clock', action: 'lapsed', from: 'needs_attention', to: 'lapsed', details: {reason: 'large_shift'}, event_id: null});
  assert.deepEqual(ledger(f, 'bk-7').map(e => [e.status, e.updated_at]), [['released', '2026-12-04T07:50:00-05:00']]);
  unchanged(f, () => f.call('curbline.bookings.cancel', {booking_id: 'bk-7', reason: 'x'}), 'not_cancellable');
});

test('W3 the 6-hour line is measured from the anchor, so small shifts cannot add up', () => {
  const f = fixture();
  book(f, airportRide());
  f.event(flightStatus('2026-12-03T19:40:00-05:00', 'delayed', '2026-12-04T02:40:00-05:00'));
  assert.equal(get(f, 'bk-7').pickup_at, '2026-12-04T03:00:00-05:00');
  f.event(flightStatus('2026-12-03T21:00:00-05:00', 'delayed', '2026-12-04T05:00:00-05:00'));
  const b = get(f, 'bk-7');
  assert.equal(b.status, 'needs_attention', '05:20 is 2h20 after the current pickup but 6h05 after the anchor');
  assert.equal(b.attention.reason, 'large_shift');
});

test('W3 no vehicle at the proposed time, a cancelled flight, and a zero shift line', () => {
  const f = fixture();
  book(f, airportRide());
  f.event(market('2026-12-03T19:30:00-05:00', 'z-ngi', {supply: {standard: {night: 0}}}));
  f.event(flightStatus('2026-12-03T19:40:00-05:00', 'delayed', '2026-12-04T00:40:00-05:00'));
  assert.equal(get(f, 'bk-7').attention.reason, 'no_vehicle_after_shift');
  unchanged(f, () => f.call('curbline.bookings.confirm_adjustment', {booking_id: 'bk-7'}), 'not_confirmable');
  f.event(flightStatus('2026-12-03T20:00:00-05:00', 'cancelled', null));
  assert.equal(get(f, 'bk-7').attention.reason, 'flight_cancelled');
  const seed = structuredClone(require('../fixtures/minimal.json'));
  seed.settings.auto_shift_max_min = 0;
  const g = fixture({seed});
  book(g, airportRide());
  g.event(flightStatus('2026-12-03T19:40:00-05:00', 'early', '2026-12-03T22:45:00-05:00'));
  assert.equal(get(g, 'bk-7').attention.reason, 'large_shift', 'with the line at 0 every shift is left to the person');
});

test('Row 3: an airport change is never moved; book BFA, then cancel NGI free', () => {
  const f = fixture();
  book(f, airportRide());
  f.event(flightStatus('2026-12-03T19:40:00-05:00', 'diverted', '2026-12-04T00:40:00-05:00', 'pl-bfa-term-b', {source_ref: 'paleair:trip-55'}));
  const b = get(f, 'bk-7');
  assert.deepEqual([b.status, b.attention.reason, b.pickup_place_id], ['needs_attention', 'airport_changed', 'pl-ngi-term-4']);
  assert.equal(f.call('curbline.bookings.preview_cancel', {booking_id: 'bk-7'}).fee_cents, 0);
  const n = notes(f, {booking_id: 'bk-7'}).find(x => x.kind === 'needs_attention');
  assert.equal(n.notification_id, 'n-bk7-attention-1-maya');
  assert.equal(n.title, 'Pickup needs attention: flight now arrives at BFA');
  assert.equal(n.body, 'Your pickup bk-7 is booked at Northgate International (NGI) Terminal 4 for Thu Dec 3, 23:15 EST. Flight PA218 now arrives at Bayfield Airport (BFA) at 00:40 EST on Fri Dec 4. The booking has not been moved. You can cancel it free of charge or book a pickup at BFA.');
  assert.equal(book(f, bfaRide()).booking_id, 'bk-8');
  const c = f.call('curbline.bookings.cancel', {booking_id: 'bk-7', reason: 'Flight diverted to BFA'});
  assert.equal(c.fee_cents, 0);
  assert.equal(ledger(f, 'bk-7').filter(e => e.type === 'charge').length, 0);
});

test('Row 3: cancelling at 22:30 while still scheduled at NGI costs $10.00', () => {
  const f = fixture();
  book(f, airportRide());
  f.advance('2026-12-03T22:14:00-05:00');
  assert.equal(f.call('curbline.bookings.preview_cancel', {booking_id: 'bk-7'}).fee_cents, 0);
  f.advance('2026-12-03T22:30:00-05:00');
  const r = f.call('curbline.bookings.cancel', {booking_id: 'bk-7', reason: 'Not needed'});
  assert.equal(r.fee_cents, 1000);
  assert.deepEqual(ledger(f, 'bk-7').map(e => [e.type, e.kind, e.amount_cents, e.status]), [['hold', 'fare', 4935, 'released'], ['charge', 'cancellation_fee', 1000, 'charged']]);
  unchanged(f, () => f.call('curbline.bookings.cancel', {booking_id: 'bk-7', reason: 'again'}), 'already_cancelled');
});

test('W3 quote, create and set_flight check the flight\'s latest known airport and arrival', () => {
  const f = fixture();
  f.event(flightStatus('2026-12-03T19:40:00-05:00', 'diverted', '2026-12-04T00:40:00-05:00', 'pl-bfa-term-b'));
  assert.throws(() => quote(f, airportRide()), e => e.code === 'invalid_flight' && /now arrives at pl-bfa-term-b/.test(e.message));
  assert.deepEqual(quote(f, bfaRide()).warnings, []);
  assert.deepEqual(quote(f, bfaRide({pickup_at: '2026-12-04T00:20:00-05:00'})).warnings, ['pickup_before_estimated_arrival']);
  book(f, bfaRide({flight: undefined, pickup_buffer_min: undefined}));
  unchanged(f, () => f.call('curbline.bookings.set_flight', {booking_id: 'bk-7', flight: {carrier: 'NB', number: '442', local_date: '2026-12-05'}}), 'invalid_flight');
  unchanged(f, () => f.call('curbline.bookings.set_flight', {booking_id: 'bk-7', flight: {carrier: 'ZZ', number: '1', local_date: '2026-12-03'}}), 'invalid_flight');
  const linked = f.call('curbline.bookings.set_flight', {booking_id: 'bk-7', flight: PA218});
  assert.deepEqual([linked.flight_tracking, linked.pickup_buffer_min], [true, 20]);
  f.call('curbline.bookings.set_flight', {booking_id: 'bk-7', flight: null});
  assert.equal(get(f, 'bk-7').flight_tracking, false);
});

test('W3 a status with no estimate keeps the last estimate and moves nothing', () => {
  const f = fixture();
  book(f, airportRide());
  f.event(flightStatus('2026-12-03T19:40:00-05:00', 'on_time', null));
  const b = get(f, 'bk-7');
  assert.deepEqual([b.status, b.pickup_at, b.flight.estimated_arrival], ['scheduled', '2026-12-03T23:15:00-05:00', '2026-12-03T22:55:00-05:00']);
});

test('W3 landing is recorded on the flight and in the booking history', () => {
  const f = shifted();
  f.event(flightStatus('2026-12-04T00:38:00-05:00', 'landed', '2026-12-04T00:38:00-05:00', 'pl-ngi-term-4', {landed_at: '2026-12-04T00:38:00-05:00'}));
  const b = get(f, 'bk-7');
  assert.equal(b.flight.landed_at, '2026-12-04T00:38:00-05:00');
  assert.equal(b.pickup_at, '2026-12-04T01:00:00-05:00', 'landing does not move the pickup');
  assert.ok(b.history.some(h => h.action === 'flight_landed'));
});

// ---- Workflow 2: change and cancel ----
function bfaBooked() {
  const f = fixture();
  f.event(flightStatus('2026-12-03T19:40:00-05:00', 'diverted', '2026-12-04T00:40:00-05:00', 'pl-bfa-term-b'));
  book(f, bfaRide());
  return f;
}
test('Row 4: preview then update moves bk to 01:20 at the same fare and re-authorizes the hold', () => {
  const f = bfaBooked();
  const p = f.call('curbline.bookings.preview_change', {booking_id: 'bk-7', changes: {pickup_at: '2026-12-04T01:20:00-05:00'}});
  assert.equal(p.fare_difference_cents, 0);
  assert.equal(p.expires_at, '2026-12-03T19:50:00-05:00');
  const r = f.call('curbline.bookings.update', {booking_id: 'bk-7', change_token: p.change_token});
  assert.equal(r.pickup_at, '2026-12-04T01:20:00-05:00');
  assert.deepEqual(ledger(f, 'bk-7').map(e => [e.entry_id, e.status]), [['le-bk-7-1', 'released'], ['le-bk-7-2', 'authorized']]);
  assert.ok(notes(f, {booking_id: 'bk-7'}).some(n => n.kind === 'booking_changed'));
  unchanged(f, () => f.call('curbline.bookings.update', {booking_id: 'bk-7', change_token: p.change_token}), 'change_token_stale');
});

test('Row 4: wheelchair_accessible has no vehicle; alternatives are standard at 01:20 and wheelchair at 06:30', () => {
  const f = bfaBooked();
  f.event(market('2026-12-03T19:45:00-05:00', 'z-bfa', {multiplier: 1, supply: {wheelchair_accessible: {night: 0}}}));
  const before = get(f, 'bk-7');
  const p = f.call('curbline.bookings.preview_change', {booking_id: 'bk-7', changes: {option: 'wheelchair_accessible', pickup_at: '2026-12-04T01:20:00-05:00'}});
  assert.equal(p.code, 'no_vehicle_for_requirements');
  assert.equal(p.change_token, null);
  assert.deepEqual(p.alternatives.map(a => [a.option, a.pickup_at]).filter(a => ['standard', 'wheelchair_accessible'].includes(a[0])),
    [['standard', '2026-12-04T01:20:00-05:00'], ['wheelchair_accessible', '2026-12-04T06:30:00-05:00']]);
  assert.deepEqual(get(f, 'bk-7'), before);
});

test('Row 4: stale, expired and other-airport changes are refused; changes stop after assignment', () => {
  const f = bfaBooked();
  const early = f.call('curbline.bookings.preview_change', {booking_id: 'bk-7', changes: {pickup_at: '2026-12-04T01:20:00-05:00'}});
  const other = f.call('curbline.bookings.preview_change', {booking_id: 'bk-7', changes: {passengers: 1}});
  f.call('curbline.bookings.update', {booking_id: 'bk-7', change_token: other.change_token});
  unchanged(f, () => f.call('curbline.bookings.update', {booking_id: 'bk-7', change_token: early.change_token}), 'change_token_stale');
  unchanged(f, () => f.call('curbline.bookings.preview_change', {booking_id: 'bk-7', changes: {pickup_place_id: 'pl-ngi-term-4', flight: null}}), 'airport_change_requires_new_booking');
  unchanged(f, () => f.call('curbline.bookings.preview_change', {booking_id: 'bk-7', changes: {passengers: 1}}), 'no_change');
  const late = f.call('curbline.bookings.preview_change', {booking_id: 'bk-7', changes: {bags: 1}});
  f.advance('2026-12-03T20:00:00-05:00');
  unchanged(f, () => f.call('curbline.bookings.update', {booking_id: 'bk-7', change_token: late.change_token}), 'change_token_expired');
  unchanged(f, () => f.call('curbline.bookings.update', {booking_id: 'bk-7', change_token: 'c1.bad'}), 'invalid_change_token');
  f.event(assign('2026-12-04T00:20:00-05:00', 'bk-7', '2026-12-04T00:58:00-05:00'));
  unchanged(f, () => f.call('curbline.bookings.preview_change', {booking_id: 'bk-7', changes: {bags: 1}}), 'modify_not_allowed');
  unchanged(f, () => f.call('curbline.bookings.set_flight', {booking_id: 'bk-7', flight: null}), 'modify_not_allowed');
});

// ---- Workflow 5: trip day ----
test('Row 5: free wait until 01:38, 12 min wait fee, $55.35 captured, receipt to Maya; no-show at 01:30 too early', () => {
  const f = shifted();
  f.event(assign('2026-12-04T00:20:00-05:00', {flight: PA218}, '2026-12-04T00:58:00-05:00'));
  f.event(flightStatus('2026-12-04T00:38:00-05:00', 'landed', '2026-12-04T00:38:00-05:00', 'pl-ngi-term-4', {landed_at: '2026-12-04T00:38:00-05:00'}));
  f.event(ev('dispatch.eta_updated', '2026-12-04T00:45:00-05:00', {booking_id: 'bk-7', eta: '2026-12-04T01:03:00-05:00'}));
  f.event(arrive('2026-12-04T01:00:00-05:00', 'bk-7'));
  assert.equal(get(f, 'bk-7').policy.free_wait_end, '2026-12-04T01:38:00-05:00');
  unchanged(f, () => f.event(noShow('2026-12-04T01:30:00-05:00', 'bk-7')), 'no_show_too_early');
  f.event(start('2026-12-04T01:50:00-05:00', 'bk-7'));
  f.event(complete('2026-12-04T02:24:00-05:00', 'bk-7', '2026-12-04T01:50:00-05:00'));
  const r = f.call('curbline.receipts.get', {booking_id: 'bk-7'}).receipt;
  assert.deepEqual(r.entries.map(e => [e.entry_id, e.kind, e.amount_cents, e.status]), [['le-bk-7-1', 'fare', 4935, 'captured'], ['le-bk-7-2', 'wait_fee', 600, 'charged']]);
  assert.equal(r.charged_cents, 5535);
  const receipt = notes(f, {booking_id: 'bk-7'}).find(n => n.kind === 'receipt');
  assert.equal(receipt.recipient_person_id, 'person-maya');
  assert.match(receipt.title, /\$55\.35/);
});

test('W5 an early driver starts nothing; untracked wait and no-show; a tracked flight not yet landed', () => {
  const f = fixture();
  book(f, airportRide({flight: undefined, pickup_buffer_min: undefined}));
  f.event(assign('2026-12-03T22:50:00-05:00', 'bk-7', '2026-12-03T23:05:00-05:00'));
  f.event(arrive('2026-12-03T23:05:00-05:00', 'bk-7'));
  assert.equal(get(f, 'bk-7').policy.free_wait_end, '2026-12-03T23:20:00-05:00', 'pickup 23:15 + 5, not arrival + 5');
  assert.equal(f.call('curbline.bookings.preview_cancel', {booking_id: 'bk-7'}).fee_cents, 1000);
  f.advance('2026-12-03T23:30:00-05:00');
  assert.equal(f.call('curbline.bookings.preview_cancel', {booking_id: 'bk-7'}).fee_cents, 1500, '$10.00 plus 10 min wait');
  f.event(noShow('2026-12-03T23:31:00-05:00', 'bk-7'));
  assert.deepEqual(ledger(f, 'bk-7').map(e => [e.kind, e.amount_cents, e.status]), [['fare', 4935, 'released'], ['no_show_fee', 1000, 'charged'], ['wait_fee', 550, 'charged']]);
  // Tracked flight that has not landed: no wait fee and no no-show.
  const g = shifted();
  g.event(assign('2026-12-04T00:20:00-05:00', 'bk-7', '2026-12-04T00:58:00-05:00'));
  g.event(arrive('2026-12-04T01:00:00-05:00', 'bk-7'));
  assert.equal(get(g, 'bk-7').policy.free_wait_end, null);
  unchanged(g, () => g.event(noShow('2026-12-04T02:00:00-05:00', 'bk-7')), 'flight_not_landed');
  g.event(start('2026-12-04T02:10:00-05:00', 'bk-7'));
  assert.equal(get(g, 'bk-7').wait_fee_cents, 0);
});

test('Row 6: driver cancels with and without reassignment', () => {
  const f = fixture();
  for (let i = 0; i < 2; i++) book(f, airportRide({flight: undefined, pickup_buffer_min: undefined, pickup_place_id: 'pl-maya-home', pickup_at: '2026-12-05T07:00:00-05:00'}));
  book(f, airportRide({flight: undefined, pickup_buffer_min: undefined, pickup_place_id: 'pl-maya-office', pickup_at: '2026-12-05T08:30:00-05:00'}));
  assert.ok(f.data.bookings.some(b => b.booking_id === 'bk-9'));
  f.event(assign('2026-12-05T07:20:00-05:00', 'bk-9', '2026-12-05T08:28:00-05:00'));
  f.event(driverCancelled('2026-12-05T07:40:00-05:00', 'bk-9', false));
  let b = get(f, 'bk-9');
  assert.deepEqual([b.status, b.attention.reason, b.driver], ['needs_attention', 'driver_cancelled', null]);
  assert.equal(ledger(f, 'bk-9')[0].status, 'authorized', 'the hold is kept');
  assert.equal(f.call('curbline.bookings.preview_cancel', {booking_id: 'bk-9'}).fee_cents, 0);
  unchanged(f, () => f.event(assign('2026-12-05T07:41:00-05:00', 'bk-9', '2026-12-05T08:28:00-05:00')), 'invalid_transition');
  f.event(assign('2026-12-05T07:42:00-05:00', 'bk-8', '2026-12-05T08:00:00-05:00'));
  f.event(driverCancelled('2026-12-05T07:45:00-05:00', 'bk-8', true));
  b = get(f, 'bk-8');
  assert.equal(b.status, 'scheduled');
  assert.ok(notes(f, {booking_id: 'bk-8'}).some(n => n.kind === 'booking_changed' && /replacement/.test(n.body)));
});

// ---- Workflow 4: riders and sharing ----
test('Row 7: Ruth gets pickup details only; Dan\'s status updates omit vehicle and ETA; revoke stops them', () => {
  const {f} = H.pack('care');
  const r = book(f, {pickup_place_id: 'pl-oakridge-rehab', dropoff_place_id: 'pl-ruth-home', pickup_at: '2026-12-04T12:00:00-05:00',
    option: 'wheelchair_accessible', passengers: 2, bags: 1}, {payment_method_id: 'pm-lena', rider_person_id: 'person-ruth'});
  const id = r.booking_id;
  const s = f.call('curbline.shares.create', {booking_id: id, person_id: 'person-dan', scope: 'status', until: '2026-12-04T18:00:00-05:00'});
  assert.equal(s.share_id, 'sh-' + id + '-1');
  unchanged(f, () => f.call('curbline.shares.create', {booking_id: id, person_id: 'person-stranger', scope: 'status', until: '2026-12-04T18:00:00-05:00'}), 'person_not_found');
  f.event(assign('2026-12-04T11:40:00-05:00', id, '2026-12-04T11:58:00-05:00'));
  f.event(arrive('2026-12-04T11:58:00-05:00', id));
  const ruth = notes(f, {booking_id: id, recipient_person_id: 'person-ruth'});
  assert.deepEqual(ruth.map(n => n.kind), ['pickup_details', 'driver_assigned', 'driver_arrived']);
  for (const n of ruth) assert.doesNotMatch(n.title + n.body, /\$|Visa|7781|bk-\d/, 'no fare, card or booking list for the rider');
  const dan = notes(f, {booking_id: id, recipient_person_id: 'person-dan'});
  assert.deepEqual(dan.map(n => n.kind), ['share_started', 'share_update', 'share_update']);
  for (const n of dan) assert.doesNotMatch(n.title + n.body, /ASH 4417|Hybrid sedan|ETA|\$/, 'scope status: no vehicle, ETA or fare');
  f.call('curbline.shares.revoke', {share_id: s.share_id});
  unchanged(f, () => f.call('curbline.shares.revoke', {share_id: s.share_id}), 'share_not_found');
  f.event(start('2026-12-04T12:01:00-05:00', id));
  f.event(complete('2026-12-04T12:12:00-05:00', id, '2026-12-04T12:01:00-05:00'));
  assert.equal(notes(f, {booking_id: id, recipient_person_id: 'person-dan'}).length, 3, 'nothing after revocation');
  unchanged(f, () => f.call('curbline.shares.create', {booking_id: id, person_id: 'person-dan', scope: 'status', until: '2026-12-05T18:00:00-05:00'}), 'booking_terminal');
});

test('W4 scope status_and_eta includes vehicle and ETA; a share expires at its until time without a write', () => {
  const {f} = H.pack('care');
  const id = book(f, {pickup_place_id: 'pl-oakridge-rehab', dropoff_place_id: 'pl-ruth-home', pickup_at: '2026-12-04T12:00:00-05:00',
    option: 'wheelchair_accessible', passengers: 2, bags: 1}, {payment_method_id: 'pm-lena', rider_person_id: 'person-ruth'}).booking_id;
  f.call('curbline.shares.create', {booking_id: id, person_id: 'person-dan', scope: 'status_and_eta', until: '2026-12-04T11:45:00-05:00'});
  f.event(assign('2026-12-04T11:40:00-05:00', id, '2026-12-04T11:58:00-05:00'));
  const update = notes(f, {booking_id: id, recipient_person_id: 'person-dan'}).find(n => n.kind === 'share_update');
  assert.match(update.body, /ASH 4417/);
  assert.match(update.body, /ETA/);
  f.advance('2026-12-04T11:45:00-05:00');
  assert.equal(f.call('curbline.shares.list', {booking_id: id}).shares[0].status, 'expired');
  f.event(arrive('2026-12-04T11:58:00-05:00', id));
  assert.equal(notes(f, {booking_id: id, recipient_person_id: 'person-dan'}).length, 2, 'no update after expiry');
  assert.equal(f.data.shares.find(s => s.booking_id === id).ended_at, '2026-12-04T11:45:00-05:00');
});

// ---- Workflow 6: payments, receipts, tips and support ----
function completed() {
  const f = shifted();
  f.event(assign('2026-12-04T00:20:00-05:00', 'bk-7', '2026-12-04T00:58:00-05:00'));
  f.event(flightStatus('2026-12-04T00:38:00-05:00', 'landed', '2026-12-04T00:38:00-05:00', 'pl-ngi-term-4', {landed_at: '2026-12-04T00:38:00-05:00'}));
  f.event(arrive('2026-12-04T01:00:00-05:00', 'bk-7'));
  f.event(start('2026-12-04T01:50:00-05:00', 'bk-7'));
  f.event(complete('2026-12-04T02:24:00-05:00', 'bk-7', '2026-12-04T01:50:00-05:00'));
  return f;
}
test('Row 8: a fare review adjustment is refund_pending until payment.refund_settled; tips close after 72 h', () => {
  const f = completed();
  const c = f.call('curbline.support.open', {booking_id: 'bk-7', reason: 'fare_review', note: 'Longer route than quoted.'});
  assert.equal(c.case_id, 'cs-bk-7-1');
  unchanged(f, () => f.call('curbline.support.open', {booking_id: 'bk-7', reason: 'lost_item', note: 'Umbrella'}), 'case_already_open');
  f.event(ev('support.resolved', '2026-12-06T10:00:00-05:00', {case_id: 'cs-bk-7-1', outcome: 'resolved_adjusted', adjustment_cents: -800, note: 'Route longer than quoted.'}));
  let r = f.call('curbline.receipts.get', {booking_id: 'bk-7'}).receipt;
  assert.deepEqual([r.refund_pending_cents, r.refunded_cents], [800, 0]);
  assert.equal(r.entries.find(e => e.type === 'refund').entry_id, 'le-bk-7-3');
  f.event(ev('payment.refund_settled', '2026-12-08T09:00:00-05:00', {ledger_entry_id: 'le-bk-7-3', settled_at: '2026-12-08T09:00:00-05:00'}));
  r = f.call('curbline.receipts.get', {booking_id: 'bk-7'}).receipt;
  assert.deepEqual([r.refund_pending_cents, r.refunded_cents, r.net_cents], [0, 800, 4735]);
  assert.ok(notes(f, {booking_id: 'bk-7'}).some(n => n.kind === 'refund_settled'));
  unchanged(f, () => f.event(ev('payment.refund_settled', '2026-12-08T09:30:00-05:00', {ledger_entry_id: 'le-bk-7-3', settled_at: '2026-12-08T09:30:00-05:00'})), 'refund_not_pending');
  // Tips: accepted 71 h after completion, closed at 73 h.
  const g = completed();
  g.advance('2026-12-07T01:24:00-05:00');
  g.call('curbline.trips.tip', {booking_id: 'bk-7', amount_cents: 300});
  g.advance('2026-12-07T03:24:00-05:00');
  unchanged(g, () => g.call('curbline.trips.tip', {booking_id: 'bk-7', amount_cents: 500}), 'tip_window_closed');
});

test('W6 tips, expense profile and support eligibility', () => {
  const f = completed();
  unchanged(f, () => f.call('curbline.trips.tip', {booking_id: 'bk-7', amount_cents: 10001}), 'invalid_amount');
  assert.equal(f.call('curbline.trips.tip', {booking_id: 'bk-7', amount_cents: 500}).entry_id, 'le-bk-7-3');
  f.call('curbline.trips.set_expense', {booking_id: 'bk-7', profile: 'business', memo: 'Northbay client visit'});
  assert.deepEqual(get(f, 'bk-7').expense, {profile: 'business', memo: 'Northbay client visit'});
  f.call('curbline.support.open', {booking_id: 'bk-7', reason: 'wait_fee_review', note: 'The flight landed late.'});
  f.event(ev('support.resolved', '2026-12-05T10:00:00-05:00', {case_id: 'cs-bk-7-1', outcome: 'resolved_no_change', note: 'Fee applied correctly.'}));
  unchanged(f, () => f.event(ev('support.resolved', '2026-12-05T10:05:00-05:00', {case_id: 'cs-bk-7-1', outcome: 'resolved_no_change'})), 'invalid_transition');
  unchanged(f, () => f.call('curbline.support.open', {booking_id: 'bk-1', reason: 'wait_fee_review', note: 'x'}), 'not_eligible');
  unchanged(f, () => f.call('curbline.support.open', {booking_id: 'bk-5', reason: 'lost_item', note: 'x'}), 'not_completed');
  unchanged(f, () => f.call('curbline.trips.tip', {booking_id: 'bk-5', amount_cents: 100}), 'not_completed');
  f.advance('2027-01-04T03:00:00-05:00');
  unchanged(f, () => f.call('curbline.trips.set_expense', {booking_id: 'bk-7', profile: 'personal'}), 'expense_window_closed');
});

// ---- Targeting, moot events and idempotency ----
test('W5 selectors: one match, none (no-op), several (earliest, or rejected on request); needs_attention is skipped', () => {
  const f = fixture();
  book(f, airportRide());
  f.event(flightStatus('2026-12-03T19:40:00-05:00', 'diverted', '2026-12-04T00:40:00-05:00', 'pl-bfa-term-b'));
  book(f, bfaRide());
  // bk-7 (NGI, needs_attention) and bk-8 (BFA, scheduled) both track PA218; only bk-8 can take a driver.
  f.event(assign('2026-12-03T22:50:00-05:00', {flight: PA218}, '2026-12-04T00:58:00-05:00'));
  assert.deepEqual([get(f, 'bk-7').status, get(f, 'bk-8').status], ['needs_attention', 'driver_assigned']);
  const before = f.data.ignored_events.length;
  f.event(assign('2026-12-03T22:51:00-05:00', {rider_person_id: 'person-maya', pickup_from: '2026-12-10T00:00:00-05:00', pickup_to: '2026-12-10T23:59:00-05:00'}, '2026-12-10T08:00:00-05:00'));
  assert.equal(f.data.ignored_events.length, before + 1);
  assert.equal(f.data.ignored_events.at(-1).reason, 'selector_no_match');
  // Two scheduled duplicates: first applies to the earlier one; reject refuses.
  const g = fixture();
  const q = quote(g, airportRide());
  g.call('curbline.bookings.create', {quote_token: q.quote_token, payment_method_id: 'pm-work'});
  g.call('curbline.bookings.create', {quote_token: q.quote_token, payment_method_id: 'pm-work'});
  const window = {rider_person_id: 'person-maya', pickup_from: '2026-12-03T23:00:00-05:00', pickup_to: '2026-12-03T23:30:00-05:00'};
  unchanged(g, () => g.event(assign('2026-12-03T22:50:00-05:00', window, '2026-12-03T23:10:00-05:00', {on_multiple: 'reject'})), 'ambiguous_selector');
  g.event(assign('2026-12-03T22:51:00-05:00', window, '2026-12-03T23:10:00-05:00'));
  assert.deepEqual([get(g, 'bk-7').status, get(g, 'bk-8').status], ['driver_assigned', 'scheduled']);
});

test('W5 moot and missing targets commit as no-ops; impossible transitions are rejected', () => {
  const f = fixture();
  book(f, airportRide());
  f.call('curbline.bookings.cancel', {booking_id: 'bk-7', reason: 'Plans changed'});
  f.event(assign('2026-12-03T22:00:00-05:00', 'bk-7', '2026-12-03T23:10:00-05:00'));
  assert.equal(f.now, '2026-12-03T22:00:00-05:00', 'the clock advanced');
  const last = get(f, 'bk-7').history.at(-1);
  assert.deepEqual([last.action, last.details], ['event_ignored', {operation: 'dispatch.driver_assigned', ignored_reason: 'booking_cancelled'}]);
  f.event(arrive('2026-12-03T22:05:00-05:00', 'bk-12'));
  assert.deepEqual(f.data.ignored_events.map(e => e.reason), ['booking_cancelled', 'booking_not_found']);
  f.event(ev('support.resolved', '2026-12-03T22:06:00-05:00', {case_id: 'cs-bk-12-1', outcome: 'resolved_no_change'}));
  f.event(ev('payment.refund_settled', '2026-12-03T22:07:00-05:00', {ledger_entry_id: 'le-bk-12-3', settled_at: '2026-12-03T22:07:00-05:00'}));
  assert.deepEqual(f.data.ignored_events.slice(2).map(e => e.reason), ['case_not_found', 'ledger_entry_not_found']);
  book(f, airportRide({flight: undefined, pickup_buffer_min: undefined, pickup_at: '2026-12-04T09:00:00-05:00'}));
  unchanged(f, () => f.event(arrive('2026-12-03T22:10:00-05:00', 'bk-8')), 'invalid_transition');
  unchanged(f, () => f.event(flightStatus('2026-12-03T22:10:00-05:00', 'delayed', '2026-12-04T00:00:00-05:00', 'pl-harborview-hotel')), 'invalid_event');
  unchanged(f, () => f.event(ev('flight.status_changed', '2026-12-03T22:10:00-05:00', {flight: {carrier: 'ZZ', number: '9', local_date: '2026-12-03'},
    status: 'delayed', scheduled_arrival: '2026-12-03T22:00:00-05:00', estimated_arrival: '2026-12-03T23:00:00-05:00', arrival_place_id: 'pl-ngi-term-4'})), 'invalid_event');
});

// ---- Notifications and delivery ----
test('W4 notification IDs are distinct per recipient; a recipient without Mail is no_recipient_channel', () => {
  const f = fixture();
  book(f, airportRide({flight: undefined, pickup_buffer_min: undefined}), {rider_person_id: 'person-jon'});
  const list = notes(f, {booking_id: 'bk-7'});
  assert.deepEqual(list.map(n => [n.notification_id, n.recipient_role, n.status]),
    [['n-bk7-confirmed-1-maya', 'booker', 'pending_delivery'], ['n-bk7-pickup-1-jon', 'rider', 'no_recipient_channel']]);
  f.event(assign('2026-12-03T22:50:00-05:00', 'bk-7', '2026-12-03T23:10:00-05:00'));
  const assigned = notes(f, {booking_id: 'bk-7'}).filter(n => n.kind === 'driver_assigned').map(n => n.notification_id);
  assert.deepEqual(assigned, ['n-bk7-assigned-1-maya', 'n-bk7-assigned-1-jon']);
});

test('Mail row: delivery outcomes map to notification status; idempotency_conflict and stop_run stay pending', () => {
  const f = fixture();
  book(f, airportRide());
  f.event(flightStatus('2026-12-03T19:40:00-05:00', 'diverted', '2026-12-04T00:40:00-05:00', 'pl-bfa-term-b'));
  const id = 'n-bk7-attention-1-maya';
  f.event(delivery('2026-12-03T19:43:00-05:00', id, 'rejected', 'idempotency_conflict'));
  assert.equal(notes(f).find(n => n.notification_id === id).status, 'pending_delivery');
  f.event(delivery('2026-12-03T19:44:00-05:00', id, 'unknown', 'receiver_unconfirmed', {stop_run: true}));
  assert.equal(notes(f).find(n => n.notification_id === id).status, 'pending_delivery');
  f.event(delivery('2026-12-03T19:45:00-05:00', id, 'committed'));
  const n = notes(f).find(x => x.notification_id === id);
  assert.deepEqual([n.status, n.outcome.router_event_id], ['delivered', 'router-abc']);
  unchanged(f, () => f.event(delivery('2026-12-03T19:46:00-05:00', id, 'committed')), 'notification_not_pending');
  f.event(delivery('2026-12-03T19:47:00-05:00', 'n-bk7-confirmed-1-maya', 'rejected', 'recipient_not_authorized'));
  assert.equal(notes(f).find(x => x.notification_id === 'n-bk7-confirmed-1-maya').status, 'delivery_failed');
  unchanged(f, () => f.event(delivery('2026-12-03T19:48:00-05:00', 'n-nope', 'committed')), 'notification_not_found');
});

test('Mail row: the example wire message is the one in the proposal', () => {
  const f = fixture();
  book(f, airportRide());
  f.event(flightStatus('2026-12-03T19:40:00-05:00', 'diverted', '2026-12-04T00:40:00-05:00', 'pl-bfa-term-b'));
  const n = f.data.notifications.find(x => x.notification_id === 'n-bk7-attention-1-maya');
  const m = require('../src/publisher.cjs').message(f.data, n);
  assert.deepEqual(m, {specversion: '1.0', id: 'curbline-n-bk7-attention-1-maya', source: 'urn:pale:app:curbline:account:curbline-maya',
    type: 'org.pale.mail.notification.v1', time: '2026-12-03T19:40:00-05:00', datacontenttype: 'application/json', dataschema: 'urn:pale:email-payload:1',
    subject: 'bk-7', data: {channel: 'channel.email', recipient: {kind: 'person_ref', id: 'person-maya'},
      source_object: {app_id: 'curbline', account_id: 'curbline-maya', object_type: 'booking', object_id: 'bk-7'},
      content: {title: 'Pickup needs attention: flight now arrives at BFA', body: {format: 'text/plain', text: n.body}, asset_ids: []}, extensions: []}});
  const {compile} = require('./schema-validator.cjs');
  const valid = compile(require('../schemas/mail-router-message.schema.json'), path.resolve(__dirname, '../schemas'));
  assert.ok(valid(m), 'valid against Mail\'s wire schema');
});

// ---- Seeds, packs and determinism ----
test('seed: future-dated history is rejected, while data an event adds at its own time passes', () => {
  const seed = structuredClone(require('../fixtures/minimal.json'));
  seed.bookings[0].history.push({at: '2026-12-04T09:00:00-05:00', actor: 'agent', action: 'note', from: null, to: null, details: {}, event_id: null});
  assert.throws(() => fixture({seed}), e => e.code === 'invalid_seed');
  const ledgerSeed = structuredClone(require('../fixtures/minimal.json'));
  ledgerSeed.ledger[0].created_at = '2026-12-05T09:00:00-05:00';
  assert.throws(() => fixture({seed: ledgerSeed}), e => e.code === 'invalid_seed');
  const f = completed();
  assert.equal(f.data.ledger.find(e => e.entry_id === 'le-bk-7-2').created_at, '2026-12-04T02:24:00-05:00');
});

test('fixtures: history starts on or after 2025-01-01 and is dense after 2026-01-01', () => {
  for (const name of ['household', 'care', 'school']) {
    const seed = require(`../examples/packs/${name}/seed.json`);
    const times = seed.bookings.map(b => Date.parse(b.created_at));
    assert.ok(Math.min(...times) >= Date.parse('2025-01-01T00:00:00-05:00'), name);
    const recent = seed.bookings.filter(b => Date.parse(b.pickup_at) >= Date.parse('2026-01-01T00:00:00-05:00')).length;
    assert.ok(recent >= 25, name + ' has ' + recent + ' rides in 2026');
  }
});

for (const name of ['household', 'care', 'school']) {
  test(`pack ${name}: loads, replays every event, and reaches the expected statuses`, () => {
    const {f, script} = H.pack(name);
    for (const e of script.events) f.event(e);
    for (const [id, status] of Object.entries(script.expect)) assert.equal(get(f, id).status, status, id);
    assert.equal(f.data.ignored_events.length, 0);
  });
}

test('pack household: a delay moves the flight pickup, and the late landing sets the wait fee', () => {
  const {f, script} = H.pack('household');
  for (const e of script.events) f.event(e);
  const id = Object.keys(script.expect)[1], b = get(f, id);
  assert.equal(b.pickup_at, '2026-12-05T15:45:00-05:00');
  assert.equal(b.wait_fee_cents, 350, 'free wait ends 16:18 (landing + 60); trip starts 16:25');
});

test('optional diagnostics cannot change business results', () => {
  const quiet = fixture({logging: false}), loud = fixture();
  book(quiet, airportRide()); book(loud, airportRide());
  assert.deepEqual(quiet.data, loud.data);
  const broken = fixture();
  broken.ctx.log = () => { throw new Error('sink down'); };
  book(broken, airportRide());
  assert.deepEqual(broken.data, loud.data);
});

test('plugin exposes the host hooks', () => {
  for (const hook of ['validateSeed', 'handleTool', 'applyEvent', 'records', 'objects', 'references']) assert.equal(typeof plugin[hook], 'function');
});
