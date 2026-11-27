'use strict';
// Agent reads. Every read works on a copy with the due statuses settled at ctx.virtual_now, so it shows
// what the next write or event will commit; quoting and previews store nothing.
const {fail, copy, MIN, place: getPlace, booking: getBooking, sameFlight} = require('./common.cjs');
const {render, ms} = require('./time.cjs');
const {POLICY} = require('./catalog.cjs');
const fare = require('./fare.cjs');
const B = require('./bookings.cjs');

const masked = m => ({payment_method_id: m.payment_method_id, brand: m.brand, last4: m.last4, label: m.label, profile: m.profile});

function flightView(data, key) {
  if (!key) return null;
  const f = data.flights.find(x => sameFlight(x, key));
  if (!f) return {...copy(key), status: 'unknown'};
  return {carrier: f.carrier, number: f.number, local_date: f.local_date, status: f.status, scheduled_arrival: f.scheduled_arrival,
    estimated_arrival: f.estimated_arrival, arrival_place_id: f.arrival_place_id, landed_at: f.landed_at};
}

// A booking with its policy times derived at the virtual time.
function bookingView(ctx, data, b) {
  const zone = B.tz(data, b), now = ctx.virtual_now, fmt = t => (t === null || t === undefined ? null : render(t, zone));
  const fee = B.cancelFee(data, b, now);
  const done = b.completed_at ? ms(b.completed_at) : null;
  return {...copy(b), flight: flightView(data, b.flight),
    payment_method: masked(data.payment_methods.find(m => m.payment_method_id === b.payment_method_id)),
    policy: {free_until: B.isActive(b) && b.status !== 'needs_attention' ? fmt(B.freeUntil(b)) : null,
      cancellable: fee !== null, cancel_fee_cents: fee, lapse_at: fmt(B.lapseAt(b)), free_wait_end: fmt(B.freeWaitEnd(data, b)),
      tip_until: done === null ? null : fmt(done + POLICY.tip_window_hours * 60 * MIN),
      expense_until: done === null ? null : fmt(done + POLICY.expense_window_days * 1440 * MIN)}};
}
const summary = (ctx, data, b) => ({booking_id: b.booking_id, status: b.status, pickup_place_id: b.pickup_place_id,
  dropoff_place_id: b.dropoff_place_id, pickup_at: b.pickup_at, option: b.option, rider_person_id: b.rider_person_id,
  fare_cents: b.fare.fare_cents, overlaps_with: [...b.overlaps_with], attention: copy(b.attention),
  flight: b.flight ? copy(b.flight) : null});

function quote(ctx, data, args) {
  const request = fare.normalRequest(args), p = fare.price(ctx, data, request), zone = p.route.pickup.time_zone;
  return {as_of: render(ctx.virtual_now, zone), quote: {available: p.available, code: p.available ? null : 'no_vehicle_for_requirements',
    pickup_at: render(request.pickup_at, zone), option: request.option, fare_cents: p.fare.fare_cents, breakdown: p.fare.breakdown,
    distance_km: p.fare.km, duration_min: p.fare.minutes, band: p.fare.band, fare_version: p.fare.fare_version,
    expires_at: p.available ? render(fare.expiresAt(ctx.virtual_now, POLICY.quote_ttl_min), zone) : null,
    quote_token: p.available ? fare.quoteToken(request, p.fare, new Date(ms(ctx.virtual_now)).toISOString()) : null,
    warnings: p.warnings, alternatives: p.alternatives.map(a => ({...a, pickup_at: render(a.pickup_at, zone)}))}};
}

const CHANGE_KEYS = ['pickup_place_id', 'dropoff_place_id', 'pickup_at', 'option', 'passengers', 'bags', 'child_seats', 'flight', 'pickup_buffer_min'];
const current = b => ({pickup_place_id: b.pickup_place_id, dropoff_place_id: b.dropoff_place_id, pickup_at: b.pickup_at, option: b.option,
  passengers: b.passengers, bags: b.bags, child_seats: b.child_seats, flight: b.flight_tracking ? b.flight : null, pickup_buffer_min: b.pickup_buffer_min});

// Shared by preview_change and update: the changed request priced at the virtual time.
function priceChange(ctx, data, b, changes) {
  B.expect(b, ['scheduled', 'needs_attention'], 'modify_not_allowed');
  const keys = Object.keys(changes).filter(k => CHANGE_KEYS.includes(k));
  const before = current(b), merged = {...before};
  for (const k of keys) merged[k] = changes[k];
  const same = k => (k === 'pickup_at' ? ms(merged[k]) === ms(before[k]) : JSON.stringify(merged[k]) === JSON.stringify(before[k]));
  if (keys.every(same)) fail('no_change', 'The change does not differ from the booking.');
  const oldPickup = getPlace(data, b.pickup_place_id), newPickup = getPlace(data, merged.pickup_place_id);
  if (oldPickup.kind === 'airport_terminal' && newPickup.kind === 'airport_terminal' && oldPickup.airport_code !== newPickup.airport_code) {
    fail('airport_change_requires_new_booking', 'A pickup cannot move from ' + oldPickup.airport_code + ' to ' + newPickup.airport_code + '; book the new airport separately.');
  }
  const request = fare.normalRequest(merged);
  const timeChanged = ms(merged.pickup_at) !== ms(before.pickup_at);
  const p = fare.price(ctx, data, request, {checkTime: timeChanged});
  return {request, priced: p, changes: Object.fromEntries(keys.map(k => [k, merged[k]]))};
}

function previewChange(ctx, data, args) {
  const b = getBooking(data, args.booking_id), zone = B.tz(data, b);
  const {request, priced, changes} = priceChange(ctx, data, b, args.changes);
  const quotedAt = new Date(ms(ctx.virtual_now)).toISOString();
  return {as_of: render(ctx.virtual_now, zone), booking_id: b.booking_id, available: priced.available,
    code: priced.available ? null : 'no_vehicle_for_requirements', pickup_at: render(request.pickup_at, zone), option: request.option,
    fare_cents: priced.fare.fare_cents, fare_difference_cents: priced.fare.fare_cents - b.fare.fare_cents, breakdown: priced.fare.breakdown,
    change_token: priced.available ? fare.changeToken(b.booking_id, b.revision, changes, priced.fare, quotedAt) : null,
    expires_at: priced.available ? render(fare.expiresAt(ctx.virtual_now, POLICY.change_token_ttl_min), zone) : null,
    warnings: priced.warnings, alternatives: priced.alternatives.map(a => ({...a, pickup_at: render(a.pickup_at, zone)}))};
}

function previewCancel(ctx, data, args) {
  const b = getBooking(data, args.booking_id), zone = B.tz(data, b), fee = B.cancelFee(data, b, ctx.virtual_now);
  return {as_of: render(ctx.virtual_now, zone), booking_id: b.booking_id, booking_status: b.status, cancellable: fee !== null, fee_cents: fee,
    free_until: ['scheduled', 'driver_assigned'].includes(b.status) ? render(B.freeUntil(b), zone) : null,
    reason: fee === null ? (b.status === 'cancelled' ? 'already_cancelled' : 'not_cancellable')
      : b.status === 'needs_attention' ? 'needs_attention_free' : b.status === 'driver_arrived' ? 'driver_arrived' : fee ? 'inside_free_window' : 'free'};
}

// Receipt from the ledger: what was captured or charged, and refunds pending versus refunded.
function receipt(ctx, data, args) {
  const b = getBooking(data, args.booking_id), zone = B.tz(data, b);
  const entries = data.ledger.filter(e => e.booking_id === b.booking_id);
  const sum = f => entries.filter(f).reduce((s, e) => s + e.amount_cents, 0);
  const charged = sum(e => (e.type === 'hold' && e.status === 'captured') || e.type === 'charge');
  const pending = sum(e => e.type === 'refund' && e.status === 'refund_pending'), refunded = sum(e => e.type === 'refund' && e.status === 'refunded');
  const held = sum(e => e.type === 'hold' && e.status === 'authorized');
  return {as_of: render(ctx.virtual_now, zone), receipt: {booking_id: b.booking_id, status: b.status, fare: copy(b.fare),
    trip: copy(b.trip), entries: copy(entries), held_cents: held, charged_cents: charged, refund_pending_cents: pending,
    refunded_cents: refunded, net_cents: charged - refunded, expense: copy(b.expense),
    payment_method: masked(data.payment_methods.find(m => m.payment_method_id === b.payment_method_id))}};
}

function read(ctx, raw, name, args) {
  const now = ctx.virtual_now, asOf = render(now, raw.settings.time_zone);
  if (!READS.includes(name)) return null;
  const data = B.settle(copy(raw), now);
  switch (name) {
    case 'curbline.places.search': {
      const q = (args.query || '').toLocaleLowerCase();
      return {places: copy(data.places.filter(p => (!args.kind || p.kind === args.kind) &&
        (p.name.toLocaleLowerCase().includes(q) || p.place_id.includes(q) || (p.airport_code || '').toLocaleLowerCase() === q)))};
    }
    case 'curbline.places.get': return {place: copy(getPlace(data, args.place_id))};
    case 'curbline.rides.quote': return quote(ctx, data, args);
    case 'curbline.payment_methods.list': return {payment_methods: data.payment_methods.map(masked)};
    case 'curbline.bookings.list': {
      const from = args.from ? ms(args.from) : -Infinity, to = args.to ? ms(args.to) : Infinity;
      const list = data.bookings.filter(b => (!args.status || b.status === args.status) && ms(b.pickup_at) >= from && ms(b.pickup_at) <= to);
      return {as_of: asOf, bookings: list.map(b => summary(ctx, data, b))};
    }
    case 'curbline.bookings.get': return {as_of: asOf, booking: bookingView(ctx, data, getBooking(data, args.booking_id))};
    case 'curbline.bookings.preview_change': return previewChange(ctx, data, args);
    case 'curbline.bookings.preview_cancel': return previewCancel(ctx, data, args);
    case 'curbline.shares.list': return {as_of: asOf, shares: copy(data.shares.filter(s => !args.booking_id || s.booking_id === args.booking_id))};
    case 'curbline.receipts.get': return receipt(ctx, data, args);
    case 'curbline.support.list': return {as_of: asOf, cases: copy(data.support_cases.filter(c => !args.booking_id || c.booking_id === args.booking_id))};
    case 'curbline.notifications.list': return {as_of: asOf, notifications: copy(data.notifications.filter(n =>
      (!args.booking_id || n.booking_id === args.booking_id) && (!args.status || n.status === args.status) &&
      (!args.recipient_person_id || n.recipient_person_id === args.recipient_person_id)))};
    default: return null;
  }
}
const READS = ['curbline.places.search', 'curbline.places.get', 'curbline.rides.quote', 'curbline.payment_methods.list', 'curbline.bookings.list',
  'curbline.bookings.get', 'curbline.bookings.preview_change', 'curbline.bookings.preview_cancel', 'curbline.shares.list',
  'curbline.receipts.get', 'curbline.support.list', 'curbline.notifications.list'];

module.exports = {read, READS, priceChange, bookingView};
